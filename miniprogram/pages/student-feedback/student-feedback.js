'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const COMPLETION_OPTIONS = Object.freeze([
  { value: 'completed', label: '全部完成' },
  { value: 'partial', label: '部分完成' },
  { value: 'not_completed', label: '未完成' }
]);
const COMPLETION_LABELS = Object.freeze(
  COMPLETION_OPTIONS.reduce((labels, item) => {
    labels[item.value] = item.label;
    return labels;
  }, {})
);
const ATTENDANCE_LABELS = Object.freeze({
  checked_in: '已签到',
  late: '迟到'
});

function localRequestId() {
  return `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function decorateFeedback(feedback, sessionMap) {
  const session = sessionMap[feedback.sessionId] || {};
  return {
    ...feedback,
    sessionTitle: session.title || session.sessionId || feedback.sessionId,
    attendanceDate: feedback.attendanceDate || session.attendanceDate || '',
    completionLabel:
      COMPLETION_LABELS[feedback.completionStatus] || feedback.completionStatus,
    rpeText: `RPE ${feedback.rpe}/10`,
    hasCoachComment: Boolean(feedback.coachComment)
  };
}

Page({
  data: {
    loading: true,
    error: '',
    eligibleSessions: [],
    history: [],
    completionOptions: COMPLETION_OPTIONS,
    selectedSessionId: '',
    editingFeedbackId: '',
    editingVersion: 0,
    completionIndex: 0,
    rpe: 5,
    comment: '',
    submitting: false,
    busyId: ''
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
      const [eligibleResult, historyResult] = await Promise.all([
        api.listEligibleFeedbackSessions(),
        api.listMyFeedback()
      ]);
      const sessionMap = {};
      for (const item of eligibleResult.sessions || []) {
        sessionMap[item.session.sessionId] = item.session;
      }
      this.setData({
        loading: false,
        eligibleSessions: (eligibleResult.sessions || []).map((item) => ({
          sessionId: item.session.sessionId,
          ...item,
          attendanceLabel:
            ATTENDANCE_LABELS[item.attendanceStatus] || item.attendanceStatus,
          feedback: item.feedback
            ? decorateFeedback(item.feedback, sessionMap)
            : null
        })),
        history: (historyResult.feedback || []).map((item) =>
          decorateFeedback(item, sessionMap)
        )
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '训练反馈数据加载失败。'
      });
    }
  },

  startFeedback(event) {
    const sessionId = event.currentTarget.dataset.sessionId;
    if (!sessionId) {
      return;
    }
    this.setData({
      selectedSessionId: sessionId,
      editingFeedbackId: '',
      editingVersion: 0,
      completionIndex: 0,
      rpe: 5,
      comment: '',
      error: ''
    });
  },

  editFeedback(event) {
    const feedbackId = event.currentTarget.dataset.feedbackId;
    const feedback = this.data.history.find((item) => item.feedbackId === feedbackId);
    if (!feedback) {
      return;
    }
    const completionIndex = Math.max(
      0,
      COMPLETION_OPTIONS.findIndex(
        (item) => item.value === feedback.completionStatus
      )
    );
    this.setData({
      selectedSessionId: feedback.sessionId,
      editingFeedbackId: feedback.feedbackId,
      editingVersion: Number(feedback.version) || 1,
      completionIndex,
      rpe: Number(feedback.rpe) || 5,
      comment: feedback.comment || '',
      error: ''
    });
  },

  cancelEdit() {
    this.setData({
      selectedSessionId: '',
      editingFeedbackId: '',
      editingVersion: 0,
      completionIndex: 0,
      rpe: 5,
      comment: ''
    });
  },

  onCompletionChange(event) {
    this.setData({ completionIndex: Number(event.detail.value) });
  },

  onRpeChange(event) {
    this.setData({ rpe: Number(event.detail.value) });
  },

  onCommentInput(event) {
    this.setData({ comment: event.detail.value });
  },

  async submitFeedback() {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.selectedSessionId) {
      this.setData({ error: '请先选择一个可反馈的训练场次。' });
      return;
    }
    const completion = this.data.completionOptions[this.data.completionIndex];
    if (!completion) {
      this.setData({ error: '请选择完成情况。' });
      return;
    }
    const rpe = Number(this.data.rpe);
    if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) {
      this.setData({ error: 'RPE应为1至10之间的整数。' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      const payload = {
        completionStatus: completion.value,
        rpe,
        comment: this.data.comment
      };
      if (this.data.editingFeedbackId) {
        await api.updateFeedback({
          feedbackId: this.data.editingFeedbackId,
          expectedVersion: this.data.editingVersion,
          ...payload
        });
      } else {
        await api.submitFeedback({
          ...payload,
          clientRequestId: localRequestId(),
          sessionId: this.data.selectedSessionId
        });
      }
      wx.showToast({
        title: this.data.editingFeedbackId ? '反馈已更新' : '反馈已提交',
        icon: 'success'
      });
      this.cancelEdit();
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '训练反馈提交失败。' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  retry() {
    this.loadPage();
  }
});
