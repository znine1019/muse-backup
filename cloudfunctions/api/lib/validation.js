'use strict';

const {
  ATTENDANCE_RECORD_STATUS,
  ATTENDANCE_SESSION_STATUS,
  LEAVE_STATUS,
  LIMITS,
  ROLE_VALUES
} = require('./constants');
const { isDateOnly } = require('./dates');
const { getPerformanceEvent } = require('./performance-events');
const { fail } = require('./errors');

const GENDERS = Object.freeze(['male', 'female', 'unspecified']);
const REVIEW_DECISIONS = Object.freeze(['approve', 'reject']);
const PERFORMANCE_REVIEW_DECISIONS = REVIEW_DECISIONS;
const MAX_SECONDARY_EVENTS = 3;
const PLAN_CATEGORIES = Object.freeze([
  'sprint',
  'middle_long_distance',
  'strength',
  'jump',
  'throw',
  'recovery',
  'technique',
  'other'
]);
const PLAN_STATUSES = Object.freeze(['draft', 'published', 'archived']);
const PLAN_SCOPES = Object.freeze(['today', 'week', 'history']);
const MAX_PLAN_ITEMS = 20;

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_PAYLOAD', '提交的数据格式不正确。');
  }
  return value;
}

function requiredString(value, fieldLabel, maxLength) {
  if (typeof value !== 'string') {
    fail('INVALID_FIELD', `${fieldLabel}格式不正确。`);
  }
  const normalized = value.trim();
  if (!normalized) {
    fail('INVALID_FIELD', `请填写${fieldLabel}。`);
  }
  if (maxLength && normalized.length > maxLength) {
    fail('INVALID_FIELD', `${fieldLabel}不能超过${maxLength}个字符。`);
  }
  return normalized;
}

function optionalString(value, fieldLabel, maxLength) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  return requiredString(value, fieldLabel, maxLength);
}

function safeId(value, fieldLabel) {
  const normalized = requiredString(value, fieldLabel, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    fail('INVALID_FIELD', `${fieldLabel}格式不正确。`);
  }
  return normalized;
}

function numberInRange(value, fieldLabel, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    fail('INVALID_FIELD', `${fieldLabel}应在${min}至${max}之间。`);
  }
  return number;
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return date.toISOString().slice(0, 10) === value && date <= new Date();
}

function validateProfilePayload(payload) {
  const input = asObject(payload);
  const birthDate = requiredString(input.birthDate, '出生日期', 10);
  const gender = requiredString(input.gender, '性别', 20);

  if (!isValidIsoDate(birthDate)) {
    fail('INVALID_FIELD', '出生日期格式不正确。');
  }
  if (!GENDERS.includes(gender)) {
    fail('INVALID_FIELD', '性别选项不正确。');
  }

  return {
    name: requiredString(input.name, '姓名', LIMITS.nameMaxLength),
    gender,
    birthDate,
    heightCm: numberInRange(
      input.heightCm,
      '身高',
      LIMITS.heightCmMin,
      LIMITS.heightCmMax
    ),
    weightKg: numberInRange(
      input.weightKg,
      '体重',
      LIMITS.weightKgMin,
      LIMITS.weightKgMax
    ),
    primaryTrainingProject: requiredString(
      input.primaryTrainingProject,
      '主要训练项目',
      LIMITS.projectMaxLength
    ),
    requestedTrainingGroupId: input.requestedTrainingGroupId
      ? safeId(input.requestedTrainingGroupId, '训练组')
      : ''
  };
}

function validateReviewPayload(payload) {
  const input = asObject(payload);
  const decision = requiredString(input.decision, '审核结果', 20);
  if (!REVIEW_DECISIONS.includes(decision)) {
    fail('INVALID_FIELD', '审核结果不正确。');
  }

  return {
    targetUserId: safeId(input.targetUserId, '学生账号'),
    decision,
    comment: optionalString(input.comment, '审核意见', LIMITS.commentMaxLength)
  };
}

function validateRolePayload(payload) {
  const input = asObject(payload);
  const role = requiredString(input.role, '角色', 20);
  if (!ROLE_VALUES.includes(role)) {
    fail('INVALID_FIELD', '角色不正确。');
  }
  if (typeof input.grant !== 'boolean') {
    fail('INVALID_FIELD', '角色授权动作不正确。');
  }

  return {
    targetUserId: safeId(input.targetUserId, '用户账号'),
    role,
    grant: input.grant
  };
}

