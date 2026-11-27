'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function loadApp(login) {
  let app = null;
  let resetCalls = 0;
  vm.runInNewContext(
    read('miniprogram/app.js'),
    {
      require: (request) => {
        if (request.includes('config/env')) {
          return { CLOUD_ENV_ID: 'cloud1-d8g0egkli3191959a' };
        }
        if (request.includes('services/api')) {
          return {
            login,
            resetRequestCache: () => {
              resetCalls += 1;
            }
          };
        }
        throw new Error(`Unexpected dependency: ${request}`);
      },
      App: (definition) => {
        app = definition;
      },
      wx: {
        cloud: { init: () => {} },
        setStorageSync: () => {},
        removeStorageSync: () => {}
      },
      Date,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Promise,
      JSON,
      console
    },
    { filename: path.join(PROJECT_ROOT, 'miniprogram/app.js') }
  );
  assert.ok(app);
  return {
    app,
    resetCalls: () => resetCalls
  };
}

function loadApi(callFunction) {
  let api = null;
  api = vm.runInNewContext(
    read('miniprogram/services/api.js'),
    {
      module: { exports: {} },
      require: (request) => {
        if (request.includes('config/env')) {
          return {
            API_FUNCTION_NAME: 'api',
            HEALTH_FUNCTION_NAME: 'health_check'
          };
        }
        if (request.includes('utils/active-role')) {
          return {
            readActiveRole: () => '',
            sessionToken: () => 'current-user'
          };
        }
        throw new Error(`Unexpected dependency: ${request}`);
      },
      getApp: () => ({
        globalData: {
          session: {
            registered: true,
            user: { id: 'u1', status: 'active', roles: ['developer'] }
          }
        }
      }),
      wx: { cloud: { callFunction } },
      Promise,
      Error,
      JSON,
      Object,
      String,
      Number,
      console
    },
    { filename: path.join(PROJECT_ROOT, 'miniprogram/services/api.js') }
  );
  assert.ok(api);
  return api;
}

function cloneDefinition(definition) {
  return {
    ...definition,
    globalData: JSON.parse(JSON.stringify(definition.globalData))
  };
}

test('V1.6.2 UX 启动不阻塞渲染，并合并页面会话请求', async () => {
  let loginCalls = 0;
  const { app } = loadApp(
    () =>
      new Promise((resolve) => {
        loginCalls += 1;
        setTimeout(
          () =>
            resolve({
              session: {
                registered: false,
                user: { id: '', status: 'unregistered', roles: [] }
              }
            }),
          40
        );
      })
  );
  const instance = cloneDefinition(app);
  const started = Date.now();
  instance.onLaunch.call(instance);
  const launchDuration = Date.now() - started;

  assert.equal(loginCalls, 1);
  assert.ok(launchDuration < 30, 'onLaunch 不应等待 auth.login 完成');

  const sessions = await Promise.all([
    instance.ensureSession.call(instance, { force: true }),
    instance.ensureSession.call(instance, { force: true }),
    instance.ensureSession.call(instance, { force: true })
  ]);
  assert.equal(loginCalls, 1);
  assert.equal(sessions.every((session) => session.user.status === 'unregistered'), true);

  const cached = await instance.ensureSession.call(instance, { force: true });
  assert.equal(cached.user.status, 'unregistered');
  assert.equal(loginCalls, 1, '短时间内的页面进入应复用已校验会话');

  await instance.ensureSession.call(instance, { force: true, refresh: true });
  assert.equal(loginCalls, 2, '显式登录刷新必须重新校验会话');
});

test('V1.6.2 UX 退出会清空会话缓存并递增请求代次', async () => {
  let loginCalls = 0;
  const { app, resetCalls } = loadApp(async () => {
    loginCalls += 1;
    return {
      session: {
        registered: true,
        user: { id: 'u1', status: 'active', roles: ['developer'] }
      }
    };
  });
  const instance = cloneDefinition(app);
  instance.globalData.cloudReady = true;
  await instance.ensureSession.call(instance);
  assert.equal(loginCalls, 1);

  instance.clearSession.call(instance);
  assert.equal(instance.globalData.session, null);
  assert.equal(instance.globalData.sessionValidatedAt, 0);
  assert.equal(resetCalls(), 1);
});

test('V1.6.2 UX 相同只读请求在途合并，完成后不持久缓存', async () => {
  let calls = 0;
  const api = loadApi(async ({ data }) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      result: {
        ok: true,
        data: { action: data.action }
      }
    };
  });

  const [first, second] = await Promise.all([api.listUsers(), api.listUsers()]);
  assert.equal(calls, 1);
  assert.equal(first.action, 'admin.list_users');
  assert.equal(second.action, 'admin.list_users');

  await api.listUsers();
  assert.equal(calls, 2, '请求完成后不得使用旧结果掩盖服务端状态变化');
});

test('V1.6.2 UX 写操作不会依赖客户端请求合并', async () => {
  let calls = 0;
  const api = loadApi(async () => {
    calls += 1;
    return { result: { ok: true, data: { success: true } } };
  });

  await Promise.all([
    api.setUserStatus({ targetUserId: 'u2', status: 'disabled' }),
    api.setUserStatus({ targetUserId: 'u2', status: 'disabled' })
  ]);
  assert.equal(calls, 2, '写请求必须保留服务端幂等与重复提交保护');
});

test('V1.6.2 UX 首页移除连接测试入口，但 healthCheck 能力保留', () => {
  const wxml = read('miniprogram/pages/index/index.wxml');
  const pageJs = read('miniprogram/pages/index/index.js');
  const apiJs = read('miniprogram/services/api.js');
  assert.doesNotMatch(wxml, /云开发连接测试|handleHealthCheck|healthText/);
  assert.doesNotMatch(pageJs, /healthCheck|healthText/);
  assert.match(apiJs, /async function healthCheck/);
  assert.match(apiJs, /healthCheck,/);
});

test('V1.6.2 UX 全部页面具备基础加载和保护界面', () => {
  const pages = JSON.parse(read('miniprogram/app.json')).pages;
  assert.equal(pages.length, 37);
  for (const route of pages) {
    const js = read(`miniprogram/${route}.js`);
    const wxml = read(`miniprogram/${route}.wxml`);
    assert.match(js, /ensureSession|onLoad|onShow/, `${route} should initialize`);
    assert.match(wxml, /<view|<block|<scroll-view/, `${route} should render a visible root`);
    assert.match(js, /catch|error/i, `${route} should handle failures`);
  }
});

test('V1.6.2 UX buttons expose immediate pressed feedback', () => {
  const css = read('miniprogram/app.wxss');
  assert.match(css, /\.jg-btn:active/);
  assert.match(css, /transition:\s*transform\s+90ms[^;]*opacity\s+90ms/);
});
