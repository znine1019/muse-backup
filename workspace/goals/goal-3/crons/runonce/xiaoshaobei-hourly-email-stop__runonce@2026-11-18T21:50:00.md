---
id: xiaoshaobei-hourly-email-stop
title: 停止小烧杯每小时邮件
enabled: false
owner: goal:goal-3
mode: task
schedule:
  kind: runonce
  timezone: Asia/Shanghai
  at: 2026-11-18T21:50:00
delivery:
  - chat_id: 2aa8ad6f-5f95-4da4-8ef6-51f3f229bac8
metadata:
  tags: [cron:exact-time]
  originating_chat_context_json: '{"chat_id":"2aa8ad6f-5f95-4da4-8ef6-51f3f229bac8","origin_provider":"main","chat_kind":"direct","event_kind":"message","require_mention":false,"device_id":"0617389a-3235-4f2c-9268-aea2e57a379f"}'
  presentation_locale: zh-CN
  paused_for_completed_goal_id: goal_adcb4d13738f
---
停止每小时发“小烧杯”邮件的任务。

操作：删除定时任务 xiaoshaobei-hourly-email（小烧杯 每小时邮件），确认它之后不再运行。

完成后在主聊天里告诉用户：小烧杯每小时邮件任务已结束，共发了约24小时。
