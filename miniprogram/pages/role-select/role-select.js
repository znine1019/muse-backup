'use strict';

const { getRoleLabel, getRoleRoute } = require('../../utils/session');
const { saveActiveRole, sessionToken } = require('../../utils/active-role');

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
      /* 记录当前激活角色，供「全部功能」分类页区分多角色账号 */
      saveActiveRole(
        event.currentTarget.dataset.role,
        sessionToken(getApp().globalData.session)
      );
      wx.reLaunch({ url: route });
    }
  }
});
