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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush(times = 6) {
  let chain = Promise.resolve();
  for (let index = 0; index < times; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return chain;
}

/**
 * 轻量 Page 宿主：支持 'a.b' 形式 setData、可变 roles 与会话提供器，
 * 用于验证阶段7-2「保留数据静默刷新」相关行为。
 */
function loadWorkbench(relativePath, apiStub, options = {}) {
  const {
    roles = [],
    wxOverrides = {},
    sessionOf = null,
    clearSessionSpy = null
  } = options;
  const file = path.join(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  let page = null;
  const wx = {
    reLaunch: () => {},
    navigateTo: () => {},
    showToast: () => {},
    showModal: (modalOptions) => modalOptions.success({ confirm: false }),
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
        if (request.includes('workbench-controller')) {
          return require(path.join(PROJECT_ROOT, 'miniprogram/utils/workbench-controller.js'));
        }
        if (request.includes('utils/demo-mode')) {
          return require(path.join(PROJECT_ROOT, 'miniprogram/utils/demo-mode.js'));
        }
        if (request.includes('utils/active-role')) {
          /* 宿主环境无 wx.storage：只保留纯函数语义，存储读写均为空操作 */
          return {
            ACTIVE_ROLE_KEY: 'jogger_active_role_v1',
            clearActiveRole: () => {},
            readActiveRole: () => '',
            resolveActiveRole: (session, available) =>
              Array.isArray(available) && available.length ? available[0] : '',
            saveActiveRole: () => {},
            sessionToken: () => ({ userId: '', roles: [] }),
            isTokenValid: () => false,
            tokenOf: () => ({ userId: '', roles: [] })
          };
        }
        if (request.includes('config/env')) {
          return {
            CLOUD_ENV_ID: 'cloud1-test',
            API_FUNCTION_NAME: 'api',
            HEALTH_FUNCTION_NAME: 'health_check'
          };
        }
        return {
          getRoleLabel: (role) =>
            ({ developer: '开发者', coach: '教练员', student: '学生' }[role] || role),
          getSessionDestination: (session) =>
            require(path.join(PROJECT_ROOT, 'miniprogram/utils/session.js')).getSessionDestination(
              session
            ),
          getStatusLabel: (status) =>
            require(path.join(PROJECT_ROOT, 'miniprogram/utils/session.js')).getStatusLabel(status),
          sessionHasRole: (session, role) =>
            Boolean(
              session &&
                session.user &&
                session.user.status === 'active' &&
                Array.isArray(session.user.roles) &&
                session.user.roles.includes(role)
            ) || roles.includes(role)
        };
      },
      Page: (value) => {
        page = value;
      },
      getApp: () => ({
        ensureSession: async () => (sessionOf ? sessionOf() : {}),
        clearSession: () => {
          if (typeof clearSessionSpy === 'function') {
            clearSessionSpy();
          }
        },
        globalData: { session: sessionOf ? sessionOf() : null }
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
      JSON
    },
    { filename: file }
  );

  assert.ok(page, `${relativePath} should register a Page`);
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
      if (typeof callback === 'function') callback();
    }
  };
  for (const [key, value] of Object.entries(page)) {
    if (typeof value === 'function') instance[key] = value.bind(instance);
  }
  return { page, instance, wx };
}

function studentSession(roles = ['student'], id = 'user_student') {
  return () => ({ sessionVersion: 1, user: { id, status: 'active', roles } });
}

const PROFILE = {
  userStatus: 'active',
  profile: { name: '学生甲', gender: 'male', primaryEventName: '100米' }
};

const TODAY = {
  date: '2026-10-13',
  sessions: [
    {
      session: {
        sessionId: 'session_1',
        title: '速度耐力训练',
        locationName: '田径场 A 区',
        trainingGroupName: '短跑组',
        checkInOpenTime: '16:00',
        checkInCloseTime: '17:00',
        phase: 'open'
      },
      status: 'pending',
      leaveStatus: '',
      record: null
    }
  ]
};

function statsPayload(approvedCount = 3) {
  return {
    period: { label: '2026年10月' },
    profile: { name: '学生甲', primaryEventName: '100米' },
    groups: [{ id: 'g1', name: '短跑组' }],
    attendance: {
      validAttendance: 10,
      actualExpected: 12,
      late: 1,
      absent: 1,
      pendingVerification: 0,
      attendanceRate: 0.8333
    },
    performance: {
      approvedCount,
      personalBests: [
        { eventCode: '100m', eventName: '100米', value: 11.8, unit: '秒', date: '2026-10-01' }
      ],
      latestPerformances: [],
      stageChanges: [],
      targetComparison: null
    },
    feedback: {},
    dataQuality: {}
  };
}

