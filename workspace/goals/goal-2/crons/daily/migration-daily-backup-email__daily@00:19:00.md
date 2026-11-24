---
id: migration-daily-backup-email
title: 迁移包每日备份
enabled: true
owner: goal:goal-2
mode: task
schedule:
  kind: daily
  timezone: Asia/Shanghai
  time: 00:19:00
delivery:
  - chat_id: f49737aa-987f-4a03-a1a4-15124953221c
metadata:
  tags: [cron:exact-time]
  predicted_connector_permissions:
  - connector: gmail
    method: users.messages.send
  originating_chat_context_json: '{"chat_id":"f49737aa-987f-4a03-a1a4-15124953221c","origin_provider":"main","chat_kind":"direct","event_kind":"message","require_mention":false,"device_id":"0617389a-3235-4f2c-9268-aea2e57a379f"}'
  presentation_locale: zh-CN
---
每日迁移备份，按正常工作流程执行（2026-11-24 起，每天 00:19，全局备份：含 GPT 数据包、ChatGPT 导出目录、全局包和非 GitHub 数据包）：

1. 运行 ~/workspace/migration-backup/rebuild.sh，重新打包主包和补包两个 zip 到 ~/workspace/your_files/muse-migration-2026-11-12.zip 和 ~/workspace/your_files/muse-migration-2026-11-12-supplement.zip，并重新生成 MANIFEST.md。主包已含 live 的 goals-live（GOAL.md 与 crons 定义）与 cron.d 副本。
2. 运行 ~/workspace/migration-backup/rebuild-gpt.sh，重新打包 GPT 数据包到 ~/workspace/your_files/gpt-data-package.zip。GPT 包内容：2026-11-17 ChatGPT 网页端额外读到的全部信息（资料库 19 个文件约 28 MB、ChatGPT 导出索引、Meta 导出全文、迁移索引）。GPT 包约 28 MB，超 Gmail 25 MB 上限，不走邮件附件。
3. 运行 ~/workspace/migration-backup/rebuild-global.sh，重新打包全局包到 ~/workspace/your_files/global-backup.zip。全局包内容（2026-11-23 用户要求扩大范围、全局备份起）：~/memory/ 递归全部（ChatGPT 导出目录 741 个 .dat 二进制除外，其清单逐个列名/大小/SHA 在 GLOBAL-MANIFEST.md 内，本体由 Drive 原始 zip 覆盖；补包敏感源文件不复制，只记名/大小/SHA）、~/side-chats/（磁盘上不存在该目录，存在才打包）、~/workspace/goals/ 递归全部、~/workspace/your_files/（排除四个备份 zip 本身）、~/workspace/user/、~/workspace/custom-skills/、~/workspace/custom-connectors/、~/workspace/migration-backup/ 的脚本与日志、~/workspace/meta_exports/、~/workspace/feed/、~/workspace/space_data/、~/workspace/space-versions/、~/workspace/ts-spaces/（排除 node_modules 与 app.db* 数据库文件）、以及其他 workspace 用户数据区与 ~/dreams/、~/config/、~/user/、根级文本文件。安全排除：私钥、凭证、*secret*/*credential*/*.pem/*.key 文件、浏览器 profile/cookies、WorkBuddy 410MB 安装包本体（只记名/大小/SHA 在清单里），全部排除项在 GLOBAL-MANIFEST.md 里列明。全局包约 263 MB，超 Gmail 上限，不走邮件附件。
4. 运行 ~/workspace/migration-backup/rebuild-nongithub.sh，重新打包非 GitHub 数据包到 ~/workspace/your_files/non-github-data.zip。内容（2026-11-24 用户要求：GitHub 仓库没收的三类数据单独打包、标注清楚）：1-binaries/ 二进制文件（全局包暂存里的全部非文本文件，外加 ChatGPT 导出目录 741 个 .dat，从 live 目录收）、2-sensitive/ 补包敏感源文件原件、3-space-databases/ 两个空间 app.db 快照，包根有 README-标注.md 与 NON-GITHUB-MANIFEST.md。脚本同时算内容总哈希并与上次比对，结论 CHANGED=0/1 写在 ~/workspace/migration-backup/last-nongithub-build.log 里。如果重建失败，停下，在本旁聊汇报失败原因，不发旧包（与其它包同一纪律）。
5. 用 unzip -l 核对五个 zip 的文件数和大小，确认主包和补包每个都小于 25,000,000 字节（Gmail 上限）。如果任一重建失败或主包/补包超限，停下，在本旁聊汇报失败原因，不发旧包。
6. 把 GPT 包和全局包上传到 Google Drive「Muse 迁移备份」文件夹，拿到各自的下载链接。非 GitHub 数据包只在有变化时上传：看 last-nongithub-build.log 里的 CHANGED，CHANGED=1 时上传到同一文件夹（~/workspace/migration-backup/non-github-drive-link.txt 里有旧文件 ID 就更新原文件，没有就新上传），上传后把最新链接写入该 txt 覆盖保存；CHANGED=0 时不重复上传，沿用该 txt 里已记录的链接。ChatGPT 导出目录（~/memory/chatgpt-export-2026-11-12/，754 个文件，解压后约 432 MB）自 2026-11-19 起算进每日备份：它对应的原始 zip（401124902 字节，SHA-256 fe3be29b31976e03bf2c63e358ab20843a422816ab7aea162fd51087d7ae99a9）已在该 Drive 文件夹，文件 ID 10X7v_FmxuZF708djSTpHDkf08sUBn6q8，链接 https://drive.google.com/file/d/10X7v_FmxuZF708djSTpHDkf08sUBn6q8/view?usp=drivesdk，内容不变，不每天重复上传；导出目录的全部 754 个文件就是这个 zip 里的内容。
7. 运行 ~/workspace/migration-backup/sync-github.sh 同步到 GitHub 私有仓库 znine1019/muse-backup；同步失败只在汇报中注明，不阻断发邮件。
8. 用 Gmail 从 caixiangzhou9@gmail.com 发送到两个收件人：3282446722@qq.com 和 caixiangzhou9@gmail.com（2026-11-23 用户要求：从现在开始谷歌邮箱也每天都发，两个邮箱每天都发同一封），主题「Muse 迁移包每日备份 YYYY-MM-DD」，附件为主包和补包两个 zip。正文必须是一份一目了然的清单（2026-11-24 用户要求：其他的数据在每日邮件要写清楚里面是什么、一目了然），逐项列全当天全部备份内容，每项写：名称、里面是什么（一行说明）、文件数和大小、当天状态或链接。固定七项：
   - 主包 muse-migration-2026-11-12.zip（邮件附件）：迁移主包，含根级文件（MEMORY/USER/IDENTITY 等）、memory 记忆库、live 的 goals-live 与 cron.d 副本；写文件数和字节数。
   - 补包 muse-migration-2026-11-12-supplement.zip（邮件附件）：补包，含敏感源文件原件（只在附件里，正文绝不写号码值）；写文件数和字节数。
   - GPT 包 gpt-data-package.zip（Drive 链接）：2026-11-17 ChatGPT 网页端额外读到的全部信息（资料库 19 个文件、ChatGPT 导出索引、Meta 导出全文、迁移索引）；写文件数、字节数和 Drive 链接。
   - 全局包 global-backup.zip（Drive 链接）：全局备份，memory/ 递归、goals、your_files、feed、空间源码等全部用户数据，逐文件清单在包内 GLOBAL-MANIFEST.md；写文件数、字节数和 Drive 链接。
   - 非 GitHub 数据包 non-github-data.zip（Drive 链接）：GitHub 仓库没收的三类数据——741 个 .dat 与图片等二进制文件、补包敏感源文件、两个空间 app.db 快照（包内有 README-标注.md 说明）；并写明：旁聊内容无文件形态、不在任何包内；写文件数、字节数、当天状态（CHANGED=1 已新上传 / CHANGED=0 无变化、沿用旧链接）和 Drive 链接。
   - ChatGPT 导出原始 zip（Drive 链接）：2026-11-12 ChatGPT 导出原件，754 个文件、401124902 字节，内容不变、不每天重复上传；写 Drive 链接。
   - GitHub 仓库 znine1019/muse-backup（私有仓库）：与本包配套的文本数据同步库；写已同步文本文件数和最新 commit SHA 前 16 位（同步失败则写失败原因）。
9. 发完在本旁聊汇报：日期、五个 zip 的文件数、大小、SHA-256 前 16 位、ChatGPT 导出目录（754 个文件、401124902 字节、SHA-256 前 16 位 fe3be29b31976e03b、Drive 链接）、邮件已发送到两个邮箱的确认、GPT 包 Drive 链接、全局包 Drive 链接、非 GitHub 数据包（文件数、大小、SHA-256 前 16 位、CHANGED、Drive 链接）、GitHub 同步结果（推送文件数、最新 commit SHA 前 16 位或失败原因）。
10. 补包里的身份证号、电话、学号只在邮件附件里，绝不在聊天汇报里写出这些号码值。观察记到当日每日笔记 ~/memory/YYYY-MM-DD.md，不要改 MEMORY.md。
