# F1-A 全站统一视觉规范｜乔格训迹 V1.6

**版本**：F1-A1（2026-10-14）　**基线提交**：`72e98e0`　**状态**：待人工审核
**适用范围**：全站 34 个页面 + 3 个公共组件
**前置关系**：本规范是 [F1_融合设计系统与交互规范](../ui-phase7/F1_融合设计系统与交互规范.md)（阶段7）的落地化与收敛版本。阶段7 定义了"应该长什么样"，本规范对照**当前实际代码**定义了"用什么色值、类名、尺寸实现"，并给出迁移路径。两者冲突时以本规范为准。

---

## 0. 设计原则

1. **专业优先**：整体定位是"专业田径训练管理系统"，不是宣传页。信息密度服务于扫读与对比，不做装饰性留白。
2. **深蓝为基**：`#103A6B` 是唯一品牌主色。深蓝只出现在导航栏、主按钮、深蓝竞技数据卡、重点标题。
3. **数据醒目**：成绩、PB、出勤率、排行等核心数值用大字号 + 等宽数字 + 高对比；数值永远比它旁边的标签更重。
4. **强调克制**：一屏内强调色不超过 2 种；能量橙只用于"学生主动作 / 当前或最优 / 最高优先级待办"三类语义。
5. **状态可辨**：通过 / 待处理 / 驳回 / 停用等状态必须**同时**有颜色、文字和形状（标签底色）三重区分，不依赖单一色相。
6. **不用装饰**：禁止大面积渐变、光晕、贴纸式插画、装饰性动画。唯一允许的渐变是深蓝竞技数据卡。

---

## 1. 颜色系统

### 1.1 品牌与强调（冷色主族）

| 令牌 | HEX | 用途 |
|---|---|---|
| `--jg-brand-900` | `#08203F` | 最深压暗面 |
| `--jg-brand-800` | `#0B2C55` | 数据卡渐变起点 |
| **`--jg-brand-700`** | **`#103A6B`** | **品牌主色**：主按钮、导航栏、重点标题 |
| `--jg-brand-600` | `#17509E` | 次级按钮、链接、区块标尺 |
| `--jg-brand-500` | `#1E63BC` | 进度条强调、焦点态 |
| `--jg-brand-100` | `#E9F1FB` | 图标底、浅色标签底 |
| `--jg-brand-050` | `#F4F8FE` | 说明区浅底 |

### 1.2 强调色（限量使用）

| 令牌 | HEX | 允许的语义 |
|---|---|---|
| `--jg-accent`（竞技青） | `#00A7C4` | 图表主序列、数据高亮、进度条强调 |
| `--jg-accent-2`（能量橙） | `#F2711C` | 学生端主行动按钮、当前/最优标记、最高优先级待办 |
| `--jg-accent-2-strong` | `#D95F0E` | 橙色**文字**（保证白底对比度） |

> 橙底白字（`#F2711C` + `#FFFFFF`）对比度约 3.0:1，只可用于 ≥27rpx 的粗体按钮文字；小号橙色文字一律用 `#D95F0E`。

### 1.3 状态色

| 语义 | 文字/描边 | 背景 | 用于 |
|---|---|---|---|
| 成功 / 通过 / 已签到 | `#0F7B5A` | `#E8F6F0` | 审核通过、签到、成绩提升 |
| 待处理 / 迟到 / 受限 | `#B45309` | `#FEF6E7` | 待审核、迟到、数据口径受限 |
| 危险 / 驳回 / 异常 | `#C0392B` | `#FDEDEB` | 驳回、停用、重要通知 |
| 中性信息 | `#17509E` | `#E9F1FB` | 提示、说明、普通标签 |

### 1.4 中性色与表面

| 令牌 | HEX | 用途 |
|---|---|---|
| `--jg-ink` | `#0E1A28` | 主文字（白底对比 ≈15.8:1） |
| `--jg-ink-2` | `#3B4A5A` | 次级文字（≈8.6:1） |
| `--jg-ink-3` | `#64748B` | 说明文字（≈4.8:1，正文下限） |
| `--jg-ink-4` | `#94A3B8` | 微标签/单位（**仅限短文本**） |
| `--jg-page-bg` | `#F2F5F9` | 页面背景 |
| `--jg-card-bg` | `#FFFFFF` | 卡片背景 |
| `--jg-card-2` | `#F7F9FC` | 次级面（输入底、刷新条） |
| `--jg-line` | `#E3E9F0` | 卡片与输入边框 |
| `--jg-line-2` | `#EDF1F6` | 列表行分隔线 |

