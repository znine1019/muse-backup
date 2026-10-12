'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const STATUS_LABELS = Object.freeze({
  pending: '待教练审核',
  approved: '已审核通过',
  rejected: '未通过'
});

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

Page({
  data: {
    loading: true,
    submitting: false,
    error: '',
    events: [],
    eventIndex: 0,
    value: '',
    achievedAt: todayIso(),
    note: '',
    performances: []
  },

  onLoad() {
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
      const [eventResult, performanceResult] = await Promise.all([
        api.listPerformanceEvents(),
        api.listMyPerformances()
      ]);
      this.setData({
        loading: false,
        events: eventResult.events || [],
        performances: (performanceResult.performances || []).map((item) => ({
          ...item,
          statusLabel: STATUS_LABELS[item.status] || item.status
        }))
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '成绩记录加载失败。'
      });
    }
  },

  onEventChange(event) {
    this.setData({ eventIndex: Number(event.detail.value) });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value });
  },

  async submitPerformance() {
    this.setData({ submitting: true, error: '' });
    const event = this.data.events[this.data.eventIndex];
    try {
      const result = await api.submitPerformance({
        eventCode: event ? event.code : '',
        value: this.data.value,
        achievedAt: this.data.achievedAt,
        note: this.data.note
      });
      wx.showToast({
        title: result.duplicate ? '已有相同记录' : '已提交审核',
        icon: result.duplicate ? 'none' : 'success'
      });
      this.setData({ value: '', note: '' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '成绩提交失败。' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
