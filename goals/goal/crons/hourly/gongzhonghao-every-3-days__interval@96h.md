---
id: gongzhonghao-every-3-days
title: 公众号每四天一期内容
enabled: true
owner: goal:goal
mode: task
schedule:
  kind: interval
  timezone: Asia/Shanghai
  at: 2026-11-16T17:36:45
  every: 96h
delivery:
  - chat_id: 0d944788-dcf9-460e-9505-2bc27c4b64c7
metadata:
  originating_chat_context_json: '{"chat_id":"0d944788-dcf9-460e-9505-2bc27c4b64c7","origin_provider":"main","chat_kind":"direct","event_kind":"message","require_mention":false,"device_id":"0617389a-3235-4f2c-9268-aea2e57a379f"}'
  presentation_locale: zh-CN
---
每四天做一份公众号内容，主题由你定，不重复之前做过的主题。先查 ~/memory/2026-11-12.md、workspace/your_files/gongzhonghao-2026-11-12/template.md 和 workspace/your_files/gongzhonghao-2026-11-12/ 里已做过的主题，避免重复。

模板：按 workspace/your_files/gongzhonghao-2026-11-12/template.md 里记的 GPT 范文模板写，不要复制范文全文，只用它的结构、写法和配图思路，换新主题写新内容。标题格式：场景问题 + 破折号 + 体育生必须了解的 + 主题。开篇用四类专项的具体表现引入误区，再设问作答。主体用编号章节，先讲概念、再讲判断方法、再讲分专项安排，配 2-3 张同风格信息图。收尾用“写在最后”观念收束，附真实可核查的参考文献。

要求：受众是体育生、贵州体考生、田径运动员、基层教练员；内容实用、体育生易懂，用训练或运动员案例；不伪造研究、书目、数据或名人训练细节；不确定的写成建议或未知；反复提醒不作医学诊断、不把单次表现等同于诊断。插图风格：简约线条、低饱和蓝灰浅色、白底、充足留白、信息图感，避免浓重色块、厚重海报感和高饱和颜色。

每次产出：一篇中文公众号文章正文（标题+正文，长篇深度科普，约2000-3000字），1张封面插图和2-3张相关插图，图片用 media.generate_image 生成并检查后再发。文章和图片保存到 workspace/your_files/gongzhonghao-YYYY-MM-DD/，并在本旁聊（公众号内容创作专用旁聊）里把全文和图片发给用户。完成后在 tracked item goal_e2d41558b402 上记一条活动，写明主题和交付情况。