### 1.5 深蓝竞技数据卡

| 令牌 | HEX | 用途 |
|---|---|---|
| `--jg-data-bg` → `--jg-data-bg-2` | `#0F3563` → `#0B2A50` | **全站唯一允许的渐变**（148° 线性） |
| `--jg-on-data` | `#EAF3FF` | 数据卡主文字/数值 |
| `--jg-on-data-dim` | `#9FC0E4` | 数据卡标签 |
| `--jg-data-accent` | `#57D3E8` | 数值单位、进度 |
| `--jg-data-accent-2` | `#FFC46B` | 目标线、待处理数值 |

**约束**：数据卡内禁止再嵌套白底卡片；一张数据卡只承载**一个**主数值（`.jg-data-num`），其余降级为 `.jg-data-col-v`。

### 1.6 遗留色系迁移映射（legacy → jg）

当前 26 个未改造页面使用阶段0—6 的**深青绿**色系，与品牌深蓝冲突。迁移时按下表机械替换：

| 遗留值 | 出现位置 | 替换为 |
|---|---|---|
| `#123C4D` | `.action`、`.button-primary`、`.trend-single-value` | `#103A6B` |
| `#207788` / `#437A86` | `.pill`、`.tag`、`.brand` | `#17509E` / `#17509E` |
| `#E9F6F8` | `.pill`、`.tag` 底 | `#E9F1FB` |
| `#E8F1F3` / `#174D58` | `.button-secondary` | `#FFFFFF` + 边框 `#E3E9F0` + 文字 `#3B4A5A` |
| `#FBE9E7` / `#A63A2B` | `.button-danger`、`.error` | `#FDEDEB` / `#C0392B` |
| `#E8F4EC` / `#23623F` | `.success` | `#E8F6F0` / `#0F7B5A` |
| `#FFF6E5` / `#976C23` | `.notice` | `#FEF6E7` / `#B45309` |
| `#F4F7FA` | `page` 背景、`app.json` backgroundColor | `#F2F5F9` |
| `#10263C` | `app.json` navigationBarBackgroundColor | `#103A6B` |
| `#14293D` | `page` 文字色 | `#0E1A28` |

---

## 2. 页面背景与容器规范

| 层级 | 规范 |
|---|---|
| 页面背景 | `#F2F5F9`；页面根容器统一 `class="jg-page jg-safe-bottom"` |
| 页面内边距 | `24rpx 28rpx 40rpx`（`.jg-page` 已内置） |
| 底部安全区 | `padding-bottom: calc(24rpx + env(safe-area-inset-bottom))`（`.jg-safe-bottom`） |
| 白卡 | `.jg-card`：白底 + `2rpx` 边框 `#E3E9F0` + `32rpx` 圆角 + 微阴影 |
| 列表卡 | `.jg-list`：白底 + `2rpx` 边框 + `32rpx` 圆角，行间用 `#EDF1F6` 分隔线 |
| 说明条 | `.jg-note`：`#F4F8FE` 底 + `#D5E3F6` 边框（警示变体 `.jg-note-warn`） |

**禁止**：白卡套白卡；页面区块用浮动卡片堆叠（区块一律直接铺在页面背景上，用 `.jg-sect` 拉开）。

---

## 3. 字体与信息层级

| 级别 | 字号 | 用途 |
|---|---|---|
| 数据主数值 | **66rpx** | PB、核心指标（仅数据卡内） |
| 大数值 | 50rpx | 排行榜成绩、次级数值 |
| 指标数值 | 44rpx | 指标卡、数据卡列值 |
| 页面标题 | 42rpx | `.jg-head-title` |
| 区块标题 | 33rpx | `.jg-sect-t` |
| 列表主文 | 29rpx / 27rpx | 卡片标题 / 列表行标题 |
| **正文字号（下限）** | **27rpx** | 按钮、输入值、正文 |
| 紧凑正文 | 25rpx | 表格、行内按钮 |
| 次要说明 | 24rpx | 时间、范围、状态说明 |
| 微标签 | 22rpx | 单位、角标（**仅限短文本**） |

