'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function loadPage(relativePath, apiStub, roles, wxOverrides = {}) {
  const file = path.join(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  let page = null;
  const wx = {
    reLaunch: () => {},
    navigateTo: () => {},
    showToast: () => {},
    env: { USER_DATA_PATH: '/tmp' },
    getFileSystemManager: () => ({
      writeFile: (options) => options.success()
    }),
    openDocument: (options) => options.success(),
    ...wxOverrides
  };
  vm.runInNewContext(
    source,
    {
      require: (request) => {
        if (request.includes('services/api')) {
          return apiStub;
        }
        if (request.includes('xlsx-writer')) {
          return require(path.join(PROJECT_ROOT, 'miniprogram/utils/xlsx-writer.js'));
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
      setTimeout,
      clearTimeout
    },
    { filename: file }
  );
  assert.ok(page, `${relativePath} should register a Page`);
  return { page, wx };
}

function createInstance(page) {
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update, callback) {
      for (const [key, value] of Object.entries(update)) {
        const match = key.match(/^([A-Za-z_$][\w$]*)\.(.+)$/);
        if (match) {
          this.data[match[1]][match[2]] = value;
        } else {
          this.data[key] = value;
        }
      }
      if (typeof callback === 'function') callback();
    }
  };
  for (const [key, value] of Object.entries(page)) {
    if (typeof value === 'function') instance[key] = value.bind(instance);
  }
  return instance;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

const META = {
  role: 'coach',
  events: [
    { code: '100m', name: '100米', unit: '秒', comparison: 'lower' },
    { code: 'long_jump', name: '跳远', unit: '米', comparison: 'higher' }
  ],
  groups: [
    { id: 'group_a', name: '短跑组', seasonLabel: '2026', enabled: true },
    { id: 'group_b', name: '跳远组', seasonLabel: '2026', enabled: true }
  ]
};

const LEADERBOARD = {
  period: { label: '2026年10月', periodType: 'month', year: 2026, month: 10 },
  event: META.events[0],
  rows: [
    {
      studentUserId: 'student_a',
      studentName: '学生甲',
      isSelf: true,
      rank: 1,
      value: 11.8,
      unit: '秒',
      achievedAt: '2026-10-13',
      trainingGroupNames: ['短跑组'],
      coachNames: ['教练甲'],
      historicalPersonalBest: { value: 11.5, unit: '秒' }
    }
  ]
};

const ATTENDANCE = {
  period: LEADERBOARD.period,
  summary: {
    plannedExpected: 4,
    approvedLeave: 1,
    actualExpected: 3,
    validAttendance: 2,
    late: 1,
    pendingVerification: 0,
    absent: 1,
    attendanceRate: 0.6667,
    lateRate: 0.5
  },
  sessionCounts: { valid: 3, cancelled: 0, open: 0, closed: 3 },
  rows: [
    {
      studentUserId: 'student_a',
      studentName: '学生甲',
      isSelf: false,
      rank: 1,
      validAttendance: 2,
      actualExpected: 3,
      late: 1,
      pendingVerification: 0,
      absent: 1,
      attendanceRate: 0.6667,
      lateRate: 0.5,
      sampleSessions: 3,
      sampleSufficient: true
    }
  ],
  dataQuality: {
    membershipHistoryNote: '历史名单按成员关系时间范围估算。',
    minSampleSessions: 3
  }
};

test('phase 6 pages are registered and workbenches expose entries', () => {
  const appConfig = JSON.parse(readProjectFile('miniprogram/app.json'));
  for (const page of [
    'pages/student-statistics/student-statistics',
    'pages/performance-leaderboard/performance-leaderboard',
    'pages/attendance-statistics/attendance-statistics',
    'pages/stats-workbench/stats-workbench'
  ]) {
    assert.ok(appConfig.pages.includes(page), `${page} should be registered`);
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
      assert.ok(
        fs.existsSync(path.join(PROJECT_ROOT, `miniprogram/${page}${extension}`)),
        `${page}${extension} should exist`
      );
    }
  }
  assert.match(readProjectFile('miniprogram/pages/student/student.wxml'), /goStatistics/);
  assert.match(readProjectFile('miniprogram/pages/coach/coach.wxml'), /goStatsWorkbench/);
  assert.match(readProjectFile('miniprogram/pages/admin/admin.wxml'), /goStatsWorkbench/);
});

