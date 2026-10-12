'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const STATUS_LABELS = Object.freeze({
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝'
});

Page({
  data: {
    loading: true,
    error: '',
    userId: '',
    profile: null,
    secondaryEventsText: '',
    measurements: [],
    performances: []
  },

  goReport() {
    wx.navigateTo({
      url: `/pages/student-report/student-report?userId=${this.data.userId}`
    });
  },

  onLoad(options) {
    this.setData({ userId: options.userId || '' });
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'coach') && !sessionHasRole(session, 'developer')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      if (!this.data.userId) {
        throw new Error('缺少学生账号参数。');
      }

      const result = await api.getStudentProfile(this.data.userId);
      this.setData({
        secondaryEventsText: (result.profile.secondaryEventCodes || []).join('、'),
        loading: false,
        profile: result.profile,
        measurements: result.measurements || [],
        performances: (result.performances || []).map((item) => ({
          ...item,
          statusLabel: STATUS_LABELS[item.status] || item.status
        }))
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '学生档案加载失败。'
      });
    }
  }
});
