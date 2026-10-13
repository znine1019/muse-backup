'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  getStatusLabel,
  sessionHasRole
} = require('../../utils/session');
const {
  createWorkbenchController,
  formatClock,
  isPermissionLostError
} = require('../../utils/workbench-controller');

const { clearActiveRole } = require('../../utils/active-role');

const GENDER_LABELS = Object.freeze({
  male: '男',
  female: '女',
  unspecified: '未说明'
});

const ATTENDANCE_STATUS_LABELS = Object.freeze({
  not_started: '未到签到时间',
  pending: '待签到',
  checked_in: '已签到',
  late: '迟到',
  leave_approved: '已批准请假',
  pending_verification: '待核实',
  absent: '未签到',
  cancelled: '已取消'
});

const ATTENDANCE_PHASE_LABELS = Object.freeze({
  not_started: '未开始',
  open: '签到中',
  closed: '已结束',
  cancelled: '已取消'
});

/* 区块 → 页面状态字段映射（用于统一的加载/错误状态更新） */
const SECTION_STATE_KEYS = Object.freeze({
  profile: 'profileState',
  today: 'todayState',
  stats: 'statsState',
  notice: 'noticeState'
});

function todayIso() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function percentText(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  return `${Math.round(number * 10000) / 100}%`;
}

function formatMetric(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return `${value || ''} ${unit || ''}`.trim();
  }
  if (unit === '秒' && number >= 60) {
    const minutes = Math.floor(number / 60);
    const seconds = Math.round((number % 60) * 100) / 100;
    return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  }
  return `${number} ${unit || ''}`.trim();
}

function shortDate(value) {
  if (!value) {
    return '';
  }
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : text;
}

