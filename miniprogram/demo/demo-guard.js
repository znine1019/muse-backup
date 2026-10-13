'use strict';

/**
 * 演示预览统一入口守卫（学生端 / 家长端 DEMO）
 *
 * 与既有「预览运动数据报告（DEMO）」保持同一套安全模型：
 *   1. 仅 develop / trial 环境可用（release 隐藏并拒绝）；
 *   2. 仅真实 developer 会话可进入；
 *   3. 演示数据全部来自 miniprogram/demo/ 的本地虚构数据，不读取 CloudBase；
 *   4. 演示页不调用任何业务接口，也不修改真实账号角色。
 *
 * 注意：前端环境与身份限制只是第一道门，正式业务数据的访问仍由云函数按可信身份判定。
 */

const { isDemoAllowed } = require('../utils/demo-mode');
const { sessionHasRole } = require('../utils/session');
const { IS_DEMO_BUILD } = require('../config/build-mode');
const { isDemoSession } = require('./showcase');

/* 与运动数据报告 DEMO 保持一致的标识文案 */
const DEMO_MARKER = 'DEMO｜虚构演示数据';
const DEMO_NOTICE = '仅用于功能及界面预览，不代表真实学生信息。';

/* 演示过程中可能写入的本地标记（当前实现不落任何存储，保留清理钩子） */
const DEMO_STATE_KEYS = Object.freeze(['demo_preview_state_v1']);

const ROLE_LABELS = Object.freeze({
  student: '学生端',
  coach: '教练员端',
  parent: '家长端'
});

function isSupportedDemoRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_LABELS, role);
}

function roleLabel(role) {
  return ROLE_LABELS[role] || '';
}

/**
 * 演示访问校验：环境 + 真实 developer 身份。
 * 任何演示页面（含直接以路径打开）都必须先通过此校验。
 */
function checkDemoAccess(session) {
  /*
   * DEMO 展示构建（demo/showcase-v1）：
   *  - 仍限定 develop/trial 环境；
   *  - 但只要求本机构造的**模拟会话**，访客不需要真实业务角色。
   * 该许可仅能打开本地演示页（全部为虚构数据），不构成任何正式权限：
   * DEMO 构建既不初始化云开发，也在业务接口层（api.js）拒绝所有正式调用。
   * 正式 main 分支不包含 build-mode.js，因此下面的分支不会生效，
   * 正式构建仍严格要求真实 developer 身份。
   */
  if (IS_DEMO_BUILD) {
    if (!isDemoAllowed()) {
      return {
        ok: false,
        reason: '当前环境不允许进入 DEMO（仅开发版与体验版可用）。'
      };
    }
    if (!isDemoSession(session)) {
      return { ok: false, reason: '请先在 DEMO 入口选择体验身份。' };
    }
    return { ok: true, reason: '' };
  }

  if (!isDemoAllowed()) {
    return {
      ok: false,
      reason: '当前环境不允许进入演示预览（仅开发版与体验版可用）。'
    };
  }
  if (!sessionHasRole(session, 'developer')) {
    return {
      ok: false,
      reason: '只有已启用的开发者身份可以进入演示预览。'
    };
  }
  return { ok: true, reason: '' };
}

/** 退出演示时清理可能残留的本地演示状态（不触碰真实会话与角色） */
function clearDemoState() {
  for (const key of DEMO_STATE_KEYS) {
    try {
      wx.removeStorageSync(key);
    } catch (error) {
      /* 存储不可用时不阻断退出流程 */
    }
  }
}

module.exports = {
  DEMO_MARKER,
  DEMO_NOTICE,
  DEMO_STATE_KEYS,
  checkDemoAccess,
  clearDemoState,
  isSupportedDemoRole,
  roleLabel
};
