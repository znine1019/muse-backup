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

/* 与阶段1—6 测试相同的轻量 Page 宿主，支持 'a.b' 形式的 setData 路径 */
function loadPage(relativePath, apiStub, roles, wxOverrides = {}, extraModules = {}) {
  const file = path.join(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  let page = null;
  const wx = {
    reLaunch: () => {},
    navigateTo: () => {},
    showToast: () => {},
    showModal: (options) => options.success({ confirm: false }),
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
        if (request.includes('utils/demo-mode')) {
          return { isDemoAllowed: () => false };
        }
        if (request.includes('utils/active-role')) {
          return {
            ACTIVE_ROLE_KEY: 'jogger_active_role_v1',
            clearActiveRole: () => {},
            readActiveRole: () => '',
            resolveActiveRole: (session, available) =>
              Array.isArray(available) && available.length ? available[0] : '',
            saveActiveRole: () => {},
            sessionToken: () => ({ userId: '', roles: [] })
          };
        }
        if (request.includes('workbench-controller')) {
          return require(path.join(PROJECT_ROOT, 'miniprogram/utils/workbench-controller.js'));
        }
        if (request.includes('config/env')) {
          return { CLOUD_ENV_ID: 'cloud1-test', API_FUNCTION_NAME: 'api', HEALTH_FUNCTION_NAME: 'health_check' };
        }
        if (extraModules[request]) {
          return extraModules[request];
        }
        return {
          getRoleLabel: (role) =>
            ({ developer: '开发者', coach: '教练员', student: '学生' }[role] || role),
          getSessionDestination: () => ({ url: '/pages/index/index' }),
          getStatusLabel: (status) =>
            ({
              active: '已启用',
              disabled: '已停用',
              pending_review: '待审核',
              pending_profile: '待完善资料'
            }[status] || status),
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
      JSON
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
  return instance;
}

/* ---------- 学生工作台 ---------- */

const STUDENT_API = {
  getProfile: async () => ({
    userStatus: 'active',
    profile: { name: '学生甲', gender: 'male', primaryEventName: '100米' }
  }),
  getStudentTodayAttendance: async () => ({
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
          lateAfterTime: '16:30',
          radiusMeters: 150,
          phase: 'open'
        },
        status: 'pending',
        leaveStatus: '',
        record: null
      }
    ]
  }),
  getMyStatistics: async (payload) => ({
    __payload: payload,
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
      approvedCount: 3,
      personalBests: [
        { eventCode: '100m', eventName: '100米', value: 11.8, unit: '秒', date: '2026-10-01' }
      ],
      latestPerformances: [],
      stageChanges: [
        {
          eventCode: '100m',
          eventName: '100米',
          firstValue: 12.1,
          latestValue: 11.8,
          unit: '秒',
          change: 0.3,
          latestDate: '2026-10-01'
        }
      ],
      targetComparison: {
        eventName: '100米',
        targetValue: 11.5,
        unit: '秒',
        hasCurrentResult: true,
        currentValue: 11.8,
        achieved: false
      }
    },
    feedback: { total: 0, averageRpe: null, recentRpe: [] },
    dataQuality: { membershipHistoryNote: '历史名单按成员关系时间范围估算。' }
  }),
  listStudentNotices: async () => ({
    notices: [
      {
        noticeId: 'notice_1',
        title: '队内测试安排调整',
        content: '测试时间调整。',
        priority: 'important',
        isRead: false,
        categoryLabel: '公告',
        publishedAt: '2026-10-12T02:00:00.000Z'
      }
    ],
    unreadCount: 1,
    truncated: false
  })
};

test('阶段7-2 学生工作台复用真实接口并完成数据绑定', async () => {
  const { page } = loadPage(
    'miniprogram/pages/student/student.js',
    STUDENT_API,
    ['student']
  );
  const instance = createInstance(page);
  await instance.loadPage();

  assert.equal(instance.data.profile.name, '学生甲');
  assert.equal(instance.data.genderLabel, '男');
  assert.match(instance.data.headMeta, /学生甲/);
  assert.match(instance.data.headMeta, /短跑组/);

  assert.equal(instance.data.todaySessions.length, 1);
  assert.equal(instance.data.todaySessions[0].canCheckIn, true);
  assert.equal(instance.data.todaySessions[0].statusLabel, '待签到');
  assert.equal(instance.data.todayDate, '2026-10-13');

  assert.equal(instance.data.stats.hasPb, true);
  assert.equal(instance.data.stats.pbRawValue, 11.8);
  assert.equal(instance.data.stats.pbUnit, '秒');
  assert.equal(instance.data.stats.attendanceRateText, '83.33%');
  assert.equal(instance.data.stats.changes.length, 1);
  assert.match(instance.data.stats.changes[0].metaText, /12\.1 秒 → 11\.8 秒/);

  assert.equal(instance.data.notices.length, 1);
  assert.equal(instance.data.notices[0].isImportant, true);
  assert.match(instance.data.noticeActionText, /1/);

  assert.equal(instance.data.statsState.error, '');
  assert.equal(instance.data.todayState.error, '');
});

