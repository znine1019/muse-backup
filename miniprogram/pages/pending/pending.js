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
    status: '',
    statusLabel: '',
    profile: null,
    reviewComment: ''
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (session.user.status === 'active') {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }

      const result = await api.getProfile();
      this.setData({
        loading: false,
        status: result.userStatus,
        statusLabel: getStatusLabel(result.userStatus),
        profile: result.profile,
        reviewComment: result.reviewComment || ''
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '审核状态加载失败。'
      });
    }
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' });
  },

  /* V1.6：首次进入可选择“学生注册”或“家长注册” */
  goParentRegister() {
    wx.navigateTo({ url: '/pages/parent-register/parent-register' });
  },

  goHome() {
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