const NOTICES = {
  notices: [
    {
      noticeId: 'notice_1',
      title: '队内测试安排调整',
      content: '测试时间调整。',
      priority: 'important',
      isRead: false,
      publishedAt: '2026-10-12T02:00:00.000Z'
    }
  ],
  unreadCount: 1
};

function baseStudentApi() {
  return {
    getProfile: async () => PROFILE,
    getStudentTodayAttendance: async () => TODAY,
    getMyStatistics: async () => statsPayload(),
    listStudentNotices: async () => NOTICES
  };
}

/* ---------- 1. 首次加载：允许骨架屏，完成后标记 ready ---------- */
test('阶段7-2 首次进入工作台显示骨架屏并在加载完成后就绪', async () => {
  const { instance } = loadWorkbench(
    'miniprogram/pages/student/student.js',
    baseStudentApi(),
    { sessionOf: studentSession() }
  );

  assert.equal(instance.data.hasData, false);
  assert.equal(instance.data.profileState.ready, false);
  assert.equal(instance.data.profileState.loading, true);

  await instance.loadPage();

  assert.equal(instance.data.hasData, true);
  assert.equal(instance.data.profileState.ready, true);
  assert.equal(instance.data.profileState.loading, false);
  assert.equal(instance.data.profile.name, '学生甲');
  assert.match(instance.data.lastUpdatedText, /数据更新于/);
});

/* ---------- 2. 返回工作台：保留已有数据，不进入骨架屏状态 ---------- */
test('阶段7-2 返回工作台时保留已有内容并静默刷新', async () => {
  const api = baseStudentApi();
  const gate = deferred();
  let gated = false;
  api.getProfile = () => (gated ? gate.promise : Promise.resolve(PROFILE));

  const { instance } = loadWorkbench(
    'miniprogram/pages/student/student.js',
    api,
    { sessionOf: studentSession() }
  );
  await instance.loadPage();
  assert.equal(instance.data.hasData, true);

  /* 模拟从业务页面返回：接口挂起期间数据必须仍然可见 */
  gated = true;
  instance.markNeedsRefresh();
  const pending = instance.enterWorkbench();
  await flush();

  assert.equal(instance.data.profile.name, '学生甲');
  assert.equal(instance.data.profileState.loading, false, '不得重新进入骨架屏状态');
  assert.equal(instance.data.profileState.ready, true);
  assert.equal(instance.data.refreshing, true, '应显示轻量刷新状态');
  assert.equal(instance.data.hasData, true);

  gate.resolve(PROFILE);
  await pending;
  assert.equal(instance.data.refreshing, false);
  assert.equal(instance.data.profile.name, '学生甲');
});

/* ---------- 3. 下拉刷新：保留旧数据 ---------- */
test('阶段7-2 下拉刷新保留旧数据并给出轻量刷新状态', async () => {
  const api = baseStudentApi();
  const gate = deferred();
  let gated = false;
  api.getStudentTodayAttendance = () =>
    gated ? gate.promise : Promise.resolve(TODAY);

  const stopSpy = [];
  const { instance } = loadWorkbench(
    'miniprogram/pages/student/student.js',
    api,
    { sessionOf: studentSession(), wxOverrides: { stopPullDownRefresh: () => stopSpy.push(1) } }
  );
  await instance.loadPage();

  gated = true;
  const pending = instance.pullDownRefresh();
  await flush();

  assert.equal(instance.data.todaySessions.length, 1, '下拉刷新期间不得清空已有内容');
  assert.equal(instance.data.todayState.loading, false);
  assert.equal(instance.data.refreshing, true);

  gate.resolve(TODAY);
  await pending;
  assert.equal(instance.data.refreshing, false);
  assert.equal(stopSpy.length, 1, '完成后应结束下拉刷新状态');
});

