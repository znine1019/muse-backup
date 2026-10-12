'use strict';

const api = require('../../services/api');
const {
  getSessionDestination,
  sessionHasRole
} = require('../../utils/session');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

Page({
  data: {
    loading: true,
    saving: false,
    error: '',
    events: [],
    primaryEventIndex: 0,
    secondaryEvents: [],
    trainingStartYear: '',
    trainingExperienceSummary: '',
    examGoal: {
      targetScore: '',
      examYear: '',
      targetSchool: '',
      note: ''
    },
    measurementHeight: '',
    measurementWeight: '',
    measuredAt: todayIso(),
    measurements: []
  },

  onLoad() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (!sessionHasRole(session, 'student')) {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }

      const [profileResult, eventResult, measurementResult] = await Promise.all([
        api.getProfile(),
        api.listPerformanceEvents(),
        api.listMeasurements()
      ]);
      const profile = profileResult.profile || {};
      const events = eventResult.events || [];
      const primaryIndex = Math.max(
        0,
        events.findIndex((event) => event.code === profile.primaryEventCode)
      );
      const secondaryCodes = new Set(profile.secondaryEventCodes || []);

      this.setData({
        loading: false,
        events,
        primaryEventIndex: primaryIndex,
        secondaryEvents: events.map((event) => ({
          ...event,
          checked: secondaryCodes.has(event.code)
        })),
        trainingStartYear: profile.trainingStartYear || '',
        trainingExperienceSummary: profile.trainingExperienceSummary || '',
        examGoal: profile.examGoal || {
          targetScore: '',
          examYear: '',
          targetSchool: '',
          note: ''
        },
        measurementHeight: profile.currentHeightCm || profile.heightCm || '',
        measurementWeight: profile.currentWeightKg || profile.weightKg || '',
        measurements: measurementResult.measurements || []
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '档案加载失败。'
      });
    }
  },

  onPrimaryEventChange(event) {
    this.setData({ primaryEventIndex: Number(event.detail.value) });
  },

  onSecondaryEventChange(event) {
    const selected = new Set(event.detail.value || []);
    this.setData({
      secondaryEvents: this.data.secondaryEvents.map((item) => ({
        ...item,
        checked: selected.has(item.code)
      }))
    });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value });
  },

  onExamGoalInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({
      examGoal: {
        ...this.data.examGoal,
        [field]: event.detail.value
      }
    });
  },

  async saveProfile() {
    this.setData({ saving: true, error: '' });
    const primary = this.data.events[this.data.primaryEventIndex];
    const secondaryEventCodes = this.data.secondaryEvents
      .filter((event) => event.checked)
      .map((event) => event.code);
    try {
      await api.updateStudentProfile({
        primaryEventCode: primary ? primary.code : '',
        secondaryEventCodes,
        trainingStartYear: this.data.trainingStartYear,
        trainingExperienceSummary: this.data.trainingExperienceSummary,
        examGoal: this.data.examGoal
      });
      wx.showToast({ title: '档案已保存', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '档案保存失败。' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async addMeasurement() {
    this.setData({ saving: true, error: '' });
    try {
      await api.addMeasurement({
        heightCm: this.data.measurementHeight,
        weightKg: this.data.measurementWeight,
        measuredAt: this.data.measuredAt
      });
      wx.showToast({ title: '记录已保存', icon: 'success' });
      await this.loadPage();
    } catch (error) {
      this.setData({ error: error.message || '身体记录保存失败。' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
