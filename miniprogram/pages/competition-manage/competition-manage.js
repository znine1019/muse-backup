'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');
const { buildXlsxBase64 } = require('../../utils/xlsx-writer');

const STATUS_LABELS = Object.freeze({
  submitted: '意向已提交',
  processing: '教练处理中',
  registered: '官方报名已提交',
  failed: '报名未完成',
  cancelled: '意向已取消'
});
const PHASE_LABELS = Object.freeze({
  draft: '草稿',
  not_started: '未开始报名',
  open: '报名意向开放中',
  closed: '报名已截止',
  archived: '已归档'
});

function localRequestId() {
  return `competition_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayIso() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function decorateCompetition(competition) {
  return {
    ...competition,
    phaseLabel: PHASE_LABELS[competition.phase] || competition.phase,
    capacityText: competition.capacityEnabled
      ? `上限 ${competition.capacity} 人`
      : '不限人数',
    eventNames: (competition.events || [])
      .map((event) => event.eventName)
      .join('、')
  };
}

Page({
  data: {
    loading: true,
    error: '',
    groups: [],
    events: [],
    competitions: [],
    showCreateForm: false,
    form: {
      title: '',
      description: '',
      location: '',
      eventDate: todayIso(),
      registrationStartDate: todayIso(),
      registrationStartTime: '00:00',
      registrationEndDate: todayIso(),
      registrationEndTime: '23:59',
      requirements: '',
      notes: '',
      categoriesText: '甲组,乙组',
      capacityEnabled: false,
      capacity: '',
      selectedEventCodes: [],
      selectedGroupIds: []
    },
    selectedCompetitionId: '',
    registrations: [],
    registrationStatusFilter: '',
    exporting: false,
    busyId: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (
        !sessionHasRole(session, 'coach') &&
        !sessionHasRole(session, 'developer')
      ) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const [meta, list] = await Promise.all([
        api.listCompetitionMeta(),
        api.listManageCompetitions({})
      ]);
      this.setData({
        loading: false,
        groups: meta.groups || [],
        events: meta.events || [],
        competitions: (list.competitions || []).map(decorateCompetition)
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '赛事管理数据加载失败。'
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

  onCapacityToggle(event) {
    this.setData({ 'form.capacityEnabled': event.detail.value });
  },

  onEventSelect(event) {
    this.setData({ 'form.selectedEventCodes': event.detail.value || [] });
  },

  onGroupSelect(event) {
    this.setData({ 'form.selectedGroupIds': event.detail.value || [] });
  },

  buildEvents() {
    const categories = this.data.form.categoriesText
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return this.data.form.selectedEventCodes.map((eventCode) => ({
      eventCode,
      categories
    }));
  },

  async createCompetition() {
    if (this.data.busyId) {
      return;
    }
    const form = this.data.form;
    if (!form.title.trim() || !form.location.trim()) {
      this.setData({ error: '请填写赛事名称和举办地点。' });
      return;
    }
    if (!form.selectedEventCodes.length) {
      this.setData({ error: '请选择至少一个参赛项目。' });
      return;
    }
    if (!form.selectedGroupIds.length) {
      this.setData({ error: '请选择允许参与的训练组。' });
      return;
    }
    this.setData({ busyId: 'create', error: '' });
    try {
      await api.createCompetition({
        clientRequestId: localRequestId(),
        title: form.title,
        description: form.description,
        location: form.location,
        eventDate: form.eventDate,
        registrationStartAt: `${form.registrationStartDate} ${form.registrationStartTime}`,
        registrationEndAt: `${form.registrationEndDate} ${form.registrationEndTime}`,
        requirements: form.requirements,
        notes: form.notes,
        events: this.buildEvents(),
        trainingGroupIds: form.selectedGroupIds,
        capacityEnabled: form.capacityEnabled,
        capacity: form.capacityEnabled ? form.capacity : null
      });
      wx.showToast({ title: '赛事草稿已保存', icon: 'success' });
      this.setData({
        showCreateForm: false,
        form: { ...this.data.form, title: '', description: '', location: '' }
      });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '赛事创建失败。' });
    } finally {
      this.setData({ busyId: '' });
    }
  },

  async transition(event) {
    const competitionId = event.currentTarget.dataset.competitionId;
    const version = Number(event.currentTarget.dataset.version) || 1;
    const action = event.currentTarget.dataset.action;
    if (!competitionId || this.data.busyId) {
      return;
    }
    this.setData({ busyId: competitionId, error: '' });
    try {
      const payload = { competitionId, expectedVersion: version };
      if (action === 'publish') {
        await api.publishCompetition(payload);
      } else if (action === 'close') {
        await api.closeCompetition(payload);
      } else {
        await api.archiveCompetition(payload);
      }
      wx.showToast({ title: '状态已更新', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '赛事状态更新失败。' });
    } finally {
      this.setData({ busyId: '' });
    }
  },

  async loadRegistrations(event) {
    const competitionId = event.currentTarget.dataset.competitionId;
    if (!competitionId) {
      return;
    }
    if (this.data.selectedCompetitionId === competitionId) {
      this.setData({ selectedCompetitionId: '', registrations: [] });
      return;
    }
    this.setData({ busyId: competitionId, error: '' });
    try {
      const result = await api.listManagedRegistrations({
        competitionId,
        status: this.data.registrationStatusFilter || undefined
      });
      this.setData({
        selectedCompetitionId: competitionId,
        registrations: (result.registrations || []).map((item) => ({
          ...item,
          statusLabel: STATUS_LABELS[item.status] || item.status,
          groupText: (item.trainingGroupNames || []).join('、'),
          itemsText: (item.items || [])
            .map((intent) => `${intent.eventName}·${intent.category}`)
            .join('、')
        }))
      });
    } catch (error) {
      this.setData({ error: error.message || '报名意向加载失败。' });
    } finally {
      this.setData({ busyId: '' });
    }
  },

  onStatusFilterChange(event) {
    this.setData({ registrationStatusFilter: event.detail.value });
    if (this.data.selectedCompetitionId) {
      this.loadRegistrations({
        currentTarget: { dataset: { competitionId: this.data.selectedCompetitionId } }
      });
    }
  },

  async updateStatus(event) {
    const registrationId = event.currentTarget.dataset.registrationId;
    const status = event.currentTarget.dataset.status;
    const version = Number(event.currentTarget.dataset.version) || 1;
    if (!registrationId || this.data.busyId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: `确认标记：${STATUS_LABELS[status] || status}`,
        content: '',
        editable: true,
        placeholderText: '填写处理说明（可选）',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    this.setData({ busyId: registrationId, error: '' });
    try {
      await api.updateRegistrationStatus({
        registrationId,
        status,
        expectedVersion: version,
        comment: String(modal.content || '').trim()
      });
      wx.showToast({ title: '状态已更新', icon: 'success' });
      await this.loadRegistrations({
        currentTarget: { dataset: { competitionId: this.data.selectedCompetitionId } }
      });
    } catch (error) {
      this.setData({ error: error.message || '报名状态更新失败。' });
    } finally {
      this.setData({ busyId: '' });
    }
  },

  async exportRegistrations(event) {
    const competitionId = event.currentTarget.dataset.competitionId;
    if (!competitionId || this.data.exporting) {
      return;
    }
    this.setData({ exporting: true, error: '' });
    try {
      const result = await api.exportRegistrationRows({ competitionId });
      const rows = [
        [
          '赛事名称',
          '学生姓名',
          '所属训练组',
          '参赛项目',
          '参赛组别',
          '办理状态',
          '处理备注',
          '报名补充说明'
        ]
      ];
      for (const row of result.rows || []) {
        rows.push([
          row.competitionTitle,
          row.studentName,
          row.trainingGroups,
          row.eventName,
          row.category,
          STATUS_LABELS[row.status] || row.status,
          row.reviewNote,
          row.contactNote
        ]);
      }
      const base64 = buildXlsxBase64('赛事报名名单', rows);
      const filePath = `${wx.env.USER_DATA_PATH}/competition-${competitionId}.xlsx`;
      await new Promise((resolve, reject) => {
        wx.getFileSystemManager().writeFile({
          filePath,
          data: base64,
          encoding: 'base64',
          success: resolve,
          fail: reject
        });
      });
      await new Promise((resolve, reject) => {
        wx.openDocument({
          filePath,
          fileType: 'xlsx',
          showMenu: true,
          success: resolve,
          fail: reject
        });
      });
    } catch (error) {
      this.setData({ error: error.message || '报名名单导出失败。' });
    } finally {
      this.setData({ exporting: false });
    }
  },

  retry() {
    this.loadPage();
  }
});
