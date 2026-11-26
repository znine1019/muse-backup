'use strict';

const {
  ATTENDANCE_RECORD_STATUS,
  ATTENDANCE_SESSION_STATUS,
  COMPETITION_MATERIAL_POLICY,
  COMPETITION_REGISTRATION_STATUS,
  COMPETITION_STATUS,
  FEEDBACK_COMPLETION,
  LEAVE_STATUS,
  LIMITS,
  NOTICE_CATEGORIES,
  NOTICE_PRIORITIES,
  NOTICE_STATUS,
  PARENT_RELATION_LABELS,
  ROLE_VALUES
} = require('./constants');
const { isDateOnly, isDateTimeString } = require('./dates');
const { PERIOD_TYPES } = require('./dates');
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
const COMPETITION_STATUSES = Object.freeze(Object.values(COMPETITION_STATUS));
const REGISTRATION_STATUSES = Object.freeze(
  Object.values(COMPETITION_REGISTRATION_STATUS)
);
const NOTICE_STATUS_VALUES = Object.freeze(Object.values(NOTICE_STATUS));
const NOTICE_CATEGORY_VALUES = NOTICE_CATEGORIES;
const NOTICE_PRIORITY_VALUES = NOTICE_PRIORITIES;
const FEEDBACK_COMPLETION_VALUES = Object.freeze(
  Object.values(FEEDBACK_COMPLETION)
);

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

  /* 注册资料类型：学生（默认，保持既有兼容）或家长 */
  const profileType = optionalString(input.profileType, '资料类型', 20) || 'student';
  if (!['student', 'parent', 'coach'].includes(profileType)) {
    fail('INVALID_FIELD', '资料类型不正确。');
  }

  return {
    targetUserId: safeId(input.targetUserId, '待审核账号'),
    decision,
    profileType,
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

function validateUserDeletionPayload(payload) {
  const input = asObject(payload);
  if (input.confirmationText !== 'DELETE_ACCOUNT') {
    fail('DELETE_CONFIRMATION_REQUIRED', '请输入完整删除确认。');
  }
  return {
    targetUserId: safeId(input.targetUserId, '用户账号'),
    confirmationText: input.confirmationText,
    acknowledgeAssociations: input.acknowledgeAssociations === true
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

function optionalIdArray(value, fieldLabel, maxItems = 100) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail('INVALID_FIELD', `${fieldLabel}格式不正确。`);
  }
  if (value.length > maxItems) {
    fail('INVALID_FIELD', `${fieldLabel}不能超过${maxItems}项。`);
  }
  return Array.from(new Set(value.map((item) => safeId(item, fieldLabel))));
}

function requiredDateTime(value, fieldLabel) {
  const normalized = requiredString(value, fieldLabel, 16);
  if (!isDateTimeString(normalized)) {
    fail('INVALID_FIELD', `${fieldLabel}格式不正确，应为YYYY-MM-DD HH:mm。`);
  }
  return normalized;
}

function optionalDateTime(value, fieldLabel) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  return requiredDateTime(value, fieldLabel);
}

function normalizeCompetitionEvents(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail('INVALID_FIELD', '至少需要一个参赛项目。');
  }
  if (value.length > LIMITS.maxCompetitionEvents) {
    fail('INVALID_FIELD', `参赛项目不能超过${LIMITS.maxCompetitionEvents}项。`);
  }
  const codes = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail('INVALID_FIELD', `第${index + 1}个参赛项目格式不正确。`);
    }
    const event = normalizePerformanceEventCode(
      item.eventCode,
      `第${index + 1}个参赛项目`
    );
    if (codes.has(event.code)) {
      fail('INVALID_FIELD', '参赛项目不能重复。');
    }
    codes.add(event.code);
    const categories = Array.isArray(item.categories) ? item.categories : [];
    if (!categories.length) {
      fail('INVALID_FIELD', `第${index + 1}个参赛项目至少需要一个组别。`);
    }
    if (categories.length > LIMITS.maxEventCategories) {
      fail('INVALID_FIELD', `第${index + 1}个参赛项目组别不能超过${LIMITS.maxEventCategories}项。`);
    }
    return {
      eventCode: event.code,
      eventName: event.name,
      unit: event.unit,
      comparison: event.comparison,
      categories: Array.from(
        new Set(categories.map((category) => requiredString(category, '参赛组别', 30)))
      )
    };
  });
}

