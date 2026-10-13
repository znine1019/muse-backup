'use strict';

/**
 * D1-B｜三角色统一虚构数据源（仅存在于 demo/showcase-v1 分支）
 *
 * 单一数据源 + 角色视图派生 + 本地模拟写入：
 *   学生端 / 教练员端 / 家长端 读取的都是这里同一份内存数据，
 *   教练端的模拟操作会立即反映到学生端与家长端视图上（三角色联动）。
 *
 * 安全边界：
 *   1. 全部为虚构数据，不含任何真实学生、家长、教练资料；
 *   2. 仅存在于内存：不写 storage、不写数据库；
 *   3. 本模块不引用任何业务接口（api.js），因此模拟操作不可能触达正式云端。
 */

const PLAN_STATUS = Object.freeze({ DRAFT: 'draft', PUBLISHED: 'published', ARCHIVED: 'archived' });
const PLAN_VISIBLE_STATUS = PLAN_STATUS.PUBLISHED;

const PERF_STATUS = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' });

const LEAVE_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
});

const ATTENDANCE_STATUS = Object.freeze({
  PENDING: 'pending',
  CHECKED_IN: 'checked_in',
  LATE: 'late',
  ABSENT: 'absent',
  LEAVE_APPROVED: 'leave_approved',
  PENDING_VERIFICATION: 'pending_verification'
});

const LINK_STATUS = Object.freeze({
  OPEN: 'open',
  USED: 'used',
  EXPIRED: 'expired',
  LOCKED: 'locked',
  PENDING_STUDENT: 'pending_student',
  PENDING_REVIEW: 'pending_review',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  REVOKED: 'revoked'
});

const COMPETITION_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  PROCESSING: 'processing',
  REGISTERED: 'registered',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

/* ---------------------------------------------------------------- 基础数据 */

const EVENTS = Object.freeze([
  { code: '100m', name: '100米', unit: '秒', comparison: 'lower' },
  { code: 'long_jump', name: '跳远', unit: '米', comparison: 'higher' },
  { code: '800m', name: '800米', unit: '秒', comparison: 'lower' },
  { code: '1500m', name: '1500米', unit: '秒', comparison: 'lower' }
]);

/* 三个模拟训练组 */
const GROUPS = Object.freeze([
  { id: 'group_endurance', name: '中长跑队', seasonLabel: '2026春夏', enabled: true, coachIds: ['coach_lin', 'coach_su'] },
  { id: 'group_four', name: '四项组', seasonLabel: '2026春夏', enabled: true, coachIds: ['coach_su'] },
  { id: 'group_sprint', name: '专项组', seasonLabel: '2026春夏', enabled: true, coachIds: ['coach_lin'] }
]);

/* 两名模拟教练（预置带队授权，不依赖任何审批流程） */
const COACHES = Object.freeze([
  { id: 'coach_lin', name: '林教练', title: '主教练', groupIds: ['group_sprint', 'group_endurance'] },
  { id: 'coach_su', name: '苏教练', title: '助理教练', groupIds: ['group_four', 'group_endurance'] }
]);

/* 三名模拟学生 */
const STUDENTS = Object.freeze([
  {
    id: 'stu_lin',
    name: '林越',
    tag: '虚构演示学生',
    genderLabel: '男',
    birthDate: '2009-04-12',
    groupIds: ['group_sprint'],
    primaryEventCode: '100m',
    secondaryEventCodes: ['long_jump'],
    trainingStartYear: 2024,
    heightCm: 172.0,
    weightKg: 59.0,
    examGoal: { targetEventCode: '100m', targetValue: 11.5, examYear: 2027, targetSchool: '示例体育院校' }
  },
  {
    id: 'stu_su',
    name: '苏晴',
    tag: '虚构演示学生',
    genderLabel: '女',
    birthDate: '2010-01-08',
    groupIds: ['group_four'],
    primaryEventCode: 'long_jump',
    secondaryEventCodes: ['100m'],
    trainingStartYear: 2025,
    heightCm: 166.0,
    weightKg: 52.0,
    examGoal: { targetEventCode: 'long_jump', targetValue: 5.6, examYear: 2028, targetSchool: '示例体育院校' }
  },
  {
    id: 'stu_chen',
    name: '陈昊',
    tag: '虚构演示学生',
    genderLabel: '男',
    birthDate: '2008-09-21',
    groupIds: ['group_endurance'],
    primaryEventCode: '800m',
    secondaryEventCodes: ['1500m'],
    trainingStartYear: 2023,
    heightCm: 176.0,
    weightKg: 62.0,
    examGoal: { targetEventCode: '800m', targetValue: 130, examYear: 2027, targetSchool: '示例体育院校' }
  }
]);

