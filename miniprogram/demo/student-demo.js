'use strict';

/**
 * 学生端 DEMO 本地虚构数据（不读取 CloudBase，不调用任何业务接口）
 *
 * 只提供"展示用"的模拟数据；所有数值均为虚构，用于 UI 检查与模拟交互。
 * 涉及写入的模块（成绩申报 / 请假申请）在演示页中只改变本地模拟状态。
 */

const STUDENT = Object.freeze({
  name: '林越',
  tag: '虚构演示学生',
  primaryEventName: '100米',
  secondaryEventText: '跳远',
  trainingGroupName: '短跑组（虚构）',
  trainingYears: 2,
  birthDate: '2009-04-12',
  genderLabel: '男',
  heightCm: 172.0,
  weightKg: 59.0,
  examGoalText: '100米 11.50秒 · 2027 体考',
  targetValueText: '11.50 秒'
});

const TODAY_SESSIONS = Object.freeze([
  {
    sessionId: 'demo_session_1',
    title: '速度课 · 60米加速跑',
    locationName: '田径场（虚构）',
    windowText: '16:00 – 18:00',
    /* 不声称“签到中”：演示不获取定位，也不受真实签到窗口约束 */
    phaseLabel: '模拟签到状态',
    statusLabel: '去签到',
    canCheckIn: true
  },
  {
    sessionId: 'demo_session_2',
    title: '力量课 · 下肢力量',
    locationName: '力量房（虚构）',
    windowText: '18:30 – 20:00',
    phaseLabel: '未开始',
    statusLabel: '查看详情',
    canCheckIn: false
  }
]);

const PB = Object.freeze({
  eventName: '100米',
  value: '11.70',
  unit: '秒',
  achievedAt: '2026-06-11',
  approvedCount: 7,
  goalText: '体考目标 11.50 秒',
  achieved: false
});

const MONTH_STATS = Object.freeze({
  attendanceRateText: '92%',
  attendanceRatePercent: 92,
  validAttendance: 11,
  actualExpected: 12,
  late: 1,
  absent: 0,
  pendingVerification: 1
});

const PROGRESS = Object.freeze([
  { eventName: '100米', metaText: '12.20 → 11.95 秒 · 06-11', changeText: '-0.25 秒', improved: true },
  { eventName: '跳远', metaText: '5.10 → 5.35 米 · 06-05', changeText: '+0.25 米', improved: true },
  { eventName: '800米', metaText: '2分35秒 → 2分28秒 · 05-20', changeText: '-7 秒', improved: true }
]);

/* 通知演示数据：preview 用于列表，content 为完整正文（供通知详情展示） */
const NOTICES = Object.freeze([
  {
    id: 'demo_notice_1',
    title: '本周训练调整',
    categoryLabel: '训练安排',
    publishedAt: '2026-06-15 09:20',
    publisherText: '短跑组教练（虚构）',
    preview: '周三改至室内力量房，注意带好训练鞋。',
    content:
      '因田径场维护，本周三（06-17）原定在田径场进行的速度课调整至室内力量房。' +
      '集合时间不变（16:00），请提前 10 分钟到场完成热身。' +
      '请穿训练鞋并自带饮用水；如因伤病无法参加，请提前提交请假申请。',
    isImportant: true,
    isRead: false
  },
  {
    id: 'demo_notice_2',
    title: '队内测试通知',
    categoryLabel: '测试安排',
    publishedAt: '2026-06-12 18:05',
    publisherText: '俱乐部（虚构）',
    preview: '月底将进行 100 米与跳远队内测试。',
    content:
      '月底将进行 100 米与跳远队内测试，测试成绩经教练审核后计入正式成绩。' +
      '测试当天请按训练组集合时间到场，服从现场安排；测试前请保持正常作息与饮食。',
    isImportant: false,
    isRead: true
  }
]);

/** 取一条演示通知（详情页使用；不存在则报错，不返回空壳数据） */
function getStudentNotice(noticeId) {
  const notice = NOTICES.find((item) => item.id === noticeId);
  if (!notice) {
    throw new DemoModuleError(`演示通知不存在：${noticeId}`);
  }
  return { ...notice };
}

