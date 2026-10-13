'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

Page({
  data: {
    loading: true,
    error: '',
    registrations: [],
    reviewingUserId: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'coach')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }

      const result = await api.listPendingRegistrations();
      this.setData({
        loading: false,
        registrations: result.registrations || []
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '待审核注册列表加载失败。'
      });
    }
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
        content: decision === 'approve' ? '通过后该学生将获得学生角色并可访问本人数据。' : '',
        editable: decision === 'reject',
        placeholderText: '可填写审核意见',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }

    this.setData({ reviewingUserId: userId, error: '' });
    try {
      await api.reviewRegistration({
        targetUserId: userId,
        decision,
        comment: modal.content || ''
      });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '审核失败。' });
    } finally {
      this.setData({ reviewingUserId: '' });
    }
  },

  goAttendanceManage() {
    wx.navigateTo({ url: '/pages/attendance-manage/attendance-manage' });
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

  goPlans() {
    wx.navigateTo({ url: '/pages/coach-plan-list/coach-plan-list' });
  },

  goPerformanceReview() {
    wx.navigateTo({
      url: '/pages/coach-performance-review/coach-performance-review'
    });
  },

  goHome() {
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
