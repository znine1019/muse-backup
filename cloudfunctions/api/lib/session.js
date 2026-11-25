'use strict';

const { ROLE_VALUES, USER_STATUS } = require('./constants');
const { fail } = require('./errors');
const { hasRole } = require('./policy');

function buildSession(user) {
  const roles = Array.isArray(user.roles)
    ? user.roles.filter((role) => ROLE_VALUES.includes(role))
    : [];

  return {
    sessionVersion: 1,
    registered: true,
    user: {
      id: user._id,
      status: user.status,
      roles,
      pendingProfileType: user.pendingProfileType || ''
    },
    capabilities: {
      student: user.status === USER_STATUS.ACTIVE && roles.includes('student'),
      coach: user.status === USER_STATUS.ACTIVE && roles.includes('coach'),
      developer: user.status === USER_STATUS.ACTIVE && roles.includes('developer')
    }
  };
}

function buildUnregisteredSession() {
  return {
    sessionVersion: 1,
    registered: false,
    user: {
      id: '',
      status: 'unregistered',
      roles: [],
      pendingProfileType: ''
    },
    capabilities: { student: false, coach: false, developer: false }
  };
}

async function loadUser(repository, identity, { allowDisabled = false } = {}) {
  const user = await getUserByIdentity(repository, identity);
  if (!user) {
    fail('REGISTRATION_REQUIRED', '请先完成实名注册。');
  }
  if (user.status === USER_STATUS.DELETED) {
    fail('ACCOUNT_DELETED', '账号已删除，无法继续访问。');
  }
  if (!allowDisabled && user.status === USER_STATUS.DISABLED) {
    fail('ACCOUNT_DISABLED', '账号已停用，无法访问内部数据。');
  }
  return user;
}

async function loadOptionalUser(
  repository,
  identity,
  { allowDisabled = false } = {}
) {
  const user = await getUserByIdentity(repository, identity);
  if (!user) {
    return null;
  }
  if (user.status === USER_STATUS.DELETED) {
    fail('ACCOUNT_DELETED', '账号已删除，无法继续访问。');
  }
  if (!allowDisabled && user.status === USER_STATUS.DISABLED) {
    fail('ACCOUNT_DISABLED', '账号已停用，无法访问内部数据。');
  }
  return user;
}

async function getUserByIdentity(repository, identity) {
  if (typeof repository.getUserByIdentity === 'function') {
    return repository.getUserByIdentity(identity);
  }
  /* Compatibility for isolated legacy test repositories only. */
  if (typeof repository.ensureUser === 'function') {
    return repository.ensureUser(identity);
  }
  return null;
}

async function loadActiveActor(repository, identity, allowedRoles = []) {
  const user = await loadUser(repository, identity);
  if (user.status !== USER_STATUS.ACTIVE) {
    fail('ACCOUNT_NOT_ACTIVE', '账号尚未通过审核，暂时不能执行此操作。');
  }

  const requestedRole = identity && identity.actingRole;
  let actor = user;
  if (requestedRole) {
    if (!['developer', 'coach'].includes(requestedRole)) {
      fail('FORBIDDEN', '所选工作台角色不合法。');
    }
    if (!Array.isArray(user.roles) || !user.roles.includes(requestedRole)) {
      fail('FORBIDDEN', '当前账号不具备所选工作台角色。');
    }
    actor = { ...user, roles: [requestedRole] };
  }

  if (allowedRoles.length && !allowedRoles.some((role) => hasRole(actor, role))) {
    fail('FORBIDDEN', '当前账号没有执行此操作的权限。');
  }
  return actor;
}

async function loadWorkbenchActor(
  repository,
  identity,
  allowedRoles = [],
  requestedRole = ''
) {
  const actor = await loadActiveActor(repository, identity, allowedRoles);
  if (!requestedRole) {
    return actor;
  }
  if (!actor.roles.includes(requestedRole)) {
    fail('FORBIDDEN', '当前账号不具备所选工作台角色。');
  }
  if (requestedRole === 'coach') {
    return { ...actor, roles: ['coach'] };
  }
  return actor;
}

function readableProfile(profile) {
  if (!profile) {
    return null;
  }
  return {
    id: profile._id,
    primaryEventCode: profile.primaryEventCode || '',
    primaryEventName: profile.primaryEventName || '',
    secondaryEventCodes: Array.isArray(profile.secondaryEventCodes)
      ? profile.secondaryEventCodes
      : [],
    trainingStartYear: profile.trainingStartYear || null,
    trainingYears: profile.trainingStartYear
      ? Math.max(0, new Date().getFullYear() - profile.trainingStartYear)
      : null,
    trainingExperienceSummary: profile.trainingExperienceSummary || '',
    examGoal: profile.examGoal || {},
    currentHeightCm: profile.currentHeightCm || profile.heightCm || null,
    currentWeightKg: profile.currentWeightKg || profile.weightKg || null,
    latestMeasurementAt: profile.latestMeasurementAt || null,
    userId: profile.userId,
    name: profile.name,
    gender: profile.gender,
    birthDate: profile.birthDate,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    primaryTrainingProject: profile.primaryTrainingProject,
    requestedTrainingGroupId: profile.requestedTrainingGroupId || '',
    reviewStatus: profile.reviewStatus,
    submittedAt: profile.submittedAt,
    reviewedAt: profile.reviewedAt || null,
    reviewComment: profile.reviewComment || ''
  };
}

module.exports = {
  buildSession,
  buildUnregisteredSession,
  getUserByIdentity,
  loadActiveActor,
  loadWorkbenchActor,
  loadUser,
  loadOptionalUser,
  readableProfile
};
