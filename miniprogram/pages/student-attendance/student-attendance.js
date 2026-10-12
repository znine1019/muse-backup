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
const LEAVE_STATUS_LABELS = Object.freeze({
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已撤销'
});

function localRequestId() {
  return `leave_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function decorateSession(item) {
  return {
    ...item,
    statusLabel: STATUS_LABELS[item.status] || item.status,
    leaveStatusLabel: item.leaveStatus
      ? LEAVE_STATUS_LABELS[item.leaveStatus] || item.leaveStatus
      : '',
    canCheckIn: item.status === 'pending'
  };
}

Page({
  data: {
    loading: true,
    error: '',
    checkInMessage: '',
    todayDate: '',
    todaySessions: [],
    leaveSessionOptions: [],
    records: [],
    summary: null,
    leaves: [],
    leaveSessionIndex: 0,
    leaveReason: '',
    submitting: false,
    busySessionId: '',
    busyLeaveId: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '', checkInMessage: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'student')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const [todayResult, recordResult, leaveResult] = await Promise.all([
        api.getStudentTodayAttendance(),
        api.listStudentAttendance({}),
        api.listMyLeaves()
      ]);
      const todaySessions = (todayResult.sessions || []).map(decorateSession);
      this.setData({
        loading: false,
        todayDate: todayResult.date || '',
        todaySessions,
        leaveSessionOptions: todaySessions.map((item) => ({
          sessionId: item.session.sessionId,
          label: `${item.session.title || item.session.locationName} ${item.session.attendanceDate}`
        })),
        records: (recordResult.records || []).map((record) => ({
          ...record,
          statusLabel: STATUS_LABELS[record.status] || record.status
        })),
        summary: recordResult.summary || null,
        leaves: (leaveResult.leaves || []).map((leave) => ({
          ...leave,
          statusLabel: LEAVE_STATUS_LABELS[leave.status] || leave.status,
          canCancel: leave.status === 'pending'
        })),
        leaveSessionIndex: 0
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '考勤信息加载失败。'
      });
    }
  },

  onLeaveSessionChange(event) {
    this.setData({ leaveSessionIndex: Number(event.detail.value) });
  },

  onLeaveReasonInput(event) {
    this.setData({ leaveReason: event.detail.value });
  },

  async checkIn(event) {
    const sessionId = event.currentTarget.dataset.sessionId;
    if (!sessionId || this.data.busySessionId) {
      return;
    }
    this.setData({ busySessionId: sessionId, error: '', checkInMessage: '' });

    const location = await new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        success: resolve,
        fail: (error) => resolve({ fail: true, error })
      });
    });
    if (location.fail) {
      this.setData({
        busySessionId: '',
        error:
          '无法获取当前位置。请在小程序设置中允许定位权限后重试；如仍无法签到，请联系教练人工核实。'
      });
      return;
    }

    try {
      const result = await api.checkInAttendance({
        sessionId,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy
      });
      const statusLabel = STATUS_LABELS[result.record.status] || result.record.status;
      this.setData({
        checkInMessage: result.duplicate
          ? `已存在签到记录：${statusLabel}`
          : `签到结果：${statusLabel}`,
        busySessionId: ''
      });
      wx.showToast({
        title: result.duplicate ? '已签到' : '签到已提交',
        icon: 'success'
      });
      await this.loadPage();
      this.setData({
        checkInMessage: result.duplicate
          ? `已存在签到记录：${statusLabel}`
          : `签到结果：${statusLabel}`
      });
    } catch (error) {
      this.setData({
        busySessionId: '',
        error: error.message || '签到失败，请稍后重试或联系教练。'
      });
    }
  },

  async submitLeave() {
    const selected = this.data.leaveSessionOptions[this.data.leaveSessionIndex];
    const reason = this.data.leaveReason.trim();
    if (!selected) {
      this.setData({ error: '请选择需要请假的训练场次。' });
      return;
    }
    if (!reason) {
      this.setData({ error: '请填写请假原因。' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      const result = await api.createLeave({
        clientRequestId: localRequestId(),
        sessionId: selected.sessionId,
        reason
      });
      wx.showToast({
        title: result.duplicate ? '已有待审批申请' : '请假已提交',
        icon: result.duplicate ? 'none' : 'success'
      });
      this.setData({ leaveReason: '' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '请假提交失败。' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async cancelLeave(event) {
    const leaveId = event.currentTarget.dataset.leaveId;
    if (!leaveId || this.data.busyLeaveId) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '确认撤销请假',
        content: '撤销后需重新提交请假申请。',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modal.confirm) {
      return;
    }
    this.setData({ busyLeaveId: leaveId, error: '' });
    try {
      await api.cancelLeave({ leaveId });
      wx.showToast({ title: '已撤销', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '撤销失败。' });
    } finally {
      this.setData({ busyLeaveId: '' });
    }
  },

  retry() {
    this.loadPage();
  }
});