function normalizeCapacity(input) {
  const capacityEnabled = input.capacityEnabled === true;
  if (!capacityEnabled) {
    return { capacityEnabled: false, capacity: null };
  }
  const capacity = optionalIntegerInRange(input.capacity, '意向人数上限', 1, 100);
  if (capacity === null) {
    fail('INVALID_FIELD', '启用人数上限时必须填写1至100之间的上限。');
  }
  return { capacityEnabled: true, capacity };
}

function normalizeCompetitionPayload(input, isUpdate) {
  const registrationStartAt = requiredDateTime(
    input.registrationStartAt,
    '报名开始时间'
  );
  const registrationEndAt = requiredDateTime(
    input.registrationEndAt,
    '报名截止时间'
  );
  if (registrationEndAt <= registrationStartAt) {
    fail('INVALID_FIELD', '报名截止时间必须晚于开始时间。');
  }
  const payload = {
    title: requiredString(input.title, '赛事名称', LIMITS.competitionTitleMaxLength),
    description: optionalString(
      input.description,
      '赛事介绍',
      LIMITS.competitionDescriptionMaxLength
    ),
    location: requiredString(input.location, '举办地点', 100),
    eventDate: requiredDateOnly(input.eventDate, '举办日期'),
    registrationStartAt,
    registrationEndAt,
    requirements: optionalString(
      input.requirements,
      '报名要求',
      LIMITS.competitionRequirementsMaxLength
    ),
    events: normalizeCompetitionEvents(input.events),
    trainingGroupIds: optionalIdArray(input.trainingGroupIds, '参赛训练组'),
    notes: optionalString(input.notes, '赛事备注', 500),
    ...normalizeCapacity(input)
  };
  if (isUpdate) {
    const expectedVersion = optionalIntegerInRange(
      input.expectedVersion,
      '赛事版本',
      1,
      100000
    );
    if (expectedVersion === null) {
      fail('INVALID_FIELD', '缺少赛事版本，无法安全更新。');
    }
    return { competitionId: safeId(input.competitionId, '赛事'), expectedVersion, ...payload };
  }
  return { clientRequestId: safeId(input.clientRequestId, '请求标识'), ...payload };
}

function validateCompetitionCreatePayload(payload) {
  return normalizeCompetitionPayload(asObject(payload), false);
}

function validateCompetitionUpdatePayload(payload) {
  return normalizeCompetitionPayload(asObject(payload), true);
}

function validateCompetitionActionPayload(payload) {
  const input = asObject(payload);
  const expectedVersion = optionalIntegerInRange(
    input.expectedVersion,
    '赛事版本',
    1,
    100000
  );
  if (expectedVersion === null) {
    fail('INVALID_FIELD', '缺少赛事版本，无法安全操作。');
  }
  return {
    competitionId: safeId(input.competitionId, '赛事'),
    expectedVersion
  };
}

function validateCompetitionQueryPayload(payload) {
  const input = asObject(payload);
  const status = optionalString(input.status, '赛事状态', 20);
  if (status && !COMPETITION_STATUSES.includes(status)) {
    fail('INVALID_FIELD', '赛事状态不正确。');
  }
  return { status };
}

