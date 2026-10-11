'use strict';

const api = require('../../services/api');

Page({
  data: {
    bootstrapCode: '',
    submitting: false,
    error: '',
    message: ''
  },

  onInput(event) {
    this.setData({ bootstrapCode: event.detail.value });
  },

  async handleSubmit() {
    if (this.data.submitting || !this.data.bootstrapCode) {
      return;
    }
    this.setData({ submitting: true, error: '', message: '' });

    try {
      await api.bootstrapDeveloper(this.data.bootstrapCode);
      await getApp().ensureSession({ force: true });
      this.setData({
        submitting: false,
        bootstrapCode: '',
        message: '开发者初始化成功。'
      });
      wx.reLaunch({ url: '/pages/admin/admin' });
    } catch (error) {
      this.setData({
        submitting: false,
        bootstrapCode: '',
        error: error.message || '开发者初始化失败。'
      });
    }
  }
});
