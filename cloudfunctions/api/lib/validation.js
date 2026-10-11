'use strict';

const { LIMITS, ROLE_VALUES } = require('./constants');
const { fail } = require('./errors');

const GENDERS = Object.freeze(['male', 'female', 'unspecified']);
const REVIEW_DECISIONS = Object.freeze(['approve', 'reject']);

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

function validateGroupName(value) {
  return requiredString(value, '训练组名称', LIMITS.nameMaxLength);
}

function validateGroupSeasonLabel(value) {
  return requiredString(value, '训练组年份或周期', 20);
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
  validateGroupSeasonLabel,
  validateProfilePayload,
  validateUserStatusPayload,
  validateReviewPayload,
  validateRolePayload
};
