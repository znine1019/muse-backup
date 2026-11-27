'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');
const { formatPerformanceValue } = require('../../utils/performance-format');

const SOURCE_LABELS = Object.freeze({
  student_report: '学生申报',
  coach_entry: '教练录入',
  import: '系统导入'
});

Page({
  data: {
    loading: true,
    error: '',
    performances: [],
    pendingCount: 0,
    truncated: false,
    reviewingId: '',
    drawerItem: null,
    flashId: ''
  },

  onHide() {
    this.clearFlashTimer();
  },

  onUnload() {
    this.clearFlashTimer();
  },

  clearFlashTimer() {
    if (this._flashTimer) {
      if (typeof clearTimeout === 'function') {
        clearTimeout(this._flashTimer);
      }
      this._flashTimer = null;
    }
  },

  onOpenDrawer(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    const found = (this.data.performances || []).find((item) => item.id === id) || null;
    if (!found) {
      return;
    }
    this.setData({ drawerItem: found });
  },

  onCloseDrawer() {
    this.setData({ drawerItem: null });
  },

  noop() {},

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({
      loading: true,
      error: '',
      performances: [],
      pendingCount: 0,
      truncated: false
    });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'coach') && !sessionHasRole(session, 'developer')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }

      const result = await api.listPendingPerformances();
      this.setData({
        loading: false,
        performances: (result.performances || []).map((item) => ({
          ...item,
          valueText: formatPerformanceValue(item.value, item.unit),
          sourceLabel: SOURCE_LABELS[item.source] || item.source || '未知来源',
          groupText: (item.trainingGroupNames || []).join('、')
        })),
        pendingCount: Number(result.pendingCount) || 0,
        truncated: Boolean(result.truncated)
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '待审核成绩加载失败。'
      });
    }
  },

  async review(event) {
    const performanceId = event.currentTarget.dataset.performanceId;
    const decision = event.currentTarget.dataset.decision;
    if (!performanceId || this.data.reviewingId) {
      return;
    }

    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: decision === 'approve' ? '确认通过成绩' : '填写驳回原因',
        content:
          decision === 'approve'
            ? '通过后该成绩计入正式成绩和PB统计。'
            : '',
        editable: decision === 'reject',
        placeholderText: '请填写驳回原因',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }

    const comment = String(modal.content || '').trim();
    if (decision === 'reject' && !comment) {
      this.setData({ error: '驳回时必须填写审核意见。' });
      return;
    }

    this.setData({ reviewingId: performanceId, error: '' });
    try {
      await api.reviewPerformance({ performanceId, decision, comment });
      wx.showToast({
        title: decision === 'approve' ? '已通过' : '已驳回',
        icon: 'success'
      });
      this.setData({ drawerItem: null, flashId: performanceId });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '成绩审核失败，请重试。' });
    } finally {
      this.setData({ reviewingId: '' });
    }
  },

  retry() {
    this.loadPage();
  },

  goHome() {
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
