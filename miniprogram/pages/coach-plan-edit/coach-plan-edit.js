'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

function pad(value) {
  return String(value).padStart(2, '0');
}

function localDateOnly() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localRequestId() {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyItem(category, order) {
  return {
    order,
    category: category ? category.code : 'sprint',
    categoryIndex: 0,
    name: '',
    target: '',
    sets: '',
    reps: '',
    distanceMeters: '',
    durationSeconds: '',
    restSeconds: '',
    load: '',
    notes: ''
  };
}

Page({
  data: {
    loading: true,
    saving: false,
    publishing: false,
    error: '',
    planId: '',
    requestId: '',
    version: 1,
    title: '',
    startDate: localDateOnly(),
    endDate: localDateOnly(),
    notes: '',
    categories: [],
    groups: [],
    groupIndex: 0,
    items: [],
    uiDaylight: false,
    focusedField: '',
    stepIndex: 0,
    stepTabs: [
      { key: 'base', idx: '01', label: '基础信息' },
      { key: 'drills', idx: '02', label: '训练内容' },
      { key: 'publish', idx: '03', label: '核对发布' }
    ]
  },

  onLoad(options) {
    this.setData({ planId: options.planId || '' });
    this.loadPage();
  },

  onToggleDaylight() {
    this.setData({ uiDaylight: !this.data.uiDaylight });
  },

  onStepChange(event) {
    const current = Number(event && event.detail && event.detail.current);
    if (Number.isFinite(current) && current !== this.data.stepIndex) {
      this.setData({ stepIndex: current });
    }
  },

  onStepSelect(event) {
    const index = Number(event && event.detail && event.detail.index);
    if (Number.isFinite(index) && index !== this.data.stepIndex) {
      this.setData({ stepIndex: index });
    }
  },

  onPrevStep() {
    if (this.data.stepIndex > 0) {
      this.setData({ stepIndex: this.data.stepIndex - 1 });
    }
  },

  onNextStep() {
    if (this.data.stepIndex < 2) {
      this.setData({ stepIndex: this.data.stepIndex + 1 });
    }
  },

  onFieldFocus(event) {
    const field = (event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.field) || '';
    this.setData({ focusedField: field });
  },

  onFieldBlur() {
    this.setData({ focusedField: '' });
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

      const meta = await api.listPlanMeta();
      const categories = meta.categories || [];
      const groups = meta.groups || [];
      if (!groups.length) {
        throw new Error('当前没有可管理且已启用的训练组。');
      }

      if (!this.data.planId) {
        this.setData({
          loading: false,
          categories,
          groups,
          groupIndex: 0,
          items: [emptyItem(categories[0], 1)]
        });
        return;
      }

      const result = await api.getManagePlan(this.data.planId);
      this.applyPlan(result.plan, categories, groups);
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '训练计划加载失败。'
      });
    }
  },

  applyPlan(plan, categories = this.data.categories, groups = this.data.groups) {
    const groupIndex = Math.max(
      0,
      groups.findIndex((group) => group.id === plan.trainingGroupId)
    );
    this.setData({
      loading: false,
      planId: plan.planId,
      version: plan.version || 1,
      title: plan.title || '',
      startDate: plan.startDate || localDateOnly(),
      endDate: plan.endDate || plan.startDate || localDateOnly(),
      notes: plan.notes || '',
      categories,
      groups,
      groupIndex,
      items: (plan.items || []).map((item, index) => {
        const categoryIndex = Math.max(
          0,
          categories.findIndex((category) => category.code === item.category)
        );
        return {
          ...emptyItem(categories[categoryIndex], index + 1),
          ...item,
          categoryIndex
        };
      })
    });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value });
  },

  onGroupChange(event) {
    this.setData({ groupIndex: Number(event.detail.value) });
  },

  onItemFieldInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    this.setData({
      [`items[${index}].${field}`]: event.detail.value
    });
  },

  onItemCategoryChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    const categoryIndex = Number(event.detail.value);
    const category = this.data.categories[categoryIndex];
    this.setData({
      [`items[${index}].categoryIndex`]: categoryIndex,
      [`items[${index}].category`]: category ? category.code : 'other'
    });
  },

  addItem() {
    const items = this.data.items.concat(
      emptyItem(this.data.categories[0], this.data.items.length + 1)
    );
    this.setData({ items });
  },

  removeItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    const items = this.data.items
      .filter((item, itemIndex) => itemIndex !== index)
      .map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }));
    this.setData({ items });
  },

  buildPayload() {
    const group = this.data.groups[this.data.groupIndex];
    return {
      trainingGroupId: group ? group.id : '',
      title: this.data.title.trim(),
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      notes: this.data.notes,
      items: this.data.items.map((item, index) => ({
        order: index + 1,
        category: item.category,
        name: String(item.name || '').trim(),
        target: item.target,
        sets: item.sets,
        reps: item.reps,
        distanceMeters: item.distanceMeters,
        durationSeconds: item.durationSeconds,
        restSeconds: item.restSeconds,
        load: item.load,
        notes: item.notes
      }))
    };
  },

  validateForm() {
    if (!this.data.title.trim()) {
      this.setData({ error: '请填写计划名称。' });
      return false;
    }
    if (!this.data.groups[this.data.groupIndex]) {
      this.setData({ error: '请选择训练组。' });
      return false;
    }
    if (!this.data.items.length) {
      this.setData({ error: '至少需要一项训练内容。' });
      return false;
    }
    for (let index = 0; index < this.data.items.length; index += 1) {
      if (!String(this.data.items[index].name || '').trim()) {
        this.setData({ error: `请填写第${index + 1}项训练名称。` });
        return false;
      }
    }
    if (this.data.endDate < this.data.startDate) {
      this.setData({ error: '结束日期不能早于开始日期。' });
      return false;
    }
    return true;
  },

  async persistPlan() {
    const payload = this.buildPayload();
    if (this.data.planId) {
      const result = await api.updatePlan({
        planId: this.data.planId,
        expectedVersion: this.data.version,
        ...payload
      });
      this.applyPlan(result.plan);
      return result.plan;
    }

    const requestId = this.data.requestId || localRequestId();
    const result = await api.createPlan({
      clientRequestId: requestId,
      ...payload
    });
    this.setData({ requestId });
    this.applyPlan(result.plan);
    return result.plan;
  },

  async saveDraft() {
    if (!this.validateForm()) {
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      await this.persistPlan();
      wx.showToast({ title: '草稿已保存', icon: 'success' });
    } catch (error) {
      this.setData({ error: error.message || '训练计划保存失败。' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async publishPlan() {
    if (!this.validateForm()) {
      return;
    }
    this.setData({ publishing: true, error: '' });
    try {
      const saved = await this.persistPlan();
      const result = await api.publishPlan({
        planId: saved.planId,
        expectedVersion: saved.version
      });
      this.applyPlan(result.plan);
      wx.showToast({ title: '计划已发布', icon: 'success' });
    } catch (error) {
      this.setData({ error: error.message || '训练计划发布失败。' });
    } finally {
      this.setData({ publishing: false });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
