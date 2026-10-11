'use strict';

const { ROLES, USER_STATUS } = require('./constants');

function isActiveUser(user) {
  return Boolean(user && user.status === USER_STATUS.ACTIVE);
}

function hasRole(user, role) {
  return Boolean(user && Array.isArray(user.roles) && user.roles.includes(role));
}

function requireActiveUser(user) {
  if (!user || user.status === USER_STATUS.DISABLED) {
    throw new Error('ACCOUNT_DISABLED');
  }
  if (!isActiveUser(user)) {
    throw new Error('ACCOUNT_PENDING');
  }
  return user;
}

function requireRole(user, role) {
  if (!hasRole(user, role)) {
    throw new Error('FORBIDDEN');
  }
  return user;
}

function canReviewRegistration(user, requestedTrainingGroupId, coachGroupIds) {
  if (hasRole(user, ROLES.DEVELOPER)) {
    return true;
  }
  return Boolean(
    hasRole(user, ROLES.COACH) &&
      requestedTrainingGroupId &&
      Array.isArray(coachGroupIds) &&
      coachGroupIds.includes(requestedTrainingGroupId)
  );
}

module.exports = {
  canReviewRegistration,
  hasRole,
  isActiveUser,
  requireActiveUser,
  requireRole
};
