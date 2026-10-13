'use strict';

const api = require('../../services/api');
const { getSessionDestination, sessionHasRole } = require('../../utils/session');

const STATUS_LABELS = Object.freeze({
  pending_student: '待本人确认',
  pending_review: '等待俱乐部核验',
  active: '已生效',
  rejected: '已驳回',
  revoked: '已解除'
});

function localRequestId() {
  return `link_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

Page({
  data: {
    loading: true,
    generating: false,
    error: '',
    code: '',
    expiresText: '',
    links: [],
    busyLinkId: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'student')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const result = await api.listMyParentLinks();
      this.setData({
        loading: false,
        links: (result.asStudent || []).map((link) => ({
          ...link,
          statusLabel: STATUS_LABELS[link.status] || link.status
        }))
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '关联信息加载失败。' });
    }
  },

  async createInvite() {
    if (this.data.generating) {
      return;
    }
    this.setData({ generating: true, error: '' });
    try {
      const result = await api.createParentInvite({ clientRequestId: localRequestId() });
      const expires = new Date(result.expiresAt);
      const pad = (value) => String(value).padStart(2, '0');
      this.setData({
        code: result.code,
        expiresText: `${pad(expires.getHours())}:${pad(expires.getMinutes())}`
      });
      wx.showToast({ title: '凭证已生成', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '凭证生成失败。' });
    } finally {
      this.setData({ generating: false });
    }
  },

  copyCode() {
    if (!this.data.code) {
      return;
    }
    wx.setClipboardData({ data: this.data.code });
  },

  async decide(event) {
    const linkId = event.currentTarget.dataset.linkId;
    const decision = event.currentTarget.dataset.decision;
    if (!linkId || this.data.busyLinkId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: decision === 'confirm' ? '确认关联' : '拒绝关联',
        content:
          decision === 'confirm'
            ? '确认后仍需俱乐部核验，核验通过后家长才能查看您的训练数据。'
            : '拒绝后该家长无法查看您的数据。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    this.setData({ busyLinkId: linkId });
    try {
      await api.studentDecideLink({ linkId, decision });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '处理失败。' });
    } finally {
      this.setData({ busyLinkId: '' });
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
        content: '解除后家长将立即无法查看您的数据。',
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
  }
});