/* 家长账号与亲子关联（预置，含"已生效 / 待核验"两种状态） */
const PARENTS = Object.freeze([
  {
    id: 'parent_lin',
    name: '林女士',
    tag: '虚构演示家长',
    links: [
      { studentId: 'stu_lin', status: LINK_STATUS.ACTIVE },
      { studentId: 'stu_su', status: LINK_STATUS.PENDING_REVIEW }
    ]
  }
]);

function baseState() {
  return {
    plans: [
      {
        planId: 'plan_speed',
        trainingGroupId: 'group_sprint',
        title: '第 8 周速度耐力',
        startDate: '2026-06-15',
        endDate: '2026-06-21',
        status: PLAN_STATUS.PUBLISHED,
        notes: '注意起跑器调试与加速段节奏。',
        items: [
          { itemId: 'plan_speed_1', order: 1, name: '60米加速跑', categoryLabel: '速度', distanceMeters: 60, sets: 6, reps: 1, restSeconds: 180 },
          { itemId: 'plan_speed_2', order: 2, name: '深蹲', categoryLabel: '力量', sets: 4, reps: 6, load: '70% 1RM' }
        ]
      },
      {
        planId: 'plan_tech',
        trainingGroupId: 'group_sprint',
        title: '第 8 周技术课',
        startDate: '2026-06-19',
        endDate: '2026-06-19',
        status: PLAN_STATUS.PUBLISHED,
        notes: '',
        items: [
          { itemId: 'plan_tech_1', order: 1, name: '起跑技术', categoryLabel: '技术', sets: 8, reps: 1 }
        ]
      },
      {
        /* 教练草稿：学生端不得出现 */
        planId: 'plan_draft',
        trainingGroupId: 'group_sprint',
        title: '第 9 周补强训练',
        startDate: '2026-06-22',
        endDate: '2026-06-28',
        status: PLAN_STATUS.DRAFT,
        notes: '尚未发布。',
        items: [{ itemId: 'plan_draft_1', order: 1, name: '阶梯跑', categoryLabel: '速度', distanceMeters: 300, sets: 4, reps: 1 }]
      },
      {
        planId: 'plan_jump',
        trainingGroupId: 'group_four',
        title: '第 8 周跳跃技术',
        startDate: '2026-06-16',
        endDate: '2026-06-21',
        status: PLAN_STATUS.PUBLISHED,
        notes: '',
        items: [{ itemId: 'plan_jump_1', order: 1, name: '助跑起跳', categoryLabel: '技术', sets: 6, reps: 3 }]
      },
      {
        planId: 'plan_endurance',
        trainingGroupId: 'group_endurance',
        title: '第 8 周有氧耐力',
        startDate: '2026-06-15',
        endDate: '2026-06-21',
        status: PLAN_STATUS.PUBLISHED,
        notes: '',
        items: [{ itemId: 'plan_endurance_1', order: 1, name: '1000米间歇', categoryLabel: '耐力', distanceMeters: 1000, sets: 5, reps: 1, restSeconds: 240 }]
      }
    ],

    attendanceSessions: [
      {
        sessionId: 'att_speed',
        trainingGroupId: 'group_sprint',
        title: '速度课 · 60米加速跑',
        attendanceDate: '2026-06-17',
        locationName: '田径场（虚构）',
        radiusMeters: 120,
        checkInOpenTime: '16:00',
        checkInCloseTime: '18:00',
        lateAfterTime: '16:15',
        phase: 'open',
        status: 'scheduled'
      },
      {
        sessionId: 'att_tech',
        trainingGroupId: 'group_sprint',
        title: '技术课 · 起跑与加速',
        attendanceDate: '2026-06-19',
        locationName: '田径场（虚构）',
        radiusMeters: 120,
        checkInOpenTime: '16:00',
        checkInCloseTime: '18:00',
        lateAfterTime: '16:15',
        phase: 'open',
        status: 'scheduled'
      },
      {
        sessionId: 'att_jump',
        trainingGroupId: 'group_four',
        title: '跳跃课 · 助跑起跳',
        attendanceDate: '2026-06-17',
        locationName: '跳跃区（虚构）',
        radiusMeters: 100,
        checkInOpenTime: '15:30',
        checkInCloseTime: '17:30',
        lateAfterTime: '15:45',
        phase: 'open',
        status: 'scheduled'
      },
      {
        sessionId: 'att_endurance',
        trainingGroupId: 'group_endurance',
        title: '耐力课 · 1000米间歇',
        attendanceDate: '2026-06-18',
        locationName: '环湖跑道（虚构）',
        radiusMeters: 150,
        checkInOpenTime: '07:00',
        checkInCloseTime: '08:30',
        lateAfterTime: '07:10',
        phase: 'scheduled',
        status: 'scheduled'
      }
    ],

    attendanceRecords: [
      { recordId: 'rec_lin_1', studentId: 'stu_lin', sessionId: 'att_speed', attendanceDate: '2026-06-10', status: ATTENDANCE_STATUS.CHECKED_IN, checkInAt: '2026-06-10 16:03', distanceMeters: 18 },
      { recordId: 'rec_lin_2', studentId: 'stu_lin', sessionId: 'att_prev', attendanceDate: '2026-06-12', status: ATTENDANCE_STATUS.LATE, checkInAt: '2026-06-12 16:22', distanceMeters: 42 },
      { recordId: 'rec_su_1', studentId: 'stu_su', sessionId: 'att_jump_prev', attendanceDate: '2026-06-10', status: ATTENDANCE_STATUS.CHECKED_IN, checkInAt: '2026-06-10 15:34', distanceMeters: 25 },
      { recordId: 'rec_chen_1', studentId: 'stu_chen', sessionId: 'att_end_prev', attendanceDate: '2026-06-11', status: ATTENDANCE_STATUS.CHECKED_IN, checkInAt: '2026-06-11 07:02', distanceMeters: 30 }
    ],

    leaves: [
      {
        leaveId: 'leave_lin_1',
        studentId: 'stu_lin',
        sessionId: 'att_prev_2',
        attendanceDate: '2026-06-16',
        reason: '校内考试冲突（虚构）',
        status: LEAVE_STATUS.APPROVED,
        reviewComment: '已核对考试安排（虚构）。'
      },
      {
        leaveId: 'leave_lin_2',
        studentId: 'stu_lin',
        sessionId: 'att_tech',
        attendanceDate: '2026-06-19',
        reason: '校内活动冲突（虚构）',
        status: LEAVE_STATUS.PENDING,
        reviewComment: ''
      },
      {
        leaveId: 'leave_su_1',
        studentId: 'stu_su',
        sessionId: 'att_jump',
        attendanceDate: '2026-06-17',
        reason: '身体不适（虚构）',
        status: LEAVE_STATUS.PENDING,
        reviewComment: ''
      },
      {
        leaveId: 'leave_chen_1',
        studentId: 'stu_chen',
        sessionId: 'att_endurance',
        attendanceDate: '2026-06-18',
        reason: '家庭安排（虚构）',
        status: LEAVE_STATUS.PENDING,
        reviewComment: ''
      }
    ],

    performances: [
      { performanceId: 'perf_lin_1', studentId: 'stu_lin', eventCode: '100m', value: 12.2, achievedAt: '2026-04-02', status: PERF_STATUS.APPROVED, source: 'coach', reviewComment: '' },
      { performanceId: 'perf_lin_2', studentId: 'stu_lin', eventCode: '100m', value: 11.95, achievedAt: '2026-05-07', status: PERF_STATUS.APPROVED, source: 'coach', reviewComment: '' },
      { performanceId: 'perf_lin_3', studentId: 'stu_lin', eventCode: '100m', value: 11.7, achievedAt: '2026-06-11', status: PERF_STATUS.APPROVED, source: 'student', reviewComment: '' },
      { performanceId: 'perf_lin_4', studentId: 'stu_lin', eventCode: 'long_jump', value: 5.35, achievedAt: '2026-06-05', status: PERF_STATUS.APPROVED, source: 'student', reviewComment: '' },
      { performanceId: 'perf_lin_5', studentId: 'stu_lin', eventCode: '100m', value: 11.65, achievedAt: '2026-06-20', status: PERF_STATUS.PENDING, source: 'student', reviewComment: '' },
      { performanceId: 'perf_su_1', studentId: 'stu_su', eventCode: 'long_jump', value: 5.35, achievedAt: '2026-06-08', status: PERF_STATUS.APPROVED, source: 'coach', reviewComment: '' },
      { performanceId: 'perf_su_2', studentId: 'stu_su', eventCode: 'long_jump', value: 5.45, achievedAt: '2026-06-19', status: PERF_STATUS.PENDING, source: 'student', reviewComment: '' },
      { performanceId: 'perf_chen_1', studentId: 'stu_chen', eventCode: '800m', value: 148, achievedAt: '2026-05-20', status: PERF_STATUS.APPROVED, source: 'coach', reviewComment: '' },
      { performanceId: 'perf_chen_2', studentId: 'stu_chen', eventCode: '800m', value: 145, achievedAt: '2026-06-18', status: PERF_STATUS.PENDING, source: 'student', reviewComment: '' }
    ],

    feedback: [
      { feedbackId: 'fb_lin_1', studentId: 'stu_lin', sessionId: 'att_speed', attendanceDate: '2026-06-10', completionStatus: 'completed', rpe: 7, comment: '节奏比上周稳（虚构）。', coachComment: '加速段起跑角度再压低一点。' },
      { feedbackId: 'fb_su_1', studentId: 'stu_su', sessionId: 'att_jump_prev', attendanceDate: '2026-06-10', completionStatus: 'partial', rpe: 8, comment: '助跑节奏不稳定（虚构）。', coachComment: '' },
      { feedbackId: 'fb_chen_1', studentId: 'stu_chen', sessionId: 'att_end_prev', attendanceDate: '2026-06-11', completionStatus: 'completed', rpe: 6, comment: '间歇配速达标（虚构）。', coachComment: '' }
    ],

    competitions: [
      { competitionId: 'comp_spring', title: '春季田径公开赛（虚构）', location: '市体育中心（虚构）', eventDate: '2026-07-18', registrationStartAt: '2026-06-01', registrationEndAt: '2026-06-30', phase: 'open', phaseLabel: '报名中', capacity: 0, requirements: '需提交近期正式成绩（虚构要求）', description: '内部意向收集，正式报名由教练在官方渠道完成。', itemOptions: [{ key: '100m', label: '100米' }, { key: 'long_jump', label: '跳远' }] },
      { competitionId: 'comp_city', title: '市青少年锦标赛（虚构）', location: '区体育场（虚构）', eventDate: '2026-08-08', registrationStartAt: '2026-06-10', registrationEndAt: '2026-07-10', phase: 'open', phaseLabel: '报名中', capacity: 20, requirements: '', description: '可多选项目意向。', itemOptions: [{ key: '100m', label: '100米' }, { key: '800m', label: '800米' }, { key: '1500m', label: '1500米' }] }
    ],

    competitionIntents: [
      { registrationId: 'intent_lin_1', studentId: 'stu_lin', competitionId: 'comp_spring', items: [{ eventCode: '100m', eventName: '100米', category: '公开组' }], contactNote: '', status: COMPETITION_STATUS.PROCESSING, reviewNote: '教练核对报名项目中（虚构）。' }
    ],

    notices: [
      { noticeId: 'notice_1', title: '本周训练调整', category: 'training', categoryLabel: '训练安排', publishedAt: '2026-06-15 09:20', publisherText: '短跑组教练（虚构）', priority: 'important', content: '因场地维护，本周三速度课调整至室内力量房，集合时间不变。请穿训练鞋并自带饮用水。', groupIds: ['group_sprint', 'group_four', 'group_endurance'], readBy: [] },
      { noticeId: 'notice_3', title: '跳跃组专项通知', category: 'training', categoryLabel: '训练安排', publishedAt: '2026-06-16 08:10', publisherText: '四项组教练（虚构）', priority: 'normal', content: '本周四项组增加一次助跑技术课，请按时到场。', groupIds: ['group_four'], readBy: [] },
      { noticeId: 'notice_2', title: '队内测试通知', category: 'test', categoryLabel: '测试安排', publishedAt: '2026-06-12 18:05', publisherText: '俱乐部（虚构）', priority: 'normal', content: '月底将进行队内测试，成绩经教练审核后计入正式成绩。', groupIds: ['group_sprint', 'group_four', 'group_endurance'], readBy: ['stu_lin'] }
    ]
  };
}

