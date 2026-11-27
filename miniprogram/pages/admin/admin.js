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

const {
  clearActiveRole,
  saveActiveRole
} = require('../../utils/active-role');

function persistActiveRole(role, session) {
  const user = (session && session.user) || {};
  if (typeof saveActiveRole !== 'function' || !user.id) {
    return;
  }
  saveActiveRole(role, {
    userId: user.id,
    roles: Array.isArray(user.roles) ? user.roles : []
  });
}

const ROLE_OPTIONS = Object.freeze(['student', 'coach', 'developer']);

const USER_NAME_FILTERS = Object.freeze([
  { value: 'all', label: '全部实名状态' },
  { value: 'named', label: '有姓名' }
]);

const USER_ROLE_FILTERS = Object.freeze([
  { value: 'all', label: '全部角色' },
  { value: 'student', label: '学生' },
  { value: 'coach', label: '教练' },
  { value: 'parent', label: '家长' },
  { value: 'developer', label: '开发者' }
]);

const USER_STATUS_FILTERS = Object.freeze([
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '已启用' },
  { value: 'pending_profile', label: '待完善资料' },
  { value: 'pending_review', label: '待审核' },
  { value: 'rejected', label: '审核未通过' },
  { value: 'disabled', label: '已停用' }
]);

const USER_TIME_FILTERS = Object.freeze([
  { value: 'all', label: '全部时间' },
  { value: '7', label: '最近7天' },
  { value: '30', label: '最近30天' }
]);

const REVIEW_STATUS_LABELS = Object.freeze({
  pending: '待审核',
  approved: '已通过',
  rejected: '未通过'
});

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

function formatDeletionImpact(impact) {
  const counts = (impact && impact.associationCounts) || {};
  const labels = [
    ['registrationReviews', '注册审核'],
    ['roleBindings', '角色绑定'],
    ['groupMemberships', '训练组成员'],
    ['performanceRecords', '成绩'],
    ['attendanceRecords', '考勤'],
    ['leaveRequests', '请假'],
    ['trainingPlans', '训练计划'],
    ['trainingFeedback', '训练反馈'],
    ['competitions', '赛事'],
    ['parentLinks', '亲子关系']
  ];
  const parts = labels
    .filter(([field]) => Number(counts[field]) > 0)
    .map(([field, label]) => `${label}${counts[field]}条`);
  return parts.length ? parts.join('、') : '无业务关联';
}

