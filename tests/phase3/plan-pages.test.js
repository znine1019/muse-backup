'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const APP_JSON = 'miniprogram/app.json';
const LIST_JS = 'miniprogram/pages/coach-plan-list/coach-plan-list.js';
const EDIT_JS = 'miniprogram/pages/coach-plan-edit/coach-plan-edit.js';
const STUDENT_JS = 'miniprogram/pages/student-plans/student-plans.js';

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function readProjectJson(relativePath) {
  return JSON.parse(readProjectFile(relativePath));
}

function loadPage(relativePath, apiStub, roles, wxOverrides = {}) {
  const file = path.join(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  let page = null;
  const wx = {
    reLaunch: () => {},
    navigateTo: () => {},
    navigateBack: () => {},
    showToast: () => {},
    showModal: (options) => options.success({ confirm: false }),
    ...wxOverrides
  };

  vm.runInNewContext(
    source,
    {
      require: (request) => {
        if (request.includes('services/api')) {
          return apiStub;
        }
        return {
          getSessionDestination: () => ({ url: '/pages/index/index' }),
          sessionHasRole: (session, role) => roles.includes(role)
        };
      },
      Page: (value) => {
        page = value;
      },
      getApp: () => ({
        ensureSession: async () => ({}),
        clearSession: () => {}
      }),
      wx,
      console,
      Date,
      Math,
      Number,
      String,
      Array,
      Object
    },
    { filename: file }
  );

  assert.ok(page, `${relativePath} should register a Page`);
  return { page, wx };
}

function createInstance(page) {
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update) {
      for (const [key, value] of Object.entries(update)) {
        if (/^items\[\d+\]\./.test(key)) {
          const match = key.match(/^items\[(\d+)\]\.(.+)$/);
          this.data.items[Number(match[1])][match[2]] = value;
        } else {
          this.data[key] = value;
        }
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

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

const PLAN = {
  planId: 'plan_1',
  title: '第1周速度训练',
  trainingGroupId: 'group_a',
  trainingGroupName: '短跑组',
  startDate: '2026-10-14',
  endDate: '2026-10-16',
  status: 'draft',
  version: 1,
  notes: '热身充分',
  copiedFromPlanId: '',
  items: [
    {
      itemId: 'item_1',
      order: 1,
      category: 'sprint',
      categoryLabel: '短跑专项',
      name: '30米加速跑',
      target: '起跑加速',
      sets: 6,
      reps: 1,
      distanceMeters: 30,
      restSeconds: 120,
      notes: '放松'
    }
  ]
};

test('phase 3 pages are registered and entries point to them', () => {
  const appConfig = readProjectJson(APP_JSON);
  for (const page of [
    'pages/coach-plan-list/coach-plan-list',
    'pages/coach-plan-edit/coach-plan-edit',
    'pages/student-plans/student-plans'
  ]) {
    assert.ok(appConfig.pages.includes(page), `${page} should be registered`);
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
      assert.ok(
        fs.existsSync(path.join(PROJECT_ROOT, `miniprogram/${page}${extension}`)),
        `${page}${extension} should exist`
      );
    }
  }

  assert.match(
    readProjectFile('miniprogram/pages/student/student.wxml'),
    /bindtap="goPlans"/
  );
  assert.match(
    readProjectFile('miniprogram/pages/coach/coach.wxml'),
    /bindtap="goPlans"/
  );
  assert.match(
    readProjectFile('miniprogram/pages/admin/admin.wxml'),
    /bindtap="goPlans"/
  );
});

test('coach plan list loads, filters status and publishes with version', async () => {
  const calls = [];
  const apiStub = {
    listManagePlans: async (payload) => {
      calls.push({ type: 'list', payload });
      return { plans: [PLAN], total: 1, truncated: false };
    },
    publishPlan: async (payload) => {
      calls.push({ type: 'publish', payload });
      return { plan: { ...PLAN, status: 'published', version: 2 } };
    }
  };
  const { page } = loadPage(LIST_JS, apiStub, ['coach'], {
    showModal: (options) => options.success({ confirm: true }),
    showToast: () => {}
  });
  const instance = createInstance(page);

  instance.onShow();
  await flush();
  assert.equal(instance.data.plans.length, 1);
  assert.equal(instance.data.plans[0].statusLabel, '草稿');
  assert.equal(instance.data.plans[0].itemCount, 1);

  instance.onStatusChange({ detail: { value: 1 } });
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].payload)), { status: 'draft' });

  await instance.publishPlan({
    currentTarget: { dataset: { planId: 'plan_1', version: '1' } }
  });
  const publishCall = calls.find((call) => call.type === 'publish');
  assert.deepEqual(JSON.parse(JSON.stringify(publishCall.payload)), {
    planId: 'plan_1',
    expectedVersion: 1
  });
});