test('阶段7-2 学生工作台在无真实数据时给出空状态而不是假数据', async () => {
  const emptyApi = {
    getProfile: async () => ({ userStatus: 'active', profile: { name: '学生乙', gender: 'unspecified' } }),
    getStudentTodayAttendance: async () => ({ date: '2026-10-13', sessions: [] }),
    getMyStatistics: async () => ({
      period: { label: '2026年10月' },
      profile: { name: '学生乙', primaryEventName: '' },
      groups: [],
      attendance: { validAttendance: 0, actualExpected: 0, late: 0, absent: 0, pendingVerification: 0, attendanceRate: null },
      performance: { approvedCount: 0, personalBests: [], latestPerformances: [], stageChanges: [], targetComparison: null },
      feedback: {},
      dataQuality: {}
    }),
    listStudentNotices: async () => ({ notices: [], unreadCount: 0 })
  };
  const { page } = loadPage(
    'miniprogram/pages/student/student.js',
    emptyApi,
    ['student']
  );
  const instance = createInstance(page);
  await instance.loadPage();

  assert.equal(instance.data.todaySessions.length, 0);
  assert.equal(instance.data.stats.hasPb, false);
  assert.equal(instance.data.stats.attendanceRateText, '');
  assert.equal(instance.data.notices.length, 0);
  assert.equal(instance.data.unreadCount, 0);
  assert.match(instance.data.noticeMeta, /全部已读/);
});

test('阶段7-2 学生工作台单区块失败不影响其它区块并支持重试', async () => {
  let failStats = true;
  const api = {
    ...STUDENT_API,
    getMyStatistics: async () => {
      if (failStats) {
        throw Object.assign(new Error('统计暂不可用'), { code: 'STATS_FAILED' });
      }
      return STUDENT_API.getMyStatistics({});
    }
  };
  const { page } = loadPage('miniprogram/pages/student/student.js', api, ['student']);
  const instance = createInstance(page);
  await instance.loadPage();

  assert.match(instance.data.statsState.error, /统计暂不可用/);
  assert.equal(instance.data.todaySessions.length, 1);
  assert.equal(instance.data.profile.name, '学生甲');

  failStats = false;
  await instance.loadStatistics();
  assert.equal(instance.data.statsState.error, '');
  assert.equal(instance.data.stats.hasPb, true);
});

/* ---------- 教练工作台 ---------- */

const COACH_API = {
  listManageAttendanceSessions: async () => ({
    sessions: [
      {
        sessionId: 'session_1',
        title: '速度耐力训练',
        trainingGroupName: '短跑组',
        locationName: '田径场 A 区',
        attendanceDate: '2026-10-13',
        checkInOpenTime: '16:00',
        checkInCloseTime: '17:00',
        lateAfterTime: '16:30',
        radiusMeters: 150,
        phase: 'open'
      }
    ]
  }),
  getAttendanceRoster: async () => ({
    summary: {
      expected: 18,
      checkedIn: 14,
      late: 2,
      leaveApproved: 1,
      pendingVerification: 0,
      pending: 2
    }
  }),
  listPendingLeaves: async () => ({
    leaves: [
      {
        leaveId: 'leave_1',
        studentName: '学生甲',
        attendanceDate: '2026-10-14',
        status: 'pending',
        trainingGroupName: '短跑组',
        reason: '病假'
      }
    ],
    pendingCount: 1
  }),
  listPendingPerformances: async () => ({
    performances: [
      {
        performanceId: 'performance_1',
        studentName: '学生乙',
        eventName: '100米',
        value: 11.9,
        unit: '秒',
        trainingGroupNames: ['短跑组'],
        source: 'student_report',
        achievedAt: '2026-10-12'
      }
    ],
    pendingCount: 1
  }),
  listManagedFeedback: async () => ({
    feedback: [
      {
        feedbackId: 'feedback_1',
        studentName: '学生丙',
        attendanceDate: '2026-10-12',
        completionStatus: 'not_completed',
        rpe: 9,
        comment: '膝盖不适'
      }
    ],
    attentionCount: 1
  }),
  listManageCompetitions: async () => ({
    competitions: [
      { competitionId: 'c1', status: 'published', phase: 'open', activeStudentCount: 3 }
    ]
  }),
  listPendingRegistrations: async () => ({
    registrations: [
      {
        userId: 'user_1',
        name: '学生丁',
        requestedTrainingGroupName: '短跑组',
        primaryTrainingProject: '100米'
      }
    ]
  })
};