function formatGroupDeletionImpact(impact) {
  const counts = (impact && impact.associationCounts) || {};
  const labels = [
    ['groupMemberships', '成员'],
    ['studentProfileRequests', '学生申请'],
    ['trainingPlans', '训练计划'],
    ['performanceRecords', '成绩'],
    ['attendanceSessions', '考勤场次'],
    ['attendanceRecords', '考勤记录'],
    ['trainingFeedback', '训练反馈'],
    ['competitions', '赛事'],
    ['notices', '通知']
  ];
  const parts = labels
    .filter(([field]) => Number(counts[field]) > 0)
    .map(([field, label]) => `${label}${counts[field]}条`);
  return parts.length ? parts.join('、') : '无业务关联';
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

    userFilters: {
      nameStatus: 'all',
      role: 'all',
      status: 'all',
      time: 'all'
    },
    userNameFilters: USER_NAME_FILTERS,
    userRoleFilters: USER_ROLE_FILTERS,
    userStatusFilters: USER_STATUS_FILTERS,
    userTimeFilters: USER_TIME_FILTERS,
    userFilterIndexes: { nameStatus: 0, role: 0, status: 0, time: 0 },
    allUsers: [],

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
    deletingUserId: '',
    deletingGroupId: '',
    actionError: '',
    demoAvailable: false,
    canSwitchCoach: false,
    uiDaylight: false,
    deckIndex: 0,
    deckTabs: [
      { key: 'status', idx: '01', label: '状态' },
      { key: 'approval', idx: '02', label: '审批' },
      { key: 'account', idx: '03', label: '账号' },
      { key: 'group', idx: '04', label: '训练组' }
    ],
    drawerOpen: false,
    drawerKind: '',
    drawerData: null,
    flashKey: ''
  },

  onHide() {
    this.clearFlashTimer();
  },

  onUnload() {
    this.clearFlashTimer();
  },

  clearFlashTimer() {
    if (this._flashTimer) {
      if (typeof clearTimeout === 'function') {
        clearTimeout(this._flashTimer);
      }
      this._flashTimer = null;
    }
  },

  triggerRowFlash(key) {
    this.clearFlashTimer();
    this.controllerSetIfChanged({ flashKey: key || '' });
    if (typeof setTimeout === 'function') {
      this._flashTimer = setTimeout(() => {
        this._flashTimer = null;
        this.controllerSetIfChanged({ flashKey: '' });
      }, 360);
    }
  },

  onShow() {
    this.expandedUserIds = new Set();
    this.syncAuthorizationExpansion();
    this.activateDeveloperRole();
    this.enterWorkbench();
  },

  activateDeveloperRole() {
    try {
      const session = getApp().globalData.session;
      if (sessionHasRole(session, 'developer')) {
        persistActiveRole('developer', session);
      }
    } catch (error) {
      /* 会话尚未恢复时由 runLoad 的 ensureSession 继续校验 */
    }
  },

  ensureExpandedUserIds() {
    if (!(this.expandedUserIds instanceof Set)) {
      this.expandedUserIds = new Set();
    }
    return this.expandedUserIds;
  },

  decorateAuthorizationState(user) {
    const expandedUserIds = this.ensureExpandedUserIds();
    return {
      ...user,
      isAuthorizationExpanded: expandedUserIds.has(user.userId)
    };
  },

  syncAuthorizationExpansion() {
    const allUsers = (this.data.allUsers || []).map((user) =>
      this.decorateAuthorizationState(user)
    );
    const users = (this.data.users || []).map((user) =>
      this.decorateAuthorizationState(user)
    );
    if (allUsers.length || users.length) {
      this.controllerSetIfChanged({ allUsers, users });
    }
  },

  toggleAuthorization(event) {
    const userId = String(
      (event && event.currentTarget && event.currentTarget.dataset &&
        event.currentTarget.dataset.userId) || ''
    ).trim();
    if (!userId) {
      return;
    }
    const expandedUserIds = this.ensureExpandedUserIds();
    if (expandedUserIds.has(userId)) {
      expandedUserIds.delete(userId);
    } else {
      expandedUserIds.add(userId);
    }
    const allUsers = (this.data.allUsers || []).map((user) =>
      this.decorateAuthorizationState(user)
    );
    const users = (this.data.users || []).map((user) =>
      this.decorateAuthorizationState(user)
    );
    this.controllerSetIfChanged({ allUsers, users });
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

    persistActiveRole('developer', session);
    this.controllerSetIfChanged({
      demoAvailable: isDemoAllowed(),
      canSwitchCoach: sessionHasRole(session, 'coach'),
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
    this.expandedUserIds = new Set();
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
      allUsers: [],
      groups: [],
      coachOptions: [],
      groupOptions: [],
      showUserPanel: false,
      showGroupPanel: false,
      canSwitchCoach: false,
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
        const allUsers = (result.users || []).map((user) => {
          const roles = user.roles || [];
          return {
            ...user,
            isAuthorizationExpanded: this.ensureExpandedUserIds().has(user.userId),
            statusLabel: getStatusLabel(user.status),
            statusActionLabel: user.status === 'disabled' ? '启用账号' : '停用账号',
            statusActionValue: user.status === 'disabled' ? 'active' : 'disabled',
            rolesText: roles.map((role) => getRoleLabel(role)).join('、') || '未授权',
            hasCoachRole: roles.includes('coach'),
            applicationRoleText: user.applicationRole
              ? getRoleLabel(user.applicationRole)
              : '未申请',
            reviewStatusText: user.reviewStatus
              ? REVIEW_STATUS_LABELS[user.reviewStatus] || user.reviewStatus
              : '无实名资料',
            createdAtText: formatServerTime(user.createdAt),
            identityHintText: user.identityHint || '账号尾号未知',
            canDeleteAccount: !roles.includes('developer'),
            canViewProfile: user.status === 'active' && roles.includes('student'),
            roleActions: ROLE_OPTIONS.filter((role) => {
              if (role !== 'coach' || roles.includes('coach')) {
                return true;
              }
              return user.coachProfileApproved === true;
            }).map((role) => ({
              role,
              label: getRoleLabel(role),
              active: roles.includes(role),
              actionLabel: roles.includes(role) ? '撤销' : '授予',
              grantValue: roles.includes(role) ? 'false' : 'true'
            }))
          };
        });
        const filteredUsers = this.filterUsers(allUsers, this.data.userFilters);
        this.controllerSetIfChanged({
          allUsers,
          users: filteredUsers,
          coachOptions: allUsers
            .filter((user) => (user.roles || []).includes('coach'))
            .map((user) => ({ userId: user.userId, label: user.displayName })),
          accountSummary: {
            total: allUsers.length,
            students: allUsers.filter((user) => (user.roles || []).includes('student')).length,
            coaches: allUsers.filter((user) => (user.roles || []).includes('coach')).length,
            developers: allUsers.filter((user) => (user.roles || []).includes('developer')).length,
            disabled: allUsers.filter((user) => user.status === 'disabled').length,
            pendingReview: (this.data.registrations || []).length
          }
        });
      }
    );
  },

  filterUsers(users, filters = {}) {
    const now = Date.now();
    const days = filters.time === '7' || filters.time === '30' ? Number(filters.time) : 0;
    return users.filter((user) => {
      if (filters.nameStatus === 'named' && user.hasRealName !== true) {
        return false;
      }
      if (
        filters.role &&
        filters.role !== 'all' &&
        !(user.roles || []).includes(filters.role) &&
        user.applicationRole !== filters.role
      ) {
        return false;
      }
      if (
        filters.status &&
        filters.status !== 'all' &&
        user.status !== filters.status
      ) {
        return false;
      }
      if (days > 0) {
        const created = new Date(user.createdAt || 0).getTime();
        if (!created || now - created > days * 24 * 60 * 60 * 1000) {
          return false;
        }
      }
      return true;
    });
  },

  onUserFilterChange(event) {
    const field = event.currentTarget.dataset.filter;
    const index = Number(event.detail.value);
    const options = {
      nameStatus: this.data.userNameFilters,
      role: this.data.userRoleFilters,
      status: this.data.userStatusFilters,
      time: this.data.userTimeFilters
    };
    const selected = (options[field] || [])[index];
    if (!selected) {
      return;
    }
    const filters = { ...this.data.userFilters, [field]: selected.value };
    const indexes = { ...this.data.userFilterIndexes, [field]: index };
    this.controllerSetIfChanged({
      userFilters: filters,
      userFilterIndexes: indexes,
      users: this.filterUsers(this.data.allUsers || [], filters)
    });
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
          canDeleteGroup: true,
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

  /* Developer+Coach 仅切换展示身份；无 coach 时进入实名申请，不在客户端授予角色。 */
  /* V1.6 阶段8：进入按业务分类的全部功能目录（只做导航，不写入数据） */
  goAllFeatures() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/all-features/all-features' });
  },

  goCoachWorkbench() {
    if (!this.data.canSwitchCoach) {
      return;
    }
    try {
      const session = getApp().globalData.session;
      if (!sessionHasRole(session, 'coach')) {
        return;
      }
      persistActiveRole('coach', session);
    } catch (error) {
      return;
    }
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/coach/coach' });
  },

  goCoachRegistration() {
    if (this.data.canSwitchCoach) {
      this.goCoachWorkbench();
      return;
    }
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/coach-register/coach-register' });
  },

  goPerformanceReview() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/coach-performance-review/coach-performance-review' });
  },

  goAttendanceManage() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/attendance-manage/attendance-manage' });
  },

  /* V1.6 家长关联核验：进入页面只读取待核验列表，不自动修改任何申请状态 */
  goLinkReview() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/link-review/link-review' });
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

  /* 学生端 / 家长端 DEMO 预览：同样仅开发/预览环境可用，页面内再做一次环境与身份校验 */
  goDemoStudent() {
    this.openDemo('student');
  },

  goDemoParent() {
    this.openDemo('parent');
  },

  openDemo(role) {
    if (!this.data.demoAvailable) {
      return;
    }
    wx.navigateTo({ url: `/pages/demo/demo?role=${role}` });
  },

  /* V1.6.5 界面试穿入口：沿用同套开发/体验版 + 真实开发者守卫，正式环境隐藏 */
  goUiPreview() {
    if (!this.data.demoAvailable) {
      return;
    }
    wx.navigateTo({ url: '/pages/ui-preview/ui-preview' });
  },

  async review(event) {
    const userId = event.currentTarget.dataset.userId;
    const decision = event.currentTarget.dataset.decision;
    /* 注册类型：student（默认，保持既有兼容）或 parent */
    const profileType = event.currentTarget.dataset.profileType || 'student';
    if (!userId || this.data.reviewingUserId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: decision === 'approve' ? '确认通过注册' : '填写驳回原因',
        content:
          decision === 'approve'
            ? profileType === 'coach'
              ? '通过后教练实名资料生效；新教练获得教练角色，历史教练保持原权限。'
              : profileType === 'parent'
                ? '通过后家长角色由服务端正式授权，但不会自动获得学生数据。'
                : '通过后学生角色由服务端正式授权。'
            : '',
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
        profileType,
        comment: modal.content || ''
      });
      wx.showToast({ title: '已处理', icon: 'success' });
      this.onCloseDrawer();
      this.triggerRowFlash(userId);
      await this.loadRegistrations();
      await this.loadUsers();
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

  async deleteUserAccount(event) {
    const userId = event.currentTarget.dataset.userId;
    if (!userId || this.data.deletingUserId) {
      return;
    }
    this.controllerSetIfChanged({ deletingUserId: userId, actionError: '' });
    try {
      const result = await api.getUserDeletionImpact(userId);
      const impact = result.impact || {};
      if (impact.protectedDeveloper || impact.deleted) {
        await new Promise((resolve) => {
          wx.showModal({
            title: impact.deleted ? '账号已经删除' : '开发者账号受保护',
            content: impact.deleted
              ? '该账号已处于删除状态，不能重复删除。'
              : '不能删除任何具有有效开发者权限的账号。',
            showCancel: false,
            success: resolve,
            fail: resolve
          });
        });
        return;
      }
      const impactText = formatDeletionImpact(impact);
      const firstConfirm = await new Promise((resolve) => {
        wx.showModal({
          title: '检查账号关联后删除',
          content: `${impact.identityHint || '账号尾号未知'}。\n${impactText}。\n账号将逻辑删除、撤销有效权限并退出正常账号列表，历史业务记录保留。`,
          confirmText: '继续删除',
          confirmColor: '#B42318',
          success: resolve,
          fail: () => resolve({ confirm: false })
        });
      });
      if (!firstConfirm.confirm) {
        return;
      }
      const secondConfirm = await new Promise((resolve) => {
        wx.showModal({
          title: '二次确认删除账号',
          content: '请输入“删除账号”后确认。',
          editable: true,
          placeholderText: '删除账号',
          confirmText: '确认删除',
          confirmColor: '#B42318',
          success: resolve,
          fail: () => resolve({ confirm: false })
        });
      });
      if (!secondConfirm.confirm) {
        return;
      }
      if (String(secondConfirm.content || '').trim() !== '删除账号') {
        throw new Error('二次确认文字不正确，未执行删除。');
      }
      await api.deleteUser({
        targetUserId: userId,
        confirmationText: 'DELETE_ACCOUNT',
        acknowledgeAssociations: impact.requiresAcknowledgement === true
      });
      wx.showToast({ title: '账号已删除', icon: 'success' });
      await this.loadUsers();
      await this.loadGroups();
      this.decorateGroupCoachNames();
      this.markNeedsRefresh();
    } catch (error) {
      this.controllerSetIfChanged({ actionError: error.message || '账号删除失败。' });
    } finally {
      this.controllerSetIfChanged({ deletingUserId: '' });
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

  async deleteTrainingGroup(event) {
    const groupId = event.currentTarget.dataset.groupId;
    if (!groupId || this.data.deletingGroupId) {
      return;
    }
    this.controllerSetIfChanged({ deletingGroupId: groupId, actionError: '' });
    try {
      const result = await api.getTrainingGroupDeletionImpact(groupId);
      const impact = result.impact || {};
      const impactText = formatGroupDeletionImpact(impact);
      if (!impact.canDelete || impact.deleted) {
        await new Promise((resolve) => {
          wx.showModal({
            title: impact.deleted ? '训练组已经删除' : '训练组存在业务关联',
            content: impact.deleted
              ? '该训练组已归档，不能重复删除。'
              : `${impactText}。请先保留或人工处理相关数据。`,
            showCancel: false,
            success: resolve,
            fail: resolve
          });
        });
        return;
      }
      const firstConfirm = await new Promise((resolve) => {
        wx.showModal({
          title: '检查训练组关联后删除',
          content: `${impact.name || '当前训练组'}（${impact.seasonLabel || '未标注'}）。\n${impactText}。\n删除后训练组将归档，不再出现在正常选择与统计中。`,
          confirmText: '继续删除',
          confirmColor: '#B42318',
          success: resolve,
          fail: () => resolve({ confirm: false })
        });
      });
      if (!firstConfirm.confirm) {
        return;
      }
      const secondConfirm = await new Promise((resolve) => {
        wx.showModal({
          title: '二次确认删除训练组',
          content: '请输入“删除训练组”后确认。',
          editable: true,
          placeholderText: '删除训练组',
          confirmText: '确认删除',
          confirmColor: '#B42318',
          success: resolve,
          fail: () => resolve({ confirm: false })
        });
      });
      if (!secondConfirm.confirm) {
        return;
      }
      if (String(secondConfirm.content || '').trim() !== '删除训练组') {
        throw new Error('二次确认文字不正确，未执行删除。');
      }
      await api.deleteTrainingGroup({
        trainingGroupId: groupId,
        confirmationText: 'DELETE_TRAINING_GROUP'
      });
      wx.showToast({ title: '训练组已删除', icon: 'success' });
      await this.loadGroups();
      this.decorateGroupCoachNames();
      this.markNeedsRefresh();
    } catch (error) {
      this.controllerSetIfChanged({ actionError: error.message || '训练组删除失败。' });
    } finally {
      this.controllerSetIfChanged({ deletingGroupId: '' });
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

  onToggleDaylight() {
    this.controllerSetIfChanged({ uiDaylight: !this.data.uiDaylight });
  },

  onDeckChange(event) {
    const current = Number(event && event.detail && event.detail.current);
    if (Number.isFinite(current) && current !== this.data.deckIndex) {
      this.controllerSetIfChanged({ deckIndex: current, drawerOpen: false, drawerKind: '', drawerData: null });
    }
  },

  onDeckTabSelect(event) {
    const index = Number(event && event.detail && event.detail.index);
    if (Number.isFinite(index) && index !== this.data.deckIndex) {
      this.controllerSetIfChanged({ deckIndex: index, drawerOpen: false, drawerKind: '', drawerData: null });
    }
  },

  onOpenRegDrawer(event) {
    const userId = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.userId;
    const found = (this.data.registrations || []).find((item) => item.userId === userId);
    if (!found) {
      return;
    }
    this.controllerSetIfChanged({ drawerOpen: true, drawerKind: 'reg', drawerData: found });
  },

  onOpenFilterDrawer() {
    this.controllerSetIfChanged({ drawerOpen: true, drawerKind: 'filter', drawerData: { open: true } });
  },

  onOpenGroupDrawer() {
    this.controllerSetIfChanged({ drawerOpen: true, drawerKind: 'group', drawerData: { open: true } });
  },

  onCloseDrawer() {
    this.controllerSetIfChanged({ drawerOpen: false, drawerKind: '', drawerData: null });
  },

  noop() {},

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
    clearActiveRole();
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
