'use strict';

const api = require('../../services/api');
const {
  DEMO_MARKER,
  DEMO_NOTICE,
  buildDemoReport
} = require('../../demo/sport-report-demo');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');
const { isDemoAllowed, isDemoRequest } = require('../../utils/demo-mode');

function buildSeries(records, field) {
  return (records || [])
    .filter((item) => item[field] !== undefined && item[field] !== null)
    .map((item) => ({ date: item.date, value: item[field] }));
}

function formatMetric(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return `${value} ${unit}`;
  }
  if (unit === '秒' && number >= 60) {
    const minutes = Math.floor(number / 60);
    const seconds = Math.round((number % 60) * 100) / 100;
    return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  }
  return `${number} ${unit}`;
}

function decorateReport(report) {
  const performanceSeries = {};
  for (const [eventCode, series] of Object.entries(report.performanceSeries || {})) {
    performanceSeries[eventCode] = (series || []).map((item) => ({
      ...item,
      displayText: item.displayValue || formatMetric(item.value, item.unit)
    }));
  }
  return {
    ...report,
    performanceSeries,
    personalBests: (report.personalBests || []).map((item) => ({
      ...item,
      displayText: item.displayValue || formatMetric(item.value, item.unit)
    })),
    stageChanges: (report.stageChanges || []).map((item) => ({
      ...item,
      firstDisplayText: formatMetric(item.firstValue, item.unit),
      latestDisplayText: formatMetric(item.latestValue, item.unit),
      changeDisplayText: `${item.change > 0 ? '+' : ''}${item.change} ${item.unit}`
    })),
    targetComparison: report.targetComparison
      ? {
          ...report.targetComparison,
          targetDisplayText: formatMetric(
            report.targetComparison.targetValue,
            report.targetComparison.unit
          ),
          currentDisplayText: report.targetComparison.hasCurrentResult
            ? formatMetric(
                report.targetComparison.currentValue,
                report.targetComparison.unit
              )
            : '',
          differenceDisplayText: formatMetric(
            Math.abs(report.targetComparison.difference),
            report.targetComparison.unit
          )
        }
      : null
  };
}

function formatReportValue(item) {
  if (!item) {
    return '暂无';
  }
  const hasDisplay = Boolean(item.displayText || item.displayValue);
  const value = item.displayText || item.displayValue || item.value;
  return hasDisplay ? `${value}` : `${value} ${item.unit}`;
}

function buildOverview(report) {
  const profile = report.profile || {};
  const primaryCode = profile.primaryEventCode || '';
  const personalBests = report.personalBests || [];
  const stageChanges = report.stageChanges || [];
  const best =
    personalBests.find((item) => item.eventCode === primaryCode) ||
    personalBests[0] ||
    null;
  const change =
    stageChanges.find((item) => item.eventCode === primaryCode) ||
    stageChanges[0] ||
    null;
  const target = report.targetComparison || null;

  return {
    primaryEventName: profile.primaryEventName || '未设置',
    pbText: formatReportValue(best),
    changeText: change
      ? `${change.change > 0 ? '+' : ''}${change.change} ${change.unit}（${
          change.improved ? '提升' : '需关注'
        }）`
      : '暂无',
    targetText: target
      ? target.achieved
        ? '已达到目标'
        : `距离目标还差 ${
            target.differenceDisplayValue || Math.abs(target.difference)
          } ${target.unit}`
      : '未设置数值目标'
  };
}

Page({
  data: {
    loading: true,
    error: '',
    isCoachView: false,
    isDemoMode: false,
    demoRequested: false,
    demoMarker: '',
    demoNotice: '',
    targetUserId: '',
    report: null,
    overview: null,
    events: [],
    eventIndex: 0,
    selectedEvent: null,
    selectedSeries: [],
    heightSeries: [],
    weightSeries: []
  },

  onLoad(options) {
    this.setData({
      isCoachView: Boolean(options.userId),
      targetUserId: options.userId || '',
      demoRequested: isDemoRequest(options)
    });
    this.loadPage();
  },

  async loadPage() {
    this.setData({
      loading: true,
      error: '',
      report: null,
      overview: null,
      events: [],
      selectedEvent: null,
      selectedSeries: [],
      heightSeries: [],
      weightSeries: []
    });
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

      const report = await this.resolveReport(session);
      this.applyReport(report);
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '运动报告加载失败。'
      });
    }
  },

  async resolveReport(session) {
    if (
      this.data.demoRequested &&
      isDemoAllowed() &&
      sessionHasRole(session, 'developer')
    ) {
      const demoReport = buildDemoReport();
      this.setData({
        isDemoMode: true,
        demoMarker: DEMO_MARKER,
        demoNotice: DEMO_NOTICE
      });
      return demoReport;
    }

    this.setData({ isDemoMode: false, demoMarker: '', demoNotice: '' });
    const result = this.data.targetUserId
      ? await api.getStudentReport(this.data.targetUserId)
      : await api.getMyReport();
    return result.report;
  },

  applyReport(rawReport) {
    const report = decorateReport(rawReport);
    const events = report.supportedEvents || [];
    const selectedEvent =
      events.find(
        (item) => item.code === (report.profile.examGoal || {}).targetEventCode
      ) ||
      events.find(
        (item) => (report.performanceSeries[item.code] || []).length > 0
      ) ||
      events[0] ||
      null;
    const selectedIndex = selectedEvent
      ? events.findIndex((item) => item.code === selectedEvent.code)
      : 0;
    const selectedSeries = selectedEvent
      ? report.performanceSeries[selectedEvent.code] || []
      : [];

    this.setData({
      loading: false,
      eventIndex: Math.max(0, selectedIndex),
      report,
      overview: buildOverview(report),
      events,
      selectedEvent,
      selectedSeries,
      heightSeries: buildSeries(report.measurements, 'heightCm'),
      weightSeries: buildSeries(report.measurements, 'weightKg')
    });
  },

  onEventChange(event) {
    const index = Number(event.detail.value);
    const selectedEvent = this.data.events[index] || null;
    this.setData({
      eventIndex: index,
      selectedEvent,
      selectedSeries: selectedEvent
        ? this.data.report.performanceSeries[selectedEvent.code] || []
        : []
    });
  },

  reload() {
    this.loadPage();
  }
});
