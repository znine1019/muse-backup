'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const CATEGORY_LABELS = Object.freeze({
  training: '训练安排',
  competition: '赛事通知',
  announcement: '俱乐部公告',
  other: '其他'
});
const PRIORITY_LABELS = Object.freeze({
  normal: '普通',
  important: '重要'
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

function decorateNotice(notice) {
  const groupNames = notice.trainingGroupNames || [];
  return {
    ...notice,
    categoryLabel: CATEGORY_LABELS[notice.category] || notice.category || '其他',
    priorityLabel: PRIORITY_LABELS[notice.priority] || notice.priority || '普通',
    groupText: groupNames.length ? groupNames.join('、') : '全体可见',
    publishedText: formatDateTime(notice.publishedAt || notice.createdAt)
  };
}

Page({
  data: {
    loading: true,
    error: '',
    notices: [],
    unreadCount: 0,
    categoryOptions: [
      { value: '', label: '全部分类' },
      { value: 'training', label: '训练安排' },
      { value: 'competition', label: '赛事通知' },
      { value: 'announcement', label: '俱乐部公告' },
      { value: 'other', label: '其他' }
    ],
    categoryIndex: 0,
    unreadOnly: false,
    expandedNoticeId: '',
    detail: null,
    detailLoading: false,
    markingId: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '', detail: null, expandedNoticeId: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'student')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const category =
        this.data.categoryOptions[this.data.categoryIndex].value || undefined;
      const result = await api.listStudentNotices({
        category,
        unreadOnly: this.data.unreadOnly || undefined
      });
      this.setData({
        loading: false,
        notices: (result.notices || []).map(decorateNotice),
        unreadCount: Number(result.unreadCount) || 0
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '通知加载失败。'
      });
    }
  },

  onCategoryChange(event) {
    this.setData({ categoryIndex: Number(event.detail.value) }, () => {
      this.loadPage();
    });
  },

  onUnreadToggle(event) {
    this.setData({ unreadOnly: event.detail.value === true }, () => {
      this.loadPage();
    });
  },

  async toggleNotice(event) {
    const noticeId = event.currentTarget.dataset.noticeId;
    if (!noticeId) {
      return;
    }
    if (this.data.expandedNoticeId === noticeId) {
      this.setData({ expandedNoticeId: '', detail: null, detailLoading: false });
      return;
    }
    this.setData({ expandedNoticeId: noticeId, detailLoading: true, error: '' });
    try {
      const result = await api.getStudentNotice(noticeId);
      this.setData({
        detail: decorateNotice(result.notice),
        detailLoading: false
      });
    } catch (error) {
      this.setData({
        detailLoading: false,
        error: error.message || '通知详情加载失败。'
      });
    }
  },

  async markRead(event) {
    const noticeId = event.currentTarget.dataset.noticeId;
    if (!noticeId || this.data.markingId) {
      return;
    }
    this.setData({ markingId: noticeId, error: '' });
    try {
      await api.markNoticeRead(noticeId);
      const notices = this.data.notices.map((notice) =>
        notice.noticeId === noticeId
          ? { ...notice, isRead: true, readAt: new Date().toISOString() }
          : notice
      );
      const detail =
        this.data.detail && this.data.detail.noticeId === noticeId
          ? { ...this.data.detail, isRead: true, readAt: new Date().toISOString() }
          : this.data.detail;
      this.setData({
        notices,
        detail,
        unreadCount: Math.max(0, (Number(this.data.unreadCount) || 0) - 1),
        markingId: ''
      });
      wx.showToast({ title: '已标记已读', icon: 'success' });
    } catch (error) {
      this.setData({ markingId: '', error: error.message || '标记已读失败。' });
    }
  },

  retry() {
    this.loadPage();
  }
});