function normalizeIntentItems(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail('INVALID_FIELD', '至少选择一个参赛项目和组别。');
  }
  if (value.length > LIMITS.maxCompetitionEvents * LIMITS.maxEventCategories) {
    fail('INVALID_FIELD', '参赛项目选择过多。');
  }
  const keys = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail('INVALID_FIELD', `第${index + 1}条参赛选择格式不正确。`);
    }
    const event = normalizePerformanceEventCode(
      item.eventCode,
      `第${index + 1}条参赛项目`
    );
    const category = requiredString(item.category, '参赛组别', 30);
    const key = `${event.code}|${category}`;
    if (keys.has(key)) {
      fail('INVALID_FIELD', '同一项目和组别不能重复登记。');
    }
    keys.add(key);
    return {
      eventCode: event.code,
      eventName: event.name,
      unit: event.unit,
      category
    };
  });
}

function validateIntentSubmitPayload(payload) {
  const input = asObject(payload);
  return {
    clientRequestId: safeId(input.clientRequestId, '请求标识'),
    competitionId: safeId(input.competitionId, '赛事'),
    items: normalizeIntentItems(input.items),
    contactNote: optionalString(input.contactNote, '报名补充说明', 500)
  };
}

function validateIntentCancelPayload(payload) {
  const input = asObject(payload);
  const eventCodes = input.eventCodes === undefined ? [] : input.eventCodes;
  if (!Array.isArray(eventCodes)) {
    fail('INVALID_FIELD', '取消项目格式不正确。');
  }
  return {
    registrationId: safeId(input.registrationId, '报名记录'),
    eventCodes: eventCodes.map((code) =>
      normalizePerformanceEventCode(code, '取消项目').code
    )
  };
}

function validateRegistrationQueryPayload(payload) {
  const input = asObject(payload);
  const status = optionalString(input.status, '办理状态', 20);
  if (status && !REGISTRATION_STATUSES.includes(status)) {
    fail('INVALID_FIELD', '报名办理状态不正确。');
  }
  return {
    competitionId: input.competitionId
      ? safeId(input.competitionId, '赛事')
      : '',
    eventCode: optionalString(input.eventCode, '参赛项目', 40),
    category: optionalString(input.category, '参赛组别', 30),
    trainingGroupId: input.trainingGroupId
      ? safeId(input.trainingGroupId, '训练组')
      : '',
    status
  };
}

function validateRegistrationStatusPayload(payload) {
  const input = asObject(payload);
  const status = requiredString(input.status, '办理状态', 20);
  if (!REGISTRATION_STATUSES.includes(status)) {
    fail('INVALID_FIELD', '报名办理状态不正确。');
  }
  const expectedVersion = optionalIntegerInRange(
    input.expectedVersion,
    '报名版本',
    1,
    100000
  );
  if (expectedVersion === null) {
    fail('INVALID_FIELD', '缺少报名版本，无法安全更新。');
  }
  return {
    registrationId: safeId(input.registrationId, '报名记录'),
    status,
    comment: optionalString(input.comment, '处理说明', LIMITS.commentMaxLength),
    expectedVersion
  };
}

function validateNoticePayload(payload, isUpdate) {
  const input = asObject(payload);
  const category = requiredString(input.category, '通知类别', 30);
  if (!NOTICE_CATEGORY_VALUES.includes(category)) {
    fail('INVALID_FIELD', '通知类别不正确。');
  }
  const priority = optionalString(input.priority, '重要程度', 20) || 'normal';
  if (!NOTICE_PRIORITY_VALUES.includes(priority)) {
    fail('INVALID_FIELD', '重要程度不正确。');
  }
  const base = {
    title: requiredString(input.title, '通知标题', LIMITS.noticeTitleMaxLength),
    content: requiredString(input.content, '通知正文', LIMITS.noticeContentMaxLength),
    category,
    priority,
    trainingGroupIds: optionalIdArray(input.trainingGroupIds, '可见训练组')
  };
  if (isUpdate) {
    const expectedVersion = optionalIntegerInRange(
      input.expectedVersion,
      '通知版本',
      1,
      100000
    );
    if (expectedVersion === null) {
      fail('INVALID_FIELD', '缺少通知版本，无法安全更新。');
    }
    return { noticeId: safeId(input.noticeId, '通知'), expectedVersion, ...base };
  }
  return { clientRequestId: safeId(input.clientRequestId, '请求标识'), ...base };
}

