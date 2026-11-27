'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');
const { formatPerformanceValue } = require('../../utils/performance-format');

const PERIOD_TYPE_OPTIONS = Object.freeze([
  { value: 'month', label: '月度' },
  { value: 'quarter', label: '季度' },
  { value: 'year', label: '年度' }
]);

function formatValue(value, unit) {
  return formatPerformanceValue(value, unit);
}

function buildYearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, index) => ({
    value: current - 2 + index,
    label: `${current - 2 + index}年`
  }));
}

Page({
  data: {
    loading: true,
    error: '',
    metaLoaded: false,
    role: '',
    events: [],
    groups: [],
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
    eventIndex: 0,
    groupOptions: [{ id: '', name: '全部授权训练组' }],
    groupIndex: 0,
    periodTypeIndex: 0,
    yearIndex: 2,
    monthIndex: new Date().getMonth(),
    quarterIndex: Math.floor(new Date().getMonth() / 3),
    leaderboard: null,
    rows: [],
    uiDaylight: false,
    rankScanning: false
  },

  onShow() {
    this.loadPage();
  },

  onHide() {
    this.clearScanTimer();
  },

  onUnload() {
    this.clearScanTimer();
  },

  clearScanTimer() {
    if (this._scanTimer) {
      if (typeof clearTimeout === 'function') {
        clearTimeout(this._scanTimer);
      }
      this._scanTimer = null;
    }
  },

  triggerScan() {
    this.clearScanTimer();
    this.setData({ rankScanning: true });
    if (typeof setTimeout === 'function') {
      this._scanTimer = setTimeout(() => {
        this._scanTimer = null;
        this.setData({ rankScanning: false });
      }, 500);
    } else {
      this.setData({ rankScanning: false });
    }
  },

  onToggleDaylight() {
    this.setData({ uiDaylight: !this.data.uiDaylight });
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
          events: meta.events || [],
          groups,
          groupOptions: groups,
          eventIndex: 0,
          groupIndex: 0
        });
      }
      await this.loadLeaderboard();
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '成绩排行榜加载失败。'
      });
    }
  },

  async loadLeaderboard() {
    if (!this.data.events.length) {
      this.setData({ loading: false, rows: [], leaderboard: null });
      return;
    }
    const event = this.data.events[this.data.eventIndex];
    const group = this.data.groupOptions[this.data.groupIndex];
    const periodType =
      this.data.periodTypeOptions[this.data.periodTypeIndex].value;
    const year = this.data.yearOptions[this.data.yearIndex].value;
    const payload = {
      eventCode: event.code,
      periodType,
      year,
      trainingGroupId: group.id || undefined
    };
    if (periodType === 'month') {
      payload.month = this.data.monthOptions[this.data.monthIndex].value;
    } else if (periodType === 'quarter') {
      payload.quarter = this.data.quarterOptions[this.data.quarterIndex].value;
    }
    const result = await api.getPerformanceLeaderboard(payload);
    this.setData({
      loading: false,
      leaderboard: result,
      rows: (result.rows || []).map((row) => ({
        ...row,
        valueText: formatValue(row.value, row.unit),
        historicalText: row.historicalPersonalBest
          ? formatValue(
              row.historicalPersonalBest.value,
              row.historicalPersonalBest.unit
            )
          : '暂无'
      }))
    });
  },

  onEventChange(event) {
    this.setData({ eventIndex: Number(event.detail.value) }, () => {
      this.triggerScan();
      this.loadLeaderboard();
    });
  },

  onGroupChange(event) {
    this.setData({ groupIndex: Number(event.detail.value) }, () => {
      this.triggerScan();
      this.loadLeaderboard();
    });
  },

  onPeriodTypeChange(event) {
    this.setData({ periodTypeIndex: Number(event.detail.value) }, () => {
      this.triggerScan();
      this.loadLeaderboard();
    });
  },

  onYearChange(event) {
    this.setData({ yearIndex: Number(event.detail.value) }, () => {
      this.triggerScan();
      this.loadLeaderboard();
    });
  },

  onMonthChange(event) {
    this.setData({ monthIndex: Number(event.detail.value) }, () => {
      this.triggerScan();
      this.loadLeaderboard();
    });
  },

  onQuarterChange(event) {
    this.setData({ quarterIndex: Number(event.detail.value) }, () => {
      this.triggerScan();
      this.loadLeaderboard();
    });
  },

  retry() {
    this.loadPage();
  }
});
