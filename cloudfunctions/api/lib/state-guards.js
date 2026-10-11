'use strict';

const { REVIEW_STATUS, USER_STATUS } = require('./constants');
const { fail } = require('./errors');

function getProfileSubmissionDecision(status) {
  if (status === USER_STATUS.PENDING_REVIEW) {
    return { action: 'idempotent', status };
  }
  if ([USER_STATUS.PENDING_PROFILE, USER_STATUS.REJECTED].includes(status)) {
    return { action: 'submit', status };
  }
  fail('PROFILE_NOT_EDITABLE', '当前账号状态不能重新提交注册资料。');
}

function assertRegistrationPending(profile) {
  if (!profile || profile.reviewStatus !== REVIEW_STATUS.PENDING) {
    fail('REVIEW_NOT_PENDING', '该注册资料当前不在待审核状态。');
  }
  return true;
}

module.exports = {
  assertRegistrationPending,
  getProfileSubmissionDecision
};
