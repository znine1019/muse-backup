#!/usr/bin/env python3
# GitHub 每日同步脚本（2026-11-24 新增，随每日迁移备份 00:19 在 Drive 上传后、发邮件前运行）
# 作用：把全局包范围（以 rebuild-global.sh 的 staging-global 为来源，与其来源/排除规则一致）
#       以解开的 UTF-8 文本文件形式同步到 GitHub 私有仓库 znine1019/muse-backup（main 分支），
#       方便跨 agent 调用。邮件 + Drive 的全局备份照旧，本脚本只是新增去向。
# 规则（快照指南 /opt/hatch/connectors/github/references/snapshot-push.md）：
#   - 快照只收 UTF-8 文本、不支持删除；单块原始字节 <= 4,000,000、文件数 <= 500（实测 6.5MB 会 HTTP 413）
#   - 超过 4MB 的文本文件切分到 <原路径>.parts/（每块 <= 2MB，UTF-8 边界切分），原文件不进树
#   - 永远排除：sensitive-source/ 下任何文件、*secret*/*credential*/*.pem/*.key/私钥模式、
#     浏览器 profile、node_modules、app.db*、四个备份 zip 本身、WorkBuddy 安装包、二进制文件
#   - 被排除文件逐个记入树根 SYNC-EXCLUDED.md（相对路径/大小/SHA-256 前16位/原因；不复制内容）
#   - 每块拿到确认的 commit SHA 后才追加同步记录并推进本地状态；任一块失败立即停，已成功块不重推
# 用法：sync-github.sh [--dry-run]
# 前置：先跑 rebuild.sh / rebuild-gpt.sh / rebuild-global.sh（本脚本读 staging-global）。
import datetime, fnmatch, hashlib, json, os, pathlib, re, shutil, subprocess, sys

HOME_DIR = pathlib.Path.home()
WORK = HOME_DIR / 'workspace/migration-backup'
TREE = WORK / 'github-sync-tree'
RECORD = pathlib.Path(str(TREE) + '.muse-github-snapshot-sync.json')
STATE = WORK / 'github-sync-state.json'
STAGE_GLOBAL = WORK / 'staging-global'
LOG = WORK / 'github-sync-last.log'
CHUNK_DIR = WORK / 'github-sync-chunks'
GH_CLI = '/opt/hatch/bin/github'
OWNER, REPO, BRANCH = 'znine1019', 'muse-backup', 'main'

SPLIT_THRESHOLD = 4_000_000
PART_SIZE = 2_000_000
CHUNK_BYTES = 4_000_000
CHUNK_FILES = 500

SECRET_PATTERNS = ['*secret*', '*credential*', '*.pem', '*.key', '.env', '*.env',
                   'id_rsa*', 'id_ed25519', 'id_ecdsa*', 'id_dsa*']
PRIVATE_KEY_PATTERNS = ['*.pem', '*.key', 'id_rsa*', 'id_ed25519', 'id_ecdsa*', 'id_dsa*']
BACKUP_ZIPS = {'muse-migration-2026-11-12.zip', 'muse-migration-2026-11-12-supplement.zip',
               'gpt-data-package.zip', 'global-backup.zip'}
SENSITIVE_NAME = 'Muse________2026-11-12.md'

DRY_RUN = '--dry-run' in sys.argv
TODAY = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d')
NOW = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M %Z')

log_lines = []
def log(msg):
    log_lines.append(msg)
    print(msg)

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def is_secret_name(name):
    low = name.lower()
    return any(fnmatch.fnmatch(low, pat) for pat in SECRET_PATTERNS)

def is_private_key_name(name):
    low = name.lower()
    return any(fnmatch.fnmatch(low, pat) for pat in PRIVATE_KEY_PATTERNS)

def atomic_write_json(path, data):
    tmp = path.with_name(path.name + f'.tmp-{os.getpid()}')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    os.replace(tmp, path)