/* README 中记录的模拟训练组也已就位：中长跑队 / 四项组 / 专项组 */

function clone(value) {
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

let state = baseState();

function getState() {
  return state;
}

/** 重置演示数据（用于访客重新体验，只影响内存） */
function resetState() {
  state = baseState();
  return state;
}

/* ---------------------------------------------------------------- 查询工具 */

function eventByCode(code) {
  return EVENTS.find((item) => item.code === code) || null;
}

function studentById(studentId) {
  return STUDENTS.find((item) => item.id === studentId) || null;
}

function groupsOfStudent(studentId) {
  const student = studentById(studentId);
  return student ? student.groupIds.slice() : [];
}

function groupNames(groupIds) {
  return (groupIds || [])
    .map((id) => (GROUPS.find((group) => group.id === id) || {}).name)
    .filter(Boolean);
}

/** 教练负责的训练组（预置授权，无需审批） */
function groupsOfCoach(coachId) {
  const coach = COACHES.find((item) => item.id === coachId);
  return coach ? coach.groupIds.slice() : [];
}

/** 教练负责训练组内的学生 */
function studentsOfCoach(coachId) {
  const groupIds = groupsOfCoach(coachId);
  return STUDENTS.filter((student) => student.groupIds.some((id) => groupIds.includes(id)));
}

function coachNamesOfGroups(groupIds) {
  const names = [];
  for (const group of GROUPS) {
    if (!groupIds.includes(group.id)) {
      continue;
    }
    for (const coachId of group.coachIds) {
      const coach = COACHES.find((item) => item.id === coachId);
      if (coach && !names.includes(coach.name)) {
        names.push(coach.name);
      }
    }
  }
  return names;
}

/* ------------------------------------------------------------ 学生可见性 */

/** 学生可见计划：仅已发布，且属于本人训练组 */
function visiblePlansForStudent(studentId) {
  const groupIds = groupsOfStudent(studentId);
  return state.plans
    .filter((plan) => plan.status === PLAN_VISIBLE_STATUS && groupIds.includes(plan.trainingGroupId))
    .map(clone);
}

function allPlans() {
  return state.plans.map(clone);
}

function draftPlans() {
  return state.plans.filter((plan) => plan.status === PLAN_STATUS.DRAFT).map(clone);
}

function secondsText(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) {
    return '';
  }
  if (value % 60 === 0) {
    return `${value / 60} 分钟`;
  }
  return `${value} 秒`;
}

