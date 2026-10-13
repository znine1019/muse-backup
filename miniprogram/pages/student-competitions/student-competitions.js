'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const STATUS_LABELS = Object.freeze({
  submitted: '意向已提交',
  processing: '教练处理中',
  registered: '教练已确认官方报名提交',
  failed: '报名未完成',
  cancelled: '意向已取消'
});
const PHASE_LABELS = Object.freeze({
  not_started: '未开始报名',
  open: '报名意向开放中',
  closed: '报名已截止',
  draft: '草稿',
  archived: '已归档'
});

function localRequestId() {
  return `intent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function decorateCompetition(competition) {
  const options = [];
  for (const event of competition.events || []) {
    for (const category of event.categories || []) {
      options.push({
        key: `${event.eventCode}|${category}`,
        label: `${event.eventName} · ${category}`
      });
    }
  }
  return {
    ...competition,
    phaseLabel: PHASE_LABELS[competition.phase] || competition.phase,
    capacityText: competition.capacityEnabled
      ? `意向人数上限 ${competition.capacity} 人（仅限小程序意向收集）`
      : '默认不限人数',
    registrationStatusLabel: competition.registration
      ? STATUS_LABELS[competition.registration.status] ||
        competition.registration.status
      : '',
    itemOptions: options,
    canSubmit: competition.phase === 'open'
  };
}

Page({
  data: {
    loading: true,
    error: '',
    competitions: [],
    intents: [],
    selectedCompetitionId: '',
    selectedKeys: [],
    contactNote: '',
    submitting: false
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
      const [competitionResult, intentResult] = await Promise.all([
        api.listStudentCompetitions(),
        api.listMyCompetitionIntents()
      ]);
      this.setData({
        loading: false,
        competitions: (competitionResult.competitions || []).map(decorateCompetition),
        intents: (intentResult.registrations || []).map((item) => ({
          ...item,
          statusLabel: STATUS_LABELS[item.status] || item.status,
          canCancel: item.status !== 'registered' && item.status !== 'cancelled'
        }))
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '赛事信息加载失败。'
      });
    }
  },

  toggleIntentForm(event) {
    const competitionId = event.currentTarget.dataset.competitionId;
    this.setData({
      selectedCompetitionId:
        this.data.selectedCompetitionId === competitionId ? '' : competitionId,
      selectedKeys: [],
      contactNote: ''
    });
  },

  onItemChange(event) {
    this.setData({ selectedKeys: event.detail.value || [] });
  },

  onContactNoteInput(event) {
    this.setData({ contactNote: event.detail.value });
  },

  async submitIntent() {
    if (this.data.submitting) {
      return;
    }
    const competitionId = this.data.selectedCompetitionId;
    if (!competitionId) {
      return;
    }
    if (!this.data.selectedKeys.length) {
      this.setData({ error: '请至少选择一个参赛项目和组别。' });
      return;
    }
    const items = this.data.selectedKeys.map((key) => {
      const [eventCode, category] = key.split('|');
      return { eventCode, category };
    });
    this.setData({ submitting: true, error: '' });
    try {
      const result = await api.submitCompetitionIntent({
        clientRequestId: localRequestId(),
        competitionId,
        items,
        contactNote: this.data.contactNote
      });
      wx.showToast({
        title: result.duplicate ? '意向已存在' : '意向已提交',
        icon: result.duplicate ? 'none' : 'success'
      });
      this.setData({ selectedCompetitionId: '', selectedKeys: [], contactNote: '' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '参赛意向提交失败。' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async cancelIntent(event) {
    const registrationId = event.currentTarget.dataset.registrationId;
    if (!registrationId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '确认取消参赛意向',
        content:
          '取消小程序意向不会自动撤销官方平台报名；如已由教练提交，请联系教练处理。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    try {
      await api.cancelCompetitionIntent({ registrationId, eventCodes: [] });
      wx.showToast({ title: '已取消意向', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '取消意向失败。' });
    }
  },

  retry() {
    this.loadPage();
  }
});
