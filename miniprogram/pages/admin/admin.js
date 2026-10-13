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
const {
  createWorkbenchController,
  formatClock,
  isPermissionLostError
} = require('../../utils/workbench-controller');

const ROLE_OPTIONS = Object.freeze(['student', 'coach', 'developer']);

const SECTION_STATE_KEYS = Object.freeze({
  system: 'systemState',
  account: 'accountState',
  group: 'groupState',
  registration: 'registrationState',
  pending: 'pendingState'
});

function settleOf(invoke) {
  try {
    const result = invoke();
    return Promise.resolve(result).then(
      (data) => ({ ok: true, data }),
      (error) => ({ ok: false, error })
    );
  } catch (error) {
    return Promise.resolve({ ok: false, error });
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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    hasData: false,
    refreshing: false,
    lastUpdatedText: '',
    staleNotice: '',

    sessionError: '',
    headMeta: '',

    systemState: { loading: true, error: '', ready: false },
    system: null,

    accountState: { loading: true, error: '', ready: false },
    accountSummary: {
      total: 0,
      students: 0,
      coaches: 0,
      developers: 0,
      disabled: 0,
      pendingReview: 0
    },

    groupState: { loading: true, error: '', ready: false },
    groupSummary: { total: 0, enabled: 0, coaches: 0 },

    registrationState: { loading: true, error: '', ready: false },
    registrations: [],
    reviewingUserId: '',

    pendingState: { loading: true, error: '', ready: false },
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
    this.enterWorkbench();
  },

  onPullDownRefresh() {
    this.pullDownRefresh();
  },

  async enterWorkbench() {
    const controller = this.getController();
    const hasData = this.data.hasData === true;
    const needsRefresh = this.pendingRefresh === true;

    if (hasData && !controller.shouldAutoRefresh({ needsRefresh })) {
      this.controllerSetIfChanged({ refreshing: false });
      return;
    }

    await this.loadAll({ silent: hasData, force: needsRefresh || !hasData });
    this.pendingRefresh = false;
  },

  pullDownRefresh() {
    return this.loadAll({ silent: true, force: true, fromPullDown: true });
  },

  markNeedsRefresh() {
    this.pendingRefresh = true;
  },

  getController() {
    if (!this.controllerInstance) {
      this.controllerInstance = createWorkbenchController(this);
    }
    return this.controllerInstance;
  },

  controllerSetIfChanged(payload) {
    return this.getController().setIfChanged(payload);
  },

  loadPage(options = {}) {
    return this.loadAll({
      silent: options.silent === true,
      force: true,
      fromPullDown: options.fromPullDown === true
    });
  },

  async loadAll(options = {}) {
    if (this.runningTask) {
      return this.runningTask;
    }
    this.runningTask = this.runLoad(options);
    try {
      return await this.runningTask;
    } finally {
      this.runningTask = null;
    }
  },

  async runLoad({ silent = false, force = false, fromPullDown = false } = {}) {
    const controller = this.getController();
    const startedAt = Date.now();
    this.okSections = [];
    this.failedSections = [];
    this.permissionLost = false;

    let session = null;
    try {
      session = await getApp().ensureSession({
        force: !this.data.hasData || controller.sessionStale()
      });
    } catch (error) {
      if (isPermissionLostError(error)) {
        this.handlePermissionLost(error);
      } else {
        this.controllerSetIfChanged({
          sessionError: error.message || '身份校验失败，请重新登录。',
          refreshing: false
        });
      }
      if (fromPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }
    controller.markSessionChecked();

    if (!controller.syncIdentity(session)) {
      this.clearCachedData();
    }

    if (!sessionHasRole(session, 'developer')) {
      this.handlePermissionLost(
        Object.assign(new Error('当前账号不能访问开发者工作台。'), { code: 'FORBIDDEN' })
      );
      if (fromPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

    this.controllerSetIfChanged({
      demoAvailable: isDemoAllowed(),
      headMeta: `${getRoleLabel('developer')} · 全局管理权限 · 敏感操作写入审计日志`
    });

    if (!silent) {
      this.setSectionsLoading(true);
    }
    this.controllerSetIfChanged({ refreshing: true, sessionError: '', staleNotice: '' });

    await Promise.all([
      this.loadSystem(),
      this.loadUsers(),
      this.loadGroups(),
      this.loadRegistrations(),
      this.loadPendingCounts()
    ]);

    /* 权限失效：本轮不再回写任何数据 */
    if (this.permissionLost) {
      if (fromPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

    /* 训练组负责教练姓名依赖账号列表，两组数据都到位后再统一回填 */
    this.decorateGroupCoachNames();

    const hasData = this.data.hasData === true || this.okSections.length > 0;
    controller.markLoaded();
    this.controllerSetIfChanged({
      hasData,
      refreshing: false,
      lastUpdatedText: `数据更新于 ${formatClock(Date.now())}`,
      staleNotice:
        hasData && this.failedSections.length
          ? '部分数据更新失败，当前显示的是上次成功加载的数据'
          : ''
    });

    this.lastPerf = {
      durationMs: Date.now() - startedAt,
      sections: 5,
      failed: this.failedSections.slice()
    };

    if (fromPullDown) {
      wx.stopPullDownRefresh();
    }
  },

  setSectionsLoading(loading) {
    for (const key of Object.values(SECTION_STATE_KEYS)) {
      const current = this.data[key] || {};
      this.controllerSetIfChanged({
        [key]: {
          loading,
          error: loading ? '' : current.error,
          ready: current.ready === true
        }
      });
    }
  },

  setSectionState(key, patch) {
    const current = this.data[key] || {};
    this.controllerSetIfChanged({ [key]: Object.assign({}, current, patch) });
  },

  handlePermissionLost(error) {
    const message = (error && error.message) || '当前账号没有访问权限。';
    this.permissionLost = true;
    this.okSections = [];
    this.failedSections = [];
    this.clearCachedData();
    this.getController().reset();
    this.controllerSetIfChanged({
      sessionError: message,
      refreshing: false,
      lastUpdatedText: '',
      staleNotice: ''
    });
    const app = getApp();
    let destination = '/pages/index/index';
    try {
      const session = app && app.globalData ? app.globalData.session : null;
      if (session) {
        destination = getSessionDestination(session).url;
      }
    } catch (error) {
      destination = '/pages/index/index';
    }
    wx.reLaunch({ url: destination });
  },

  clearCachedData() {
    this.controllerSetIfChanged({
      hasData: false,
      lastUpdatedText: '',
      staleNotice: '',
      headMeta: '',
      system: null,
      accountSummary: {
        total: 0,
        students: 0,
        coaches: 0,
        developers: 0,
        disabled: 0,
        pendingReview: 0
      },
      groupSummary: { total: 0, enabled: 0, coaches: 0 },
      registrations: [],
      pendingPerformances: 0,
      pendingLeaves: 0,
      pendingTotal: 0,
      users: [],
      groups: [],
      coachOptions: [],
      groupOptions: [],
      showUserPanel: false,
      showGroupPanel: false,
      systemState: { loading: true, error: '', ready: false },
      accountState: { loading: true, error: '', ready: false },
      groupState: { loading: true, error: '', ready: false },
      registrationState: { loading: true, error: '', ready: false },
      pendingState: { loading: true, error: '', ready: false }
    });
  },

  async loadSection(name, factory, apply) {
    const controller = this.getController();
    const result = await controller.run(name, factory);
    if (!result) {
      return;
    }
    if (this.permissionLost) {
      return;
    }
    if (!result.ok) {
      if (isPermissionLostError(result.error)) {
        this.handlePermissionLost(result.error);
        return;
      }
      this.failedSections.push(name);
      this.setSectionState(SECTION_STATE_KEYS[name], {
        loading: false,
        error: result.error.message || '数据加载失败。'
      });
      return;
    }
    this.okSections.push(name);
    apply(result.value);
    this.setSectionState(SECTION_STATE_KEYS[name], {
      loading: false,
      error: '',
      ready: true
    });
  },

  loadSystem() {
    return this.loadSection(
      'system',
      () => api.healthCheck(),
      (payload) => {
        this.controllerSetIfChanged({
          system: {
            envId: CLOUD_ENV_ID,
            cloudFunctionReady: payload.cloudFunctionReady === true,
            databaseReady: payload.databaseReady === true,
            serverTimeText: formatServerTime(payload.serverTime),
            overallText: payload.databaseReady === true ? '运行正常' : '数据库未就绪'
          }
        });
      }
    );
  },

  loadUsers() {
    return this.loadSection(
      'account',
      () => api.listUsers(),
      (result) => {
        const users = (result.users || []).map((user) => {
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
        this.controllerSetIfChanged({
          users,
          coachOptions: users
            .filter((user) => (user.roles || []).includes('coach'))
            .map((user) => ({ userId: user.userId, label: user.displayName })),
          accountSummary: {
            total: users.length,
            students: users.filter((user) => (user.roles || []).includes('student')).length,
            coaches: users.filter((user) => (user.roles || []).includes('coach')).length,
            developers: users.filter((user) => (user.roles || []).includes('developer')).length,
            disabled: users.filter((user) => user.status === 'disabled').length,
            pendingReview: (this.data.registrations || []).length
          }
        });
      }
    );
  },

  loadGroups() {
    return this.loadSection(
      'group',
      () => api.listAllTrainingGroups(),
      (result) => {
        const groups = (result.groups || []).map((group) => ({
          ...group,
          displayName: `${group.name}（${group.seasonLabel || '未标注'}）`,
          statusActionLabel: group.enabled ? '停用训练组' : '启用训练组',
          statusActionValue: group.enabled ? 'false' : 'true',
          coachNames: (group.coachUserIds || [])
            .map((userId) => this.coachNameOf(userId))
            .filter(Boolean)
            .join('、')
        }));
        this.controllerSetIfChanged({
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
      }
    );
  },

  coachNameOf(userId) {
    const found = (this.data.users || []).find((user) => user.userId === userId);
    return found ? found.displayName : '';
  },

  /* 账号与训练组是并行加载的，两组数据到位后统一回填负责教练姓名 */
  decorateGroupCoachNames() {
    const groups = this.data.groups || [];
    if (!groups.length || !(this.data.users || []).length) {
      return;
    }
    let changed = false;
    const next = groups.map((group) => {
      const names = (group.coachUserIds || [])
        .map((userId) => this.coachNameOf(userId))
        .filter(Boolean)
        .join('、');
      if (names === group.coachNames) {
        return group;
      }
      changed = true;
      return { ...group, coachNames: names };
    });
    if (changed) {
      this.controllerSetIfChanged({
        groups: next,
        groupSummary: {
          ...this.data.groupSummary,
          coaches: (this.data.coachOptions || []).length
        }
      });
    }
  },

  loadRegistrations() {
    return this.loadSection(
      'registration',
      () => api.listPendingRegistrations(),
      (result) => {
        const registrations = result.registrations || [];
        this.controllerSetIfChanged({
          registrations,
          'accountSummary.pendingReview': registrations.length
        });
        this.refreshPendingTotal();
      }
    );
  },

  loadPendingCounts() {
    return this.loadSection(
      'pending',
      async () => {
        const [performanceResult, leaveResult] = await Promise.all([
          settleOf(() => api.listPendingPerformances()),
          settleOf(() => api.listPendingLeaves())
        ]);
        if (!performanceResult.ok && !leaveResult.ok) {
          throw performanceResult.error || leaveResult.error;
        }
        const permissionError = [performanceResult, leaveResult]
          .map((item) => item.error)
          .find((error) => isPermissionLostError(error));
        if (permissionError) {
          throw permissionError;
        }
        return { performanceResult, leaveResult };
      },
      ({ performanceResult, leaveResult }) => {
        this.controllerSetIfChanged({
          pendingPerformances: performanceResult.ok
            ? Number(performanceResult.data.pendingCount) || 0
            : 0,
          pendingLeaves: leaveResult.ok
            ? Number(leaveResult.data.pendingCount) || 0
            : 0
        });
        this.refreshPendingTotal();
      }
    );
  },

  refreshPendingTotal() {
    const total =
      (Number(this.data.pendingPerformances) || 0) +
      (Number(this.data.pendingLeaves) || 0) +
      (this.data.registrations || []).length;
    if (total !== this.data.pendingTotal) {
      this.controllerSetIfChanged({ pendingTotal: total });
    }
  },

  retrySystem() {
    return this.loadAll({ silent: true, force: true });
  },

  retryAccounts() {
    return this.loadAll({ silent: true, force: true });
  },

  retryGroups() {
    return this.loadAll({ silent: true, force: true });
  },

  retryRegistrations() {
    return this.loadAll({ silent: true, force: true });
  },

  retryPending() {
    return this.loadAll({ silent: true, force: true });
  },

  toggleUserPanel() {
    this.controllerSetIfChanged({ showUserPanel: !this.data.showUserPanel });
  },

  toggleGroupPanel() {
    this.controllerSetIfChanged({ showGroupPanel: !this.data.showGroupPanel });
  },

  /* 开发者已有合法访问教练工作台的权限（云函数允许 coach/developer），无需授予 coach 角色 */
  goCoachWorkbench() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/coach/coach' });
  },

  goPerformanceReview() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/coach-performance-review/coach-performance-review' });
  },

  goAttendanceManage() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/attendance-manage/attendance-manage' });
  },

  goStatsWorkbench() {
    wx.navigateTo({ url: '/pages/stats-workbench/stats-workbench' });
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/coach-plan-list/coach-plan-list' });
  },

  goCompetitionManage() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/competition-manage/competition-manage' });
  },

  goNoticeManage() {
    wx.navigateTo({ url: '/pages/notice-manage/notice-manage' });
  },

  goFeedbackManage() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/feedback-manage/feedback-manage' });
  },

  /* DEMO 预览入口：仅开发/预览环境可用，正式发布环境自动隐藏，不参与任何正式统计 */
  goDemoReport() {
    if (!this.data.demoAvailable) {
      return;
    }
    wx.navigateTo({ url: '/pages/student-report/student-report?demo=1' });
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
    this.controllerSetIfChanged({ reviewingUserId: userId, actionError: '' });
    try {
      await api.reviewRegistration({
        targetUserId: userId,
        decision,
        comment: modal.content || ''
      });
      wx.showToast({ title: '已处理', icon: 'success' });
      await this.loadRegistrations();
      this.markNeedsRefresh();
    } catch (error) {
      this.controllerSetIfChanged({ actionError: error.message || '审核失败。' });
    } finally {
      this.controllerSetIfChanged({ reviewingUserId: '' });
    }
  },

  async toggleRole(event) {
    const userId = event.currentTarget.dataset.userId;
    const role = event.currentTarget.dataset.role;
    const grant = event.currentTarget.dataset.grant === 'true';
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: grant ? '确认授予角色' : '确认撤销角色',
        content: `${grant ? '授予' : '撤销'}${getRoleLabel(
          role
        )}角色。角色变更会影响该账号可访问的数据范围。`,
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    this.controllerSetIfChanged({ busyUserId: userId, actionError: '' });
    try {
      await api.assignRole({ targetUserId: userId, role, grant });
      await this.loadUsers();
      await this.loadGroups();
      this.decorateGroupCoachNames();
    } catch (error) {
      this.controllerSetIfChanged({ actionError: error.message || '角色操作失败。' });
    } finally {
      this.controllerSetIfChanged({ busyUserId: '' });
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
    this.controllerSetIfChanged({ busyUserId: userId, actionError: '' });
    try {
      await api.setUserStatus({ targetUserId: userId, status });
      await this.loadUsers();
    } catch (error) {
      this.controllerSetIfChanged({ actionError: error.message || '账号状态操作失败。' });
    } finally {
      this.controllerSetIfChanged({ busyUserId: '' });
    }
  },

  onNewGroupInput(event) {
    this.controllerSetIfChanged({ newGroupName: event.detail.value });
  },

  onNewGroupSeasonInput(event) {
    this.controllerSetIfChanged({ newGroupSeasonLabel: event.detail.value });
  },

  async createGroup() {
    if (!this.data.newGroupName.trim()) {
      this.controllerSetIfChanged({ actionError: '请填写训练组名称。' });
      return;
    }
    if (!this.data.newGroupSeasonLabel.trim()) {
      this.controllerSetIfChanged({ actionError: '请填写训练组年份或周期。' });
      return;
    }
    this.controllerSetIfChanged({ actionError: '' });
    try {
      await api.createTrainingGroup({
        name: this.data.newGroupName,
        seasonLabel: this.data.newGroupSeasonLabel
      });
      this.controllerSetIfChanged({ newGroupName: '' });
      wx.showToast({ title: '训练组已创建', icon: 'success' });
      await this.loadGroups();
    } catch (error) {
      this.controllerSetIfChanged({ actionError: error.message || '训练组创建失败。' });
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
      this.controllerSetIfChanged({ actionError: error.message || '训练组状态更新失败。' });
    }
  },

  onCoachChange(event) {
    this.controllerSetIfChanged({ coachIndex: Number(event.detail.value) });
  },

  onGroupChange(event) {
    this.controllerSetIfChanged({ groupIndex: Number(event.detail.value) });
  },

  async assignCoach(event) {
    const active = event.currentTarget.dataset.active === 'true';
    const coach = this.data.coachOptions[this.data.coachIndex];
    const group = this.data.groupOptions[this.data.groupIndex];
    if (!coach || !group) {
      this.controllerSetIfChanged({
        actionError: '请先准备至少一个教练员账号和一个训练组。'
      });
      return;
    }
    this.controllerSetIfChanged({ actionError: '' });
    try {
      await api.setGroupCoach({
        coachUserId: coach.userId,
        trainingGroupId: group.id,
        active
      });
      await this.loadGroups();
      this.decorateGroupCoachNames();
    } catch (error) {
      this.controllerSetIfChanged({ actionError: error.message || '教练范围设置失败。' });
    }
  },

  goStudentProfile(event) {
    const userId = event.currentTarget.dataset.userId;
    if (!userId) {
      return;
    }
    wx.navigateTo({ url: `/pages/profile-view/profile-view?userId=${userId}` });
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
    this.clearCachedData();
    this.getController().reset();
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
