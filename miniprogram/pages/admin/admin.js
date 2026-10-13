'use strict';

const api = require('../../services/api');
const { CLOUD_ENV_ID } = require('../../config/env');
const { isDemoAllowed } = require('../../utils/demo-mode');
const {
  getRoleLabel,
  getSessionDestination,
  getStatusLabel,
  sessionHasRole
} = require('../../utils/session');

const ROLE_OPTIONS = Object.freeze(['student', 'coach', 'developer']);

/* 管理入口全部指向现有真实页面（阶段1—阶段6 已注册路由），本页不新增任何路由 */

function settle(promise) {
  return promise.then(
    (data) => ({ ok: true, data }),
    (error) => ({ ok: false, error })
  );
}

/* 兼容处理：即使某个接口不可用，也只让对应区块报错，不会阻断整个工作台 */
function safeCall(invoke) {
  try {
    const result = invoke();
    return result && typeof result.then === 'function' ? result : Promise.resolve(result);
  } catch (error) {
    return Promise.reject(error);
  }
}

function formatServerTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    loading: true,
    sessionError: '',
    headMeta: '',

    systemState: { loading: true, error: '' },
    system: null,

    accountState: { loading: true, error: '' },
    accountSummary: { total: 0, students: 0, coaches: 0, developers: 0, disabled: 0, pendingReview: 0 },

    groupState: { loading: true, error: '' },
    groupSummary: { total: 0, enabled: 0, coaches: 0 },

    registrationState: { loading: true, error: '' },
    registrations: [],
    reviewingUserId: '',

    pendingState: { loading: true, error: '' },
    pendingPerformances: 0,
    pendingLeaves: 0,
    pendingTotal: 0,

    showUserPanel: false,
    showGroupPanel: false,
    users: [],
    groups: [],
    coachOptions: [],
    groupOptions: [],
    coachIndex: 0,
    groupIndex: 0,
    newGroupName: '',
    newGroupSeasonLabel: String(new Date().getFullYear()),
    busyUserId: '',
    actionError: '',
    demoAvailable: false
  },

  onShow() {
    this.loadPage();
  },

  onPullDownRefresh() {
    this.loadPage({ fromPullDown: true });
  },

  async loadPage(options = {}) {
    const fromPullDown = options.fromPullDown === true;
    this.setData({
      loading: true,
      sessionError: '',
      actionError: '',
      systemState: { loading: true, error: '' },
      accountState: { loading: true, error: '' },
      groupState: { loading: true, error: '' },
      registrationState: { loading: true, error: '' },
      pendingState: { loading: true, error: '' }
    });

    let session = null;
    try {
      session = await getApp().ensureSession({ force: true });
    } catch (error) {
      this.setData({
        loading: false,
        sessionError: error.message || '身份校验失败，请重新登录。'
      });
      if (fromPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

    if (!sessionHasRole(session, 'developer')) {
      wx.reLaunch({ url: getSessionDestination(session).url });
      return;
    }

    this.setData({
      loading: false,
      demoAvailable: isDemoAllowed(),
      headMeta: `${getRoleLabel('developer')} · 全局管理权限 · 敏感操作写入审计日志`
    });

    await Promise.all([
      this.loadSystem(),
      this.loadUsers(),
      this.loadGroups(),
      this.loadRegistrations(),
      this.loadPendingCounts()
    ]);

    if (fromPullDown) {
      wx.stopPullDownRefresh();
    }
  },

  async loadSystem() {
    this.setData({ 'systemState.loading': true, 'systemState.error': '' });
    const result = await settle(safeCall(() => api.healthCheck()));
    if (!result.ok) {
      this.setData({
        'systemState.loading': false,
        'systemState.error': result.error.message || '系统状态检查失败。'
      });
      return;
    }
    const payload = result.data || {};
    this.setData({
      'systemState.loading': false,
      'systemState.error': '',
      system: {
        envId: CLOUD_ENV_ID,
        cloudFunctionReady: payload.cloudFunctionReady === true,
        databaseReady: payload.databaseReady === true,
        serverTimeText: formatServerTime(payload.serverTime),
        overallText: payload.databaseReady === true ? '运行正常' : '数据库未就绪'
      }
    });
  },

  async loadUsers() {
    this.setData({ 'accountState.loading': true, 'accountState.error': '' });
    const result = await settle(safeCall(() => api.listUsers()));
    if (!result.ok) {
      this.setData({
        'accountState.loading': false,
        'accountState.error': result.error.message || '账号数据加载失败。'
      });
      return;
    }
    const users = (result.data.users || []).map((user) => {
      const roles = user.roles || [];
      return {
        ...user,
        statusLabel: getStatusLabel(user.status),
        statusActionLabel: user.status === 'disabled' ? '启用账号' : '停用账号',
        statusActionValue: user.status === 'disabled' ? 'active' : 'disabled',
        rolesText: roles.map((role) => getRoleLabel(role)).join('、') || '未授权',
        canViewProfile: user.status === 'active' && roles.includes('student'),
        roleActions: ROLE_OPTIONS.map((role) => ({
          role,
          label: getRoleLabel(role),
          active: roles.includes(role),
          actionLabel: roles.includes(role) ? '撤销' : '授予',
          grantValue: roles.includes(role) ? 'false' : 'true'
        }))
      };
    });
    const coachOptions = users
      .filter((user) => (user.roles || []).includes('coach'))
      .map((user) => ({ userId: user.userId, label: user.displayName }));
    this.setData({
      'accountState.loading': false,
      'accountState.error': '',
      users,
      coachOptions,
      accountSummary: {
        total: users.length,
        students: users.filter((user) => (user.roles || []).includes('student')).length,
        coaches: users.filter((user) => (user.roles || []).includes('coach')).length,
        developers: users.filter((user) => (user.roles || []).includes('developer')).length,
        disabled: users.filter((user) => user.status === 'disabled').length,
        pendingReview: this.data.registrations.length
      }
    });
  },

  async loadGroups() {
    this.setData({ 'groupState.loading': true, 'groupState.error': '' });
    const result = await settle(safeCall(() => api.listAllTrainingGroups()));
    if (!result.ok) {
      this.setData({
        'groupState.loading': false,
        'groupState.error': result.error.message || '训练组数据加载失败。'
      });
      return;
    }
    const users = this.data.users || [];
    const groups = (result.data.groups || []).map((group) => ({
      ...group,
      displayName: `${group.name}（${group.seasonLabel || '未标注'}）`,
      statusActionLabel: group.enabled ? '停用训练组' : '启用训练组',
      statusActionValue: group.enabled ? 'false' : 'true',
      coachNames: (group.coachUserIds || [])
        .map((userId) => (users.find((user) => user.userId === userId) || {}).displayName)
        .filter(Boolean)
        .join('、')
    }));
    this.setData({
      'groupState.loading': false,
      'groupState.error': '',
      groups,
      groupOptions: groups.map((group) => ({
        id: group.id,
        name: group.displayName,
        seasonLabel: group.seasonLabel
      })),
      coachIndex: 0,
      groupIndex: 0,
      groupSummary: {
        total: groups.length,
        enabled: groups.filter((group) => group.enabled).length,
        coaches: (this.data.coachOptions || []).length
      }
    });
  },

  async loadRegistrations() {
    this.setData({ 'registrationState.loading': true, 'registrationState.error': '' });
    const result = await settle(safeCall(() => api.listPendingRegistrations()));
    if (!result.ok) {
      this.setData({
        'registrationState.loading': false,
        'registrationState.error': result.error.message || '待审核注册加载失败。'
      });
      return;
    }
    const registrations = result.data.registrations || [];
    this.setData({
      'registrationState.loading': false,
      'registrationState.error': '',
      registrations,
      'accountSummary.pendingReview': registrations.length
    });
    this.refreshPendingTotal();
  },

  async loadPendingCounts() {
    this.setData({ 'pendingState.loading': true, 'pendingState.error': '' });
    const [performanceResult, leaveResult] = await Promise.all([
      settle(safeCall(() => api.listPendingPerformances())),
      settle(safeCall(() => api.listPendingLeaves()))
    ]);
    if (!performanceResult.ok && !leaveResult.ok) {
      this.setData({
        'pendingState.loading': false,
        'pendingState.error':
          performanceResult.error.message || leaveResult.error.message || '待处理数据加载失败。'
      });
      return;
    }
    this.setData({
      'pendingState.loading': false,
      'pendingState.error': '',
      pendingPerformances: performanceResult.ok
        ? Number(performanceResult.data.pendingCount) || 0
        : 0,
      pendingLeaves: leaveResult.ok ? Number(leaveResult.data.pendingCount) || 0 : 0
    });
    this.refreshPendingTotal();
  },

  refreshPendingTotal() {
    const total =
      (Number(this.data.pendingPerformances) || 0) +
      (Number(this.data.pendingLeaves) || 0) +
      (this.data.registrations || []).length;
    if (total !== this.data.pendingTotal) {
      this.setData({ pendingTotal: total });
    }
  },

  retrySystem() {
    this.loadSystem();
  },

  retryAccounts() {
    this.loadUsers();
  },

  retryGroups() {
    this.loadGroups();
  },

  retryRegistrations() {
    this.loadRegistrations();
  },

  retryPending() {
    this.loadPendingCounts();
  },

  toggleUserPanel() {
    this.setData({ showUserPanel: !this.data.showUserPanel });
  },

  toggleGroupPanel() {
    this.setData({ showGroupPanel: !this.data.showGroupPanel });
  },

  goPerformanceReview() {
    wx.navigateTo({ url: '/pages/coach-performance-review/coach-performance-review' });
  },

  goAttendanceManage() {
    wx.navigateTo({ url: '/pages/attendance-manage/attendance-manage' });
  },

  goStatsWorkbench() {
    wx.navigateTo({ url: '/pages/stats-workbench/stats-workbench' });
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/coach-plan-list/coach-plan-list' });
  },

  goCompetitionManage() {
    wx.navigateTo({ url: '/pages/competition-manage/competition-manage' });
  },

  goNoticeManage() {
    wx.navigateTo({ url: '/pages/notice-manage/notice-manage' });
  },

  goFeedbackManage() {
    wx.navigateTo({ url: '/pages/feedback-manage/feedback-manage' });
  },

  async review(event) {
    const userId = event.currentTarget.dataset.userId;
    const decision = event.currentTarget.dataset.decision;
    if (!userId || this.data.reviewingUserId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: decision === 'approve' ? '确认通过注册' : '填写驳回原因',
        content: decision === 'approve' ? '通过后学生角色由服务端正式授权。' : '',
        editable: decision === 'reject',
        placeholderText: '可填写审核意见',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    this.setData({ reviewingUserId: userId, actionError: '' });
    try {
      await api.reviewRegistration({
        targetUserId: userId,
        decision,
        comment: modal.content || ''
      });
      wx.showToast({ title: '已处理', icon: 'success' });
      await this.loadRegistrations();
    } catch (error) {
      this.setData({ actionError: error.message || '审核失败。' });
    } finally {
      this.setData({ reviewingUserId: '' });
    }
  },

  async toggleRole(event) {
    const userId = event.currentTarget.dataset.userId;
    const role = event.currentTarget.dataset.role;
    const grant = event.currentTarget.dataset.grant === 'true';
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: grant ? '确认授予角色' : '确认撤销角色',
        content: `${grant ? '授予' : '撤销'}${getRoleLabel(role)}角色。角色变更会影响该账号可访问的数据范围。`,
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    this.setData({ busyUserId: userId, actionError: '' });
    try {
      await api.assignRole({ targetUserId: userId, role, grant });
      await this.loadUsers();
      await this.loadGroups();
    } catch (error) {
      this.setData({ actionError: error.message || '角色操作失败。' });
    } finally {
      this.setData({ busyUserId: '' });
    }
  },

  async toggleUserStatus(event) {
    const userId = event.currentTarget.dataset.userId;
    const status = event.currentTarget.dataset.status;
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: status === 'disabled' ? '确认停用账号' : '确认启用账号',
        content:
          status === 'disabled'
            ? '停用后该账号不能访问内部数据，历史记录不会被删除。'
            : '启用后按已授权角色恢复访问。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    this.setData({ busyUserId: userId, actionError: '' });
    try {
      await api.setUserStatus({ targetUserId: userId, status });
      await this.loadUsers();
    } catch (error) {
      this.setData({ actionError: error.message || '账号状态操作失败。' });
    } finally {
      this.setData({ busyUserId: '' });
    }
  },

  onNewGroupInput(event) {
    this.setData({ newGroupName: event.detail.value });
  },

  onNewGroupSeasonInput(event) {
    this.setData({ newGroupSeasonLabel: event.detail.value });
  },

  async createGroup() {
    if (!this.data.newGroupName.trim()) {
      this.setData({ actionError: '请填写训练组名称。' });
      return;
    }
    if (!this.data.newGroupSeasonLabel.trim()) {
      this.setData({ actionError: '请填写训练组年份或周期。' });
      return;
    }
    this.setData({ actionError: '' });
    try {
      await api.createTrainingGroup({
        name: this.data.newGroupName,
        seasonLabel: this.data.newGroupSeasonLabel
      });
      this.setData({ newGroupName: '' });
      wx.showToast({ title: '训练组已创建', icon: 'success' });
      await this.loadGroups();
    } catch (error) {
      this.setData({ actionError: error.message || '训练组创建失败。' });
    }
  },

  async toggleGroupStatus(event) {
    const groupId = event.currentTarget.dataset.groupId;
    const enabled = event.currentTarget.dataset.enabled === 'true';
    if (!groupId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: enabled ? '确认启用训练组' : '确认停用训练组',
        content: enabled
          ? '启用后学生可重新申请该训练组。'
          : '停用后该训练组不再接受新的学生申请，已有数据不会被删除。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    try {
      await api.setTrainingGroupEnabled({ trainingGroupId: groupId, enabled });
      await this.loadGroups();
    } catch (error) {
      this.setData({ actionError: error.message || '训练组状态更新失败。' });
    }
  },

  onCoachChange(event) {
    this.setData({ coachIndex: Number(event.detail.value) });
  },

  onGroupChange(event) {
    this.setData({ groupIndex: Number(event.detail.value) });
  },

  async assignCoach(event) {
    const active = event.currentTarget.dataset.active === 'true';
    const coach = this.data.coachOptions[this.data.coachIndex];
    const group = this.data.groupOptions[this.data.groupIndex];
    if (!coach || !group) {
      this.setData({ actionError: '请先准备至少一个教练员账号和一个训练组。' });
      return;
    }
    this.setData({ actionError: '' });
    try {
      await api.setGroupCoach({
        coachUserId: coach.userId,
        trainingGroupId: group.id,
        active
      });
      await this.loadGroups();
    } catch (error) {
      this.setData({ actionError: error.message || '教练范围设置失败。' });
    }
  },

  goStudentProfile(event) {
    const userId = event.currentTarget.dataset.userId;
    if (!userId) {
      return;
    }
    wx.navigateTo({ url: `/pages/profile-view/profile-view?userId=${userId}` });
  },

  /* DEMO 预览入口：仅开发/预览环境可用，正式发布环境自动隐藏，不参与任何正式统计 */
  goDemoReport() {
    if (!this.data.demoAvailable) {
      return;
    }
    wx.navigateTo({ url: '/pages/student-report/student-report?demo=1' });
  },

  async goHome() {
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '退出当前会话',
        content: '退出后需要重新进行微信登录。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