/** 三个角色统一使用的计划条目说明，避免各页面展示口径不一致 */
function planDetailItems(plan) {
  return (plan.items || []).map((item) => {
    const parts = [];
    if (item.categoryLabel) parts.push(item.categoryLabel);
    if (item.distanceMeters) parts.push(`${item.distanceMeters} 米`);
    if (item.sets) parts.push(`${item.sets} 组`);
    if (item.reps) parts.push(`${item.reps} 次`);
    if (item.load) parts.push(`负荷 ${item.load}`);
    if (item.intensity) parts.push(`强度 ${item.intensity}`);
    const recovery = secondsText(item.restSeconds || item.recoverySeconds);
    if (recovery) parts.push(`恢复 ${recovery}`);
    if (item.note) parts.push(item.note);
    return `${item.order || ''}. ${item.name}${parts.length ? `（${parts.join(' · ')}）` : ''}`.trim();
  });
}

/** 正式成绩：仅 approved；未审核不得进入 PB 与排行榜 */
function approvedPerformances(studentId) {
  return state.performances
    .filter((item) => item.studentId === studentId && item.status === PERF_STATUS.APPROVED)
    .map(clone);
}

function pendingPerformances(studentId) {
  return state.performances
    .filter((item) => item.studentId === studentId && item.status === PERF_STATUS.PENDING)
    .map(clone);
}

