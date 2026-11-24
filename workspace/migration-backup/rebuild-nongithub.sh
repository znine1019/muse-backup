#!/bin/bash
# 非 GitHub 数据包打包脚本（2026-11-24 新增，随每日迁移备份使用）
# 用户指令（2026-11-24）：GitHub 仓库没收的三类数据单独打一个包随每日邮件交付，并标注清楚；
# 每日邮件正文要把每个包里是什么写清楚、一目了然。
# 本包（non-github-data.zip）收录 GitHub 私有仓库 znine1019/muse-backup 没收的三类数据：
#   1-binaries/        二进制文件：全局包暂存（staging-global）里的全部非 UTF-8 文本文件，
#                      外加 ChatGPT 导出目录的 741 个 .dat（不在全局包暂存里，从 live 目录收）。
#                      node_modules、浏览器 profile、WorkBuddy 安装包 .deb、四个备份 zip、
#                      秘密/凭证模式文件本来就不在全局包里，同样不进本包。
#   2-sensitive/       补包敏感源文件原件（staging-supplement/sensitive-source/ 里的 .md）。
#                      它每天已随补包附件发送，用户 2026-11-24 明确要求也进本包；
#                      本包只走 Drive 链接 + 每日邮件正文标注，绝不进 GitHub、绝不进全局包。
#   3-space-databases/ 两个空间 app.db 的快照（sqlite3 .backup，无 sqlite3 时 cp）。
# 旁聊内容只在应用数据库中、无文件形态，本包不含（任何文件备份都不含），只在标注里写明。
# 交付方式：zip 远超 Gmail 25MB 上限，不走邮件附件；每日任务仅当内容有变化（CHANGED=1）时
# 才上传 Drive「Muse 迁移备份」文件夹，邮件正文附链接，CHANGED=0 时沿用旧链接不重复上传。
# 本脚本只负责打包和校验，不发邮件、不上传 Drive。
# 失败时退出非零并删除输出 zip，不留下可误发的旧包。
set -euo pipefail

HOME_DIR="$HOME"
WORK="$HOME_DIR/workspace/migration-backup"
STAGE="$WORK/staging-nongithub"
STAGE_GLOBAL="$WORK/staging-global"
STAGE_SUPPLEMENT="$WORK/staging-supplement"
EXPORT_DIR="$HOME_DIR/memory/chatgpt-export-2026-11-12"
OUT_DIR="$HOME_DIR/workspace/your_files"
OUT_ZIP="$OUT_DIR/non-github-data.zip"
TMP_ZIP="$WORK/non-github-test.zip"
LOG="$WORK/last-nongithub-build.log"
HASH_FILE="$WORK/non-github-content-hash.txt"
STATS="$WORK/non-github-stats.txt"
BUILD_DATE="$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M %Z')"

fail() { echo "错误：$1" >&2; rm -f "$TMP_ZIP" "$OUT_ZIP"; exit 1; }

mkdir -p "$WORK" "$OUT_DIR"
rm -rf "$STAGE"
mkdir -p "$STAGE"
[ -d "$STAGE_GLOBAL" ] || fail "staging-global 不存在，需先运行 rebuild-global.sh"

export BUILD_DATE
python3 - "$HOME_DIR" "$WORK" "$STAGE" "$STAGE_GLOBAL" "$STAGE_SUPPLEMENT" "$EXPORT_DIR" "$HASH_FILE" "$STATS" <<'PYEOF' || fail "非 GitHub 数据包暂存失败"
import codecs, hashlib, os, pathlib, shutil, subprocess, sys
home, work, stage, stage_global, stage_supplement, export_dir, hash_file, stats_file = (
    pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]),
    pathlib.Path(sys.argv[4]), pathlib.Path(sys.argv[5]), pathlib.Path(sys.argv[6]),
    pathlib.Path(sys.argv[7]), pathlib.Path(sys.argv[8]))

