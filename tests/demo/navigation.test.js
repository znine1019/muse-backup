'use strict';

/**
 * D1-B BUG-05｜DEMO 导航闭环与正式路由隔离回归测试
 *
 * 本文件直接加载页面脚本并调用页面方法，验证：
 *   1. 三个模拟角色从 DEMO 首页进入演示页；
 *   2. 页内模块、角色切换与详情返回只使用演示页路由；
 *   3. 退出模拟身份使用 reLaunch 回到 DEMO 首页并清理本地状态；
 *   4. 正式学生 / 教练员 / 家长 / 开发者工作台在 DEMO 会话下实际重定向；
 *   5. 正式业务 API 在 DEMO 导航过程中保持零调用。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SHOWCASE = require(path.join(PROJECT_ROOT, 'miniprogram/demo/showcase.js'));
const STORE = require(path.join(PROJECT_ROOT, 'miniprogram/demo/showcase-store.js'));
const SESSION = require(path.join(PROJECT_ROOT, 'miniprogram/utils/session.js'));
const DEMO_GUARD = require(path.join(PROJECT_ROOT, 'miniprogram/demo/demo-guard.js'));
const WORKBENCH_CONTROLLER = require(path.join(PROJECT_ROOT, 'miniprogram/utils/workbench-controller.js'));

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function flush() {
  let chain = Promise.resolve();
  for (let index = 0; index < 8; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return chain;
}

function withWx(stub, fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'wx');
  const previous = global.wx;
  global.wx = stub;
  try {
    return fn();
  } finally {
    if (had) {
      global.wx = previous;
    } else {
      delete global.wx;
    }
  }
}

function makeInstance(pageDefinition) {
  const instance = {
    data: JSON.parse(JSON.stringify(pageDefinition.data || {})),
    setData(update, callback) {
      for (const [key, value] of Object.entries(update || {})) {
        this.data[key] = value;
      }
      if (typeof callback === 'function') {
        callback();
      }
    }
  };
  for (const [key, value] of Object.entries(pageDefinition)) {
    if (typeof value === 'function') {
      instance[key] = value.bind(instance);
    }
  }
  return instance;
}

function loadShowcasePage() {
  let pageDefinition = null;
  const calls = { navigateTo: [], setStorageSync: [], showToast: [] };

  const wx = {
    navigateTo: (options) => calls.navigateTo.push(options.url),
    setStorageSync: (key, value) => calls.setStorageSync.push([key, value]),
    removeStorageSync: () => {},
    showToast: (options) => calls.showToast.push(options)
  };

  const showcaseModule = {
    ...SHOWCASE,
    saveActiveDemoRole: (role) => {
      if (SHOWCASE.isShowcaseRole(role)) {
        wx.setStorageSync(SHOWCASE.DEMO_SESSION_STORAGE_KEY, role);
      }
    }
  };

  vm.runInNewContext(
    read('miniprogram/pages/showcase/showcase.js'),
    {
      require: (request) => {
        if (request.includes('demo/showcase')) return showcaseModule;
        if (request.includes('demo/demo-guard')) {
          return {
            DEMO_MARKER: DEMO_GUARD.DEMO_MARKER,
            DEMO_NOTICE: DEMO_GUARD.DEMO_NOTICE
          };
        }
        throw new Error(`未打桩的依赖：${request}`);
      },
      Page: (value) => {
        pageDefinition = value;
      },
      wx,
      console,
      Date,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Promise,
      JSON
    },
    { filename: path.join(PROJECT_ROOT, 'miniprogram/pages/showcase/showcase.js') }
  );

  assert.ok(pageDefinition, 'DEMO 首页应注册 Page');
  return { instance: makeInstance(pageDefinition), calls };
}

function loadDemoPage(role, options = {}) {
  let pageDefinition = null;
  const calls = {
    navigateTo: [],
    navigateBack: [],
    reLaunch: [],
    removeStorageSync: [],
    pageScrollTo: [],
    cloudInit: 0,
    cloudCalls: []
  };

  const wx = {
    navigateTo: (options) => calls.navigateTo.push(options.url),
    navigateBack: (options) => calls.navigateBack.push(options || {}),
    reLaunch: (options) => calls.reLaunch.push(options.url),
    removeStorageSync: (key) => calls.removeStorageSync.push(key),
    pageScrollTo: (options) => calls.pageScrollTo.push(options || {}),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key) => (key === SHOWCASE.DEMO_SESSION_STORAGE_KEY ? role : ''),
    setStorageSync: () => {},
    showToast: () => {},
    cloud: {
      init: () => {
        calls.cloudInit += 1;
      },
      callFunction: (options) => {
        calls.cloudCalls.push(options);
        return Promise.resolve({ result: { ok: true, data: {} } });
      }
    }
  };

  const demoGuard = {
    ...DEMO_GUARD,
    checkDemoAccess: () => ({ ok: true, reason: '' }),
    clearDemoState: () => wx.removeStorageSync('demo_preview_state_v1')
  };

  const showcaseModule = {
    ...SHOWCASE,
    clearActiveDemoRole: () => wx.removeStorageSync(SHOWCASE.DEMO_SESSION_STORAGE_KEY)
  };

  vm.runInNewContext(
    read('miniprogram/pages/demo/demo.js'),
    {
      require: (request) => {
        if (request.includes('demo/demo-guard')) return demoGuard;
        if (request.includes('demo/student-demo')) {
          return require(path.join(PROJECT_ROOT, 'miniprogram/demo/student-demo.js'));
        }
        if (request.includes('demo/parent-demo')) {
          return require(path.join(PROJECT_ROOT, 'miniprogram/demo/parent-demo.js'));
        }
        if (request.includes('demo/coach-demo')) {
          return require(path.join(PROJECT_ROOT, 'miniprogram/demo/coach-demo.js'));
        }
        if (request.includes('demo/showcase-store')) return STORE;
        if (request.includes('demo/showcase')) return showcaseModule;
        if (request.includes('utils/session')) return SESSION;
        throw new Error(`未打桩的依赖：${request}`);
      },
      Page: (value) => {
        pageDefinition = value;
      },
      getApp: () => ({
        ensureSession: async () => SHOWCASE.buildDemoSession(role),
        globalData: { session: SHOWCASE.buildDemoSession(role) }
      }),
      wx,
      console,
      Date,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Promise,
      JSON,
      encodeURIComponent,
      getCurrentPages: () => new Array(options.pageStackDepth || 1).fill({})
    },
    { filename: path.join(PROJECT_ROOT, 'miniprogram/pages/demo/demo.js') }
  );

  assert.ok(pageDefinition, '演示页应注册 Page');
  return { instance: makeInstance(pageDefinition), calls };
}

function loadFormalPage(relativePath, demoRole) {
  let pageDefinition = null;
  const calls = { reLaunch: [], apiCalls: [] };
  const session = SHOWCASE.buildDemoSession(demoRole);

  const apiSpy = new Proxy(
    {},
    {
      get(target, key) {
        return (...args) => {
          calls.apiCalls.push({ method: String(key), args });
          return Promise.resolve({});
        };
      }
    }
  );

  const wx = {
    reLaunch: (options) => calls.reLaunch.push(options.url),
    stopPullDownRefresh: () => {},
    showToast: () => {},
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {}
  };

  const dependencies = {
    'services/api': apiSpy,
    'utils/session': SESSION,
    'utils/active-role': { clearActiveRole: () => {} },
    'utils/workbench-controller': WORKBENCH_CONTROLLER,
    'config/env': { CLOUD_ENV_ID: 'demo-env' },
    'utils/demo-mode': { isDemoAllowed: () => true }
  };

  vm.runInNewContext(
    read(relativePath),
    {
      require: (request) => {
        for (const [token, value] of Object.entries(dependencies)) {
          if (request.includes(token)) return value;
        }
        throw new Error(`未打桩的依赖：${request}`);
      },
      Page: (value) => {
        pageDefinition = value;
      },
      getApp: () => ({
        globalData: { session },
        ensureSession: async () => session
      }),
      wx,
      console,
      Date,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Promise,
      JSON
    },
    { filename: path.join(PROJECT_ROOT, relativePath) }
  );

  assert.ok(pageDefinition, `${relativePath} 应注册 Page`);
  return { instance: makeInstance(pageDefinition), calls, session };
}

test('BUG-05 导航｜三个模拟角色从 DEMO 首页进入演示页且不跳转正式工作台', () => {
  const { instance, calls } = loadShowcasePage();

  for (const role of ['student', 'coach', 'parent']) {
    instance.onRoleTap({ currentTarget: { dataset: { role } } });
  }

  assert.deepEqual(calls.navigateTo, [
    '/pages/demo/demo?role=student',
    '/pages/demo/demo?role=coach',
    '/pages/demo/demo?role=parent'
  ]);
  assert.deepEqual(
    calls.setStorageSync.map((item) => item[1]),
    ['student', 'coach', 'parent']
  );
  for (const url of calls.navigateTo) {
    assert.ok(url.startsWith('/pages/demo/demo'), `不得跳转正式页面：${url}`);
  }
});

test('BUG-05 导航｜三个角色均可进入、页内切换、查看详情并返回演示层', async () => {
  STORE.resetState();

  for (const role of ['student', 'coach', 'parent']) {
    const { instance, calls } = loadDemoPage(role);
    await instance.onLoad({ role });
    await flush();

    assert.equal(instance.data.ready, true, `${role} 应成功进入演示页：${instance.data.error}`);
    assert.equal(instance.data.role, role);
    assert.equal(instance.data.error, '');

    instance.goCatalog();
    instance.goWorkbench();

    if (role === 'parent') {
      instance.onStudentChange({ detail: { value: '1' } });
      assert.equal(instance.data.parent.studentIndex, 1);
      instance.onStudentChange({ detail: { value: '0' } });
    }
    if (role === 'coach') {
      instance.onCoachChange({ detail: { value: '1' } });
      assert.equal(instance.data.coach.coachIndex, 1);
    }

    const detail = role === 'parent' ? 'notice' : role === 'coach' ? 'leave' : 'notice';
    const id =
      role === 'parent'
        ? instance.data.parent.noticeRows[0].id
        : role === 'coach'
        ? instance.data.coach.pendingLeaves[0].leaveId
        : instance.data.student.notices[0].id;
    instance.openDetail({ currentTarget: { dataset: { detail, id } } });
    instance.goBackToList();

    for (const url of calls.navigateTo) {
      assert.ok(url.startsWith('/pages/demo/demo'), `${role} 页内导航不得离开演示页：${url}`);
    }
    assert.equal(calls.cloudInit, 0, `${role} 不得初始化云开发`);
    assert.deepEqual(calls.cloudCalls, [], `${role} 不得调用正式云函数`);
  }
});

test('BUG-05 导航｜退出任一模拟身份都 reLaunch DEMO 首页并清理演示状态', async () => {
  for (const role of ['student', 'coach', 'parent']) {
    const { instance, calls } = loadDemoPage(role);
    await instance.onLoad({ role });
    await flush();

    instance.goDemoHome();

    assert.deepEqual(calls.reLaunch, ['/pages/showcase/showcase'], `${role} 退出应回 DEMO 首页`);
    assert.deepEqual(calls.removeStorageSync, [
      'demo_preview_state_v1',
      SHOWCASE.DEMO_SESSION_STORAGE_KEY
    ]);
    assert.equal(calls.cloudCalls.length, 0);
  }
});

test('BUG-05 隔离｜DEMO 模拟会话不含正式角色，正式路由目的地统一为 DEMO 首页', () => {
  for (const role of ['student', 'coach', 'parent']) {
    const session = SHOWCASE.buildDemoSession(role);
    assert.deepEqual(session.user.roles, [], `${role} 模拟会话不得携带正式角色`);
    assert.equal(SESSION.sessionHasRole(session, role), false);
    assert.equal(SESSION.sessionHasRole(session, 'developer'), false);
    assert.equal(SESSION.getSessionDestination(session).url, '/pages/showcase/showcase');
  }

  assert.equal(SESSION.getSessionDestination(null).url, '/pages/showcase/showcase');
  assert.equal(
    SESSION.getSessionDestination({ user: { status: 'active', roles: ['student'] } }).url,
    '/pages/student/student',
    '非 DEMO 会话的原有正式路由语义必须保持不变'
  );
});

test('BUG-05 隔离｜正式学生/教练员/家长/开发者工作台在 DEMO 会话下实际重定向且零 API 调用', async () => {
  const pages = [
    ['miniprogram/pages/student/student.js', 'student'],
    ['miniprogram/pages/coach/coach.js', 'coach'],
    ['miniprogram/pages/parent/parent.js', 'parent'],
    ['miniprogram/pages/admin/admin.js', 'student']
  ];

  for (const [relativePath, demoRole] of pages) {
    const { instance, calls } = loadFormalPage(relativePath, demoRole);
    await instance.loadPage();
    await flush();

    assert.deepEqual(
      calls.reLaunch,
      ['/pages/showcase/showcase'],
      `${relativePath} 在 DEMO 会话下必须回到 DEMO 首页`
    );
    assert.deepEqual(calls.apiCalls, [], `${relativePath} 重定向前不得调用正式业务 API`);
  }
});

test('BUG-05 隔离｜未选择体验身份时 APP 会话仍为无角色访客并可安全退回', async () => {
  let appDefinition = null;
  const calls = { cloudInit: 0 };
  const wx = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    cloud: {
      init: () => {
        calls.cloudInit += 1;
      }
    }
  };

  vm.runInNewContext(
    read('miniprogram/app.js'),
    {
      require: (request) => {
        if (request.includes('config/env')) {
          return { CLOUD_ENV_ID: 'demo-env', API_FUNCTION_NAME: 'api', HEALTH_FUNCTION_NAME: 'health_check' };
        }
        if (request.includes('config/build-mode')) {
          return require(path.join(PROJECT_ROOT, 'miniprogram/config/build-mode.js'));
        }
        if (request.includes('demo/showcase')) return SHOWCASE;
        if (request.includes('services/api')) {
          return { login: () => Promise.reject(new Error('正式登录不得调用')) };
        }
        throw new Error(`未打桩的依赖：${request}`);
      },
      App: (value) => {
        appDefinition = value;
      },
      wx,
      console,
      Date,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Promise,
      JSON
    },
    { filename: path.join(PROJECT_ROOT, 'miniprogram/app.js') }
  );

  assert.ok(appDefinition, 'app.js 应注册 App');
  appDefinition.onLaunch();
  const session = await withWx(wx, () =>
    appDefinition.ensureSession.call(appDefinition, { force: true })
  );

  assert.equal(calls.cloudInit, 0);
  assert.deepEqual(session.user.roles, []);
  assert.equal(SHOWCASE.isDemoSession(session), false);
  assert.equal(DEMO_GUARD.checkDemoAccess(session).ok, false);
  assert.equal(SESSION.getSessionDestination(session).url, '/pages/showcase/showcase');
});
