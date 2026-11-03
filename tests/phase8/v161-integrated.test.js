'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const sessionUtils = require('../../miniprogram/utils/session');
const {
  getPerformanceEvent,
  listAllPerformanceEvents,
  listLegacyPerformanceEvents,
  listPerformanceEvents
} = require('../../cloudfunctions/api/lib/performance-events');
const {
  selectBestPerformance
} = require('../../cloudfunctions/api/lib/statistics-builder');
const {
  loadActiveActor
} = require('../../cloudfunctions/api/lib/session');
const createPlanActions = require('../../cloudfunctions/api/actions/plans');
const createCoachActions = require('../../cloudfunctions/api/actions/coach');
const createRegistrationActions = require('../../cloudfunctions/api/actions/registrations');
const {
  IDENTITY,
  createFakeRepository
} = require('./helpers');
const {
  formatPerformanceValue
} = require('../../miniprogram/utils/performance-format');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

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
  return instance;
}

function createController(instance) {
  return {
    markSessionChecked() {},
    markLoaded() {},
    reset() {},
    run: async (_name, factory) => ({ ok: true, value: await factory() }),
    sessionStale: () => false,
    setIfChanged: (payload) => instance.setData(payload),
    shouldAutoRefresh: () => true,
    syncIdentity: () => true
  };
}

