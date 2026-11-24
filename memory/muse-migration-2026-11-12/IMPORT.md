# 导入说明 — 给新号的 Muse

打包时间：2026-11-12 18:14（Asia/Shanghai）
用户：周才翔（Kenneth）
原助手名：芬奇
说明：本包是原号 Muse 的全部设置导出。请按下面映射原样恢复，不要猜测、不要改写文件内容。恢复后逐项核对，最后告诉用户哪些已恢复、哪些需要他重新授权或重新创建。

> 注意：用户原消息里写的是 `IDENTITY.ma`，按 `IDENTITY.md` 处理，本包内已是 `IDENTITY.md`。

## 一、解压

把 zip 解压到一个临时目录，例如 `~/migration-import/`。解压后应看到 `root/`、`memory/`、`feed/`、`goals/`、`side-chats/`、`IMPORT.md`、`MANIFEST.md`。

不要直接把整个解压目录当作新号的 home 目录覆盖。

## 二、文件映射表（核心）

| 本包内路径 | 放到新号的位置 | 说明 |
|---|---|---|
| `root/AGENTS.md` | `~/AGENTS.md` | 工作方式、约定 |
| `root/SOUL.md` | `~/SOUL.md` | 人格与语气 |
| `root/IDENTITY.md` | `~/IDENTITY.md` | 助手名：芬奇 |
| `root/USER.md` | `~/USER.md` | 用户：周才翔 / Kenneth，Asia/Shanghai |
| `root/MEMORY.md` | `~/MEMORY.md` | 长期记忆摘要 |
| `root/PROACTIVE_PREFERENCES.md` | `~/PROACTIVE_PREFERENCES.md` | 主动提醒偏好 |
| `root/TOOLS.md` | `~/TOOLS.md` | 本地工具备注 |
| `memory/2026-11-12.md` | `~/memory/2026-11-12.md` | 当日详细记录 |
| `memory/gpt-handover-key-points.md` | `~/memory/gpt-handover-key-points.md` | GPT 交接重点 |
| `memory/bank/experience.md` | `~/memory/bank/experience.md` | 经历库 |
| `memory/bank/opinions.md` | `~/memory/bank/opinions.md` | 观点库 |
| `memory/bank/reflections.md` | `~/memory/bank/reflections.md` | 反思库 |
| `memory/bank/world.md` | `~/memory/bank/world.md` | 世界知识库 |
| `memory/people/INDEX.md` | `~/memory/people/INDEX.md` | 人物索引 |
| `memory/people/han-shuxiang.md` | `~/memory/people/han-shuxiang.md` | 外婆 韩书香 |
| `memory/people/lei-laoshi.md` | `~/memory/people/lei-laoshi.md` | 雷老师 |
| `memory/people/luo-zichun.md` | `~/memory/people/luo-zichun.md` | 骆姿莼 |
| `memory/people/ma-maosheng.md` | `~/memory/people/ma-maosheng.md` | 外公 马茂生 |
| `memory/people/ma-zong.md` | `~/memory/people/ma-zong.md` | 马总 |
| `memory/groups/INDEX.md` | `~/memory/groups/INDEX.md` | 群组索引 |
| `memory/groups/25-ti-jiao-1-ban.md` | `~/memory/groups/25-ti-jiao-1-ban.md` | 25体教1班 |
| `memory/groups/qiao-ge-ti-yu-ju-le-bu.md` | `~/memory/groups/qiao-ge-ti-yu-ju-le-bu.md` | 乔格体育俱乐部 |

复制后，用 `muse.memory_search` 验证一次关键事实：芬奇、周才翔、乔格训迹系统 V1.6.2 已暂停、公众号每三天一期。

## 三、Feed 提示词（不要只复制文件）

文件在 `feed/feed-prompt.md`，仅作记录。

导入方法：
1. 打开 `feed/feed-prompt.md`，复制“提示词全文”那一段。
2. 用 Feed 工具 `feed.prompt_update`，把全文原样提交为新号的 Feed 提示词。
3. prompt_id `cbf5cf7a-16b5-4833-9983-3b6b5ae9c1c6` 是原号的 ID，新号会有新 ID，不用照搬。

已发表的 Feed 内容无法通过文件迁移，新号会按新提示词重新生成。

