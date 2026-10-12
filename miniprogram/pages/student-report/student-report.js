'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

function buildSeries(records, field) {
  return (records || [])
    .filter((item) => item[field] !== undefined && item[field] !== null)
    .map((item) => ({ date: item.date, value: item[field] }));
}

Page({
  data: {
    loading: true,
    error: '',
    isCoachView: false,
    report: null,
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
      targetUserId: options.userId || ''
    });
    this.loadPage();
  },

  async loadPage() {
    this.setData({
      loading: true,
      error: '',
      report: null,
      events: [],
      selectedEvent: null,
      selectedSeries: [],
      heightSeries: [],
      weightSeries: []
    });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'student') && !sessionHasRole(session, 'coach') && !sessionHasRole(session, 'developer')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }

      const result = this.data.targetUserId
        ? await api.getStudentReport(this.data.targetUserId)
        : await api.getMyReport();
      const report = result.report;
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
        events,
        selectedEvent,
        selectedSeries,
        heightSeries: buildSeries(report.measurements, 'heightCm'),
        weightSeries: buildSeries(report.measurements, 'weightKg')
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '运动报告加载失败。'
      });
    }
  },

  reload() {
    this.loadPage();
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
  }
});
