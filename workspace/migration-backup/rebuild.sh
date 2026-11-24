#!/bin/bash
# 每日迁移备份重打包脚本（新号重建，2026-11-17）
# 正常工作流程：每天约 08:18 重建主包 + 补包两个 zip，
# 用 Gmail 从 caixiangzhou9@gmail.com 发到 3282446722@qq.com，
# 在“迁移备份每日汇报”旁聊汇报。
# 本脚本只负责重打包和校验，不发邮件、不建定时任务。
# 补包里的敏感源文件只随 zip 发往 QQ 邮箱，绝不在聊天、日志或摘要里写出其内容。
# ChatGPT 401MB 原始 zip 不进每日备份（Gmail 25MB 上限）。
# 重建失败时退出非零，不产生可发的旧包。
set -euo pipefail

HOME_DIR="$HOME"
SRC_MAIN="$HOME_DIR/memory/muse-migration-2026-11-12"
SRC_SUPP="$HOME_DIR/memory/muse-migration-2026-11-12-supplement"
WORK="$HOME_DIR/workspace/migration-backup"
STAGE_MAIN="$WORK/staging-main"
STAGE_SUPP="$WORK/staging-supplement"
OUT_DIR="$HOME_DIR/workspace/your_files"
MAIN_ZIP="$OUT_DIR/muse-migration-2026-11-12.zip"
SUPP_ZIP="$OUT_DIR/muse-migration-2026-11-12-supplement.zip"
LOG="$WORK/last-build.log"
# Gmail 附件上限 25MB，取保守值 25,000,000 字节
GMAIL_LIMIT=25000000
BUILD_DATE="$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M %Z')"

mkdir -p "$WORK" "$OUT_DIR"
rm -rf "$STAGE_MAIN" "$STAGE_SUPP"
mkdir -p "$STAGE_MAIN" "$STAGE_SUPP"

# 生成 MANIFEST.md：$1=staging 目录，$2=标题，$3=输出路径，$4=尾注
gen_manifest() {
  python3 - "$1" "$2" "$3" "$4" <<'PYEOF'
import hashlib, pathlib, sys
stage = pathlib.Path(sys.argv[1])
title = sys.argv[2]
out = pathlib.Path(sys.argv[3])
footer = sys.argv[4]
files = []
for p in sorted(stage.rglob('*')):
    if p.is_file() and p.name != 'MANIFEST.md':
        rel = p.relative_to(stage).as_posix()
        h = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
        files.append((rel, p.stat().st_size, h))
lines = []
lines.append(f'# {title}')
lines.append('')
lines.append('打包时间：见 zip 文件时间（每日重建）')
lines.append('用户：周才翔（Kenneth），助手：芬奇')
lines.append(f'文件总数：{len(files)}（不含本清单本身）')
lines.append('')
lines.append('| 文件 | 大小（字节） | SHA-256 前16位 |')
lines.append('|---|---|---|')
for rel, size, h in files:
    lines.append(f'| {rel} | {size} | {h} |')
lines.append('')
lines.append(footer)
out.write_text('\n'.join(lines), encoding='utf-8')
print(f'{title}：{len(files)} 个文件')
PYEOF
}

# ---------- 主包 ----------
# IMPORT.md：沿用存包版本（原样）
cp "$SRC_MAIN/IMPORT.md" "$STAGE_MAIN/IMPORT.md"
# root/：当前 live 文件
mkdir -p "$STAGE_MAIN/root"
for f in AGENTS.md SOUL.md IDENTITY.md USER.md MEMORY.md PROACTIVE_PREFERENCES.md TOOLS.md; do
  cp "$HOME_DIR/$f" "$STAGE_MAIN/root/$f"