/** 个人最好成绩：按项目比较规则取最优（仅 approved） */
function personalBests(studentId) {
  const byEvent = {};
  for (const record of approvedPerformances(studentId)) {
    const event = eventByCode(record.eventCode);
    if (!event) {
      continue;
    }
    const current = byEvent[event.code];
    const better =
      current === undefined ||
      (event.comparison === 'lower' ? record.value < current.value : record.value > current.value);
    if (better) {
      byEvent[event.code] = record;
    }
  }
  return Object.values(byEvent).map((record) => {
    const event = eventByCode(record.eventCode);
    return {
      eventCode: event.code,
      eventName: event.name,
      unit: event.unit,
      value: record.value,
      achievedAt: record.achievedAt
    };
  });
}

/**
 * 排行榜：只使用已审核成绩，且限定训练组范围。
 * 并列成绩使用相同名次（标准竞赛排名规则）。
 */
function performanceLeaderboard(eventCode, groupId) {
  const event = eventByCode(eventCode);
  if (!event) {
    return [];
  }
  const rows = [];
  for (const student of STUDENTS) {
    if (groupId && !student.groupIds.includes(groupId)) {
      continue;
    }
    const best = personalBests(student.id).find((item) => item.eventCode === eventCode);
    if (!best) {
      continue;
    }
    rows.push({
      studentId: student.id,
      studentName: student.name,
      value: best.value,
      achievedAt: best.achievedAt,
      groupNames: groupNames(student.groupIds),
      coachNames: coachNamesOfGroups(student.groupIds)
    });
  }
  rows.sort((left, right) =>
    event.comparison === 'lower' ? left.value - right.value : right.value - left.value
  );

  let lastValue = null;
  let lastRank = 0;
  return rows.map((row, index) => {
    const rank = row.value === lastValue ? lastRank : index + 1;
    lastValue = row.value;
    lastRank = rank;
    return { ...row, rank };
  });
}

