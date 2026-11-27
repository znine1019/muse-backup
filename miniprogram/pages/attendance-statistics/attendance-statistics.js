'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

const PERIOD_TYPE_OPTIONS = Object.freeze([
  { value: 'month', label: '月度' },
  { value: 'quarter', label: '季度' },
  { value: 'year', label: '年度' }
]);

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
    metaLoaded: false,
    role: '',
    groups: [{ id: '', name: '全部授权训练组' }],
    groupIndex: 0,
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
    periodTypeIndex: 0,
    yearIndex: 2,
    monthIndex: new Date().getMonth(),
    quarterIndex: Math.floor(new Date().getMonth() / 3),
    summary: null,
    rows: [],
    dataQuality: null,
    filterOpen: false,
    drawerRow: null
  },

  onOpenFilter() {
    this.setData({ filterOpen: true, drawerRow: null });
  },

  onCloseFilter() {
    this.setData({ filterOpen: false });
  },

  onOpenRowDrawer(event) {
    const idx = Number(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index);
    const row = (this.data.rows || [])[idx] || null;
    if (!row) {
      return;
    }
    this.setData({ drawerRow: row, filterOpen: false });
  },

  onCloseDrawer() {
    this.setData({ drawerRow: null, filterOpen: false });
  },

  noop() {},

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (
        !sessionHasRole(session, 'student') &&
        !sessionHasRole(session, 'coach') &&
        !sessionHasRole(session, 'developer')
      ) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      if (!this.data.metaLoaded) {
        const meta = await api.getStatisticsMeta();
        const groups = [
          { id: '', name: '全部授权训练组' },
          ...(meta.groups || []).filter((group) => group.enabled !== false)
        ];
        this.setData({
          metaLoaded: true,
          role: meta.role,
          groups
        });
      }
      await this.loadLeaderboard();
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '考勤统计加载失败。'
      });
    }
  },

  async loadLeaderboard() {
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
    const result = await api.getAttendanceLeaderboard(payload);
    const summary = {
      ...result.summary,
      attendanceRateText: percentText(result.summary.attendanceRate),
      lateRateText: percentText(result.summary.lateRate)
    };
    this.setData({
      loading: false,
      summary,
      rows: (result.rows || []).map((row) => ({
        ...row,
        attendanceRateText: percentText(row.attendanceRate),
        lateRateText: percentText(row.lateRate),
        rankText: !row.formalRankingAllowed
          ? '数据受限'
          : row.rank === null
            ? '样本不足'
            : `第${row.rank}名`
      })),
      dataQuality: result.dataQuality
    });
  },

  onGroupChange(event) {
    this.setData({ groupIndex: Number(event.detail.value) }, () => {
      this.loadLeaderboard();
    });
  },

  onPeriodTypeChange(event) {
    this.setData({ periodTypeIndex: Number(event.detail.value) }, () => {
      this.loadLeaderboard();
    });
  },

  onYearChange(event) {
    this.setData({ yearIndex: Number(event.detail.value) }, () => {
      this.loadLeaderboard();
    });
  },

  onMonthChange(event) {
    this.setData({ monthIndex: Number(event.detail.value) }, () => {
      this.loadLeaderboard();
    });
  },

  onQuarterChange(event) {
    this.setData({ quarterIndex: Number(event.detail.value) }, () => {
      this.loadLeaderboard();
    });
  },

  retry() {
    this.loadPage();
  }
});
