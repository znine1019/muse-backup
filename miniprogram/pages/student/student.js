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

      const result = await api.getProfile();
      this.setData({
        loading: false,
        statusLabel: getStatusLabel(result.userStatus),
        profile: result.profile,
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

  goHome() {
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
