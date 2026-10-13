'use strict';

/**
 * V1.6 阶段8｜当前激活角色（多角色工作台切换记忆）
 *
 * 背景：一个微信账号可能同时拥有多个角色（例如 developer + coach）。
 * 「全部功能」分类页需要知道要展示哪一套目录，因此记录最近一次进入的工作台角色。
 *
 * 安全边界：
 *   1. 这里只保存「展示用」的角色字符串，不保存任何业务数据。
 *   2. 令牌与 userId + roles 绑定：账号切换、角色增减、账号停用后自动失效回退。
 *   3. 绝不作为权限依据——所有数据访问仍由云函数按可信微信身份重新校验。
 */

const ACTIVE_ROLE_KEY = 'jogger_active_role_v1';

function readStore() {
  try {
    const value = wx.getStorageSync(ACTIVE_ROLE_KEY);
    return value && typeof value === 'object' ? value : null;
  } catch (error) {
    return null;
  }
}

function persist(store) {
  try {
    wx.setStorageSync(ACTIVE_ROLE_KEY, store);
  } catch (error) {
    /* 存储不可用时不阻断导航：仅本次会话内回退到默认角色 */
  }
}

function sameRoles(left, right) {
  const a = Array.isArray(left) ? left.slice().sort() : [];
  const b = Array.isArray(right) ? right.slice().sort() : [];
  return a.length === b.length && a.every((role, index) => role === b[index]);
}

/* 跨执行上下文安全的数组拷贝：小程序运行时与本地 VM 测试环境一致 */
function toList(value) {
  if (!value || typeof value !== 'object' || typeof value.length !== 'number') {
    return [];
  }
  return Array.prototype.map.call(value, (item) => String(item));
}

function tokenOf(source) {
  const value = source || {};
  return { userId: value.userId || '', roles: toList(value.roles) };
}

/** 判断两个令牌是否属于同一身份（用户相同且角色集合一致） */
function isTokenValid(store, token) {
  if (!store || !token) {
    return false;
  }
  return store.userId === token.userId && sameRoles(store.roles, token.roles);
}

/**
 * 读取仍然有效的激活角色；身份变化、角色变化或存储不可用时返回 ''。
 */
function readActiveRole(token) {
  const store = readStore();
  if (!isTokenValid(store, token)) {
    return '';
  }
  return typeof store.role === 'string' ? store.role : '';
}

/** 记录当前激活角色（与身份令牌绑定） */
function saveActiveRole(role, token) {
  if (!role || !token) {
    return;
  }
  persist({ userId: token.userId, roles: token.roles.slice(), role, savedAt: Date.now() });
}

/** 退出登录或权限失效时清理，避免下一位使用者读到旧角色 */
function clearActiveRole() {
  try {
    wx.removeStorageSync(ACTIVE_ROLE_KEY);
  } catch (error) {
    /* 清理失败不影响退出流程：会话缓存已由 app.clearSession 清除 */
  }
}

function sessionToken(session) {
  const user = (session && session.user) || {};
  return tokenOf({ userId: user.id, roles: user.roles });
}

/**
 * 解析要展示的角色：
 *   1. 优先使用仍有效的已选角色；
 *   2. 否则回退到目录支持的第一个角色；
 *   3. 都没有时返回 ''，由调用方按会话跳转。
 */
function resolveActiveRole(session, available) {
  const list = Array.isArray(available) ? available : [];
  if (!list.length) {
    return '';
  }
  const remembered = readActiveRole(sessionToken(session));
  return list.includes(remembered) ? remembered : list[0];
}

module.exports = {
  ACTIVE_ROLE_KEY,
  clearActiveRole,
  isTokenValid,
  readActiveRole,
  resolveActiveRole,
  saveActiveRole,
  sessionToken,
  tokenOf
};
