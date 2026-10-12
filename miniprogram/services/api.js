'use strict';

const {
  API_FUNCTION_NAME,
  HEALTH_FUNCTION_NAME
} = require('../config/env');

function createClientError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function callApi(action, payload = {}) {
  try {
    const response = await wx.cloud.callFunction({
      name: API_FUNCTION_NAME,
      data: { action, payload }
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
  listPendingRegistrations: () => callApi('admin.list_pending_registrations'),
  reviewRegistration: (payload) => callApi('admin.review_registration', payload),
  listUsers: () => callApi('admin.list_users'),
  assignRole: (payload) => callApi('admin.assign_role', payload),
  setUserStatus: (payload) => callApi('admin.set_user_status', payload),
  listAllTrainingGroups: () => callApi('admin.list_training_groups'),
  createTrainingGroup: (payload) =>
    callApi('admin.create_training_group', payload),
  setTrainingGroupEnabled: (payload) =>
    callApi('admin.set_training_group_enabled', payload),
  setGroupCoach: (payload) => callApi('admin.set_group_coach', payload),
  healthCheck
};