function noticesForStudent(studentId) {
  const groupIds = groupsOfStudent(studentId);
  return state.notices
    .filter((notice) => (notice.groupIds || []).some((id) => groupIds.includes(id)))
    .map((notice) => ({ ...clone(notice), isRead: (notice.readBy || []).includes(studentId) }));
}

/* ------------------------------------------------------------------ 家长 */

function linkStatusOf(parentId, studentId) {
  const parent = PARENTS.find((item) => item.id === parentId);
  if (!parent) {
    return '';
  }
  const link = parent.links.find((item) => item.studentId === studentId);
  return link ? link.status : '';
}

function isLinkActive(parentId, studentId) {
  return linkStatusOf(parentId, studentId) === LINK_STATUS.ACTIVE;
}

function linkedStudentsOfParent(parentId) {
  const parent = PARENTS.find((item) => item.id === parentId);
  if (!parent) {
    return [];
  }
  return parent.links
    .map((link) => ({ ...studentById(link.studentId), linkState: link.status }))
    .filter((item) => item && item.id);
}

function attendanceOfStudent(studentId) {
  return state.attendanceRecords.filter((item) => item.studentId === studentId).map(clone);
}

function leavesOfStudent(studentId) {
  return state.leaves.filter((item) => item.studentId === studentId).map(clone);
}

function feedbackOfStudent(studentId) {
  return state.feedback.filter((item) => item.studentId === studentId).map(clone);
}

function intentsOfStudent(studentId) {
  return state.competitionIntents.filter((item) => item.studentId === studentId).map(clone);
}

/* ------------------------------------------------------- 教练待办与名册 */

/** 教练待办：本人训练组内的待批请假 / 待审成绩 / 待评价反馈 */
function coachTodos(coachId) {
  const groupIds = groupsOfCoach(coachId);
  const studentIds = studentsOfCoach(coachId).map((item) => item.id);

  const leaves = state.leaves
    .filter((item) => studentIds.includes(item.studentId) && item.status === LEAVE_STATUS.PENDING)
    .map((item) => ({ ...clone(item), studentName: (studentById(item.studentId) || {}).name }));

  const performances = state.performances
    .filter((item) => studentIds.includes(item.studentId) && item.status === PERF_STATUS.PENDING)
    .map((item) => ({ ...clone(item), studentName: (studentById(item.studentId) || {}).name }));

  const feedback = state.feedback
    .filter((item) => studentIds.includes(item.studentId) && !item.coachComment)
    .map((item) => ({ ...clone(item), studentName: (studentById(item.studentId) || {}).name }));

  return { groupIds, studentIds, leaves, performances, feedback };
}

function sessionsOfCoach(coachId) {
  const groupIds = groupsOfCoach(coachId);
  return state.attendanceSessions
    .filter((session) => groupIds.includes(session.trainingGroupId))
    .map(clone);
}

function feedbackOfCoach(coachId) {
  const studentIds = studentsOfCoach(coachId).map((item) => item.id);
  return state.feedback
    .filter((item) => studentIds.includes(item.studentId))
    .map((item) => ({ ...clone(item), studentName: (studentById(item.studentId) || {}).name }));
}

function intentsOfCoach(coachId) {
  const studentIds = studentsOfCoach(coachId).map((item) => item.id);
  return state.competitionIntents
    .filter((item) => studentIds.includes(item.studentId))
    .map((item) => {
      const competition = state.competitions.find((c) => c.competitionId === item.competitionId) || {};
      return { ...clone(item), competitionTitle: competition.title, studentName: (studentById(item.studentId) || {}).name };
    });
}

/* ------------------------------------------------------------ 模拟写入 */

function findPlan(planId) {
  return state.plans.find((item) => item.planId === planId) || null;
}

/** 教练发布计划：发布后学生端立即可见 */
function publishPlan(planId) {
  const plan = findPlan(planId);
  if (!plan) {
    return { ok: false, reason: '计划不存在' };
  }
  plan.status = PLAN_STATUS.PUBLISHED;
  return { ok: true, plan: clone(plan) };
}

function createPlan(payload) {
  const plan = {
    planId: `plan_local_${state.plans.length + 1}`,
    trainingGroupId: payload.trainingGroupId,
    title: payload.title,
    startDate: payload.startDate,
    endDate: payload.endDate,
    status: PLAN_STATUS.DRAFT,
    notes: payload.notes || '',
    items: payload.items || []
  };
  state.plans.push(plan);
  return { ok: true, plan: clone(plan) };
}

