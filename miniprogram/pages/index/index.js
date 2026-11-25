'use strict';

const {
  getSessionDestination,
  getStatusLabel
} = require('../../utils/session');

Page({
  data: {
    loading: true,
    error: '',
    session: null,
    isUnregistered: false,
    statusLabel: '',
    actionLabel: '微信一键登录',
  },

  onShow() {
    this.identify({ routeActive: true });
  },

  async identify({ routeActive = false, force = false, refresh = false } = {}) {
    this.setData({ loading: true, error: '' });

    try {
      const session = await getApp().ensureSession({ force, refresh });
      const destination = getSessionDestination(session);
      const isUnregistered =
        session.registered === false || session.user.status === 'unregistered';

      this.setData({
        loading: false,
        session,
        isUnregistered,
        statusLabel: getStatusLabel(session.user.status),
        actionLabel: destination.label
      });

      if (routeActive && destination.type === 'role') {
        wx.reLaunch({ url: destination.url });
      }
    } catch (error) {
      if (error.code === 'MANUAL_LOGIN_REQUIRED') {
        this.setData({
          loading: false,
          session: null,
          isUnregistered: false,
          error: ''
        });
        return;
      }
      this.setData({
        loading: false,
        isUnregistered: false,
        error: error.message || '登录失败，请稍后重试。'
      });
    }
  },

  handleLogin() {
    this.identify({ routeActive: true, force: true, refresh: true });
  },

  goStudentRegister() {
    wx.navigateTo({ url: '/pages/register/register' });
  },

  goParentRegister() {
    wx.navigateTo({ url: '/pages/parent-register/parent-register' });
  },

  goCoachRegister() {
    wx.navigateTo({ url: '/pages/coach-register/coach-register' });
  },

  handleContinue() {
    if (!this.data.session) {
      this.handleLogin();
      return;
    }
    const destination = getSessionDestination(this.data.session);
    wx.reLaunch({ url: destination.url });
  }
});
