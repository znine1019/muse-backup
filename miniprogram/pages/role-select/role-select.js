'use strict';

const { getRoleLabel, getRoleRoute } = require('../../utils/session');

Page({
  data: {
    loading: true,
    error: '',
    roles: []
  },

  onShow() {
    this.loadRoles();
  },

  async loadRoles() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (session.user.status !== 'active') {
        wx.reLaunch({ url: '/pages/pending/pending' });
        return;
      }

      const roles = (session.user.roles || [])
        .filter((role) => getRoleRoute(role))
        .map((role) => ({
          value: role,
          label: getRoleLabel(role),
          route: getRoleRoute(role)
        }));

      this.setData({ loading: false, roles });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '角色信息加载失败。'
      });
    }
  },

  selectRole(event) {
    const route = event.currentTarget.dataset.route;
    if (route) {
      wx.reLaunch({ url: route });
    }
  }
});
