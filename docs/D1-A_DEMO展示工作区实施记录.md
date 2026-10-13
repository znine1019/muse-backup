# D1-A｜DEMO 展示工作区与安全隔离实施记录

**分支**：`demo/showcase-v1`　**基线**：`3274cbb`（正式 `main`）　**本轮范围**：D1-A（入口 + 独立模拟运行框架）
**正式项目**：`C:\Users\Administrator\Desktop\乔格训迹系统`（`main`，本轮**零改动**）
**DEMO 工作区**：`C:\Users\Administrator\Desktop\乔格训迹系统-DEMO`（`demo/showcase-v1`）

---

## 1. Git 隔离

- 使用 `git worktree add -b demo/showcase-v1 <路径> 3274cbb` 创建，两个工作区共享同一仓库但各自独立检出。
- 正式 `main` 工作区：分支 `main`、HEAD `3274cbb`、工作区干净（自动化测试断言其未被污染）。
- DEMO 分支基于 `3274cbb` 派生，**未改动任何云函数、云端配置或小程序工程配置**（测试断言）。
- 本轮所有改动只存在于 `demo/showcase-v1`；删除该 worktree 即可完全回退，不影响正式项目。

---

## 2. 云端访问审计结论

对 DEMO 构建可能触达正式 CloudBase 的路径做了全量扫描，结论：**全仓库只有 3 处 `wx.cloud` 调用点**，且**没有任何上传/下载/文件操作**。

| 位置 | 用途 | DEMO 构建处理 |
|---|---|---|
| `miniprogram/app.js` `wx.cloud.init` | 初始化云环境 | **直接跳过**（DEMO 下不初始化云开发） |
| `miniprogram/services/api.js` `callApi` → `wx.cloud.callFunction` | 全部正式业务接口 | **调用前直接拒绝**（`DEMO_BUILD_BLOCKED`） |
| `miniprogram/services/api.js` `healthCheck` → `wx.cloud.callFunction` | 云开发健康检查 | **调用前直接拒绝** |

页面自动加载数据的路径（各页 `onShow`/`onLoad` → `api.*`）在 DEMO 构建下全部落入第二道防线，因此**不存在读取或写入正式业务数据的可能**，而不是"靠隐藏页面"。

---

## 3. 三层隔离方案

1. **不初始化云开发**（`app.js`）：DEMO 构建下 `onLaunch` 直接返回，`cloudReady` 保持 `false`，不存在到正式环境的通道。
2. **接口层硬拒绝**（`services/api.js`）：新增 `assertNotDemoBuild()`，在触碰 `wx.cloud` **之前**抛出 `DEMO_BUILD_BLOCKED`；因此即使有人直接打开正式业务页，也只能看到错误，拿不到任何正式数据。
3. **本地模拟会话**（`app.js` + `demo/showcase.js`）：DEMO 构建的 `ensureSession()` 直接返回本地模拟会话（`demo: true`、`id: demo_<role>_visitor`），**不调用正式登录接口、不要求真实微信角色、不写正式会话缓存**。

`demo/demo-guard.js` 在 DEMO 构建下改为"develop/trial 环境 + 本机 DEMO 模拟会话"；**正式 main 分支不包含 `config/build-mode.js`，因此该分支永不生效，正式构建仍严格要求真实 developer 身份。**

---

## 4. 已复用的 DEMO 能力（未删改）

沿用并通过真机验证的既有演示交互全部保留：

- 学生模拟工作台（今日训练 / PB / 出勤 / 进步 / 通知 / 常用功能）；
- 家长模拟工作台（两名虚构学生切换 + 只读）；
- 通知与赛事详情（含返回列表与本地"标记已读"）；
- 家长页内快捷导航（`wx.pageScrollTo` + `sec-*` 锚点）；
- 亲子关联状态隔离（已生效 / 待审核）；
- 学生训练计划发布状态隔离（草稿不出现在学生端）。

---

## 5. 四角色展示入口

新增入口页 `pages/showcase/showcase`（「乔格训迹 V1.6 DEMO」），并置为 DEMO 构建的启动页：

| 角色 | 状态 | 说明 |
|---|---|---|
| 学生端 | **可体验** | 进入 `pages/demo/demo?role=student` |
| 家长端 | **可体验** | 进入 `pages/demo/demo?role=parent` |
| 教练员端 | D1-B 计划 | 点击提示"将在 D1-B 提供"，不做假跳转 |
| 开发者端 | D1-B 计划 | 同上 |

入口页常驻显示"DEMO｜虚构演示数据"横幅与隔离说明，并提供「清除本地演示身份」。

**四种身份均为模拟角色，访客不需要任何真实业务角色**，也不需要经过正式账号授权接口。

---

## 6. 演示数据

- 全部为本地虚构数据（`demo/student-demo.js`、`demo/parent-demo.js`），不含任何真实学生、家长、教练资料。
- 模拟训练组（可用于 D1-B 扩展）：中长跑队、四项组、专项组；支持模拟教练员轮换带队。
- 模拟操作只改变页面内存状态，不产生任何云端业务记录。

---

## 7. 安全验收（11 项自动化测试，全部行为级断言）

`tests/demo/isolation.test.js`：

1. 四角色入口存在，模拟会话不含真实 openid；
2. 未选择身份时守卫拒绝、选择后放行（develop/trial）；
3. 正式业务接口（6 个代表性方法）全部被拒，且 `wx.cloud.callFunction` **零调用**；
4. `app.js` 启动不调用 `wx.cloud.init`、`cloudReady` 为 `false`；
5. 启动会话不经过正式登录接口，返回本地模拟会话；
6. 真实开发者管理接口（7 个，含 bootstrap、角色授权、账号停用、健康检查）全部被拒且零云函数调用；
7. 展示入口只跳转本地演示页，不导航到任何正式管理页面；
8. 待审核家长关联不返回概览与六类受保护数据，受保护模块 `restricted`（含对照组：已生效可读）；
9. 学生端计划仅含已发布计划，草稿被过滤且数量一致；
10. 两个 Git 工作区相互独立，`main` 工作区干净且仍指向基线 `3274cbb`；
11. DEMO 分支未改动任何云函数与云端配置。

**DEMO 工作区全量测试：414 项通过 / 0 失败 / 0 TODO**（403 项既有 + 11 项 D1-A 隔离测试）。
结构校验 合计 1923 项（阶段1 1248）、JS 语法检查通过、WXML 结构与 JSON 校验通过。

---

## 8. 尚未完成（D1-B 范围）

1. 教练员端完整模拟业务：训练组管理、学生管理、成绩审核、考勤、赛事、反馈、统计；
2. 开发者端完整模拟业务：注册审核、角色与账号管理、训练组、系统状态、全局管理；
3. 两者的模拟数据模型（中长跑队 / 四项组 / 专项组 + 教练轮换）；
4. 教练/开发者模拟视图与四角色之间的一致导航。

---

## 9. 风险与注意事项

1. DEMO 构建**故意关闭**了云开发初始化：正式业务页面在该构建下不可用（预期行为）。
2. DEMO 分支与正式 `main` 共用同一仓库，合并前需人工确认**不要把 `config/build-mode.js` 与 `app.js`/`api.js` 的 DEMO 分支逻辑合并回 main**。
3. 正式项目本身（`main`）未做任何修改，仍是阶段1—F1-B2 的可交付状态。
