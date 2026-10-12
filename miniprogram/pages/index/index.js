'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  getStatusLabel
} = require('../../utils/session');

Page({
  data: {
    loading: true,
    error: '',
    session: null,
    statusLabel: '',
    actionLabel: '微信一键登录',
    healthText: ''
  },

  onShow() {
    this.identify({ routeActive: true });
  },

  async identify({ routeActive = false, force = false } = {}) {
    this.setData({ loading: true, error: '' });

    try {
      const session = await getApp().ensureSession({ force });
      const destination = getSessionDestination(session);

      this.setData({
        loading: false,
        session,
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
          error: ''
        });
        return;
      }
      this.setData({
        loading: false,
        error: error.message || '登录失败，请稍后重试。'
      });
    }
  },

  handleLogin() {
    this.identify({ routeActive: true, force: true });
  },

  handleContinue() {
    if (!this.data.session) {
      this.handleLogin();
      return;
    }
    const destination = getSessionDestination(this.data.session);
    wx.reLaunch({ url: destination.url });
  },

  async handleHealthCheck() {
    this.setData({ healthText: '正在检查云函数连接...' });
    try {
      const result = await api.healthCheck();
      this.setData({
        healthText: result.databaseReady
          ? '云函数与数据库连接正常。'
          : '云函数连接正常，但数据库集合尚未初始化。'
      });
    } catch (error) {
      const code = error.code ? `（${error.code}）` : '';
      this.setData({
        healthText: `${error.message || '云开发连接测试失败。'}${code}`
      });
    }
  }
});
