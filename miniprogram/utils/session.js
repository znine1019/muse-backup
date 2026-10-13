'use strict';

const { IS_DEMO_BUILD } = require('../config/build-mode');

const ROLE_ROUTES = Object.freeze({
  student: '/pages/student/student',
  parent: '/pages/parent/parent',
  coach: '/pages/coach/coach',
  developer: '/pages/admin/admin'
});

const STATUS_LABELS = Object.freeze({
  pending_profile: '待完善资料',
  pending_review: '待审核',
  active: '已启用',
  rejected: '审核未通过',
  disabled: '已停用'
});

function getStatusLabel(status) {
  return STATUS_LABELS[status] || '状态未知';
}

function getRoleLabel(role) {
  return {
    developer: '开发者',
    coach: '教练员',
    student: '学生',
    parent: '家长'
  }[role] || role;
}

function getSessionDestination(session) {
  /*
   * DEMO 展示构建：任何“会话不被接受”的场景（包括误入正式业务页被角色校验拒绝）
   * 都统一回到 DEMO 首页，绝不把访客送回正式学生 / 教练员 / 家长 / 开发者工作台。
   * 正式 main 分支不包含 build-mode.js，因此这一分支不会生效。
   */
  if (IS_DEMO_BUILD && (!session || !session.user || session.demo === true)) {
    return { type: 'demo', url: '/pages/showcase/showcase', label: '返回 DEMO 首页' };
  }

  if (!session || !session.user) {
    return { type: 'login', url: '/pages/index/index', label: '返回登录' };
  }

  const { status, roles = [] } = session.user;
  if (status !== 'active') {
    return { type: 'review', url: '/pages/pending/pending', label: '查看审核状态' };
  }

  const authorizedRoles = roles.filter((role) => ROLE_ROUTES[role]);
  if (authorizedRoles.length === 1) {
    return {
      type: 'role',
      role: authorizedRoles[0],
      url: ROLE_ROUTES[authorizedRoles[0]],
      label: `进入${getRoleLabel(authorizedRoles[0])}端`
    };
  }

  if (authorizedRoles.length > 1) {
    return { type: 'role_select', url: '/pages/role-select/role-select', label: '选择身份' };
  }

  return { type: 'review', url: '/pages/pending/pending', label: '查看账号状态' };
}

function getRoleRoute(role) {
  return ROLE_ROUTES[role] || '';
}

function sessionHasRole(session, role) {
  return Boolean(
    session &&
      session.user &&
      session.user.status === 'active' &&
      Array.isArray(session.user.roles) &&
      session.user.roles.includes(role)
  );
}

module.exports = {
  getRoleLabel,
  getRoleRoute,
  getSessionDestination,
  getStatusLabel,
  sessionHasRole
};
