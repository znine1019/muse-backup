'use strict';

/**
 * D1-B 补充｜家长端演示视图（读取 showcase-store 统一数据源）
 *
 * 关键变化：
 *   1. 展示数据来自统一数据源，教练端审核成绩 / 批准请假 / 发布通知后，
 *      重新进入家长端即可看到变化；
 *   2. **详情入口带授权校验**：直接以旧详情 ID 打开、或切换到未生效关联的学生后，
 *      都无法读取未授权学生的数据；
 *   3. 家长端始终只读，且不展示 GPS 精确位置、请假原因与教练内部评价。
 *
 * 本模块不引用任何正式业务接口。
 */

const store = require('./showcase-store');

const DEMO_PARENT_ID = 'parent_lin';

/* 与 cloudfunctions/api/lib/constants.js 的 PARENT_LINK_STATUS 完全一致（测试会交叉校验） */
const PARENT_LINK_STATUS = store.LINK_STATUS;

const LINK_STATE_LABELS = Object.freeze({
  active: '关联已生效',
  pending_review: '待开发者核验',
  pending_student: '待学生确认',
  rejected: '关联已驳回',
  revoked: '关联已解除'
});

/** 需要"关联生效"才能展示的受保护模块 */
const PROTECTED_MODULE_IDS = Object.freeze([
  'overview',
  'plans',
  'performance',
  'attendance',
  'feedback',
  'events'
]);

const COMPLETION_LABELS = Object.freeze({
  completed: '全部完成',
  partial: '部分完成',
  not_completed: '未完成'
});

const COMPETITION_LABELS = Object.freeze({
  submitted: '已提交意向',
  processing: '教练处理中',
  registered: '教练已代报',
  failed: '未完成',
  cancelled: '已取消'
});

class DemoModuleError extends Error {}

/** 授权失败用独立错误码区分，便于页面展示“无权查看”而不是“数据加载失败” */
function unauthorizedError(message) {
  const error = new DemoModuleError(message);
  error.code = 'DEMO_NOT_AUTHORIZED';
  return error;
}

function isLinkActive(linkState) {
  return linkState === PARENT_LINK_STATUS.ACTIVE;
}

function linkStateLabel(linkState) {
  return LINK_STATE_LABELS[linkState] || '关联状态未知';
}

function linkedStudents() {
  return store.linkedStudentsOfParent(DEMO_PARENT_ID);
}

/* 兼容既有导出：STUDENTS 为两名虚构学生（含各自关联状态） */
const STUDENTS = linkedStudents();

function normalizeIndex(index) {
  const value = Number(index);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(Math.floor(value), Math.max(0, STUDENTS.length - 1));
}

function studentPayloads() {
  return STUDENTS.map((item) => ({
    id: item.id,
    studentUserId: item.id,
    name: item.name,
    tag: item.tag,
    primaryEventName: store.eventByCode(item.primaryEventCode) ? store.eventByCode(item.primaryEventCode).name : '',
    trainingGroupName: store.groupNames(item.groupIds)[0] || '',
    linkState: item.linkState,
    linkStateLabel: linkStateLabel(item.linkState)
  }));
}

/** 家长当前有权读取的训练组（仅来自"已生效"关联的学生） */
function authorizedGroupIds() {
  const groups = new Set();
  for (const student of STUDENTS) {
    if (isLinkActive(student.linkState)) {
      for (const groupId of student.groupIds) {
        groups.add(groupId);
      }
    }
  }
  return groups;
}