**硬规则**
- 正文不得小于 27rpx；22rpx 不得用于句子级文本。
- 数值字号 ≥ 其标签字号的 **1.5 倍**才允许放入数据卡。
- 数字统一字体族：`"DIN Alternate","Bahnschrift","SF Mono",Consolas,monospace`，并同时声明
  `font-variant-numeric: tabular-nums;` **与** `font-feature-settings: "tnum";`（前者在部分 iOS 微信版本不生效，需要后者兜底）。
- 数值与单位分离；单位用 24rpx/22rpx 常驻显示。
- 字重：标题 700；列表主文 700；说明 400–600；数值 700–800。

---

## 4. 间距与栅格

| 场景 | 值 |
|---|---|
| 基础间距单位 | 8rpx |
| 页面左右留白 | 28rpx |
| 区块之间 | 24rpx（`.jg-sect` margin-bottom） |
| 区块标题 → 内容 | 16rpx |
| 卡片内边距 | 28rpx（数据卡 32rpx） |
| 卡片之间 | 24rpx |
| 行内元素间距 | 12rpx |
| 触控目标最小高度 | **88rpx**（`.jg-touch` 令牌） |

**两列栅格**：`.jg-tiles` 用 `width:50%` + 奇偶列内边距差 8rpx（已实现），**不要**改用 `gap`（见 §10）。

文本排版：中文正文行高 1.5–1.6；数值行高 1.0–1.1；长文本一律允许换行（`word-break: break-word`），禁止横向溢出。

---

## 5. 圆角、边框与阴影

| 元素 | 圆角 |
|---|---|
| 页面级卡片、数据卡、空状态 | 32rpx |
| 常用功能瓦片 | 28rpx |
| 指标卡、说明条、状态块 | 24rpx |
| 按钮、输入框 | 24rpx / 20rpx（小按钮 20rpx） |
| 图标底 | 22rpx（行图标）/ 20rpx（瓦片图标） |
| 标签、进度条 | 16rpx / 999rpx（胶囊） |

| 元素 | 边框 |
|---|---|
| 卡片、输入、幽灵按钮 | `2rpx solid #E3E9F0` |
| 列表行分隔 | `2rpx solid #EDF1F6` |
| 状态标签 | `2rpx` 同色系描边 |

| 元素 | 阴影 |
|---|---|
| 普通卡片 | `0 2rpx 4rpx rgba(14,26,40,.06)`（保持极轻） |
| 深蓝数据卡 | `0 24rpx 56rpx rgba(16,58,107,.18)`（全站唯一强阴影） |

**约束**：阴影不得超过两级；禁止彩色光晕、内阴影、多重堆叠阴影。

---

## 6. 按钮与交互状态

### 6.1 按钮类型

| 类 | 外观 | 用途 |
|---|---|---|
| `.jg-btn`（默认） | 深蓝 `#103A6B` 实底 + 白字 | 主操作 |
| `.jg-btn-accent` | 橙 `#F2711C` 实底 + 白字 | 学生端主动作（限量） |
| `.jg-btn-ghost` | 白底 + `#E3E9F0` 边框 + `#3B4A5A` 文字 | 次级操作 |
| `.jg-btn-danger` | 白底 + `#EFC8C3` 边框 + `#C0392B` 文字 | 驳回 / 停用 |
| `.jg-btn-block` | 宽度 100% | 卡片内主操作 |
| `.jg-btn-sm` | 最小高度仍 88rpx，内边距收窄 | 行内操作 |

### 6.2 状态

| 状态 | 规范 |
|---|---|
| 默认 | 见上表 |
| 按下 | 用 `hover-class` 施加浅底（`#F4F8FE`）；**不使用** `transform: scale`（会导致重排抖动） |
| 禁用 | `#DDE5ED` 底 + `#93A2B2` 字（`.jg-btn-disabled`），`disabled` 属性仍必须设置 |
| 加载中 | 用小程序原生 `loading="{{...}}"` 属性，不自定义转圈 |
| 破坏性操作 | 一律走 `wx.showModal` 二次确认，按钮为 `.jg-btn-danger` |

