'use strict';

const api = require('../../services/api');
const { getSessionDestination, sessionHasRole } = require('../../utils/session');
const { clearActiveRole } = require('../../utils/active-role');

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
    jumpItems: [],
    activeSection: '',
    scrollIntoView: ''
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

  onPullDownRefresh() {
    this.loadPage({ fromPullDown: true });
  },

  async loadPage(options = {}) {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'parent')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const result = await api.listParentStudents();
      const students = result.students || [];
      /* 有学生时展示分区跳转；无学生时跳转无目标，故不展示 */
      this.setData({ students, jumpItems: students.length ? JUMP_SECTIONS : [] });
      if (!students.length) {
        this.setData({ loading: false, overview: null });
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

  /* 共享的数据写入逻辑：首次加载与重试都复用，重试不会清空已加载内容 */
  applyOverview(overview) {
    this.setData({
        loading: false,
        overview,
        planItems: overview.plans || [],
        performanceRows: (overview.performance && overview.performance.personalBests) || [],
        attendanceRows: (overview.attendance && overview.attendance.rows) || [],
        feedbackRows: ((overview.feedback && overview.feedback.rows) || []).map((item) => ({
          ...item,
          completionLabel: COMPLETION_LABELS[item.completionStatus] || item.completionStatus
        })),
        competitionRows: (overview.competitions || []).map((item) => ({
          ...item,
          statusLabel: COMPETITION_LABELS[item.status] || item.status
        })),
        noticeRows: overview.notices || []
    });
  },

  async loadOverview(studentUserId) {
    this.setData({ loading: true, error: '' });
    try {
      const overview = await api.getParentStudentOverview({ studentUserId });
      this.applyOverview(overview);
    } catch (error) {
      this.setData({ loading: false, error: error.message || '学生数据加载失败。' });
    }
    this.consumePendingSection();
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

  onStudentChange(event) {
    const index = Number(event.detail.value);
    const student = this.data.students[index];
    if (!student) {
      return;
    }
    this.setData({ studentIndex: index });
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