/*
 * 训练计划演示数据：刻意保留一份“教练草稿”。
 * 正式系统 plan.list_student 使用 statuses:[published]、详情也要求 published，
 * 因此学生端演示一律只展示已发布计划，草稿不得出现在任何学生可见区域。
 */
const PLAN_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived'
});

const ALL_PLANS = Object.freeze([
  { title: '周一 · 速度耐力', meta: '60米 × 6 组，组间 3 分钟', status: PLAN_STATUS.PUBLISHED },
  { title: '周三 · 下肢力量', meta: '深蹲 4×6、跳箱 4×5', status: PLAN_STATUS.PUBLISHED },
  { title: '周五 · 技术课', meta: '起跑与加速跑技术', status: PLAN_STATUS.PUBLISHED },
  { title: '周六 · 补强课', meta: '教练尚未发布（草稿）', status: PLAN_STATUS.DRAFT }
]);

/** 学生可见计划：仅正式发布（与正式系统可见性规则一致） */
function visibleStudentPlans() {
  return ALL_PLANS.filter((item) => item.status === PLAN_STATUS.PUBLISHED);
}

const CATALOG = Object.freeze([
  { id: 'plans', name: '训练计划', group: '训练与计划', tone: 'brand', icon: '计', desc: '本周安排与训练内容' },
  { id: 'attendance', name: '签到与请假', group: '训练与计划', tone: 'ok', icon: '勤', desc: '签到记录与请假申请' },
  { id: 'feedback', name: '训练反馈', group: '训练与计划', tone: 'plain', icon: '馈', desc: '完成情况与主观强度' },
  { id: 'performance', name: '运动成绩', group: '成绩与数据', tone: 'accent', icon: '绩', desc: '已审核成绩与 PB' },
  { id: 'performance-submit', name: '成绩申报', group: '成绩与数据', tone: 'accent', icon: '报', desc: '模拟提交，不写入' },
  { id: 'report', name: '运动报告', group: '成绩与数据', tone: 'brand', icon: '析', desc: 'PB 趋势与阶段变化' },
  { id: 'statistics', name: '训练统计', group: '成绩与数据', tone: 'ok', icon: '统', desc: '考勤与反馈统计' },
  { id: 'leaderboard', name: '成绩排行榜', group: '成绩与数据', tone: 'plain', icon: '榜', desc: '正式成绩排名' },
  { id: 'attendance-statistics', name: '考勤统计与排行', group: '成绩与数据', tone: 'brand', icon: '考', desc: '出勤率与样本口径' },
  { id: 'competitions', name: '赛事意向', group: '赛事与通知', tone: 'accent', icon: '赛', desc: '参赛报名与进度' },
  { id: 'notices', name: '俱乐部通知', group: '赛事与通知', tone: 'brand', icon: '通', desc: '重要通知与已读状态' },
  { id: 'profile', name: '个人档案', group: '个人中心', tone: 'brand', icon: '档', desc: '身体数据与体考目标' },
  { id: 'link', name: '亲子关联', group: '个人中心', tone: 'ok', icon: '亲', desc: '关联凭证与家长绑定' }
]);

class DemoModuleError extends Error {}

function row(t, m, options = {}) {
  return {
    t,
    m,
    v: options.v || '',
    chip: options.chip || '',
    tone: options.tone || '',
    /* 可选：点击该行打开演示详情（如通知正文） */
    detailType: options.detail ? options.detail.type : '',
    detailId: options.detail ? options.detail.id : ''
  };
}

function buildStudentWorkbench() {
  return {
    student: { ...STUDENT },
    todaySessions: TODAY_SESSIONS.map((item) => ({ ...item })),
    pb: { ...PB },
    monthStats: { ...MONTH_STATS },
    progress: PROGRESS.map((item) => ({ ...item })),
    notices: NOTICES.map((item) => ({ ...item })),
    /* 今日/本周训练计划概览：与训练计划列表使用同一份可见性过滤，草稿不会出现 */
    planOverview: {
      publishedCount: visibleStudentPlans().length,
      items: visibleStudentPlans().map((item) => ({ title: item.title, meta: item.meta }))
    },
    catalogGroups: groupCatalog(CATALOG)
  };
}