## 四、目标工作区

文件在 `goals/goal/`，映射如下：

| 本包内路径 | 放到新号的位置 |
|---|---|
| `goals/goal/GOAL.md` | `~/workspace/goals/goal/GOAL.md` |
| `goals/goal/goal-state.json` | 只作记录，不要直接当作目标文件使用；按下面重建目标 |
| `goals/goal/crons/hourly/gongzhonghao-every-3-days__interval@72h.md` | `~/workspace/goals/goal/crons/hourly/gongzhonghao-every-3-days__interval@72h.md`（作参考） |

目标详情（见 `goal-state.json`）：
- 目标 ID：`goal_e2d41558b402`，标题：公众号每三天一期内容
- 类型：habit，状态：active
- 内容：每 3 天做一份公众号文章，主题由 Muse 定，配相关插图和封面，按已记录的 GPT 范文模板写，在主聊天交付。
- 进度：第一期已于 2026-11-12 交付，主题为冬季动态热身；下一期原定 2026-11-15 17:36 左右。

重要：定时任务不能只靠复制 cron 文件生效。新号的 Muse 需要：
1. 用目标工具重新创建同名目标；
2. 重新创建每 72 小时一次的定时任务；
3. 下一期时间按导入当天的日期重新锚定，不要不经核对直接沿用 2026-11-15 这个锚点；
4. 把第一期已交付、不要重复冬季动态热身主题记到新目标的时间线里。

`goals/goal/files/`、`hidden_files/`、`agent_notes/`、`briefs/`、`references/spaces/` 在导出时均为空，本包保留了空目录结构。

## 五、旁聊记忆

文件在 `side-chats/README.md`，只作说明，不用复制到任何位置。

导出时共 2 个聊天：主聊天和本次导出所在的旁聊。磁盘上没有找到 `~/side-chats/` 目录，也没有其他旁聊 MEMORY.md 文件，所以本包没有遗漏旁聊记忆文件。聊天记录本身不在文件系统里，无法通过文件迁移。

主聊天的记忆就是本包的 `root/MEMORY.md` 和 `memory/`。

## 六、导入后核对清单

- [ ] `~/MEMORY.md`、`~/USER.md`、`~/IDENTITY.md` 已就位，助手名是芬奇
- [ ] `~/memory/people/` 5 人、`~/memory/groups/` 2 组齐全
- [ ] `~/memory/2026-11-12.md` 和 `gpt-handover-key-points.md` 已就位
- [ ] Feed 提示词已用 `feed.prompt_update` 提交，不是只放了文件
- [ ] 公众号目标已重建，定时任务已重建，下一期时间已按导入当天重新核对
- [ ] 已告诉用户下面“本包不含”里需要他重新做的事

## 七、本包不含、需要另外处理的事

以下内容不在本包内，复制文件也恢复不了：

1. **敏感源文件**：GPT 交接源文件 `workspace/user/files/Muse________2026-11-12.md`（含身份证号、电话、学号完整值）未包含在本包内。如需迁移，请用户单独提供该文件，不要经由聊天明文转发。
2. **账号连接**：Gmail、GitHub、WhatsApp、Spotify 等连接状态、登录态、授权均不迁移，新号需重新连接。
3. **头像**：Finch 机器人头像图片未包含，需在新号重新设置。
4. **空间 / 制品**：乔格训迹系统项目进度空间等已建空间、已发表 Feed 内容、已生成图片不在本包内。
5. **聊天记录**：主聊天和旁聊的逐字聊天记录不在本包内。
6. **本地项目**：`D:\乔格训迹系统`、`D:\乔格项目资料` 等 Windows 本地文件不在本包内；乔格训迹系统 V1.6.2 仍为已暂停，未授权恢复。
7. **第一期公众号文章和图片**：在 `workspace/your_files/gongzhonghao-2026-11-12/`，未包含在本包内，如需迁移请另行复制该文件夹。
8. **密钥与订阅**：API Key、订阅到期日等不在本包内，不要凭空补写。

## 八、安全提醒

本包含有用户个人身份、家庭、感情、学校、俱乐部等私人信息。导入完成后请用户删除临时解压目录和不再需要的副本，不要把 zip 转发给他人。
