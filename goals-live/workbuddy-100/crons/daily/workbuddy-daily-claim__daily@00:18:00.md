---
id: workbuddy-daily-claim
title: WorkBuddy 每日 100 积分领取
enabled: true
owner: goal:workbuddy-100
mode: task
schedule:
  kind: daily
  timezone: Asia/Shanghai
  time: 00:18:00
delivery:
  - chat_id: fe9668f2-266a-4e22-b492-8f12e77291cb
metadata:
  tags: [cron:exact-time]
  originating_chat_context_json: '{"chat_id":"fe9668f2-266a-4e22-b492-8f12e77291cb","origin_provider":"main","chat_kind":"direct","event_kind":"message","require_mention":false,"device_id":"0617389a-3235-4f2c-9268-aea2e57a379f"}'
  presentation_locale: zh-CN
---
每天约 00:18 检查 WorkBuddy 当日 100 积分领取情况，只在本旁聊汇报，不发主聊天。

步骤：
1. 检查桌面客户端是否在运行：ps 检查 /opt/WorkBuddy/workbuddy 进程。没运行就用 ~/workspace/workbuddy/launch.sh 启动（Xvfb :99，1280x800）。如果 /opt/WorkBuddy/workbuddy 不存在（VM 重启后可能丢失），先用 ~/workspace/workbuddy/ 里的官方 .deb（WorkBuddy-linux-x64-deb-5.6.2.40046327-c7b525f3.deb）以 dpkg -i --force-depends 重装；绝对不要运行 apt-get install -f 或 apt --fix-broken install，那会删掉 workbuddy。登录态保存在 ~/.workbuddy，重装后不会丢。
2. 用 scrot 在 DISPLAY=:99 下截图，看桌面左下角 Buddy Station 的 Daily 100 Pts 状态。
3. 已显示 Claimed：当天已领，不重复领，汇报总余额（截图里能看到就写上）。
4. 显示 Claim Now：用 xdotool 点它；如果点按没反应，改用键盘 Tab 聚焦后回车。点完再截图确认变成 Claimed，核对 +100 和总余额，汇报。
5. 如果客户端已退出登录：不要自己发验证码登录，在本旁聊汇报登录已过期，请用户发验证码再登。不要声称网页版能直接领取，以桌面客户端实际状态为准。
6. 全程保持登录态，绝不退出登录。