function eventName(code) {
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

/* --------------------------------------------------------------- 通知 */

/** 通知是否落在家长"已生效"授权的训练组范围内 */
function isNoticeAuthorized(notice) {
  const groups = authorizedGroupIds();
  return (notice.groupIds || []).some((groupId) => groups.has(groupId));
}

function authorizedNotices() {
  return store.getState().notices.filter((notice) => isNoticeAuthorized(notice));
}

function noticeRows() {
  return authorizedNotices().map((notice) => ({
    id: notice.noticeId,
    title: notice.title,
    categoryLabel: notice.categoryLabel,
    publishedAt: notice.publishedAt,
    chip: notice.priority === 'important' ? '重要' : '普通',
    detailText: notice.content,
    studentId: ''
  }));
}

/**
 * 通知详情（带授权校验）：
 * 即使拿到旧详情 ID，只要该通知不属于家长已生效授权的训练组，就直接拒绝。
 */
function getParentNotice(noticeId) {
  const notice = store.getState().notices.find((item) => item.noticeId === noticeId);
  if (!notice) {
    throw new DemoModuleError(`演示通知不存在：${noticeId}`);
  }
  if (!isNoticeAuthorized(notice)) {
    throw unauthorizedError('该通知不在当前已授权的学生范围内。');
  }
  return {
    entry: {
      id: notice.noticeId,
      title: notice.title,
      categoryLabel: notice.categoryLabel,
      publishedAt: notice.publishedAt,
      chip: notice.priority === 'important' ? '重要' : '普通',
      detailText: notice.content
    },
    student: { name: '' }
  };
}

/* --------------------------------------------------------------- 赛事 */

function authorizedIntents() {
  const activeIds = STUDENTS.filter((item) => isLinkActive(item.linkState)).map((item) => item.id);
  return store
    .getState()
    .competitionIntents.filter((intent) => activeIds.includes(intent.studentId));
}

function competitionRows() {
  return authorizedIntents().map((intent) => {
    const competition = store.getState().competitions.find((item) => item.competitionId === intent.competitionId) || {};
    const student = store.studentById(intent.studentId) || {};
    return {
      id: intent.registrationId,
      title: `${competition.title || intent.competitionId}`,
      metaText: `${(intent.items || []).map((item) => item.eventName).join('、') || '未选择项目'} · ${student.name || ''}`,
      chip: COMPETITION_LABELS[intent.status] || intent.status,
      detailText: intent.reviewNote || '教练尚未回填办理说明。',
      studentId: intent.studentId
    };
  });
}

/** 赛事详情（带授权校验）：未生效关联学生的意向不允许被打开 */
function getParentCompetition(competitionId) {
  const intent = store
    .getState()
    .competitionIntents.find((item) => item.registrationId === competitionId);
  if (!intent) {
    throw new DemoModuleError(`演示赛事意向不存在：${competitionId}`);
  }
  const student = STUDENTS.find((item) => item.id === intent.studentId);
  if (!student || !isLinkActive(student.linkState)) {
    throw unauthorizedError('该赛事意向不属于当前已授权的学生。');
  }
  const competition = store.getState().competitions.find((item) => item.competitionId === intent.competitionId) || {};
  return {
    entry: {
      id: intent.registrationId,
      title: competition.title || intent.competitionId,
      metaText: (intent.items || []).map((item) => item.eventName).join('、') || '未选择项目',
      chip: COMPETITION_LABELS[intent.status] || intent.status,
      detailText: intent.reviewNote || '教练尚未回填办理说明。'
    },
    student: { name: student.name }
  };
}

/* ----------------------------------------------------------- 工作台 */

function buildParentWorkbench(index, options = {}) {
  const safeIndex = normalizeIndex(index);
  const students = studentPayloads();
  const student = students[safeIndex];
  const linkState = options.linkState || student.linkState;
  const active = isLinkActive(linkState);

  const base = {
    students,
    studentIndex: safeIndex,
    currentStudent: { ...student, linkState, linkStateLabel: linkStateLabel(linkState) },
    linkState,
    linkStateLabel: linkStateLabel(linkState),
    linkActive: active,
    catalogGroups: groupCatalog(CATALOG)
  };

  /* 关联未生效：不返回任何受保护业务数据 */
  if (!active) {
    return Object.assign(base, {
      accessNotice: `该学生的关联状态为“${linkStateLabel(linkState)}”，在关联正式生效前不展示成绩、训练计划、考勤、训练反馈与赛事等受保护数据。`,
      overview: null,
      plans: [],
      performanceRows: [],
      attendanceRows: [],
      feedbackRows: [],
      competitionRows: [],
      noticeRows: []
    });
  }

  const studentId = student.id;
  const bests = store.personalBests(studentId);
  const approved = store.approvedPerformances(studentId);
  const attendance = store.attendanceOfStudent(studentId);
  const leaves = store.leavesOfStudent(studentId);
  const feedback = store.feedbackOfStudent(studentId);
  const plans = store.visiblePlansForStudent(studentId);

  const best = bests[0] || null;
  const checkedIn = attendance.filter((item) => item.status === store.ATTENDANCE_STATUS.CHECKED_IN).length;
  const late = attendance.filter((item) => item.status === store.ATTENDANCE_STATUS.LATE).length;
  const absent = attendance.filter((item) => item.status === store.ATTENDANCE_STATUS.ABSENT).length;
  const leaveApproved = attendance.filter((item) => item.status === store.ATTENDANCE_STATUS.LEAVE_APPROVED).length;

  return Object.assign(base, {
    accessNotice: '',
    overview: {
      pb: best ? { eventName: best.eventName, value: String(best.value), unit: best.unit } : { eventName: '暂无正式成绩', value: '—', unit: '' },
      approvedCount: approved.length,
      attendance: {
        validAttendance: checkedIn + late,
        actualExpected: Math.max(attendance.length, checkedIn + late + absent + leaveApproved),
        late,
        absent,
        approvedLeave: leaveApproved,
        pendingVerification: attendance.filter((item) => item.status === store.ATTENDANCE_STATUS.PENDING_VERIFICATION).length
      }
    },
    plans: plans.map((plan) => ({
      planId: plan.planId,
      title: plan.title,
      rangeText: `${plan.startDate} 至 ${plan.endDate}`,
      itemCountText: `${(plan.items || []).length} 项内容`
    })),
    performanceRows: approved.map((record) => {
      const event = store.eventByCode(record.eventCode);
      return {
        eventName: event.name,
        dateText: `取得日期：${record.achievedAt}`,
        valueText: formatMetric(record.value, event.unit),
        value: record.value,
        unit: event.unit
      };
    }),
    attendanceRows: attendance.map((record) => ({
      dateText: record.attendanceDate,
      /* 家长端只看签到状态，不展示精确位置与请假原因 */
      chip: ATTENDANCE_LABELS[record.status] || record.status
    })),
    feedbackRows: feedback.map((entry) => ({
      dateText: entry.attendanceDate,
      metaText: `${COMPLETION_LABELS[entry.completionStatus] || entry.completionStatus} · RPE ${entry.rpe}/10`
      /* 明确不返回 coachComment 与 comment 原文 */
    })),
    competitionRows: competitionRows(),
    noticeRows: noticeRows(),
    leaveSummary: leaves.length,
    linkStateLabel: linkStateLabel(linkState)
  });
}

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

/* ------------------------------------------------------------ 目录与模块 */

const CATALOG = Object.freeze([
  { id: 'overview', name: '学生概览', group: '学生概览', tone: 'accent', icon: '览', desc: 'PB、出勤与关键指标' },
  { id: 'plans', name: '训练计划', group: '学生概览', tone: 'brand', icon: '计', desc: '已发布训练安排' },
  { id: 'performance', name: '运动成绩', group: '学生概览', tone: 'ok', icon: '绩', desc: '仅已审核正式成绩' },
  { id: 'attendance', name: '考勤记录', group: '学生概览', tone: 'plain', icon: '勤', desc: '签到状态（无位置与原因）' },
  { id: 'feedback', name: '训练反馈', group: '学生概览', tone: 'brand', icon: '馈', desc: '完成情况与自评强度' },
  { id: 'events', name: '赛事与通知', group: '学生概览', tone: 'accent', icon: '赛', desc: '赛事进度与通知' },
  { id: 'link', name: '关联学生管理', group: '关联与账号', tone: 'brand', icon: '联', desc: '关联状态与授权管理' },
  { id: 'account', name: '个人中心', group: '关联与账号', tone: 'plain', icon: '人', desc: '身份与退出演示' }
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

function buildParentModule(moduleId, index, options = {}) {
  const definition = CATALOG.find((item) => item.id === moduleId);
  if (!definition) {
    throw new DemoModuleError(`演示模块不存在：${moduleId}`);
  }
  const safeIndex = normalizeIndex(index);
  const students = studentPayloads();
  const student = students[safeIndex];
  const linkState = options.linkState || student.linkState;
  const active = isLinkActive(linkState);

  const header = {
    id: definition.id,
    name: definition.name,
    group: definition.group,
    icon: definition.icon,
    tone: definition.tone,
    subtitle: `${student.name}（虚构）· ${student.primaryEventName}`
  };

  if (!active && PROTECTED_MODULE_IDS.indexOf(moduleId) !== -1) {
    return Object.assign(header, {
      subtitle: `${student.name}（虚构）· ${linkStateLabel(linkState)}`,
      restricted: true,
      restrictedReason: `该学生的关联状态为“${linkStateLabel(linkState)}”，关联正式生效前不展示成绩、训练计划、考勤、训练反馈与赛事等受保护数据。`,
      rows: [],
      note: '可切换到关联已生效的学生查看业务数据，或先完成关联授权流程。'
    });
  }

  const workbench = buildParentWorkbench(safeIndex, options);

  if (moduleId === 'overview') {
    return Object.assign(header, {
      summary: {
        label: '个人最好成绩 PB',
        value: workbench.overview.pb.value,
        unit: workbench.overview.pb.unit,
        meta: `${workbench.overview.pb.eventName} · 教练已审核的正式成绩`
      },
      rows: [
        row('演示周期有效出勤', `应签到 ${workbench.overview.attendance.actualExpected} 次`, { v: `${workbench.overview.attendance.validAttendance} 次` }),
        row('已批准请假', '请假原因不向家长展示', { v: `${workbench.overview.attendance.approvedLeave} 次` }),
        row('迟到 / 未签到', '数值为虚构演示数据', { v: `${workbench.overview.attendance.late} / ${workbench.overview.attendance.absent}` })
      ],
      note: '家长端为只读视图。'
    });
  }
  if (moduleId === 'plans') {
    return Object.assign(header, {
      rows: workbench.plans.map((item) => row(item.title, `${item.rangeText} · ${item.itemCountText}`)),
      note: '仅展示教练已发布的训练计划。'
    });
  }
  if (moduleId === 'performance') {
    return Object.assign(header, {
      rows: workbench.performanceRows.map((item) => row(item.eventName, item.dateText, { v: item.valueText })),
      note: '未审核、已驳回的成绩不会展示给家长。'
    });
  }
  if (moduleId === 'attendance') {
    return Object.assign(header, {
      rows: workbench.attendanceRows.map((item) => row(item.dateText, '不展示精确位置，仅显示签到状态', { chip: item.chip, tone: statusTone(item.chip) })),
      note: '不展示精确 GPS 位置与请假原因。'
    });
  }
  if (moduleId === 'feedback') {
    return Object.assign(header, {
      rows: workbench.feedbackRows.map((item) => row(item.dateText, item.metaText)),
      note: '仅共享完成情况与学生自评强度，教练内部评价默认不向家长展示。'
    });
  }
  if (moduleId === 'events') {
    return Object.assign(header, {
      rows: workbench.competitionRows
        .map((item) => row(item.title, item.metaText, { chip: item.chip, tone: statusTone(item.chip), detail: { type: 'competition', id: item.id } }))
        .concat(
          workbench.noticeRows.map((item) =>
            row(item.title, `${item.categoryLabel} · ${item.publishedAt}`, { chip: item.chip, tone: item.chip === '重要' ? 'danger' : '', detail: { type: 'notice', id: item.id } })
          )
        ),
      note: '报名意向不等于官方报名成功，正式报名由教练在赛事官方渠道完成。'
    });
  }
  if (moduleId === 'link') {
    return Object.assign(header, {
      rows: students.map((item) =>
        row(item.name, `${item.tag} · 监护关系（虚构）`, {
          chip: item.linkStateLabel,
          tone: isLinkActive(item.linkState) ? 'ok' : 'warn'
        })
      ),
      note: '演示环境不生成真实关联凭证、不修改任何授权关系；家长端始终保持只读。'
    });
  }
  if (moduleId === 'account') {
    return Object.assign(header, {
      rows: [
        row('当前身份', '演示预览中的家长视角（非真实角色）', { chip: '只读', tone: 'plain' }),
        row('关联学生', `共 ${students.length} 名虚构学生`, { v: `${students.length} 名` }),
        row('退出演示', '返回 DEMO 首页，不改变真实账号角色', { chip: '返回', tone: 'brand' })
      ],
      note: '退出演示后真实账号角色与权限保持不变。'
    });
  }
  throw new DemoModuleError(`演示模块尚未实现：${moduleId}`);
}

function statusTone(label) {
  if (!label) {
    return '';
  }
  if (label.indexOf('已签到') === 0 || label.indexOf('已批准') === 0 || label.indexOf('已代报') >= 0) {
    return 'ok';
  }
  if (label.indexOf('迟到') === 0 || label.indexOf('未签到') === 0 || label.indexOf('处理中') >= 0 || label.indexOf('待') >= 0) {
    return 'warn';
  }
  return '';
}

module.exports = {
  ATTENDANCE_LABELS,
  CATALOG,
  COMPETITION_LABELS,
  COMPLETION_LABELS,
  DEMO_PARENT_ID,
  LINK_STATE_LABELS,
  PARENT_LINK_STATUS,
  PROTECTED_MODULE_IDS,
  STUDENTS,
  buildParentModule,
  buildParentWorkbench,
  catalog: CATALOG,
  getParentCompetition,
  getParentNotice,
  isLinkActive,
  linkStateLabel,
  DemoModuleError
};
