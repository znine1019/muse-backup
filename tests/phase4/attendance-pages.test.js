'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const STUDENT_PAGE = 'miniprogram/pages/student-attendance/student-attendance.js';
const MANAGE_PAGE = 'miniprogram/pages/attendance-manage/attendance-manage.js';

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
    showModal: (options) => options.success({ confirm: false }),
    showActionSheet: (options) => options.fail(),
    getLocation: (options) => options.fail({ errMsg: 'auth deny' }),
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
      getApp: () => ({ ensureSession: async () => ({}) }),
      wx,
      console,
      Date,
      Math,
      Number,
      String,
      Boolean,
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
        const match = key.match(/^([A-Za-z_$][\w$]*)\.(.+)$/);
        if (match) {
          this.data[match[1]][match[2]] = value;
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

function todaySession(overrides = {}) {
  return {
    session: {
      sessionId: 'att_1',
      trainingGroupId: 'group_a',
      trainingGroupName: '短跑组',
      title: '短跑训练',
      attendanceDate: '2026-10-14',
      locationName: '田径场',
      radiusMeters: 100,
      accuracyThresholdMeters: 100,
      checkInOpenTime: '08:00',
      checkInCloseTime: '09:00',
      lateAfterTime: '08:15',
      phase: 'open'
    },
    status: 'pending',
    leaveStatus: '',
    record: null,
    ...overrides
  };
}

test('phase 4 pages are registered and workbenches expose entries', () => {
  const appConfig = JSON.parse(readProjectFile('miniprogram/app.json'));
  for (const page of [
    'pages/student-attendance/student-attendance',
    'pages/attendance-manage/attendance-manage'
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
    /bindtap="goAttendance"/
  );
  assert.match(
    readProjectFile('miniprogram/pages/coach/coach.wxml'),
    /bindtap="goAttendanceManage"/
  );
  assert.match(
    readProjectFile('miniprogram/pages/admin/admin.wxml'),
    /bindtap="goAttendanceManage"/
  );
});

test('student attendance page loads today, history and leaves', async () => {
  const apiStub = {
    getStudentTodayAttendance: async () => ({
      date: '2026-10-14',
      sessions: [todaySession()]
    }),
    listStudentAttendance: async () => ({
      records: [
        {
          recordId: 'record_1',
          attendanceDate: '2026-10-13',
          status: 'checked_in',
          checkInAt: '2026-10-13T00:00:00.000Z',
          distanceMeters: 12
        }
      ],
      leaves: [],
      summary: { checkedIn: 1, late: 0, leaveApproved: 0, pendingVerification: 0, absent: 0 }
    }),
    listMyLeaves: async () => ({ leaves: [] })
  };
  const { page } = loadPage(STUDENT_PAGE, apiStub, ['student']);
  const instance = createInstance(page);

  instance.onShow();
  await flush();

  assert.equal(instance.data.todaySessions.length, 1);
  assert.equal(instance.data.todaySessions[0].statusLabel, '待签到');
  assert.equal(instance.data.records[0].statusLabel, '已签到');
  assert.equal(instance.data.leaveSessionOptions[0].sessionId, 'att_1');
});

test('student check-in uses wx location and server API', async () => {
  const calls = [];
  const apiStub = {
    getStudentTodayAttendance: async () => ({
      date: '2026-10-14',
      sessions: [todaySession()]
    }),
    listStudentAttendance: async () => ({
      records: [],
      leaves: [],
      summary: { checkedIn: 0, late: 0, leaveApproved: 0, pendingVerification: 0, absent: 0 }
    }),
    listMyLeaves: async () => ({ leaves: [] }),
    checkInAttendance: async (payload) => {
      calls.push(payload);
      return { record: { status: 'checked_in' }, duplicate: false };
    }
  };
  const { page } = loadPage(STUDENT_PAGE, apiStub, ['student'], {
    getLocation: (options) =>
      options.success({ latitude: 30, longitude: 120, accuracy: 10 })
  });
  const instance = createInstance(page);
  instance.onShow();
  await flush();

  await instance.checkIn({ currentTarget: { dataset: { sessionId: 'att_1' } } });

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    sessionId: 'att_1',
    latitude: 30,
    longitude: 120,
    accuracy: 10
  });
  assert.match(instance.data.checkInMessage, /已签到/);
});

test('location permission failure gives guidance without calling the API', async () => {
  const calls = [];
  const apiStub = {
    getStudentTodayAttendance: async () => ({ date: '2026-10-14', sessions: [todaySession()] }),
    listStudentAttendance: async () => ({ records: [], leaves: [], summary: {} }),
    listMyLeaves: async () => ({ leaves: [] }),
    checkInAttendance: async (payload) => {
      calls.push(payload);
      return { record: { status: 'checked_in' }, duplicate: false };
    }
  };
  const { page } = loadPage(STUDENT_PAGE, apiStub, ['student']);
  const instance = createInstance(page);
  instance.onShow();
  await flush();

  await instance.checkIn({ currentTarget: { dataset: { sessionId: 'att_1' } } });

  assert.equal(calls.length, 0);
  assert.match(instance.data.error, /定位权限/);
});

