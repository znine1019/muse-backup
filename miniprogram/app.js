const { CLOUD_ENV_ID } = require('./config/env');
const { IS_DEMO_BUILD } = require('./config/build-mode');
const {
  buildDemoSession,
  buildDemoVisitorSession,
  clearActiveDemoRole,
  readActiveDemoRole
} = require('./demo/showcase');
const api = require('./services/api');

const SESSION_CACHE_KEY = 'joger_session_v1';

App({
  globalData: {
    cloudReady: false,
    cloudError: '',
    session: null,
    sessionTask: null,
    requireManualLogin: false,
    /* DEMO 构建：不初始化云开发，仅使用本地模拟会话 */
    demoBuild: IS_DEMO_BUILD
  },

  onLaunch() {
    /*
     * DEMO 构建：**故意不初始化云开发**。
     * 这是隔离方案的第一道防线：没有 wx.cloud.init，就不存在到正式环境的通道；
     * 第二道防线在 services/api.js（DEMO 构建下直接拒绝任何云函数调用）。
     */
    if (IS_DEMO_BUILD) {
      this.globalData.cloudReady = false;
      this.globalData.cloudError = 'DEMO 构建未连接云开发（预期行为）。';
      return;
    }

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
    /*
     * DEMO 构建：直接返回本地模拟会话。
     * 不调用 api.login()、不要求真实微信角色、不写正式会话缓存。
     */
    if (IS_DEMO_BUILD) {
      const demoSession = buildDemoSession(readActiveDemoRole());
      /*
       * 未选择身份时也返回一个无角色的 DEMO 会话。
       * 正式页面会因角色校验失败统一退回 DEMO 首页，而不会停留在正式路由上。
       */
      const session = demoSession || buildDemoVisitorSession();
      this.globalData.session = session;
      return Promise.resolve(session);
    }

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
    if (IS_DEMO_BUILD) {
      /* 只清理本地演示身份，不触碰任何正式会话 */
      this.globalData.session = null;
      this.globalData.sessionTask = null;
      clearActiveDemoRole();
      return;
    }

    this.globalData.requireManualLogin = true;
    this.globalData.session = null;
    this.globalData.sessionTask = null;
    wx.removeStorageSync(SESSION_CACHE_KEY);
  }
});