function validateNoticeCreatePayload(payload) {
  return validateNoticePayload(payload, false);
}

function validateNoticeUpdatePayload(payload) {
  return validateNoticePayload(payload, true);
}

function validateNoticeActionPayload(payload) {
  const input = asObject(payload);
  const expectedVersion = optionalIntegerInRange(
    input.expectedVersion,
    '通知版本',
    1,
    100000
  );
  if (expectedVersion === null) {
    fail('INVALID_FIELD', '缺少通知版本，无法安全操作。');
  }
  return { noticeId: safeId(input.noticeId, '通知'), expectedVersion };
}

function validateNoticeQueryPayload(payload) {
  const input = asObject(payload);
  const status = optionalString(input.status, '通知状态', 20);
  if (status && !NOTICE_STATUS_VALUES.includes(status)) {
    fail('INVALID_FIELD', '通知状态不正确。');
  }
  const category = optionalString(input.category, '通知类别', 30);
  if (category && !NOTICE_CATEGORY_VALUES.includes(category)) {
    fail('INVALID_FIELD', '通知类别不正确。');
  }
  return { status, category, unreadOnly: input.unreadOnly === true };
}

function validateNoticeReadPayload(payload) {
  return { noticeId: safeId(asObject(payload).noticeId, '通知') };
}

function validateFeedbackSubmitPayload(payload) {
  const input = asObject(payload);
  const completionStatus = requiredString(input.completionStatus, '完成情况', 30);
  if (!FEEDBACK_COMPLETION_VALUES.includes(completionStatus)) {
    fail('INVALID_FIELD', '完成情况不正确。');
  }
  const rpe = numberInRange(input.rpe, '主观用力程度RPE', 1, 10);
  if (!Number.isInteger(rpe)) {
    fail('INVALID_FIELD', 'RPE必须是1至10的整数。');
  }
  return {
    clientRequestId: safeId(input.clientRequestId, '请求标识'),
    sessionId: safeId(input.sessionId, '训练场次'),
    completionStatus,
    rpe,
    comment: optionalString(input.comment, '训练反馈', LIMITS.feedbackCommentMaxLength)
  };
}

function validateFeedbackUpdatePayload(payload) {
  const input = asObject(payload);
  const expectedVersion = optionalIntegerInRange(
    input.expectedVersion,
    '反馈版本',
    1,
    100000
  );
  if (expectedVersion === null) {
    fail('INVALID_FIELD', '缺少反馈版本，无法安全更新。');
  }
  const completionStatus = requiredString(input.completionStatus, '完成情况', 30);
  if (!FEEDBACK_COMPLETION_VALUES.includes(completionStatus)) {
    fail('INVALID_FIELD', '完成情况不正确。');
  }
  const rpe = numberInRange(input.rpe, '主观用力程度RPE', 1, 10);
  if (!Number.isInteger(rpe)) {
    fail('INVALID_FIELD', 'RPE必须是1至10的整数。');
  }
  return {
    feedbackId: safeId(input.feedbackId, '训练反馈'),
    expectedVersion,
    completionStatus,
    rpe,
    comment: optionalString(input.comment, '训练反馈', LIMITS.feedbackCommentMaxLength)
  };
}

function validateFeedbackReviewPayload(payload) {
  const input = asObject(payload);
  const expectedCoachCommentVersion = optionalIntegerInRange(
    input.expectedCoachCommentVersion,
    '评价版本',
    0,
    100000
  );
  if (expectedCoachCommentVersion === null) {
    fail('INVALID_FIELD', '缺少评价版本，无法安全更新。');
  }
  return {
    feedbackId: safeId(input.feedbackId, '训练反馈'),
    expectedCoachCommentVersion,
    comment: requiredString(input.comment, '教练评价', LIMITS.coachCommentMaxLength)
  };
}

