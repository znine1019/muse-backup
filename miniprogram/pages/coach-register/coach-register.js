'use strict';

const api = require('../../services/api');
const { getSessionDestination } = require('../../utils/session');

Page({
  data: {
    loading: true,
    submitting: false,
    error: '',
    formError: '',
    name: '',
    identityNote: '',
    statusLabel: '',
    profile: null,
    isActiveCoach: false,
    canSubmit: true
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      const result = await api.getCoachProfile();
      const profile = result.profile || null;
      const isActiveCoach =
        session.user.status === 'active' &&
        (session.user.roles || []).includes('coach');
      const statusLabel = !profile
        ? ''
        : profile.reviewStatus === 'pending'
          ? '实名资料已提交，等待开发者审核'
          : profile.reviewStatus === 'rejected'
            ? `审核未通过${profile.reviewComment ? '：' + profile.reviewComment : ''}`
            : profile.reviewStatus === 'approved'
              ? '实名资料已通过审核'
              : '';
      const canSubmit = !profile || profile.reviewStatus === 'rejected';

      this.setData({
        loading: false,
        profile,
        isActiveCoach,
        canSubmit,
        name: profile ? profile.name : this.data.name,
        identityNote: profile ? profile.identityNote : this.data.identityNote,
        statusLabel
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '教练资料加载失败。'
      });
    }
  },

  onNameInput(event) {
    this.setData({ name: event.detail.value });
  },

  onIdentityNoteInput(event) {
    this.setData({ identityNote: event.detail.value });
  },

  async submit() {
    if (this.data.submitting) {
      return;
    }
    const name = this.data.name.trim();
    if (!name) {
      this.setData({ formError: '请填写教练员本人真实姓名。' });
      return;
    }

    this.setData({ submitting: true, error: '', formError: '' });
    try {
      await api.submitCoachProfile({
        name,
        identityNote: this.data.identityNote.trim()
      });
      wx.showToast({ title: '已提交，等待审核', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ formError: error.message || '提交失败，请稍后重试。' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goWorkbench() {
    const session = getApp().globalData.session;
    wx.reLaunch({ url: getSessionDestination(session).url });
  },

  goHome() {
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
