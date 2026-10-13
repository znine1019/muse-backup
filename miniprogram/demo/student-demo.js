'use strict';

/**
 * D1-B 补充｜学生端演示视图（读取 showcase-store 统一数据源）
 *
 * 关键变化：学生端的业务结果（计划 / 考勤 / 成绩 / PB / 排行榜 / 通知 / 反馈）
 * 不再来自静态示例，而是从统一数据源实时派生。
 * 因此教练端发布计划、审批请假、审核成绩、发布通知后，
 * 重新进入学生端页面即可看到对应变化。
 *
 * 本模块不引用任何正式业务接口。
 */

const store = require('./showcase-store');

const DEMO_STUDENT_ID = 'stu_lin';

const PLAN_STATUS = store.PLAN_STATUS;
const PLAN_VISIBLE_STATUS = store.PLAN_VISIBLE_STATUS;

const DEMO_MARKER = 'DEMO｜虚构演示数据';
const DEMO_NOTICE = '仅用于界面预览，不代表真实训练信息';

const ATTENDANCE_LABELS = Object.freeze({
  pending: '待签到',
  checked_in: '已签到',
  late: '迟到',
  absent: '未签到',
  leave_approved: '已批准请假',
  pending_verification: '待核实',
  not_started: '未开始',
  cancelled: '已取消'
});

const SESSION_PHASE_LABELS = Object.freeze({
  open: '模拟签到状态',
  not_started: '未开始',
  closed: '已结束',
  cancelled: '已取消'
});

const COMPLETION_LABELS = Object.freeze({
  completed: '全部完成',
  partial: '部分完成',
  not_completed: '未完成'
});

class DemoModuleError extends Error {}

/* ------------------------------------------------------------------ 工具 */

function demoStudent() {
  return store.studentById(DEMO_STUDENT_ID);
}

function eventNameOf(code) {
  const event = store.eventByCode(code);
  return event ? event.name : code;
}

function formatMetric(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return `${value} ${unit || ''}`.trim();
  }
  if (unit === '秒' && number >= 60) {
    const minutes = Math.floor(number / 60);
    const seconds = Math.round((number % 60) * 100) / 100;
    return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  }
  return `${number} ${unit || ''}`.trim();
}

