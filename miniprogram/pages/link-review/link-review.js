'use strict';

const api = require('../../services/api');
const { getSessionDestination, sessionHasRole } = require('../../utils/session');

Page({
  data: {
    loading: true,
    error: '',
    links: [],
    busyId: ''
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
      if (!sessionHasRole(session, 'developer')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const result = await api.listPendingLinks();
      this.setData({ loading: false, links: result.links || [] });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '待核验关联加载失败。' });
    } finally {
      if (options.fromPullDown) {
        wx.stopPullDownRefresh();
      }
    }
  },

  async review(event) {
    const linkId = event.currentTarget.dataset.linkId;
    const decision = event.currentTarget.dataset.decision;
    if (!linkId || this.data.busyId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: decision === 'approve' ? '确认核验通过' : '填写驳回原因',
        content:
          decision === 'approve'
            ? '核验通过后，该家长可以查看已授权关联学生的训练数据（只读）。请确认监护关系已通过线下核验。'
            : '',
        editable: decision === 'reject',
        placeholderText: '可填写核验说明',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    this.setData({ busyId: linkId });
    try {
      await api.reviewParentLink({ linkId, decision, comment: modal.content || '' });
      wx.showToast({ title: '已处理', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '核验失败。' });
    } finally {
      this.setData({ busyId: '' });
    }
  },

  retry() {
    this.loadPage();
  }
});
