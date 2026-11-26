'use strict';

/**
 * 乔格训迹系统 V1.6.5 UI 重设计提案共享演示数据
 * 严格约束：
 * - 纯本地虚构数据，不含任何真实学生姓名、照片、OpenID
 * - 产品事实：四角色（学生/教练含开发兼教练/家长只读/开发者）
 * - 不存在：签退、请假附件、AI训练计划、第三方体测设备对接、付费功能
 * - 赛事：内部意向收集与材料审核 ≠ 外部官方报名成功
 * - 小程序无原生 tabBar，底部仅为页面内区块跳转
 */
window.JOGER_V165_DATA = {
  version: 'V1.6.5',
  demoBanner: 'V1.6.5 演示数据｜仅用于动效与交互预览（未接入接口）',
  screens: [
    { id: '01-student', short: '学生', label: '学生首页', role: '学生' },
    { id: '02-coach', short: '教练', label: '教练工作台', role: '教练员' },
    { id: '03-parent', short: '家长', label: '家长工作台', role: '家长（只读）' },
    { id: '04-developer', short: '开发', label: '开发者控制台', role: '开发者' },
    { id: '05-stats', short: '统计', label: '统计与排行', role: '跨角色' },
    { id: '06-attendance', short: '考勤', label: '考勤签到', role: '学生 / 教练' },
    { id: '07-plan', short: '计划', label: '训练计划编辑', role: '教练员' },
    { id: '08-motion', short: '动效', label: '动效演示页', role: 'V1.6.5 动效实验室' }
  ],
  student: {
    name: '林予安（虚构）',
    group: '短跑一队 · 2026秋',
    coach: '陈景行教练',
    joinedDays: 142,
    pb: {
      event: '100米',
      numeric: 11.42,
      decimals: 2,
      unit: '秒',
      date: '2026-11-12',
      reviewer: '陈景行教练',
      prevValue: '11.61 秒',
      delta: '-0.19 秒',
      status: '教练已审核入榜'
    },
    monthlyAttendance: {
      valid: 14,
      expected: 16,
      rateNumeric: 87.5,
      approvedLeave: 1
    },
    todaySession: {
      title: '起跑加速与 30 米冲刺',
      time: '16:30 - 18:10',
      location: '东区标准田径场 · 1号跑道',
      checkInWindow: '16:15 - 16:45',
      status: '开放主动签到中'
    },
    timeline: [
      { time: '16:15', title: '开启主动定位签到窗口', meta: '东区田径场 150m 围栏 · 无签退', status: '当前' },
      { time: '16:30', title: '动态热身与高抬腿 3×30m', meta: '主项速度准备 · 人工编排计划', status: '待执行' },
      { time: '17:05', title: '蹲踞式起跑加速 6×30m', meta: '间歇 180 秒 · 组后填写 RPE 反馈', status: '待执行' }
    ],
    notices: [
      { id: 'n1', priority: '重要', title: '市青少年公开赛意向与材料核验截止提醒', date: '11-26', unread: true },
      { id: 'n2', priority: '普通', title: '周四晚间训练场地临时调整至室内直道', date: '11-25', unread: false }
    ],
    quickEntries: [
      { label: '主动签到', screen: '06-attendance', tag: '开放中' },
      { label: '成绩榜单', screen: '05-stats', tag: '已审核' },
      { label: '计划编排', screen: '07-plan', tag: '人工发布' },
      { label: '动效演示', screen: '08-motion', tag: '13 项' }
    ]
  },
  coach: {
    name: '陈景行（虚构 · 教练/开发兼岗）',
    todayFocus: {
      title: '短跑一队 · 傍晚田径场考勤',
      date: '2026-11-27',
      window: '16:15 - 16:45',
      checkedIn: 14,
      expected: 18,
      rateNumeric: 77.8,
      late: 1,
      pendingVerify: 2,
      leaveApproved: 1
    },
    todos: [
      { id: 't1', type: '待批请假', student: '周致远（虚构）', detail: '11-27 晚间训练 · 物理实验冲突（系统无请假附件）', priority: 'P1', time: '10分钟前' },
      { id: 't2', type: '待审成绩', student: '林予安（虚构）', detail: '200米 23.48 秒 · 核验通过后方可计入正式排行', priority: 'P1', time: '28分钟前' },
      { id: 't3', type: '待审注册', student: '许知微（虚构）', detail: '申请加入短跑一队 · 主项立定跳远', priority: 'P2', time: '1小时前' },
      { id: 't4', type: '待核材料', student: '顾明朗（虚构）', detail: '市青少年田径公开赛 · 体检与责任书材料（2份）', priority: 'P1', time: '2小时前' }
    ],
    competitions: [
      { id: 'c1', title: '2026 市青少年田径公开赛', intentCount: 12, materialCount: 9, status: '内部核验中（未提交官方平台）' },
      { id: 'c2', title: '冬季室内测试邀请赛', intentCount: 8, materialCount: 8, status: '教练已外部汇总提交' }
    ]
  },
  parent: {
    students: [
      {
        id: 'stu1',
        name: '林予安（虚构）',
        group: '短跑一队',
        event: '100米',
        pbNumeric: 11.42,
        pbUnit: '秒',
        pbText: '11.42 秒',
        pbDate: '2026-11-12',
        pbReviewer: '陈景行教练',
        attendanceNumeric: 87.5,
        validDays: '14 / 16 场',
        approvedLeave: '1 场',
        plans: [
          { title: '速度耐力周计划（第4周）', period: '11-24 至 11-30', items: '30m×6组 · 150m×4组 · 核心稳定性' }
        ],
        performances: [
          { event: '100米', value: '11.42 秒', date: '2026-11-12' },
          { event: '立定跳远', value: '2.78 米', date: '2026-11-04' }
        ],
        attendance: [
          { date: '11-26', status: '已签到（家长端不展示精确坐标）' },
          { date: '11-24', status: '迟到（家长端不展示精确坐标）' },
          { date: '11-22', status: '已批准请假' }
        ],
        feedback: [
          { date: '11-26', completion: '全部完成', rpe: '7/10' },
          { date: '11-24', completion: '部分完成', rpe: '8/10' }
        ],
        events: [
          { type: '赛事意向', title: '2026 市青少年田径公开赛（100米）', badge: '内部核验中' },
          { type: '俱乐部通知', title: '本周六赛事材料截止提醒', badge: '重要' }
        ]
      },
      {
        id: 'stu2',
        name: '林予宁（虚构）',
        group: '中长跑二队',
        event: '800米',
        pbNumeric: 138.6,
        pbUnit: '秒',
        pbText: "2'18.60",
        pbDate: '2026-11-10',
        pbReviewer: '沈清川教练',
        attendanceNumeric: 93.8,
        validDays: '15 / 16 场',
        approvedLeave: '0 场',
        plans: [
          { title: '有氧节奏跑周计划', period: '11-24 至 11-30', items: '400m×6组 · 2000m节奏跑 · 拉伸恢复' }
        ],
        performances: [
          { event: '800米', value: "2'18.60", date: '2026-11-10' },
          { event: '1500米', value: "4'46.20", date: '2026-10-28' }
        ],
        attendance: [
          { date: '11-26', status: '已签到（家长端不展示精确坐标）' },
          { date: '11-25', status: '已签到（家长端不展示精确坐标）' }
        ],
        feedback: [
          { date: '11-26', completion: '全部完成', rpe: '6/10' }
        ],
        events: [
          { type: '俱乐部通知', title: '冬季中长跑热身要求说明', badge: '普通' }
        ]
      }
    ],
    sections: [
      { id: 'overview', label: '概览' },
      { id: 'plans', label: '计划' },
      { id: 'performance', label: '成绩' },
      { id: 'attendance', label: '考勤' },
      { id: 'feedback', label: '反馈' },
      { id: 'events', label: '赛事通知' }
    ]
  },
  developer: {
    system: {
      env: 'cloud1-d8g0egkli3191959a',
      apiStatus: 'Active · 20s 超时',
      collectionsCount: 23,
      storageAcl: 'PRIVATE（仅创建者及管理员）',
      pendingReviews: 4
    },
    approvals: [
      { id: 'a1', name: '许知微（虚构）', roleType: '学生注册', detail: '短跑一队 · 实名待核验', time: '14:20' },
      { id: 'a2', name: '苏明远（虚构）', roleType: '家长关联终审', detail: '学生已确认 · 待开发者核验', time: '13:05' },
      { id: 'a3', name: '陆承泽（虚构）', roleType: '教练实名申请', detail: '跳跃专项组 · 待审批', time: '昨天' }
    ],
    groups: [
      { id: 'g1', name: '短跑一队 · 2026秋', coaches: '陈景行', students: 24, enabled: true },
      { id: 'g2', name: '中长跑二队 · 2026秋', coaches: '沈清川', students: 19, enabled: true },
      { id: 'g3', name: '跳跃专项组 · 2026秋', coaches: '陈景行', students: 14, enabled: true }
    ]
  },
  stats: {
    periods: [
      { key: 'month', label: '本月' },
      { key: 'quarter', label: '本季' },
      { key: 'year', label: '本年' }
    ],
    chartEvents: {
      '100m': {
        label: '100米（秒，越低越快）',
        unit: '秒',
        lowerBetter: true,
        points: [
          { x: '08月', y: 11.88 },
          { x: '09月', y: 11.74 },
          { x: '10月', y: 11.61 },
          { x: '11上', y: 11.53 },
          { x: '11中', y: 11.42 }
        ]
      },
      '200m': {
        label: '200米（秒，越低越快）',
        unit: '秒',
        lowerBetter: true,
        points: [
          { x: '08月', y: 24.35 },
          { x: '09月', y: 24.08 },
          { x: '10月', y: 23.86 },
          { x: '11上', y: 23.62 },
          { x: '11中', y: 23.48 }
        ]
      },
      'jump': {
        label: '立定跳远（米，越高越好）',
        unit: '米',
        lowerBetter: false,
        points: [
          { x: '08月', y: 2.61 },
          { x: '09月', y: 2.66 },
          { x: '10月', y: 2.71 },
          { x: '11上', y: 2.74 },
          { x: '11中', y: 2.78 }
        ]
      }
    },
    performance: {
      month: [
        { id: 'r-lin', rank: 1, name: '林予安（本人）', group: '短跑一队', coach: '陈景行', value: '11.42 秒', scorePct: 96, pb: '11.42 秒' },
        { id: 'r-zhou', rank: 2, name: '周**', group: '短跑一队', coach: '陈景行', value: '11.58 秒', scorePct: 86, pb: '11.51 秒' },
        { id: 'r-xu', rank: 3, name: '许**', group: '短跑一队', coach: '陈景行', value: '11.74 秒', scorePct: 76, pb: '11.69 秒' },
        { id: 'r-gu', rank: 4, name: '顾**', group: '短跑一队', coach: '陈景行', value: '11.86 秒', scorePct: 68, pb: '11.63 秒' }
      ],
      quarter: [
        { id: 'r-lin', rank: 1, name: '林予安（本人）', group: '短跑一队', coach: '陈景行', value: '11.42 秒', scorePct: 96, pb: '11.42 秒' },
        { id: 'r-zhou', rank: 2, name: '周**', group: '短跑一队', coach: '陈景行', value: '11.51 秒', scorePct: 91, pb: '11.51 秒' },
        { id: 'r-gu', rank: 3, name: '顾**', group: '短跑一队', coach: '陈景行', value: '11.63 秒', scorePct: 83, pb: '11.63 秒' },
        { id: 'r-xu', rank: 4, name: '许**', group: '短跑一队', coach: '陈景行', value: '11.69 秒', scorePct: 79, pb: '11.69 秒' }
      ],
      year: [
        { id: 'r-zhou', rank: 1, name: '周**', group: '短跑一队', coach: '陈景行', value: '11.39 秒', scorePct: 98, pb: '11.39 秒' },
        { id: 'r-lin', rank: 2, name: '林予安（本人）', group: '短跑一队', coach: '陈景行', value: '11.42 秒', scorePct: 95, pb: '11.42 秒' },
        { id: 'r-gu', rank: 3, name: '顾**', group: '短跑一队', coach: '陈景行', value: '11.55 秒', scorePct: 87, pb: '11.55 秒' },
        { id: 'r-xu', rank: 4, name: '许**', group: '短跑一队', coach: '陈景行', value: '11.69 秒', scorePct: 78, pb: '11.69 秒' }
      ]
    },
    attendance: {
      month: [
        { id: 'a-zhou', rank: '—', name: '周**', group: '短跑一队', valid: '15/16', rate: '93.8%', scorePct: 94, note: '样本充足（估算口径）' },
        { id: 'a-lin', rank: '—', name: '林予安（本人）', group: '短跑一队', valid: '14/16', rate: '87.5%', scorePct: 88, note: '样本充足（估算口径）' },
        { id: 'a-xu', rank: '—', name: '许**', group: '短跑一队', valid: '2/2', rate: '100.0%', scorePct: 50, note: '样本不足(<3场不领先)' }
      ],
      quarter: [
        { id: 'a-zhou', rank: '—', name: '周**', group: '短跑一队', valid: '41/44', rate: '93.2%', scorePct: 93, note: '样本充足（估算口径）' },
        { id: 'a-lin', rank: '—', name: '林予安（本人）', group: '短跑一队', valid: '39/44', rate: '88.6%', scorePct: 89, note: '样本充足（估算口径）' }
      ],
      year: [
        { id: 'a-zhou', rank: '—', name: '周**', group: '短跑一队', valid: '128/138', rate: '92.8%', scorePct: 93, note: '样本充足（估算口径）' },
        { id: 'a-lin', rank: '—', name: '林予安（本人）', group: '短跑一队', valid: '122/138', rate: '88.4%', scorePct: 88, note: '样本充足（估算口径）' }
      ]
    }
  },
  attendance: {
    spots: [
      { id: 'east', label: '东区田径场', coordText: '31.2304°, 121.4737°（降精度4位）', radius: '150 米' },
      { id: 'indoor', label: '室内直道馆', coordText: '31.2312°, 121.4749°（降精度4位）', radius: '100 米' },
      { id: 'strength', label: '体能训练房', coordText: '31.2298°, 121.4728°（降精度4位）', radius: '80 米' }
    ]
  },
  plan: {
    types: ['单日专项', '周循环', '赛前减量'],
    initialItems: [
      { id: 1, name: '动态热身与高抬腿', sets: '3组', reps: '30米', rest: '60秒' },
      { id: 2, name: '蹲踞式起跑加速', sets: '6组', reps: '30米', rest: '180秒' },
      { id: 3, name: '途跑节奏保持', sets: '4组', reps: '120米', rest: '240秒' }
    ]
  },
  motionLabItems: [
    { id: 'm01', title: '01 页面切换（前进/后退）', desc: '区分前进/后退方向并触发遮罩/容器过渡（≤320ms）' },
    { id: 'm02', title: '02 列表 Stagger 入场', desc: '32–40ms 错峰，位移 ≤12px，仅 transform/opacity' },
    { id: 'm03', title: '03 数字滚动 Count-up', desc: '600ms 等宽数字（tabular-nums）平滑递增不抖动' },
    { id: 'm04', title: '04 骨架屏扫光 → 淡入', desc: '1.2s transform 扫光后，内容 200ms 上移淡入' },
    { id: 'm05', title: '05 底部抽屉（支持下滑关）', desc: '弹性打开、遮罩 200ms 渐入、手势下滑关闭' },
    { id: 'm06', title: '06 表单聚焦流光 & 校验抖动', desc: '聚焦底光流动；空值校验触发单次 ≤200ms 横抖' },
    { id: 'm07', title: '07 提交变形进度环 → 成功确认', desc: '按钮文字变形进度环，成功后 400ms 环形确认收起' },
    { id: 'm08', title: '08 角色/学生局部过渡切换', desc: '仅内容区遮罩/形变切换，外壳保持稳定不整页刷新' },
    { id: 'm09', title: '09 Canvas 2D 趋势图生长', desc: '折线左到右绘制，数值标签延迟 120ms 淡入，支持空/估算态' },
    { id: 'm10', title: '10 自定义下拉刷新指示器', desc: '深蓝高亮自定义赛道弧形指示器拉下、旋转并回弹' },
    { id: 'm11', title: '11 空态插画淡出 → 列表滑入', desc: '空态 SVG 缩淡退场，实测数据列表错峰滑入' },
    { id: 'm12', title: '12 左滑审批 & 长按多选手势', desc: '指针左滑展开核验操作；长按或点击切换多选态' },
    { id: 'm13', title: '13 方案招牌动效（唯一记忆点）', desc: '触发当前方案专属招牌动效（≤600ms）' }
  ]
};