/* ---------- 4. 局部失败：保留其他区块与旧数据 ---------- */
test('阶段7-2 局部接口失败不清空其他区块并提示显示的是上次数据', async () => {
  const api = baseStudentApi();
  let failStats = false;
  api.getMyStatistics = () => {
    if (failStats) {
      return Promise.reject(Object.assign(new Error('统计暂不可用'), { code: 'INTERNAL_ERROR' }));
    }
    return Promise.resolve(statsPayload());
  };

  const { instance } = loadWorkbench(
    'miniprogram/pages/student/student.js',
    api,
    { sessionOf: studentSession() }
  );
  await instance.loadPage();
  assert.equal(instance.data.stats.hasPb, true);

  failStats = true;
  instance.markNeedsRefresh();
  await instance.enterWorkbench();

  assert.equal(instance.data.todaySessions.length, 1, '其他区块必须保留');
  assert.equal(instance.data.stats.hasPb, true, '失败区块保留上次成功数据');
  assert.match(instance.data.statsState.error, /统计暂不可用/);
  assert.match(instance.data.staleNotice, /上次成功加载/);
  assert.equal(instance.data.hasData, true);
});

/* ---------- 5. 重复请求合并 ---------- */
test('阶段7-2 同一时刻只发起一次完整加载', async () => {
  const api = baseStudentApi();
  const gate = deferred();
  let profileCalls = 0;
  api.getProfile = () => {
    profileCalls += 1;
    return gate.promise;
  };

  const { instance } = loadWorkbench(
    'miniprogram/pages/student/student.js',
    api,
    { sessionOf: studentSession() }
  );

  const first = instance.loadAll({ silent: false, force: true });
  const second = instance.loadAll({ silent: false, force: true });
  await flush();
  assert.equal(profileCalls, 1, '并发调用必须合并为一次请求');

  gate.resolve(PROFILE);
  await Promise.all([first, second]);
  assert.equal(profileCalls, 1);
});

/* ---------- 6. 返回工作台时的短时间抑制与待办强制刷新 ---------- */
test('阶段7-2 短时间内返回不重复请求，业务页返回后强制刷新', async () => {
  const api = baseStudentApi();
  let profileCalls = 0;
  api.getProfile = () => {
    profileCalls += 1;
    return Promise.resolve(PROFILE);
  };

  const { instance } = loadWorkbench(
    'miniprogram/pages/student/student.js',
    api,
    { sessionOf: studentSession() }
  );
  await instance.loadPage();
  assert.equal(profileCalls, 1);

  /* 普通返回：15 秒内不应重复拉取全部数据 */
  await instance.enterWorkbench();
  assert.equal(profileCalls, 1, '短时间内返回应复用已有状态');

  /* 从签到/申报等业务页面返回：强制刷新 */
  instance.markNeedsRefresh();
  await instance.enterWorkbench();
  assert.equal(profileCalls, 2, '业务页返回应强制静默刷新');
});

/* ---------- 7. 缓存失效后旧请求不得回填 ---------- */
test('阶段7-2 缓存失效（退出/权限变化）后旧请求结果不得回填', async () => {
  /* 四个区块都在飞行中，模拟退出登录/权限失效时代次递增 */
  const gates = {
    profile: deferred(),
    today: deferred(),
    stats: deferred(),
    notice: deferred()
  };
  const api = {
    getProfile: () => gates.profile.promise,
    getStudentTodayAttendance: () => gates.today.promise,
    getMyStatistics: () => gates.stats.promise,
    listStudentNotices: () => gates.notice.promise
  };

  const { instance } = loadWorkbench(
    'miniprogram/pages/student/student.js',
    api,
    { sessionOf: studentSession() }
  );

  const pending = instance.loadPage();
  await flush();
  assert.equal(instance.data.profile, null);

  instance.getController().reset();
  gates.profile.resolve(PROFILE);
  gates.today.resolve(TODAY);
  gates.stats.resolve(statsPayload());
  gates.notice.resolve(NOTICES);
  await pending;

  assert.equal(instance.data.profile, null, '旧请求结果不得回填到已失效的缓存');
  assert.equal(instance.data.todaySessions.length, 0);
  assert.equal(instance.data.hasData, false);
});

/* ---------- 8. 身份（角色/状态）变化即失效缓存 ---------- */
test('阶段7-2 角色变化后清空旧身份缓存再重新加载', async () => {
  const api = baseStudentApi();
  const gate = deferred();
  let gated = false;
  api.getProfile = () => (gated ? gate.promise : Promise.resolve(PROFILE));

  let roles = ['student'];
  const { instance } = loadWorkbench(
    'miniprogram/pages/student/student.js',
    api,
    { sessionOf: () => ({ user: { id: 'user_student', status: 'active', roles } }) }
  );
  await instance.loadPage();
  assert.equal(instance.data.profile.name, '学生甲');

  /* 角色集合变化 → 身份指纹变化 → 旧缓存立即失效 */
  roles = ['student', 'coach'];
  gated = true;
  instance.markNeedsRefresh();
  const pending = instance.enterWorkbench();
  await flush();

  assert.equal(instance.data.hasData, false);
  assert.equal(instance.data.profile, null);

  gate.resolve(PROFILE);
  await pending;
  assert.equal(instance.data.profile.name, '学生甲');
});