function validateFeedbackQueryPayload(payload) {
  const input = asObject(payload);
  return {
    trainingGroupId: input.trainingGroupId
      ? safeId(input.trainingGroupId, '训练组')
      : '',
    studentUserId: input.studentUserId
      ? safeId(input.studentUserId, '学生账号')
      : '',
    planId: input.planId ? safeId(input.planId, '训练计划') : '',
    fromDate: optionalDateOnly(input.fromDate, '开始日期'),
    toDate: optionalDateOnly(input.toDate, '结束日期'),
    needsAttention: input.needsAttention === true
  };
}

function validateStatisticsPeriodPayload(payload) {
  const input = asObject(payload || {});
  const periodType = optionalString(input.periodType, '统计周期', 20) || 'month';
  if (!PERIOD_TYPES.includes(periodType)) {
    fail('INVALID_FIELD', '统计周期不正确。');
  }
  return {
    periodType,
    year: optionalIntegerInRange(input.year, '统计年份', 2000, 2100),
    month: optionalIntegerInRange(input.month, '统计月份', 1, 12),
    quarter: optionalIntegerInRange(input.quarter, '统计季度', 1, 4),
    trainingGroupId: input.trainingGroupId
      ? safeId(input.trainingGroupId, '训练组')
      : ''
  };
}

function validatePerformanceLeaderboardPayload(payload) {
  const input = asObject(payload || {});
  const period = validateStatisticsPeriodPayload(input);
  return {
    ...period,
    eventCode: normalizePerformanceEventCode(input.eventCode, '排行榜项目').code
  };
}

function validateAttendanceLeaderboardPayload(payload) {
  return validateStatisticsPeriodPayload(asObject(payload || {}));
}

