---
id: migration-backup-switch-to-0019
title: 迁移备份改到每天 00:19（含 GPT 包）
enabled: true
owner: goal:goal-2
mode: task
schedule:
  kind: runonce
  timezone: Asia/Shanghai
  at: 2026-11-18T08:30:00
delivery:
  - chat_id: f49737aa-987f-4a03-a1a4-15124953221c
metadata:
  tags: [cron:exact-time]
  originating_chat_context_json: '{"chat_id":"54c18888-4092-4174-8dcb-fb7740378bcc","origin_provider":"main","chat_kind":"direct","event_kind":"message","require_mention":false,"device_id":"0617389a-3235-4f2c-9268-aea2e57a379f"}'
  presentation_locale: zh-CN
---
2026-11-18 08:30 一次性任务：今天 08:18 的每日迁移备份已按旧流程跑完（主包+补包，不含 GPT 包），现在把备份定时任务改到每天凌晨 00:19，并从明天起包含 GPT 数据包。

1. 用 cron.view 先读 migration-daily-backup-email 的现有定义，确认它今天 08:18 已跑过。
2. 用 cron.update 更新 migration-daily-backup-email（id 不变，owner 保持 goal:goal-2，delivery 保持迁移备份每日汇报旁聊 f49737aa-987f-4a03-a1a4-15124953221c），新 schedule 为 daily，time 00:19:00，timezone Asia/Shanghai，timing exact。新 body 全文如下（照抄，不要改动以外的部分）：
---
每日迁移备份，按正常工作流程执行（2026-11-19 起，每天 00:19，含 GPT 数据包）：

1. 运行 ~/workspace/migration-backup/rebuild.sh，重新打包主包和补包两个 zip 到 ~/workspace/your_files/muse-migration-2026-11-12.zip 和 ~/workspace/your_files/muse-migration-2026-11-12-supplement.zip，并重新生成 MANIFEST.md。
2. 运行 ~/workspace/migration-backup/rebuild-gpt.sh，重新打包 GPT 数据包到 ~/workspace/your_files/gpt-data-package.zip。GPT 包内容：2026-11-17 ChatGPT 网页端额外读到的全部信息（资料库 19 个文件约 28 MB、ChatGPT 导出索引、Meta 导出全文、迁移索引）。GPT 包约 28 MB，超 Gmail 25 MB 上限，不走邮件附件。
3. 用 unzip -l 核对三个 zip 的文件数和大小，确认主包和补包每个都小于 25,000,000 字节（Gmail 上限）。如果重建失败或主包/补包超限，停下，在本旁聊汇报失败原因，不发旧包。
4. 把 GPT 包上传到 Google Drive「Muse 迁移备份」文件夹，拿到下载链接。ChatGPT 导出原始 zip（401124902 字节）已在该文件夹，文件 ID 10X7v_FmxuZF708djSTpHDkf08sUBn6q8，链接 https://drive.google.com/file/d/10X7v_FmxuZF708djSTpHDkf08sUBn6q8/view?usp=drivesdk，内容不变，不每天重复上传。
5. 用 Gmail 从 caixiangzhou9@gmail.com 发到 3282446722@qq.com，主题「Muse 迁移包每日备份 YYYY-MM-DD」，正文简短说明，附件为主包和补包两个 zip，正文里附上 GPT 包的 Drive 链接和上面 401 MB 导出 zip 的 Drive 链接。
6. 发完在本旁聊汇报：日期、三个 zip 的文件数、大小、SHA-256 前 16 位、邮件已发送的确认、GPT 包 Drive 链接。
7. 补包里的身份证号、电话、学号只在邮件附件里，绝不在聊天汇报里写出这些号码值。观察记到当日每日笔记 ~/memory/YYYY-MM-DD.md，不要改 MEMORY.md。
---
3. 更新完用 cron.view 读回来核对：schedule 应为 daily 00:19:00 Asia/Shanghai，下次运行应为 2026-11-19 00:19。
4. 在本旁聊汇报：已改到每天 00:19，从 2026-11-19 00:19 起含 GPT 包，今天 08:18 那次按旧流程不变。
