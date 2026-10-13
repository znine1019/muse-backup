'use strict';

/**
 * DEMO 展示启动器（仅存在于 demo/showcase-v1 分支）
 *
 * 职责：为受邀访客提供"四种模拟身份"的入口与本地模拟会话。
 * 关键约束：
 *   1. 模拟会话不带任何真实微信身份，也不经过正式登录接口；
 *   2. 访客不需要拥有任何真实业务角色；
 *   3. 模拟会话只用于打开本地演示页面（全部为虚构数据）；
 *   4. 演示身份只记在本地存储，退出演示即清除。
 */

const { IS_DEMO_BUILD } = require('./../config/build-mode');

const DEMO_SESSION_STORAGE_KEY = 'jogger_demo_role_v1';

/* D1-B：DEMO 首页只保留学生 / 教练员 / 家长三个体验入口（不再提供开发者端模拟）。 */
const ROLE_LABELS = Object.freeze({
  student: '学生端',
  coach: '教练员端',
  parent: '家长端'
});

/**
 * 四种展示入口。
 * status: ready = D1-A 已可体验；planned = 计划在 D1-B 完成模拟业务
 */
const SHOWCASE_ROLES = Object.freeze([
  {
    role: 'student',
    label: ROLE_LABELS.student,
    icon: '学',
    tone: 'brand',
    status: 'ready',
    desc: '学生工作台、训练计划、签到请假、训练反馈、运动成绩与报告等',
    note: '包含 1 名虚构学生与完整本地演示数据'
  },
  {
    role: 'coach',
    label: ROLE_LABELS.coach,
    icon: '教',
    tone: 'ok',
    status: 'ready',
    desc: '今日训练与考勤、请假审批、成绩审核、学生名册、反馈、赛事与通知',
    note: '含两名教练轮换带队与预置授权（不依赖任何审批流程）'
  },
  {
    role: 'parent',
    label: ROLE_LABELS.parent,
    icon: '家',
    tone: 'accent',
    status: 'ready',
    desc: '家长只读工作台、两名虚构学生切换、成绩/考勤/反馈/赛事通知',
    note: '含“关联已生效 / 待核验”两种授权状态演示'
  }
]);

function isShowcaseRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_LABELS, role);
}

function roleLabel(role) {
  return ROLE_LABELS[role] || '';
}

/** 该角色在当前 DEMO 构建中是否已可体验 */
function isRoleReady(role) {
  const found = SHOWCASE_ROLES.find((item) => item.role === role);
  return Boolean(found && found.status === 'ready');
}

/**
 * 构造本地模拟会话。
 * 注意：这不是微信身份，也不代表任何真实授权；仅用于打开本地演示页面。
 */
function buildDemoSession(role) {
  if (!isShowcaseRole(role)) {
    return null;
  }
  return {
    sessionVersion: 1,
    demo: true,
    user: {
      id: `demo_${role}_visitor`,
      name: `${roleLabel(role)}访客`,
      status: 'active',
      roles: [role]
    }
  };
}

function isDemoSession(session) {
  return Boolean(session && session.demo === true && session.user && session.user.id);
}

function readActiveDemoRole() {
  if (!IS_DEMO_BUILD) {
    return '';
  }
  try {
    const stored = wx.getStorageSync(DEMO_SESSION_STORAGE_KEY);
    return typeof stored === 'string' ? stored : '';
  } catch (error) {
    return '';
  }
}

function saveActiveDemoRole(role) {
  if (!isShowcaseRole(role)) {
    return;
  }
  try {
    wx.setStorageSync(DEMO_SESSION_STORAGE_KEY, role);
  } catch (error) {
    /* 存储不可用时仅本次会话内可用 */
  }
}

function clearActiveDemoRole() {
  try {
    wx.removeStorageSync(DEMO_SESSION_STORAGE_KEY);
  } catch (error) {
    /* 忽略 */
  }
}

module.exports = {
  DEMO_SESSION_STORAGE_KEY,
  ROLE_LABELS,
  SHOWCASE_ROLES,
  buildDemoSession,
  clearActiveDemoRole,
  isDemoSession,
  isRoleReady,
  isShowcaseRole,
  readActiveDemoRole,
  roleLabel,
  saveActiveDemoRole
};