function validateUserStatusPayload(payload) {
  const input = asObject(payload);
  const status = requiredString(input.status, '账号状态', 20);
  if (!['active', 'disabled'].includes(status)) {
    fail('INVALID_FIELD', '账号状态不正确。');
  }
  return {
    targetUserId: safeId(input.targetUserId, '用户账号'),
    status
  };
}

function optionalIntegerInRange(value, fieldLabel, min, max) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    fail('INVALID_FIELD', `${fieldLabel}应在${min}至${max}之间。`);
  }
  return number;
}

function optionalNumberInRange(value, fieldLabel, min, max) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return numberInRange(value, fieldLabel, min, max);
}

function normalizePerformanceEventCode(value, fieldLabel) {
  const eventCode = requiredString(value, fieldLabel, 40);
  const event = getPerformanceEvent(eventCode);
  if (!event) {
    fail('INVALID_PERFORMANCE_EVENT', `${fieldLabel}不在支持的项目列表中。`);
  }
  return event;
}

function validateStudentProfileUpdatePayload(payload) {
  const input = asObject(payload);
  const primaryEventCode = optionalString(input.primaryEventCode, '主项', 40);
  const primaryEvent = primaryEventCode
    ? normalizePerformanceEventCode(primaryEventCode, '主项')
    : null;

  const secondaryInput = input.secondaryEventCodes === undefined
    ? []
    : input.secondaryEventCodes;
  if (!Array.isArray(secondaryInput)) {
    fail('INVALID_FIELD', '副项格式不正确。');
  }
  const secondaryEvents = secondaryInput.map((eventCode) =>
    normalizePerformanceEventCode(eventCode, '副项')
  );
  const secondaryEventCodes = Array.from(
    new Set(secondaryEvents.map((event) => event.code))
  );
  if (secondaryEventCodes.length > MAX_SECONDARY_EVENTS) {
    fail('INVALID_FIELD', `副项不能超过${MAX_SECONDARY_EVENTS}项。`);
  }
  if (primaryEvent && secondaryEventCodes.includes(primaryEvent.code)) {
    fail('INVALID_FIELD', '副项不能与主项重复。');
  }

  const goalInput = input.examGoal && typeof input.examGoal === 'object'
    ? input.examGoal
    : {};
  const targetEventCode = optionalString(goalInput.targetEventCode, '体考目标项目', 40);
  const targetEvent = targetEventCode
    ? normalizePerformanceEventCode(targetEventCode, '体考目标项目')
    : null;
  const targetValue = targetEvent
    ? optionalNumberInRange(
        goalInput.targetValue,
        '体考目标值',
        targetEvent.min,
        targetEvent.max
      )
    : null;
  if (goalInput.targetValue !== undefined && goalInput.targetValue !== '' && !targetEvent) {
    fail('INVALID_FIELD', '填写体考目标值前请选择体考目标项目。');
  }
  return {
    primaryEventCode: primaryEvent ? primaryEvent.code : '',
    primaryEventName: primaryEvent ? primaryEvent.name : '',
    secondaryEventCodes,
    trainingStartYear: optionalIntegerInRange(
      input.trainingStartYear,
      '开始训练年份',
      1950,
      2100
    ),
    trainingExperienceSummary: optionalString(
      input.trainingExperienceSummary,
      '训练经历',
      500
    ),
    examGoal: {
      targetEventCode: targetEvent ? targetEvent.code : '',
      targetEventName: targetEvent ? targetEvent.name : '',
      targetValue,
      targetUnit: targetEvent ? targetEvent.unit : '',
      targetComparison: targetEvent ? targetEvent.comparison : '',
      targetScore: optionalString(goalInput.targetScore, '体考目标成绩', 80),
      examYear: optionalIntegerInRange(goalInput.examYear, '体考年份', 2026, 2100),
      targetSchool: optionalString(goalInput.targetSchool, '目标院校', 100),
      note: optionalString(goalInput.note, '体考目标说明', 300)
    }
  };
}

