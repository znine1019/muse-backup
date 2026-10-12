'use strict';

const { LIMITS, ROLE_VALUES } = require('./constants');
const { getPerformanceEvent } = require('./performance-events');
const { fail } = require('./errors');

const GENDERS = Object.freeze(['male', 'female', 'unspecified']);
const REVIEW_DECISIONS = Object.freeze(['approve', 'reject']);
const PERFORMANCE_REVIEW_DECISIONS = REVIEW_DECISIONS;
const MAX_SECONDARY_EVENTS = 3;

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
  GENDERS,
  asObject,
  safeId,
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
