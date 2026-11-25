'use strict';

const api = require('../../services/api');
const { getSessionDestination } = require('../../utils/session');

const RELATION_OPTIONS = Object.freeze([
  { value: 'father', label: '父亲' },
  { value: 'mother', label: '母亲' },
  { value: 'guardian', label: '其他监护人' },
  { value: 'other', label: '其他' }
]);

Page({
  data: {
    loading: true,
    submitting: false,
    error: '',
    formError: '',
    relationOptions: RELATION_OPTIONS,
    relationIndex: 2,
    name: '',
    note: '',
    statusLabel: '',
    profile: null
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (session.user.status === 'active' && (session.user.roles || []).includes('parent')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const result = await api.getParentProfile();
      const profile = result.profile || null;
      this.setData({
        loading: false,
        profile,
        name: profile ? profile.name : this.data.name,
        note: profile ? profile.note : this.data.note,
        relationIndex: profile
          ? Math.max(0, RELATION_OPTIONS.findIndex((item) => item.value === profile.relation))
          : this.data.relationIndex,
        statusLabel:
          profile && profile.reviewStatus === 'pending'
            ? '资料已提交，等待开发者审核'
            : profile && profile.reviewStatus === 'rejected'
              ? `审核未通过${profile.reviewComment ? '：' + profile.reviewComment : ''}`
              : ''
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '家长资料加载失败。' });
    }
  },

  onNameInput(event) {
    this.setData({ name: event.detail.value });
  },

  onNoteInput(event) {
    this.setData({ note: event.detail.value });
  },

  onRelationChange(event) {
    this.setData({ relationIndex: Number(event.detail.value) });
  },

  async submit() {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.name.trim()) {
      this.setData({ formError: '请填写家长本人真实姓名，请勿填写孩子的姓名。' });
      return;
    }
    this.setData({ submitting: true, error: '', formError: '' });
    try {
      await api.submitParentProfile({
        name: this.data.name.trim(),
        relation: RELATION_OPTIONS[this.data.relationIndex].value,
        note: this.data.note.trim()
      });
      wx.showToast({ title: '已提交，等待审核', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ formError: error.message || '提交失败，请稍后重试。' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goHome() {
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