function validateExportPayload(payload) {
  const input = asObject(payload || {});
  const period = validateStatisticsPeriodPayload(input);
  return {
    ...period,
    eventCode: input.eventCode
      ? normalizePerformanceEventCode(input.eventCode, '导出项目').code
      : '',
    maxRows: optionalIntegerInRange(input.maxRows, '导出上限', 1, 5000)
  };
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

function validateTrainingGroupDeletionPayload(payload) {
  const input = asObject(payload);
  if (input.confirmationText !== 'DELETE_TRAINING_GROUP') {
    fail('DELETE_CONFIRMATION_REQUIRED', '请输入完整删除确认。');
  }
  return {
    trainingGroupId: safeId(input.trainingGroupId, '训练组'),
    confirmationText: input.confirmationText
  };
}

/* ---------- 家长端（V1.6 功能补全第一批） ---------- */

/** 关联凭证归一化：统一转大写并去除空格与连字符，避免输入格式差异导致误判 */
function normalizeInviteCode(value) {
  return String(value === undefined || value === null ? '' : value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function validateCoachProfilePayload(payload) {
  const input = asObject(payload);
  return {
    name: requiredString(input.name, '教练姓名', LIMITS.coachNameMaxLength),
    identityNote: optionalString(input.identityNote, '身份说明', LIMITS.coachNoteMaxLength)
  };
}

function validateParentProfilePayload(payload) {
  const input = asObject(payload);
  const relation = optionalString(input.relation, '监护人关系', 20) || 'guardian';
  if (!PARENT_RELATION_LABELS.includes(relation)) {
    fail('INVALID_FIELD', '监护人关系选项不正确。');
  }
  return {
    name: requiredString(input.name, '家长姓名', LIMITS.parentNameMaxLength),
    relation,
    note: optionalString(input.note, '备注', LIMITS.parentNoteMaxLength)
  };
}

function validateParentInviteCreatePayload(payload) {
  const input = asObject(payload);
  return {
    clientRequestId: optionalString(input.clientRequestId, '请求标识', 80)
  };
}

function validateParentInviteRedeemPayload(payload) {
  const input = asObject(payload);
  const code = normalizeInviteCode(input.code);
  if (code.length !== LIMITS.parentInviteCodeLength) {
    fail('INVALID_INVITE_CODE', '关联凭证格式不正确，请核对后重新输入。');
  }
  return { code };
}

function validateParentLinkDecisionPayload(payload) {
  const input = asObject(payload);
  const decision = requiredString(input.decision, '处理动作', 20);
  if (!['confirm', 'reject'].includes(decision)) {
    fail('INVALID_FIELD', '处理动作不正确。');
  }
  return {
    linkId: safeId(input.linkId, '关联关系'),
    decision,
    comment: optionalString(input.comment, '说明', LIMITS.commentMaxLength)
  };
}

function validateParentLinkReviewPayload(payload) {
  const input = asObject(payload);
  const decision = requiredString(input.decision, '审核动作', 20);
  if (!['approve', 'reject'].includes(decision)) {
    fail('INVALID_FIELD', '审核动作不正确。');
  }
  return {
    linkId: safeId(input.linkId, '关联关系'),
    decision,
    comment: optionalString(input.comment, '审核意见', LIMITS.commentMaxLength)
  };
}

function validateParentLinkRevokePayload(payload) {
  const input = asObject(payload);
  return {
    linkId: safeId(input.linkId, '关联关系'),
    comment: optionalString(input.comment, '说明', LIMITS.commentMaxLength)
  };
}

function validateParentStudentQueryPayload(payload) {
  const input = asObject(payload);
  return {
    studentUserId: safeId(input.studentUserId, '学生账号')
  };
}

function sanitizeAttachmentFileName(rawName) {
  if (typeof rawName !== 'string') {
    fail('INVALID_FILE_NAME', '材料文件名不能为空。');
  }
  const withoutControl = rawName.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const normalized = withoutControl.replace(/\\/g, '/');
  const segments = normalized
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..');
  const baseName = (segments[segments.length - 1] || '')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .trim();
  if (!baseName) {
    fail('INVALID_FILE_NAME', '材料文件名不合法。');
  }
  const maxLength = COMPETITION_MATERIAL_POLICY.FILE_NAME_MAX_LENGTH;
  if (baseName.length <= maxLength) {
    return baseName;
  }
  const dotIndex = baseName.lastIndexOf('.');
  if (dotIndex > 0 && dotIndex < baseName.length - 1) {
    const ext = baseName.slice(dotIndex);
    const stemMax = Math.max(1, maxLength - ext.length);
    return `${baseName.slice(0, stemMax)}${ext}`;
  }
  return baseName.slice(0, maxLength);
}

function extractExtension(name) {
  const text = String(name || '');
  const dotIndex = text.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= text.length - 1) {
    return '';
  }
  return text.slice(dotIndex + 1).toLowerCase();
}

function validateMaterialPolicyPayload(payload) {
  const input = asObject(payload);
  return {
    competitionId: safeId(input.competitionId, '赛事')
  };
}

function validateRegisterMaterialPayload(payload) {
  const input = asObject(payload);
  const competitionId = safeId(input.competitionId, '赛事');
  const registrationId = safeId(input.registrationId, '报名记录');
  const clientRequestId = safeId(input.clientRequestId, '请求标识');

  if (typeof input.cloudPath !== 'string' || !input.cloudPath.trim()) {
    fail('INVALID_CLOUD_PATH', '材料存储路径不能为空。');
  }
  const cloudPath = input.cloudPath.trim();
  if (
    cloudPath.length > 300 ||
    /[\u0000-\u001f\u007f\\]/.test(cloudPath) ||
    cloudPath.includes('..') ||
    cloudPath.startsWith('/')
  ) {
    fail('INVALID_CLOUD_PATH', '材料存储路径不合法。');
  }

  if (typeof input.fileId !== 'string' || !input.fileId.trim()) {
    fail('INVALID_FILE_ID', '材料文件标识不能为空。');
  }
  const fileId = input.fileId.trim();
  if (fileId.length > 500 || /[\u0000-\u001f\u007f]/.test(fileId)) {
    fail('INVALID_FILE_ID', '材料文件标识不合法。');
  }

  const fileName = sanitizeAttachmentFileName(input.fileName);
  const fileExt = extractExtension(fileName);
  const pathExt = extractExtension(cloudPath);
  if (
    !fileExt ||
    !pathExt ||
    !COMPETITION_MATERIAL_POLICY.ALLOWED_EXTENSIONS.includes(fileExt) ||
    !COMPETITION_MATERIAL_POLICY.ALLOWED_EXTENSIONS.includes(pathExt) ||
    fileExt !== pathExt
  ) {
    fail(
      'INVALID_FILE_TYPE',
      '仅支持上传 jpg、jpeg、png、pdf 格式的材料文件。'
    );
  }

  if (
    typeof input.sizeBytes !== 'number' ||
    !Number.isFinite(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > COMPETITION_MATERIAL_POLICY.MAX_SIZE_BYTES
  ) {
    fail('INVALID_FILE_SIZE', '材料文件大小必须在 1 字节至 10MB 之间。');
  }

  return {
    competitionId,
    registrationId,
    clientRequestId,
    cloudPath,
    fileId,
    fileName,
    extension: fileExt,
    contentType: COMPETITION_MATERIAL_POLICY.CONTENT_TYPES[fileExt],
    sizeBytes: Math.floor(input.sizeBytes)
  };
}

function validateRemoveMaterialPayload(payload) {
  const input = asObject(payload);
  return {
    attachmentId: safeId(input.attachmentId, '材料记录')
  };
}

function validateListMyMaterialsPayload(payload) {
  const input = asObject(payload);
  return {
    competitionId: safeId(input.competitionId, '赛事')
  };
}

function validateListRegistrationMaterialsPayload(payload) {
  const input = asObject(payload);
  return {
    competitionId: safeId(input.competitionId, '赛事')
  };
}

function validateGetMaterialUrlPayload(payload) {
  const input = asObject(payload);
  return {
    attachmentId: safeId(input.attachmentId, '材料记录')
  };
}

module.exports = {
  sanitizeAttachmentFileName,
  validateGetMaterialUrlPayload,
  validateListMyMaterialsPayload,
  validateListRegistrationMaterialsPayload,
  validateMaterialPolicyPayload,
  validateRegisterMaterialPayload,
  validateRemoveMaterialPayload,
  validateStatisticsPeriodPayload,
  normalizeInviteCode,
  validateParentProfilePayload,
  validateCoachProfilePayload,
  validateParentInviteCreatePayload,
  validateParentInviteRedeemPayload,
  validateParentLinkDecisionPayload,
  validateParentLinkReviewPayload,
  validateParentLinkRevokePayload,
  validateParentStudentQueryPayload,
  validatePerformanceLeaderboardPayload,
  validateAttendanceLeaderboardPayload,
  validateExportPayload,
  validateCompetitionActionPayload,
  validateCompetitionCreatePayload,
  validateCompetitionQueryPayload,
  validateCompetitionUpdatePayload,
  validateFeedbackQueryPayload,
  validateFeedbackReviewPayload,
  validateFeedbackSubmitPayload,
  validateFeedbackUpdatePayload,
  validateIntentCancelPayload,
  validateIntentSubmitPayload,
  validateNoticeActionPayload,
  validateNoticeCreatePayload,
  validateNoticeQueryPayload,
  validateNoticeReadPayload,
  validateNoticeUpdatePayload,
  validateRegistrationQueryPayload,
  validateRegistrationStatusPayload,
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
  validateTrainingGroupDeletionPayload,
  validateGroupSeasonLabel,
  validateProfilePayload,
  validateMeasurementPayload,
  validatePerformanceReviewPayload,
  validatePerformanceSubmissionPayload,
  validateStudentProfileUpdatePayload,
  validateUserStatusPayload,
  validateUserDeletionPayload,
  validateReviewPayload,
  validateRolePayload
};