/** 教练审批请假：通过后联动考勤为"已批准请假" */
function reviewLeave(leaveId, decision, comment) {
  const leave = state.leaves.find((item) => item.leaveId === leaveId);
  if (!leave || leave.status !== LEAVE_STATUS.PENDING) {
    return { ok: false, reason: '该请假不在待审批状态' };
  }
  leave.status = decision === 'approve' ? LEAVE_STATUS.APPROVED : LEAVE_STATUS.REJECTED;
  leave.reviewComment = comment || (decision === 'approve' ? '已批准（虚构）。' : '已驳回（虚构）。');
  if (leave.status === LEAVE_STATUS.APPROVED) {
    const existing = state.attendanceRecords.find(
      (item) => item.studentId === leave.studentId && item.sessionId === leave.sessionId
    );
    if (existing) {
      existing.status = ATTENDANCE_STATUS.LEAVE_APPROVED;
      existing.adjustReason = '请假已批准（虚构）';
    } else {
      state.attendanceRecords.push({
        recordId: `rec_local_${state.attendanceRecords.length + 1}`,
        studentId: leave.studentId,
        sessionId: leave.sessionId,
        attendanceDate: leave.attendanceDate,
        status: ATTENDANCE_STATUS.LEAVE_APPROVED,
        adjustReason: '请假已批准（虚构）'
      });
    }
  }
  return { ok: true, leave: clone(leave) };
}

/** 学生提交请假 */
function submitLeave(studentId, sessionId, reason) {
  const session = state.attendanceSessions.find((item) => item.sessionId === sessionId);
  const leave = {
    leaveId: `leave_local_${state.leaves.length + 1}`,
    studentId,
    sessionId,
    attendanceDate: session ? session.attendanceDate : '',
    reason: reason || '（演示未填写原因）',
    status: LEAVE_STATUS.PENDING,
    reviewComment: ''
  };
  state.leaves.push(leave);
  return { ok: true, leave: clone(leave) };
}

/** 学生签到（模拟：不获取真实定位） */
function checkIn(studentId, sessionId) {
  const session = state.attendanceSessions.find((item) => item.sessionId === sessionId);
  if (!session) {
    return { ok: false, reason: '场次不存在' };
  }
  const existing = state.attendanceRecords.find(
    (item) => item.studentId === studentId && item.sessionId === sessionId
  );
  if (existing && existing.status !== ATTENDANCE_STATUS.PENDING) {
    return { ok: false, reason: '已有签到记录' };
  }
  const record = {
    recordId: existing ? existing.recordId : `rec_local_${state.attendanceRecords.length + 1}`,
    studentId,
    sessionId,
    attendanceDate: session.attendanceDate,
    status: ATTENDANCE_STATUS.CHECKED_IN,
    checkInAt: `${session.attendanceDate} ${session.checkInOpenTime}`,
    distanceMeters: 12,
    simulated: true
  };
  if (existing) {
    Object.assign(existing, record);
  } else {
    state.attendanceRecords.push(record);
  }
  return { ok: true, record: clone(record) };
}

/** 学生提交成绩：进入待审核，不进入 PB 与排行榜 */
function submitPerformance(studentId, eventCode, value, achievedAt, note) {
  const record = {
    performanceId: `perf_local_${state.performances.length + 1}`,
    studentId,
    eventCode,
    value: Number(value),
    achievedAt,
    note: note || '',
    status: PERF_STATUS.PENDING,
    source: 'student',
    reviewComment: ''
  };
  state.performances.push(record);
  return { ok: true, record: clone(record) };
}

/** 教练审核成绩：通过后才进入 PB 与排行榜 */
function reviewPerformance(performanceId, decision, comment) {
  const record = state.performances.find((item) => item.performanceId === performanceId);
  if (!record || record.status !== PERF_STATUS.PENDING) {
    return { ok: false, reason: '该成绩不在待审核状态' };
  }
  record.status = decision === 'approve' ? PERF_STATUS.APPROVED : PERF_STATUS.REJECTED;
  record.reviewComment = comment || (decision === 'approve' ? '审核通过（虚构）。' : '审核驳回（虚构）。');
  return { ok: true, record: clone(record) };
}

