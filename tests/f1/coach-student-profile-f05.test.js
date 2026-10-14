'use strict';

/**
 * BUG-F05｜教练员学生档案入口与学生资料权限回归测试
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const createProfileActions = require('../../cloudfunctions/api/actions/profile');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ATTENDANCE_PAGE = 'miniprogram/pages/attendance-manage/attendance-manage.js';
const PROFILE_PAGE = 'miniprogram/pages/profile-view/profile-view.js';
const ADMIN_PAGE = 'miniprogram/pages/admin/admin.js';

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
    stopPullDownRefresh: () => {},
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
          CLOUD_ENV_ID: 'cloud1-test',
          isDemoAllowed: () => false,
          getRoleLabel: (role) =>
            ({ developer: '开发者', coach: '教练员', student: '学生' }[role] || role),
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

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to be rejected');
}

function session(sessionId) {
  return {
    sessionId,
    title: '训练场次',
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

function roster() {
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
        studentUserId: 'usr_student_a',
        studentName: '学生甲',
        status: 'checked_in',
        leaveStatus: ''
      }
    ]
  };
}

const PROFILE_USERS = Object.freeze({
  coachA: { _id: 'usr_coach_a', status: 'active', roles: ['coach'] },
  coachB: { _id: 'usr_coach_b', status: 'active', roles: ['coach'] },
  studentA: { _id: 'usr_student_a', status: 'active', roles: ['student'] },
  studentB: { _id: 'usr_student_b', status: 'active', roles: ['student'] },
  developer: { _id: 'usr_developer', status: 'active', roles: ['developer'] },
  parent: { _id: 'usr_parent', status: 'active', roles: ['parent'] }
});

const PROFILE_IDENTITIES = Object.freeze({
  coachA: { appid: 'wx_test', openid: 'openid_coach_a' },
  coachB: { appid: 'wx_test', openid: 'openid_coach_b' },
  studentA: { appid: 'wx_test', openid: 'openid_student_a' },
  studentB: { appid: 'wx_test', openid: 'openid_student_b' },
  developer: { appid: 'wx_test', openid: 'openid_developer' },
  parent: { appid: 'wx_test', openid: 'openid_parent' }
});

function createProfilePermissionHarness() {
  const usersById = new Map(Object.values(PROFILE_USERS).map((user) => [user._id, user]));
  const usersByOpenId = new Map(
    Object.entries(PROFILE_IDENTITIES).map(([key, identity]) => [
      identity.openid,
      PROFILE_USERS[key]
    ])
  );
  const profiles = new Map([
    [PROFILE_USERS.studentA._id, { userId: PROFILE_USERS.studentA._id, name: '学生甲' }],
    [PROFILE_USERS.studentB._id, { userId: PROFILE_USERS.studentB._id, name: '学生乙' }]
  ]);
  const studentsByGroup = new Map([
    ['group_a', [PROFILE_USERS.studentA._id]],
    ['group_b', [PROFILE_USERS.studentB._id]]
  ]);
  const coachGroups = new Map([
    [PROFILE_USERS.coachA._id, ['group_a']],
    [PROFILE_USERS.coachB._id, ['group_a']]
  ]);

  return {
    setCoachGroups(userId, groupIds) {
      coachGroups.set(userId, [...groupIds]);
    },
    repository: {
      ensureUser: async (identity) => usersByOpenId.get(identity.openid) || null,
      getUserById: async (userId) => usersById.get(userId) || null,
      getProfile: async (userId) => profiles.get(userId) || null,
      listMeasurements: async () => [],
      listPerformanceRecords: async () => [],
      getCoachGroupIds: async (userId) => [...(coachGroups.get(userId) || [])],
      getStudentUserIdsForGroups: async (groupIds) =>
        Array.from(
          new Set(groupIds.flatMap((groupId) => studentsByGroup.get(groupId) || []))
        )
    }
  };
}

test('BUG-F05 考勤名单提供使用真实 studentUserId 的档案入口', () => {
  const wxml = read('miniprogram/pages/attendance-manage/attendance-manage.wxml');
  const buttonIndex = wxml.indexOf('bindtap="goStudentProfile"');
  assert.ok(buttonIndex > 0, '考勤名单应存在档案入口');
  const entry = wxml.slice(Math.max(0, buttonIndex - 240), buttonIndex + 120);
  assert.match(entry, /data-student-user-id="\{\{item\.studentUserId\}\}"/);
  assert.match(entry, /bindtap="goStudentProfile">查看档案<\/button>/);
  assert.ok(!entry.includes('item.studentName" bindtap="goStudentProfile"'));
});

test('BUG-F05 goStudentProfile 使用合法 userId 并编码导航参数', () => {
  const { page, calls } = loadPage(ATTENDANCE_PAGE, {}, ['coach']);
  const instance = createInstance(page);

  instance.goStudentProfile({
    currentTarget: { dataset: { studentUserId: 'usr_student/甲' } }
  });
  assert.equal(
    calls.navigateTo[0].url,
    '/pages/profile-view/profile-view?userId=usr_student%2F%E7%94%B2'
  );
});

test('BUG-F05 userId 缺失时不生成虚假档案入口', () => {
  const { page, calls } = loadPage(ATTENDANCE_PAGE, {}, ['coach']);
  const instance = createInstance(page);

  instance.goStudentProfile({ currentTarget: { dataset: {} } });
  assert.equal(calls.navigateTo.length, 0);
});

test('BUG-F05 从自动定位的名单行可导航到对应学生档案', async () => {
  const api = {
    listManageAttendanceSessions: async () => ({ sessions: [session('s1')] }),
    listPendingLeaves: async () => ({ leaves: [], pendingCount: 0 }),
    listPlanMeta: async () => ({ groups: [] }),
    getAttendanceRoster: async () => roster()
  };
  const { page, calls } = loadPage(ATTENDANCE_PAGE, api, ['coach']);
  const instance = createInstance(page);

  instance.onLoad({ sessionId: 's1' });
  instance.onShow();
  await flush();
  instance.goStudentProfile({
    currentTarget: { dataset: { studentUserId: instance.data.roster[0].studentUserId } }
  });

  assert.equal(instance.data.selectedSessionId, 's1');
  assert.equal(instance.data.roster[0].studentUserId, 'usr_student_a');
  assert.equal(
    calls.navigateTo[0].url,
    '/pages/profile-view/profile-view?userId=usr_student_a'
  );
});

test('BUG-F05 profile-view 使用 userId 调用原有档案接口并渲染数据', async () => {
  const calls = [];
  const api = {
    getStudentProfile: async (userId) => {
      calls.push(userId);
      return {
        profile: {
          name: '学生甲',
          secondaryEventCodes: [],
          examGoal: {}
        },
        measurements: [],
        performances: []
      };
    }
  };
  const { page } = loadPage(PROFILE_PAGE, api, ['coach']);
  const instance = createInstance(page);

  instance.onLoad({ userId: 'usr_student_a' });
  await flush();

  assert.deepEqual(calls, ['usr_student_a']);
  assert.equal(instance.data.profile.name, '学生甲');
  assert.equal(instance.data.error, '');
});

test('BUG-F05 档案接口拒绝时页面不保留受保护资料', async () => {
  const api = {
    getStudentProfile: async () => {
      const error = new Error('只能查看本人负责训练组内的学生档案。');
      error.code = 'OUT_OF_SCOPE';
      throw error;
    }
  };
  const { page } = loadPage(PROFILE_PAGE, api, ['coach']);
  const instance = createInstance(page);
  instance.data.profile = { name: '旧资料' };

  instance.onLoad({ userId: 'usr_student_b' });
  await flush();

  assert.equal(instance.data.profile.name, '旧资料');
  assert.match(instance.data.error, /只能查看本人负责训练组内的学生档案/);
  assert.equal(instance.data.loading, false);
});

test('BUG-F05 student 与 parent 角色不能直接进入学生档案页', async () => {
  for (const roles of [[], ['student'], ['parent']]) {
    let apiCalls = 0;
    const api = {
      getStudentProfile: async () => {
        apiCalls += 1;
      }
    };
    const { page, calls } = loadPage(PROFILE_PAGE, api, roles);
    const instance = createInstance(page);

    instance.onLoad({ userId: 'usr_student_a' });
    await flush();

    assert.equal(apiCalls, 0);
    assert.equal(calls.reLaunch.length, 1);
    assert.equal(calls.reLaunch[0].url, '/pages/index/index');
  }
});

test('BUG-F05 服务端只允许 coach 查看已授权训练组学生', async () => {
  const harness = createProfilePermissionHarness();
  const actions = createProfileActions({ repository: harness.repository });

  const own = await actions['admin.get_student_profile']({
    identity: PROFILE_IDENTITIES.coachA,
    payload: { targetUserId: PROFILE_USERS.studentA._id }
  });
  assert.equal(own.profile.name, '学生甲');

  const denied = await captureError(
    actions['admin.get_student_profile']({
      identity: PROFILE_IDENTITIES.coachA,
      payload: { targetUserId: PROFILE_USERS.studentB._id }
    })
  );
  assert.equal(denied.code, 'OUT_OF_SCOPE');
});

test('BUG-F05 撤权后原训练组学生档案立即不可访问', async () => {
  const harness = createProfilePermissionHarness();
  const actions = createProfileActions({ repository: harness.repository });

  harness.setCoachGroups(PROFILE_USERS.coachA._id, []);
  const denied = await captureError(
    actions['admin.get_student_profile']({
      identity: PROFILE_IDENTITIES.coachA,
      payload: { targetUserId: PROFILE_USERS.studentA._id }
    })
  );
  assert.equal(denied.code, 'OUT_OF_SCOPE');
});

test('BUG-F05 多名教练共享训练组及一名教练跨组授权保持有效', async () => {
  const harness = createProfilePermissionHarness();
  const actions = createProfileActions({ repository: harness.repository });

  const secondCoach = await actions['admin.get_student_profile']({
    identity: PROFILE_IDENTITIES.coachB,
    payload: { targetUserId: PROFILE_USERS.studentA._id }
  });
  assert.equal(secondCoach.profile.name, '学生甲');

  harness.setCoachGroups(PROFILE_USERS.coachA._id, ['group_b']);
  const crossGroup = await actions['admin.get_student_profile']({
    identity: PROFILE_IDENTITIES.coachA,
    payload: { targetUserId: PROFILE_USERS.studentB._id }
  });
  assert.equal(crossGroup.profile.name, '学生乙');
});

test('BUG-F05 developer 保留原全局档案权限，非教练角色被拒绝', async () => {
  const harness = createProfilePermissionHarness();
  const actions = createProfileActions({ repository: harness.repository });

  const developer = await actions['admin.get_student_profile']({
    identity: PROFILE_IDENTITIES.developer,
    payload: { targetUserId: PROFILE_USERS.studentB._id }
  });
  assert.equal(developer.profile.name, '学生乙');

  const parentDenied = await captureError(
    actions['admin.get_student_profile']({
      identity: PROFILE_IDENTITIES.parent,
      payload: { targetUserId: PROFILE_USERS.studentA._id }
    })
  );
  assert.equal(parentDenied.code, 'FORBIDDEN');
});

test('BUG-F05 developer 原有 goStudentProfile 导航保持可用', () => {
  const { page, calls } = loadPage(ADMIN_PAGE, {}, ['developer']);
  const instance = createInstance(page);

  instance.goStudentProfile({
    currentTarget: { dataset: { userId: 'usr_student_b' } }
  });
  assert.equal(
    calls.navigateTo[0].url,
    '/pages/profile-view/profile-view?userId=usr_student_b'
  );
});

test('BUG-F05 原有考勤与 BUG-F04 列表交互未被削弱', () => {
  const wxml = read('miniprogram/pages/attendance-manage/attendance-manage.wxml');
  const js = read(ATTENDANCE_PAGE);

  for (const handler of [
    'selectSession',
    'manualVerify',
    'reviewLeave',
    'createSession',
    'goStudentProfile'
  ]) {
    assert.match(wxml, new RegExp(`bindtap="${handler}"`));
  }
  assert.match(js, /async selectRequestedSession\(sessionId, sessions\)/);
  assert.match(js, /rosterRequestId/);
  assert.match(js, /api\.getAttendanceRoster\(sessionId\)/);
  assert.match(js, /sessionHasRole\(session, 'coach'\)/);
  assert.match(js, /sessionHasRole\(session, 'developer'\)/);
});