function loadPage(relativePath, options = {}) {
  const file = path.join(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  const roles = options.roles || [];
  const session = {
    user: {
      id: 'session-user',
      status: 'active',
      roles
    },
    capabilities: {}
  };
  const calls = {
    activeRoles: [],
    api: [],
    navigate: [],
    relaunch: []
  };
  const api = options.api || {};
  let page = null;
  let instance = null;

  const app = {
    globalData: { session },
    clearSession() {},
    ensureSession: async () => session
  };
  const wx = {
    getStorageSync: () => null,
    navigateTo: (payload) => calls.navigate.push(payload.url),
    reLaunch: (payload) => calls.relaunch.push(payload.url),
    setStorageSync() {},
    showModal: (modalOptions) => modalOptions.success({ confirm: false }),
    showToast() {},
    stopPullDownRefresh() {},
    ...options.wx
  };

  vm.runInNewContext(
    source,
    {
      Page: (value) => {
        page = value;
      },
      require: (request) => {
        if (request.includes('services/api')) {
          return new Proxy(api, {
            get(target, key) {
              if (key in target) {
                return target[key];
              }
              return async (...args) => {
                calls.api.push({ action: key, args });
                return {};
              };
            }
          });
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
        if (request.includes('utils/active-role')) {
          return {
            ACTIVE_ROLE_KEY: 'jogger_active_role_v1',
            clearActiveRole: () => calls.activeRoles.push({ role: '' }),
            readActiveRole: () => '',
            saveActiveRole: (role) => calls.activeRoles.push({ role }),
            sessionToken: () => ({ userId: 'session-user', roles })
          };
        }
        if (request.includes('utils/performance-format')) {
          return { formatPerformanceValue };
        }
        if (request.includes('utils/workbench-controller')) {
          return {
            createWorkbenchController: (target) => createController(target),
            formatClock: () => '12:00',
            isPermissionLostError: (error) =>
              Boolean(error && ['FORBIDDEN', 'UNAUTHENTICATED'].includes(error.code))
          };
        }
        return {};
      },
      getApp: () => app,
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
    { filename: file }
  );

  assert.ok(page, `${relativePath} should register a Page`);
  if (options.instantiate !== false) {
    instance = createInstance(page);
  }
  return { page, instance, session, calls };
}

function activeUser(roles) {
  return {
    _id: 'user-dual',
    status: 'active',
    roles
  };
}

test('V1.6.1 sports events expose exactly 15 active ordered options', () => {
  const events = listPerformanceEvents();
  assert.equal(events.length, 15);
  assert.deepEqual(
    events.map((item) => item.code),
    [
      'power_clean',
      'bench_press',
      'back_squat',
      '30m',
      '60m',
      '100m',
      '120m',
      '150m',
      '200m',
      '300m',
      '400m',
      '800m',
      '2000m',
      '4000m',
      '5000m'
    ]
  );
  assert.equal(new Set(events.map((item) => item.code)).size, 15);

  const strengthEvents = events.filter((event) => event.category === 'strength');
  const runningEvents = events.filter(
    (event) => event.category === 'speed_endurance'
  );

  for (const item of strengthEvents) {
    assert.equal(item.unit, 'kg');
    assert.equal(item.comparison, 'higher');
    assert.equal(item.decimals, 1);
  }
  for (const item of runningEvents) {
    assert.equal(item.unit, '秒');
    assert.equal(item.comparison, 'lower');
    assert.equal(item.decimals, 2);
  }
});

test('V1.6.1 legacy events remain resolvable without appearing in active options', () => {
  assert.deepEqual(
    listLegacyPerformanceEvents().map((item) => item.code),
    ['1500m', 'long_jump', 'high_jump', 'shot_put']
  );
  assert.equal(listAllPerformanceEvents().length, 19);
  assert.equal(getPerformanceEvent('1500m').active, false);
  assert.equal(getPerformanceEvent('100m').active, true);
  assert.equal(getPerformanceEvent('unknown_event'), null);
});

test('V1.6.1 PB comparison uses maximum for strength and minimum for running', () => {
  const strengthRecords = [
    { _id: 's1', achievedAt: '2026-01-01', value: 120.5 },
    { _id: 's2', achievedAt: '2026-02-01', value: 127.2 },
    { _id: 's3', achievedAt: '2026-03-01', value: 123.4 }
  ];
  const runningRecords = [
    { _id: 'r1', achievedAt: '2026-01-01', value: 12.4 },
    { _id: 'r2', achievedAt: '2026-02-01', value: 11.82 },
    { _id: 'r3', achievedAt: '2026-03-01', value: 12.01 }
  ];

  assert.equal(selectBestPerformance(strengthRecords, 'higher').value, 127.2);
  assert.equal(selectBestPerformance(runningRecords, 'lower').value, 11.82);
});

test('V1.6.1 long-distance total seconds format without losing precision', () => {
  assert.equal(formatPerformanceValue(59.8, '秒'), '59.8 秒');
  assert.equal(formatPerformanceValue(123.45, '秒'), '2分03.45秒');
  assert.equal(formatPerformanceValue(3723.5, '秒'), '1小时02分03.5秒');
  assert.equal(formatPerformanceValue(126.25, 'kg'), '126.3 kg');
});

test('V1.6.1 workbench actor is narrowed to the selected legal role', async () => {
  const dualRepository = {
    ensureUser: async () => activeUser(['developer', 'coach'])
  };
  const coachActor = await loadActiveActor(
    dualRepository,
    { openid: 'test', actingRole: 'coach' },
    ['developer', 'coach']
  );
  assert.deepEqual(coachActor.roles, ['coach']);

  const developerActor = await loadActiveActor(
    dualRepository,
    { openid: 'test', actingRole: 'developer' },
    ['developer', 'coach']
  );
  assert.deepEqual(developerActor.roles, ['developer']);

  await assert.rejects(
    () =>
      loadActiveActor(
        dualRepository,
        { openid: 'test', actingRole: 'coach' },
        ['developer']
      ),
    (error) => error.code === 'FORBIDDEN'
  );
});

test('V1.6.1 developer-only account cannot claim the coach workspace', async () => {
  const repository = {
    ensureUser: async () => activeUser(['developer'])
  };
  await assert.rejects(
    () =>
      loadActiveActor(
        repository,
        { openid: 'test', actingRole: 'coach' },
        ['coach']
      ),
    (error) => error.code === 'FORBIDDEN'
  );
});

test('V1.6.1 developer can legally add coach without losing developer role', async () => {
  const repository = createFakeRepository();
  repository.seedStudent({
    _id: 'usr_dual_dev',
    openid: 'openid_dual_dev',
    status: 'active',
    roles: ['developer'],
    createdAt: new Date()
  });

  const coachActions = createCoachActions({ repository });
  await coachActions['coach.submit_profile']({
    identity: IDENTITY('openid_dual_dev'),
    payload: { name: '测试教练', identityNote: '本地隔离测试' }
  });

  const pendingUser = repository.usersById.get('usr_dual_dev');
  assert.equal(pendingUser.status, 'active');
  assert.deepEqual(pendingUser.roles, ['developer']);
  assert.equal(pendingUser.pendingProfileType, 'coach');

  const registrationActions = createRegistrationActions({ repository });
  const reviewed = await registrationActions['admin.review_registration']({
    identity: IDENTITY('openid_dual_dev'),
    payload: {
      targetUserId: 'usr_dual_dev',
      profileType: 'coach',
      decision: 'approve',
      comment: ''
    }
  });

  assert.equal(reviewed.status, 'active');
  assert.deepEqual(reviewed.roles.slice().sort(), ['coach', 'developer']);
  const coachBindings = repository
    .readCollection('role_bindings')
    .filter((item) => item.userId === 'usr_dual_dev' && item.role === 'coach');
  assert.equal(coachBindings.length, 1);
  assert.equal(coachBindings[0].status, 'active');
});

test('V1.6.1 dual-role coach sees only assigned groups while developer sees all', async () => {

  const groups = [
    { _id: 'g1', groupId: 'g1', name: '一组', enabled: true },
    { _id: 'g2', groupId: 'g2', name: '二组', enabled: true }
  ];
  const calls = [];
  const repository = {
    ensureUser: async () => activeUser(['developer', 'coach']),
    getCoachGroupIds: async () => {
      calls.push('getCoachGroupIds');
      return ['g1'];
    },
    getGroupsMap: async (ids) =>
      new Map(ids.map((id) => [id, groups.find((group) => group._id === id)])),
    listAllTrainingGroups: async () => {
      calls.push('listAllTrainingGroups');
      return groups;
    }
  };
  const actions = createPlanActions({ repository });

  const coachResult = await actions['plan.list_meta']({
    identity: { openid: 'test', actingRole: 'coach' }
  });
  assert.deepEqual(coachResult.groups.map((group) => group.id), ['g1']);
  assert.ok(calls.includes('getCoachGroupIds'));
  assert.equal(calls.includes('listAllTrainingGroups'), false);

  const developerResult = await actions['plan.list_meta']({
    identity: { openid: 'test', actingRole: 'developer' }
  });
  assert.deepEqual(developerResult.groups.map((group) => group.id), ['g1', 'g2']);
  assert.ok(calls.includes('listAllTrainingGroups'));
});

test('V1.6.1 admin authorization panels default collapsed and toggle by user id', () => {
  const writeCalls = [];
  const { page, instance } = loadPage('miniprogram/pages/admin/admin.js', {
    api: {
      assignRole: async () => writeCalls.push('assignRole'),
      deleteUser: async () => writeCalls.push('deleteUser'),
      setUserStatus: async () => writeCalls.push('setUserStatus')
    }
  });
  assert.ok(page);
  instance.data.allUsers = [
    { userId: 'user-a', displayName: 'A' },
    { userId: 'user-b', displayName: 'B' }
  ];
  instance.data.users = instance.data.allUsers.slice();
  instance.expandedUserIds = new Set(['user-a']);
  instance.syncAuthorizationExpansion();

  assert.equal(instance.data.users[0].isAuthorizationExpanded, true);
  assert.equal(instance.data.users[1].isAuthorizationExpanded, false);

  instance.toggleAuthorization({
    currentTarget: { dataset: { userId: 'user-b' } }
  });
  assert.equal(instance.data.users[0].isAuthorizationExpanded, true);
  assert.equal(instance.data.users[1].isAuthorizationExpanded, true);

  instance.toggleAuthorization({
    currentTarget: { dataset: { userId: 'user-a' } }
  });
  assert.equal(instance.data.users[0].isAuthorizationExpanded, false);
  assert.equal(instance.data.users[1].isAuthorizationExpanded, true);
  assert.equal(writeCalls.length, 0);
});

test('V1.6.1 every admin onShow collapses all authorization panels', () => {
  const { instance } = loadPage('miniprogram/pages/admin/admin.js');
  instance.data.allUsers = [
    { userId: 'user-a', isAuthorizationExpanded: true },
    { userId: 'user-b', isAuthorizationExpanded: true }
  ];
  instance.data.users = instance.data.allUsers.slice();
  instance.expandedUserIds = new Set(['user-a', 'user-b']);
  instance.enterWorkbench = () => {};

  instance.onShow();

  assert.equal(instance.expandedUserIds.size, 0);
  assert.equal(instance.data.users[0].isAuthorizationExpanded, false);
  assert.equal(instance.data.users[1].isAuthorizationExpanded, false);
});

test('V1.6.1 workbench switch only changes display role and navigation', () => {
  const admin = loadPage('miniprogram/pages/admin/admin.js', {
    roles: ['developer', 'coach']
  });
  admin.instance.data.canSwitchCoach = true;
  admin.instance.goCoachWorkbench();
  assert.equal(admin.calls.activeRoles.at(-1).role, 'coach');
  assert.equal(admin.calls.navigate.at(-1), '/pages/coach/coach');

  const coach = loadPage('miniprogram/pages/coach/coach.js', {
    roles: ['developer', 'coach']
  });
  coach.instance.data.canSwitchDeveloper = true;
  coach.instance.switchToDeveloper();
  assert.equal(coach.calls.activeRoles.at(-1).role, 'developer');
  assert.equal(coach.calls.relaunch.at(-1), '/pages/admin/admin');
  assert.equal(admin.calls.api.length, 0);
  assert.equal(coach.calls.api.length, 0);
});

test('V1.6.1 developer coach entry routes application and switch by current role', () => {
  const developerOnly = loadPage('miniprogram/pages/admin/admin.js', {
    roles: ['developer']
  });
  developerOnly.instance.data.canSwitchCoach = false;
  developerOnly.instance.goCoachRegistration();
  assert.equal(
    developerOnly.calls.navigate.at(-1),
    '/pages/coach-register/coach-register'
  );
  assert.equal(developerOnly.calls.activeRoles.length, 0);
  assert.equal(developerOnly.calls.api.length, 0);

  const dualRole = loadPage('miniprogram/pages/admin/admin.js', {
    roles: ['developer', 'coach']
  });
  dualRole.instance.data.canSwitchCoach = true;
  dualRole.instance.goCoachRegistration();
  assert.equal(dualRole.calls.activeRoles.at(-1).role, 'coach');
  assert.equal(dualRole.calls.navigate.at(-1), '/pages/coach/coach');
  assert.equal(dualRole.calls.api.length, 0);
});

test('V1.6.1 developer-only session is denied the coach workbench', async () => {
  const { instance, calls } = loadPage('miniprogram/pages/coach/coach.js', {
    roles: ['developer'],
    api: {
      listManageAttendanceSessions: async () => {
        throw new Error('must not load coach data');
      }
    }
  });
  await instance.runLoad({ force: true });
  assert.equal(calls.relaunch.at(-1), '/pages/admin/admin');
  assert.equal(calls.api.length, 0);
});

test('V1.6.1 admin and coach templates expose guarded switch and collapse controls', () => {
  const adminWxml = readProjectFile('miniprogram/pages/admin/admin.wxml');
  const coachWxml = readProjectFile('miniprogram/pages/coach/coach.wxml');
  const adminJs = readProjectFile('miniprogram/pages/admin/admin.js');

  assert.match(adminWxml, /bindtap="toggleAuthorization"/);
  assert.match(adminWxml, /item\.isAuthorizationExpanded \? '收起授权' : '展开授权'/);
  assert.match(
    adminWxml,
    /wx:if="\{\{canSwitchCoach\}\}"[^>]+bindtap="goCoachWorkbench"/
  );
  assert.match(
    adminWxml,
    /wx:if="\{\{!canSwitchCoach\}\}"[^>]+bindtap="goCoachRegistration"/
  );
  assert.match(coachWxml, /wx:if="\{\{canSwitchDeveloper\}\}"/);
  assert.match(coachWxml, /bindtap="switchToDeveloper"/);
  assert.match(adminJs, /this\.expandedUserIds = new Set\(\)/);
  assert.match(adminJs, /expandedUserIds\.has\(userId\)/);
  assert.match(adminJs, /goCoachRegistration\(\)/);
});