function shortDate(value) {
  if (!value) {
    return '';
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : String(value);
}

function row(t, m, options = {}) {
  return {
    t,
    m,
    v: options.v || '',
    chip: options.chip || '',
    tone: options.tone || '',
    detailType: options.detail ? options.detail.type : '',
    detailId: options.detail ? options.detail.id : ''
  };
}

/* -------------------------------------------------------------- 计划与成绩 */

/** 演示学生所属训练组的全部计划（含草稿，用于证明"学生端过滤掉草稿"） */
function allPlansForDemoStudent() {
  const groupIds = store.groupsOfStudent(DEMO_STUDENT_ID);
  return store.allPlans().filter((plan) => groupIds.includes(plan.trainingGroupId));
}

/** 学生可见计划：仅已发布（与正式可见性规则一致） */
function visibleStudentPlans() {
  return store.visiblePlansForStudent(DEMO_STUDENT_ID);
}

/** 学生计划详情：仅允许打开已发布且属于当前学生的计划 */
function getStudentPlan(planId) {
  const plan = visibleStudentPlans().find((item) => item.planId === planId);
  if (!plan) {
    throw new DemoModuleError(`演示计划不存在或尚未发布：${planId}`);
  }
  const student = demoStudent();
  return {
    isNotice: false,
    typeLabel: '训练计划',
    contentLabel: '训练内容',
    title: plan.title,
    chip: PLAN_STATUS_LABELS[plan.status] || plan.status,
    tone: 'ok',
    metaLine: `${student.name}（虚构） · ${store.groupNames([plan.trainingGroupId])[0] || '未标注'} · ${plan.startDate} 至 ${plan.endDate}`,
    body: plan.notes || '（无教练注意事项）',
    items: store.planDetailItems(plan),
    actions: [],
    linkageNote: ''
  };
}

/** 通知（学生可见范围） */
function noticesForDemoStudent() {
  return store.noticesForStudent(DEMO_STUDENT_ID);
}

function noticeShape(notice) {
  return {
    id: notice.noticeId,
    title: notice.title,
    categoryLabel: notice.categoryLabel,
    publishedAt: notice.publishedAt,
    publisherText: notice.publisherText,
    preview: notice.content,
    content: notice.content,
    isImportant: notice.priority === 'important',
    isRead: Boolean(notice.isRead)
  };
}

function getStudentNotice(noticeId) {
  const notice = noticesForDemoStudent().find((item) => item.noticeId === noticeId);
  if (!notice) {
    throw new DemoModuleError(`演示通知不存在：${noticeId}`);
  }
  return { ...noticeShape(notice) };
}

/* ------------------------------------------------------------ 考勤与请假 */

function attendanceOfDemoStudent() {
  return store.attendanceOfStudent(DEMO_STUDENT_ID);
}

function leavesOfDemoStudent() {
  return store.leavesOfStudent(DEMO_STUDENT_ID);
}

function sessionsForDemoStudent() {
  const groupIds = store.groupsOfStudent(DEMO_STUDENT_ID);
  return store.getState().attendanceSessions.filter((session) => groupIds.includes(session.trainingGroupId));
}

function attendanceStatusOf(sessionId) {
  const record = attendanceOfDemoStudent().find((item) => item.sessionId === sessionId);
  return record ? record.status : store.ATTENDANCE_STATUS.PENDING;
}

function summarizeAttendance() {
  const records = attendanceOfDemoStudent();
  const byStatus = (status) => records.filter((item) => item.status === status).length;
  const sessions = sessionsForDemoStudent();
  const counted = records.filter((item) => item.status !== store.ATTENDANCE_STATUS.PENDING).length;
  const expected = Math.max(sessions.length, counted);
  const valid = byStatus(store.ATTENDANCE_STATUS.CHECKED_IN) + byStatus(store.ATTENDANCE_STATUS.LATE);
  const rate = expected ? Math.round((valid / expected) * 100) : 0;
  return {
    attendanceRateText: expected ? `${rate}%` : '暂无',
    attendanceRatePercent: rate,
    validAttendance: valid,
    actualExpected: expected,
    late: byStatus(store.ATTENDANCE_STATUS.LATE),
    absent: byStatus(store.ATTENDANCE_STATUS.ABSENT),
    pendingVerification: byStatus(store.ATTENDANCE_STATUS.PENDING_VERIFICATION),
    leaveApproved: byStatus(store.ATTENDANCE_STATUS.LEAVE_APPROVED)
  };
}

/* ---------------------------------------------------------------- 工作台 */

function buildStudentWorkbench() {
  const student = demoStudent();
  const bests = store.personalBests(DEMO_STUDENT_ID);
  const best = bests[0] || null;
  const approved = store.approvedPerformances(DEMO_STUDENT_ID);
  const goal = student.examGoal || {};

  const todaySessions = sessionsForDemoStudent().map((session) => {
    const status = attendanceStatusOf(session.sessionId);
    return {
      sessionId: session.sessionId,
      title: session.title,
      locationName: session.locationName,
      trainingGroupName: store.groupNames([session.trainingGroupId])[0] || '',
      windowText: `${session.checkInOpenTime} – ${session.checkInCloseTime}`,
      phaseLabel: SESSION_PHASE_LABELS[session.phase] || session.phase,
      statusLabel: ATTENDANCE_LABELS[status] || status,
      canCheckIn: status === store.ATTENDANCE_STATUS.PENDING
    };
  });

  const plans = visibleStudentPlans();

  return {
    student: {
      name: student.name,
      tag: student.tag,
      primaryEventName: eventNameOf(student.primaryEventCode),
      secondaryEventText: (student.secondaryEventCodes || []).map(eventNameOf).join('、'),
      trainingGroupName: store.groupNames(student.groupIds)[0] || '',
      trainingYears: Math.max(0, 2026 - Number(student.trainingStartYear || 2026)),
      birthDate: student.birthDate,
      genderLabel: student.genderLabel,
      heightCm: student.heightCm,
      weightKg: student.weightKg,
      examGoalText: goal.targetEventCode
        ? `${eventNameOf(goal.targetEventCode)} ${formatMetric(goal.targetValue, (store.eventByCode(goal.targetEventCode) || {}).unit)} · ${goal.examYear} 体考`
        : '未设置体考目标',
      targetValueText: goal.targetEventCode
        ? formatMetric(goal.targetValue, (store.eventByCode(goal.targetEventCode) || {}).unit)
        : ''
    },
    todaySessions,
    pb: {
      eventName: best ? best.eventName : '暂无正式成绩',
      value: best ? String(best.value) : '—',
      unit: best ? best.unit : '',
      achievedAt: best ? best.achievedAt : '',
      approvedCount: approved.length,
      goalText: goal.targetEventCode
        ? `体考目标 ${formatMetric(goal.targetValue, (store.eventByCode(goal.targetEventCode) || {}).unit)}`
        : '未设置体考目标',
      achieved: Boolean(best && goal.targetEventCode && best.eventCode === goal.targetEventCode)
    },
    monthStats: summarizeAttendance(),
    progress: store
      .performanceLeaderboard(student.primaryEventCode)
      .filter((item) => item.studentId === DEMO_STUDENT_ID)
      .map((item) => ({
        eventName: eventNameOf(student.primaryEventCode),
        metaText: `${item.groupNames.join('、')} · 第 ${item.rank} 名`,
        changeText: formatMetric(item.value, (store.eventByCode(student.primaryEventCode) || {}).unit),
        improved: true
      })),
    notices: noticesForDemoStudent().slice(0, 3).map(noticeShape),
    planOverview: {
      publishedCount: plans.length,
      items: plans.map((plan) => ({
        title: plan.title,
        meta: `${plan.startDate} 至 ${plan.endDate}`,
        detailType: 'plan',
        detailId: plan.planId
      }))
    },
    catalogGroups: groupCatalog(CATALOG)
  };
}

/* ------------------------------------------------------------------ 目录 */

const CATALOG = Object.freeze([
  { id: 'plans', name: '训练计划', group: '训练与计划', tone: 'brand', icon: '计', desc: '查看已发布训练安排' },
  { id: 'attendance', name: '签到与请假', group: '训练与计划', tone: 'ok', icon: '勤', desc: '模拟签到、请假与考勤记录' },
  { id: 'feedback', name: '训练反馈', group: '训练与计划', tone: 'plain', icon: '馈', desc: '提交模拟反馈与查看教练评价' },
  { id: 'performance', name: '运动成绩', group: '成绩与数据', tone: 'accent', icon: '绩', desc: '已审核成绩与正式 PB' },
  { id: 'performance-submit', name: '成绩申报', group: '成绩与数据', tone: 'accent', icon: '报', desc: '模拟提交，进入教练待审' },
  { id: 'report', name: '运动报告', group: '成绩与数据', tone: 'brand', icon: '析', desc: 'PB 与正式成绩变化' },
  { id: 'statistics', name: '训练统计', group: '成绩与数据', tone: 'ok', icon: '统', desc: '考勤与成绩统计' },
  { id: 'leaderboard', name: '成绩排行榜', group: '成绩与数据', tone: 'plain', icon: '榜', desc: '仅使用已审核成绩' },
  { id: 'attendance-statistics', name: '考勤统计与排行', group: '成绩与数据', tone: 'brand', icon: '考', desc: '出勤率与样本口径' },
  { id: 'competitions', name: '赛事意向', group: '赛事与通知', tone: 'accent', icon: '赛', desc: '提交意向与查看办理进度' },
  { id: 'notices', name: '俱乐部通知', group: '赛事与通知', tone: 'brand', icon: '通', desc: '重要通知与详情' },
  { id: 'profile', name: '个人档案', group: '个人中心', tone: 'brand', icon: '档', desc: '身体数据与体考目标' },
  { id: 'link', name: '亲子关联', group: '个人中心', tone: 'ok', icon: '亲', desc: '家长关联状态（演示）' }
]);

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

/* ------------------------------------------------------------------ 模块 */

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
    { id: definition.id, name: definition.name, group: definition.group, icon: definition.icon, tone: definition.tone },
    builder()
  );
}

