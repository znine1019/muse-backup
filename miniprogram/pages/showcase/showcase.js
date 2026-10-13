'use strict';

/**
 * DEMO 统一入口（仅存在于 demo/showcase-v1 分支）
 *
 * 展示四种模拟身份入口；不要求访客拥有任何真实角色，也不调用正式登录接口。
 * D1-B：学生端 / 教练员端 / 家长端均可直接体验；不再提供开发者端模拟。
 */

const {
  SHOWCASE_ROLES,
  clearActiveDemoRole,
  isRoleReady,
  roleLabel,
  saveActiveDemoRole
} = require('../../demo/showcase');
const { DEMO_MARKER, DEMO_NOTICE } = require('../../demo/demo-guard');

const STATUS_LABELS = Object.freeze({
  ready: '可体验',
  planned: 'D1-B 计划'
});

function decorateRoles() {
  return SHOWCASE_ROLES.map((item) => ({
    ...item,
    statusLabel: STATUS_LABELS[item.status] || item.status,
    ready: item.status === 'ready'
  }));
}

Page({
  data: {
    demoMarker: DEMO_MARKER,
    demoNotice: DEMO_NOTICE,
    roles: decorateRoles(),
    readyCount: SHOWCASE_ROLES.filter((item) => item.status === 'ready').length
  },

  onShow() {
    this.setData({ roles: decorateRoles() });
  },

  onRoleTap(event) {
    const role = event.currentTarget.dataset.role;
    if (!role) {
      return;
    }
    if (!isRoleReady(role)) {
      wx.showToast({
        title: `${roleLabel(role)}演示将在 D1-B 提供`,
        icon: 'none'
      });
      return;
    }
    /* 仅记录本地演示身份；不经过正式登录与角色授权接口 */
    saveActiveDemoRole(role);
    wx.navigateTo({ url: `/pages/demo/demo?role=${role}` });
  },

  resetDemo() {
    clearActiveDemoRole();
    wx.showToast({ title: '已清除本地演示身份', icon: 'none' });
  }
});
