const { CLOUD_ENV_ID } = require('./config/env');
const api = require('./services/api');

const SESSION_CACHE_KEY = 'joger_session_v1';

/* Reuse a recently validated session; the server still authorizes every request. */
const SESSION_REUSE_MS = 30000;
const FORCED_SESSION_REUSE_MS = 10000;

App({
  globalData: {
    cloudReady: false,
    cloudError: '',
    session: null,
    sessionTask: null,
    sessionValidatedAt: 0,
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
      /* Start authentication without blocking first render. */
      const prefetch = this.ensureSession({ force: true });
      if (prefetch && typeof prefetch.catch === 'function') {
        prefetch.catch(() => null);
      }
    } catch (error) {
      this.globalData.cloudReady = false;
      this.globalData.cloudError = error.message || '云开发初始化失败。';
    }
  },

  ensureSession({ force = false, refresh = false } = {}) {
    if (this.globalData.requireManualLogin && !refresh) {
      const error = new Error('请点击微信一键登录继续。');
      error.code = 'MANUAL_LOGIN_REQUIRED';
      return Promise.reject(error);
    }

    if (!this.globalData.cloudReady) {
      return Promise.reject(
        new Error(this.globalData.cloudError || '云开发尚未初始化。')
      );
    }

    /* Share one in-flight auth request across startup and page transitions. */
    if (this.globalData.sessionTask) {
      return this.globalData.sessionTask;
    }

    const now = Date.now();
    const age = this.globalData.sessionValidatedAt
      ? now - this.globalData.sessionValidatedAt
      : Number.MAX_SAFE_INTEGER;
    const reuseWindow = force ? FORCED_SESSION_REUSE_MS : SESSION_REUSE_MS;

    if (this.globalData.session && !refresh && age < reuseWindow) {
      return Promise.resolve(this.globalData.session);
    }

    let task;
    task = api
      .login()
      .then((result) => {
        const session = result.session;
        this.globalData.requireManualLogin = false;
        this.globalData.session = session;
        this.globalData.sessionValidatedAt = Date.now();
        wx.setStorageSync(SESSION_CACHE_KEY, {
          session,
          savedAt: this.globalData.sessionValidatedAt
        });
        return session;
      })
      .catch((error) => {
        this.globalData.sessionTask = null;
        throw error;
      })
      .finally(() => {
        if (this.globalData.sessionTask === task) {
          this.globalData.sessionTask = null;
        }
      });

    this.globalData.sessionTask = task;
    return task;
  },

  clearSession() {
    this.globalData.requireManualLogin = true;
    this.globalData.session = null;
    this.globalData.sessionTask = null;
    this.globalData.sessionValidatedAt = 0;
    wx.removeStorageSync(SESSION_CACHE_KEY);
    if (typeof api.resetRequestCache === 'function') {
      api.resetRequestCache();
    }
  }
});
