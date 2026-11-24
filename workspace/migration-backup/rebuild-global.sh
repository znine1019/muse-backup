#!/bin/bash
# 全局备份打包脚本（2026-11-23 新增，2026-11-24 起随每日迁移备份使用）
# 用户指令（2026-11-23 19:42）：扩大备份范围，不要放过任何一个数据细节，进行全局备份。
# 本脚本把主包/补包/GPT 包未覆盖的全部用户数据打成一个 global-backup.zip，
# 走 Google Drive 上传（远超 Gmail 25MB 上限，不走邮件附件），邮件正文附链接。
# 本脚本只负责打包和校验，不发邮件、不上传 Drive。
# 安全排除（只记路径/模式与原因，绝不写任何秘密值）：
#   - ~/.ssh/id_* 私钥、~/.aws/、~/.gnupg/、*secret*/*credential*/*.pem/*.key/.env* 文件
#   - 浏览器 profile/cookies（~/workspace/.hatch-browser/）
#   - 补包敏感源文件不复制进本包，只在清单里记文件名/大小/SHA（原件只在补包里）
#   - ChatGPT 导出目录的 741 个 .dat 二进制不重复打包（其 401MB 原始 zip 已在 Drive），
#     但导出目录全部 754 个文件在清单里逐个列大小+SHA
#   - WorkBuddy 410MB 安装包 .deb 不打包，只在清单里记文件名/大小/SHA
#   - ts-spaces 的 node_modules（可重装依赖）与 app.db*（数据库，不通过文件读取/导出）
# 失败时退出非零并删除输出 zip，不留下可误发的旧包。
set -euo pipefail

HOME_DIR="$HOME"
WORK="$HOME_DIR/workspace/migration-backup"
STAGE="$WORK/staging-global"
OUT_DIR="$HOME_DIR/workspace/your_files"
GLOBAL_ZIP="$OUT_DIR/global-backup.zip"
TMP_ZIP="$WORK/global-test.zip"
LOG="$WORK/last-global-build.log"
BUILD_DATE="$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M %Z')"

fail() { echo "错误：$1" >&2; rm -f "$TMP_ZIP" "$GLOBAL_ZIP"; exit 1; }

mkdir -p "$WORK" "$OUT_DIR"
rm -rf "$STAGE"
mkdir -p "$STAGE"

export BUILD_DATE
python3 - "$HOME_DIR" "$STAGE" <<'PYEOF' || fail "全局备份暂存复制失败"
import fnmatch, hashlib, os, pathlib, shutil, sys
home = pathlib.Path(sys.argv[1]); stage = pathlib.Path(sys.argv[2])
excluded_dynamic = []   # (path, reason) 复制过程中按模式排除的单个文件
def sha16(p):
    h = hashlib.sha256()
    with open(p,'rb') as f:
        for chunk in iter(lambda: f.read(1<<20), b''): h.update(chunk)
    return h.hexdigest()[:16]
SECRET_PATTERNS = ['*secret*','*credential*','*.pem','*.key','.env','*.env','id_rsa*','id_ed25519','id_ecdsa*','id_dsa*']
def is_secret(name):
    low = name.lower()
    return any(fnmatch.fnmatch(low, pat) for pat in SECRET_PATTERNS)
def copy_tree(src, dest_rel, skip=None):
    src = pathlib.Path(src)
    if not src.exists(): return
    for root, dirs, files in os.walk(src):
        rootp = pathlib.Path(root)
        rel_root = rootp.relative_to(src)
        # 目录级跳过
        dirs[:] = [d for d in dirs if not (skip and skip(rootp/d))]
        for fn in files:
            fp = rootp/fn
            rel = (pathlib.Path(dest_rel)/rel_root/fn).as_posix()
            if is_secret(fn):
                excluded_dynamic.append((str(fp), '文件名匹配秘密/凭证模式')); continue
            if skip and skip(fp): continue
            if not fp.is_file() or fp.is_symlink():
                excluded_dynamic.append((str(fp), '非常规文件（socket/fifo/符号链接），无法打包')); continue
            dst = stage/rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(fp, dst)
            except OSError:
                excluded_dynamic.append((str(fp), '复制失败（系统文件/无设备）'))
def copy_file(src, dest_rel):
    src = pathlib.Path(src)
    if not src.exists() or not src.is_file(): return
    if is_secret(src.name):
        excluded_dynamic.append((str(src), '文件名匹配秘密/凭证模式')); return
    dst = stage/dest_rel; dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

SENSITIVE_NAME = 'Muse________2026-11-12.md'
# 1) ~/memory/ 递归全部（跳过导出目录 .dat 与敏感源文件本体，后者在清单记名/大小/SHA）
export_dir = home/'memory/chatgpt-export-2026-11-12'
def memory_skip(p):
    if p.parent == export_dir and p.suffix == '.dat': return True
    if p.name == SENSITIVE_NAME: return True
    return False
