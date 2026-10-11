const { CLOUD_ENV_ID } = require('./config/env');
const api = require('./services/api');

const SESSION_CACHE_KEY = 'joger_session_v1';

App({
  globalData: {
    cloudReady: false,
    cloudError: '',
    session: null,
    sessionTask: null,
    requireManualLogin: false
  },

  onLaunch() {
    try {
      if (!wx.cloud) {
        throw new Error('当前基础库不支持微信云开发。');
      }
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: true
      });
      this.globalData.cloudReady = true;
    } catch (error) {
      this.globalData.cloudReady = false;
      this.globalData.cloudError = error.message || '云开发初始化失败。';
    }
  },

  ensureSession({ force = false } = {}) {
    if (this.globalData.requireManualLogin && !force) {
      const error = new Error('请点击微信一键登录继续。');
      error.code = 'MANUAL_LOGIN_REQUIRED';
      return Promise.reject(error);
    }

    if (!this.globalData.cloudReady) {
      return Promise.reject(
        new Error(this.globalData.cloudError || '云开发尚未初始化。')
      );
    }

    if (!force && this.globalData.sessionTask) {
      return this.globalData.sessionTask;
    }

    const task = api
      .login()
      .then((result) => {
        const session = result.session;
        this.globalData.requireManualLogin = false;
        this.globalData.session = session;
        wx.setStorageSync(SESSION_CACHE_KEY, {
          session,
          savedAt: Date.now()
        });
        return session;
      })
      .catch((error) => {
        this.globalData.sessionTask = null;
        throw error;
      });

    this.globalData.sessionTask = task;
    return task;
  },

  clearSession() {
    this.globalData.requireManualLogin = true;
    this.globalData.session = null;
    this.globalData.sessionTask = null;
    wx.removeStorageSync(SESSION_CACHE_KEY);
  }
});