### 6.3 触控目标

- 所有可点击控件最小高度 **88rpx**；行内小按钮通过"最小高度不变、内边距收窄"实现视觉紧凑。
- 纯展示标签（`.jg-chip`）不可点击；**若要点击**（筛选、角色切换），必须改用 `.jg-jump-chip`（56rpx）以上并在后续统一提升到 72rpx。

---

## 7. 数据卡片与统计展示

| 组件 | 类 | 说明 |
|---|---|---|
| 深蓝竞技数据卡 | `.jg-data-card` | 含 `.jg-data-k`（标签）/`.jg-data-v`+`.jg-data-num`（主数值）/`.jg-data-meta`（说明）/`.jg-data-foot`（标签组）/`.jg-data-cols`+`.jg-data-col`（列值）/`.jg-data-prog`（进度） |
| 白底指标卡 | `.jg-kpi-row` + `.jg-kpi` | 2 列并排；`.jg-kpi-l`/`.jg-kpi-v`/`.jg-kpi-s` |
| 四列数据条 | `.jg-dstrip` + `.jg-ds` | 出勤应到/已签/迟到/待签等同类计数 |
| 进度条 | `.jg-prog` + `.jg-prog-in[-ok/-warn/-accent]` | 通用进度 |
| 排行行 | `.jg-row` + `.jg-row-v` | 右侧数值用等宽数字 |

**使用规则**
- 一屏最多 **1 张**深蓝数据卡；需要第二个核心指标时用 `.jg-kpi-row`。
- 数据卡缺失数据时必须给出**文字说明**（如"暂无已审核的正式成绩"），不得显示 `-`/`0` 冒充有效值。
- 数据卡内的统计口径说明放 `.jg-data-meta` 或 `.jg-note`，不得省略"估算口径"提示。
- 数值与单位之间的空格、单位大小统一按 §3。

---

## 8. 业务状态标签

| 类 | 背景 | 文字 | 典型语义 |
|---|---|---|---|
| `.jg-chip`（中性） | `#F7F9FC` | `#3B4A5A` | 默认、普通 |
| `.jg-chip-brand` | `#E9F1FB` | `#103A6B` | 身份、角色、进行中 |
| `.jg-chip-ok` | `#E8F6F0` | `#0F7B5A` | 已通过、已签到、启用中 |
| `.jg-chip-warn` | `#FEF6E7` | `#B45309` | 待处理、迟到、待核实 |
| `.jg-chip-danger` | `#FDEDEB` | `#C0392B` | 驳回、停用、异常 |
| `.jg-chip-accent` | `#FDEDE2` | `#D95F0E` | 家长注册、需关注、赛事意向 |

- 胶囊圆角 16rpx、字号 22rpx、字重 700、内边距 `8rpx 16rpx`。
- 状态标签必须与**文字**同时存在，禁止仅用颜色表达状态（色盲可读性）。
- 同一语义全站同色：例如"待审核"永远 warn，"已通过"永远 ok。

---

## 9. 空 / 加载 / 错误状态

| 状态 | 实现 | 规范 |
|---|---|---|
| 首次加载 | `.jg-skeleton` / `.jg-skeleton-row` / `.jg-skeleton-card` | 必须有反馈，禁止白屏；骨架块高度按真实内容预估 |
| 空数据 | `<jg-empty>` 组件 | 标题 + 说明；仅在"该用户确实无数据"时使用；可选一个行动按钮 |
| 区块错误 | `.jg-state-err` + `.jg-retry` | 保留其它正常区块（局部失败不清空整页）；重试按钮 ≥88rpx |
| 静默刷新 | `.jg-refbar` | 已有数据时不显示骨架，只显示"正在刷新 / 数据更新于 HH:MM" |
| 部分失败 | `.jg-refbar-warn` | 文案必须说明"当前显示的是上次成功加载的数据" |

**禁止**：用大块留白的空状态占据整屏；空状态高度应受控（`jg-empty` 组件内边距 48/32rpx）。

---

## 10. 微信小程序 WXSS 实现约束

