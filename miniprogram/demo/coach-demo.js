'use strict';

/**
 * D1-B｜教练员端模拟业务（仅存在于 demo/showcase-v1 分支）
 *
 * 全部数据来自 showcase-store.js 的统一虚构数据源，
 * 教练的模拟操作会写回该数据源，从而与学生端 / 家长端视图联动。
 * 本模块不引用任何业务接口。
 */

const store = require('./showcase-store');

const DEMO_COACH_ID = 'coach_lin';

const COACH_SWITCH_OPTIONS = store.COACHES.map((coach) => ({
  id: coach.id,
  label: `${coach.name}（${coach.title}）`,
  groupNames: store.groupNames(coach.groupIds)
}));

function coachById(coachId) {
  return store.COACHES.find((item) => item.id === coachId) || store.COACHES[0];
}

function formatMetric(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return `${value} ${unit}`;
  }
  if (unit === '秒' && number >= 60) {
    const minutes = Math.floor(number / 60);
    const seconds = Math.round((number % 60) * 100) / 100;
    return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  }
  return `${number} ${unit}`;
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

const PLAN_STATUS_LABELS = Object.freeze({ draft: '草稿', published: '已发布', archived: '已归档' });
const LEAVE_STATUS_LABELS = Object.freeze({ pending: '待审批', approved: '已批准', rejected: '已驳回', cancelled: '已撤销' });
const PERF_STATUS_LABELS = Object.freeze({ pending: '待审核', approved: '已通过', rejected: '已驳回' });
const COMPETITION_STATUS_LABELS = Object.freeze({
  submitted: '已提交意向',
  processing: '处理中',
  registered: '已代报',
  failed: '未完成',
  cancelled: '已取消'
});

/* ------------------------------------------------------------------ 工作台 */

function buildCoachWorkbench(coachId = DEMO_COACH_ID) {
  const coach = coachById(coachId);
  const todos = store.coachTodos(coach.id);
  const sessions = store.sessionsOfCoach(coach.id);
  const students = store.studentsOfCoach(coach.id);
  const intents = store.intentsOfCoach(coach.id);
  const feedback = store.feedbackOfCoach(coach.id);

  return {
    coach: { id: coach.id, name: coach.name, title: coach.title, groupNames: store.groupNames(coach.groupIds) },
    coachOptions: COACH_SWITCH_OPTIONS,
    coachIndex: Math.max(0, COACH_SWITCH_OPTIONS.findIndex((item) => item.id === coach.id)),
    students: students.map((student) => ({
      id: student.id,
      name: student.name,
      groupNames: store.groupNames(student.groupIds),
      pbText: store
        .personalBests(student.id)
        .map((item) => `${item.eventName} ${formatMetric(item.value, item.unit)}`)
        .join(' · ') || '暂无正式 PB',
      pendingCount: store.pendingPerformances(student.id).length
    })),
    todaySessions: sessions.map((session) => {
      const roster = students.filter((item) => item.groupIds.includes(session.trainingGroupId));
      const checkedIn = roster.filter((student) =>
        store
          .attendanceOfStudent(student.id)
          .some((record) => record.sessionId === session.sessionId && record.status !== store.ATTENDANCE_STATUS.PENDING)
      ).length;
      return {
        sessionId: session.sessionId,
        title: session.title,
        trainingGroupName: store.groupNames([session.trainingGroupId])[0] || '未标注',
        locationName: session.locationName,
        windowText: `${session.checkInOpenTime} – ${session.checkInCloseTime}`,
        /* 与既有演示口径一致：不声称真实“签到中”，避免误解为真实考勤状态 */
        phaseLabel: session.phase === 'open' ? '模拟签到状态' : '待开始',
        expectedCount: roster.length,
        checkedInCount: checkedIn
      };
    }),
    todoSummary: {
      leave: todos.leaves.length,
      performance: todos.performances.length,
      feedback: todos.feedback.length,
      total: todos.leaves.length + todos.performances.length + todos.feedback.length
    },
    todos: [
      ...todos.leaves.map((item) => ({
        key: `leave_${item.leaveId}`,
        type: 'leave',
        typeLabel: '待批请假',
        title: item.studentName,
        detail: `${item.attendanceDate} · ${LEAVE_STATUS_LABELS[item.status] || item.status}`,
        reason: item.reason
      })),
      ...todos.performances.map((item) => ({
        key: `perf_${item.performanceId}`,
        type: 'performance',
        typeLabel: '待审成绩',
        title: item.studentName,
        detail: `${store.eventByCode(item.eventCode).name} ${formatMetric(item.value, store.eventByCode(item.eventCode).unit)} · ${item.achievedAt}`,
        reason: ''
      })),
      ...todos.feedback.map((item) => ({
        key: `fb_${item.feedbackId}`,
        type: 'feedback',
        typeLabel: '待评价反馈',
        title: item.studentName,
        detail: `${item.attendanceDate} · RPE ${item.rpe}/10`,
        reason: item.comment || ''
      }))
    ],
    pendingPerformances: todos.performances,
    pendingLeaves: todos.leaves,
    attentionFeedback: todos.feedback,
    competitionIntents: intents.map((item) => ({
      registrationId: item.registrationId,
      competitionTitle: item.competitionTitle,
      studentName: item.studentName,
      statusLabel: COMPETITION_STATUS_LABELS[item.status] || item.status
    })),
    feedbackTotal: feedback.length,
    catalogGroups: groupCatalog(COACH_CATALOG)
  };
}