function validateMeasurementPayload(payload) {
  const input = asObject(payload);
  const measuredAt = requiredString(input.measuredAt, '测量日期', 10);
  if (!isValidIsoDate(measuredAt)) {
    fail('INVALID_FIELD', '测量日期格式不正确。');
  }
  return {
    heightCm: numberInRange(
      input.heightCm,
      '身高',
      LIMITS.heightCmMin,
      LIMITS.heightCmMax
    ),
    weightKg: numberInRange(
      input.weightKg,
      '体重',
      LIMITS.weightKgMin,
      LIMITS.weightKgMax
    ),
    measuredAt
  };
}

function validatePerformanceSubmissionPayload(payload) {
  const input = asObject(payload);
  const event = normalizePerformanceEventCode(input.eventCode, '体育项目');
  const achievedAt = requiredString(input.achievedAt, '成绩取得日期', 10);
  if (!isValidIsoDate(achievedAt)) {
    fail('INVALID_FIELD', '成绩取得日期格式不正确。');
  }
  return {
    eventCode: event.code,
    eventName: event.name,
    unit: event.unit,
    comparison: event.comparison,
    value: numberInRange(input.value, '成绩', event.min, event.max),
    achievedAt,
    note: optionalString(input.note, '成绩说明', 200)
  };
}

function validatePerformanceReviewPayload(payload) {
  const input = asObject(payload);
  const decision = requiredString(input.decision, '审核结果', 20);
  if (!PERFORMANCE_REVIEW_DECISIONS.includes(decision)) {
    fail('INVALID_FIELD', '审核结果不正确。');
  }
  return {
    performanceId: safeId(input.performanceId, '成绩记录'),
    decision,
    comment: optionalString(input.comment, '审核意见', LIMITS.commentMaxLength)
  };
}

function requiredDateOnly(value, fieldLabel) {
  const date = requiredString(value, fieldLabel, 10);
  if (!isDateOnly(date)) {
    fail('INVALID_FIELD', `${fieldLabel}格式不正确。`);
  }
  return date;
}

function optionalDateOnly(value, fieldLabel) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  return requiredDateOnly(value, fieldLabel);
}

function normalizePlanItem(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    fail('INVALID_FIELD', `第${index + 1}项训练内容格式不正确。`);
  }
  const category = requiredString(
    item.category,
    `第${index + 1}项训练分类`,
    30
  );
  if (!PLAN_CATEGORIES.includes(category)) {
    fail('INVALID_FIELD', `第${index + 1}项训练分类不在支持列表中。`);
  }
  const eventInput = optionalString(
    item.eventCode,
    `第${index + 1}项关联项目`,
    40
  );
  const event = eventInput
    ? normalizePerformanceEventCode(eventInput, `第${index + 1}项关联项目`)
    : null;
  const order = optionalIntegerInRange(
    item.order,
    `第${index + 1}项顺序`,
    0,
    99
  );
  return {
    order: order === null ? index + 1 : order,
    category,
    name: requiredString(
      item.name,
      `第${index + 1}项训练名称`,
      LIMITS.planItemNameMaxLength
    ),
    eventCode: event ? event.code : '',
    eventName: event ? event.name : '',
    target: optionalString(item.target, `第${index + 1}项训练目标`, 80),
    sets: optionalIntegerInRange(item.sets, `第${index + 1}项组数`, 1, 50),
    reps: optionalIntegerInRange(item.reps, `第${index + 1}项次数`, 1, 200),
    distanceMeters: optionalNumberInRange(
      item.distanceMeters,
      `第${index + 1}项距离`,
      0.5,
      50000
    ),
    durationSeconds: optionalIntegerInRange(
      item.durationSeconds,
      `第${index + 1}项持续时间`,
      1,
      36000
    ),
    restSeconds: optionalIntegerInRange(
      item.restSeconds,
      `第${index + 1}项组间休息`,
      0,
      3600
    ),
    load: optionalString(item.load, `第${index + 1}项负荷`, 40),
    notes: optionalString(item.notes, `第${index + 1}项注意事项`, 200)
  };
}

function validatePlanItems(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail('INVALID_FIELD', '至少需要一项训练内容。');
  }
  if (value.length > MAX_PLAN_ITEMS) {
    fail('INVALID_FIELD', `训练内容不能超过${MAX_PLAN_ITEMS}项。`);
  }
  const normalized = value.map(normalizePlanItem);
  const orders = new Set();
  for (const item of normalized) {
    if (orders.has(item.order)) {
      fail('INVALID_FIELD', '训练顺序不能重复。');
    }
    orders.add(item.order);
  }
  return normalized.sort((left, right) => left.order - right.order);
}

