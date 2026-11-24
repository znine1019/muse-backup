---
id: migration-backup-reenable-2026-11-24
title: 恢复每日迁移备份
enabled: true
owner: goal:goal-2
mode: task
schedule:
  kind: runonce
  timezone: Asia/Shanghai
  at: 2026-11-24T01:00:00
delivery:
  - chat_id: f49737aa-987f-4a03-a1a4-15124953221c
metadata:
  tags: [cron:exact-time]
  originating_chat_context_json: '{"chat_id":"f49737aa-987f-4a03-a1a4-15124953221c","origin_provider":"main","chat_kind":"direct","event_kind":"message","require_mention":false,"device_id":"0617389a-3235-4f2c-9268-aea2e57a379f"}'
  presentation_locale: zh-CN
---
一次性恢复任务：把每日迁移备份定时任务 migration-daily-backup-email 重新启用。

背景：2026-11-23 19:48 用户要求把 2026-11-24 00:19 的备份提前到 2026-11-23 晚上执行、2026-11-24 不再备份，因此当晚把 migration-daily-backup-email 暂停了（enabled: false），避免 2026-11-24 00:19 重复跑。本任务在 2026-11-24 01:00 恢复它，使其下一次正常运行是 2026-11-25 00:19。

执行：
1. 用 cron.update 把 migration-daily-backup-email 的 enabled 改为 true，不改它的正文、时间（每天 00:19 Asia/Shanghai）、owner 和投递旁聊。
2. 用 cron.view 回读确认：enabled 为 true，下一次运行是 2026-11-25 00:19 CST。
3. 在本旁聊简短汇报已恢复、下一次运行时间。观察记到 ~/memory/2026-11-24.md，不要改 MEMORY.md。
