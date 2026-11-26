'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  getRoleLabel,
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
const { formatPerformanceValue } = require('../../utils/performance-format');

const PHASE_LABELS = Object.freeze({
  not_started: '未开始',
  open: '签到中',
  closed: '已结束',
  cancelled: '已取消'
});

const LEAVE_STATUS_LABELS = Object.freeze({
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已撤销'
});

const SOURCE_LABELS = Object.freeze({
  student_report: '学生申报',
  coach_entry: '教练录入',
  import: '系统导入'
});

const COMPLETION_LABELS = Object.freeze({
  completed: '全部完成',
  partial: '部分完成',
  not_completed: '未完成'
});

const TODO_FILTERS = Object.freeze([
  { value: 'all', label: '全部' },
  { value: 'leave', label: '待批请假' },
  { value: 'score', label: '待审成绩' },
  { value: 'feedback', label: '需关注反馈' }
]);

const SECTION_STATE_KEYS = Object.freeze({
  today: 'todayState',
  roster: 'rosterState',
  todo: 'todoState',
  registration: 'registrationState',
  competition: 'competitionState'
});

function todayIso() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shortDate(value) {
  if (!value) {
    return '';
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : String(value);
}


Page({
  data: {
    hasData: false,
    refreshing: false,
    lastUpdatedText: '',
    staleNotice: '',

    sessionError: '',
    headMeta: '',
    canSwitchDeveloper: false,
    todayDate: todayIso(),

    todayState: { loading: true, error: '', ready: false },
    todaySessions: [],
    rosterState: { loading: true, error: '', ready: false },
    rosterSummary: null,

    todoState: { loading: true, error: '', ready: false },
    todoItems: [],
    todoFilter: 'all',
    todoFilterChips: [],
    todoVisible: [],
    todoCounts: { all: 0, leave: 0, score: 0, feedback: 0 },
    todoTotal: 0,

    registrationState: { loading: true, error: '', ready: false },
    registrations: [],
    reviewingUserId: '',

    competitionState: { loading: true, error: '', ready: false },
    competitionText: '',
    coachProfileStatus: {
      show: false,
      loading: true,
      error: '',
      notice: '',
      actionLabel: '完善实名资料'
    },
    uiDaylight: false,
    dockItems: [
      { key: 'home', label: '工作台' },
      { key: 'attendance', label: '考勤' },
      { key: 'plans', label: '计划' },
      { key: 'review', label: '审核' },
      { key: 'stats', label: '统计' }
    ]
  },

  onShow() {
    this.activateCoachRole();
    this.enterWorkbench();
  },

  activateCoachRole() {
    try {
      const session = getApp().globalData.session;
      if (sessionHasRole(session, 'coach')) {
        persistActiveRole('coach', session);
      }
    } catch (error) {
      /* 会话尚未恢复时由 runLoad 的 ensureSession 继续校验 */
    }
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

  /* 进入会改变待办数据的页面前标记，返回时强制静默刷新待办与考勤 */
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

    const canManage =
      sessionHasRole(session, 'coach');
    if (!canManage) {
      this.handlePermissionLost(
        Object.assign(new Error('当前账号不能访问教练工作台。'), { code: 'FORBIDDEN' })
      );
      if (fromPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

    persistActiveRole('coach', session);
    this.controllerSetIfChanged({
      canSwitchDeveloper: sessionHasRole(session, 'developer'),
      headMeta: `${getRoleLabel('coach')} · 负责训练组范围内的待办与考勤`
    });

    if (!silent) {
      this.setSectionsLoading(true);
    }
    this.controllerSetIfChanged({ refreshing: true, sessionError: '', staleNotice: '' });

    await Promise.all([
      this.loadTodaySessions(),
      this.loadTodos(),
      this.loadRegistrations(),
      this.loadCompetitions(),
      this.loadCoachProfileStatus(session)
    ]);

    /* 权限失效：本轮不再回写任何数据 */
    if (this.permissionLost) {
      if (fromPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

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
      sections: 4,
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
      canSwitchDeveloper: false,
      todaySessions: [],
      rosterSummary: null,
      todoItems: [],
      todoVisible: [],
      todoFilterChips: [],
      todoCounts: { all: 0, leave: 0, score: 0, feedback: 0 },
      todoTotal: 0,
      registrations: [],
      competitionText: '',
      todayState: { loading: true, error: '', ready: false },
      rosterState: { loading: true, error: '', ready: false },
      todoState: { loading: true, error: '', ready: false },
      registrationState: { loading: true, error: '', ready: false },
      competitionState: { loading: true, error: '', ready: false }
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

  async loadTodaySessions() {
    const date = todayIso();
    let focusSessionId = '';
    await this.loadSection(
      'today',
      () => api.listManageAttendanceSessions({ date }),
      (result) => {
        const sessions = (result.sessions || []).map((item) => ({
          sessionId: item.sessionId,
          title: item.title || item.locationName || '训练场次',
          locationName: item.locationName || '',
          trainingGroupName: item.trainingGroupName || '',
          attendanceDate: item.attendanceDate || date,
          checkInOpenTime: item.checkInOpenTime || '',
          checkInCloseTime: item.checkInCloseTime || '',
          lateAfterTime: item.lateAfterTime || '',
          radiusMeters: item.radiusMeters,
          phaseLabel: PHASE_LABELS[item.phase] || item.phase || '',
          isOpen: item.phase === 'open'
        }));
        const focus = sessions[0] || null;
        focusSessionId = focus ? focus.sessionId : '';
        this.controllerSetIfChanged({
          todayDate: date,
          todaySessions: sessions.map((item) => ({
            ...item,
            isFocus: Boolean(focus && item.sessionId === focus.sessionId)
          })),
          rosterSummary: focus ? this.data.rosterSummary : null
        });
      }
    );

    /* 焦点场次名单统计：依赖 sessionId，因此在考勤场次返回后再取 */
    if (focusSessionId) {
      await this.loadRoster(focusSessionId);
    }
  },

  loadRoster(sessionId) {
    return this.loadSection(
      'roster',
      () => api.getAttendanceRoster(sessionId),
      (result) => {
        const summary = result.summary || {};
        const expected = Number(summary.expected) || 0;
        const checkedIn = Number(summary.checkedIn) || 0;
        const late = Number(summary.late) || 0;
        const ratePercent = expected > 0 ? Math.min(100, Math.round(((checkedIn + late) / expected) * 100)) : 0;
        this.controllerSetIfChanged({
          rosterSummary: {
            expected,
            checkedIn,
            late,
            leaveApproved: Number(summary.leaveApproved) || 0,
            pendingVerification: Number(summary.pendingVerification) || 0,
            pending: Number(summary.pending) || 0,
            ratePercent,
            rateText: expected > 0 ? `${ratePercent}%` : '—'
          }
        });
      }
    );
  },

  loadTodos() {
    return this.loadSection(
      'todo',
      async () => {
        const [leaveResult, performanceResult, feedbackResult] = await Promise.all([
          settleOf(() => api.listPendingLeaves()),
          settleOf(() => api.listPendingPerformances()),
          settleOf(() => api.listManagedFeedback({ needsAttention: true }))
        ]);
        const failures = [leaveResult, performanceResult, feedbackResult].filter(
          (item) => !item.ok
        );
        if (failures.length === 3) {
          throw failures[0].error;
        }
        const permissionError = failures
          .map((item) => item.error)
          .find((error) => isPermissionLostError(error));
        if (permissionError) {
          throw permissionError;
        }
        return { leaveResult, performanceResult, feedbackResult };
      },
      (payload) => this.applyTodos(payload)
    );
  },

  applyTodos({ leaveResult, performanceResult, feedbackResult }) {
    const items = [];

    if (leaveResult.ok) {
      for (const leave of leaveResult.data.leaves || []) {
        items.push({
          key: `leave_${leave.leaveId}`,
          cat: 'leave',
          priority: 'p1',
          typeLabel: '待批请假',
          typeChip: 'jg-chip-danger',
          title: leave.studentName || '学生',
          detail: `${leave.attendanceDate || ''} ${
            LEAVE_STATUS_LABELS[leave.status] || ''
          } · ${leave.trainingGroupName || '未标注训练组'}`,
          reason: leave.reason || '',
          actionLabel: '去审批',
          url: '/pages/attendance-manage/attendance-manage'
        });
      }
    }

    if (performanceResult.ok) {
      for (const item of performanceResult.data.performances || []) {
        items.push({
          key: `score_${item.performanceId}`,
          cat: 'score',
          priority: 'p2',
          typeLabel: '待审成绩',
          typeChip: 'jg-chip-warn',
          title: item.studentName || '学生',
          detail: `${item.eventName || ''} ${formatPerformanceValue(item.value, item.unit)} · ${
            (item.trainingGroupNames || []).join('、') || '未标注训练组'
          }`,
          reason: `${SOURCE_LABELS[item.source] || '来源未知'} · 申报 ${shortDate(item.achievedAt)}`,
          actionLabel: '去审核',
          url: '/pages/coach-performance-review/coach-performance-review'
        });
      }
    }

    if (feedbackResult.ok) {
      for (const item of feedbackResult.data.feedback || []) {
        items.push({
          key: `feedback_${item.feedbackId}`,
          cat: 'feedback',
          priority: 'p3',
          typeLabel: '需关注反馈',
          typeChip: 'jg-chip-accent',
          title: item.studentName || '学生',
          detail: `${item.attendanceDate || ''} · ${
            COMPLETION_LABELS[item.completionStatus] || ''
          } · RPE ${item.rpe || '-'}/10`,
          reason: item.comment || '',
          actionLabel: '去评价',
          url: '/pages/feedback-manage/feedback-manage'
        });
      }
    }

    const counts = {
      all: items.length,
      leave: items.filter((item) => item.cat === 'leave').length,
      score: items.filter((item) => item.cat === 'score').length,
      feedback: items.filter((item) => item.cat === 'feedback').length
    };

    this.controllerSetIfChanged({
      todoItems: items,
      todoTotal: items.length,
      todoCounts: counts,
      todoFilterChips: TODO_FILTERS.map((filter) => ({
        value: filter.value,
        label: filter.label,
        count: counts[filter.value] || 0,
        text: `${filter.label} ${counts[filter.value] || 0}`
      }))
    });
    this.applyTodoFilter(this.data.todoFilter || 'all');
  },

  applyTodoFilter(filter) {
    const source = this.data.todoItems || [];
    const filtered = filter === 'all' ? source : source.filter((item) => item.cat === filter);
    this.controllerSetIfChanged({ todoFilter: filter, todoVisible: filtered.slice(0, 6) });
  },

  onTodoFilterTap(event) {
    const value = event.currentTarget.dataset.value;
    if (!value) {
      return;
    }
    this.applyTodoFilter(value);
  },

  loadRegistrations() {
    return this.loadSection(
      'registration',
      () => api.listPendingRegistrations(),
      (result) => {
        this.controllerSetIfChanged({ registrations: result.registrations || [] });
      }
    );
  },

  loadCompetitions() {
    return this.loadSection(
      'competition',
      () => api.listManageCompetitions({}),
      (result) => {
        const competitions = result.competitions || [];
        const openList = competitions.filter(
          (item) => item.status === 'published' && item.phase === 'open'
        );
        const activeStudents = openList.reduce(
          (total, item) => total + (Number(item.activeStudentCount) || 0),
          0
        );
        this.controllerSetIfChanged({
          competitionText: openList.length
            ? `报名中 ${openList.length} 场 · 已登记意向 ${activeStudents} 人次`
            : '当前没有开放报名的赛事'
        });
      }
    );
  },

  retryToday() {
    return this.loadAll({ silent: true, force: true });
  },

  retryTodos() {
    return this.loadAll({ silent: true, force: true });
  },

  retryRegistrations() {
    return this.loadAll({ silent: true, force: true });
  },

  retryCompetitions() {
    return this.loadAll({ silent: true, force: true });
  },

  onToggleDaylight() {
    this.controllerSetIfChanged({ uiDaylight: !this.data.uiDaylight });
  },

  onDockSelect(event) {
    const key = event && event.detail && event.detail.key;
    if (key === 'home') {
      if (typeof wx.pageScrollTo === 'function') {
        wx.pageScrollTo({ scrollTop: 0, duration: 200 });
      }
      return;
    }
    if (key === 'attendance') {
      this.goAttendanceManage();
    } else if (key === 'plans') {
      this.goPlans();
    } else if (key === 'review') {
      this.goPerformanceReview();
    } else if (key === 'stats') {
      this.goStatsWorkbench();
    }
  },

  /* 待办行只做跳转，不做写入；跳转前标记返回时刷新待办 */
  onTodoTap(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) {
      return;
    }
    this.markNeedsRefresh();
    wx.navigateTo({ url });
  },

  goAttendanceManage() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/attendance-manage/attendance-manage' });
  },

  goSessionRoster(event) {
    this.markNeedsRefresh();
    const sessionId = String(
      (event && event.currentTarget && event.currentTarget.dataset &&
        event.currentTarget.dataset.sessionId) || ''
    ).trim();
    const url = sessionId
      ? `/pages/attendance-manage/attendance-manage?sessionId=${encodeURIComponent(sessionId)}`
      : '/pages/attendance-manage/attendance-manage';
    wx.navigateTo({ url });
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/coach-plan-list/coach-plan-list' });
  },

  goPerformanceReview() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/coach-performance-review/coach-performance-review' });
  },

  goStatsWorkbench() {
    wx.navigateTo({ url: '/pages/stats-workbench/stats-workbench' });
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

  /* V1.6 阶段8：进入按业务分类的全部功能目录（只做导航，不写入数据） */
  goAllFeatures() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/all-features/all-features' });
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
        content:
          decision === 'approve'
            ? '通过后该学生将获得学生角色并可访问本人数据。'
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

    this.controllerSetIfChanged({ reviewingUserId: userId });
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
      this.setSectionState('registrationState', {
        loading: false,
        error: error.message || '审核失败。'
      });
    } finally {
      this.controllerSetIfChanged({ reviewingUserId: '' });
    }
  },

  async loadCoachProfileStatus(session) {
    if (!sessionHasRole(session, 'coach')) {
      this.controllerSetIfChanged({
        coachProfileStatus: { show: false, loading: false, error: '', notice: '', actionLabel: '完善实名资料' }
      });
      return;
    }
    try {
      const result = await api.getCoachProfile();
      const profile = result.profile || null;
      const approved = profile && profile.reviewStatus === 'approved';
      const notice = !profile
        ? '当前教练账号尚未完善实名资料，请补充真实姓名。'
        : profile.reviewStatus === 'pending'
          ? '实名资料正在等待开发者审核。'
          : profile.reviewStatus === 'rejected'
            ? `实名资料审核未通过${profile.reviewComment ? '：' + profile.reviewComment : ''}`
            : '';
      this.controllerSetIfChanged({
        coachProfileStatus: {
          show: !approved,
          loading: false,
          error: '',
          notice,
          actionLabel: profile && profile.reviewStatus === 'pending' ? '查看实名审核状态' : '完善实名资料'
        }
      });
    } catch (error) {
      this.controllerSetIfChanged({
        coachProfileStatus: {
          show: false,
          loading: false,
          error: error.message || '实名资料状态加载失败。',
          notice: '',
          actionLabel: '完善实名资料'
        }
      });
    }
  },

  goCoachProfile() {
    wx.navigateTo({ url: '/pages/coach-register/coach-register' });
  },

  switchToDeveloper() {
    if (!this.data.canSwitchDeveloper) {
      return;
    }
    try {
      const session = getApp().globalData.session;
      if (!sessionHasRole(session, 'developer')) {
        return;
      }
      persistActiveRole('developer', session);
    } catch (error) {
      return;
    }
    wx.reLaunch({ url: '/pages/admin/admin' });
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

/* 单个子请求的轻量容错包装（与 utils/workbench-controller 的语义一致，但用于同一区块内的子请求） */
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