| 能力 | 结论 | 要求 |
|---|---|---|
| CSS 变量 | 基础库 2.x+ 支持 | 允许；`var(--jg-*, fallback)` 必须带 fallback |
| `env(safe-area-inset-*)` | 支持 | 底部安全区必须使用 |
| `calc()` | 支持 | 允许 |
| `gap`（flex） | 旧版本 iOS 微信存在不生效/不换行问题 | **新代码禁止在 flex 用 `gap`**，改用 margin（现存 `.jg-refbar` 的 `gap` 列为 F1-A2 待修） |
| `position: sticky` | 支持不稳定 | 禁止用于关键导航 |
| `backdrop-filter` | 不可靠 | **禁止** |
| `box-shadow` | 支持但耗渲染 | 仅两级、保持极轻 |
| `font-variant-numeric` | 部分 iOS 版本不生效 | 必须同时写 `font-feature-settings: "tnum"` |
| 多行省略 | 需 `-webkit-line-clamp` | 单行用 `text-overflow`；多行用 `-webkit-line-clamp` 并给 `display:-webkit-box` |
| `100vh` | 支持 | 允许 |
| `rem` / `em` | 不推荐 | **统一用 rpx** |
| 伪元素 | 支持（`:after` 常用） | 按钮去边框沿用 `::after { border: none }` |

---

## 11. 响应式规则

设计基准宽度 **750rpx = 375pt**，rpx 自动缩放，因此**不要**再写媒体查询做等比缩放。

| 断点 | 设备 | 要求 |
|---|---|---|
| ≤ 375pt（750rpx 基准） | iPhone SE / 12 mini | 最小验证宽度；两列瓦片、按钮组不得溢出 |
| 390–393pt | iPhone 12/13/14/15 | 主要目标机型 |
| 414–430pt | Plus / Pro Max | 卡片留白自然变大，不得出现内容居中塌缩 |
| 平板 / 桌面模拟器（≥768pt） | 微信 PC/平板 | 内容按 rpx 放大，**不加 max-width 限制**（当前 34 页均无最大宽度约束，保持一致） |

**必查项（每个改造页面）**
1. 文字换行：长训练组名、长通知标题、长学生姓名不溢出、不截断关键信息。
2. 卡片溢出：两列瓦片在 375pt 下内边距正确（奇偶列差 8rpx）。
3. 按钮触控：≥88rpx；竖向排列的待办按钮（coach/admin 已有局部覆盖）在 375pt 下不压缩。
4. 导航区域：返回后回到正确工作台；`reLaunch` 与 `navigateTo` 语义不被样式影响。
5. 安全区域：底部留白 `env(safe-area-inset-bottom)`。
6. 滚动行为：长页面（家长工作台）用页内跳转而非 sticky 吸顶。
7. 多角色切换：`全部功能` 页角色 chip 在 375pt 下换行正常。

---

## 12. 可复用组件与样式清单

### 12.1 组件（3 个）

| 组件 | 路径 | 能力 | 自包含 |
|---|---|---|---|
| `jg-page-head` | `components/jg-page-head` | `title` / `meta` / `roleLabel` / `roleTone`(brand\|accent\|mute) + `slot` | 是（不依赖 app.wxss） |
| `jg-empty` | `components/jg-empty` | `title` / `message` / `actionText` + `bind:action` | 是 |
| `trend-chart` | `components/trend-chart` | Canvas 趋势图，`series` 数据契约 | 是（**不改造**，供 F1-B/C 复用） |

### 12.2 公共样式（`app.wxss` 的 `jg-` 区块，148 个类）

可直接复用的分组：

- **文字**：`.jg-h1/.jg-h2/.jg-h3/.jg-body/.jg-body-s/.jg-sub/.jg-cap/.jg-strong/.jg-truncate/.jg-num`
- **结构**：`.jg-page/.jg-safe-bottom/.jg-sect/.jg-sect-h/.jg-sect-t/.jg-sect-a/.jg-sect-c`
- **容器**：`.jg-card/.jg-card-flush/.jg-card-h/.jg-card-t/.jg-card-a/.jg-card-c`
- **数据**：`.jg-data-*`（卡片全套）、`.jg-kpi-*`、`.jg-dstrip/.jg-ds-*`、`.jg-prog*`
- **标签**：`.jg-chip*`、`.jg-badge`、`.jg-jump/.jg-jump-chip*`
- **列表/待办**：`.jg-list/.jg-row*/.jg-todo*/.jg-chev`
- **按钮**：`.jg-btn*`、`.jg-btn-row`、`.jg-actions-wrap`
- **表单**：`.jg-field-row/.jg-field-label/.jg-field-body/.jg-input/.jg-picker/.jg-picker-empty`
- **状态**：`.jg-state*/.jg-retry/.jg-skeleton*/.jg-note*/.jg-refbar*`
- **入口**：`.jg-tiles/.jg-tile/.jg-tile-{brand|ok|accent|plain}`
- **间距**：`.jg-mt-0/8/12/16`、`.jg-mb-12`