done
# memory/ 顶层：当前 live 的 ~/memory/*.md（仅顶层，不递归）
#   + 存包里的 2026-11-12 至 2026-11-16 每日笔记与 ChatGPT 分册
# 注意：~/memory/ 下的 muse-migration-*/、chatgpt-export-*/ 子目录绝不递归复制
mkdir -p "$STAGE_MAIN/memory"
cp "$HOME_DIR"/memory/*.md "$STAGE_MAIN/memory/"
cp "$SRC_MAIN"/memory/*.md "$STAGE_MAIN/memory/"
# memory/bank、people、groups：当前 live 版本
cp -r "$HOME_DIR/memory/bank" "$STAGE_MAIN/memory/bank"
cp -r "$HOME_DIR/memory/people" "$STAGE_MAIN/memory/people"
cp -r "$HOME_DIR/memory/groups" "$STAGE_MAIN/memory/groups"
# goals、feed、side-chats：存包版本（本号暂无 live 版本）
mkdir -p "$STAGE_MAIN/goals/goal/crons/hourly" "$STAGE_MAIN/feed" "$STAGE_MAIN/side-chats"
cp "$SRC_MAIN/goals/goal/GOAL.md" "$STAGE_MAIN/goals/goal/GOAL.md"
cp "$SRC_MAIN/goals/goal/goal-state.json" "$STAGE_MAIN/goals/goal/goal-state.json"
cp "$SRC_MAIN/goals/goal/crons/hourly/gongzhonghao-every-3-days__interval@96h.md" "$STAGE_MAIN/goals/goal/crons/hourly/"
cp "$SRC_MAIN/feed/feed-prompt.md" "$STAGE_MAIN/feed/feed-prompt.md"
cp "$SRC_MAIN/side-chats/README.md" "$STAGE_MAIN/side-chats/README.md"
# goals-live（2026-11-23 全局备份扩围新增）：live 的 GOAL.md 与 crons 定义（仅小文本，不含 files/hidden_files 大文件）
# 以及 workspace/cron.d 的全部定时任务定义副本；side-chats 在磁盘上无 live 目录，仍沿用存包版本。
mkdir -p "$STAGE_MAIN/goals-live" "$STAGE_MAIN/cron.d"
if [ -d "$HOME_DIR/workspace/goals" ]; then
  (cd "$HOME_DIR/workspace/goals" && find . -name 'GOAL.md' -o -path '*/crons/*' -name '*.md' | while read -r f; do
    mkdir -p "$STAGE_MAIN/goals-live/$(dirname "$f")"
    cp "$HOME_DIR/workspace/goals/$f" "$STAGE_MAIN/goals-live/$f"
  done)
fi
if [ -d "$HOME_DIR/workspace/cron.d" ]; then
  cp "$HOME_DIR"/workspace/cron.d/*.md "$STAGE_MAIN/cron.d/" 2>/dev/null || true
fi

# 生成主包 MANIFEST（含 memory.md，先试算）
gen_manifest "$STAGE_MAIN" "清单 MANIFEST" "$STAGE_MAIN/MANIFEST.md" "导入方法见 IMPORT.md。"
# 先打到临时 zip 试算大小（memory.md 38MB，若超 Gmail 上限则去掉它重建）
TMP_MAIN="$WORK/main-test.zip"
rm -f "$TMP_MAIN"
(cd "$STAGE_MAIN" && zip -r -q "$TMP_MAIN" .)
MAIN_SIZE=$(stat -c %s "$TMP_MAIN")
MEMORY_INCLUDED="yes"
if [ "$MAIN_SIZE" -gt "$GMAIL_LIMIT" ]; then
  rm -f "$STAGE_MAIN/memory/memory.md"
  gen_manifest "$STAGE_MAIN" "清单 MANIFEST" "$STAGE_MAIN/MANIFEST.md" "导入方法见 IMPORT.md。"
  rm -f "$TMP_MAIN"
  (cd "$STAGE_MAIN" && zip -r -q "$TMP_MAIN" .)
  MAIN_SIZE=$(stat -c %s "$TMP_MAIN")
  MEMORY_INCLUDED="no"
fi
if [ "$MAIN_SIZE" -gt "$GMAIL_LIMIT" ]; then
  echo "错误：去掉 memory.md 后主包仍超 Gmail 上限（$MAIN_SIZE > $GMAIL_LIMIT），不生成可发包" >&2
  rm -f "$TMP_MAIN"
  exit 1
fi
rm -f "$MAIN_ZIP"
mv "$TMP_MAIN" "$MAIN_ZIP"

# ---------- 补包 ----------
# 除 MANIFEST.md 外全部原样复制（敏感源文件随 zip 发往 QQ 邮箱，不在日志/聊天写内容）
cp -r "$SRC_SUPP/." "$STAGE_SUPP/"
rm -f "$STAGE_SUPP/MANIFEST.md"
gen_manifest "$STAGE_SUPP" "补包清单 MANIFEST" "$STAGE_SUPP/MANIFEST.md" "导入方法见 SUPPLEMENT-IMPORT.md，先导入第一个迁移包，再处理本包。"
rm -f "$SUPP_ZIP"
(cd "$STAGE_SUPP" && zip -r -q "$SUPP_ZIP" .)

# ---------- 校验并写日志（只记文件名、数量、大小、哈希，不写任何文件内容） ----------
python3 - "$MAIN_ZIP" "$SUPP_ZIP" "$LOG" "$BUILD_DATE" "$MEMORY_INCLUDED" "$GMAIL_LIMIT" <<'PYEOF'
import hashlib, pathlib, sys, zipfile
main_zip, supp_zip, log, build_date, mem_included = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
limit = int(sys.argv[6])
def info(path):
    p = pathlib.Path(path)
    z = zipfile.ZipFile(p)
    files = [i for i in z.infolist() if not i.is_dir()]
    total = sum(i.file_size for i in files)
    sha = hashlib.sha256(p.read_bytes()).hexdigest()
    return len(files), total, p.stat().st_size, sha
m_count, m_uncomp, m_size, m_sha = info(main_zip)
s_count, s_uncomp, s_size, s_sha = info(supp_zip)
lines = []
lines.append(f'重建时间：{build_date}')
lines.append(f'主包：{main_zip}')
lines.append(f'  文件数（不含目录）：{m_count}，解压后总大小：{m_uncomp} 字节，zip 大小：{m_size} 字节，SHA-256：{m_sha}')
lines.append(f'  memory.md 是否包含：{mem_included}，Gmail 上限（{limit} 字节）是否满足：{m_size <= limit}')
lines.append(f'补包：{supp_zip}')
lines.append(f'  文件数（不含目录）：{s_count}，解压后总大小：{s_uncomp} 字节，zip 大小：{s_size} 字节，SHA-256：{s_sha}')
lines.append(f'  Gmail 上限（{limit} 字节）是否满足：{s_size <= limit}')
pathlib.Path(log).write_text('\n'.join(lines) + '\n', encoding='utf-8')
print('\n'.join(lines))
if m_size > limit or s_size > limit:
    sys.exit(1)
PYEOF

echo "REBUILD OK $BUILD_DATE"