def main():
    if not STAGE_GLOBAL.is_dir() or not (STAGE_GLOBAL / 'GLOBAL-MANIFEST.md').is_file():
        log(f'错误：{STAGE_GLOBAL} 不存在或缺 GLOBAL-MANIFEST.md，请先运行 rebuild-global.sh')
        LOG.write_text('\n'.join(log_lines) + '\n', encoding='utf-8')
        return 2

    # ---------- 状态引导：无 state 时从快照同步记录 + 当前树内容重建（均为已确认推送的路径） ----------
    state = {}
    bootstrap_count = 0
    if STATE.is_file():
        state = json.loads(STATE.read_text(encoding='utf-8'))
    elif RECORD.is_file():
        entries = json.loads(RECORD.read_text(encoding='utf-8'))
        seen = set()
        for e in entries:
            if e.get('owner') == OWNER and e.get('repo') == REPO and e.get('branch') == BRANCH:
                for rel in e.get('paths', []):
                    if rel in seen:
                        continue
                    seen.add(rel)
                    fp = TREE / rel
                    if fp.is_file():
                        state[rel] = sha256_file(fp)
                        bootstrap_count += 1
        log(f'状态文件不存在，已从快照同步记录引导 {bootstrap_count} 条已同步路径')

    # ---------- 暂存：staging-global -> github-sync-tree（只收 UTF-8 文本） ----------
    preserved_readme = None
    readme_path = TREE / 'README.md'
    if readme_path.is_file():
        preserved_readme = readme_path.read_bytes()
    if TREE.exists():
        shutil.rmtree(TREE)
    TREE.mkdir(parents=True)

    excluded = {}   # rel -> (size, sha16_or_note, reason)
    split_info = [] # (rel, size, full_sha, n_parts)
    staged_files = 0
    staged_bytes = 0

    def add_excluded(rel, size, sha16, reason):
        if rel not in excluded:
            excluded[rel] = (size, sha16, reason)

    for root, dirs, files in os.walk(STAGE_GLOBAL):
        dirs.sort()
        rootp = pathlib.Path(root)
        for fn in sorted(files):
            fp = rootp / fn
            rel = fp.relative_to(STAGE_GLOBAL).as_posix()
            parts = pathlib.PurePosixPath(rel).parts
            if fp.is_symlink() or not fp.is_file():
                add_excluded(rel, 0, '—', '非常规文件（符号链接/socket 等），无法打包')
                continue
            size = fp.stat().st_size
            if 'sensitive-source' in parts:
                add_excluded(rel, size, sha256_file(fp)[:16], '敏感源文件目录 sensitive-source/，永不同步 GitHub，只列名/大小/哈希')
                continue
            if is_secret_name(fn):
                sha_note = '（不记录）' if is_private_key_name(fn) else sha256_file(fp)[:16]
                add_excluded(rel, size, sha_note, '文件名匹配秘密/凭证/私钥模式')
                continue
            if fn in BACKUP_ZIPS:
                add_excluded(rel, size, sha256_file(fp)[:16], '四个备份 zip 本身（防递归/重复）')
                continue
            if 'node_modules' in parts:
                add_excluded(rel, size, sha256_file(fp)[:16], 'node_modules 依赖目录')
                continue
            if fn.startswith('app.db'):
                add_excluded(rel, size, sha256_file(fp)[:16], 'Spaces 数据库文件 app.db*（需空间工具导出）')
                continue
            if '.hatch-browser' in parts:
                add_excluded(rel, size, sha256_file(fp)[:16], '浏览器 profile/cookies')
                continue
            if fn.endswith('.muse-github-snapshot-sync.json') or '.muse-github-snapshot-sync.json.tmp-' in fn:
                add_excluded(rel, size, sha256_file(fp)[:16], 'GitHub 快照同步记录文件（指南要求排除）')
                continue
            data = fp.read_bytes()
            try:
                data.decode('utf-8')
                is_text = b'\x00' not in data
            except UnicodeDecodeError:
                is_text = False
            if not is_text:
                add_excluded(rel, size, sha256_file(fp)[:16], '二进制文件（非 UTF-8 文本），不进 GitHub 树')
                continue
            if size > SPLIT_THRESHOLD:
                full_sha = hashlib.sha256(data).hexdigest()
                parts_dir = TREE / (rel + '.parts')
                parts_dir.mkdir(parents=True, exist_ok=True)
                idx = 0
                start = 0
                part_sizes = []
                while start < len(data):
                    end = min(start + PART_SIZE, len(data))
                    while end < len(data) and (data[end] & 0xC0) == 0x80:
                        end -= 1
                    chunk = data[start:end]
                    (parts_dir / f'part-{idx:03d}').write_bytes(chunk)
                    part_sizes.append(len(chunk))
                    staged_files += 1
                    staged_bytes += len(chunk)
                    start = end
                    idx += 1
                index_lines = [
                    f'# 切分索引：{rel}', '',
                    f'- 原文件：{rel}',
                    f'- 原文件大小：{size} 字节',
                    f'- 原文件 SHA-256：{full_sha}',
                    f'- 块数：{idx}（每块 <= {PART_SIZE} 字节，按 UTF-8 边界切分）',
                    '- 块清单：' + ', '.join(f'part-{i:03d}（{s} 字节）' for i, s in enumerate(part_sizes)),
                    '',
                    '拼回方法（在仓库根目录执行）：',
                    '',
                    '```sh',
                    f'cat {rel}.parts/part-* > {rel}',
                    '```',
                    '',
                    '拼回后用上面的 SHA-256 校验完整性。',
                ]
                (parts_dir / 'INDEX.md').write_text('\n'.join(index_lines) + '\n', encoding='utf-8')
                staged_files += 1
                staged_bytes += (parts_dir / 'INDEX.md').stat().st_size
                split_info.append((rel, size, full_sha, idx))
                continue
            dst = TREE / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(data)
            staged_files += 1
            staged_bytes += size

    # ---------- 暂存范围之外的全局排除项（逐个列名/大小/哈希，不复制内容） ----------
    export_dir = HOME_DIR / 'memory/chatgpt-export-2026-11-12'
    if export_dir.is_dir():
        for p in sorted(export_dir.rglob('*.dat')):
            rel = 'memory/chatgpt-export-2026-11-12/' + p.relative_to(export_dir).as_posix()
            add_excluded(rel, p.stat().st_size, sha256_file(p)[:16],
                         'ChatGPT 导出二进制 .dat（本体由 Drive 原始 zip 覆盖，完整清单见 GLOBAL-MANIFEST.md）')
    sens = HOME_DIR / 'memory/muse-migration-2026-11-12-supplement/sensitive-source' / SENSITIVE_NAME
    if sens.is_file():
        add_excluded(f'memory/muse-migration-2026-11-12-supplement/sensitive-source/{SENSITIVE_NAME}',
                     sens.stat().st_size, sha256_file(sens)[:16],
                     '补包敏感源文件（含敏感号码值，永不同步 GitHub，只列名/大小/哈希）')
    wb_dir = HOME_DIR / 'workspace/workbuddy'
    if wb_dir.is_dir():
        for p in sorted(wb_dir.glob('*.deb')):
            if p.stat().st_size > 10_000_000:
                add_excluded(f'workspace/workbuddy/{p.name}', p.stat().st_size, sha256_file(p)[:16],
                             'WorkBuddy 安装包二进制（可从官方重下）')
    ts_root = HOME_DIR / 'workspace/ts-spaces'
    nm_count = nm_bytes = 0
    if ts_root.is_dir():
        for root, dirs, files in os.walk(ts_root):
            rootp = pathlib.Path(root)
            if 'node_modules' in rootp.parts:
                continue
            if 'node_modules' in dirs:
                nm_root = rootp / 'node_modules'
                for r2, d2, f2 in os.walk(nm_root):
                    for fn2 in f2:
                        nm_count += 1
                        nm_bytes += (pathlib.Path(r2) / fn2).stat().st_size
                dirs.remove('node_modules')
            for fn in files:
                if fn.startswith('app.db'):
                    p = rootp / fn
                    rel = 'workspace/ts-spaces/' + p.relative_to(ts_root).as_posix()
                    add_excluded(rel, p.stat().st_size, sha256_file(p)[:16],
                                 'Spaces 数据库文件 app.db*（需空间工具导出）')
    if nm_count:
        add_excluded('workspace/ts-spaces/*/node_modules/', nm_bytes, '—',
                     f'node_modules 依赖目录汇总（共 {nm_count} 个文件，可重装，逐文件清单见 GLOBAL-MANIFEST.md 排除节）')
    browser_dir = HOME_DIR / 'workspace/.hatch-browser'
    if browser_dir.is_dir():
        b_count = b_bytes = 0
        for root, dirs, files in os.walk(browser_dir):
            for fn in files:
                b_count += 1
                b_bytes += (pathlib.Path(root) / fn).stat().st_size
        add_excluded('workspace/.hatch-browser/', b_bytes, '—',
                     f'浏览器 profile/cookies 汇总（共 {b_count} 个文件）')
    ssh_key = HOME_DIR / '.ssh/id_ed25519'
    if ssh_key.is_file():
        add_excluded('root-dotfiles/.ssh/id_ed25519', ssh_key.stat().st_size, '（不记录）',
                     'SSH 私钥，永不进备份/同步')

    # ---------- SYNC-EXCLUDED.md ----------
    ex_lines = ['# GitHub 同步排除清单 SYNC-EXCLUDED', '',
                f'生成时间：{NOW}',
                f'被排除文件条目数：{len(excluded)}（含目录级汇总条目）',
                '说明：以下文件属于全局备份范围，但因二进制/敏感/凭证/体积等原因不进 GitHub 同步树；',
                '本体仍在邮件附件与 Google Drive 全局包里。敏感值本身从不写入本清单，只记名/大小/哈希。', '',
                '| 路径 | 大小（字节） | SHA-256 前16位 | 排除原因 |', '|---|---|---|---|']
    for rel in sorted(excluded):
        size, sha16, reason = excluded[rel]
        ex_lines.append(f'| {rel} | {size} | {sha16} | {reason} |')
    (TREE / 'SYNC-EXCLUDED.md').write_text('\n'.join(ex_lines) + '\n', encoding='utf-8')

    if preserved_readme is not None:
        (TREE / 'README.md').write_bytes(preserved_readme)

    # ---------- 树清单与状态比对 ----------
    tree_files = {}
    for p in sorted(TREE.rglob('*')):
        if p.is_file():
            rel = p.relative_to(TREE).as_posix()
            tree_files[rel] = (p.stat().st_size, sha256_file(p))
    total_tree_bytes = sum(s for s, _ in tree_files.values())
    pending = [rel for rel in sorted(tree_files) if state.get(rel) != tree_files[rel][1]]
    deleted = [rel for rel in sorted(state) if rel not in tree_files]

    # ---------- 分块计划 ----------
    CHUNK_DIR.mkdir(parents=True, exist_ok=True)
    for old in CHUNK_DIR.glob('chunk-*.paths'):
        old.unlink()
    chunks = []
    cur, cur_bytes = [], 0
    for rel in pending:
        sz = tree_files[rel][0]
        if cur and (cur_bytes + sz > CHUNK_BYTES or len(cur) >= CHUNK_FILES):
            chunks.append(cur)
            cur, cur_bytes = [], 0
        cur.append(rel)
        cur_bytes += sz
    if cur:
        chunks.append(cur)
    chunk_files = []
    for i, chunk in enumerate(chunks, 1):
        cf = CHUNK_DIR / f'chunk-{i:03d}.paths'
        with open(cf, 'wb') as f:
            for rel in chunk:
                f.write(rel.encode('utf-8') + b'\x00')
        chunk_files.append(cf)

    log(f'GitHub 同步{"（DRY-RUN）" if DRY_RUN else ""}：{NOW}')
    log(f'暂存：树内文件 {len(tree_files)} 个（其中暂存阶段写入 {staged_files} 个，另含 SYNC-EXCLUDED.md/README.md），总字节 {total_tree_bytes}')
    log(f'排除：{len(excluded)} 条（见树根 SYNC-EXCLUDED.md）')
    log(f'切分：{len(split_info)} 个大文件' + (''.join(f'\n  - {r}：{s} 字节，SHA-256 {h}，{n} 块' for r, s, h, n in split_info) if split_info else ''))
    log(f'比对：已同步状态 {len(state)} 条（引导 {bootstrap_count} 条）；待推送 {len(pending)} 个文件，{len(chunks)} 块；本地已删除、不推送删除 {len(deleted)} 个路径')
    for i, chunk in enumerate(chunks, 1):
        log(f'  块 {i}/{len(chunks)}：{len(chunk)} 个文件，{sum(tree_files[r][0] for r in chunk)} 字节')

    if DRY_RUN:
        log('DRY-RUN：未调用 push-files，未更新同步记录与状态文件。')
        LOG.write_text('\n'.join(log_lines) + '\n', encoding='utf-8')
        return 0

    # ---------- 逐块推送 ----------
    entries = []
    if RECORD.is_file():
        entries = json.loads(RECORD.read_text(encoding='utf-8'))
    pushed_total = 0
    for i, (chunk, cf) in enumerate(zip(chunks, chunk_files), 1):
        msg = f'Daily sync {TODAY} ({i}/{len(chunks)})'
        cmd = [GH_CLI, 'push-files', '--owner', OWNER, '--repo', REPO, '--branch', BRANCH,
               '--message', msg, '--source-dir', str(TREE), '--paths-file', str(cf)]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        out = (proc.stdout or '') + (proc.stderr or '')
        sha_match = None
        try:
            parsed = json.loads(proc.stdout)
            text = json.dumps(parsed)
            m = re.search(r'\b[0-9a-f]{40}\b', text)
            if m:
                sha_match = m.group(0)
        except Exception:
            m = re.search(r'\b[0-9a-f]{40}\b', out)
            if m:
                sha_match = m.group(0)
        if proc.returncode != 0 or not sha_match:
            log(f'失败：块 {i}/{len(chunks)}（{len(chunk)} 个文件）推送失败，returncode={proc.returncode}，输出摘录：{out[:500]}')
            log('已停止：此前成功块已记录，不重推；本块及后续块未推送。')
            LOG.write_text('\n'.join(log_lines) + '\n', encoding='utf-8')
            return 1
        entries.append({'owner': OWNER, 'repo': REPO, 'branch': BRANCH,
                        'source_dir': str(TREE), 'commit_sha': sha_match, 'paths': chunk})
        atomic_write_json(RECORD, entries)
        for rel in chunk:
            state[rel] = tree_files[rel][1]
        atomic_write_json(STATE, state)
        pushed_total += len(chunk)
        log(f'块 {i}/{len(chunks)} 已推送：{len(chunk)} 个文件，commit SHA 前16位 {sha_match[:16]}')
    if not chunks:
        log('无待推送文件，本次未产生新提交。')
        atomic_write_json(STATE, state)
    log(f'完成：共推送 {pushed_total} 个文件，{len(chunks)} 块。')
    LOG.write_text('\n'.join(log_lines) + '\n', encoding='utf-8')
    return 0

if __name__ == '__main__':
    sys.exit(main())
