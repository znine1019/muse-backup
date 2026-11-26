'use strict';

/**
 * R3 三套 UI 原型共享虚构演示数据（纯本地静态文件，严禁包含真实学生信息）
 * 产品事实约束：
 * - 四角色：学生、教练、家长（只读）、开发者
 * - 不存在：签退、请假附件、AI训练计划、第三方体测设备对接、付费功能
 * - 赛事：内部意向与材料审核 ≠ 外部官方报名成功
 */
window.JOGER_R3_DATA = {
  demoBanner: '演示数据｜仅用于视觉预览',
  screens: [
    { id: '01-student', short: '学生', label: '学生首页', role: '学生' },
    { id: '02-coach', short: '教练', label: '教练工作台', role: '教练员' },
    { id: '03-parent', short: '家长', label: '家长工作台', role: '家长（只读）' },
    { id: '04-developer', short: '开发', label: '开发者控制台', role: '开发者' },
    { id: '05-stats', short: '统计', label: '统计与排行', role: '跨角色' },
    { id: '06-attendance', short: '考勤', label: '考勤签到', role: '学生 / 教练' },
    { id: '07-plan', short: '计划', label: '训练计划编辑', role: '教练员' }
  ],
  student: {
    name: '林予安（虚构）',
    group: '短跑一队 · 2026秋',
    coach: '陈景行教练',
    joinedDays: 142,
    primaryEvent: '100米',
    pb: { event: '100米', value: '11.42', unit: '秒', date: '2026-11-12', status: '教练已审核' },
    monthlyAttendance: { valid: 14, expected: 16, rate: '87.5%', approvedLeave: 1 },
    todaySession: {
      title: '起跑加速与30米冲刺',
      time: '16:30 - 18:10',
      location: '东区标准田径场 · 1号跑道',
      checkInWindow: '16:15 - 16:45',
      status: '待主动定位签到'
    },
    notices: [
      { id: 'n1', priority: '重要', title: '本周六秋季校际赛报名意向与材料截止提醒', date: '11-26', unread: true },
      { id: 'n2', priority: '普通', title: '周四晚间训练场地临时调整至室内直道', date: '11-25', unread: false }
    ],
    quickEntries: [
      { label: '主动签到', screen: '06-attendance', tag: '开放中' },
      { label: '成绩申报', screen: '05-stats', tag: '需审核' },
      { label: '赛事材料', screen: '02-coach', tag: '1/3份' },
      { label: '训练计划', screen: '07-plan', tag: '已发布' }
    ]
  },
  coach: {
    name: '陈景行（虚构）',
    groups: ['短跑一队', '跳跃专项组'],
    todayFocus: {
      title: '短跑一队 · 傍晚田径场考勤',
      date: '2026-11-27',
      window: '16:15 - 16:45',
      checkedIn: 14,
      expected: 18,
      late: 1,
      pendingVerify: 2,
      leaveApproved: 1
    },
    todos: [
      { id: 't1', type: '待批请假', student: '周致远（虚构）', detail: '11-27 晚间训练 · 校内物理实验冲突（无附件）', priority: 'P1' },
      { id: 't2', type: '待审成绩', student: '林予安（虚构）', detail: '200米 23.48 秒 · 申报待核验后方可入榜', priority: 'P1' },
      { id: 't3', type: '待审注册', student: '许知微（虚构）', detail: '申请加入短跑一队 · 主项立定跳远', priority: 'P2' }
    ],
    competitions: [
      { id: 'c1', title: '2026市青少年田径公开赛', intentCount: 12, materialCount: 9, status: '教练处理中（未提交官方）' },
      { id: 'c2', title: '冬季室内测试邀请赛', intentCount: 8, materialCount: 8, status: '教练已提交外部平台' }
    ]
  },
  parent: {
    students: [
      {
        id: 'stu1',
        name: '林予安（虚构）',
        group: '短跑一队',
        event: '100米',
        pb: '11.42 秒',
        pbEvent: '100米（教练已审核）',
        attendanceRate: '87.5%',
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
          { date: '11-26', status: '已签到（不展示精确位置）' },
          { date: '11-24', status: '迟到（不展示精确位置）' },
          { date: '11-22', status: '已批准请假' }
        ],
        feedback: [
          { date: '11-26', completion: '全部完成', rpe: '7/10' },
          { date: '11-24', completion: '部分完成', rpe: '8/10' }
        ],
        events: [
          { type: '赛事意向', title: '2026市青少年田径公开赛（100米）', badge: '教练处理中' },
          { type: '俱乐部通知', title: '本周六赛事报名意向截止提醒', badge: '重要' }
        ]
      },
      {
        id: 'stu2',
        name: '林予宁（虚构）',
        group: '中长跑二队',
        event: '800米',
        pb: "2'18.60",
        pbEvent: '800米（教练已审核）',
        attendanceRate: '93.8%',
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
          { date: '11-26', status: '已签到（不展示精确位置）' },
          { date: '11-25', status: '已签到（不展示精确位置）' }
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
      collections: '23 个集合（全 ADMINONLY）',
      storageAcl: '仅创建者及管理员可读写',
      pendingReviews: 4
    },
    approvals: [
      { id: 'a1', name: '许知微（虚构）', roleType: '学生注册', detail: '短跑一队 · 实名待核验' },
      { id: 'a2', name: '苏明远（虚构）', roleType: '家长关联终审', detail: '学生已确认 · 待开发者核验' },
      { id: 'a3', name: '陆承泽（虚构）', roleType: '教练实名申请', detail: '跳跃专项组 · 待审核' }
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
    performance: {
      month: [
        { rank: 1, name: '林予安（本人）', group: '短跑一队', coach: '陈景行', value: '11.42 秒', pb: '11.42 秒' },
        { rank: 2, name: '周**', group: '短跑一队', coach: '陈景行', value: '11.58 秒', pb: '11.51 秒' },
        { rank: 3, name: '许**', group: '短跑一队', coach: '陈景行', value: '11.74 秒', pb: '11.69 秒' }
      ],
      quarter: [
        { rank: 1, name: '林予安（本人）', group: '短跑一队', coach: '陈景行', value: '11.42 秒', pb: '11.42 秒' },
        { rank: 2, name: '周**', group: '短跑一队', coach: '陈景行', value: '11.51 秒', pb: '11.51 秒' },
        { rank: 3, name: '顾**', group: '短跑一队', coach: '陈景行', value: '11.63 秒', pb: '11.63 秒' }
      ],
      year: [
        { rank: 1, name: '周**', group: '短跑一队', coach: '陈景行', value: '11.39 秒', pb: '11.39 秒' },
        { rank: 2, name: '林予安（本人）', group: '短跑一队', coach: '陈景行', value: '11.42 秒', pb: '11.42 秒' },
        { rank: 3, name: '顾**', group: '短跑一队', coach: '陈景行', value: '11.55 秒', pb: '11.55 秒' }
      ]
    },
    attendance: {
      month: [
        { rank: '—', name: '林予安（本人）', group: '短跑一队', valid: '14/16', rate: '87.5%', note: '样本充足' },
        { rank: '—', name: '周**', group: '短跑一队', valid: '15/16', rate: '93.8%', note: '样本充足' },
        { rank: '—', name: '许**', group: '短跑一队', valid: '2/2', rate: '100.0%', note: '样本不足(<3场)' }
      ],
      quarter: [
        { rank: '—', name: '周**', group: '短跑一队', valid: '41/44', rate: '93.2%', note: '样本充足' },
        { rank: '—', name: '林予安（本人）', group: '短跑一队', valid: '39/44', rate: '88.6%', note: '样本充足' }
      ],
      year: [
        { rank: '—', name: '周**', group: '短跑一队', valid: '128/138', rate: '92.8%', note: '样本充足' },
        { rank: '—', name: '林予安（本人）', group: '短跑一队', valid: '122/138', rate: '88.4%', note: '样本充足' }
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
  }
};
