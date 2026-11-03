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
    targetEventOptions: [],
    targetEventIndex: 0,
    secondaryEvents: [],
    trainingStartYear: '',
    trainingExperienceSummary: '',
    examGoal: {
      targetEventCode: '',
      targetValue: '',
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
      const activeEvents = (eventResult.events || []).map((event) => ({
        ...event,
        label: `${event.categoryLabel || '运动项目'} · ${event.name}`
      }));
      const referencedCodes = new Set([
        profile.primaryEventCode || '',
        ...(profile.secondaryEventCodes || []),
        (profile.examGoal || {}).targetEventCode || ''
      ].filter(Boolean));
      const legacyEvents = (eventResult.legacyEvents || [])
        .filter((event) => referencedCodes.has(event.code))
        .map((event) => ({ ...event, label: `历史兼容 · ${event.name}` }));
      const events = activeEvents.concat(legacyEvents);
      const primaryIndex = Math.max(
        0,
        events.findIndex((event) => event.code === profile.primaryEventCode)
      );
      const secondaryCodes = new Set(profile.secondaryEventCodes || []);
      const targetEventOptions = [
        { code: '', name: '暂不设置数值化目标', label: '暂不设置数值化目标' },
        ...events
      ];
      const targetEventCode = (profile.examGoal || {}).targetEventCode || '';
      const matchedTargetIndex = targetEventCode
        ? targetEventOptions.findIndex((event) => event.code === targetEventCode)
        : 0;
      const targetIndex = matchedTargetIndex > 0 ? matchedTargetIndex : 0;

      this.setData({
        loading: false,
        events,
        targetEventOptions,
        primaryEventIndex: primaryIndex,
        targetEventIndex: targetIndex,
        secondaryEvents: events.map((event) => ({
          ...event,
          checked: secondaryCodes.has(event.code)
        })),
        trainingStartYear: profile.trainingStartYear || '',
        trainingExperienceSummary: profile.trainingExperienceSummary || '',
        examGoal: {
          targetEventCode: '',
          targetValue: '',
          targetScore: '',
          examYear: '',
          targetSchool: '',
          note: '',
          ...(profile.examGoal || {})
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

  onTargetEventChange(event) {
    this.setData({ targetEventIndex: Number(event.detail.value) });
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

  buildProfilePayload() {
    const primary = this.data.events[this.data.primaryEventIndex];
    const secondaryEventCodes = this.data.secondaryEvents
      .filter((event) => event.checked)
      .map((event) => event.code);
    const targetEvent =
      this.data.targetEventOptions[this.data.targetEventIndex] || null;
    const examGoal = {
      ...this.data.examGoal,
      targetEventCode: targetEvent ? targetEvent.code : ''
    };
    if (!examGoal.targetEventCode) {
      examGoal.targetValue = '';
    }
    // targetUnit/targetComparison 由服务端按项目目录派生，客户端不提交。
    return {
      primaryEventCode: primary ? primary.code : '',
      secondaryEventCodes,
      trainingStartYear: this.data.trainingStartYear,
      trainingExperienceSummary: this.data.trainingExperienceSummary,
      examGoal
    };
  },

  async saveProfile() {
    this.setData({ saving: true, error: '' });
    try {
      await api.updateStudentProfile(this.buildProfilePayload());
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
