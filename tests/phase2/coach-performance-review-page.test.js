'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PAGE_JS = 'miniprogram/pages/coach-performance-review/coach-performance-review.js';
const PAGE_WXML = 'miniprogram/pages/coach-performance-review/coach-performance-review.wxml';
const PAGE_JSON = 'miniprogram/pages/coach-performance-review/coach-performance-review.json';
const APP_JSON = 'miniprogram/app.json';
const COACH_JS = 'miniprogram/pages/coach/coach.js';
const COACH_WXML = 'miniprogram/pages/coach/coach.wxml';
const ADMIN_JS = 'miniprogram/pages/admin/admin.js';
const ADMIN_WXML = 'miniprogram/pages/admin/admin.wxml';

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function readProjectJson(relativePath) {
  return JSON.parse(readProjectFile(relativePath));
}

function pendingRecord(id) {
  return {
    id,
    studentUserId: 'usr_student_a',
    studentName: '模拟学生甲',
    trainingGroupNames: ['短跑组（2026）'],
    eventCode: '100m',
    eventName: '100米',
    value: 12.4,
    unit: '秒',
    comparison: 'lower',
    achievedAt: '2026-10-01',
    source: 'student_report',
    note: '模拟备注',
    status: 'pending'
  };
}

function loadPage(apiStub, roles, wxOverrides = {}) {
  const file = path.join(PROJECT_ROOT, PAGE_JS);
  const source = fs.readFileSync(file, 'utf8');
  let page = null;
  const wx = {
    reLaunch: () => {},
    showModal: (options) => options.success({ confirm: false }),
    showToast: () => {},
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
      console
    },
    { filename: file }
  );

  assert.ok(page, 'coach-performance-review should register a Page');
  return { page, wx };
}

function createInstance(page) {
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update) {
      Object.assign(this.data, update);
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

test('coach loads a scoped pending list with count, source and group text', async () => {
  const apiStub = {
    listPendingPerformances: async () => ({
      performances: [pendingRecord('perf_1')],
      pendingCount: 3,
      truncated: true
    }),
    reviewPerformance: async () => {
      throw new Error('not expected');
    }
  };
  const { page } = loadPage(apiStub, ['coach']);
  const instance = createInstance(page);

  instance.onShow();
  await flush();

  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.pendingCount, 3);
  assert.equal(instance.data.truncated, true);
  assert.equal(instance.data.performances.length, 1);
  assert.equal(instance.data.performances[0].sourceLabel, '学生申报');
  assert.equal(instance.data.performances[0].groupText, '短跑组（2026）');
});

test('developer can open the review page and student cannot', async () => {
  const apiStub = {
    listPendingPerformances: async () => ({
      performances: [],
      pendingCount: 0,
      truncated: false
    }),
    reviewPerformance: async () => {
      throw new Error('not expected');
    }
  };

  const developerInstance = createInstance(loadPage(apiStub, ['developer']).page);
  developerInstance.onShow();
  await flush();
  assert.equal(developerInstance.data.loading, false);
  assert.equal(developerInstance.data.error, '');

  const reLaunches = [];
  const studentInstance = createInstance(
    loadPage(apiStub, ['student'], {
      reLaunch: (options) => reLaunches.push(options)
    }).page
  );
  studentInstance.onShow();
  await flush();
  assert.equal(reLaunches.length, 1);
  assert.equal(reLaunches[0].url, '/pages/index/index');
});

test('approve calls the review api once and refreshes the list', async () => {
  const reviewCalls = [];
  const toasts = [];
  let listCalls = 0;
  const apiStub = {
    listPendingPerformances: async () => {
      listCalls += 1;
      return { performances: [pendingRecord('perf_1')], pendingCount: 1, truncated: false };
    },
    reviewPerformance: async (payload) => {
      reviewCalls.push(payload);
      return { status: 'approved' };
    }
  };
  const { page } = loadPage(apiStub, ['coach'], {
    showModal: (options) => options.success({ confirm: true }),
    showToast: (options) => toasts.push(options)
  });
  const instance = createInstance(page);
  instance.onShow();
  await flush();

  await instance.review({
    currentTarget: { dataset: { performanceId: 'perf_1', decision: 'approve' } }
  });

  assert.deepEqual(JSON.parse(JSON.stringify(reviewCalls)), [
    { performanceId: 'perf_1', decision: 'approve', comment: '' }
  ]);
  assert.equal(listCalls, 2);
  assert.equal(instance.data.reviewingId, '');
  assert.equal(toasts[0].title, '已通过');
});