const MODULE_BUILDERS = {
  plans() {
    const plans = visibleStudentPlans();
    return {
      subtitle: '训练安排（来自统一演示数据源）',
      summary: {
        label: '已发布计划',
        value: String(plans.length),
        unit: '份',
        meta: '未发布草稿不会出现在学生端'
      },
      rows: plans.map((plan) =>
        row(plan.title, `${plan.startDate} 至 ${plan.endDate} · ${store.groupNames([plan.trainingGroupId])[0] || '未标注'}`, {
          chip: PLAN_STATUS_LABELS[plan.status] || plan.status,
          tone: 'ok',
          detail: { type: 'plan', id: plan.planId }
        })
      ),
      note: '教练端发布计划后，重新进入本页即可看到该计划。'
    };
  },
  attendance() {
    const sessions = sessionsForDemoStudent();
    const records = attendanceOfDemoStudent();
    const summary = summarizeAttendance();
    return {
      subtitle: '考勤与请假（来自统一演示数据源）',
      summary: {
        label: '演示周期有效出勤',
        value: String(summary.validAttendance),
        unit: '/ ' + summary.actualExpected,
        meta: `出勤率 ${summary.attendanceRateText}`
      },
      rows: sessions.map((session) => {
        const status = attendanceStatusOf(session.sessionId);
        return row(
          session.title,
          `${session.attendanceDate} · ${session.checkInOpenTime}–${session.checkInCloseTime} · ${session.locationName}`,
          { chip: ATTENDANCE_LABELS[status] || status, tone: statusTone(status), detail: { type: 'attendance-session', id: session.sessionId } }
        );
      }),
      extraRows: records
        .filter((record) => !sessions.some((session) => session.sessionId === record.sessionId))
        .map((record) =>
          row(`历史考勤 · ${record.attendanceDate}`, record.adjustReason || '已记录', {
            chip: ATTENDANCE_LABELS[record.status] || record.status,
            tone: statusTone(record.status)
          })
        ),
      form: [{ label: '签到说明', value: '模拟签到（不获取真实定位）' }],
      submitText: '模拟签到',
      submitKind: 'check-in',
      note: '教练批准请假后，此处状态会同步变为“已批准请假”。'
    };
  },
  feedback() {
    const entries = store.feedbackOfStudent(DEMO_STUDENT_ID);
    return {
      subtitle: '训练反馈（来自统一演示数据源）',
      rows: entries.map((entry) =>
        row(`${entry.attendanceDate} · RPE ${entry.rpe}/10`, entry.comment || '（未填写说明）', {
          chip: entry.coachComment ? '教练已评价' : '待教练评价',
          tone: entry.coachComment ? 'ok' : 'warn'
        })
      ),
      form: [
        { label: '完成情况', value: '全部完成' },
        { label: '主观强度 RPE', value: '7' },
        { label: '训练感受', value: '状态良好，节奏稳定（演示）' }
      ],
      submitText: '模拟提交反馈',
      submitKind: 'submit-feedback',
      note: '提交后教练端待办会出现该反馈；教练评价默认不向家长展示。'
    };
  },
  performance() {
    const approved = store.approvedPerformances(DEMO_STUDENT_ID);
    const pending = store.pendingPerformances(DEMO_STUDENT_ID);
    const bests = store.personalBests(DEMO_STUDENT_ID);
    const best = bests[0];
    return {
      subtitle: '已审核成绩（来自统一演示数据源）',
      summary: best
        ? { label: '正式 PB', value: String(best.value), unit: best.unit, meta: `${best.eventName} · 教练已审核` }
        : { label: '正式 PB', value: '—', unit: '', meta: '暂无已审核成绩' },
      rows: approved.map((record) => {
        const event = store.eventByCode(record.eventCode);
        return row(event.name, `${record.achievedAt} · 教练已审核`, { v: formatMetric(record.value, event.unit), chip: '已通过', tone: 'ok' });
      }),
      extraRows: pending.map((record) => {
        const event = store.eventByCode(record.eventCode);
        return row(event.name, `${record.achievedAt} · 等待教练审核`, { v: formatMetric(record.value, event.unit), chip: '待审核', tone: 'warn' });
      }),
      note: '未审核成绩不会进入正式 PB 与排行榜。'
    };
  },
  'performance-submit'() {
    return {
      subtitle: '成绩申报（本地模拟，不写入正式数据）',
      form: [
        { label: '项目', value: '100米' },
        { label: '成绩', value: '11.62' },
        { label: '单位', value: '秒' },
        { label: '取得日期', value: '2026-06-21' }
      ],
      submitText: '模拟提交申报',
      submitKind: 'submit-performance',
      note: '提交后会进入教练端“待审成绩”；需教练模拟通过后才计入正式 PB 与排行榜。'
    };
  },
  report() {
    const summary = summarizeAttendance();
    const bests = store.personalBests(DEMO_STUDENT_ID);
    return {
      subtitle: '运动数据报告（演示）',
      summary: bests.length
        ? { label: `${bests[0].eventName} 正式 PB`, value: String(bests[0].value), unit: bests[0].unit, meta: `${bests[0].achievedAt} · 已审核` }
        : { label: '正式 PB', value: '—', unit: '', meta: '暂无已审核成绩' },
      rows: bests.map((item) => row(item.eventName, `取得日期：${item.achievedAt}`, { v: formatMetric(item.value, item.unit) })),
      extraRows: [
        row('演示周期出勤率', '基于已结束场次口径', { v: summary.attendanceRateText }),
        row('有效出勤', `应签到 ${summary.actualExpected} 次`, { v: `${summary.validAttendance} 次` })
      ],
      note: '报告只使用已审核成绩与实际考勤记录。'
    };
  },
  statistics() {
    const summary = summarizeAttendance();
    const approved = store.approvedPerformances(DEMO_STUDENT_ID);
    const entries = store.feedbackOfStudent(DEMO_STUDENT_ID);
    const avgRpe = entries.length
      ? Math.round((entries.reduce((total, item) => total + Number(item.rpe || 0), 0) / entries.length) * 10) / 10
      : null;
    return {
      subtitle: '训练统计（来自统一演示数据源）',
      summary: { label: '演示周期出勤率', value: summary.attendanceRateText.replace('%', ''), unit: '%', meta: `应签到 ${summary.actualExpected} 次` },
      rows: [
        row('有效出勤', '已结束场次口径', { v: `${summary.validAttendance} 次` }),
        row('迟到', '迟到线之后签到', { v: `${summary.late} 次` }),
        row('未签到', '不等于无故缺勤', { v: `${summary.absent} 次` }),
        row('已批准请假', '请假原因不在此展示', { v: `${summary.leaveApproved} 次` }),
        row('已审核成绩', '仅统计教练通过的记录', { v: `${approved.length} 条` }),
        row('平均 RPE', `共 ${entries.length} 条反馈`, { v: avgRpe === null ? '暂无' : String(avgRpe) })
      ],
      note: '统计口径与正式系统一致，但数值为虚构演示数据。'
    };
  },
  leaderboard() {
    const eventCode = demoStudent().primaryEventCode;
    const event = store.eventByCode(eventCode);
    const rows = store.performanceLeaderboard(eventCode);
    return {
      subtitle: `${event.name} 排行榜（仅已审核成绩）`,
      rows: rows.map((item) =>
        row(`第 ${item.rank} 名 · ${item.studentName}${item.studentId === DEMO_STUDENT_ID ? '（本人）' : ''}`, item.groupNames.join('、'), {
          v: formatMetric(item.value, event.unit),
          chip: item.studentId === DEMO_STUDENT_ID ? '本人' : '',
          tone: item.studentId === DEMO_STUDENT_ID ? 'brand' : ''
        })
      ),
      note: '教练审核通过后成绩才会出现在榜单上；并列成绩使用相同名次。'
    };
  },
  'attendance-statistics'() {
    const summary = summarizeAttendance();
    return {
      subtitle: '考勤统计（来自统一演示数据源）',
      summary: { label: '本人出勤率', value: summary.attendanceRateText.replace('%', ''), unit: '%', meta: `样本 ${summary.actualExpected} 次` },
      rows: [
        row('本人 · 有效出勤', '已结束场次口径', { v: `${summary.validAttendance}/${summary.actualExpected}`, chip: '本人', tone: 'brand' }),
        row('迟到 / 未签到', '未签到不等于无故缺勤', { v: `${summary.late} / ${summary.absent}` }),
        row('已批准请假', '原因不向家长展示', { v: `${summary.leaveApproved} 次` })
      ],
      note: '样本不足时不给出领先名次。'
    };
  },
  competitions() {
    const intents = store.intentsOfStudent(DEMO_STUDENT_ID);
    const competitions = store.getState().competitions;
    const intentByCompetition = {};
    for (const intent of intents) {
      intentByCompetition[intent.competitionId] = intent;
    }
    return {
      subtitle: '赛事意向（来自统一演示数据源）',
      rows: competitions.map((competition) => {
        const intent = intentByCompetition[competition.competitionId];
        return row(competition.title, `${competition.eventDate} · ${competition.location}`, {
          chip: intent ? COMPETITION_LABELS[intent.status] || intent.status : '可登记',
          tone: intent && intent.status === 'registered' ? 'ok' : 'warn',
          detail: intent ? { type: 'competition-intent', id: intent.registrationId } : null
        });
      }),
      extraRows: intents.map((intent) => {
        const competition = competitions.find((item) => item.competitionId === intent.competitionId) || {};
        return row(`我的意向 · ${competition.title || intent.competitionId}`, (intent.items || []).map((i) => i.eventName).join('、') || '未选择项目', {
          chip: COMPETITION_LABELS[intent.status] || intent.status,
          tone: intent.status === 'registered' ? 'ok' : 'warn'
        });
      }),
      form: [{ label: '意向赛事', value: '市青少年锦标赛（虚构）' }, { label: '意向项目', value: '100米' }],
      submitText: '模拟提交意向',
      submitKind: 'submit-intent',
      note: '内部意向不等于官方报名成功，正式报名由教练在赛事官方渠道完成。'
    };
  },
  notices() {
    const notices = noticesForDemoStudent();
    return {
      subtitle: '俱乐部通知（来自统一演示数据源）',
      rows: notices.map((notice) => {
        const shaped = noticeShape(notice);
        return row(shaped.title, `${shaped.categoryLabel} · ${shaped.publishedAt}`, {
          chip: shaped.isImportant ? '重要 · 未读' : shaped.isRead ? '已读' : '未读',
          tone: shaped.isImportant ? 'danger' : shaped.isRead ? '' : 'brand',
          detail: { type: 'notice', id: shaped.id }
        });
      }),
      note: '教练端发布通知后，重新进入本页即可看到该通知；点击可查看完整正文。'
    };
  },
  profile() {
    const student = demoStudent();
    return {
      subtitle: '个人档案（虚构）',
      rows: [
        row('姓名', student.tag, { v: student.name }),
        row('主项 / 兼项', `${eventNameOf(student.primaryEventCode)} / ${(student.secondaryEventCodes || []).map(eventNameOf).join('、')}`, { v: '' }),
        row('出生日期', student.birthDate, { v: `${2026 - Number(String(student.birthDate).slice(0, 4))} 岁` }),
        row('身高 / 体重', '最新一次测量', { v: `${student.heightCm} cm / ${student.weightKg} kg` }),
        row('训练年限', `入队年份 ${student.trainingStartYear}`, { v: `${Math.max(0, 2026 - Number(student.trainingStartYear))} 年` }),
        row('体考目标', student.examGoal ? `${eventNameOf(student.examGoal.targetEventCode)} ${student.examGoal.examYear}` : '未设置', {
          chip: student.examGoal ? formatMetric(student.examGoal.targetValue, (store.eventByCode(student.examGoal.targetEventCode) || {}).unit) : '',
          tone: 'brand'
        })
      ],
      note: '演示数据不包含任何真实学生档案信息。'
    };
  },
  link() {
    const students = store.linkedStudentsOfParent('parent_lin');
    return {
      subtitle: '亲子关联（虚构，预置状态）',
      rows: students.map((item) =>
        row(item.name, item.tag || '虚构演示学生', {
          chip: LINK_STATE_LABELS[item.linkState] || item.linkState,
          tone: item.linkState === store.LINK_STATUS.ACTIVE ? 'ok' : 'warn'
        })
      ),
      note: '演示环境不生成真实关联凭证，也不修改任何授权关系。'
    };
  }
};