test('阶段7-2 教练工作台聚合待办且只跳转不直接写入', async () => {
  const writeCalls = [];
  const navigations = [];
  const api = {
    ...COACH_API,
    reviewLeave: async () => writeCalls.push('reviewLeave'),
    reviewPerformance: async () => writeCalls.push('reviewPerformance'),
    reviewFeedback: async () => writeCalls.push('reviewFeedback')
  };
  const { page } = loadPage('miniprogram/pages/coach/coach.js', api, ['coach'], {
    navigateTo: (options) => navigations.push(options.url)
  });
  const instance = createInstance(page);
  await instance.loadPage();

  assert.equal(instance.data.rosterSummary.expected, 18);
  assert.equal(instance.data.rosterSummary.checkedIn, 14);
  assert.equal(instance.data.todaySessions[0].isFocus, true);

  assert.equal(instance.data.todoItems.length, 3);
  assert.equal(instance.data.todoCounts.leave, 1);
  assert.equal(instance.data.todoCounts.score, 1);
  assert.equal(instance.data.todoCounts.feedback, 1);
  assert.equal(instance.data.todoTotal, 3);
  assert.equal(instance.data.todoVisible.length, 3);

  assert.match(instance.data.competitionText, /报名中 1 场/);
  assert.match(instance.data.competitionText, /3 人次/);

  const leaveItem = instance.data.todoItems.find((item) => item.cat === 'leave');
  instance.onTodoTap({ currentTarget: { dataset: { url: leaveItem.url } } });
  assert.equal(navigations[navigations.length - 1], '/pages/attendance-manage/attendance-manage');
  assert.equal(writeCalls.length, 0, '工作台不得直接写入业务状态');

  /* 筛选为客户端过滤，不产生额外请求 */
  instance.onTodoFilterTap({ currentTarget: { dataset: { value: 'score' } } });
  assert.equal(instance.data.todoVisible.length, 1);
  assert.equal(instance.data.todoVisible[0].cat, 'score');
});