test('student statistics page loads overview and RPE series', async () => {
  const apiStub = {
    getMyStatistics: async () => ({
      period: { label: '2026年10月' },
      profile: { name: '学生甲', primaryEventName: '100米' },
      groups: [{ name: '短跑组' }],
      attendance: {
        plannedExpected: 4,
        approvedLeave: 1,
        actualExpected: 3,
        validAttendance: 2,
        late: 1,
        pendingVerification: 0,
        absent: 1,
        attendanceRate: 0.6667,
        lateRate: 0.5
      },
      performance: {
        approvedCount: 1,
        personalBests: [{ eventCode: '100m', eventName: '100米', value: 11.8, unit: '秒', date: '2026-10-13' }],
        latestPerformances: [{ eventCode: '100m', eventName: '100米', value: 11.8, unit: '秒', achievedAt: '2026-10-13' }],
        stageChanges: [],
        targetComparison: null
      },
      feedback: { total: 1, completed: 1, partial: 0, notCompleted: 0, coachReviewed: 0, averageRpe: 6, recentRpe: [{ date: '2026-10-13', value: 6 }] }
    })
  };
  const { page } = loadPage(
    'miniprogram/pages/student-statistics/student-statistics.js',
    apiStub,
    ['student']
  );
  const instance = createInstance(page);
  instance.onShow();
  await flush();
  assert.equal(instance.data.data.profile.name, '学生甲');
  assert.equal(instance.data.rpeSeries.length, 1);
  assert.equal(instance.data.data.attendanceRateText, '66.67%');
});

test('performance leaderboard page formats value and historical PB', async () => {
  const apiStub = {
    getStatisticsMeta: async () => META,
    getPerformanceLeaderboard: async () => LEADERBOARD
  };
  const { page } = loadPage(
    'miniprogram/pages/performance-leaderboard/performance-leaderboard.js',
    apiStub,
    ['coach']
  );
  const instance = createInstance(page);
  instance.onShow();
  await flush();
  assert.equal(instance.data.rows.length, 1);
  assert.equal(instance.data.rows[0].valueText, '11.8 秒');
  assert.equal(instance.data.rows[0].historicalText, '11.5 秒');
});

test('attendance statistics page shows rate and sample marker', async () => {
  const apiStub = {
    getStatisticsMeta: async () => META,
    getAttendanceLeaderboard: async () => ATTENDANCE
  };
  const { page } = loadPage(
    'miniprogram/pages/attendance-statistics/attendance-statistics.js',
    apiStub,
    ['coach']
  );
  const instance = createInstance(page);
  instance.onShow();
  await flush();
  assert.equal(instance.data.summary.attendanceRateText, '66.67%');
  assert.equal(instance.data.rows[0].rankText, '第1名');
  assert.match(instance.data.dataQuality.membershipHistoryNote, /估算/);
});

test('stats workbench loads overview and exports both XLSX reports', async () => {
  const calls = [];
  const writtenFiles = [];
  const apiStub = {
    getStatisticsMeta: async () => META,
    getManageStatistics: async () => ({
      period: { label: '2026年10月' },
      scope: { groupCount: 1, studentCount: 2, enabledGroupCount: 1, coachCount: 1 },
      attendance: ATTENDANCE,
      performance: { approvedCount: 1, summary: { eventCounts: [{ eventCode: '100m', eventName: '100米', count: 1 }] } },
      feedback: { total: 1, attentionCount: 0, coachReviewed: 0, averageRpe: 6 },
      groupComparison: [{ trainingGroupId: 'group_a', trainingGroupName: '短跑组', studentCount: 2, approvedCount: 1, actualExpected: 2, validAttendance: 1, attendanceRate: 0.5 }]
    }),
    exportPerformanceRows: async (payload) => {
      calls.push({ type: 'performance', payload });
      return { total: 1, rows: [{ studentName: '学生甲', trainingGroupNames: ['短跑组'], coachNames: ['教练甲'], eventName: '100米', value: 11.8, unit: '秒', achievedAt: '2026-10-13', status: 'approved', reviewedAt: '2026-10-13T00:00:00.000Z' }] };
    },
    exportAttendanceRows: async (payload) => {
      calls.push({ type: 'attendance', payload });
      return { total: 1, rows: [{ trainingGroupName: '短跑组', attendanceDate: '2026-10-13', studentName: '学生甲', status: 'checked_in', checkInAt: '2026-10-13T00:00:00.000Z', late: false, leaveStatus: '', manualVerified: false }] };
    }
  };
  const { page } = loadPage(
    'miniprogram/pages/stats-workbench/stats-workbench.js',
    apiStub,
    ['coach'],
    {
      getFileSystemManager: () => ({
        writeFile: (options) => {
          writtenFiles.push(options.filePath);
          options.success();
        }
      })
    }
  );
  const instance = createInstance(page);
  instance.onShow();
  await flush();
  assert.equal(instance.data.overview.scope.studentCount, 2);
  await instance.exportPerformance();
  await instance.exportAttendance();
  assert.equal(calls.length, 2);
  assert.equal(writtenFiles.length, 2);
  assert.match(instance.data.success, /考勤记录/);
});