const PLAN_STATUS_LABELS = Object.freeze({ draft: '草稿', published: '已发布', archived: '已归档' });
const LINK_STATE_LABELS = Object.freeze({
  active: '已生效',
  pending_review: '待核验',
  pending_student: '待学生确认',
  rejected: '已驳回',
  revoked: '已解除'
});
const COMPETITION_LABELS = Object.freeze({
  submitted: '已提交意向',
  processing: '教练处理中',
  registered: '教练已代报',
  failed: '未完成',
  cancelled: '已取消'
});

function statusTone(status) {
  if (status === store.ATTENDANCE_STATUS.CHECKED_IN) {
    return 'ok';
  }
  if (status === store.ATTENDANCE_STATUS.LATE || status === store.ATTENDANCE_STATUS.PENDING_VERIFICATION) {
    return 'warn';
  }
  if (status === store.ATTENDANCE_STATUS.ABSENT) {
    return 'danger';
  }
  if (status === store.ATTENDANCE_STATUS.LEAVE_APPROVED) {
    return 'brand';
  }
  return '';
}

/* 兼容既有调用：ALL_PLANS / NOTICES 以 getter 形式实时反映统一数据源 */
Object.defineProperty(module.exports, 'ALL_PLANS', {
  enumerable: true,
  get() {
    return allPlansForDemoStudent();
  }
});

Object.defineProperty(module.exports, 'NOTICES', {
  enumerable: true,
  get() {
    return noticesForDemoStudent().map(noticeShape);
  }
});

module.exports.STUDENT = {
  id: DEMO_STUDENT_ID,
  name: demoStudent().name,
  tag: demoStudent().tag
};
module.exports.DEMO_MARKER = DEMO_MARKER;
module.exports.DEMO_NOTICE = DEMO_NOTICE;
module.exports.PLAN_STATUS = PLAN_STATUS;
module.exports.DEMO_STUDENT_ID = DEMO_STUDENT_ID;
module.exports.buildStudentModule = buildStudentModule;
module.exports.buildStudentWorkbench = buildStudentWorkbench;
module.exports.catalog = CATALOG;
module.exports.getStudentNotice = getStudentNotice;
module.exports.getStudentPlan = getStudentPlan;
module.exports.visibleStudentPlans = visibleStudentPlans;
module.exports.DemoModuleError = DemoModuleError;
