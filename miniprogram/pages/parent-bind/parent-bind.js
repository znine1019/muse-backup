'use strict';

const api = require('../../services/api');
const { getSessionDestination, sessionHasRole } = require('../../utils/session');

const STATUS_LABELS = Object.freeze({
  pending_student: '等待学生确认',
  pending_review: '等待俱乐部核验',
  active: '已生效',
  rejected: '已驳回',
  revoked: '已解除'
});

Page({
  data: {
    loading: true,
    submitting: false,
    error: '',
    code: '',
    links: [],
    parentProfile: null
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'parent')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const result = await api.listMyParentLinks();
      this.setData({
        loading: false,
        parentProfile: result.parentProfile || null,
        links: (result.asParent || []).map((link) => ({
          ...link,
          statusLabel: STATUS_LABELS[link.status] || link.status
        }))
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '关联信息加载失败。' });
    }
  },

  onCodeInput(event) {
    this.setData({ code: event.detail.value });
  },

  async redeem() {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.code.trim()) {
      this.setData({ error: '请输入学生提供的关联凭证。' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      await api.redeemParentInvite({ code: this.data.code.trim() });
      wx.showToast({ title: '已提交，等待确认', icon: 'success' });
      this.setData({ code: '' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '关联申请失败。' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async revoke(event) {
    const linkId = event.currentTarget.dataset.linkId;
    if (!linkId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '解除关联',
        content: '解除后将立即无法查看该学生的数据，可重新申请。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    try {
      await api.revokeParentLink({ linkId });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '解除关联失败。' });
    }
  },

  retry() {
    this.loadPage();
  }
});
