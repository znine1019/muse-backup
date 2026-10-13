'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const CATEGORY_OPTIONS = Object.freeze([
  { value: 'training', label: '训练安排' },
  { value: 'competition', label: '赛事通知' },
  { value: 'announcement', label: '俱乐部公告' },
  { value: 'other', label: '其他' }
]);
const CATEGORY_LABELS = Object.freeze(
  CATEGORY_OPTIONS.reduce((labels, item) => {
    labels[item.value] = item.label;
    return labels;
  }, {})
);
const PRIORITY_OPTIONS = Object.freeze([
  { value: 'normal', label: '普通' },
  { value: 'important', label: '重要' }
]);
const STATUS_LABELS = Object.freeze({
  draft: '草稿',
  published: '已发布',
  withdrawn: '已撤回',
  archived: '已归档'
});

function localRequestId() {
  return `notice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

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
  return {
    ...notice,
    categoryLabel: CATEGORY_LABELS[notice.category] || notice.category || '其他',
    priorityLabel: notice.priority === 'important' ? '重要' : '普通',
    statusLabel: STATUS_LABELS[notice.status] || notice.status,
    groupText: (notice.trainingGroupNames || []).join('、') || '全体可见',
    timeText: formatDateTime(notice.publishedAt || notice.createdAt)
  };
}

Page({
  data: {
    loading: true,
    error: '',
    isDeveloper: false,
    groups: [],
    notices: [],
    showCreateForm: false,
    categoryOptions: CATEGORY_OPTIONS,
    priorityOptions: PRIORITY_OPTIONS,
    form: {
      title: '',
      content: '',
      categoryIndex: 0,
      priorityIndex: 0,
      selectedGroupIds: []
    },
    creating: false,
    busyId: ''
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
      const [result, meta] = await Promise.all([
        api.listManageNotices({}),
        api.listPlanMeta()
      ]);
      this.setData({
        loading: false,
        isDeveloper: sessionHasRole(session, 'developer'),
        groups: meta.groups || [],
        notices: (result.notices || []).map(decorateNotice)
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '通知管理数据加载失败。'
      });
    }
  },

  toggleCreateForm() {
    this.setData({ showCreateForm: !this.data.showCreateForm });
  },

  onFormInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  onCategoryChange(event) {
    this.setData({ 'form.categoryIndex': Number(event.detail.value) });
  },

  onPriorityChange(event) {
    this.setData({ 'form.priorityIndex': Number(event.detail.value) });
  },

  onGroupSelect(event) {
    this.setData({ 'form.selectedGroupIds': event.detail.value || [] });
  },

  async createNotice() {
    if (this.data.creating) {
      return;
    }
    const form = this.data.form;
    const category = this.data.categoryOptions[form.categoryIndex];
    const priority = this.data.priorityOptions[form.priorityIndex];
    if (!form.title.trim()) {
      this.setData({ error: '请填写通知标题。' });
      return;
    }
    if (!form.content.trim()) {
      this.setData({ error: '请填写通知正文。' });
      return;
    }
    if (!this.data.isDeveloper && !form.selectedGroupIds.length) {
      this.setData({ error: '教练发布通知时必须选择至少一个训练组。' });
      return;
    }
    this.setData({ creating: true, error: '' });
    try {
      await api.createNotice({
        clientRequestId: localRequestId(),
        title: form.title,
        content: form.content,
        category: category.value,
        priority: priority.value,
        trainingGroupIds: form.selectedGroupIds
      });
      wx.showToast({ title: '通知草稿已保存', icon: 'success' });
      this.setData({
        showCreateForm: false,
        form: {
          title: '',
          content: '',
          categoryIndex: 0,
          priorityIndex: 0,
          selectedGroupIds: []
        }
      });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '通知创建失败。' });
    } finally {
      this.setData({ creating: false });
    }
  },

  async transition(event) {
    const noticeId = event.currentTarget.dataset.noticeId;
    const version = Number(event.currentTarget.dataset.version) || 1;
    const action = event.currentTarget.dataset.action;
    if (!noticeId || this.data.busyId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: action === 'publish' ? '确认发布通知' : action === 'withdraw' ? '确认撤回通知' : '确认归档通知',
        content: action === 'withdraw' ? '撤回后学生将不再看到该通知。' : '',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    this.setData({ busyId: noticeId, error: '' });
    try {
      const payload = { noticeId, expectedVersion: version };
      if (action === 'publish') {
        await api.publishNotice(payload);
      } else if (action === 'withdraw') {
        await api.withdrawNotice(payload);
      } else {
        await api.archiveNotice(payload);
      }
      wx.showToast({ title: '状态已更新', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '通知状态更新失败。' });
    } finally {
      this.setData({ busyId: '' });
    }
  },

  retry() {
    this.loadPage();
  }
});
