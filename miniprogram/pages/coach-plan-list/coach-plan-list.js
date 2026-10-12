'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const STATUS_LABELS = Object.freeze({
  draft: '草稿',
  published: '已发布',
  archived: '已归档'
});
const STATUS_OPTIONS = Object.freeze([
  { code: '', label: '全部' },
  { code: 'draft', label: '草稿' },
  { code: 'published', label: '已发布' },
  { code: 'archived', label: '已归档' }
]);

function localRequestId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function itemRequirementText(item) {
  const parts = [];
  if (item.sets) {
    parts.push(`${item.sets}组`);
  }
  if (item.reps) {
    parts.push(`${item.reps}次`);
  }
  if (item.distanceMeters) {
    parts.push(`${item.distanceMeters}米`);
  }
  if (item.durationSeconds) {
    parts.push(`${item.durationSeconds}秒`);
  }
  if (item.restSeconds) {
    parts.push(`休息${item.restSeconds}秒`);
  }
  if (item.load) {
    parts.push(item.load);
  }
  return parts.join(' · ');
}

function decoratePlan(plan) {
  return {
    ...plan,
    statusLabel: STATUS_LABELS[plan.status] || plan.status,
    dateText:
      plan.startDate === plan.endDate
        ? plan.startDate
        : `${plan.startDate} 至 ${plan.endDate}`,
    itemCount: (plan.items || []).length,
    canEdit: plan.status !== 'archived',
    items: (plan.items || []).map((item) => ({
      ...item,
      requirementText: itemRequirementText(item)
    }))
  };
}

Page({
  data: {
    loading: true,
    error: '',
    plans: [],
    total: 0,
    truncated: false,
    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,
    busyPlanId: '',
    expandedPlanId: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '', plans: [] });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (
        !sessionHasRole(session, 'coach') &&
        !sessionHasRole(session, 'developer')
      ) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }

      const status = STATUS_OPTIONS[this.data.statusIndex].code;
      const result = await api.listManagePlans(status ? { status } : {});
      this.setData({
        loading: false,
        plans: (result.plans || []).map(decoratePlan),
        total: Number(result.total) || 0,
        truncated: Boolean(result.truncated)
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '训练计划加载失败。'
      });
    }
  },

  onStatusChange(event) {
    this.setData({ statusIndex: Number(event.detail.value) });
    this.loadPage();
  },

  toggleDetail(event) {
    const planId = event.currentTarget.dataset.planId;
    this.setData({
      expandedPlanId: this.data.expandedPlanId === planId ? '' : planId
    });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/coach-plan-edit/coach-plan-edit' });
  },

  goEdit(event) {
    const planId = event.currentTarget.dataset.planId;
    if (!planId) {
      return;
    }
    wx.navigateTo({
      url: `/pages/coach-plan-edit/coach-plan-edit?planId=${planId}`
    });
  },

  async copyPlan(event) {
    const planId = event.currentTarget.dataset.planId;
    if (!planId || this.data.busyPlanId) {
      return;
    }
    this.setData({ busyPlanId: planId, error: '' });
    try {
      const result = await api.copyPlan({
        sourcePlanId: planId,
        clientRequestId: localRequestId('copy')
      });
      wx.showToast({
        title: result.duplicate ? '副本已存在' : '已复制为草稿',
        icon: result.duplicate ? 'none' : 'success'
      });
      if (result.plan && result.plan.planId) {
        wx.navigateTo({
          url: `/pages/coach-plan-edit/coach-plan-edit?planId=${result.plan.planId}`
        });
      } else {
        await this.loadPage();
      }
    } catch (error) {
      this.setData({ error: error.message || '训练计划复制失败。' });
    } finally {
      this.setData({ busyPlanId: '' });
    }
  },

  async publishPlan(event) {
    const planId = event.currentTarget.dataset.planId;
    const version = Number(event.currentTarget.dataset.version) || 1;
    if (!planId || this.data.busyPlanId) {
      return;
    }

    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '确认发布训练计划',
        content: '发布后，计划所属训练组的学生可以看到该训练安排。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }

    this.setData({ busyPlanId: planId, error: '' });
    try {
      await api.publishPlan({ planId, expectedVersion: version });
      wx.showToast({ title: '已发布', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '训练计划发布失败。' });
    } finally {
      this.setData({ busyPlanId: '' });
    }
  },

  async archivePlan(event) {
    const planId = event.currentTarget.dataset.planId;
    const version = Number(event.currentTarget.dataset.version) || 1;
    if (!planId || this.data.busyPlanId) {
      return;
    }

    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '确认归档训练计划',
        content: '归档后计划保留历史记录，学生不再看到该计划。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }

    this.setData({ busyPlanId: planId, error: '' });
    try {
      await api.archivePlan({ planId, expectedVersion: version });
      wx.showToast({ title: '已归档', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '训练计划归档失败。' });
    } finally {
      this.setData({ busyPlanId: '' });
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