test('阶段7-2 教练工作台注册审核必须二次确认', async () => {
  const calls = [];
  const api = {
    ...COACH_API,
    reviewRegistration: async (payload) => {
      calls.push(payload);
    }
  };

  const cancelled = loadPage('miniprogram/pages/coach/coach.js', api, ['coach'], {
    showModal: (options) => options.success({ confirm: false })
  });
  const cancelledInstance = createInstance(cancelled.page);
  await cancelledInstance.loadPage();
  await cancelledInstance.review({
    currentTarget: { dataset: { userId: 'user_1', decision: 'approve' } }
  });
  assert.equal(calls.length, 0, '取消确认时不得写入');

  const confirmed = loadPage('miniprogram/pages/coach/coach.js', api, ['coach'], {
    showModal: (options) => options.success({ confirm: true })
  });
  const confirmedInstance = createInstance(confirmed.page);
  await confirmedInstance.loadPage();
  await confirmedInstance.review({
    currentTarget: { dataset: { userId: 'user_1', decision: 'approve' } }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetUserId, 'user_1');
  assert.equal(calls[0].decision, 'approve');
});

test('阶段7-2 教练工作台在无待办时展示空状态数据', async () => {
  const api = {
    ...COACH_API,
    listManageAttendanceSessions: async () => ({ sessions: [] }),
    listPendingLeaves: async () => ({ leaves: [], pendingCount: 0 }),
    listPendingPerformances: async () => ({ performances: [], pendingCount: 0 }),
    listManagedFeedback: async () => ({ feedback: [], attentionCount: 0 }),
    listManageCompetitions: async () => ({ competitions: [] }),
    listPendingRegistrations: async () => ({ registrations: [] })
  };
  const { page } = loadPage('miniprogram/pages/coach/coach.js', api, ['coach']);
  const instance = createInstance(page);
  await instance.loadPage();

  assert.equal(instance.data.todaySessions.length, 0);
  assert.equal(instance.data.todoItems.length, 0);
  assert.equal(instance.data.todoVisible.length, 0);
  assert.equal(instance.data.registrations.length, 0);
  assert.match(instance.data.competitionText, /没有开放报名的赛事/);
});

/* ---------- 开发者工作台 ---------- */

const ADMIN_API = {
  healthCheck: async () => ({
    cloudFunctionReady: true,
    databaseReady: true,
    serverTime: '2026-10-13T02:00:00.000Z'
  }),
  listUsers: async () => ({
    users: [
      { userId: 'u1', displayName: '开发者甲', status: 'active', roles: ['developer'] },
      { userId: 'u2', displayName: '教练甲', status: 'active', roles: ['coach'] },
      { userId: 'u3', displayName: '学生甲', status: 'disabled', roles: ['student'] }
    ]
  }),
  listAllTrainingGroups: async () => ({
    groups: [
      { id: 'g1', name: '短跑组', seasonLabel: '2026', enabled: true, coachUserIds: ['u2'] }
    ]
  }),
  listPendingRegistrations: async () => ({
    registrations: [
      {
        userId: 'u9',
        name: '待审学生',
        requestedTrainingGroupName: '短跑组',
        primaryTrainingProject: '100米'
      }
    ]
  }),
  listPendingPerformances: async () => ({ performances: [], pendingCount: 4 }),
  listPendingLeaves: async () => ({ leaves: [], pendingCount: 2 })
};

test('阶段7-2 开发者工作台使用开发者角色文案与真实统计', async () => {
  const { page } = loadPage('miniprogram/pages/admin/admin.js', ADMIN_API, ['developer']);
  const instance = createInstance(page);
  await instance.loadPage();

  assert.match(instance.data.headMeta, /开发者/);
  assert.doesNotMatch(instance.data.headMeta, /教练员/);

  assert.equal(instance.data.system.overallText, '运行正常');
  assert.equal(instance.data.system.databaseReady, true);
  assert.equal(instance.data.system.envId, 'cloud1-test');

  assert.equal(instance.data.accountSummary.total, 3);
  assert.equal(instance.data.accountSummary.students, 1);
  assert.equal(instance.data.accountSummary.coaches, 1);
  assert.equal(instance.data.accountSummary.developers, 1);
  assert.equal(instance.data.accountSummary.disabled, 1);

  assert.equal(instance.data.groupSummary.total, 1);
  assert.equal(instance.data.groupSummary.enabled, 1);
  assert.equal(instance.data.registrations.length, 1);

  assert.equal(instance.data.pendingPerformances, 4);
  assert.equal(instance.data.pendingLeaves, 2);
  assert.equal(instance.data.pendingTotal, 7);

  /* 管理面板默认收起，避免大量纵向大按钮 */
  assert.equal(instance.data.showUserPanel, false);
  assert.equal(instance.data.showGroupPanel, false);
  instance.toggleUserPanel();
  assert.equal(instance.data.showUserPanel, true);
});

test('阶段7-2 开发者工作台的角色与账号变更必须二次确认', async () => {
  const calls = [];
  const api = {
    ...ADMIN_API,
    assignRole: async (payload) => calls.push({ type: 'role', payload }),
    setUserStatus: async (payload) => calls.push({ type: 'status', payload })
  };
  const { page } = loadPage('miniprogram/pages/admin/admin.js', api, ['developer'], {
    showModal: (options) => options.success({ confirm: false })
  });
  const instance = createInstance(page);
  await instance.loadPage();

  await instance.toggleRole({
    currentTarget: { dataset: { userId: 'u1', role: 'coach', grant: 'true' } }
  });
  await instance.toggleUserStatus({
    currentTarget: { dataset: { userId: 'u1', status: 'disabled' } }
  });
  assert.equal(calls.length, 0, '取消确认时不得写入角色或账号状态');
});

/* ---------- 跳转目标必须真实存在 ---------- */

test('阶段7-2 三个工作台的跳转目标全部为已注册页面', () => {
  const appConfig = JSON.parse(readProjectFile('miniprogram/app.json'));
  const registered = new Set(appConfig.pages);
  const files = [
    'miniprogram/pages/student/student.js',
    'miniprogram/pages/coach/coach.js',
    'miniprogram/pages/admin/admin.js'
  ];
  let checked = 0;
  for (const file of files) {
    const source = readProjectFile(file);
    const matches = source.match(/url:\s*['"`]\/pages\/[^'"`?]+/g) || [];
    for (const match of matches) {
      /* app.json 中的页面路径不带前导斜杠，wx.navigateTo 需要前导斜杠 */
      const route = match.replace(/url:\s*['"`]/, '').replace(/^\//, '');
      assert.ok(
        registered.has(route),
        `${file} 跳转目标 ${route} 未在 app.json 注册`
      );
      checked += 1;
    }
  }
  assert.ok(checked >= 20, `应检查到足够数量的跳转目标（实际 ${checked}）`);
});

test('阶段7-2 三个工作台均使用统一头部与空状态组件', () => {
  for (const page of ['student', 'coach', 'admin']) {
    const wxml = readProjectFile(`miniprogram/pages/${page}/${page}.wxml`);
    assert.match(wxml, /<jg-page-head/, `${page} 使用统一页面头部组件`);
    assert.match(wxml, /<jg-empty/, `${page} 使用统一空状态组件`);
    assert.doesNotMatch(wxml, /\bCOACH\b/, `${page} 不包含英文模块名 COACH`);
  }
});