### 12.3 未被引用样式（26 个，需处置）

静态扫描（WXML+JS+JSON 全量匹配）发现以下类**从未被引用**：

```
jg-badge jg-btn-disabled jg-cap jg-card-flush jg-data-prog jg-data-prog-in
jg-ds-s jg-h1 jg-h2 jg-h3 jg-head jg-head-main jg-head-meta jg-head-right
jg-head-title jg-legacy-container jg-mt-16 jg-num jg-picker-empty
jg-prog-in-accent jg-prog-in-warn jg-state jg-state-m jg-state-t jg-todo-p3
jg-truncate
```

> **重要**：其中 `jg-todo-p3` 与 `jg-chip-*` 变体是**动态拼接**使用（如 `class="jg-todo {{item.priority}}"`、`typeChip: 'jg-chip-warn'`），**不是死代码**。经人工确认真正未使用的是上表中除 `jg-todo-p3` 之外的项（25 个），处置建议见审查报告。

`jg-head*`（7 个）已被 `jg-page-head` 组件取代，属重复定义。

---

## 13. F1-B / F1-C 可复用规范

以下规范与学生/教练/家长/开发者四个工作台无关，**可直接套用到其余 26 个业务页面**：

1. **迁移公式**：页面根容器改 `class="jg-page jg-safe-bottom"`；`.container` → `.jg-page`；`.card` → `.jg-card`；`.section-title` → `.jg-sect-t`；`.button-primary` → `.jg-btn`；`.button-secondary` → `.jg-btn-ghost`；`.button-danger` → `.jg-btn-danger`；`.input/.picker-field/.textarea` → `.jg-input/.jg-picker/.jg-input`；`.empty` → `<jg-empty>`；`.error` → `.jg-state-err`；`.notice` → `.jg-note-warn`；`.tag` → `.jg-chip`。
2. **色值替换**：按 §1.6 映射表机械替换遗留青绿。
3. **导航栏**：`app.json` 的 `navigationBarBackgroundColor` 由 `#10263C` 改为 `#103A6B`，`backgroundColor` 由 `#F4F7FA` 改为 `#F2F5F9`（全站一次性）。
4. **表单页**：统一用 `.jg-field-row/.jg-field-label/.jg-field-body` 三段式，标签宽度 168rpx。
5. **表格/排行页**：统一用 `.jg-list/.jg-row`，右侧数值 `.jg-row-v` + 等宽数字，禁用 `<table>` 式自绘。
6. **图表页**：`trend-chart` 不改；仅把容器与标题改为 `.jg-card` + `.jg-card-t`，配色随 §1.1 的竞技青。
7. **批量导出/审核页**：主行动 `.jg-btn`，危险行动 `.jg-btn-danger`，全部走二次确认。
8. **不做的事**：不引入第三方 UI 库；不改数据统计口径；不改接口与权限；不为了统一外观重排信息架构。

---

## 14. 落地检查表（每个页面改造后自检）

- [ ] 根容器 `jg-page jg-safe-bottom`
- [ ] 无遗留青绿 HEX（§1.6 映射表全部替换）
- [ ] 无 `gap`、无 `backdrop-filter`、无 `sticky`
- [ ] 正文 ≥27rpx，无 22rpx 句子
- [ ] 数值用等宽字体 + tabular-nums + font-feature-settings
- [ ] 可点击控件 ≥88rpx
- [ ] 一屏 ≤1 张深蓝数据卡、强调色 ≤2 种
- [ ] 空/加载/错误三态齐备
- [ ] 375pt 与 390pt 下无溢出、无截断
- [ ] 业务逻辑、接口、路由、权限零改动
