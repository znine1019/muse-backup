# 空间处理说明

## 1. 乔格训迹系统空间（在用，需重建）

- 名称：乔格训迹系统
- slug：xiang-mu-jin-du-he-ren-wu-qing-dan
- space_id：f32f0214-532a-4f3d-a095-d16117233358
- 位置：侧边栏
- 数据：见 `joger-space-data.json`，2026-11-12 用空间自带的 getstate 动作导出，没有直接读 app.db。
- 内容：项目 V1.6.2、已暂停；R02 已收口、done；BP02-B 的 P1 未修复、blocked；R12 · Muse API 三方闭环、PARTIAL、in_progress。

新号处理方法：
1. 在新号重新创建一个同名空间：乔格训迹系统项目进度和任务清单，放在侧边栏。
2. 按 `joger-space-data.json` 把项目、3 个工作项、3 个任务原样录入，状态和备注不要改。
3. 不要复制原号的 `~/workspace/ts-spaces/xiang-mu-jin-du-he-ren-wu-qing-dan/` 整个目录：里面有 133M 的 node_modules、app.db 和构建产物，复制过去不能用，也违反该空间的 AGENTS.md（只能通过 artifact 工具建改，不要直接改构建产物、不要直接跑 sqlite）。
4. 恢复后仍为已暂停。没有用户明确说恢复，不要启动开发、测试或部署。

## 2. 公众号内容与封面插图空间（已删，无法恢复）

- slug：gong-zhong-hao-nei-rong-yu-feng-mian-cha-tu
- 状态：2026-11-12 用户说“不对，删掉吧”，已删除。
- 本包不含它的可恢复数据，只有旧预览图残留在原号 `workspace/space_data/`，不能据此重建。
- 如需新号再做一个公众号空间，请用户重新下达要求，不要按已删除的那个自动重建。

## 3. 其他空间

导出时 artifact.list 只列出上面这 1 个在用空间，没有其他在用空间。
