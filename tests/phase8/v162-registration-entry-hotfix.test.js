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

async function flush() {
  let chain = Promise.resolve();
  for (let index = 0; index < 6; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  await chain;
}

function loadPage(relativePath, api, session) {
  let definition = null;
  const calls = { navigateTo: [], reLaunch: [], showToast: [] };
  vm.runInNewContext(
    read(relativePath),
    {
      require: (request) => {
        if (request.includes('services/api')) return api;
        if (request.includes('utils/session')) {
          return {
            getSessionDestination: () => ({
              type: 'register',
              url: '/pages/pending/pending',
              label: '开始实名注册'
            })
          };
        }
        throw new Error(`Unexpected dependency: ${request}`);
      },
      Page: (value) => {
        definition = value;
      },
      getApp: () => ({
        ensureSession: async () => session,
        clearSession: () => {}
      }),
      wx: {
        navigateTo: (payload) => calls.navigateTo.push(payload.url),
        reLaunch: (payload) => calls.reLaunch.push(payload.url),
        showToast: (payload) => calls.showToast.push(payload)
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
    { filename: path.join(PROJECT_ROOT, relativePath) }
  );
  assert.ok(definition, `${relativePath} should register Page`);
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) {
      for (const [key, value] of Object.entries(update)) {
        if (key.startsWith('form.')) {
          this.data.form[key.slice(5)] = value;
        } else {
          this.data[key] = value;
        }
      }
    }
  };
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function') instance[key] = value.bind(instance);
  }
  return { instance, calls };
}

const UNREGISTERED_SESSION = Object.freeze({
  sessionVersion: 1,
  registered: false,
  user: {
    id: '',
    status: 'unregistered',
    roles: [],
    pendingProfileType: ''
  },
  capabilities: { student: false, coach: false, developer: false }
});

test('V1.6.2 Hotfix 三类注册页加载只读资料，不调用提交接口', async () => {
  const cases = [
    {
      page: 'register',
      reads: {
        listTrainingGroups: async () => ({ groups: [] }),
        getProfile: async () => ({ userStatus: 'unregistered', profile: null })
      }
    },
    {
      page: 'parent-register',
      reads: {
        getParentProfile: async () => ({
          userStatus: 'unregistered',
          registered: false,
          roles: [],
          profile: null
        })
      }
    },
    {
      page: 'coach-register',
      reads: {
        getCoachProfile: async () => ({
          userStatus: 'unregistered',
          registered: false,
          roles: [],
          profile: null
        })
      }
    }
  ];

  for (const item of cases) {
    const readCalls = [];
    const api = {
      ...Object.fromEntries(
        Object.entries(item.reads).map(([name, implementation]) => [
          name,
          async (...args) => {
            readCalls.push(name);
            return implementation(...args);
          }
        ])
      ),
      submitProfile: async () => {
        throw new Error('submitProfile must not be called while loading');
      },
      submitParentProfile: async () => {
        throw new Error('submitParentProfile must not be called while loading');
      },
      submitCoachProfile: async () => {
        throw new Error('submitCoachProfile must not be called while loading');
      }
    };
    const relativePath = `miniprogram/pages/${item.page}/${item.page}.js`;
    const { instance, calls } = loadPage(relativePath, api, UNREGISTERED_SESSION);
    instance.onShow();
    await flush();

    assert.ok(readCalls.length >= 1, `${item.page} should load only read data`);
    assert.equal(calls.reLaunch.length, 0, `${item.page} must not redirect`);
    assert.equal(calls.showToast.length, 0, `${item.page} must not submit`);
    assert.equal(instance.data.loading, false);
  }
});

test('V1.6.2 Hotfix 注册首页使用 registered=false 而非 unknown 判定未注册', () => {
  const source = read('miniprogram/pages/index/index.js');
  assert.match(source, /session\.registered === false/);
  assert.match(source, /status === 'unregistered'/);
  assert.doesNotMatch(source, /status === 'unknown'/);
  assert.match(source, /goStudentRegister/);
  assert.match(source, /goParentRegister/);
  assert.match(source, /goCoachRegister/);
});