function groupCatalog(items) {
  const groups = [];
  for (const item of items) {
    let group = groups.find((entry) => entry.label === item.group);
    if (!group) {
      group = { label: item.group, items: [] };
      groups.push(group);
    }
    group.items.push({ ...item });
  }
  return groups;
}

function buildStudentModule(moduleId) {
  const definition = CATALOG.find((item) => item.id === moduleId);
  if (!definition) {
    throw new DemoModuleError(`演示模块不存在：${moduleId}`);
  }
  const builder = MODULE_BUILDERS[moduleId];
  if (!builder) {
    throw new DemoModuleError(`演示模块尚未实现：${moduleId}`);
  }
  return Object.assign(
    {
      id: definition.id,
      name: definition.name,
      group: definition.group,
      icon: definition.icon,
      tone: definition.tone
    },
    builder()
  );
}

const MODULE_BUILDERS = {
  plans() {
    const visible = visibleStudentPlans();
    return {
      subtitle: '训练安排（演示周期）',
      summary: {
        label: '已发布计划',
        value: String(visible.length),
        unit: '份',
        meta: '短跑组（虚构）'
      },
      rows: visible.map((item) => row(item.title, item.meta, { chip: '已发布', tone: 'ok' })),
      note: '仅展示教练已正式发布的计划；未发布草稿不会出现在学生端。'
    };
  },
  attendance() {
    return {
      subtitle: '签到与请假（虚构）',
      summary: { label: '演示周期有效出勤', value: '11', unit: '/ 12', meta: '出勤率 92%' },
      rows: [
        row('06-11 速度课', '16:00 – 18:00 · 田径场（虚构）', { chip: '已签到', tone: 'ok' }),
        row('06-13 力量课', '18:30 – 20:00 · 力量房（虚构）', { chip: '迟到', tone: 'warn' }),
        row('06-16 技术课', '已提交请假申请', { chip: '已批准', tone: 'ok' }),
        row('06-18 速度课', '定位偏差待教练核实', { chip: '待核实', tone: 'warn' })
      ],
      note: '演示环境不获取真实定位，也不产生正式考勤记录。'
    };
  },
  feedback() {
    return {
      subtitle: '训练反馈（虚构）',
      rows: [
        row('06-11 速度课', '全部完成 · RPE 7/10', { chip: '已提交', tone: 'ok' }),
        row('06-13 力量课', '部分完成 · RPE 8/10', { chip: '已提交', tone: 'ok' }),
        row('06-16 技术课', '尚未提交反馈', { chip: '待提交', tone: 'warn' })
      ],
      note: '提交操作在演示中只改变本地模拟状态。'
    };
  },
  performance() {
    return {
      subtitle: '已审核成绩（虚构）',
      summary: { label: '正式 PB', value: '11.70', unit: '秒', meta: '100米 · 06-11 审核通过' },
      rows: [
        row('100米', '2026-06-11 · 教练已审核', { v: '11.70 秒' }),
        row('跳远', '2026-06-05 · 教练已审核', { v: '5.35 米' }),
        row('800米', '2026-05-20 · 教练已审核', { v: '2分28秒' })
      ],
      note: '仅展示已审核成绩；未审核与已驳回成绩不计入 PB。'
    };
  },
  'performance-submit'() {
    return {
      subtitle: '成绩申报（本地模拟，不提交）',
      form: [
        { label: '项目', value: '100米' },
        { label: '成绩', value: '11.65' },
        { label: '单位', value: '秒' },
        { label: '取得日期', value: '2026-06-20' }
      ],
      submitText: '模拟提交申报',
      note: '演示环境不会写入成绩记录，也不会进入教练审核队列。'
    };
  },
  report() {
    return {
      subtitle: '运动数据报告（虚构）',
      summary: { label: '100米 阶段变化', value: '-0.25', unit: '秒', meta: '12.20 → 11.95 秒' },
      rows: [
        row('身高趋势', '3 月至 6 月共 6 次测量', { v: '172.0 cm' }),
        row('体重趋势', '3 月至 6 月共 6 次测量', { v: '59.0 kg' }),
        row('体考目标', '100米 11.50 秒 · 2027', { chip: '未达标', tone: 'warn' })
      ],
      note: '演示数据已隔离，与正式运动报告互不影响。'
    };
  },
  statistics() {
    return {
      subtitle: '训练统计（虚构）',
      summary: { label: '演示周期出勤率', value: '92', unit: '%', meta: '应签到 12 次' },
      rows: [
        row('有效出勤', '已结束场次口径', { v: '11 次' }),
        row('迟到', '迟到线之后签到', { v: '1 次' }),
        row('未签到', '不等于无故缺勤', { v: '0 次' }),
        row('待核实', '定位异常待教练确认', { v: '1 次' })
      ],
      note: '统计口径与正式口径一致，但数值为虚构演示数据。'
    };
  },
  leaderboard() {
    return {
      subtitle: '成绩排行榜（虚构）',
      rows: [
        row('第 1 名 · 赵X（虚构）', '100米 · 短跑组', { v: '11.42 秒' }),
        row('第 2 名 · 林越（虚构）', '100米 · 短跑组', { v: '11.70 秒', chip: '本人', tone: 'brand' }),
        row('第 3 名 · 周X（虚构）', '100米 · 短跑组', { v: '11.88 秒' })
      ],
      note: '仅使用已审核的正式成绩；演示名次为虚构。'
    };
  },
  'attendance-statistics'() {
    return {
      subtitle: '考勤统计与排行（虚构）',
      summary: { label: '本人出勤率', value: '92', unit: '%', meta: '样本 12 次' },
      rows: [
        row('第 1 名 · 赵X（虚构）', '出勤率', { v: '100%' }),
        row('第 2 名 · 林越（虚构）', '出勤率', { v: '92%', chip: '本人', tone: 'brand' }),
        row('第 3 名 · 周X（虚构）', '出勤率', { v: '83%' })
      ],
      note: '样本不足的训练组会标记为估算口径。'
    };
  },
  competitions() {
    return {
      subtitle: '赛事意向（虚构）',
      rows: [
        row('春季田径公开赛（虚构）', '2026-04-18 · 已提交意向', { chip: '教练处理中', tone: 'warn' }),
        row('市青少年锦标赛（虚构）', '2026-06-02 · 已提交意向', { chip: '教练已代报', tone: 'ok' })
      ],
      note: '内部意向不等于官方报名成功，正式报名由教练在赛事官方渠道完成。'
    };
  },
  notices() {
    return {
      subtitle: '俱乐部通知（演示周期）',
      rows: NOTICES.map((item) =>
        row(item.title, `${item.categoryLabel} · ${item.publishedAt}`, {
          chip: item.isImportant ? '重要 · 未读' : item.isRead ? '已读' : '未读',
          tone: item.isImportant ? 'danger' : item.isRead ? '' : 'brand',
          detail: { type: 'notice', id: item.id }
        })
      ),
      note: '点击任意通知可查看完整正文（演示数据，不影响正式通知）。'
    };
  },
  profile() {
    return {
      subtitle: '个人档案（虚构）',
      rows: [
        row('姓名', '演示学生（虚构）', { v: '林越' }),
        row('主项 / 兼项', '100米 / 跳远', { v: '' }),
        row('出生日期', '2009-04-12', { v: '17 岁' }),
        row('身高 / 体重', '最新一次测量', { v: '172.0 cm / 59.0 kg' }),
        row('训练年限', '入队时间', { v: '2 年' }),
        row('体考目标', '2027 体考', { chip: '11.50 秒', tone: 'brand' })
      ],
      note: '演示数据不包含任何真实学生档案信息。'
    };
  },
  link() {
    return {
      subtitle: '亲子关联（虚构）',
      rows: [
        row('家长 林X（虚构）', '已确认关联（虚构）', { chip: '已生效', tone: 'ok' }),
        row('家长 苏X（虚构）', '等待学生确认（虚构）', { chip: '待确认', tone: 'warn' })
      ],
      note: '演示环境不生成真实关联凭证，也不修改任何授权关系。'
    };
  }
};

module.exports = {
  ALL_PLANS,
  NOTICES,
  PLAN_STATUS,
  STUDENT,
  buildStudentModule,
  buildStudentWorkbench,
  catalog: CATALOG,
  getStudentNotice,
  visibleStudentPlans,
  DemoModuleError
};
