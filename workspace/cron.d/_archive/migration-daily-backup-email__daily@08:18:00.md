---
id: migration-daily-backup-email
title: 迁移包每日备份
enabled: true
mode: task
schedule:
  kind: daily
  timezone: Asia/Shanghai
  time: 08:18:00
delivery:
  - chat_id: f49737aa-987f-4a03-a1a4-15124953221c
metadata:
  tags: [cron:exact-time]
  originating_chat_context_json: '{"chat_id":"f49737aa-987f-4a03-a1a4-15124953221c","origin_provider":"main","chat_kind":"direct","provider":"main","event_kind":"message","require_mention":false,"device_id":"0617389a-3235-4f2c-9268-aea2e57a379f"}'
  presentation_locale: zh-CN
---
每日迁移备份，按正常工作流程执行：

1. 运行 ~/workspace/migration-backup/rebuild.sh，重新打包主包和补包两个 zip 到 ~/workspace/your_files/muse-migration-2026-11-12.zip 和 ~/workspace/your_files/muse-migration-2026-11-12-supplement.zip，并重新生成 MANIFEST.md。
2. 用 unzip -l 核对两个 zip 的文件数和大小，确认每个 zip 都小于 25,000,000 字节（Gmail 上限）。如果重建失败或超限，停下，在本旁聊汇报失败原因，不发旧包。
3. 用 Gmail 从 caixiangzhou9@gmail.com 发到 3282446722@qq.com，主题「Muse 迁移包每日备份 YYYY-MM-DD」，正文简短说明，附件为上面两个 zip。ChatGPT 401MB 原始 zip 不进每日备份。
4. 发完在本旁聊汇报：日期、两个 zip 的文件数、大小、SHA-256 前 16 位、邮件已发送的确认。
5. 补包里的身份证号、电话、学号只在邮件附件里，绝不在聊天汇报里写出这些号码值。观察记到当日每日笔记 ~/memory/YYYY-MM-DD.md，不要改 MEMORY.md。
