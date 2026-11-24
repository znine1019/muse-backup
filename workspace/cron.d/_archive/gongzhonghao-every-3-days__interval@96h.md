---
id: gongzhonghao-every-3-days
title: 公众号内容创作与定时通知
enabled: true
mode: task
schedule:
  kind: interval
  timezone: Asia/Shanghai
  at: 2026-11-20T17:36:00
  every: 96h
timeout_secs: 3600
delivery:
  - chat_id: 660b5e41-9b1b-433c-9d6d-b729380e8011
metadata:
  tags: [cron:exact-time]
  originating_chat_context_json: '{"chat_id":"660b5e41-9b1b-433c-9d6d-b729380e8011","origin_provider":"main","chat_kind":"direct","event_kind":"message","require_mention":false,"device_id":"0617389a-3235-4f2c-9268-aea2e57a379f"}'
  presentation_locale: zh-CN
---
公众号内容创作定时任务（按上一个 Muse 原样重建）。

每 4 天出一期公众号文章，下一期 2026-11-20 周五约 17:36 CST，之后每 96 小时一期。

每次执行：
- 由 Muse 自己定一个体育相关主题，参考模板文章《冬训越练越累，成绩反而下降？——体育生必须了解的训练疲劳、超量恢复与负荷管理》（2026-11-03，https://mp.weixin.qq.com/s/Rfx8_pCz2KtJJgr7GxJF2g）：以四个项目的场景开场、编号章节、先讲概念再讲监测方法再讲分项指导、2-3 张扁平信息图、结尾用一句观念金句加参考文献。
- 写一篇完整的中文公众号文章，配相关插图和封面。
- 插图风格：简约线条、低饱和蓝灰色、白底、充足留白、信息图感，避免大色块。
- 把全文和图片发到这个旁聊（公众号内容创作与定时通知）里交付，不发主聊天。

不要改周期和交付地点，除非用户明确要求。