/* ---------- 9. 权限失效：清空数据并跳转 ---------- */
test('阶段7-2 权限失效时清空敏感数据并按会话跳转', async () => {
  const api = baseStudentApi();
  api.getProfile = () =>
    Promise.reject(Object.assign(new Error('账号已停用，无法访问内部数据。'), { code: 'ACCOUNT_DISABLED' }));

  const reLaunched = [];
  const { instance } = loadWorkbench(
    'miniprogram/pages/student/student.js',
    api,
    { sessionOf: studentSession(), wxOverrides: { reLaunch: (o) => reLaunched.push(o.url) } }
  );

  await instance.loadPage();

  assert.equal(instance.data.profile, null);
  assert.equal(instance.data.hasData, false);
  assert.match(instance.data.sessionError, /账号已停用/);
  assert.equal(reLaunched.length, 1);
});

/* ---------- 10. 退出登录：清理页面内存缓存 ---------- */
test('阶段7-2 退出登录时清空工作台内存缓存', async () => {
  const api = baseStudentApi();
  let cleared = false;
  const { instance } = loadWorkbench(
    'miniprogram/pages/student/student.js',
    api,
    {
      sessionOf: studentSession(),
      clearSessionSpy: () => {
        cleared = true;
      },
      wxOverrides: { showModal: (o) => o.success({ confirm: true }) }
    }
  );
  await instance.loadPage();
  assert.equal(instance.data.profile.name, '学生甲');

  await instance.goHome();

  assert.equal(cleared, true, '应调用 clearSession');
  assert.equal(instance.data.hasData, false);
  assert.equal(instance.data.profile, null);
  assert.equal(instance.data.todaySessions.length, 0);
  assert.equal(instance.data.stats, null);
  assert.equal(instance.data.notices.length, 0);
});

/* ---------- 11. developer 进入教练工作台 ---------- */
test('阶段7-2 开发者工作台提供教练工作台入口且不授予额外角色', () => {
  const adminWxml = read('miniprogram/pages/admin/admin.wxml');
  const adminJs = read('miniprogram/pages/admin/admin.js');
  const appConfig = JSON.parse(read('miniprogram/app.json'));

  assert.match(adminWxml, /bindtap="goCoachWorkbench"/, '开发者工作台应提供教练工作台入口');
  assert.match(adminWxml, /查看教练工作台/);

  const entryBlock = adminJs.slice(
    adminJs.indexOf('goCoachWorkbench()'),
    adminJs.indexOf('goPerformanceReview()')
  );
  assert.match(entryBlock, /navigateTo/, '应使用 navigateTo 进入教练工作台');
  assert.match(entryBlock, /\/pages\/coach\/coach/);
  assert.doesNotMatch(entryBlock, /reLaunch/, '不得使用 reLaunch（否则返回不会回到开发者工作台）');
  assert.doesNotMatch(
    entryBlock,
    /assignRole|setGroupCoach|setUserStatus/,
    '进入教练工作台不得授予角色或修改权限'
  );
  assert.ok(appConfig.pages.includes('pages/coach/coach'));
});

test('阶段7-2 教练工作台允许 coach 与 developer 访问且未放宽到其它角色', () => {
  const coachJs = read('miniprogram/pages/coach/coach.js');
  assert.match(coachJs, /sessionHasRole\(session, 'coach'\)/);
  assert.match(coachJs, /sessionHasRole\(session, 'developer'\)/);
  assert.doesNotMatch(coachJs, /sessionHasRole\(session, 'student'\)[\s\S]{0,80}canManage/);
});

