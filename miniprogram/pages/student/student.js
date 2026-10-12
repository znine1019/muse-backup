'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  getStatusLabel,
  sessionHasRole
} = require('../../utils/session');

const GENDER_LABELS = Object.freeze({
  male: '男',
  female: '女',
  unspecified: '未说明'
});

Page({
  data: {
    loading: true,
    error: '',
    statusLabel: '',
    profile: null,
    measurements: [],
    performances: [],
    genderLabel: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'student')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }

      const [result, measurementResult, performanceResult] = await Promise.all([
        api.getProfile(),
        api.listMeasurements(),
        api.listMyPerformances()
      ]);
      const statusLabels = {
        pending: '待审核',
        approved: '已通过',
        rejected: '已拒绝'
      };
      this.setData({
        loading: false,
        statusLabel: getStatusLabel(result.userStatus),
        profile: result.profile,
        measurements: measurementResult.measurements || [],
        performances: (performanceResult.performances || []).map((item) => ({
          ...item,
          statusLabel: statusLabels[item.status] || item.status
        })),
        genderLabel: result.profile
          ? GENDER_LABELS[result.profile.gender] || '未说明'
          : ''
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '学生资料加载失败。'
      });
    }
  },


  goEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' });
  },

  goPerformance() {
    wx.navigateTo({ url: '/pages/performance/performance' });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/student-report/student-report' });
  },

  goAttendance() {
    wx.navigateTo({ url: '/pages/student-attendance/student-attendance' });
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/student-plans/student-plans' });
  },
  goHome() {
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
