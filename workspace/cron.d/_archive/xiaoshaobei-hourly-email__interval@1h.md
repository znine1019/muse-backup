---
id: xiaoshaobei-hourly-email
title: 小烧杯 每小时邮件
enabled: true
mode: task
schedule:
  kind: interval
  timezone: Asia/Shanghai
  at: 2026-11-17T22:39:25
  every: 1h
delivery:
  - chat_id: 2aa8ad6f-5f95-4da4-8ef6-51f3f229bac8
metadata:
  tags: [cron:automatic-interval-anchor]
  predicted_connector_permissions:
  - connector: gmail
    method: users.messages.send
  originating_chat_context_json: '{"chat_id":"2aa8ad6f-5f95-4da4-8ef6-51f3f229bac8","origin_provider":"main","chat_kind":"direct","event_kind":"message","require_mention":false,"device_id":"0617389a-3235-4f2c-9268-aea2e57a379f"}'
  presentation_locale: zh-CN
---
每隔一小时给用户的好基友发一封邮件。

收件人：430746030@qq.com
主题：小烧杯
正文：小烧杯

使用 Gmail 发送。用户在第一次发信的确认卡上已选“以后发给这个人都允许”，所以后续发给这个收件人应跳过确认卡，直接发送。

每次运行只发一封，不要重复发，不要改收件人、主题或正文。如果发送失败，在汇报里说清楚失败原因，不要自己重试发第二封。
