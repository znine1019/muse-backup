#!/bin/bash
# GPT 数据包打包脚本（2026-11-18 新建，2026-11-19 起随每日备份使用）
# 内容：2026-11-17 ChatGPT 网页端额外读到的全部信息
#   - ~/memory/chatgpt-library-2026-11-17-web/ 19 个文件，约 28 MB
#     （品牌手册、核心师资名单、海报、请假截图、视频等）
#   - ChatGPT 导出索引、Meta 导出全文、迁移索引（文本，已在主包 memory.md 里也有全文）
# 不含 401 MB ChatGPT 导出原始 zip 本身：
#   该 zip 已于 2026-11-14 上传到 Google Drive「Muse 迁移备份」，
#   文件 ID 10X7v_FmxuZF708djSTpHDkf08sUBn6q8，内容不变，不每天重复上传。
#   每日邮件正文里附 Drive 链接即可。
# 本脚本只负责打包和校验，不发邮件、不上传 Drive。
# GPT 包约 28 MB，超 Gmail 25 MB 上限，所以不走邮件附件，走 Drive 上传。
set -euo pipefail

HOME_DIR="$HOME"
WORK="$HOME_DIR/workspace/migration-backup"
STAGE="$WORK/staging-gpt"
OUT_DIR="$HOME_DIR/workspace/your_files"
GPT_ZIP="$OUT_DIR/gpt-data-package.zip"
LOG="$WORK/last-gpt-build.log"
BUILD_DATE="$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M %Z')"

mkdir -p "$WORK" "$OUT_DIR"
rm -rf "$STAGE"
mkdir -p "$STAGE/chatgpt-library-2026-11-17-web"

cp "$HOME_DIR"/memory/chatgpt-library-2026-11-17-web/* "$STAGE/chatgpt-library-2026-11-17-web/" 2>/dev/null || true
cp "$HOME_DIR/memory/chatgpt-export-2026-11-12-INDEX.md" "$STAGE/" 2>/dev/null || true
cp "$HOME_DIR/memory/meta-ai-export-2026-11-17.md" "$STAGE/" 2>/dev/null || true
cp "$HOME_DIR/memory/muse-migration-2026-11-12-INDEX.md" "$STAGE/" 2>/dev/null || true

cat > "$STAGE/README-GPT-PACKAGE.md" <<'EOF'
# GPT 数据包说明

- 打包内容：2026-11-17 ChatGPT 网页端额外读到的全部信息
  - chatgpt-library-2026-11-17-web/：资料库下载的 19 个文件
  - chatgpt-export-2026-11-12-INDEX.md：ChatGPT 导出 754 个文件索引
  - meta-ai-export-2026-11-17.md：Meta 导出两个包的全部文字
  - muse-migration-2026-11-12-INDEX.md：迁移包索引
- ChatGPT 导出全文（conversations.json 29 个对话、5,427 个 mapping 节点）
  已在主包的 memory.md 里一字不改，见主包。
- ChatGPT 导出原始 zip（401124902 字节，SHA-256 fe3be29b31976e03bf2c63e358ab20843a422816ab7aea162fd51087d7ae99a9）
  不在本 zip 里，原因：Gmail 附件上限 25 MB，401 MB 无法随邮件发。
  该文件已在 Google Drive「Muse 迁移备份」文件夹：
  https://drive.google.com/file/d/10X7v_FmxuZF708djSTpHDkf08sUBn6q8/view?usp=drivesdk
  2026-11-14 上传，内容不变，不每天重复上传。
- 本 GPT 包约 28 MB，同样超 Gmail 附件上限，走 Drive 上传，邮件正文附链接。
EOF

python3 - "$STAGE" "$STAGE/MANIFEST.md" <<'PYEOF'
import hashlib, pathlib, sys
stage = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
files = []
for p in sorted(stage.rglob('*')):
    if p.is_file() and p.name != 'MANIFEST.md':
        rel = p.relative_to(stage).as_posix()
        h = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
        files.append((rel, p.stat().st_size, h))
lines = ['# GPT 数据包清单 MANIFEST', '', f'文件总数：{len(files)}（不含本清单本身）', '', '| 文件 | 大小（字节） | SHA-256 前16位 |', '|---|---|---|']
for rel, size, h in files:
    lines.append(f'| {rel} | {size} | {h} |')
out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(f'GPT 包：{len(files)} 个文件')
PYEOF

rm -f "$GPT_ZIP"
(cd "$STAGE" && zip -r -q "$GPT_ZIP" .)

python3 - "$GPT_ZIP" "$LOG" "$BUILD_DATE" <<'PYEOF'
import hashlib, pathlib, sys, zipfile
gpt_zip, log, build_date = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(gpt_zip)
z = zipfile.ZipFile(p)
files = [i for i in z.infolist() if not i.is_dir()]
total = sum(i.file_size for i in files)
sha = hashlib.sha256(p.read_bytes()).hexdigest()
lines = []
lines.append(f'重建时间：{build_date}')
lines.append(f'GPT 包：{gpt_zip}')
lines.append(f'  文件数（不含目录）：{len(files)}，解压后总大小：{total} 字节，zip 大小：{p.stat().st_size} 字节，SHA-256：{sha}')
pathlib.Path(log).write_text('\n'.join(lines) + '\n', encoding='utf-8')
print('\n'.join(lines))
PYEOF

echo "GPT REBUILD OK $BUILD_DATE"
