'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const demoModule = require('../../miniprogram/demo/sport-report-demo');
const { isDemoAllowed } = require('../../miniprogram/utils/demo-mode');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REPORT_JS = 'miniprogram/pages/student-report/student-report.js';
const ADMIN_JS = 'miniprogram/pages/admin/admin.js';

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
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

function loadReportPage(apiStub, roles, demoAllowed) {
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
        if (request.includes('utils/workbench-controller')) {
          return require(path.join(PROJECT_ROOT, 'miniprogram/utils/workbench-controller.js'));
        }
        if (request.includes('utils/demo-mode')) {
          return {
            isDemoAllowed: () => demoAllowed,
            isDemoRequest: (options) => Boolean(options && options.demo === '1')
          };
        }
        if (request.includes('demo/sport-report-demo')) {
          return demoModule;
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

function normalReport() {
  return {
    profile: {
      userId: 'usr_student_a',
      name: '真实学生',
      primaryEventCode: '100m',
      primaryEventName: '100米',
      examGoal: {}
    },
    supportedEvents: [
      { code: '100m', name: '100米', unit: '秒', comparison: 'lower' }
    ],
    measurements: [],
    measurementMeta: { total: 0, displayed: 0, chartPointLimit: 120, truncated: false },
    performanceSeries: { '100m': [] },
    performanceMeta: { approvedTotal: 0, chartPointLimit: 120, truncatedEvents: [] },
    personalBests: [],
    stageChanges: [],
    targetComparison: null,
    dataQuality: { measurementCount: 0, approvedPerformanceCount: 0 }
  };
}

test('demo data follows the report contract and athletics directions', () => {
  const report = demoModule.buildDemoReport();
  assert.equal(report.demo.isDemo, true);
  assert.equal(report.demo.marker, 'DEMO｜虚构演示数据');

  const events = new Map(report.supportedEvents.map((event) => [event.code, event]));
  assert.equal(events.get('100m').comparison, 'lower');
  assert.equal(events.get('100m').unit, '秒');
  assert.equal(events.get('800m').comparison, 'lower');
  assert.equal(events.get('long_jump').comparison, 'higher');
  assert.equal(events.get('long_jump').unit, '米');

  const bests = new Map(report.personalBests.map((item) => [item.eventCode, item]));
  assert.equal(bests.get('100m').value, 11.7);
  assert.equal(bests.get('800m').value, 141);
  assert.equal(bests.get('long_jump').value, 5.6);

  assert.equal(report.performanceSeries['100m'].length, 4);
  assert.equal(report.performanceSeries['800m'].length, 3);
  assert.equal(report.performanceSeries.long_jump.length, 3);
  assert.equal(report.measurements.length, 6);
  for (let index = 1; index < report.measurements.length; index += 1) {
    assert.ok(report.measurements[index - 1].date < report.measurements[index].date);
  }

  const sprintChange = report.stageChanges.find(
    (item) => item.eventCode === '100m'
  );
  assert.equal(sprintChange.change, -0.8);
  assert.equal(sprintChange.improved, true);
  const jumpChange = report.stageChanges.find(
    (item) => item.eventCode === 'long_jump'
  );
  assert.equal(jumpChange.change, 0.5);
  assert.equal(jumpChange.improved, true);

  assert.equal(report.targetComparison.targetValue, 11.5);
  assert.equal(report.targetComparison.currentValue, 11.7);
  assert.equal(report.targetComparison.difference, 0.2);
  assert.equal(report.targetComparison.achieved, false);
});

test('demo environment gate fails closed outside develop and trial', () => {
  assert.equal(isDemoAllowed('develop'), true);
  assert.equal(isDemoAllowed('trial'), true);
  assert.equal(isDemoAllowed('release'), false);
  assert.equal(isDemoAllowed(''), false);
  assert.equal(isDemoAllowed(undefined), false);
});

test('developer demo mode uses local data and never calls the report API', async () => {
  const calls = [];
  const apiStub = {
    getMyReport: async () => {
      calls.push('mine');
      return { report: normalReport() };
    },
    getStudentReport: async () => {
      calls.push('student');
      return { report: normalReport() };
    }
  };
  const instance = createInstance(loadReportPage(apiStub, ['developer'], true));

  instance.onLoad({ demo: '1' });
  await flush();

  assert.deepEqual(calls, []);
  assert.equal(instance.data.isDemoMode, true);
  assert.equal(instance.data.report.demo.isDemo, true);
  assert.equal(instance.data.overview.pbText, '11.7');
  assert.equal(instance.data.selectedEvent.code, '100m');
});

test('release environment ignores a manual demo parameter', async () => {
  const calls = [];
  const apiStub = {
    getMyReport: async () => {
      calls.push('mine');
      return { report: normalReport() };
    },
    getStudentReport: async () => {
      calls.push('student');
      return { report: normalReport() };
    }
  };
  const instance = createInstance(loadReportPage(apiStub, ['student'], false));

  instance.onLoad({ demo: '1' });
  await flush();

  assert.deepEqual(calls, ['mine']);
  assert.equal(instance.data.isDemoMode, false);
  assert.equal(instance.data.report.profile.userId, 'usr_student_a');
});

test('non-developer roles cannot enter demo mode', async () => {
  const calls = [];
  const apiStub = {
    getMyReport: async () => {
      calls.push('mine');
      return { report: normalReport() };
    },
    getStudentReport: async () => {
      calls.push('student');
      return { report: normalReport() };
    }
  };
  const instance = createInstance(loadReportPage(apiStub, ['student'], true));

  instance.onLoad({ demo: '1' });
  await flush();

  assert.deepEqual(calls, ['mine']);
  assert.equal(instance.data.isDemoMode, false);
});

test('demo mode switches events and reloads without touching the API', async () => {
  const calls = [];
  const apiStub = {
    getMyReport: async () => {
      calls.push('mine');
      return { report: normalReport() };
    },
    getStudentReport: async () => {
      calls.push('student');
      return { report: normalReport() };
    }
  };
  const instance = createInstance(loadReportPage(apiStub, ['developer'], true));
  instance.onLoad({ demo: '1' });
  await flush();

  const index = instance.data.events.findIndex((event) => event.code === '800m');
  instance.onEventChange({ detail: { value: index } });
  assert.equal(instance.data.selectedEvent.code, '800m');
  assert.deepEqual(
    instance.data.selectedSeries.map((item) => item.value),
    [155, 148, 141]
  );

  instance.reload();
  await flush();
  assert.equal(instance.data.error, '');
  assert.equal(instance.data.isDemoMode, true);
  assert.deepEqual(calls, []);
});

test('demo module is isolated from cloud APIs and production report actions', () => {
  const source = readProjectFile('miniprogram/demo/sport-report-demo.js');
  assert.doesNotMatch(source, /wx\.cloud|callFunction|services\/api/);
  assert.doesNotMatch(source, /getMyReport|getStudentReport|review_performance/);
});

function loadAdminPage(apiStub, roles, demoAllowed, wxOverrides = {}) {
  const file = path.join(PROJECT_ROOT, ADMIN_JS);
  const source = fs.readFileSync(file, 'utf8');
  let page = null;
  const wx = {
    reLaunch: () => {},
    navigateTo: () => {},
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
        if (request.includes('utils/workbench-controller')) {
          return require(path.join(PROJECT_ROOT, 'miniprogram/utils/workbench-controller.js'));
        }
        if (request.includes('utils/demo-mode')) {
          return { isDemoAllowed: () => demoAllowed };
        }
        return {
          getRoleLabel: (role) => role,
          getSessionDestination: () => ({ url: '/pages/index/index' }),
          getStatusLabel: (status) => status,
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

  return { page, wx };
}

test('developer workbench exposes the demo entry only when demo is allowed', async () => {
  const apiStub = {
    listPendingRegistrations: async () => ({ registrations: [] }),
    listUsers: async () => ({ users: [] }),
    listAllTrainingGroups: async () => ({ groups: [] })
  };

  const navigations = [];
  const allowed = loadAdminPage(apiStub, ['developer'], true, {
    navigateTo: (options) => navigations.push(options)
  });
  const allowedInstance = createInstance(allowed.page);
  await allowedInstance.loadPage();
  assert.equal(allowedInstance.data.demoAvailable, true);
  allowedInstance.goDemoReport();
  assert.equal(navigations[0].url, '/pages/student-report/student-report?demo=1');

  const blocked = loadAdminPage(apiStub, ['developer'], false, {
    navigateTo: (options) => navigations.push(options)
  });
  const blockedInstance = createInstance(blocked.page);
  await blockedInstance.loadPage();
  assert.equal(blockedInstance.data.demoAvailable, false);
  blockedInstance.goDemoReport();
  assert.equal(navigations.length, 1);
  assert.match(
    readProjectFile('miniprogram/pages/admin/admin.wxml'),
    /wx:if="\{\{demoAvailable\}\}"[\s\S]*bindtap="goDemoReport"/
  );
});

test('report display fixes use neutral body trend labels and correct units', async () => {
  const report = normalReport();
  report.supportedEvents = [
    { code: '100m', name: '100米', unit: '秒', comparison: 'lower' },
    { code: '800m', name: '800米', unit: '秒', comparison: 'lower' },
    { code: 'long_jump', name: '跳远', unit: '米', comparison: 'higher' }
  ];
  report.performanceSeries = {
    '100m': [{ date: '2026-01-01', value: 12.5, unit: '秒', comparison: 'lower' }],
    '800m': [{ date: '2026-01-02', value: 141, unit: '秒', comparison: 'lower' }],
    long_jump: [{ date: '2026-01-03', value: 5.6, unit: '米', comparison: 'higher' }]
  };
  report.personalBests = [
    {
      eventCode: '100m',
      eventName: '100米',
      value: 12.5,
      unit: '秒',
      comparison: 'lower',
      date: '2026-01-01'
    },
    {
      eventCode: '800m',
      eventName: '800米',
      value: 141,
      unit: '秒',
      comparison: 'lower',
      date: '2026-01-02'
    },
    {
      eventCode: 'long_jump',
      eventName: '跳远',
      value: 5.6,
      unit: '米',
      comparison: 'higher',
      date: '2026-01-03'
    }
  ];
  const apiStub = {
    getMyReport: async () => ({ report }),
    getStudentReport: async () => ({ report })
  };
  const instance = createInstance(loadReportPage(apiStub, ['student'], false));
  instance.onLoad({});
  await flush();

  const bests = new Map(
    instance.data.report.personalBests.map((item) => [item.eventCode, item.displayText])
  );
  assert.equal(bests.get('100m'), '12.5 秒');
  assert.equal(bests.get('800m'), '2分21秒');
  assert.equal(bests.get('long_jump'), '5.6 米');

  const reportWxml = readProjectFile('miniprogram/pages/student-report/student-report.wxml');
  assert.match(reportWxml, /comparison="neutral"/);
  assert.match(reportWxml, /虚构演示数据，仅供界面预览/);
  const chartWxml = readProjectFile('miniprogram/components/trend-chart/trend-chart.wxml');
  assert.match(chartWxml, /身体指标变化趋势/);
});
