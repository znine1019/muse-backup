'use strict';

const api = require('../../services/api');
const { getSessionDestination } = require('../../utils/session');

const EMPTY_FORM = Object.freeze({
  name: '',
  gender: 'unspecified',
  birthDate: '',
  heightCm: '',
  weightKg: '',
  primaryTrainingProject: '',
  requestedTrainingGroupId: ''
});

Page({
  data: {
    loading: true,
    submitting: false,
    error: '',
    form: { ...EMPTY_FORM },
    genderOptions: [
      { value: 'male', label: '男' },
      { value: 'female', label: '女' },
      { value: 'unspecified', label: '未说明' }
    ],
    genderIndex: 2,
    groupOptions: [{ id: '', name: '暂不申请训练组' }],
    groupIndex: 0,
    maxDate: new Date().toISOString().slice(0, 10)
  },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await getApp().ensureSession({ force: true });
      if (session.user.status === 'pending_review') {
        wx.reLaunch({ url: '/pages/pending/pending' });
        return;
      }
      if (session.user.status === 'active') {
        wx.reLaunch({ url: getSessionDestination(session).url });
        return;
      }

      const [groupResult, profileResult] = await Promise.all([
        api.listTrainingGroups(),
        api.getProfile().catch(() => ({ profile: null }))
      ]);
      const groupOptions = [
        { id: '', name: '暂不申请训练组' },
        ...(groupResult.groups || [])
      ];
      const profile = (profileResult && profileResult.profile) || {};
      const form = {
        ...EMPTY_FORM,
        ...profile,
        heightCm: profile.heightCm === undefined ? '' : String(profile.heightCm),
        weightKg: profile.weightKg === undefined ? '' : String(profile.weightKg)
      };
      const genderIndex = Math.max(
        0,
        this.data.genderOptions.findIndex((item) => item.value === form.gender)
      );
      const groupIndex = Math.max(
        0,
        groupOptions.findIndex((item) => item.id === form.requestedTrainingGroupId)
      );

      this.setData({
        loading: false,
        form,
        genderIndex,
        groupOptions,
        groupIndex
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '注册资料加载失败。'
      });
    }
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  onGenderChange(event) {
    const genderIndex = Number(event.detail.value);
    this.setData({
      genderIndex,
      'form.gender': this.data.genderOptions[genderIndex].value
    });
  },

  onBirthDateChange(event) {
    this.setData({ 'form.birthDate': event.detail.value });
  },

  onGroupChange(event) {
    const groupIndex = Number(event.detail.value);
    this.setData({
      groupIndex,
      'form.requestedTrainingGroupId': this.data.groupOptions[groupIndex].id
    });
  },

  async handleSubmit() {
    if (this.data.submitting) {
      return;
    }
    this.setData({ submitting: true, error: '' });

    try {
      await api.submitProfile(this.data.form);
      wx.reLaunch({ url: '/pages/pending/pending' });
    } catch (error) {
      this.setData({
        submitting: false,
        error: error.message || '提交失败，请检查后重试。'
      });
    }
  }
});
