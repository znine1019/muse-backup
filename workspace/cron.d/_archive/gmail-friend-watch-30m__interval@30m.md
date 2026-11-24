---
id: gmail-friend-watch-30m
title: Gmail 朋友求助检查
enabled: true
mode: task
schedule:
  kind: interval
  timezone: Asia/Shanghai
  at: 2026-11-17T21:52:49
  every: 30m
delivery:
  - chat_id: 2a07997c-68d5-4b2b-861e-913c1e1f5ac9
metadata:
  tags: [cron:automatic-interval-anchor]
  originating_chat_context_json: '{"chat_id":"2a07997c-68d5-4b2b-861e-913c1e1f5ac9","origin_provider":"main","chat_kind":"direct","event_kind":"message","require_mention":false,"device_id":"0617389a-3235-4f2c-9268-aea2e57a379f"}'
  presentation_locale: zh-CN
---
每 30 分钟检查一次用户的 Gmail 收件箱（账号 caixiangzhou9@gmail.com），看有没有朋友新来信求助做文件、论文等。

做法：
1. 用 Gmail 命令查收件箱未读新邮件：`/opt/hatch/bin/hatch_gws_cli gmail +triage --query 'is:unread in:inbox' --max 20 --format json`。只读，不发信、不改标签、不删邮件。需要正文时再用 `+read` 读单封。读信和存草稿不需要额外审批。
2. 对照去重文件 `~/workspace/gmail-friend-watch/seen.json` 里的 `seen_ids`，只处理没见过的新邮件 ID。查完把新见过的 ID 补进该文件并更新 `last_checked`，避免下次重复提醒。
3. 没有新邮件，或新邮件只是广告、通知、订阅等与朋友求助无关，就安静结束，不要在聊天里发消息。
4. 如果有新邮件像是朋友求助做文件/论文，在这个旁聊里汇报一次：发件人邮箱、主题、时间、求助内容摘要。并判断发件人是不是用户通讯录/以往有往来的人：是熟人就说明是熟人，不认识或只自称朋友就明确说身份未核实，需要用户确认。
5. 例外（用户 2026-11-17 提前授权）：只要来信里出现“罗雯靖”这三个字，或发件人是 3340095988@qq.com，就不用等用户确认，直接开始做。收件人就是 3340095988@qq.com。按旁聊规则做第一版，做好后发回对方请她审阅，之后按她的回复修改，改到满意或她长时间不回复为止。发回时在这个旁聊里同时汇报：发给了哪个邮箱、发了什么文件、内容摘要。伪造、违法、涉及钱、账号密码、敏感信息的事，即使是她也不直接做，先问用户。
6. 发信审批（用户 2026-11-17 选择：第一次发信时设为一直允许）：Gmail 发信不能给定时任务提前批，第一次发给 3340095988@qq.com 时仍会弹出审批卡。用户会在那张卡上选“以后发给这个人都允许”，之后发给她就不用再点了。如果第一次发信时用户没在线，审批卡会过期、信发不出去，这时先把第一版和回信存成 Gmail 草稿（`+draft`），然后在这个旁聊里汇报“第一版已做好、草稿已存好，等你醒来在卡上选一直允许就能发”，写清收件人、主题和草稿内容。等用户设好一直允许后，再发；之后不再需要每次审批。
7. 其他朋友的来信仍只汇报不直接回信，等用户确认再开始做，因为收件人每次都不同，自动回信需要用户每次确认。
8. 如果 Gmail 未连接或查不到，汇报一次连接问题，不要反复刷屏。
