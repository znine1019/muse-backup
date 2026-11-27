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
const YEAR_OPTIONS = Object.freeze(
  Array.from({ length: 5 }, (_, index) => {
    const year = new Date().getFullYear() - 2 + index;
    return { value: year, label: `${year}年` };
  })
);

function percentText(value) {
  if (value === null || value === undefined) {
    return '暂无有效统计';
  }
  return `${Math.round(Number(value) * 10000) / 100}%`;
}

function formatMetric(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return `${value} ${unit || ''}`.trim();
  }
  if (unit === '秒' && number >= 60) {
    const minutes = Math.floor(number / 60);
    const seconds = Math.round((number % 60) * 100) / 100;
    return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  }
  return `${number} ${unit || ''}`.trim();
}

function decoratePerformanceItem(item) {
  return {
    ...item,
    displayText: formatMetric(item.value, item.unit),
    date: item.date || item.achievedAt
  };
}

Page({
  data: {
    loading: true,
    error: '',
    periodTypeOptions: PERIOD_TYPE_OPTIONS,
    yearOptions: YEAR_OPTIONS,
    periodTypeIndex: 0,
    yearIndex: 2,
    monthOptions: Array.from({ length: 12 }, (_, index) => ({
      value: index + 1,
      label: `${index + 1}月`
    })),
    monthIndex: new Date().getMonth(),
    quarterOptions: [
      { value: 1, label: '第一季度' },
      { value: 2, label: '第二季度' },
      { value: 3, label: '第三季度' },
      { value: 4, label: '第四季度' }
    ],
    quarterIndex: Math.floor(new Date().getMonth() / 3),
    data: null,
    rpeSeries: [],
    filterOpen: false
  },

  onOpenFilter() {
    this.setData({ filterOpen: true });
  },

  onCloseFilter() {
    this.setData({ filterOpen: false });
  },

  onCloseDrawer() {
    this.setData({ filterOpen: false });
  },

  noop() {},

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '', data: null, rpeSeries: [] });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'student')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }
      const year = this.data.yearOptions[this.data.yearIndex].value;
      const periodType = this.data.periodTypeOptions[this.data.periodTypeIndex].value;
      const payload = { periodType, year };
      if (periodType === 'month') {
        payload.month = this.data.monthOptions[this.data.monthIndex].value;
      } else if (periodType === 'quarter') {
        payload.quarter = this.data.quarterOptions[this.data.quarterIndex].value;
      }
      const result = await api.getMyStatistics(payload);
      const data = {
        ...result,
        attendanceRateText: percentText(result.attendance.attendanceRate),
        lateRateText: percentText(result.attendance.lateRate),
        personalBests: (result.performance.personalBests || []).map((item) => ({
          ...item,
          displayText: formatMetric(item.value, item.unit)
        })),
        latestPerformances: (result.performance.latestPerformances || []).map(
          (item) => ({
            ...item,
            displayText: formatMetric(item.value, item.unit)
          })
        ),
        stageChanges: (result.performance.stageChanges || []).map((item) => ({
          ...item,
          firstDisplayText: formatMetric(item.firstValue, item.unit),
          latestDisplayText: formatMetric(item.latestValue, item.unit),
          changeDisplayText: `${item.change > 0 ? '+' : ''}${item.change} ${item.unit}`
        })),
        targetComparison: result.performance.targetComparison
          ? {
              ...result.performance.targetComparison,
              targetDisplayText: formatMetric(
                result.performance.targetComparison.targetValue,
                result.performance.targetComparison.unit
              ),
              currentDisplayText:
                result.performance.targetComparison.hasCurrentResult
                  ? formatMetric(
                      result.performance.targetComparison.currentValue,
                      result.performance.targetComparison.unit
                    )
                  : ''
            }
          : null
      };
      this.setData({
        loading: false,
        data,
        rpeSeries: (result.feedback.recentRpe || []).map((item) => ({
          date: item.date,
          value: item.value
        }))
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '个人训练统计加载失败。'
      });
    }
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

  goPerformanceLeaderboard() {
    wx.navigateTo({ url: '/pages/performance-leaderboard/performance-leaderboard' });
  },

  goAttendanceStatistics() {
    wx.navigateTo({ url: '/pages/attendance-statistics/attendance-statistics' });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/student-report/student-report' });
  },

  retry() {
    this.loadPage();
  }
});