def sha256_full(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()

def is_text_file(p):
    # 与 sync-github.sh 同一口径：严格 UTF-8 解码通过且不含 NUL 字节
    dec = codecs.getincrementaldecoder('utf-8')()
    try:
        with open(p, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                if b'\x00' in chunk: return False
                dec.decode(chunk)
            dec.decode(b'', final=True)
    except (UnicodeDecodeError, OSError):
        return False
    return True

collected = []  # (zip 内相对路径, 大小, 完整 SHA-256, 类别)
def collect(src, rel, cat):
    dst = stage / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    collected.append((rel, dst.stat().st_size, sha256_full(dst), cat))

# ---- 类别 1：二进制文件 ----
# 1a) staging-global 里的全部非 UTF-8 文本文件，保留其在全局包中的相对路径
bin_count_g, bin_bytes_g = 0, 0
for root, dirs, files in os.walk(stage_global):
    dirs.sort()
    for fn in sorted(files):
        fp = pathlib.Path(root) / fn
        if fp.is_symlink() or not fp.is_file(): continue
        if is_text_file(fp): continue
        rel = fp.relative_to(stage_global).as_posix()
        collect(fp, f'1-binaries/{rel}', 'binaries')
        bin_count_g += 1; bin_bytes_g += fp.stat().st_size
# 1b) ChatGPT 导出目录的 741 个 .dat（从 live 目录收，相对路径同全局包清单口径）
bin_count_d, bin_bytes_d = 0, 0
if export_dir.exists():
    for fp in sorted(export_dir.glob('*.dat')):
        if not fp.is_file(): continue
        collect(fp, f'1-binaries/memory/chatgpt-export-2026-11-12/{fp.name}', 'binaries')
        bin_count_d += 1; bin_bytes_d += fp.stat().st_size
bin_count, bin_bytes = bin_count_g + bin_count_d, bin_bytes_g + bin_bytes_d

# ---- 类别 2：补包敏感源文件（原样复制） ----
sens_count, sens_bytes = 0, 0
sens_dir = stage_supplement / 'sensitive-source'
if sens_dir.exists():
    for fp in sorted(sens_dir.iterdir()):
        if fp.is_file():
            collect(fp, f'2-sensitive/{fp.name}', 'sensitive')
            sens_count += 1; sens_bytes += fp.stat().st_size

# ---- 类别 3：空间 app.db 快照（sqlite3 .backup 优先，没有就 cp） ----
SPACES = [('qiao-ge-xun-ji-xi-tong', '乔格训迹系统'),
          ('ip-chun-jing-du-jian-ce', 'IP 纯净度检测')]
db_count, db_bytes = 0, 0
have_sqlite3 = shutil.which('sqlite3') is not None
for slug, _name in SPACES:
    src = home / 'workspace/ts-spaces' / slug / 'app.db'
    if not src.exists(): continue
    rel = f'3-space-databases/{slug}-app.db'
    dst = stage / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    ok = False
    if have_sqlite3:
        r = subprocess.run(['sqlite3', str(src), f'.backup {dst}'], capture_output=True)
        ok = (r.returncode == 0 and dst.exists())
    if not ok:
        shutil.copy2(src, dst)
    collected.append((rel, dst.stat().st_size, sha256_full(dst), 'databases'))
    db_count += 1; db_bytes += dst.stat().st_size

total_count = bin_count + sens_count + db_count
total_bytes = bin_bytes + sens_bytes + db_bytes

# ---- 内容总哈希（对全部收录文件按 路径/大小/完整 SHA-256 排序计算） ----
entries = sorted((rel, size, sha) for rel, size, sha, _cat in collected)
h = hashlib.sha256()
for rel, size, sha in entries:
    h.update(f'{rel}|{size}|{sha}\n'.encode('utf-8'))
content_hash = h.hexdigest()
prev = hash_file.read_text(encoding='utf-8').strip() if hash_file.exists() else ''
changed = 0 if prev == content_hash else 1
hash_file.write_text(content_hash + '\n', encoding='utf-8')

# ---- NON-GITHUB-MANIFEST.md（根目录，逐个文件列路径/大小/SHA 前16位） ----
build_date = os.environ.get('BUILD_DATE', '')
lines = ['# 非 GitHub 数据包清单 NON-GITHUB-MANIFEST', '', f'打包时间：{build_date}',
         '用户：周才翔，助手：Muse',
         f'文件总数：{total_count}（不含 README-标注.md 与本清单本身），总大小：{total_bytes} 字节',
         f'内容总哈希（路径|大小|完整SHA-256 排序后计算）：{content_hash}，CHANGED={changed}',
         '', '| 文件 | 大小（字节） | SHA-256 前16位 |', '|---|---|---|']
for rel, size, sha in entries:
    lines.append(f'| {rel} | {size} | {sha[:16]} |')
(stage / 'NON-GITHUB-MANIFEST.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')

# ---- README-标注.md（根目录，三类各一节 + 旁聊说明行） ----
readme = ['# 非 GitHub 数据包（non-github-data.zip）标注', '',
          f'打包时间：{build_date}',
          '本包收录 GitHub 私有仓库 znine1019/muse-backup 没收的三类数据，每天随迁移备份邮件以 Drive 链接交付（包太大，不做邮件附件）；内容无变化时不重复上传 Drive，沿用旧链接。',
          '',
          '## 1. 二进制文件（1-binaries/）',
          f'- 是什么：全局备份范围内的二进制文件（图片、音频、视频、文档等非文本文件），GitHub 同步只收 UTF-8 文本，这类文件进不了仓库；含两部分：全局包暂存里的二进制 {bin_count_g} 个、{bin_bytes_g} 字节；ChatGPT 导出目录的 .dat 附件 {bin_count_d} 个、{bin_bytes_d} 字节。',
          f'- 文件数：{bin_count}，总字节：{bin_bytes}',
          '- 还存在于哪里：全局包暂存部分同时在全局包 global-backup.zip（Drive）里；.dat 部分同时在 ChatGPT 导出原始 zip（Drive，401124902 字节）和本地 ~/memory/chatgpt-export-2026-11-12/ 里。',
          '',
          '## 2. 补包敏感源文件（2-sensitive/）',
          '- 是什么：补包里的敏感源文件原件（含号码类敏感值），GitHub 与全局包都永不收录，只随每日补包发送；用户 2026-11-24 明确要求也打进本包集中存放。',
          f'- 文件数：{sens_count}，总字节：{sens_bytes}',
          '- 还存在于哪里：每日备份邮件的补包附件里（同一文件），以及本地 ~/memory/muse-migration-2026-11-12-supplement/sensitive-source/。',
          '',
          '## 3. 空间数据库快照（3-space-databases/）',
          '- 是什么：两个空间（乔格训迹系统、IP 纯净度检测）的 app.db 数据库快照；空间的记录数据存在各自 app.db 里，全局包和 GitHub 都不收数据库文件，这里单独快照保存。',
          f'- 文件数：{db_count}，总字节：{db_bytes}',
          '- 还存在于哪里：原件在本地 ~/workspace/ts-spaces/<空间>/app.db（每日实时变化，本包为打包时刻的快照）。',
          '',
          '## 特别说明',
          '- 旁聊内容只在应用数据库中、无文件形态，本包不含（任何文件备份都不含）。',
          '- 私钥、凭证、浏览器 profile、node_modules、WorkBuddy 安装包、四个备份 zip 本身不进本包（与全局包同一排除口径），只在全局包清单里记名/大小/哈希。',
          '- 逐个文件的大小与 SHA-256 前16位见同包 NON-GITHUB-MANIFEST.md。']
(stage / 'README-标注.md').write_text('\n'.join(readme) + '\n', encoding='utf-8')

stats = [f'BIN_COUNT={bin_count}', f'BIN_BYTES={bin_bytes}',
         f'BIN_GLOBAL_COUNT={bin_count_g}', f'BIN_GLOBAL_BYTES={bin_bytes_g}',
         f'BIN_DAT_COUNT={bin_count_d}', f'BIN_DAT_BYTES={bin_bytes_d}',
         f'SENS_COUNT={sens_count}', f'SENS_BYTES={sens_bytes}',
         f'DB_COUNT={db_count}', f'DB_BYTES={db_bytes}',
         f'TOTAL_COUNT={total_count}', f'TOTAL_BYTES={total_bytes}',
         f'CONTENT_HASH={content_hash}', f'CHANGED={changed}']
stats_file.write_text('\n'.join(stats) + '\n', encoding='utf-8')
print(f'非 GitHub 数据包暂存：二进制 {bin_count} 个/{bin_bytes} 字节（全局暂存 {bin_count_g} + .dat {bin_count_d}），'
      f'敏感源 {sens_count} 个/{sens_bytes} 字节，空间库 {db_count} 个/{db_bytes} 字节，'
      f'合计 {total_count} 个文件，CHANGED={changed}')
PYEOF

rm -f "$TMP_ZIP"
# 用 python zipfile 打包（不用 zip 命令行）：zip 命令行不给中文文件名置 UTF-8 标志，
# 解压时会乱码（README-标注.md 是本包的脸面，名字必须正确显示）；逻辑与全局包一致，先打临时包校验后再转正。
python3 - "$STAGE" "$TMP_ZIP" <<'PYEOF' || fail "非 GitHub 数据包 zip 打包失败"
import os, pathlib, sys, zipfile
stage, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(stage):
        dirs.sort()
        for fn in sorted(files):
            fp = pathlib.Path(root) / fn
            z.write(fp, fp.relative_to(stage).as_posix())
print(f'zip 写入完成：{out}')
PYEOF

python3 - "$TMP_ZIP" "$LOG" "$BUILD_DATE" "$STATS" <<'PYEOF' || fail "非 GitHub 数据包校验失败"
import hashlib, pathlib, sys, zipfile
tmp_zip, log, build_date, stats_file = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
p = pathlib.Path(tmp_zip)
z = zipfile.ZipFile(p)
bad = z.testzip()
if bad is not None:
    print(f'错误：zip 损坏，首个坏文件 {bad}', file=sys.stderr); sys.exit(1)
files = [i for i in z.infolist() if not i.is_dir()]
total = sum(i.file_size for i in files)
sha = hashlib.sha256(p.read_bytes()).hexdigest()
st = dict(l.split('=', 1) for l in pathlib.Path(stats_file).read_text(encoding='utf-8').strip().split('\n'))
lines = [f'重建时间：{build_date}', f'非 GitHub 数据包：{p}',
         f'  类别1 二进制：{st["BIN_COUNT"]} 个文件，{st["BIN_BYTES"]} 字节（其中全局包暂存 {st["BIN_GLOBAL_COUNT"]} 个，ChatGPT 导出 .dat {st["BIN_DAT_COUNT"]} 个/{st["BIN_DAT_BYTES"]} 字节）',
         f'  类别2 补包敏感源文件：{st["SENS_COUNT"]} 个文件，{st["SENS_BYTES"]} 字节',
         f'  类别3 空间 app.db 快照：{st["DB_COUNT"]} 个文件，{st["DB_BYTES"]} 字节',
         f'  收录合计：{st["TOTAL_COUNT"]} 个文件，{st["TOTAL_BYTES"]} 字节（另含 README-标注.md 与 NON-GITHUB-MANIFEST.md）',
         f'  zip 内文件数（不含目录）：{len(files)}，解压后总大小：{total} 字节，zip 大小：{p.stat().st_size} 字节，SHA-256 前16位：{sha[:16]}',
         f'  内容总哈希：{st["CONTENT_HASH"]}，CHANGED={st["CHANGED"]}（1=内容有变化，每日任务需上传 Drive；0=无变化，沿用旧链接）',
         '  发送方式：Drive 上传（超 Gmail 25MB 上限，不走邮件附件），仅 CHANGED=1 时上传']
pathlib.Path(log).write_text('\n'.join(lines) + '\n', encoding='utf-8')
print('\n'.join(lines))
PYEOF

rm -f "$OUT_ZIP"
mv "$TMP_ZIP" "$OUT_ZIP"
CHANGED="$(grep '^CHANGED=' "$STATS" | cut -d= -f2)"
echo "NON-GITHUB REBUILD OK $BUILD_DATE CHANGED=$CHANGED"
