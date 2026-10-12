'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const STATUS_LABELS = Object.freeze({
  not_started: '未到签到时间',
  pending: '待签到',
  checked_in: '已签到',
  late: '迟到',
  leave_approved: '已批准请假',
  pending_verification: '待核实异常',
  absent: '未签到',
  cancelled: '已取消'
});
const PHASE_LABELS = Object.freeze({
  not_started: '未开始',
  open: '签到中',
  closed: '已结束',
  cancelled: '已取消'
});
const LEAVE_STATUS_LABELS = Object.freeze({
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已撤销'
});
const MANUAL_STATUSES = Object.freeze([
  { code: 'checked_in', label: '标记已签到' },
  { code: 'late', label: '标记迟到' },
  { code: 'absent', label: '标记未签到' }
]);

function localRequestId() {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayIso() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function decorateSession(session) {
  return {
    ...session,
    phaseLabel: PHASE_LABELS[session.phase] || session.phase,
    statusLabel: STATUS_LABELS[session.phase] || session.phase
  };
}

Page({
  data: {
    loading: true,
    error: '',
    groups: [],
    groupIndex: 0,
    sessions: [],
    selectedSessionId: '',
    roster: [],
    summary: null,
    pendingLeaves: [],
    pendingCount: 0,
    showCreateForm: false,
    form: {
      title: '',
      attendanceDate: todayIso(),
      locationName: '',
      latitude: '',
      longitude: '',
      radiusMeters: '100',
      accuracyThresholdMeters: '100',
      checkInOpenTime: '08:00',
      checkInCloseTime: '09:00',
      lateAfterTime: '08:15'
    },
    creating: false,
    busySessionId: '',
    reviewingLeaveId: ''
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
      const [sessionResult, leaveResult, meta] = await Promise.all([
        api.listManageAttendanceSessions({}),
        api.listPendingLeaves(),
        api.listPlanMeta()
      ]);
      this.setData({
        loading: false,
        groups: meta.groups || [],
        groupIndex: 0,
        sessions: (sessionResult.sessions || []).map(decorateSession),
        pendingLeaves: (leaveResult.leaves || []).map((leave) => ({
          ...leave,
          statusLabel: LEAVE_STATUS_LABELS[leave.status] || leave.status
        })),
        pendingCount: Number(leaveResult.pendingCount) || 0
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '考勤管理数据加载失败。'
      });
    }
  },

  toggleCreateForm() {
    this.setData({ showCreateForm: !this.data.showCreateForm });
  },

  onGroupChange(event) {
    this.setData({ groupIndex: Number(event.detail.value) });
  },

  onFormInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  async createSession() {
    const group = this.data.groups[this.data.groupIndex];
    if (!group) {
      this.setData({ error: '请选择训练组。' });
      return;
    }
    const form = this.data.form;
    if (!form.locationName.trim()) {
      this.setData({ error: '请填写训练地点名称。' });
      return;
    }
    this.setData({ creating: true, error: '' });
    try {
      await api.createAttendanceSession({
        clientRequestId: localRequestId(),
        trainingGroupId: group.id,
        title: form.title,
        attendanceDate: form.attendanceDate,
        locationName: form.locationName,
        latitude: form.latitude,
        longitude: form.longitude,
        radiusMeters: form.radiusMeters,
        accuracyThresholdMeters: form.accuracyThresholdMeters,
        checkInOpenTime: form.checkInOpenTime,
        checkInCloseTime: form.checkInCloseTime,
        lateAfterTime: form.lateAfterTime
      });
      wx.showToast({ title: '场次已创建', icon: 'success' });
      this.setData({
        showCreateForm: false,
        form: { ...this.data.form, title: '', locationName: '', latitude: '', longitude: '' }
      });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '考勤场次创建失败。' });
    } finally {
      this.setData({ creating: false });
    }
  },

  async selectSession(event) {
    const sessionId = event.currentTarget.dataset.sessionId;
    if (!sessionId || this.data.busySessionId) {
      return;
    }
    if (this.data.selectedSessionId === sessionId) {
      this.setData({ selectedSessionId: '', roster: [], summary: null });
      return;
    }
    await this.loadRoster(sessionId);
  },

  async loadRoster(sessionId) {
    this.setData({ busySessionId: sessionId, error: '' });
    try {
      const result = await api.getAttendanceRoster(sessionId);
      this.setData({
        selectedSessionId: sessionId,
        roster: (result.roster || []).map((item) => ({
          ...item,
          statusLabel: STATUS_LABELS[item.status] || item.status,
          leaveStatusLabel: item.leaveStatus
            ? LEAVE_STATUS_LABELS[item.leaveStatus] || item.leaveStatus
            : ''
        })),
        summary: result.summary || null
      });
    } catch (error) {
      this.setData({ error: error.message || '考勤名单加载失败。' });
    } finally {
      this.setData({ busySessionId: '' });
    }
  },

  async manualVerify(event) {
    const studentUserId = event.currentTarget.dataset.studentUserId;
    const sessionId = this.data.selectedSessionId;
    if (!studentUserId || !sessionId) {
      return;
    }
    const selection = await new Promise((resolve) => {
      wx.showActionSheet({
        itemList: MANUAL_STATUSES.map((item) => item.label),
        success: (result) => resolve(result.tapIndex),
        fail: () => resolve(-1)
      });
    });
    if (selection < 0) {
      return;
    }
    const status = MANUAL_STATUSES[selection].code;
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: MANUAL_STATUSES[selection].label,
        content: '',
        editable: true,
        placeholderText: '填写人工核实原因（必填）',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    const reason = String(modal.content || '').trim();
    if (!reason) {
      this.setData({ error: '人工核实必须填写原因。' });
      return;
    }
    try {
      await api.manualVerifyAttendance({
        sessionId,
        studentUserId,
        status,
        reason
      });
      wx.showToast({ title: '已记录', icon: 'success' });
      await this.loadRoster(sessionId);
    } catch (error) {
      this.setData({ error: error.message || '人工核实失败。' });
    }
  },

  async reviewLeave(event) {
    const leaveId = event.currentTarget.dataset.leaveId;
    const decision = event.currentTarget.dataset.decision;
    if (!leaveId || this.data.reviewingLeaveId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: decision === 'approve' ? '确认批准请假' : '填写驳回原因',
        content: decision === 'approve' ? '批准后该场次考勤将记为已批准请假。' : '',
        editable: decision === 'reject',
        placeholderText: '审批意见',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    const comment = String(modal.content || '').trim();
    if (decision === 'reject' && !comment) {
      this.setData({ error: '驳回请假时必须填写审批意见。' });
      return;
    }
    this.setData({ reviewingLeaveId: leaveId, error: '' });
    try {
      await api.reviewLeave({ leaveId, decision, comment });
      wx.showToast({
        title: decision === 'approve' ? '已批准' : '已驳回',
        icon: 'success'
      });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '请假审批失败。' });
    } finally {
      this.setData({ reviewingLeaveId: '' });
    }
  },

  retry() {
    this.loadPage();
  }
});