test('student submits and cancels leave requests', async () => {
  const calls = [];
  const apiStub = {
    getStudentTodayAttendance: async () => ({ date: '2026-10-14', sessions: [todaySession()] }),
    listStudentAttendance: async () => ({ records: [], leaves: [], summary: {} }),
    listMyLeaves: async () => ({
      leaves: [
        {
          leaveId: 'leave_1',
          attendanceDate: '2026-10-14',
          reason: '事假',
          status: 'pending'
        }
      ]
    }),
    createLeave: async (payload) => {
      calls.push({ type: 'create', payload });
      return { leave: { status: 'pending' }, duplicate: false };
    },
    cancelLeave: async (payload) => {
      calls.push({ type: 'cancel', payload });
      return { leave: { status: 'cancelled' } };
    }
  };
  const { page } = loadPage(STUDENT_PAGE, apiStub, ['student'], {
    showModal: (options) => options.success({ confirm: true })
  });
  const instance = createInstance(page);
  instance.onShow();
  await flush();

  instance.setData({ leaveReason: '身体不适' });
  await instance.submitLeave();
  assert.equal(calls[0].type, 'create');
  assert.equal(calls[0].payload.sessionId, 'att_1');
  assert.equal(calls[0].payload.reason, '身体不适');

  await instance.cancelLeave({ currentTarget: { dataset: { leaveId: 'leave_1' } } });
  assert.equal(calls[1].type, 'cancel');
});

function manageApiStub() {
  return {
    listManageAttendanceSessions: async () => ({ sessions: [todaySession().session] }),
    listPendingLeaves: async () => ({
      leaves: [
        {
          leaveId: 'leave_1',
          studentName: '模拟学生甲',
          trainingGroupName: '短跑组',
          attendanceDate: '2026-10-14',
          reason: '事假',
          status: 'pending'
        }
      ],
      pendingCount: 1
    }),
    listPlanMeta: async () => ({
      groups: [{ id: 'group_a', name: '短跑组' }],
      categories: [],
      statuses: []
    }),
    getAttendanceRoster: async () => ({
      session: todaySession().session,
      roster: [
        {
          studentUserId: 'usr_student_a',
          studentName: '模拟学生甲',
          status: 'pending_verification',
          leaveStatus: '',
          record: { distanceMeters: 110, accuracyMeters: 200 }
        }
      ],
      summary: {
        expected: 1,
        checkedIn: 0,
        late: 0,
        leaveApproved: 0,
        pendingVerification: 1,
        pending: 0,
        absent: 0
      }
    }),
    createAttendanceSession: async (payload) => ({ session: { ...todaySession().session, ...payload } }),
    manualVerifyAttendance: async (payload) => ({ record: payload }),
    reviewLeave: async (payload) => ({ leave: { status: payload.decision === 'approve' ? 'approved' : 'rejected' } })
  };
}

test('coach creates a session and reviews attendance roster', async () => {
  const calls = [];
  const apiStub = manageApiStub();
  const originalCreate = apiStub.createAttendanceSession;
  apiStub.createAttendanceSession = async (payload) => {
    calls.push({ type: 'create', payload });
    return originalCreate(payload);
  };
  const { page } = loadPage(MANAGE_PAGE, apiStub, ['coach']);
  const instance = createInstance(page);
  instance.onShow();
  await flush();

  assert.equal(instance.data.sessions.length, 1);
  assert.equal(instance.data.pendingCount, 1);

  instance.setData({
    'form.locationName': '田径场',
    'form.latitude': '30',
    'form.longitude': '120'
  });
  await instance.createSession();
  assert.equal(calls[0].payload.trainingGroupId, 'group_a');
  assert.equal(calls[0].payload.locationName, '田径场');

  await instance.selectSession({
    currentTarget: { dataset: { sessionId: 'att_1' } }
  });
  assert.equal(instance.data.roster.length, 1);
  assert.equal(instance.data.summary.pendingVerification, 1);
});

test('coach manual verification and leave review call the APIs', async () => {
  const calls = [];
  const apiStub = manageApiStub();
  apiStub.manualVerifyAttendance = async (payload) => {
    calls.push({ type: 'verify', payload });
    return { record: payload };
  };
  apiStub.reviewLeave = async (payload) => {
    calls.push({ type: 'review', payload });
    return { leave: { status: 'approved' } };
  };
  const { page } = loadPage(MANAGE_PAGE, apiStub, ['coach'], {
    showActionSheet: (options) => options.success({ tapIndex: 0 }),
    showModal: (options) => options.success({ confirm: true, content: '已核实' })
  });
  const instance = createInstance(page);
  instance.onShow();
  await flush();
  await instance.selectSession({
    currentTarget: { dataset: { sessionId: 'att_1' } }
  });

  await instance.manualVerify({
    currentTarget: { dataset: { studentUserId: 'usr_student_a' } }
  });
  assert.equal(calls[0].type, 'verify');
  assert.equal(calls[0].payload.status, 'checked_in');
  assert.equal(calls[0].payload.reason, '已核实');

  await instance.reviewLeave({
    currentTarget: { dataset: { leaveId: 'leave_1', decision: 'approve' } }
  });
  assert.equal(calls[1].type, 'review');
  assert.equal(calls[1].payload.decision, 'approve');
});
