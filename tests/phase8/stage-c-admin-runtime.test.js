'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sessionUtils = require('../../miniprogram/utils/session');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function createInstance(page) {
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update, callback) {
      Object.assign(instance.data, update);
      if (typeof callback === 'function') {
        callback();
      }
    }
  };
  for (const [key, value] of Object.entries(page)) {
    if (typeof value === 'function') {
      instance[key] = value.bind(instance);
    }
  }
  instance.controllerSetIfChanged = instance.setData.bind(instance);
  return instance;
}

function loadAdminPage({ api, confirmContents = [], failDelete = false }) {
  const source = fs.readFileSync(
    path.join(PROJECT_ROOT, 'miniprogram/pages/admin/admin.js'),
    'utf8'
  );
  const calls = {
    api: [],
    modals: [],
    toasts: [],
    loadGroups: 0,
    loadUsers: 0,
    refresh: 0
  };
  let page = null;
  let modalIndex = 0;
  let deleteCalls = 0;

  const proxyApi = new Proxy(api, {
    get(target, key) {
      if (key in target) {
        if (typeof target[key] === 'function') {
          return async (...args) => {
            calls.api.push({ action: key, args });
            if (failDelete && ['deleteUser', 'deleteTrainingGroup'].includes(key)) {
              deleteCalls += 1;
              throw new Error('模拟删除失败');
            }
            return target[key](...args);
          };
        }
        return target[key];
      }
      return async (...args) => {
        calls.api.push({ action: key, args });
        return {};
      };
    }
  });

  const wx = {
    showModal(options) {
      calls.modals.push(options);
      const content = confirmContents[modalIndex];
      modalIndex += 1;
      options.success({
        confirm: true,
        content: content === undefined ? '' : content
      });
    },
    showToast(options) {
      calls.toasts.push(options);
    },
    stopPullDownRefresh() {}
  };

  vm.runInNewContext(
    source,
    {
      Page: (value) => {
        page = value;
      },
      require: (request) => {
        if (request.includes('services/api')) {
          return proxyApi;
        }
        if (request.includes('config/env')) {
          return {
            CLOUD_ENV_ID: 'cloud1-test',
            API_FUNCTION_NAME: 'api',
            HEALTH_FUNCTION_NAME: 'health_check'
          };
        }
        if (request.includes('utils/demo-mode')) {
          return { isDemoAllowed: () => false };
        }
        if (request.includes('utils/session')) {
          return sessionUtils;
        }
        if (request.includes('utils/workbench-controller')) {
          return {
            createWorkbenchController: () => ({
              markLoaded() {},
              markSessionChecked() {},
              reset() {},
              run: async (_name, factory) => factory(),
              sessionStale: () => false,
              setIfChanged: (update) => instance.setData(update),
              shouldAutoRefresh: () => false,
              syncIdentity: () => true
            }),
            formatClock: () => '12:00',
            isPermissionLostError: () => false
          };
        }
        if (request.includes('utils/active-role')) {
          return {
            clearActiveRole() {},
            saveActiveRole() {}
          };
        }
        return {};
      },
      getApp: () => ({
        clearSession() {},
        ensureSession: async () => ({ user: { id: 'dev', roles: ['developer'] } })
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
      Set,
      Map,
      JSON,
      setTimeout,
      clearTimeout,
      setImmediate
    },
    { filename: path.join(PROJECT_ROOT, 'miniprogram/pages/admin/admin.js') }
  );

  assert.ok(page);
  const instance = createInstance(page);
  instance.loadGroups = async () => {
    calls.loadGroups += 1;
  };
  instance.loadUsers = async () => {
    calls.loadUsers += 1;
  };
  instance.decorateGroupCoachNames = () => {};
  instance.markNeedsRefresh = () => {
    calls.refresh += 1;
  };
  return { instance, calls };
}

function eventWith(data) {
  return { currentTarget: { dataset: data } };
}

test('deleteUserAccount calls the real API method without a ReferenceError', async () => {
  const { instance, calls } = loadAdminPage({
    api: {
      getUserDeletionImpact: async () => ({
        impact: {
          identityHint: '账号尾号A001',
          associationCounts: { groupMemberships: 1, performanceRecords: 2 },
          requiresAcknowledgement: true,
          canDelete: true,
          protectedDeveloper: false,
          deleted: false
        }
      }),
      deleteUser: async () => ({ status: 'deleted' })
    },
    confirmContents: ['', '删除账号']
  });

  await instance.deleteUserAccount(eventWith({ userId: 'usr_target' }));

  const deleteCall = calls.api.find((item) => item.action === 'deleteUser');
  assert.ok(deleteCall);
  assert.equal(deleteCall.args[0].targetUserId, 'usr_target');
  assert.equal(deleteCall.args[0].acknowledgeAssociations, true);
  assert.equal(instance.data.deletingUserId, '');
  assert.equal(calls.loadUsers, 1);
  assert.equal(calls.refresh, 1);
});

test('deleteTrainingGroup calls the real API method without a ReferenceError', async () => {
  const { instance, calls } = loadAdminPage({
    api: {
      getTrainingGroupDeletionImpact: async () => ({
        impact: {
          name: '短跑组',
          seasonLabel: '2026',
          associationCounts: { trainingPlans: 1 },
          canDelete: true,
          deleted: false
        }
      }),
      deleteTrainingGroup: async () => ({ status: 'deleted' })
    },
    confirmContents: ['', '删除训练组']
  });

  await instance.deleteTrainingGroup(eventWith({ groupId: 'group_target' }));

  const deleteCall = calls.api.find(
    (item) => item.action === 'deleteTrainingGroup'
  );
  assert.ok(deleteCall);
  assert.equal(deleteCall.args[0].trainingGroupId, 'group_target');
  assert.equal(instance.data.deletingGroupId, '');
  assert.equal(calls.loadGroups, 1);
  assert.equal(calls.refresh, 1);
});

test('delete methods restore busy state and expose errors when API fails', async () => {
  const { instance } = loadAdminPage({
    api: {
      getUserDeletionImpact: async () => ({
        impact: {
          identityHint: '账号尾号B002',
          associationCounts: {},
          canDelete: true,
          protectedDeveloper: false,
          deleted: false
        }
      }),
      deleteUser: async () => {
        throw new Error('模拟账号删除失败');
      },
      getTrainingGroupDeletionImpact: async () => ({
        impact: {
          name: '跳远组',
          seasonLabel: '2026',
          associationCounts: {},
          canDelete: true,
          deleted: false
        }
      }),
      deleteTrainingGroup: async () => {
        throw new Error('模拟训练组删除失败');
      }
    },
    confirmContents: ['', '删除账号', '', '删除训练组'],
    failDelete: true
  });

  await instance.deleteUserAccount(eventWith({ userId: 'usr_fail' }));
  assert.equal(instance.data.deletingUserId, '');
  assert.match(instance.data.actionError, /模拟删除失败/);

  await instance.deleteTrainingGroup(eventWith({ groupId: 'group_fail' }));
  assert.equal(instance.data.deletingGroupId, '');
  assert.match(instance.data.actionError, /模拟删除失败/);
});