function normalizePlanDates(input) {
  const startDate = requiredDateOnly(input.startDate, '计划开始日期');
  const endDate =
    input.endDate === undefined || input.endDate === null || input.endDate === ''
      ? startDate
      : requiredDateOnly(input.endDate, '计划结束日期');
  if (endDate < startDate) {
    fail('INVALID_FIELD', '计划结束日期不能早于开始日期。');
  }
  return { startDate, endDate };
}

function validatePlanCreatePayload(payload) {
  const input = asObject(payload);
  const dates = normalizePlanDates(input);
  return {
    clientRequestId: safeId(input.clientRequestId, '请求标识'),
    trainingGroupId: safeId(input.trainingGroupId, '训练组'),
    title: requiredString(input.title, '计划名称', LIMITS.planTitleMaxLength),
    ...dates,
    notes: optionalString(input.notes, '训练注意事项', LIMITS.planNotesMaxLength),
    items: validatePlanItems(input.items)
  };
}

function validatePlanUpdatePayload(payload) {
  const input = asObject(payload);
  const expectedVersion = optionalIntegerInRange(
    input.expectedVersion,
    '计划版本',
    1,
    100000
  );
  if (expectedVersion === null) {
    fail('INVALID_FIELD', '缺少计划版本，无法安全更新。');
  }
  const dates = normalizePlanDates(input);
  return {
    planId: safeId(input.planId, '训练计划'),
    expectedVersion,
    title: requiredString(input.title, '计划名称', LIMITS.planTitleMaxLength),
    ...dates,
    notes: optionalString(input.notes, '训练注意事项', LIMITS.planNotesMaxLength),
    items: validatePlanItems(input.items)
  };
}

function validatePlanActionPayload(payload) {
  const input = asObject(payload);
  const expectedVersion = optionalIntegerInRange(
    input.expectedVersion,
    '计划版本',
    1,
    100000
  );
  if (expectedVersion === null) {
    fail('INVALID_FIELD', '缺少计划版本，无法安全操作。');
  }
  return { planId: safeId(input.planId, '训练计划'), expectedVersion };
}

function validatePlanCopyPayload(payload) {
  const input = asObject(payload);
  const startDate = optionalDateOnly(input.startDate, '计划开始日期');
  const endDate = optionalDateOnly(input.endDate, '计划结束日期');
  if (startDate && endDate && endDate < startDate) {
    fail('INVALID_FIELD', '计划结束日期不能早于开始日期。');
  }
  return {
    sourcePlanId: safeId(input.sourcePlanId, '源训练计划'),
    clientRequestId: safeId(input.clientRequestId, '请求标识'),
    title: optionalString(input.title, '计划名称', LIMITS.planTitleMaxLength),
    startDate,
    endDate
  };
}

function validatePlanManageQueryPayload(payload) {
  const input = asObject(payload);
  const status = optionalString(input.status, '计划状态', 20);
  if (status && !PLAN_STATUSES.includes(status)) {
    fail('INVALID_FIELD', '计划状态不正确。');
  }
  return {
    status,
    trainingGroupId: input.trainingGroupId
      ? safeId(input.trainingGroupId, '训练组')
      : '',
    fromDate: optionalDateOnly(input.fromDate, '开始日期'),
    toDate: optionalDateOnly(input.toDate, '结束日期')
  };
}

function validateStudentPlanQueryPayload(payload) {
  const input = asObject(payload);
  const scope = optionalString(input.scope, '查询范围', 20) || 'today';
  if (!PLAN_SCOPES.includes(scope)) {
    fail('INVALID_FIELD', '训练计划查询范围不正确。');
  }
  return { scope, date: optionalDateOnly(input.date, '查询日期') };
}

function requiredTimeValue(value, fieldLabel) {
  const normalized = requiredString(value, fieldLabel, 5);
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized)) {
    fail('INVALID_FIELD', `${fieldLabel}格式不正确，应为HH:mm。`);
  }
  return normalized;
}

