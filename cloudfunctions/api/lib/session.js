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
    user: {
      id: user._id,
      status: user.status,
      roles
    },
    capabilities: {
      student: user.status === USER_STATUS.ACTIVE && roles.includes('student'),
      coach: user.status === USER_STATUS.ACTIVE && roles.includes('coach'),
      developer: user.status === USER_STATUS.ACTIVE && roles.includes('developer')
    }
  };
}

async function loadUser(repository, identity, { allowDisabled = false } = {}) {
  const user = await repository.ensureUser(identity);
  if (!allowDisabled && user.status === USER_STATUS.DISABLED) {
    fail('ACCOUNT_DISABLED', '账号已停用，无法访问内部数据。');
  }
  return user;
}

async function loadActiveActor(repository, identity, allowedRoles = []) {
  const user = await loadUser(repository, identity);
  if (user.status !== USER_STATUS.ACTIVE) {
    fail('ACCOUNT_NOT_ACTIVE', '账号尚未通过审核，暂时不能执行此操作。');
  }
  if (allowedRoles.length && !allowedRoles.some((role) => hasRole(user, role))) {
    fail('FORBIDDEN', '当前账号没有执行此操作的权限。');
  }
  return user;
}

function readableProfile(profile) {
  if (!profile) {
    return null;
  }
  return {
    id: profile._id,
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
  loadActiveActor,
  loadUser,
  readableProfile
};
