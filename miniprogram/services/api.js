'use strict';

const {
  API_FUNCTION_NAME,
  HEALTH_FUNCTION_NAME
} = require('../config/env');
const { readActiveRole, sessionToken } = require('../utils/active-role');

function createClientError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function executeApiCall(action, requestPayload) {
  try {
    const response = await wx.cloud.callFunction({
      name: API_FUNCTION_NAME,
      data: { action, payload: requestPayload }
    });
    const result = response && response.result;

    if (!result || typeof result.ok !== 'boolean') {
      throw createClientError('INVALID_RESPONSE', '云函数返回格式不正确，请稍后重试。');
    }
    if (!result.ok) {
      const publicError = result.error || {};
      throw createClientError(
        publicError.code || 'CLOUD_ACTION_FAILED',
        publicError.message || '操作失败，请稍后重试。'
      );
    }
    return result.data;
  } catch (error) {
    if (error && error.code) {
      throw error;
    }
    throw createClientError('NETWORK_ERROR', '云服务暂时不可用，请检查网络后重试。');
  }
}

function callApi(action, payload = {}) {
  const requestPayload = payloadWithActingRole(payload);
  if (!isDedupableReadAction(action)) {
    return executeApiCall(action, requestPayload);
  }

  let identityPart = '';
  try {
    const app = getApp();
    const session = app && app.globalData ? app.globalData.session : null;
    identityPart = `${sessionToken(session)}#${(session && session.user && session.user.status) || ''}`;
  } catch (error) {
    identityPart = 'anonymous';
  }

  const key = `${requestEpoch}|${identityPart}|${action}|${JSON.stringify(requestPayload)}`;
  if (inflightReadRequests.has(key)) {
    return inflightReadRequests.get(key);
  }

  const epochAtStart = requestEpoch;
  const task = executeApiCall(action, requestPayload).finally(() => {
    if (inflightReadRequests.get(key) === task) {
      inflightReadRequests.delete(key);
    }
    if (epochAtStart !== requestEpoch) {
      inflightReadRequests.clear();
    }
  });
  inflightReadRequests.set(key, task);
  return task;
}

function resetRequestCache() {
  requestEpoch += 1;
  inflightReadRequests.clear();
}

async function healthCheck() {
  try {
    const response = await wx.cloud.callFunction({ name: HEALTH_FUNCTION_NAME });
    const result = response && response.result;
    if (!result || typeof result.ok !== 'boolean') {
      throw createClientError('INVALID_RESPONSE', '云函数返回格式不正确，请稍后重试。');
    }
    if (!result.ok) {
      const publicError = result.error || {};
      throw createClientError(
        publicError.code || 'HEALTH_CHECK_FAILED',
        publicError.message || '云开发连接测试失败。'
      );
    }
    return result.data;
  } catch (error) {
    if (error && error.code) {
      throw error;
    }
    throw createClientError('NETWORK_ERROR', '无法连接云开发环境，请检查网络和云环境配置。');
  }
}