function optionalPlanId(value) {
  const planId = optionalString(value, '训练计划', 64);
  return planId ? safeId(planId, '训练计划') : '';
}

function normalizeSessionTimes(input) {
  const checkInOpenTime = requiredTimeValue(input.checkInOpenTime, '签到开始时间');
  const checkInCloseTime = requiredTimeValue(input.checkInCloseTime, '签到结束时间');
  const lateAfterTime = input.lateAfterTime
    ? requiredTimeValue(input.lateAfterTime, '迟到判定时间')
    : checkInOpenTime;
  if (checkInOpenTime >= checkInCloseTime) {
    fail('INVALID_FIELD', '签到结束时间必须晚于开始时间。');
  }
  if (lateAfterTime < checkInOpenTime || lateAfterTime > checkInCloseTime) {
    fail('INVALID_FIELD', '迟到判定时间必须在签到时间窗口内。');
  }
  return { checkInOpenTime, checkInCloseTime, lateAfterTime };
}

function validateAttendanceSessionCreatePayload(payload) {
  const input = asObject(payload);
  const attendanceDate = requiredDateOnly(input.attendanceDate, '考勤日期');
  return {
    clientRequestId: safeId(input.clientRequestId, '请求标识'),
    trainingGroupId: safeId(input.trainingGroupId, '训练组'),
    planId: optionalPlanId(input.planId),
    title: optionalString(input.title, '场次名称', LIMITS.sessionTitleMaxLength),
    attendanceDate,
    locationName: requiredString(input.locationName, '训练地点', LIMITS.locationNameMaxLength),
    latitude: numberInRange(input.latitude, '纬度', -90, 90),
    longitude: numberInRange(input.longitude, '经度', -180, 180),
    radiusMeters: numberInRange(input.radiusMeters, '签到范围', 20, 5000),
    accuracyThresholdMeters: numberInRange(
      input.accuracyThresholdMeters,
      '定位精度阈值',
      10,
      1000
    ),
    ...normalizeSessionTimes(input)
  };
}

function validateAttendanceSessionUpdatePayload(payload) {
  const input = asObject(payload);
  const expectedVersion = optionalIntegerInRange(
    input.expectedVersion,
    '考勤版本',
    1,
    100000
  );
  if (expectedVersion === null) {
    fail('INVALID_FIELD', '缺少考勤版本，无法安全更新。');
  }
  const attendanceDate = requiredDateOnly(input.attendanceDate, '考勤日期');
  return {
    sessionId: safeId(input.sessionId, '考勤场次'),
    expectedVersion,
    title: optionalString(input.title, '场次名称', LIMITS.sessionTitleMaxLength),
    attendanceDate,
    locationName: requiredString(input.locationName, '训练地点', LIMITS.locationNameMaxLength),
    latitude: numberInRange(input.latitude, '纬度', -90, 90),
    longitude: numberInRange(input.longitude, '经度', -180, 180),
    radiusMeters: numberInRange(input.radiusMeters, '签到范围', 20, 5000),
    accuracyThresholdMeters: numberInRange(
      input.accuracyThresholdMeters,
      '定位精度阈值',
      10,
      1000
    ),
    ...normalizeSessionTimes(input)
  };
}

function validateAttendanceSessionActionPayload(payload) {
  const input = asObject(payload);
  const expectedVersion = optionalIntegerInRange(
    input.expectedVersion,
    '考勤版本',
    1,
    100000
  );
  if (expectedVersion === null) {
    fail('INVALID_FIELD', '缺少考勤版本，无法安全操作。');
  }
  return {
    sessionId: safeId(input.sessionId, '考勤场次'),
    expectedVersion
  };
}

function validateAttendanceQueryPayload(payload) {
  const input = asObject(payload);
  return {
    trainingGroupId: input.trainingGroupId
      ? safeId(input.trainingGroupId, '训练组')
      : '',
    date: optionalDateOnly(input.date, '查询日期'),
    fromDate: optionalDateOnly(input.fromDate, '开始日期'),
    toDate: optionalDateOnly(input.toDate, '结束日期')
  };
}

