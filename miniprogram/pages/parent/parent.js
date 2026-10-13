'use strict';

const api = require('../../services/api');
const { getSessionDestination, sessionHasRole } = require('../../utils/session');

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
    noticeRows: []
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
      this.setData({ students });
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

  async loadOverview(studentUserId) {
    this.setData({ loading: true, error: '' });
    try {
      const overview = await api.getParentStudentOverview({ studentUserId });
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
    } catch (error) {
      this.setData({ loading: false, error: error.message || '学生数据加载失败。' });
    }
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

  goHome() {
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  },

  retry() {
    this.loadPage();
  }
});