module.exports = {
  login: () => callApi('auth.login'),
  bootstrapDeveloper: (bootstrapCode) =>
    callApi('auth.bootstrap', { bootstrapCode }),
  listTrainingGroups: () => callApi('directory.list_training_groups'),
  getProfile: () => callApi('profile.get'),
  getCoachProfile: () => callApi('coach.get_profile'),
  submitCoachProfile: (payload) => callApi('coach.submit_profile', payload),
  updateStudentProfile: (payload) => callApi('profile.update', payload),
  addMeasurement: (payload) => callApi('profile.add_measurement', payload),
  listMeasurements: () => callApi('profile.list_measurements'),
  listPerformanceEvents: () => callApi('performance.list_events'),
  submitPerformance: (payload) => callApi('performance.submit', payload),
  listMyPerformances: () => callApi('performance.list_mine'),
  submitProfile: (profile) => callApi('profile.submit', profile),
  listPendingPerformances: () => callApi('admin.list_pending_performances'),
  reviewPerformance: (payload) => callApi('admin.review_performance', payload),
  listStudentProfiles: () => callApi('admin.list_student_profiles'),
  getStudentProfile: (targetUserId) =>
    callApi('admin.get_student_profile', { targetUserId }),
  getMyReport: () => callApi('report.get_my_report'),
  getStudentReport: (targetUserId) =>
    callApi('admin.get_student_report', { targetUserId }),
  getStatisticsMeta: () => callApi('statistics.get_meta'),
  getMyStatistics: (payload = {}) =>
    callApi('statistics.get_my_overview', payload),
  getManageStatistics: (payload = {}) =>
    callApi('statistics.get_manage_overview', payload),
  getPerformanceLeaderboard: (payload = {}) =>
    callApi('leaderboard.performance', payload),
  getAttendanceLeaderboard: (payload = {}) =>
    callApi('leaderboard.attendance', payload),
  exportPerformanceRows: (payload = {}) =>
    callApi('export.performance_rows', payload),
  exportAttendanceRows: (payload = {}) =>
    callApi('export.attendance_rows', payload),
  listPlanMeta: () => callApi('plan.list_meta'),
  listManagePlans: (payload = {}) => callApi('plan.list_manage', payload),
  getManagePlan: (planId) => callApi('plan.get_manage_detail', { planId }),
  createPlan: (payload) => callApi('plan.create', payload),
  updatePlan: (payload) => callApi('plan.update', payload),
  publishPlan: (payload) => callApi('plan.publish', payload),
  archivePlan: (payload) => callApi('plan.archive', payload),
  copyPlan: (payload) => callApi('plan.copy', payload),
  listStudentPlans: (payload = {}) => callApi('plan.list_student', payload),
  getStudentPlan: (planId) => callApi('plan.get_student', { planId }),
  listManageAttendanceSessions: (payload = {}) =>
    callApi('attendance.list_manage_sessions', payload),
  getAttendanceRoster: (sessionId) =>
    callApi('attendance.get_session_roster', { sessionId }),
  createAttendanceSession: (payload) =>
    callApi('attendance.create_session', payload),
  updateAttendanceSession: (payload) =>
    callApi('attendance.update_session', payload),
  cancelAttendanceSession: (payload) =>
    callApi('attendance.cancel_session', payload),
  manualVerifyAttendance: (payload) =>
    callApi('attendance.manual_verify', payload),
  getStudentTodayAttendance: () =>
    callApi('attendance.get_student_today'),
  listStudentAttendance: (payload = {}) =>
    callApi('attendance.list_student_records', payload),
  checkInAttendance: (payload) => callApi('attendance.check_in', payload),
  createLeave: (payload) => callApi('leave.create', payload),
  cancelLeave: (payload) => callApi('leave.cancel', payload),
  listMyLeaves: () => callApi('leave.list_mine'),
  listPendingLeaves: () => callApi('leave.list_pending'),
  listReviewedLeaves: () => callApi('leave.list_reviewed'),
  reviewLeave: (payload) => callApi('leave.review', payload),
  listCompetitionMeta: () => callApi('competition.list_meta'),
  listManageCompetitions: (payload = {}) =>
    callApi('competition.list_manage', payload),
  getManageCompetition: (competitionId) =>
    callApi('competition.get_manage_detail', { competitionId }),
  createCompetition: (payload) => callApi('competition.create', payload),
  updateCompetition: (payload) => callApi('competition.update', payload),
  publishCompetition: (payload) => callApi('competition.publish', payload),
  closeCompetition: (payload) => callApi('competition.close', payload),
  archiveCompetition: (payload) => callApi('competition.archive', payload),
  listStudentCompetitions: () => callApi('competition.list_student'),
  getStudentCompetition: (competitionId) =>
    callApi('competition.get_student_detail', { competitionId }),
  submitCompetitionIntent: (payload) =>
    callApi('competition.submit_intent', payload),
  cancelCompetitionIntent: (payload) =>
    callApi('competition.cancel_intent', payload),
  listMyCompetitionIntents: () => callApi('competition.list_my_intents'),
  listManagedRegistrations: (payload = {}) =>
    callApi('competition.list_registrations', payload),
  getManagedRegistration: (registrationId) =>
    callApi('competition.get_registration_detail', { registrationId }),
  updateRegistrationStatus: (payload) =>
    callApi('competition.update_registration_status', payload),
  exportRegistrationRows: (payload = {}) =>
    callApi('competition.export_rows', payload),
  listManageNotices: (payload = {}) => callApi('notice.list_manage', payload),
  getManageNotice: (noticeId) =>
    callApi('notice.get_manage_detail', { noticeId }),
  createNotice: (payload) => callApi('notice.create', payload),
  updateNotice: (payload) => callApi('notice.update', payload),
  publishNotice: (payload) => callApi('notice.publish', payload),
  withdrawNotice: (payload) => callApi('notice.withdraw', payload),
  archiveNotice: (payload) => callApi('notice.archive', payload),
  listStudentNotices: (payload = {}) => callApi('notice.list_student', payload),
  getStudentNotice: (noticeId) =>
    callApi('notice.get_student_detail', { noticeId }),
  markNoticeRead: (noticeId) => callApi('notice.mark_read', { noticeId }),
  getUnreadNoticeCount: () => callApi('notice.unread_count'),
  listEligibleFeedbackSessions: () =>
    callApi('feedback.list_eligible_sessions'),
  listMyFeedback: () => callApi('feedback.list_mine'),
  submitFeedback: (payload) => callApi('feedback.submit', payload),
  updateFeedback: (payload) => callApi('feedback.update', payload),
  listManagedFeedback: (payload = {}) =>
    callApi('feedback.list_manage', payload),
  reviewFeedback: (payload) => callApi('feedback.review', payload),
  listPendingRegistrations: () => callApi('admin.list_pending_registrations'),
  /* V1.6 家长端（只读 + 关联管理） */
  submitParentProfile: (payload) => callApi('parent.submit_profile', payload),
  getParentProfile: () => callApi('parent.get_profile'),
  createParentInvite: (payload = {}) => callApi('parent.create_invite', payload),
  redeemParentInvite: (payload) => callApi('parent.redeem_invite', payload),
  studentDecideLink: (payload) => callApi('parent.student_decision', payload),
  listMyParentLinks: () => callApi('parent.list_my_links'),
  listParentStudents: () => callApi('parent.list_students'),
  getParentStudentOverview: (payload) => callApi('parent.get_student_overview', payload),
  listPendingLinks: () => callApi('parent.list_pending_links'),
  reviewParentLink: (payload) => callApi('parent.review_link', payload),
  revokeParentLink: (payload) => callApi('parent.revoke_link', payload),
  reviewRegistration: (payload) => callApi('admin.review_registration', payload),
  listUsers: () => callApi('admin.list_users'),
  getUserDeletionImpact: (targetUserId) =>
    callApi('admin.get_user_deletion_impact', { targetUserId }),
  deleteUser: (payload) => callApi('admin.delete_user', payload),
  assignRole: (payload) => callApi('admin.assign_role', payload),
  setUserStatus: (payload) => callApi('admin.set_user_status', payload),
  listAllTrainingGroups: () => callApi('admin.list_training_groups'),
  getTrainingGroupDeletionImpact: (trainingGroupId) =>
    callApi('admin.get_training_group_deletion_impact', { trainingGroupId }),
  deleteTrainingGroup: (payload) =>
    callApi('admin.delete_training_group', payload),
  createTrainingGroup: (payload) =>
    callApi('admin.create_training_group', payload),
  setTrainingGroupEnabled: (payload) =>
    callApi('admin.set_training_group_enabled', payload),
  setGroupCoach: (payload) => callApi('admin.set_group_coach', payload),
  healthCheck,
  resetRequestCache
};
const inflightReadRequests = new Map();
let requestEpoch = 0;

const READ_ACTION_PREFIXES = Object.freeze([
  'directory.',
  'profile.get',
  'coach.get_',
  'parent.get_',
  'parent.list_',
  'performance.list_',
  'report.get_',
  'statistics.get_',
  'leaderboard.',
  'export.',
  'plan.list_',
  'plan.get_',
  'attendance.list_',
  'attendance.get_',
  'leave.list_',
  'competition.list_',
  'competition.get_',
  'notice.list_',
  'notice.get_',
  'notice.unread_',
  'feedback.list_',
  'admin.list_',
  'admin.get_'
]);

function isDedupableReadAction(action) {
  return READ_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix));
}

function payloadWithActingRole(payload) {
  try {
    const app = getApp();
    const session = app && app.globalData ? app.globalData.session : null;
    const actingRole = readActiveRole(sessionToken(session));
    if (actingRole === 'developer' || actingRole === 'coach') {
      return { ...payload, actingRole };
    }
  } catch (error) {
    return payload;
  }
  return payload;
}