/* ---------- 12. 注册审核与角色能力（不绕过审核） ---------- */
test('阶段7-2 新账号未经审核不能获得任何角色能力', () => {
  const sessionModule = require(path.join(PROJECT_ROOT, 'miniprogram/utils/session.js'));

  const pending = { user: { id: 'new_user', status: 'pending_review', roles: ['student'] } };
  assert.equal(sessionModule.getSessionDestination(pending).url, '/pages/pending/pending');
  assert.equal(sessionModule.sessionHasRole(pending, 'student'), false);
  assert.equal(sessionModule.sessionHasRole(pending, 'coach'), false);
  assert.equal(sessionModule.sessionHasRole(pending, 'developer'), false);

  const pendingProfile = { user: { id: 'new_user', status: 'pending_profile', roles: [] } };
  assert.equal(sessionModule.getSessionDestination(pendingProfile).url, '/pages/pending/pending');

  const coachOnly = { user: { id: 'coach_user', status: 'active', roles: ['coach'] } };
  assert.equal(sessionModule.getSessionDestination(coachOnly).url, '/pages/coach/coach');
  assert.equal(sessionModule.sessionHasRole(coachOnly, 'developer'), false);

  const multi = { user: { id: 'multi_user', status: 'active', roles: ['student', 'coach'] } };
  assert.equal(sessionModule.getSessionDestination(multi).url, '/pages/role-select/role-select');
});

/* ---------- 13. 体验版（trial）不绕过角色权限 ---------- */
test('阶段7-2 体验版允许演示数据但不会绕过角色权限', async () => {
  const demo = require(path.join(PROJECT_ROOT, 'miniprogram/utils/demo-mode.js'));
  assert.equal(demo.isDemoAllowed('trial'), true);
  assert.equal(demo.isDemoAllowed('develop'), true);
  assert.equal(demo.isDemoAllowed('release'), false);
  assert.equal(demo.isDemoAllowed(''), false);

  /* coach-only 账号加载开发者工作台必须被拒绝并跳转 */
  const reLaunched = [];
  const { instance } = loadWorkbench(
    'miniprogram/pages/admin/admin.js',
    {
      healthCheck: async () => ({ cloudFunctionReady: true, databaseReady: true }),
      listUsers: async () => ({ users: [] }),
      listAllTrainingGroups: async () => ({ groups: [] }),
      listPendingRegistrations: async () => ({ registrations: [] }),
      listPendingPerformances: async () => ({ performances: [], pendingCount: 0 }),
      listPendingLeaves: async () => ({ leaves: [], pendingCount: 0 })
    },
    {
      sessionOf: () => ({ user: { id: 'coach_user', status: 'active', roles: ['coach'] } }),
      wxOverrides: { reLaunch: (o) => reLaunched.push(o.url) }
    }
  );

  await instance.loadPage();
  assert.equal(instance.data.hasData, false);
  assert.equal(reLaunched.length, 1);
  assert.equal(reLaunched[0], '/pages/coach/coach');
});

/* ---------- 14. developer 身份保护 ---------- */
test('阶段7-2 developer 身份与 bootstrap 保护保持不变', () => {
  const adminJs = read('miniprogram/pages/admin/admin.js');
  const usersAction = read('cloudfunctions/api/actions/users.js');
  const appConfig = JSON.parse(read('miniprogram/app.json'));

  /* 不允许在前端硬编码授予 developer 角色 */
  assert.doesNotMatch(adminJs, /role:\s*'developer'/);
  assert.doesNotMatch(adminJs, /grant:\s*true[\s\S]{0,40}developer/);

  /* 最后一个开发者保护仍在服务端 */
  assert.match(usersAction, /LAST_DEVELOPER/);

  /* bootstrap 页面与路由保持存在，未被阶段7改动 */
  assert.ok(appConfig.pages.includes('pages/bootstrap/bootstrap'));
  assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'miniprogram/pages/bootstrap/bootstrap.js')));
  assert.match(read('miniprogram/pages/bootstrap/bootstrap.js'), /bootstrapDeveloper/);
});

/* ---------- 15. 路由完整性（含新增入口） ---------- */
test('阶段7-2 三个工作台的全部跳转目标仍为已注册页面', () => {
  const appConfig = JSON.parse(read('miniprogram/app.json'));
  const registered = new Set(appConfig.pages);
  const files = [
    'miniprogram/pages/student/student.js',
    'miniprogram/pages/coach/coach.js',
    'miniprogram/pages/admin/admin.js'
  ];
  let checked = 0;
  for (const file of files) {
    const source = read(file);
    const matches = source.match(/url:\s*['"`]\/pages\/[^'"`?]+/g) || [];
    for (const match of matches) {
      const route = match.replace(/url:\s*['"`]/, '').replace(/^\//, '');
      assert.ok(registered.has(route), `${file} 跳转目标 ${route} 未注册`);
      checked += 1;
    }
  }
  assert.ok(checked >= 20, `应检查到足够数量的跳转目标（实际 ${checked}）`);
});
