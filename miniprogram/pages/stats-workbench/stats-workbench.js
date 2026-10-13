'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');
const { buildXlsxBase64 } = require('../../utils/xlsx-writer');

const PERIOD_TYPE_OPTIONS = Object.freeze([
  { value: 'month', label: '月度' },
  { value: 'quarter', label: '季度' },
  { value: 'year', label: '年度' }
]);
const ATTENDANCE_STATUS_LABELS = Object.freeze({
  checked_in: '已签到',
  late: '迟到',
  leave_approved: '已批准请假',
  pending_verification: '待核实',
  absent: '未签到',
  pending: '待签到',
  not_started: '未开始'
});
const LEAVE_STATUS_LABELS = Object.freeze({
  pending: '待审批',
  approved: '已批准',
  rejected: '已驳回',
  cancelled: '已撤销'
});

function buildYearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, index) => ({
    value: current - 2 + index,
    label: `${current - 2 + index}年`
  }));
}

function percentText(value) {
  if (value === null || value === undefined) {
    return '暂无有效统计';
  }
  return `${Math.round(Number(value) * 10000) / 100}%`;
}

Page({
  data: {
    loading: true,
    error: '',
    success: '',
    metaLoaded: false,
    role: '',
    periodTypeOptions: PERIOD_TYPE_OPTIONS,
    yearOptions: buildYearOptions(),
    monthOptions: Array.from({ length: 12 }, (_, index) => ({
      value: index + 1,
      label: `${index + 1}月`
    })),
    quarterOptions: [
      { value: 1, label: '第一季度' },
      { value: 2, label: '第二季度' },
      { value: 3, label: '第三季度' },
      { value: 4, label: '第四季度' }
    ],
    groups: [{ id: '', name: '全部授权训练组' }],
    groupIndex: 0,
    periodTypeIndex: 0,
    yearIndex: 2,
    monthIndex: new Date().getMonth(),
    quarterIndex: Math.floor(new Date().getMonth() / 3),
    overview: null,
    exporting: ''
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '', success: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (
        !sessionHasRole(session, 'coach') &&
        !sessionHasRole(session, 'developer')
      ) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      let groups = this.data.groups;
      let role = this.data.role;
      if (!this.data.metaLoaded) {
        const meta = await api.getStatisticsMeta();
        role = meta.role;
        groups = [
          { id: '', name: '全部授权训练组' },
          ...(meta.groups || []).filter((group) => group.enabled !== false)
        ];
      }
      const overview = await api.getManageStatistics(this.buildPeriodPayload());
      this.setData({
        metaLoaded: true,
        role,
        groups,
        groupIndex: Math.min(this.data.groupIndex, groups.length - 1),
        loading: false,
        overview: {
          ...overview,
          attendanceSummary: {
            ...overview.attendance.summary,
            attendanceRateText: percentText(
              overview.attendance.summary.attendanceRate
            )
          },
          groupComparison: (overview.groupComparison || []).map((group) => ({
            ...group,
            attendanceRateText: percentText(group.attendanceRate)
          }))
        }
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '统计工作台加载失败。'
      });
    }
  },

  buildPeriodPayload() {
    const group = this.data.groups[this.data.groupIndex];
    const periodType =
      this.data.periodTypeOptions[this.data.periodTypeIndex].value;
    const payload = {
      periodType,
      year: this.data.yearOptions[this.data.yearIndex].value,
      trainingGroupId: group.id || undefined
    };
    if (periodType === 'month') {
      payload.month = this.data.monthOptions[this.data.monthIndex].value;
    } else if (periodType === 'quarter') {
      payload.quarter = this.data.quarterOptions[this.data.quarterIndex].value;
    }
    return payload;
  },

  onGroupChange(event) {
    this.setData({ groupIndex: Number(event.detail.value) }, () => {
      this.loadPage();
    });
  },

  onPeriodTypeChange(event) {
    this.setData({ periodTypeIndex: Number(event.detail.value) }, () => {
      this.loadPage();
    });
  },

  onYearChange(event) {
    this.setData({ yearIndex: Number(event.detail.value) }, () => {
      this.loadPage();
    });
  },

  onMonthChange(event) {
    this.setData({ monthIndex: Number(event.detail.value) }, () => {
      this.loadPage();
    });
  },

  onQuarterChange(event) {
    this.setData({ quarterIndex: Number(event.detail.value) }, () => {
      this.loadPage();
    });
  },

  async writeXlsx(fileName, sheetName, rows) {
    const base64 = buildXlsxBase64(sheetName, rows);
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
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
  },

  async exportPerformance() {
    if (this.data.exporting) {
      return;
    }
    this.setData({ exporting: 'performance', error: '', success: '' });
    try {
      const result = await api.exportPerformanceRows(this.buildPeriodPayload());
      const rows = [
        ['学生姓名', '训练组', '负责教练', '运动项目', '成绩', '单位', '成绩发生日期', '审核状态', '审核时间']
      ];
      for (const row of result.rows || []) {
        rows.push([
          row.studentName,
          (row.trainingGroupNames || []).join('、'),
          (row.coachNames || []).join('、'),
          row.eventName,
          row.value,
          row.unit,
          row.achievedAt,
          row.status === 'approved' ? '已审核通过' : row.status,
          row.reviewedAt || ''
        ]);
      }
      await this.writeXlsx(
        `performance-${Date.now()}.xlsx`,
        '正式成绩',
        rows
      );
      this.setData({ success: `已生成${result.total}条正式成绩记录。` });
    } catch (error) {
      this.setData({ error: error.message || '成绩导出失败。' });
    } finally {
      this.setData({ exporting: '' });
    }
  },

  async exportAttendance() {
    if (this.data.exporting) {
      return;
    }
    this.setData({ exporting: 'attendance', error: '', success: '' });
    try {
      const result = await api.exportAttendanceRows(this.buildPeriodPayload());
      const rows = [
        ['训练组', '训练日期', '学生', '签到状态', '签到时间', '迟到情况', '请假状态', '人工核实结果']
      ];
      for (const row of result.rows || []) {
        rows.push([
          row.trainingGroupName,
          row.attendanceDate,
          row.studentName,
          ATTENDANCE_STATUS_LABELS[row.status] || row.status,
          row.checkInAt || '',
          row.late ? '迟到' : '未迟到',
          row.leaveStatus
            ? LEAVE_STATUS_LABELS[row.leaveStatus] || row.leaveStatus
            : '无',
          row.manualVerified ? '已人工核实' : '未人工核实'
        ]);
      }
      await this.writeXlsx(
        `attendance-${Date.now()}.xlsx`,
        '考勤记录',
        rows
      );
      this.setData({ success: `已生成${result.total}条考勤记录。` });
    } catch (error) {
      this.setData({ error: error.message || '考勤导出失败。' });
    } finally {
      this.setData({ exporting: '' });
    }
  },

  goPerformanceLeaderboard() {
    wx.navigateTo({ url: '/pages/performance-leaderboard/performance-leaderboard' });
  },

  goAttendanceStatistics() {
    wx.navigateTo({ url: '/pages/attendance-statistics/attendance-statistics' });
  },

  retry() {
    this.loadPage();
  }
});
