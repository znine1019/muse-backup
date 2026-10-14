'use strict';

/**
 * BUG-F04｜教练工作台指定场次跳转与考勤名单自动定位回归测试
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const COACH_PAGE = 'miniprogram/pages/coach/coach.js';
const MANAGE_PAGE = 'miniprogram/pages/attendance-manage/attendance-manage.js';

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function loadPage(relativePath, apiStub, roles, wxOverrides = {}) {
  const file = path.join(PROJECT_ROOT, relativePath);
  const source = read(relativePath);
  let page = null;
  const calls = {
    navigateTo: [],
    reLaunch: []
  };
  const wx = {
    navigateTo: (options) => calls.navigateTo.push(options),
    reLaunch: (options) => calls.reLaunch.push(options),
    showToast: () => {},
    showModal: (options) => options.success({ confirm: false }),
    showActionSheet: (options) => options.fail(),
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
          return {
            createWorkbenchController: () => ({
              setIfChanged: () => {},
              clear: () => {}
            }),
            formatClock: () => '',
            isPermissionLostError: () => false
          };
        }
        if (request.includes('utils/active-role')) {
          return { clearActiveRole: () => {} };
        }
        return {
          getRoleLabel: (role) =>
            ({ developer: '开发者', coach: '教练员', student: '学生' }[role] || role),
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
      Boolean,
      Array,
      Object,
      Promise,
      setTimeout,
      clearTimeout,
      setImmediate,
      JSON,
      encodeURIComponent
    },
    { filename: file }
  );

  assert.ok(page, `${relativePath} should register a Page`);
  return { page, wx, calls };
}

function createInstance(page) {
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update, callback) {
      for (const [key, value] of Object.entries(update)) {
        const match = key.match(/^([A-Za-z_$][\w$]*)\.(.+)$/);
        if (match) {
          if (!instance.data[match[1]] || typeof instance.data[match[1]] !== 'object') {
            instance.data[match[1]] = {};
          }
          instance.data[match[1]][match[2]] = value;
        } else {
          instance.data[key] = value;
        }
      }
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

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function session(sessionId) {
  return {
    sessionId,
    title: `场次${sessionId}`,
    trainingGroupName: '短跑组',
    attendanceDate: '2026-10-15',
    locationName: '田径场',
    radiusMeters: 100,
    checkInOpenTime: '08:00',
    checkInCloseTime: '09:00',
    lateAfterTime: '08:15',
    phase: 'closed'
  };
}

function roster(studentName) {
  return {
    summary: {
      expected: 1,
      checkedIn: 1,
      late: 0,
      leaveApproved: 0,
      pendingVerification: 0,
      pending: 0
    },
    roster: [
      {
        studentUserId: `student_${studentName}`,
        studentName,
        status: 'checked_in',
        leaveStatus: ''
      }
    ]
  };
}

test('BUG-F04 工作台按钮携带真实 sessionId', () => {
  const wxml = read('miniprogram/pages/coach/coach.wxml');
  assert.match(
    wxml,
    /data-session-id="\{\{item\.sessionId\}\}"[^>]*bindtap="goSessionRoster"/,
    '查看名单按钮应把当前场次 sessionId 传给事件处理器'
  );
});

test('BUG-F04 goSessionRoster 使用事件 sessionId 构造跳转 URL', () => {
  const { page, calls } = loadPage(COACH_PAGE, {}, ['coach']);
  const instance = createInstance(page);

  instance.goSessionRoster({
    currentTarget: { dataset: { sessionId: 'att_session_2' } }
  });
  assert.equal(
    calls.navigateTo[0].url,
    '/pages/attendance-manage/attendance-manage?sessionId=att_session_2'
  );
  assert.equal(instance.pendingRefresh, true);
});

test('BUG-F04 sessionId 缺失时保留普通考勤管理入口', () => {
  const { page, calls } = loadPage(COACH_PAGE, {}, ['coach']);
  const instance = createInstance(page);

  instance.goSessionRoster({ currentTarget: { dataset: {} } });
  assert.equal(
    calls.navigateTo[0].url,
    '/pages/attendance-manage/attendance-manage'
  );
});

test('BUG-F04 考勤页读取参数并在列表加载后自动选中目标场次', async () => {
  const rosterCalls = [];
  const api = {
    listManageAttendanceSessions: async () => ({ sessions: [session('s1'), session('s2')] }),
    listPendingLeaves: async () => ({ leaves: [], pendingCount: 0 }),
    listPlanMeta: async () => ({ groups: [] }),
    getAttendanceRoster: async (sessionId) => {
      rosterCalls.push(sessionId);
      return roster('学生乙');
    }
  };
  const { page } = loadPage(MANAGE_PAGE, api, ['coach']);
  const instance = createInstance(page);

  instance.onLoad({ sessionId: 's2' });
  instance.onShow();
  await flush();

  assert.deepEqual(rosterCalls, ['s2']);
  assert.equal(instance.data.selectedSessionId, 's2');
  assert.equal(instance.data.roster[0].studentName, '学生乙');
  assert.equal(instance.data.summary.checkedIn, 1);
});

test('BUG-F04 无参数进入保持原有手动选择流程', async () => {
  let rosterCalls = 0;
  const api = {
    listManageAttendanceSessions: async () => ({ sessions: [session('s1')] }),
    listPendingLeaves: async () => ({ leaves: [], pendingCount: 0 }),
    listPlanMeta: async () => ({ groups: [] }),
    getAttendanceRoster: async () => {
      rosterCalls += 1;
      return roster('学生甲');
    }
  };
  const { page } = loadPage(MANAGE_PAGE, api, ['coach']);
  const instance = createInstance(page);

  instance.onLoad({});
  instance.onShow();
  await flush();

  assert.equal(rosterCalls, 0);
  assert.equal(instance.data.selectedSessionId, '');
  assert.equal(instance.data.sessions.length, 1);
});

test('BUG-F04 无效或非授权 sessionId 不请求名单并提示重新选择', async () => {
  let rosterCalls = 0;
  const api = {
    listManageAttendanceSessions: async () => ({ sessions: [session('s1')] }),
    listPendingLeaves: async () => ({ leaves: [], pendingCount: 0 }),
    listPlanMeta: async () => ({ groups: [] }),
    getAttendanceRoster: async () => {
      rosterCalls += 1;
      return roster('不应返回');
    }
  };
  const { page } = loadPage(MANAGE_PAGE, api, ['coach']);
  const instance = createInstance(page);

  instance.onLoad({ sessionId: 'unauthorized_s2' });
  instance.onShow();
  await flush();

  assert.equal(rosterCalls, 0);
  assert.equal(instance.data.selectedSessionId, '');
  assert.match(instance.data.error, /不存在或不在当前授权范围/);
  assert.equal(instance.data.sessions.length, 1);
});

test('BUG-F04 场次列表失败时保留目标参数，重试后可自动定位', async () => {
  let shouldFail = true;
  let rosterCalls = 0;
  const api = {
    listManageAttendanceSessions: async () => {
      if (shouldFail) {
        throw new Error('列表加载失败');
      }
      return { sessions: [session('s1')] };
    },
    listPendingLeaves: async () => ({ leaves: [], pendingCount: 0 }),
    listPlanMeta: async () => ({ groups: [] }),
    getAttendanceRoster: async () => {
      rosterCalls += 1;
      return roster('学生甲');
    }
  };
  const { page } = loadPage(MANAGE_PAGE, api, ['coach']);
  const instance = createInstance(page);

  instance.onLoad({ sessionId: 's1' });
  instance.onShow();
  await flush();
  assert.match(instance.data.error, /列表加载失败/);
  assert.equal(instance.requestedSessionId, 's1');

  shouldFail = false;
  await instance.loadPage();
  assert.equal(rosterCalls, 1);
  assert.equal(instance.data.selectedSessionId, 's1');
});

test('BUG-F04 慢响应不得覆盖用户后来选择的场次', async () => {
  const firstRoster = deferred();
  const secondRoster = deferred();
  const api = {
    listManageAttendanceSessions: async () => ({ sessions: [session('s1'), session('s2')] }),
    listPendingLeaves: async () => ({ leaves: [], pendingCount: 0 }),
    listPlanMeta: async () => ({ groups: [] }),
    getAttendanceRoster: (sessionId) =>
      sessionId === 's1' ? firstRoster.promise : secondRoster.promise
  };
  const { page } = loadPage(MANAGE_PAGE, api, ['coach']);
  const instance = createInstance(page);

  instance.onLoad({ sessionId: 's1' });
  instance.onShow();
  await flush();

  const secondSelection = instance.selectSession({
    currentTarget: { dataset: { sessionId: 's2' } }
  });
  secondRoster.resolve(roster('学生乙'));
  await secondSelection;
  assert.equal(instance.data.selectedSessionId, 's2');
  assert.equal(instance.data.roster[0].studentName, '学生乙');

  firstRoster.resolve(roster('学生甲'));
  await flush();
  assert.equal(instance.data.selectedSessionId, 's2');
  assert.equal(instance.data.roster[0].studentName, '学生乙');
});

test('BUG-F04 自动定位只触发一次名单请求', async () => {
  let rosterCalls = 0;
  const api = {
    listManageAttendanceSessions: async () => ({ sessions: [session('s1')] }),
    listPendingLeaves: async () => ({ leaves: [], pendingCount: 0 }),
    listPlanMeta: async () => ({ groups: [] }),
    getAttendanceRoster: async () => {
      rosterCalls += 1;
      return roster('学生甲');
    }
  };
  const { page } = loadPage(MANAGE_PAGE, api, ['coach']);
  const instance = createInstance(page);

  instance.onLoad({ sessionId: 's1' });
  instance.onShow();
  await flush();
  assert.equal(rosterCalls, 1);

  await instance.loadPage();
  assert.equal(rosterCalls, 1, '目标参数消费后再次刷新不应重复自动选择');
});

test('BUG-F04 非 coach/developer 仍被原角色判断拦截', async () => {
  let apiCalls = 0;
  const api = {
    listManageAttendanceSessions: async () => {
      apiCalls += 1;
      return { sessions: [] };
    }
  };
  const { page, calls } = loadPage(MANAGE_PAGE, api, []);
  const instance = createInstance(page);

  instance.onLoad({ sessionId: 's1' });
  await instance.loadPage();

  assert.equal(apiCalls, 0);
  assert.equal(calls.reLaunch.length, 1);
  assert.equal(calls.reLaunch[0].url, '/pages/index/index');
});

test('BUG-F04 原有考勤业务事件与 coach/developer 权限判断保持', () => {
  const wxml = read('miniprogram/pages/attendance-manage/attendance-manage.wxml');
  const js = read(MANAGE_PAGE);

  for (const handler of [
    'toggleCreateForm',
    'retry',
    'onGroupChange',
    'onFormInput',
    'createSession',
    'selectSession',
    'manualVerify',
    'reviewLeave'
  ]) {
    assert.match(wxml, new RegExp(`bind(?:tap|input|change)="${handler}"`));
  }
  assert.match(js, /sessionHasRole\(session, 'coach'\)/);
  assert.match(js, /sessionHasRole\(session, 'developer'\)/);
  assert.match(js, /api\.getAttendanceRoster\(sessionId\)/);
});