/* ------------------------------------------------------------------ 目录 */

const COACH_CATALOG = Object.freeze([
  { id: 'plans', name: '训练计划', group: '训练管理', tone: 'brand', icon: '计', desc: '查看计划/发布草稿' },
  { id: 'attendance', name: '考勤管理', group: '训练管理', tone: 'ok', icon: '勤', desc: '场次与签到名单' },
  { id: 'leave', name: '请假审批', group: '训练管理', tone: 'accent', icon: '假', desc: '批准或驳回请假' },
  { id: 'performance-review', name: '成绩审核', group: '学生与成绩', tone: 'ok', icon: '审', desc: '通过或驳回成绩申报' },
  { id: 'roster', name: '学生名册', group: '学生与成绩', tone: 'brand', icon: '册', desc: '授权训练组内学生' },
  { id: 'leaderboard', name: '排行榜', group: '学生与成绩', tone: 'plain', icon: '榜', desc: '正式成绩周期榜' },
  { id: 'feedback', name: '训练反馈', group: '沟通与赛事', tone: 'plain', icon: '馈', desc: '查看并补充教练评价' },
  { id: 'competition', name: '赛事管理', group: '沟通与赛事', tone: 'accent', icon: '赛', desc: '办理报名意向' },
  { id: 'notice', name: '通知发布', group: '沟通与赛事', tone: 'brand', icon: '通', desc: '发布训练组通知' }
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

class DemoModuleError extends Error {}

function buildCoachModule(moduleId, coachId = DEMO_COACH_ID) {
  const definition = COACH_CATALOG.find((item) => item.id === moduleId);
  if (!definition) {
    throw new DemoModuleError(`演示模块不存在：${moduleId}`);
  }
  const builder = MODULE_BUILDERS[moduleId];
  if (!builder) {
    throw new DemoModuleError(`演示模块尚未实现：${moduleId}`);
  }
  const coach = coachById(coachId);
  return Object.assign(
    { id: definition.id, name: definition.name, group: definition.group, icon: definition.icon, tone: definition.tone },
    builder(coach)
  );
}

const MODULE_BUILDERS = {
  plans(coach) {
    const groupIds = store.groupsOfCoach(coach.id);
    const plans = store.allPlans().filter((plan) => groupIds.includes(plan.trainingGroupId));
    const drafts = plans.filter((plan) => plan.status === store.PLAN_STATUS.DRAFT);
    return {
      subtitle: `${store.groupNames(groupIds).join('、')}（虚构）`,
      summary: { label: '训练计划', value: String(plans.length), unit: '份', meta: `其中草稿 ${drafts.length} 份` },
      rows: plans.map((plan) =>
        row(plan.title, `${plan.startDate} 至 ${plan.endDate} · ${store.groupNames([plan.trainingGroupId])[0] || '未标注'}`, {
          chip: PLAN_STATUS_LABELS[plan.status] || plan.status,
          tone: plan.status === store.PLAN_STATUS.DRAFT ? 'warn' : 'ok',
          detail: { type: 'plan', id: plan.planId }
        })
      ),
      note: '教练端可见草稿；学生端只会看到已发布的计划。点击可查看计划详情与发布操作。'
    };
  },
  attendance(coach) {
    const sessions = store.sessionsOfCoach(coach.id);
    const students = store.studentsOfCoach(coach.id);
    return {
      subtitle: `${store.groupNames(store.groupsOfCoach(coach.id)).join('、')}（虚构）`,
      rows: sessions.map((session) => {
        const roster = students.filter((item) => item.groupIds.includes(session.trainingGroupId));
        const checked = roster.filter((student) =>
          store
            .attendanceOfStudent(student.id)
            .some((record) => record.sessionId === session.sessionId && record.status !== store.ATTENDANCE_STATUS.PENDING)
        ).length;
        return row(session.title, `${session.attendanceDate} · ${session.checkInOpenTime}–${session.checkInCloseTime} · ${session.locationName}`, {
          v: `${checked}/${roster.length}`,
          chip: session.phase === 'open' ? '签到中' : '待开始',
          tone: session.phase === 'open' ? 'ok' : ''
        });
      }),
      note: '名单与签到进度来自统一模拟数据源；学生端签到后会立即反映在此。'
    };
  },
  leave(coach) {
    const todos = store.coachTodos(coach.id);
    return {
      subtitle: '待审批请假（虚构）',
      summary: { label: '待审批', value: String(todos.leaves.length), unit: '条', meta: '批准后学生考勤自动标记为已批准请假' },
      rows: todos.leaves.map((item) =>
        row(item.studentName, `${item.attendanceDate} · ${item.reason}`, {
          chip: '待审批',
          tone: 'warn',
          detail: { type: 'leave', id: item.leaveId }
        })
      ),
      note: todos.leaves.length ? '点击进入详情后可模拟批准或驳回。' : '当前没有待审批请假。'
    };
  },
  'performance-review'(coach) {
    const todos = store.coachTodos(coach.id);
    return {
      subtitle: '待审核成绩（虚构）',
      summary: { label: '待审核', value: String(todos.performances.length), unit: '条', meta: '通过后才计入正式 PB 与排行榜' },
      rows: todos.performances.map((item) => {
        const event = store.eventByCode(item.eventCode);
        return row(`${item.studentName} · ${event.name}`, `${item.achievedAt} · 学生申报`, {
          v: formatMetric(item.value, event.unit),
          chip: '待审核',
          tone: 'warn',
          detail: { type: 'performance', id: item.performanceId }
        });
      }),
      note: '未审核成绩不会进入正式 PB 与排行榜。'
    };
  },
  roster(coach) {
    const students = store.studentsOfCoach(coach.id);
    return {
      subtitle: `${coach.name} 负责训练组（虚构）`,
      rows: students.map((student) => {
        const best = store.personalBests(student.id);
        return row(student.name, `${store.groupNames(student.groupIds).join('、')} · ${student.genderLabel}`, {
          v: best.length ? `${best[0].eventName} ${formatMetric(best[0].value, best[0].unit)}` : '暂无 PB',
          chip: store.pendingPerformances(student.id).length ? '有待审成绩' : '',
          tone: store.pendingPerformances(student.id).length ? 'warn' : ''
        });
      }),
      note: '教练只能看到本人负责训练组内的学生。'
    };
  },
  leaderboard(coach) {
    const groupIds = store.groupsOfCoach(coach.id);
    const rows = groupIds.length ? store.performanceLeaderboard('100m', groupIds[0]) : [];
    return {
      subtitle: `100米 · ${store.groupNames([groupIds[0]])[0] || '未选择训练组'}`,
      rows: rows.map((item) =>
        row(`第 ${item.rank} 名 · ${item.studentName}`, `${item.groupNames.join('、')} · 教练：${item.coachNames.join('、')}`, {
          v: formatMetric(item.value, '秒')
        })
      ),
      note: '排行榜只使用已审核成绩；并列成绩使用相同名次。'
    };
  },
  feedback(coach) {
    const entries = store.feedbackOfCoach(coach.id);
    return {
      subtitle: '训练反馈（虚构）',
      rows: entries.map((item) =>
        row(`${item.studentName} · ${item.attendanceDate}`, `RPE ${item.rpe}/10 · ${item.comment || '未填写说明'}`, {
          chip: item.coachComment ? '已评价' : '待评价',
          tone: item.coachComment ? 'ok' : 'warn',
          detail: { type: 'feedback', id: item.feedbackId }
        })
      ),
      note: '教练内部评价默认不向家长展示。'
    };
  },
  competition(coach) {
    const intents = store.intentsOfCoach(coach.id);
    return {
      subtitle: '赛事报名意向（虚构）',
      rows: intents.map((item) =>
        row(`${item.studentName} · ${item.competitionTitle}`, (item.items || []).map((i) => `${i.eventName}·${i.category}`).join('、') || '未选择项目', {
          chip: COMPETITION_STATUS_LABELS[item.status] || item.status,
          tone: item.status === 'registered' ? 'ok' : 'warn',
          detail: { type: 'intent', id: item.registrationId }
        })
      ),
      note: '“已代报”仅表示教练已在外部平台完成报名，不代表主办方审核通过。'
    };
  },
  notice(coach) {
    return {
      subtitle: '发布训练组通知（虚构）',
      formFields: [
        { label: '通知标题', value: '演示：训练时间调整' },
        { label: '通知正文', value: '因场地安排，本周训练顺延 30 分钟，请提前到场热身。' }
      ],
      submitText: '模拟发布通知',
      submitKind: 'publish-notice',
      rows: store.noticesForStudent(store.STUDENTS[0].id).map((notice) =>
        row(notice.title, `${notice.categoryLabel} · ${notice.publishedAt}`, { chip: notice.priority === 'important' ? '重要' : '普通', tone: notice.priority === 'important' ? 'danger' : '' })
      ),
      note: '模拟发布只写入本地演示数据源，学生端通知列表会立即出现该通知。'
    };
  }
};

/* ------------------------------------------------------ 详情与模拟操作 */

function buildCoachDetail(detailType, detailId, coachId = DEMO_COACH_ID) {
  const coach = coachById(coachId);

  if (detailType === 'plan') {
    const plan = store.allPlans().find((item) => item.planId === detailId);
    if (!plan) {
      throw new DemoModuleError(`演示计划不存在：${detailId}`);
    }
    return {
      title: plan.title,
      chip: PLAN_STATUS_LABELS[plan.status] || plan.status,
      tone: plan.status === store.PLAN_STATUS.DRAFT ? 'warn' : 'ok',
      metaLine: `${store.groupNames([plan.trainingGroupId])[0] || '未标注'} · ${plan.startDate} 至 ${plan.endDate}`,
      body: plan.notes || '（无教练注意事项）',
      items: plan.items.map((item) => `${item.order}. ${item.name}（${item.categoryLabel}）`),
      actions: plan.status === store.PLAN_STATUS.DRAFT
        ? [{ kind: 'publish-plan', id: plan.planId, label: '模拟发布计划', tone: 'primary' }]
        : [],
      linkageNote: '发布后学生端训练计划列表会立即出现该计划。'
    };
  }

  if (detailType === 'leave') {
    const leave = store.getState().leaves.find((item) => item.leaveId === detailId);
    if (!leave) {
      throw new DemoModuleError(`演示请假不存在：${detailId}`);
    }
    const student = store.studentById(leave.studentId) || {};
    return {
      title: `${student.name} · 请假审批`,
      chip: LEAVE_STATUS_LABELS[leave.status] || leave.status,
      tone: 'warn',
      metaLine: `${leave.attendanceDate} · 原因仅教练可见`,
      body: leave.reason,
      items: [`学生：${student.name}`, `训练组：${store.groupNames(student.groupIds).join('、')}`],
      actions: leave.status === store.LEAVE_STATUS.PENDING
        ? [
            { kind: 'approve-leave', id: leave.leaveId, label: '模拟批准', tone: 'primary' },
            { kind: 'reject-leave', id: leave.leaveId, label: '模拟驳回', tone: 'danger' }
          ]
        : [],
      linkageNote: '批准后学生端考勤会显示“已批准请假”，家长端同步可见（不含请假原因）。'
    };
  }

  if (detailType === 'performance') {
    const record = store.getState().performances.find((item) => item.performanceId === detailId);
    if (!record) {
      throw new DemoModuleError(`演示成绩不存在：${detailId}`);
    }
    const event = store.eventByCode(record.eventCode);
    const student = store.studentById(record.studentId) || {};
    return {
      title: `${student.name} · ${event.name}`,
      chip: PERF_STATUS_LABELS[record.status] || record.status,
      tone: 'warn',
      metaLine: `${record.achievedAt} · 来源：${record.source === 'student' ? '学生申报' : '教练录入'}`,
      body: `成绩：${formatMetric(record.value, event.unit)}（${event.comparison === 'lower' ? '数值越低越好' : '数值越高越好'}）`,
      items: [`当前正式 PB：${(store.personalBests(student.id).map((i) => `${i.eventName} ${formatMetric(i.value, i.unit)}`).join(' · ')) || '暂无'}`],
      actions: record.status === store.PERF_STATUS.PENDING
        ? [
            { kind: 'approve-performance', id: record.performanceId, label: '模拟通过', tone: 'primary' },
            { kind: 'reject-performance', id: record.performanceId, label: '模拟驳回', tone: 'danger' }
          ]
        : [],
      linkageNote: '通过后该成绩会计入学生正式 PB 与排行榜；未通过则不会。'
    };
  }

  if (detailType === 'feedback') {
    const entry = store.feedbackOfCoach(coach.id).find((item) => item.feedbackId === detailId);
    if (!entry) {
      throw new DemoModuleError(`演示反馈不存在：${detailId}`);
    }
    return {
      title: `${entry.studentName} · 训练反馈`,
      chip: entry.coachComment ? '已评价' : '待评价',
      tone: entry.coachComment ? 'ok' : 'warn',
      metaLine: `${entry.attendanceDate} · RPE ${entry.rpe}/10`,
      body: entry.comment || '（学生未填写说明）',
      items: entry.coachComment ? [`教练评价：${entry.coachComment}`] : [],
      actions: entry.coachComment ? [] : [{ kind: 'comment-feedback', id: entry.feedbackId, label: '模拟补充评价', tone: 'primary' }],
      linkageNote: '教练评价默认不向家长展示。'
    };
  }

  if (detailType === 'intent') {
    const intent = store.intentsOfCoach(coach.id).find((item) => item.registrationId === detailId);
    if (!intent) {
      throw new DemoModuleError(`演示赛事意向不存在：${detailId}`);
    }
    return {
      title: `${intent.studentName} · ${intent.competitionTitle}`,
      chip: COMPETITION_STATUS_LABELS[intent.status] || intent.status,
      tone: 'accent',
      metaLine: (intent.items || []).map((i) => `${i.eventName}·${i.category}`).join('、') || '未选择项目',
      body: intent.contactNote || '（无补充说明）',
      items: [`办理说明：${intent.reviewNote || '暂无'}`],
      actions: intent.status === store.COMPETITION_STATUS.SUBMITTED || intent.status === store.COMPETITION_STATUS.PROCESSING
        ? [{ kind: 'register-intent', id: intent.registrationId, label: '模拟标记已代报', tone: 'primary' }]
        : [],
      linkageNote: '“已代报”只表示教练在外部平台完成报名，不代表主办方审核通过。'
    };
  }

  throw new DemoModuleError(`演示详情类型不支持：${detailType}`);
}

module.exports = {
  COACH_CATALOG,
  COACH_SWITCH_OPTIONS,
  DEMO_COACH_ID,
  COMPETITION_STATUS_LABELS,
  LEAVE_STATUS_LABELS,
  PERF_STATUS_LABELS,
  PLAN_STATUS_LABELS,
  buildCoachDetail,
  buildCoachModule,
  buildCoachWorkbench,
  coachById,
  formatMetric,
  DemoModuleError
};
