'use strict';

const api = require('../../services/api');
const { getSessionDestination, sessionHasRole } = require('../../utils/session');
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

const COMPLETION_LABELS = Object.freeze({
  completed: '全部完成',
  partial: '部分完成',
  not_completed: '未完成'
});

const COMPETITION_LABELS = Object.freeze({
  submitted: '已提交意向',
  processing: '教练处理中',
  registered: '教练已代报',
  failed: '未完成',
  cancelled: '已取消'
});

/* 页内跳转锚点：与 parent.wxml 的 id="sec-*" 一一对应 */
const JUMP_SECTIONS = Object.freeze([
  { key: 'overview', label: '学生概览' },
  { key: 'plans', label: '训练计划' },
  { key: 'performance', label: '成绩' },
  { key: 'attendance', label: '考勤' },
  { key: 'feedback', label: '反馈' },
  { key: 'events', label: '赛事通知' },
  { key: 'account', label: '个人中心' }
]);

const JUMP_KEYS = JUMP_SECTIONS.map((item) => item.key);

function itemRequirementText(item) {
  const parts = [];
  if (item.sets) {
    parts.push(`${item.sets} 组`);
  }
  if (item.reps) {
    parts.push(`${item.reps} 次`);
  }
  if (item.distanceMeters) {
    parts.push(`${item.distanceMeters} 米`);
  }
  if (item.restSeconds) {
    parts.push(`恢复 ${item.restSeconds} 秒`);
  }
  return parts.join(' · ');
}

function decoratePlan(plan, planIndex) {
  const items = (plan.items || []).map((item, itemIndex) => ({
    ...item,
    key: `${plan.planId || planIndex}_${itemIndex + 1}`,
    requirementText: itemRequirementText(item)
  }));
  const itemCount = Number(plan.itemCount) || items.length;
  return {
    ...plan,
    items,
    hasTruncatedItems: itemCount > items.length
  };
}