copy_tree(home/'memory', 'memory', skip=memory_skip)
# 2) ~/side-chats/：磁盘上不存在该目录（旁聊数据只在应用数据库里），存在才复制
copy_tree(home/'side-chats', 'side-chats')
# 3) ~/workspace/goals/ 递归全部（live）；但 goals/goal-2/files/ 里放的是五个备份 zip 的副本（备份产物），同 your_files 一样排除，防递归
BACKUP_ZIPS = {'muse-migration-2026-11-12.zip','muse-migration-2026-11-12-supplement.zip','gpt-data-package.zip','global-backup.zip','non-github-data.zip'}
def goals_skip(p):
    return p.name in BACKUP_ZIPS and 'goal-2' in p.parts and 'files' in p.parts
copy_tree(home/'workspace/goals', 'workspace/goals', skip=goals_skip)
# 4) ~/workspace/your_files/ 排除备份 zip 本身（防递归/重复）
copy_tree(home/'workspace/your_files', 'workspace/your_files', skip=lambda p: p.name in BACKUP_ZIPS)
# 5) 其他 workspace 用户数据区（递归）
for sub in ['user','custom-skills','custom-connectors','meta_exports','feed','space_data','space-versions',
            'avatars','browser_downloads','email','muse_migration','finance-training','qiaoge-promo',
            'imagine_media','kailas-ref','visual_grounding','onboarding_tour','proactivity','objectives',
            'cron.d','gmail-friend-watch','memory','voice','voices','self_improvement']:
    copy_tree(home/'workspace'/sub, f'workspace/{sub}')
# ts-spaces：跳过 node_modules 与 app.db*（数据库不通过文件导出）
def ts_skip(p):
    if 'node_modules' in p.parts: return True
    if p.name.startswith('app.db'): return True
    return False
copy_tree(home/'workspace/ts-spaces', 'workspace/ts-spaces', skip=ts_skip)
# workbuddy：只复制小文件（脚本/截图/小工具包清单级），跳过 410MB 安装包 .deb 本体
copy_tree(home/'workspace/workbuddy', 'workspace/workbuddy',
          skip=lambda p: p.suffix == '.deb' and p.stat().st_size > 10_000_000)
# 6) migration-backup 脚本与日志
mb = home/'workspace/migration-backup'
if mb.exists():
    for f in mb.iterdir():
        if f.is_file() and (f.suffix == '.sh' or f.suffix == '.log'):
            copy_file(f, f'workspace/migration-backup/{f.name}')
# 7) ~/dreams/、~/config/、~/user/（根级用户数据）
copy_tree(home/'dreams', 'dreams')
copy_tree(home/'config', 'config')
copy_tree(home/'user', 'user-home')
# 8) 根级文本文件（主包 root/ 已含 7 个，这里补齐其余）
for fn in ['AGENTS.md','SOUL.md','IDENTITY.md','USER.md','MEMORY.md','PROACTIVE_PREFERENCES.md','TOOLS.md','HEARTBEAT.md']:
    copy_file(home/fn, f'root/{fn}')
# SSH 公钥（私钥排除）
copy_file(home/'.ssh/id_ed25519.pub', 'root-dotfiles/.ssh/id_ed25519.pub')

# ---- 清单 GLOBAL-MANIFEST.md ----
files = []
for p in sorted(stage.rglob('*')):
    if p.is_file():
        rel = p.relative_to(stage).as_posix()
        files.append((rel, p.stat().st_size, sha16(p)))
lines = ['# 全局备份清单 GLOBAL-MANIFEST', '', f'打包时间：{os.environ.get("BUILD_DATE","")}', '用户：周才翔，助手：Muse', f'文件总数：{len(files)}（不含本清单本身）', '',
         '| 文件 | 大小（字节） | SHA-256 前16位 |', '|---|---|---|']
for rel, size, h in files: lines.append(f'| {rel} | {size} | {h} |')
# ChatGPT 导出目录完整清单（754 个文件逐个列名/大小/SHA；.dat 本体由 Drive 原始 zip 覆盖）
lines += ['', '## ChatGPT 导出目录完整清单（本体覆盖说明见排除节）', '', '| 文件 | 大小（字节） | SHA-256 前16位 |', '|---|---|---|']
if export_dir.exists():
    for p in sorted(export_dir.rglob('*')):
        if p.is_file():
            lines.append(f'| memory/chatgpt-export-2026-11-12/{p.relative_to(export_dir).as_posix()} | {p.stat().st_size} | {sha16(p)} |')
# 排除节
wb_installer = home/'workspace/workbuddy/WorkBuddy-linux-x64-deb-5.6.2.40046327-c7b525f3.deb'
sens = home/'memory/muse-migration-2026-11-12-supplement/sensitive-source'/SENSITIVE_NAME
lines += ['', '## 排除项（EXCLUDED，只记路径/模式、大小、哈希与原因，不含任何秘密值）', '']
lines.append(f'- WorkBuddy 安装包（只记名/大小/SHA，不打包）：workspace/workbuddy/{wb_installer.name} | {wb_installer.stat().st_size if wb_installer.exists() else 0} 字节 | SHA-256 前16位 {sha16(wb_installer) if wb_installer.exists() else "missing"} | 原因：410MB 官方安装包二进制，可从官方重下')
if sens.exists():
    lines.append(f'- 补包敏感源文件（不复制进本包，只记名/大小/SHA）：memory/muse-migration-2026-11-12-supplement/sensitive-source/{SENSITIVE_NAME} | {sens.stat().st_size} 字节 | SHA-256 前16位 {sha16(sens)} | 原因：含敏感号码值，只随补包发往 QQ 邮箱')
