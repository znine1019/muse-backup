'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const COMPLETION_LABELS = Object.freeze({
  completed: '全部完成',
  partial: '部分完成',
  not_completed: '未完成'
});

function formatDateTime(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function decorateFeedback(feedback) {
  return {
    ...feedback,
    completionLabel:
      COMPLETION_LABELS[feedback.completionStatus] || feedback.completionStatus,
    rpeText: `RPE ${feedback.rpe}/10`,
    commentTimeText: formatDateTime(feedback.updatedAt || feedback.createdAt)
  };
}

Page({
  data: {
    loading: true,
    error: '',
    feedback: [],
    attentionCount: 0,
    attentionOnly: false,
    busyId: '',
    reviewingId: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      const canManage =
        sessionHasRole(session, 'coach') ||
        sessionHasRole(session, 'developer');
      if (!canManage) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const result = await api.listManagedFeedback({
        needsAttention: this.data.attentionOnly || undefined
      });
      this.setData({
        loading: false,
        feedback: (result.feedback || []).map(decorateFeedback),
        attentionCount: Number(result.attentionCount) || 0
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '训练反馈加载失败。'
      });
    }
  },

  onAttentionToggle(event) {
    this.setData({ attentionOnly: event.detail.value === true }, () => {
      this.loadPage();
    });
  },

  async review(event) {
    const feedbackId = event.currentTarget.dataset.feedbackId;
    const version = Number(event.currentTarget.dataset.version) || 0;
    if (!feedbackId || this.data.reviewingId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '填写教练评价',
        content: '',
        editable: true,
        placeholderText: '评价将展示给学生，限500字',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    const comment = String(modal.content || '').trim();
    if (!comment) {
      this.setData({ error: '教练评价不能为空。' });
      return;
    }
    this.setData({ reviewingId: feedbackId, error: '' });
    try {
      await api.reviewFeedback({
        feedbackId,
        expectedCoachCommentVersion: version,
        comment
      });
      wx.showToast({ title: '评价已保存', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '训练反馈评价失败。' });
    } finally {
      this.setData({ reviewingId: '' });
    }
  },

  retry() {
    this.loadPage();
  }
});