function validateAttendanceCheckInPayload(payload) {
  const input = asObject(payload);
  const accuracy = optionalNumberInRange(input.accuracy, '定位精度', 0, 10000);
  return {
    sessionId: safeId(input.sessionId, '考勤场次'),
    latitude: numberInRange(input.latitude, '纬度', -90, 90),
    longitude: numberInRange(input.longitude, '经度', -180, 180),
    accuracy: accuracy === null ? null : accuracy
  };
}

function validateAttendanceManualPayload(payload) {
  const input = asObject(payload);
  const status = requiredString(input.status, '考勤状态', 30);
  if (
    ![
      ATTENDANCE_RECORD_STATUS.CHECKED_IN,
      ATTENDANCE_RECORD_STATUS.LATE,
      ATTENDANCE_RECORD_STATUS.ABSENT
    ].includes(status)
  ) {
    fail('INVALID_FIELD', '人工核实状态不正确。');
  }
  return {
    sessionId: safeId(input.sessionId, '考勤场次'),
    studentUserId: safeId(input.studentUserId, '学生账号'),
    status,
    reason: requiredString(input.reason, '核实原因', LIMITS.leaveReasonMaxLength)
  };
}

function validateLeaveCreatePayload(payload) {
  const input = asObject(payload);
  return {
    clientRequestId: safeId(input.clientRequestId, '请求标识'),
    sessionId: safeId(input.sessionId, '考勤场次'),
    reason: requiredString(input.reason, '请假原因', LIMITS.leaveReasonMaxLength)
  };
}

function validateLeaveCancelPayload(payload) {
  const input = asObject(payload);
  return { leaveId: safeId(input.leaveId, '请假申请') };
}

function validateLeaveReviewPayload(payload) {
  const input = asObject(payload);
  const decision = requiredString(input.decision, '审批结果', 20);
  if (!['approve', 'reject'].includes(decision)) {
    fail('INVALID_FIELD', '审批结果不正确。');
  }
  const comment = optionalString(input.comment, '审批意见', LIMITS.commentMaxLength);
  if (decision === 'reject' && !comment) {
    fail('INVALID_FIELD', '驳回请假时必须填写审批意见。');
  }
  return { leaveId: safeId(input.leaveId, '请假申请'), decision, comment };
}

function validateGroupName(value) {
  return requiredString(value, '训练组名称', LIMITS.nameMaxLength);
}

function validateGroupSeasonLabel(value) {
  return requiredString(value, '训练组年份或周期', 20);
}

function validateTrainingGroupStatusPayload(payload) {
  const input = asObject(payload);
  if (typeof input.enabled !== 'boolean') {
    fail('INVALID_FIELD', '训练组状态不正确。');
  }
  return {
    trainingGroupId: safeId(input.trainingGroupId, '训练组'),
    enabled: input.enabled
  };
}

function validateGroupCoachPayload(payload) {
  const input = asObject(payload);
  return {
    coachUserId: safeId(input.coachUserId, '教练员账号'),
    trainingGroupId: safeId(input.trainingGroupId, '训练组'),
    active: input.active !== false
  };
}

module.exports = {
  ATTENDANCE_RECORD_STATUS,
  ATTENDANCE_SESSION_STATUS,
  LEAVE_STATUS,
  MAX_PLAN_ITEMS,
  PLAN_CATEGORIES,
  PLAN_SCOPES,
  PLAN_STATUSES,
  GENDERS,
  validateAttendanceCheckInPayload,
  validateAttendanceManualPayload,
  validateAttendanceQueryPayload,
  validateAttendanceSessionActionPayload,
  validateAttendanceSessionCreatePayload,
  validateAttendanceSessionUpdatePayload,
  validateLeaveCancelPayload,
  validateLeaveCreatePayload,
  validateLeaveReviewPayload,
  asObject,
  safeId,
  validatePlanActionPayload,
  validatePlanCopyPayload,
  validatePlanCreatePayload,
  validatePlanItems,
  validatePlanManageQueryPayload,
  validatePlanUpdatePayload,
  validateStudentPlanQueryPayload,
  validateGroupCoachPayload,
  validateGroupName,
  validateTrainingGroupStatusPayload,
  validateGroupSeasonLabel,
  validateProfilePayload,
  validateMeasurementPayload,
  validatePerformanceReviewPayload,
  validatePerformanceSubmissionPayload,
  validateStudentProfileUpdatePayload,
  validateUserStatusPayload,
  validateReviewPayload,
  validateRolePayload
};
