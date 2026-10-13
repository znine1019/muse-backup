'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  getRoleLabel,
  sessionHasRole
} = require('../../utils/session');

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

/* 常用管理入口：全部指向现有真实页面 */
/* 常用管理入口全部指向现有真实页面（阶段1—阶段6 已注册路由），本页不新增任何路由 */

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

function formatMetric(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return `${value || ''} ${unit || ''}`.trim();
  }
  return `${number} ${unit || ''}`.trim();
}

function settle(promise) {
  return promise.then(
    (data) => ({ ok: true, data }),
    (error) => ({ ok: false, error })
  );
}

Page({
  data: {
    loading: true,
    sessionError: '',
    headMeta: '',
    todayDate: todayIso(),

    todayState: { loading: true, error: '' },
    todaySessions: [],
    focusSession: null,
    rosterState: { loading: false, error: '' },
    rosterSummary: null,

    todoState: { loading: true, error: '' },
    todoItems: [],
    todoFilter: 'all',
    todoFilterChips: [],
    todoVisible: [],
    todoFilters: TODO_FILTERS,
    todoCounts: { all: 0, leave: 0, score: 0, feedback: 0 },
    todoTotal: 0,

    registrationState: { loading: true, error: '' },
    registrations: [],
    reviewingUserId: '',

    competitionState: { loading: true, error: '' },
    competitionText: ''
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
      todayState: { loading: true, error: '' },
      todoState: { loading: true, error: '' },
      registrationState: { loading: true, error: '' },
      competitionState: { loading: true, error: '' }
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

    if (!sessionHasRole(session, 'coach') && !sessionHasRole(session, 'developer')) {
      wx.reLaunch({ url: getSessionDestination(session).url });
      return;
    }

    const isDeveloper = sessionHasRole(session, 'developer');
    this.setData({
      loading: false,
      headMeta: `${getRoleLabel(isDeveloper ? 'developer' : 'coach')} · 负责训练组范围内的待办与考勤`
    });

    /* 现有只读接口并行加载，各区块独立渲染、独立重试 */
    await Promise.all([
      this.loadTodaySessions(),
      this.loadTodos(),
      this.loadRegistrations(),
      this.loadCompetitions()
    ]);

    if (fromPullDown) {
      wx.stopPullDownRefresh();
    }
  },

  async loadTodaySessions() {
    this.setData({ 'todayState.loading': true, 'todayState.error': '' });
    const date = todayIso();
    const result = await settle(api.listManageAttendanceSessions({ date }));
    if (!result.ok) {
      this.setData({
        'todayState.loading': false,
        'todayState.error': result.error.message || '今日考勤加载失败。'
      });
      return;
    }
    const sessions = (result.data.sessions || []).map((item) => ({
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
    const decorated = sessions.map((item) => ({
      ...item,
      isFocus: Boolean(focus && item.sessionId === focus.sessionId)
    }));
    this.setData({
      'todayState.loading': false,
      'todayState.error': '',
      todayDate: date,
      todaySessions: decorated,
      focusSession: focus,
      rosterSummary: null,
      'rosterState.error': ''
    });
    if (focus) {
      await this.loadRoster(focus.sessionId);
    }
  },

  async loadRoster(sessionId) {
    this.setData({ 'rosterState.loading': true, 'rosterState.error': '' });
    const result = await settle(api.getAttendanceRoster(sessionId));
    if (!result.ok) {
      this.setData({
        'rosterState.loading': false,
        'rosterState.error': result.error.message || '考勤名单统计加载失败。'
      });
      return;
    }
    const summary = result.data.summary || {};
    this.setData({
      'rosterState.loading': false,
      'rosterState.error': '',
      rosterSummary: {
        expected: Number(summary.expected) || 0,
        checkedIn: Number(summary.checkedIn) || 0,
        late: Number(summary.late) || 0,
        leaveApproved: Number(summary.leaveApproved) || 0,
        pendingVerification: Number(summary.pendingVerification) || 0,
        pending: Number(summary.pending) || 0
      }
    });
  },

  async loadTodos() {
    this.setData({ 'todoState.loading': true, 'todoState.error': '' });
    const [leaveResult, performanceResult, feedbackResult] = await Promise.all([
      settle(api.listPendingLeaves()),
      settle(api.listPendingPerformances()),
      settle(api.listManagedFeedback({ needsAttention: true }))
    ]);

    const failures = [leaveResult, performanceResult, feedbackResult].filter(
      (item) => !item.ok
    );
    if (failures.length === 3) {
      this.setData({
        'todoState.loading': false,
        'todoState.error': failures[0].error.message || '待办加载失败。'
      });
      return;
    }

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
          detail: `${leave.attendanceDate || ''} ${LEAVE_STATUS_LABELS[leave.status] || ''} · ${leave.trainingGroupName || '未标注训练组'}`,
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
          detail: `${item.eventName || ''} ${formatMetric(item.value, item.unit)} · ${(item.trainingGroupNames || []).join('、') || '未标注训练组'}`,
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
          detail: `${item.attendanceDate || ''} · ${COMPLETION_LABELS[item.completionStatus] || ''} · RPE ${item.rpe || '-'}/10`,
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

    this.setData({
      'todoState.loading': false,
      'todoState.error': '',
      todoItems: items,
      todoTotal: items.length,
      todoCounts: counts,
      todoFilterChips: TODO_FILTERS.map((filter) => ({
        value: filter.value,
        label: filter.label,
        count: counts[filter.value] || 0,
        text: `${filter.label} ${counts[filter.value] || 0}`
      })),
      todoFilter: 'all'
    });
    this.applyTodoFilter('all');
  },

  applyTodoFilter(filter) {
    const source = this.data.todoItems || [];
    const filtered = filter === 'all'
      ? source
      : source.filter((item) => item.cat === filter);
    this.setData({ todoFilter: filter, todoVisible: filtered.slice(0, 6) });
  },

  onTodoFilterTap(event) {
    const value = event.currentTarget.dataset.value;
    if (!value) {
      return;
    }
    this.applyTodoFilter(value);
  },

  async loadRegistrations() {
    this.setData({ 'registrationState.loading': true, 'registrationState.error': '' });
    const result = await settle(api.listPendingRegistrations());
    if (!result.ok) {
      this.setData({
        'registrationState.loading': false,
        'registrationState.error': result.error.message || '待审核注册加载失败。'
      });
      return;
    }
    this.setData({
      'registrationState.loading': false,
      'registrationState.error': '',
      registrations: result.data.registrations || []
    });
  },

  async loadCompetitions() {
    this.setData({ 'competitionState.loading': true, 'competitionState.error': '' });
    const result = await settle(api.listManageCompetitions({}));
    if (!result.ok) {
      this.setData({
        'competitionState.loading': false,
        'competitionState.error': result.error.message || '赛事信息加载失败。'
      });
      return;
    }
    const competitions = result.data.competitions || [];
    const openList = competitions.filter(
      (item) => item.status === 'published' && item.phase === 'open'
    );
    const activeStudents = openList.reduce(
      (total, item) => total + (Number(item.activeStudentCount) || 0),
      0
    );
    this.setData({
      'competitionState.loading': false,
      'competitionState.error': '',
      competitionText: openList.length
        ? `报名中 ${openList.length} 场 · 已登记意向 ${activeStudents} 人次`
        : '当前没有开放报名的赛事'
    });
  },

  retryToday() {
    this.loadTodaySessions();
  },

  retryTodos() {
    this.loadTodos();
  },

  retryRegistrations() {
    this.loadRegistrations();
  },

  retryCompetitions() {
    this.loadCompetitions();
  },

  /* 待办行：跳转到对应业务页面处理，工作台不做无确认的真实写入 */
  onTodoTap(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) {
      return;
    }
    wx.navigateTo({ url });
  },

  goAttendanceManage() {
    wx.navigateTo({ url: '/pages/attendance-manage/attendance-manage' });
  },

  goSessionRoster() {
    wx.navigateTo({ url: '/pages/attendance-manage/attendance-manage' });
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/coach-plan-list/coach-plan-list' });
  },

  goPerformanceReview() {
    wx.navigateTo({ url: '/pages/coach-performance-review/coach-performance-review' });
  },

  goStatsWorkbench() {
    wx.navigateTo({ url: '/pages/stats-workbench/stats-workbench' });
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

  /* 待审核注册：保留原有二次确认与驳回意见，不做单点写入 */
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

    this.setData({ reviewingUserId: userId });
    try {
      await api.reviewRegistration({
        targetUserId: userId,
        decision,
        comment: modal.content || ''
      });
      wx.showToast({ title: '已处理', icon: 'success' });
      await this.loadRegistrations();
    } catch (error) {
      this.setData({ 'registrationState.error': error.message || '审核失败。' });
    } finally {
      this.setData({ reviewingUserId: '' });
    }
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
