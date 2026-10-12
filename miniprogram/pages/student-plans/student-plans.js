'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const SCOPES = Object.freeze([
  { code: 'today', label: '今日' },
  { code: 'week', label: '本周' },
  { code: 'history', label: '历史' }
]);
const STATUS_LABELS = Object.freeze({
  published: '已发布',
  draft: '草稿',
  archived: '已归档'
});

function requirementText(item) {
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
    items: (plan.items || []).map((item) => ({
      ...item,
      requirementText: requirementText(item)
    }))
  };
}

Page({
  data: {
    loading: true,
    error: '',
    scopes: SCOPES,
    scopeIndex: 0,
    scopeLabel: SCOPES[0].label,
    plans: [],
    total: 0,
    truncated: false,
    expandedPlanId: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '', plans: [] });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'student')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }

      const scope = SCOPES[this.data.scopeIndex];
      const result = await api.listStudentPlans({ scope: scope.code });
      this.setData({
        loading: false,
        scopeLabel: scope.label,
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

  onScopeTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({
      scopeIndex: index,
      scopeLabel: SCOPES[index].label,
      expandedPlanId: ''
    });
    this.loadPage();
  },

  toggleDetail(event) {
    const planId = event.currentTarget.dataset.planId;
    this.setData({
      expandedPlanId: this.data.expandedPlanId === planId ? '' : planId
    });
  },

  retry() {
    this.loadPage();
  }
});