test('reject requires a comment and otherwise passes it to the api', async () => {
  const reviewCalls = [];
  let modalContent = '';
  const apiStub = {
    listPendingPerformances: async () => ({
      performances: [pendingRecord('perf_1')],
      pendingCount: 1,
      truncated: false
    }),
    reviewPerformance: async (payload) => {
      reviewCalls.push(payload);
      return { status: 'rejected' };
    }
  };
  const { page } = loadPage(apiStub, ['coach'], {
    showModal: (options) => options.success({ confirm: true, content: modalContent })
  });
  const instance = createInstance(page);
  instance.onShow();
  await flush();

  await instance.review({
    currentTarget: { dataset: { performanceId: 'perf_1', decision: 'reject' } }
  });
  assert.equal(reviewCalls.length, 0);
  assert.equal(instance.data.error, '驳回时必须填写审核意见。');

  modalContent = '成绩材料不清晰';
  await instance.review({
    currentTarget: { dataset: { performanceId: 'perf_1', decision: 'reject' } }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(reviewCalls)), [
    {
      performanceId: 'perf_1',
      decision: 'reject',
      comment: '成绩材料不清晰'
    }
  ]);
});

test('review ignores duplicate taps while a submission is in flight', async () => {
  let modalCalls = 0;
  const reviewCalls = [];
  const apiStub = {
    listPendingPerformances: async () => ({
      performances: [pendingRecord('perf_1')],
      pendingCount: 1,
      truncated: false
    }),
    reviewPerformance: async (payload) => {
      reviewCalls.push(payload);
      return { status: 'approved' };
    }
  };
  const { page } = loadPage(apiStub, ['coach'], {
    showModal: (options) => {
      modalCalls += 1;
      options.success({ confirm: true });
    }
  });
  const instance = createInstance(page);
  instance.setData({ reviewingId: 'perf_1' });

  await instance.review({
    currentTarget: { dataset: { performanceId: 'perf_1', decision: 'approve' } }
  });

  assert.equal(modalCalls, 0);
  assert.equal(reviewCalls.length, 0);
});

test('load failure offers retry and clears stale rows', async () => {
  let attempt = 0;
  const apiStub = {
    listPendingPerformances: async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('network down');
      }
      return { performances: [pendingRecord('perf_1')], pendingCount: 1, truncated: false };
    },
    reviewPerformance: async () => ({ status: 'approved' })
  };
  const { page } = loadPage(apiStub, ['coach']);
  const instance = createInstance(page);

  instance.onShow();
  await flush();

  assert.equal(instance.data.error, 'network down');
  assert.deepEqual(JSON.parse(JSON.stringify(instance.data.performances)), []);
  assert.match(readProjectFile(PAGE_WXML), /bindtap="retry"/);

  instance.retry();
  await flush();

  assert.equal(instance.data.error, '');
  assert.equal(instance.data.performances.length, 1);
});

test('empty queue is represented in page markup', () => {
  const wxml = readProjectFile(PAGE_WXML);
  assert.match(wxml, /当前没有待审核成绩/);
  assert.match(wxml, /待审核 \{\{pendingCount\}\} 条/);
});

test('review page is registered and both workbenches link to it', () => {
  const appConfig = readProjectJson(APP_JSON);
  assert.ok(
    appConfig.pages.includes('pages/coach-performance-review/coach-performance-review')
  );
  assert.equal(
    readProjectJson(PAGE_JSON).navigationBarTitleText,
    '成绩审核'
  );

  for (const file of [COACH_WXML, ADMIN_WXML]) {
    assert.match(readProjectFile(file), /bindtap="goPerformanceReview"/);
  }
  for (const file of [COACH_JS, ADMIN_JS]) {
    assert.match(
      readProjectFile(file),
      /\/pages\/coach-performance-review\/coach-performance-review/
    );
  }
});