test('coach plan editor builds items and creates then publishes', async () => {
  const calls = [];
  const apiStub = {
    listPlanMeta: async () => ({
      categories: [
        { code: 'sprint', label: '短跑专项' },
        { code: 'recovery', label: '恢复训练' }
      ],
      groups: [{ id: 'group_a', name: '短跑组', seasonLabel: '2026' }]
    }),
    getManagePlan: async () => ({ plan: PLAN }),
    createPlan: async (payload) => {
      calls.push({ type: 'create', payload });
      return { plan: { ...PLAN, planId: 'plan_new', version: 1, status: 'draft' } };
    },
    updatePlan: async (payload) => {
      calls.push({ type: 'update', payload });
      return { plan: { ...PLAN, planId: payload.planId, version: payload.expectedVersion + 1, status: 'draft' } };
    },
    publishPlan: async (payload) => {
      calls.push({ type: 'publish', payload });
      return { plan: { ...PLAN, planId: payload.planId, version: payload.expectedVersion + 1, status: 'published' } };
    }
  };
  const { page } = loadPage(EDIT_JS, apiStub, ['coach']);
  const instance = createInstance(page);

  await instance.loadPage();
  assert.equal(instance.data.groups.length, 1);
  assert.equal(instance.data.items.length, 1);

  instance.setData({
    title: '第1周速度训练',
    'items[0].name': '30米加速跑',
    'items[0].sets': '6'
  });
  instance.addItem();
  assert.equal(instance.data.items.length, 2);
  instance.removeItem({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(instance.data.items.length, 1);

  await instance.saveDraft();
  const createCall = calls.find((call) => call.type === 'create');
  assert.ok(createCall);
  assert.equal(createCall.payload.title, '第1周速度训练');
  assert.equal(createCall.payload.items[0].name, '30米加速跑');
  assert.equal(createCall.payload.items[0].sets, '6');
  assert.equal(instance.data.planId, 'plan_new');

  await instance.publishPlan();
  const publishCall = calls.find((call) => call.type === 'publish');
  assert.ok(publishCall);
  assert.equal(publishCall.payload.planId, 'plan_new');
});

test('student plan page switches scope and decorates requirements', async () => {
  const calls = [];
  const apiStub = {
    listStudentPlans: async (payload) => {
      calls.push(payload);
      return { plans: [{ ...PLAN, status: 'published' }], total: 1, truncated: false };
    }
  };
  const { page } = loadPage(STUDENT_JS, apiStub, ['student']);
  const instance = createInstance(page);

  instance.onShow();
  await flush();
  assert.equal(calls[0].scope, 'today');
  assert.equal(instance.data.plans[0].statusLabel, '已发布');
  assert.match(instance.data.plans[0].items[0].requirementText, /6组/);

  instance.onScopeTap({ currentTarget: { dataset: { index: 1 } } });
  await flush();
  assert.equal(calls[1].scope, 'week');
});

test('student plan page surfaces load failure and retry clears it', async () => {
  let attempt = 0;
  const apiStub = {
    listStudentPlans: async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('network down');
      }
      return { plans: [], total: 0, truncated: false };
    }
  };
  const { page } = loadPage(STUDENT_JS, apiStub, ['student']);
  const instance = createInstance(page);

  instance.onShow();
  await flush();
  assert.equal(instance.data.error, 'network down');
  assert.match(
    readProjectFile('miniprogram/pages/student-plans/student-plans.wxml'),
    /bindtap="retry"/
  );

  instance.retry();
  await flush();
  assert.equal(instance.data.error, '');
  assert.equal(instance.data.plans.length, 0);
});
