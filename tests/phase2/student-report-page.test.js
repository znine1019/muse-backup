'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REPORT_JS = 'miniprogram/pages/student-report/student-report.js';
const REPORT_JSON = 'miniprogram/pages/student-report/student-report.json';
const APP_JSON = 'miniprogram/app.json';
const STUDENT_JS = 'miniprogram/pages/student/student.js';
const STUDENT_WXML = 'miniprogram/pages/student/student.wxml';

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function readProjectJson(relativePath) {
  return JSON.parse(readProjectFile(relativePath));
}

function makeReport(userId) {
  return {
    profile: { userId, name: 'student', examGoal: { targetEventCode: '100m' } },
    supportedEvents: [
      { code: '100m', name: '100m', unit: 's', comparison: 'lower' },
      { code: 'long_jump', name: 'long jump', unit: 'm', comparison: 'higher' }
    ],
    performanceSeries: {
      '100m': [
        { date: '2026-01-01', value: 13.2 },
        { date: '2026-02-01', value: 12.8 }
      ],
      long_jump: [
        { date: '2026-01-01', value: 5.1 },
        { date: '2026-02-01', value: 5.6 }
      ]
    },
    measurements: [
      { date: '2026-01-01', heightCm: 170, weightKg: 60 },
      { date: '2026-02-01', heightCm: 171, weightKg: 61 }
    ],
    personalBests: [],
    stageChanges: [],
    targetComparison: null,
    measurementMeta: {
      total: 2,
      displayed: 2,
      chartPointLimit: 120,
      truncated: false
    },
    performanceMeta: {
      approvedTotal: 4,
      chartPointLimit: 120,
      truncatedEvents: []
    },
    dataQuality: { measurementCount: 2, approvedPerformanceCount: 4 }
  };
}

function loadPage(apiStub, roles = ['student']) {
  const file = path.join(PROJECT_ROOT, REPORT_JS);
  const source = fs.readFileSync(file, 'utf8');
  let page = null;

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
      getApp: () => ({ ensureSession: async () => ({}) }),
      wx: { reLaunch: () => {} },
      console
    },
    { filename: file }
  );

  assert.ok(page, 'student-report should register a Page');
  return page;
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

test('student report page loads the caller report from the trusted identity', async () => {
  const calls = [];
  const apiStub = {
    getMyReport: async () => {
      calls.push({ type: 'mine' });
      return { report: makeReport('usr_student_a') };
    },
    getStudentReport: async (targetUserId) => {
      calls.push({ type: 'student', targetUserId });
      return { report: makeReport(targetUserId) };
    }
  };
  const instance = createInstance(loadPage(apiStub));

  instance.onLoad({});
  await flush();

  assert.deepEqual(calls, [{ type: 'mine' }]);
  assert.equal(instance.data.report.profile.userId, 'usr_student_a');
  assert.equal(instance.data.selectedEvent.code, '100m');
  assert.equal(instance.data.selectedSeries.length, 2);
  assert.equal(instance.data.heightSeries.length, 2);
  assert.equal(instance.data.weightSeries.length, 2);
});

test('coach report view passes the target student id to the admin report api', async () => {
  const calls = [];
  const apiStub = {
    getMyReport: async () => {
      throw new Error('should not load the coach own report');
    },
    getStudentReport: async (targetUserId) => {
      calls.push(targetUserId);
      return { report: makeReport(targetUserId) };
    }
  };
  const instance = createInstance(loadPage(apiStub, ['coach']));

  instance.onLoad({ userId: 'usr_student_b' });
  await flush();

  assert.deepEqual(calls, ['usr_student_b']);
  assert.equal(instance.data.isCoachView, true);
  assert.equal(instance.data.targetUserId, 'usr_student_b');
  assert.equal(instance.data.report.profile.userId, 'usr_student_b');
});

test('report page switches the selected event series without reloading', async () => {
  const apiStub = {
    getMyReport: async () => ({ report: makeReport('usr_student_a') }),
    getStudentReport: async (targetUserId) => ({ report: makeReport(targetUserId) })
  };
  const instance = createInstance(loadPage(apiStub));

  instance.onLoad({});
  await flush();
  instance.onEventChange({ detail: { value: 1 } });

  assert.equal(instance.data.selectedEvent.code, 'long_jump');
  assert.equal(instance.data.selectedSeries.length, 2);
  assert.equal(instance.data.selectedSeries[0].value, 5.1);
});

test('report page surfaces load failures and leaves loading false', async () => {
  const apiStub = {
    getMyReport: async () => {
      throw new Error('report unavailable');
    },
    getStudentReport: async () => {
      throw new Error('report unavailable');
    }
  };
  const instance = createInstance(loadPage(apiStub));

  instance.onLoad({});
  await flush();

  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.error, 'report unavailable');
  assert.equal(instance.data.report, null);
});

test('reload retries after failure and restores the report', async () => {
  let attempt = 0;
  const apiStub = {
    getMyReport: async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('first failure');
      }
      return { report: makeReport('usr_student_a') };
    },
    getStudentReport: async () => {
      throw new Error('unused');
    }
  };
  const instance = createInstance(loadPage(apiStub));

  instance.onLoad({});
  await flush();
  assert.equal(instance.data.error, 'first failure');
  assert.equal(instance.data.report, null);

  instance.reload();
  await flush();

  assert.equal(instance.data.error, '');
  assert.equal(instance.data.report.profile.userId, 'usr_student_a');
});

test('a failed refresh does not keep another student report on screen', async () => {
  const apiStub = {
    getMyReport: async () => ({ report: makeReport('usr_student_a') }),
    getStudentReport: async (targetUserId) => {
      if (targetUserId === 'usr_student_b') {
        throw new Error('student b load failed');
      }
      return { report: makeReport(targetUserId) };
    }
  };
  const instance = createInstance(loadPage(apiStub, ['coach']));

  instance.onLoad({ userId: 'usr_student_a' });
  await flush();
  assert.equal(instance.data.report.profile.userId, 'usr_student_a');

  instance.setData({ targetUserId: 'usr_student_b' });
  instance.loadPage();
  await flush();

  assert.equal(instance.data.report, null);
  assert.equal(instance.data.error, 'student b load failed');
});

test('separate report page instances do not share a user cache', async () => {
  const calls = [];
  const apiStub = {
    getMyReport: async () => ({ report: makeReport('usr_student_a') }),
    getStudentReport: async (targetUserId) => {
      calls.push(targetUserId);
      return { report: makeReport(targetUserId) };
    }
  };
  const first = createInstance(loadPage(apiStub, ['coach']));
  const second = createInstance(loadPage(apiStub, ['developer']));

  first.onLoad({ userId: 'usr_student_a' });
  second.onLoad({ userId: 'usr_student_b' });
  await flush();

  assert.deepEqual(calls, ['usr_student_a', 'usr_student_b']);
  assert.equal(first.data.report.profile.userId, 'usr_student_a');
  assert.equal(second.data.report.profile.userId, 'usr_student_b');
});

test('report page is registered and both student and coach entries point to it', () => {
  const appConfig = readProjectJson(APP_JSON);
  assert.ok(appConfig.pages.includes('pages/student-report/student-report'));

  const reportConfig = readProjectJson(REPORT_JSON);
  assert.equal(
    reportConfig.usingComponents['trend-chart'],
    '/components/trend-chart/trend-chart'
  );

  assert.match(readProjectFile(STUDENT_WXML), /bindtap="goReport"/);
  assert.match(
    readProjectFile(STUDENT_JS),
    /\/pages\/student-report\/student-report/
  );
});