lines += [
 '- ChatGPT 导出目录 741 个 file_*.dat 二进制：不重复打包 | 原因：其原始 zip（401124902 字节，SHA-256 fe3be29b31976e03b）已在 Google Drive「Muse 迁移备份」（文件 ID 10X7v_FmxuZF708djSTpHDkf08sUBn6q8）；导出目录其余 13 个文本文件已在本包 memory/ 内，全部 754 个文件清单见上一节',
 '- ~/.ssh/id_ed25519（私钥）：排除 | 原因：私钥/凭证，绝不进备份包（.pub 公钥已收）',
 '- ~/.aws/、~/.gnupg/：本机不存在，模式排除 | 原因：凭证目录',
 '- 文件名匹配 *secret*/*credential*/*.pem/*.key/.env* 模式的文件：排除 | 原因：秘密/凭证',
 '- ~/workspace/.hatch-browser/（871 个文件，约 76MB）：排除 | 原因：浏览器 profile/cookies',
 '- ~/workspace/ts-spaces/*/node_modules/（约 266MB）：排除 | 原因：可重装的依赖包；源码已收',
 '- ~/workspace/ts-spaces/*/app.db、app.db-shm、app.db-wal 等数据库文件：不通过文件复制 | 原因：Spaces 记录数据在 app.db 数据库内，不能用文件方式导出，需用空间工具单独导出',
 '- ~/workspace/chatgpt_export_full/（401MB 原始 zip 本地副本）：排除 | 原因：与 Drive 上同一文件重复（SHA 已核对一致）',
 '- ~/workspace/your_files/ 与 ~/workspace/goals/goal-2/files/ 内的五个备份 zip 本身：排除 | 原因：防递归/重复（它们是备份产物；2026-11-24 修复：此前 goal-2/files/ 的旧副本曾被误收进全局包，致其膨胀至 561MB；2026-11-25 补 fix：新增的非 GitHub 数据包 non-github-data.zip 同为备份产物，亦排除，否则全局包再膨胀 620MB）',
 '- ~/.workbuddy/（约 278MB）、~/.cache/、~/.venv-html-to-docx/、~/.local/、~/.config/、~/.codebuddy/、~/.pki/、~/.sheetagent/：排除 | 原因：应用运行时/缓存，可能含登录态',
 '- ~/agents/（约 273MB）、~/assets/、~/docs/（系统文档）、~/hooks/、~/subscriptions/、~/workspace/agents/、~/workspace/system/、~/workspace/.content-migrations/、~/workspace/.hatch-browser/：排除 | 原因：Muse 运行时/系统文件，非用户数据',
 '- ~/side-chats/：磁盘上不存在该目录 | 原因：旁聊数据只在应用数据库里，无法通过文件备份（存包中的 side-chats/README.md 已在主包与本包 memory/muse-migration-2026-11-12/ 内）',
]
for path, reason in excluded_dynamic:
    lines.append(f'- {path}：排除 | 原因：{reason}')
(stage/'GLOBAL-MANIFEST.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')
print(f'全局包暂存：{len(files)} 个文件（不含清单本身）')
PYEOF

rm -f "$TMP_ZIP"
(cd "$STAGE" && zip -r -q "$TMP_ZIP" .) || fail "全局备份 zip 打包失败"

python3 - "$TMP_ZIP" "$LOG" "$BUILD_DATE" <<'PYEOF' || fail "全局备份校验失败"
import hashlib, pathlib, sys, zipfile
tmp_zip, log, build_date = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(tmp_zip)
z = zipfile.ZipFile(p)
bad = z.testzip()
if bad is not None:
    print(f'错误：zip 损坏，首个坏文件 {bad}', file=sys.stderr); sys.exit(1)
files = [i for i in z.infolist() if not i.is_dir()]
total = sum(i.file_size for i in files)
sha = hashlib.sha256(p.read_bytes()).hexdigest()
lines = [f'重建时间：{build_date}', f'全局包：{p}',
         f'  文件数（不含目录）：{len(files)}，解压后总大小：{total} 字节，zip 大小：{p.stat().st_size} 字节，SHA-256：{sha}',
         '  发送方式：Drive 上传（超 Gmail 25MB 上限，不走邮件附件）']
pathlib.Path(log).write_text('\n'.join(lines)+'\n', encoding='utf-8')
print('\n'.join(lines))
PYEOF

rm -f "$GLOBAL_ZIP"
mv "$TMP_ZIP" "$GLOBAL_ZIP"
echo "GLOBAL REBUILD OK $BUILD_DATE"