Page({
  data: {
    loading: true,
    error: '',
    students: [],
    studentIndex: 0,
    overview: null,
    planItems: [],
    performanceRows: [],
    attendanceRows: [],
    feedbackRows: [],
    competitionRows: [],
    noticeRows: [],
    expandedPlanId: '',
    jumpItems: [],
    activeSection: '',
    scrollIntoView: '',
    uiDaylight: false,
    scopeRevealing: false,
    attendanceRatePercent: 0,
    attendanceRateText: '—',
    dockItems: [
      { key: 'overview', label: '概览' },
      { key: 'plans', label: '计划' },
      { key: 'performance', label: '成绩' },
      { key: 'attendance', label: '考勤' },
      { key: 'bind', label: '关联' }
    ]
  },

  /* 支持从「全部功能」目录以 ?section=plans 直接定位到对应分区 */
  onLoad(options = {}) {
    const section = options.section || '';
    if (JUMP_KEYS.includes(section)) {
      this.pendingSection = section;
    }
  },

  onShow() {
    this.loadPage();
  },

  onHide() {
    this.clearUiTimers();
  },

  onUnload() {
    this.clearUiTimers();
  },

  clearUiTimers() {
    if (this._revealTimer) {
      if (typeof clearTimeout === 'function') {
        clearTimeout(this._revealTimer);
      }
      this._revealTimer = null;
    }
  },

  onToggleDaylight() {
    this.setData({ uiDaylight: !this.data.uiDaylight });
  },

  onDockSelect(event) {
    const key = event && event.detail && event.detail.key;
    if (key === 'bind') {
      this.goBind();
      return;
    }
    if (JUMP_KEYS.includes(key)) {
      this.setData({ activeSection: key });
      this.scrollToSection(key);
    }
  },

  onPullDownRefresh() {
    this.loadPage({ fromPullDown: true });
  },

  async loadPage(options = {}) {
    this.clearStudentData();
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'parent')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      persistActiveRole('parent', session);
      const result = await api.listParentStudents();
      const students = result.students || [];
      /* 有学生时展示分区跳转；无学生时跳转无目标，故不展示 */
      this.setData({ students, jumpItems: students.length ? JUMP_SECTIONS : [] });
      if (!students.length) {
        this.clearStudentData();
        this.setData({ loading: false, jumpItems: [] });
        return;
      }
      const index = Math.min(this.data.studentIndex, students.length - 1);
      this.setData({ studentIndex: index });
      await this.loadOverview(students[index].studentUserId);
    } catch (error) {
      this.setData({ loading: false, error: error.message || '家长工作台加载失败。' });
    } finally {
      if (options.fromPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  clearStudentData() {
    this.setData({
      overview: null,
      planItems: [],
      performanceRows: [],
      attendanceRows: [],
      feedbackRows: [],
      competitionRows: [],
      noticeRows: [],
      expandedPlanId: ''
    });
  },

  applyOverview(overview) {
    const plans = (overview.plans || []).map(decoratePlan);
    const expandedPlanId = plans.some((plan) => plan.planId === this.data.expandedPlanId)
      ? this.data.expandedPlanId
      : '';
    const att = overview.attendance || {};
    const expected = Number(att.actualExpected) || 0;
    const valid = Number(att.validAttendance) || 0;
    const attendanceRatePercent = expected > 0 ? Math.min(100, Math.round((valid / expected) * 100)) : 0;
    this.setData({
      loading: false,
      error: '',
      overview,
      attendanceRatePercent,
      attendanceRateText: expected > 0 ? `${attendanceRatePercent}%` : '—',
      planItems: plans,
      performanceRows: ((overview.performance && overview.performance.personalBests) || []).map(
        (item) => ({
          ...item,
          valueText: formatPerformanceValue(item.value, item.unit)
        })
      ),
      attendanceRows: (overview.attendance && overview.attendance.rows) || [],
      feedbackRows: ((overview.feedback && overview.feedback.rows) || []).map((item) => ({
        ...item,
        completionLabel: COMPLETION_LABELS[item.completionStatus] || item.completionStatus
      })),
      competitionRows: (overview.competitions || []).map((item) => ({
        ...item,
        statusLabel: COMPETITION_LABELS[item.status] || item.status
      })),
      noticeRows: overview.notices || [],
      expandedPlanId
    });
  },

  async loadOverview(studentUserId) {
    const requestId = (this.overviewRequestId || 0) + 1;
    this.overviewRequestId = requestId;
    this.clearStudentData();
    this.setData({ loading: true, error: '' });
    try {
      const overview = await api.getParentStudentOverview({ studentUserId });
      if (requestId !== this.overviewRequestId) {
        return;
      }
      this.applyOverview(overview);
      this.consumePendingSection();
    } catch (error) {
      if (requestId !== this.overviewRequestId) {
        return;
      }
      this.setData({ loading: false, error: error.message || '学生数据加载失败。' });
    }
  },

  /* 分类页以 ?section=plan 进入时，数据到位后再定位分区 */
  consumePendingSection() {
    const section = this.pendingSection;
    if (!section) {
      return;
    }
    this.pendingSection = '';
    this.setData({ activeSection: section });
    this.scrollToSection(section);
  },

  /* 页内分区跳转：先清空再赋值，保证连续点击同一分区仍会触发滚动 */
  scrollToSection(section) {
    this.setData({ scrollIntoView: '' }, () => {
      this.setData({ scrollIntoView: `sec-${section}` });
    });
  },

  onJumpTap(event) {
    const section = event.currentTarget.dataset.section;
    if (!JUMP_KEYS.includes(section)) {
      return;
    }
    this.setData({ activeSection: section });
    this.scrollToSection(section);
  },

  togglePlanDetail(event) {
    const planId = event.currentTarget.dataset.planId;
    if (!planId) {
      return;
    }
    this.setData({
      expandedPlanId: this.data.expandedPlanId === planId ? '' : planId
    });
  },

  onStudentChange(event) {
    const index = Number(event.detail.value);
    const student = this.data.students[index];
    if (!student) {
      return;
    }
    this.clearUiTimers();
    this.setData({ studentIndex: index, expandedPlanId: '', scopeRevealing: true });
    if (typeof setTimeout === 'function') {
      this._revealTimer = setTimeout(() => {
        this._revealTimer = null;
        this.setData({ scopeRevealing: false });
      }, 240);
    } else {
      this.setData({ scopeRevealing: false });
    }
    this.loadOverview(student.studentUserId);
  },

  goBind() {
    wx.navigateTo({ url: '/pages/parent-bind/parent-bind' });
  },

  /* V1.6 阶段8：进入按业务分类的全部功能目录（只做导航，家长端仍为只读） */
  goAllFeatures() {
    wx.navigateTo({ url: '/pages/all-features/all-features' });
  },

  goHome() {
    clearActiveRole();
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  },

  retry() {
    this.loadPage();
  }
});