Page({
  data: {
    /* 工作台刷新状态（阶段7-2 修复返回闪烁） */
    hasData: false,
    refreshing: false,
    lastUpdatedText: '',
    staleNotice: '',

    sessionError: '',
    headMeta: '',
    headName: '',
    headEvent: '',
    headGroup: '',
    statusLabel: '',

    profileState: { loading: true, error: '', ready: false },
    profile: null,
    genderLabel: '',

    todayState: { loading: true, error: '', ready: false },
    todayDate: '',
    todaySessions: [],

    statsState: { loading: true, error: '', ready: false },
    stats: null,

    noticeState: { loading: true, error: '', ready: false },
    notices: [],
    unreadCount: 0,
    noticeMeta: '',
    noticeActionText: '查看全部'
  },

  onShow() {
    this.enterWorkbench();
  },

  onPullDownRefresh() {
    this.pullDownRefresh();
  },

  /* 首次进入显示骨架屏；已加载过则保留内容并静默刷新 */
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

  /* 进入可能改变待办数据的业务页面前调用，返回时强制刷新 */
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

  /* 兼容既有单元测试与首次调用：loadPage 等价于一次完整加载 */
  loadPage(options = {}) {
    return this.loadAll({
      silent: options.silent === true,
      force: true,
      fromPullDown: options.fromPullDown === true
    });
  },

  /* 合并并发：同一时刻只允许一次完整加载 */
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

    /* 身份（用户 + 角色 + 状态）变化时立即清空旧数据 */
    if (!controller.syncIdentity(session)) {
      this.clearCachedData();
    }

    if (!sessionHasRole(session, 'student')) {
      this.handlePermissionLost(
        Object.assign(new Error('当前账号不能访问学生工作台。'), { code: 'FORBIDDEN' })
      );
      if (fromPullDown) {
        wx.stopPullDownRefresh();
      }
      return;
    }

    if (!silent) {
      this.setSectionsLoading(true);
    }
    this.controllerSetIfChanged({ refreshing: true, sessionError: '', staleNotice: '' });

    await Promise.all([
      this.loadProfile(),
      this.loadTodayAttendance(),
      this.loadStatistics(),
      this.loadNotices()
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

  /* 权限失效：先清空敏感数据，再按会话回到正确入口 */
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

  /* 清空页面上的敏感数据（保留骨架屏状态，避免展示越权/过期数据） */
  clearCachedData() {
    this.controllerSetIfChanged({
      hasData: false,
      lastUpdatedText: '',
      staleNotice: '',
      profile: null,
      genderLabel: '',
      statusLabel: '',
      headMeta: '',
      headName: '',
      headEvent: '',
      headGroup: '',
      todaySessions: [],
      todayDate: '',
      stats: null,
      notices: [],
      unreadCount: 0,
      noticeMeta: '',
      noticeActionText: '查看全部',
      profileState: { loading: true, error: '', ready: false },
      todayState: { loading: true, error: '', ready: false },
      statsState: { loading: true, error: '', ready: false },
      noticeState: { loading: true, error: '', ready: false }
    });
  },

  async loadSection(name, factory, apply) {
    const controller = this.getController();
    const result = await controller.run(name, factory);
    if (!result) {
      return; /* 已被更新的请求取代，丢弃结果 */
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

  loadProfile() {
    return this.loadSection('profile', () => api.getProfile(), (result) => {
      const profile = result.profile || null;
      const primaryEvent = profile
        ? profile.primaryEventName || profile.primaryTrainingProject || ''
        : '';
      this.controllerSetIfChanged({
        profile,
        genderLabel: profile ? GENDER_LABELS[profile.gender] || '未说明' : '',
        statusLabel: getStatusLabel(result.userStatus),
        headName: profile ? profile.name || '' : '',
        headEvent: primaryEvent
      });
      this.refreshHead();
    });
  },

  loadTodayAttendance() {
    return this.loadSection(
      'today',
      () => api.getStudentTodayAttendance(),
      (result) => {
        const sessions = (result.sessions || []).map((item) => {
          const session = item.session || {};
          return {
            sessionId: session.sessionId,
            title: session.title || session.locationName || '训练场次',
            locationName: session.locationName || '',
            trainingGroupName: session.trainingGroupName || '',
            checkInOpenTime: session.checkInOpenTime || '',
            checkInCloseTime: session.checkInCloseTime || '',
            status: item.status,
            statusLabel: ATTENDANCE_STATUS_LABELS[item.status] || item.status,
            phaseLabel: ATTENDANCE_PHASE_LABELS[session.phase] || session.phase || '',
            canCheckIn: item.status === 'pending',
            isDone: item.status === 'checked_in' || item.status === 'late'
          };
        });
        this.controllerSetIfChanged({
          todayDate: result.date || todayIso(),
          todaySessions: sessions
        });
      }
    );
  },

  loadStatistics() {
    const now = new Date();
    return this.loadSection(
      'stats',
      () =>
        api.getMyStatistics({
          periodType: 'month',
          year: now.getFullYear(),
          month: now.getMonth() + 1
        }),
      (payload) => this.applyStatistics(payload)
    );
  },

  applyStatistics(payload) {
    const attendance = payload.attendance || {};
    const performance = payload.performance || {};
    const personalBests = performance.personalBests || [];
    const best = personalBests[0] || null;
    const target = performance.targetComparison || null;
    const rateText = percentText(attendance.attendanceRate);
    const isLongTime = Boolean(best && best.unit === '秒' && Number(best.value) >= 60);

    this.controllerSetIfChanged({
      stats: {
        periodLabel: (payload.period || {}).label || '',
        attendanceRateText: rateText,
        attendanceRatePercent: Number.isFinite(Number(attendance.attendanceRate))
          ? Math.min(100, Math.round(Number(attendance.attendanceRate) * 100))
          : 0,
        validAttendance: Number(attendance.validAttendance) || 0,
        actualExpected: Number(attendance.actualExpected) || 0,
        late: Number(attendance.late) || 0,
        absent: Number(attendance.absent) || 0,
        pendingVerification: Number(attendance.pendingVerification) || 0,
        approvedCount: Number(performance.approvedCount) || 0,
        hasPb: Boolean(best),
        pbEventName: best ? best.eventName : '',
        pbValueText: best ? formatMetric(best.value, best.unit) : '',
        pbRawValue: best ? (isLongTime ? formatMetric(best.value, best.unit) : best.value) : '',
        pbUnit: best && !isLongTime ? best.unit : '',
        pbDate: best ? shortDate(best.date || best.achievedAt) : '',
        targetEventName: target ? target.eventName : '',
        targetText:
          target && target.hasCurrentResult
            ? formatMetric(target.currentValue, target.unit)
            : '',
        targetValueText: target ? formatMetric(target.targetValue, target.unit) : '',
        targetAchieved: Boolean(target && target.achieved),
        changes: (performance.stageChanges || []).slice(0, 3).map((item) => ({
          eventName: item.eventName,
          fromText: formatMetric(item.firstValue, item.unit),
          toText: formatMetric(item.latestValue, item.unit),
          changeText: `${item.change > 0 ? '+' : ''}${item.change} ${item.unit || ''}`.trim(),
          improved: Number(item.change) > 0,
          date: shortDate(item.latestDate),
          metaText: `${formatMetric(item.firstValue, item.unit)} → ${formatMetric(
            item.latestValue,
            item.unit
          )}${item.latestDate ? ` · ${shortDate(item.latestDate)}` : ''}`
        })),
        changesTotal: (performance.stageChanges || []).length,
        dataQualityNote: (payload.dataQuality || {}).membershipHistoryNote || ''
      },
      headEvent: (payload.profile || {}).primaryEventName || this.data.headEvent,
      headGroup: ((payload.groups || [])[0] || {}).name || ''
    });
    this.refreshHead();
  },

  loadNotices() {
    return this.loadSection(
      'notice',
      () => api.listStudentNotices({}),
      (result) => {
        const notices = (result.notices || []).slice(0, 3).map((notice) => ({
          noticeId: notice.noticeId,
          title: notice.title,
          content: notice.content,
          isImportant: notice.priority === 'important',
          isRead: Boolean(notice.isRead),
          categoryLabel: notice.categoryLabel || '',
          timeText: shortDate(notice.publishedAt)
        }));
        const unreadCount = Number(result.unreadCount) || 0;
        this.controllerSetIfChanged({
          notices,
          unreadCount,
          noticeMeta: unreadCount ? `未读 ${unreadCount} 条` : '全部已读',
          noticeActionText: unreadCount ? `查看全部（${unreadCount}）` : '查看全部'
        });
      }
    );
  },

  refreshHead() {
    const meta = [this.data.headName, this.data.headEvent, this.data.headGroup]
      .filter(Boolean)
      .join(' · ');
    if (meta !== this.data.headMeta) {
      this.controllerSetIfChanged({ headMeta: meta });
    }
  },

  retryProfile() {
    return this.loadAll({ silent: true, force: true });
  },

  retryToday() {
    return this.loadAll({ silent: true, force: true });
  },

  retryStats() {
    return this.loadAll({ silent: true, force: true });
  },

  retryNotices() {
    return this.loadAll({ silent: true, force: true });
  },

  /* 跳转前标记需要刷新：审批/申报等业务完成后返回工作台会强制静默刷新 */
  goPlans() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/student-plans/student-plans' });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/student-report/student-report' });
  },

  goPerformance() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/performance/performance' });
  },

  goStatistics() {
    wx.navigateTo({ url: '/pages/student-statistics/student-statistics' });
  },

  goPerformanceLeaderboard() {
    wx.navigateTo({ url: '/pages/performance-leaderboard/performance-leaderboard' });
  },

  goAttendanceStatistics() {
    wx.navigateTo({ url: '/pages/attendance-statistics/attendance-statistics' });
  },

  goAttendance() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/student-attendance/student-attendance' });
  },

  goCompetitions() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/student-competitions/student-competitions' });
  },

  goNotices() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/student-notices/student-notices' });
  },

  goFeedback() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/student-feedback/student-feedback' });
  },

  goEditProfile() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' });
  },

  /* V1.6 家长关联：生成一次性凭证并确认家长关联申请 */
  goLinkManage() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/link-manage/link-manage' });
  },

  /* V1.6 阶段8：进入按业务分类的全部功能目录（只做导航，不写入数据） */
  goAllFeatures() {
    this.markNeedsRefresh();
    wx.navigateTo({ url: '/pages/all-features/all-features' });
  },

  async goHome() {
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '退出当前会话',
        content: '退出后需要重新进行微信登录，校内数据不会删除。',
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
