'use strict';

/**
 * V1.6 阶段8｜全部功能（四角色共用分类页）
 *
 * 单一配置（config/feature-catalog.js）+ 角色差异化展示。
 * 目录只收录仓库中真实存在的页面；本页只做导航，不写入任何业务数据。
 * 页面隐藏入口不等于权限控制：目标页面仍由云函数按可信身份重新校验。
 */

const {
  availableRoles,
  categoriesForRole,
  hasCatalog,
  isFeatureAvailable
} = require('../../config/feature-catalog');
const { getRoleLabel, getSessionDestination } = require('../../utils/session');
const {
  clearActiveRole,
  resolveActiveRole,
  saveActiveRole,
  sessionToken
} = require('../../utils/active-role');

/** 会话异常时的兜底入口（按角色取工作台，不依赖目录配置） */
const FALLBACK_ROUTES = Object.freeze({
  student: '/pages/student/student',
  coach: '/pages/coach/coach',
  parent: '/pages/parent/parent',
  developer: '/pages/admin/admin'
});

function destinationOf(session) {
  try {
    const destination = getSessionDestination(session);
    if (destination && destination.url) {
      return destination.url;
    }
  } catch (error) {
    /* 兜底路由 */
  }
  const user = (session && session.user) || {};
  const roles = Array.isArray(user.roles) ? user.roles : [];
  for (const role of roles) {
    if (FALLBACK_ROUTES[role]) {
      return FALLBACK_ROUTES[role];
    }
  }
  return '/pages/index/index';
}

function tileOf(item) {
  return {
    id: item.id,
    name: item.name,
    desc: item.desc || '',
    url: item.url,
    tone: item.tone || 'plain',
    badge: (item.name || '·').slice(0, 1)
  };
}

Page({
  data: {
    loading: true,
    error: '',
    roleLabel: '',
    roleTone: 'brand',
    roleNote: '',
    headMeta: '',
    availableRoles: [],
    roleChips: [],
    activeRole: '',
    categories: []
  },

  onShow() {
    this.loadCatalog();
  },

  async loadCatalog() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      const user = session.user || {};

      /* 只有已启用的账号才能进入功能目录 */
      if (user.status !== 'active') {
        await this.denied('当前账号尚未启用，无法查看功能目录。', session);
        return;
      }

      const roles = (user.roles || []).filter((role) => hasCatalog(role));
      if (!roles.length) {
        await this.denied('当前账号没有可用的功能目录。', session);
        return;
      }

      /* 先按固定角色顺序归一化，再决定默认展示的激活角色 */
      /* 固定角色顺序由 render 统一归一化，避免同一逻辑分散在两处 */
      const available = availableRoles(user.roles);
      const activeRole = resolveActiveRole(session, available);
      this.render(available, activeRole);
    } catch (error) {
      this.setData({ loading: false, error: error.message || '功能目录加载失败。' });
    }
  },

  render(available, activeRole) {
    /* 统一按固定角色顺序排列，避免调用方传入顺序影响展示与记忆 */
    const roles = availableRoles(available);
    const categories = categoriesForRole(activeRole)
      .map((category) => {
        const items = category.items
          .filter((item) => isFeatureAvailable(item, roles))
          .map(tileOf);
        return { key: category.key, label: category.label, count: items.length, items };
      })
      .filter((category) => category.items.length > 0);
    const total = categories.reduce((sum, category) => sum + category.items.length, 0);

    this.setData({
      loading: false,
      error: '',
      availableRoles: roles,
      roleChips: roles.map((role) => ({
        role,
        label: getRoleLabel(role),
        active: role === activeRole
      })),
      activeRole,
      roleLabel: getRoleLabel(activeRole),
      roleTone: activeRole === 'student' || activeRole === 'coach' ? 'brand' : 'accent',
      roleNote: `${roles.length} 个已授权身份中正在查看「${getRoleLabel(activeRole)}」；只有当前身份的功能会显示。`,
      headMeta: `${getRoleLabel(activeRole)} · 共 ${total} 项已实现功能`,
      categories
    });
  },

  async denied(message, session) {
    this.setData({ loading: false, error: message, categories: [] });
    this.redirect(destinationOf(session));
  },

  redirect(url) {
    wx.reLaunch({ url: url || '/pages/index/index' });
  },

  onRoleTap(event) {
    const role = event.currentTarget.dataset.role;
    if (!role || role === this.data.activeRole || !this.data.availableRoles.includes(role)) {
      return;
    }
    const app = getApp();
    const session = app && app.globalData ? app.globalData.session : null;
    /* 记住选择：返回对应工作台后再打开目录仍是该角色 */
    saveActiveRole(role, sessionToken(session));
    this.render(this.data.availableRoles, role);
  },

  onItemTap(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) {
      return;
    }
    wx.navigateTo({ url });
  },

  /* 回到当前角色的工作台（用 reLaunch 避免「全部功能」页面在栈中重复堆积） */
  goWorkbench() {
    this.redirect(FALLBACK_ROUTES[this.data.activeRole] || '/pages/index/index');
  },

  goLogin() {
    clearActiveRole();
    this.redirect('/pages/index/index');
  },

  retry() {
    this.loadCatalog();
  }
});
