'use strict';

const api = require('../../services/api');
const {
  getRoleLabel,
  getSessionDestination,
  getStatusLabel,
  sessionHasRole
} = require('../../utils/session');

const ROLE_OPTIONS = Object.freeze(['student', 'coach', 'developer']);

Page({
  data: {
    loading: true,
    error: '',
    registrations: [],
    users: [],
    groups: [],
    coachOptions: [],
    groupOptions: [],
    coachIndex: 0,
    groupIndex: 0,
    newGroupName: '',
    newGroupSeasonLabel: String(new Date().getFullYear()),
    busyUserId: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'developer')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }

      const [pendingResult, userResult, groupResult] = await Promise.all([
        api.listPendingRegistrations(),
        api.listUsers(),
        api.listAllTrainingGroups()
      ]);
      const users = (userResult.users || []).map((user) => ({
        ...user,
        statusLabel: getStatusLabel(user.status),
        statusActionLabel: user.status === 'disabled' ? '启用账号' : '停用账号',
        statusActionValue: user.status === 'disabled' ? 'active' : 'disabled',
        rolesText: (user.roles || []).map((role) => getRoleLabel(role)).join('、') || '未授权',
        canViewProfile:
          user.status === 'active' && (user.roles || []).includes('student'),
        roleActions: ROLE_OPTIONS.map((role) => ({
          role,
          label: getRoleLabel(role),
          active: (user.roles || []).includes(role),
          actionLabel: (user.roles || []).includes(role) ? '撤销' : '授予',
          grantValue: (user.roles || []).includes(role) ? 'false' : 'true'
        }))
      }));
      const coachOptions = users
        .filter((user) => user.roles.includes('coach'))
        .map((user) => ({ userId: user.userId, label: user.displayName }));
      const groups = (groupResult.groups || []).map((group) => ({
        ...group,
        displayName: `${group.name}（${group.seasonLabel || '未标注'}）`,
        statusActionLabel: group.enabled ? '停用训练组' : '启用训练组',
        statusActionValue: group.enabled ? 'false' : 'true',
        coachNames: group.coachUserIds
          .map((userId) => (users.find((user) => user.userId === userId) || {}).displayName)
          .filter(Boolean)
          .join('、')
      }));

      this.setData({
        loading: false,
        registrations: pendingResult.registrations || [],
        users,
        groups,
        coachOptions,
        groupOptions: groups.map((group) => ({
          id: group.id,
          name: group.displayName,
          seasonLabel: group.seasonLabel
        })),
        coachIndex: 0,
        groupIndex: 0
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '开发者工作台加载失败。'
      });
    }
  },

  async review(event) {
    const userId = event.currentTarget.dataset.userId;
    const decision = event.currentTarget.dataset.decision;
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: decision === 'approve' ? '确认通过注册' : '填写驳回原因',
        content: decision === 'approve' ? '通过后学生角色由服务端正式授权。' : '',
        editable: decision === 'reject',
        placeholderText: '可填写审核意见',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    try {
      await api.reviewRegistration({
        targetUserId: userId,
        decision,
        comment: modal.content || ''
      });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '审核失败。' });
    }
  },

  async toggleRole(event) {
    const userId = event.currentTarget.dataset.userId;
    const role = event.currentTarget.dataset.role;
    const grant = event.currentTarget.dataset.grant === 'true';
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: grant ? '确认授予角色' : '确认撤销角色',
        content: `${grant ? '授予' : '撤销'}${getRoleLabel(role)}角色。`,
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }

    this.setData({ busyUserId: userId, error: '' });
    try {
      await api.assignRole({ targetUserId: userId, role, grant });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '角色操作失败。' });
    } finally {
      this.setData({ busyUserId: '' });
    }
  },

  async toggleUserStatus(event) {
    const userId = event.currentTarget.dataset.userId;
    const status = event.currentTarget.dataset.status;
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: status === 'disabled' ? '确认停用账号' : '确认启用账号',
        content:
          status === 'disabled'
            ? '停用后该账号不能访问内部数据。'
            : '启用后按已授权角色恢复访问。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }

    this.setData({ busyUserId: userId, error: '' });
    try {
      await api.setUserStatus({ targetUserId: userId, status });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '账号状态操作失败。' });
    } finally {
      this.setData({ busyUserId: '' });
    }
  },


  async toggleGroupStatus(event) {
    const groupId = event.currentTarget.dataset.groupId;
    const enabled = event.currentTarget.dataset.enabled === 'true';
    if (!groupId) {
      return;
    }

    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: enabled ? '确认启用训练组' : '确认停用训练组',
        content: enabled
          ? '启用后学生可重新申请该训练组。'
          : '停用后该训练组不再接受新的学生申请，已有数据不会被删除。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }

    try {
      await api.setTrainingGroupEnabled({
        trainingGroupId: groupId,
        enabled
      });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '训练组状态更新失败。' });
    }
  },
  onNewGroupInput(event) {
    this.setData({ newGroupName: event.detail.value });
  },

  onNewGroupSeasonInput(event) {
    this.setData({ newGroupSeasonLabel: event.detail.value });
  },

  async createGroup() {
    if (!this.data.newGroupName.trim()) {
      this.setData({ error: '请填写训练组名称。' });
      return;
    }
    if (!this.data.newGroupSeasonLabel.trim()) {
      this.setData({ error: '请填写训练组年份或周期。' });
      return;
    }
    try {
      await api.createTrainingGroup({
        name: this.data.newGroupName,
        seasonLabel: this.data.newGroupSeasonLabel
      });
      this.setData({ newGroupName: '' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '训练组创建失败。' });
    }
  },

  onCoachChange(event) {
    this.setData({ coachIndex: Number(event.detail.value) });
  },

  onGroupChange(event) {
    this.setData({ groupIndex: Number(event.detail.value) });
  },

  async assignCoach(event) {
    const active = event.currentTarget.dataset.active === 'true';
    const coach = this.data.coachOptions[this.data.coachIndex];
    const group = this.data.groupOptions[this.data.groupIndex];
    if (!coach || !group) {
      this.setData({ error: '请先准备至少一个教练员账号和一个训练组。' });
      return;
    }

    try {
      await api.setGroupCoach({
        coachUserId: coach.userId,
        trainingGroupId: group.id,
        active
      });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '教练范围设置失败。' });
    }
  },


  goStudentProfile(event) {
    const userId = event.currentTarget.dataset.userId;
    if (!userId) {
      return;
    }
    wx.navigateTo({
      url: `/pages/profile-view/profile-view?userId=${userId}`
    });
  },
  goPlans() {
    wx.navigateTo({ url: '/pages/coach-plan-list/coach-plan-list' });
  },

  goPerformanceReview() {
    wx.navigateTo({
      url: '/pages/coach-performance-review/coach-performance-review'
    });
  },

  goHome() {
    getApp().clearSession();
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