/** 学生提交训练反馈 */
function submitFeedback(studentId, sessionId, completionStatus, rpe, comment) {
  const session = state.attendanceSessions.find((item) => item.sessionId === sessionId);
  const entry = {
    feedbackId: `fb_local_${state.feedback.length + 1}`,
    studentId,
    sessionId,
    attendanceDate: session ? session.attendanceDate : '',
    completionStatus,
    rpe: Number(rpe),
    comment: comment || '',
    coachComment: ''
  };
  state.feedback.push(entry);
  return { ok: true, feedback: clone(entry) };
}

/** 教练补充评语 */
function reviewFeedback(feedbackId, coachComment) {
  const entry = state.feedback.find((item) => item.feedbackId === feedbackId);
  if (!entry) {
    return { ok: false, reason: '反馈不存在' };
  }
  entry.coachComment = coachComment || '已关注（虚构）。';
  return { ok: true, feedback: clone(entry) };
}

/** 学生提交赛事意向 */
function submitCompetitionIntent(studentId, competitionId, items, note) {
  const existing = state.competitionIntents.find(
    (item) => item.studentId === studentId && item.competitionId === competitionId && item.status !== COMPETITION_STATUS.CANCELLED
  );
  if (existing) {
    return { ok: false, reason: '已提交过该赛事意向' };
  }
  const intent = {
    registrationId: `intent_local_${state.competitionIntents.length + 1}`,
    studentId,
    competitionId,
    items: items || [],
    contactNote: note || '',
    status: COMPETITION_STATUS.SUBMITTED,
    reviewNote: ''
  };
  state.competitionIntents.push(intent);
  return { ok: true, intent: clone(intent) };
}

function cancelCompetitionIntent(studentId, registrationId) {
  const intent = state.competitionIntents.find(
    (item) => item.registrationId === registrationId && item.studentId === studentId
  );
  if (!intent) {
    return { ok: false, reason: '意向不存在' };
  }
  intent.status = COMPETITION_STATUS.CANCELLED;
  return { ok: true, intent: clone(intent) };
}

/** 教练更新意向办理状态 */
function advanceCompetitionIntent(registrationId, nextStatus, note) {
  const intent = state.competitionIntents.find((item) => item.registrationId === registrationId);
  if (!intent) {
    return { ok: false, reason: '意向不存在' };
  }
  intent.status = nextStatus;
  intent.reviewNote = note || '';
  return { ok: true, intent: clone(intent) };
}

/** 教练发布通知 */
function publishNotice(payload) {
  const notice = {
    noticeId: `notice_local_${state.notices.length + 1}`,
    title: payload.title,
    category: 'training',
    categoryLabel: payload.categoryLabel || '训练安排',
    publishedAt: payload.publishedAt,
    publisherText: payload.publisherText || '教练（虚构）',
    priority: payload.priority || 'normal',
    content: payload.content,
    groupIds: payload.groupIds || [],
    readBy: []
  };
  state.notices.unshift(notice);
  return { ok: true, notice: clone(notice) };
}

/** 学生标记通知已读（仅内存） */
function markNoticeRead(studentId, noticeId) {
  const notice = state.notices.find((item) => item.noticeId === noticeId);
  if (!notice) {
    return { ok: false, reason: '通知不存在' };
  }
  notice.readBy = Array.from(new Set([...(notice.readBy || []), studentId]));
  return { ok: true };
}

module.exports = {
  ATTENDANCE_STATUS,
  COACHES,
  COMPETITION_STATUS,
  EVENTS,
  GROUPS,
  LEAVE_STATUS,
  LINK_STATUS,
  PARENTS,
  PERF_STATUS,
  PLAN_STATUS,
  PLAN_VISIBLE_STATUS,
  STUDENTS,
  advanceCompetitionIntent,
  allPlans,
  approvedPerformances,
  attendanceOfStudent,
  cancelCompetitionIntent,
  checkIn,
  coachNamesOfGroups,
  coachTodos,
  createPlan,
  draftPlans,
  eventByCode,
  feedbackOfCoach,
  feedbackOfStudent,
  getState,
  groupNames,
  groupsOfCoach,
  groupsOfStudent,
  intentsOfCoach,
  intentsOfStudent,
  isLinkActive,
  leavesOfStudent,
  linkStatusOf,
  linkedStudentsOfParent,
  markNoticeRead,
  noticesForStudent,
  pendingPerformances,
  performanceLeaderboard,
  personalBests,
  planDetailItems,
  publishNotice,
  publishPlan,
  resetState,
  reviewFeedback,
  reviewLeave,
  reviewPerformance,
  sessionsOfCoach,
  studentById,
  studentsOfCoach,
  submitCompetitionIntent,
  submitFeedback,
  submitLeave,
  submitPerformance,
  visiblePlansForStudent
};
