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
    showModal: (options) => options.success({ confirm: false }),
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

const NOTICE = {
  noticeId: 'notice_1',
  title: '本周训练安排',
  content: '周三训练调整到室内。',
  category: 'training',
  priority: 'important',
  trainingGroupIds: ['group_a'],
  trainingGroupNames: ['短跑组'],
  status: 'published',
  publishedAt: '2026-10-13T08:00:00.000Z',
  version: 2,
  isRead: false
};

const FEEDBACK = {
  feedbackId: 'feedback_1',
  studentUserId: 'student_1',
  studentName: '模拟学生',
  trainingGroupId: 'group_a',
  sessionId: 'session_1',
  attendanceDate: '2026-10-13',
  completionStatus: 'partial',
  rpe: 7,
  comment: '后半段有点困难',
  coachComment: '',
  coachCommentVersion: 0,
  version: 1,
  needsAttention: true
};

test('phase 5 pages are registered and workbenches expose entries', () => {
  const appConfig = JSON.parse(readProjectFile('miniprogram/app.json'));
  for (const page of [
    'pages/student-competitions/student-competitions',
    'pages/competition-manage/competition-manage',
    'pages/student-notices/student-notices',
    'pages/notice-manage/notice-manage',
    'pages/student-feedback/student-feedback',
    'pages/feedback-manage/feedback-manage'
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
    /bindtap="goCompetitions"/
  );
  assert.match(
    readProjectFile('miniprogram/pages/student/student.wxml'),
    /bindtap="goNotices"/
  );
  assert.match(
    readProjectFile('miniprogram/pages/student/student.wxml'),
    /bindtap="goFeedback"/
  );
  assert.match(
    readProjectFile('miniprogram/pages/coach/coach.wxml'),
    /bindtap="goCompetitionManage"/
  );
  assert.match(
    readProjectFile('miniprogram/pages/admin/admin.wxml'),
    /bindtap="goFeedbackManage"/
  );
});

test('student notice page loads, filters, opens detail and marks read', async () => {
  const calls = [];
  const apiStub = {
    listStudentNotices: async (payload) => {
      calls.push({ type: 'list', payload });
      return {
        notices: [{ ...NOTICE, isRead: false }],
        unreadCount: 1
      };
    },
    getStudentNotice: async (noticeId) => {
      calls.push({ type: 'detail', noticeId });
      return { notice: NOTICE };
    },
    markNoticeRead: async (noticeId) => {
      calls.push({ type: 'read', noticeId });
      return { duplicate: false };
    }
  };
  const { page } = loadPage(
    'miniprogram/pages/student-notices/student-notices.js',
    apiStub,
    ['student']
  );
  const instance = createInstance(page);
  instance.onShow();
  await flush();

  assert.equal(instance.data.notices.length, 1);
  assert.equal(instance.data.unreadCount, 1);
  instance.onCategoryChange({ detail: { value: 1 } });
  await flush();
  assert.equal(calls[1].payload.category, 'training');

  await instance.toggleNotice({
    currentTarget: { dataset: { noticeId: 'notice_1' } }
  });
  assert.equal(instance.data.detail.title, '本周训练安排');
  await instance.markRead({
    currentTarget: { dataset: { noticeId: 'notice_1' } }
  });
  assert.equal(instance.data.notices[0].isRead, true);
  assert.equal(instance.data.unreadCount, 0);
  assert.equal(calls.some((call) => call.type === 'read'), true);
});

test('notice manage creates a draft and publishes it with version lock', async () => {
  const calls = [];
  const apiStub = {
    listManageNotices: async () => ({
      notices: [{ ...NOTICE, status: 'draft', publishedAt: null }]
    }),
    listPlanMeta: async () => ({
      groups: [{ id: 'group_a', name: '短跑组', seasonLabel: '2026' }]
    }),
    createNotice: async (payload) => {
      calls.push({ type: 'create', payload });
      return { notice: { noticeId: 'notice_new', status: 'draft' } };
    },
    publishNotice: async (payload) => {
      calls.push({ type: 'publish', payload });
      return { notice: { noticeId: payload.noticeId, status: 'published' } };
    }
  };
  const { page } = loadPage(
    'miniprogram/pages/notice-manage/notice-manage.js',
    apiStub,
    ['coach'],
    { showModal: (options) => options.success({ confirm: true }) }
  );
  const instance = createInstance(page);
  instance.onShow();
  await flush();

  instance.setData({
    'form.title': '更新通知',
    'form.content': '请准时参加。',
    'form.selectedGroupIds': ['group_a']
  });
  await instance.createNotice();
  const createCall = calls.find((call) => call.type === 'create');
  assert.equal(createCall.payload.category, 'training');
  assert.deepEqual(createCall.payload.trainingGroupIds, ['group_a']);

  await instance.transition({
    currentTarget: {
      dataset: { noticeId: 'notice_1', version: 2, action: 'publish' }
    }
  });
  const publishCall = calls.find((call) => call.type === 'publish');
  assert.deepEqual(JSON.parse(JSON.stringify(publishCall.payload)), {
    noticeId: 'notice_1',
    expectedVersion: 2
  });
});

test('student feedback page submits and updates feedback with version protection', async () => {
  const calls = [];
  const apiStub = {
    listEligibleFeedbackSessions: async () => ({
      sessions: [
        {
          session: {
            sessionId: 'session_1',
            title: '速度训练',
            trainingGroupName: '短跑组',
            attendanceDate: '2026-10-13'
          },
          attendanceStatus: 'checked_in',
          feedback: null
        }
      ]
    }),
    listMyFeedback: async () => ({
      feedback: [FEEDBACK]
    }),
    submitFeedback: async (payload) => {
      calls.push({ type: 'submit', payload });
      return { feedback: FEEDBACK };
    },
    updateFeedback: async (payload) => {
      calls.push({ type: 'update', payload });
      return { feedback: { ...FEEDBACK, version: 2 } };
    }
  };
  const { page } = loadPage(
    'miniprogram/pages/student-feedback/student-feedback.js',
    apiStub,
    ['student']
  );
  const instance = createInstance(page);
  instance.onShow();
  await flush();

  instance.startFeedback({
    currentTarget: { dataset: { sessionId: 'session_1' } }
  });
  instance.onCompletionChange({ detail: { value: 1 } });
  instance.onRpeChange({ detail: { value: 8 } });
  instance.onCommentInput({ detail: { value: '完成大部分训练' } });
  await instance.submitFeedback();
  assert.equal(calls[0].type, 'submit');
  assert.equal(calls[0].payload.sessionId, 'session_1');
  assert.equal(calls[0].payload.completionStatus, 'partial');
  assert.equal(calls[0].payload.rpe, 8);

  instance.editFeedback({
    currentTarget: { dataset: { feedbackId: 'feedback_1' } }
  });
  instance.onCommentInput({ detail: { value: '已调整说明' } });
  await instance.submitFeedback();
  assert.equal(calls[1].type, 'update');
  assert.equal(calls[1].payload.feedbackId, 'feedback_1');
  assert.equal(calls[1].payload.expectedVersion, 1);
});

test('feedback manage filters attention and saves a coach comment', async () => {
  const calls = [];
  const apiStub = {
    listManagedFeedback: async (payload) => {
      calls.push({ type: 'list', payload });
      return { feedback: [FEEDBACK], attentionCount: 1 };
    },
    reviewFeedback: async (payload) => {
      calls.push({ type: 'review', payload });
      return { feedback: { ...FEEDBACK, coachComment: payload.comment } };
    }
  };
  const { page } = loadPage(
    'miniprogram/pages/feedback-manage/feedback-manage.js',
    apiStub,
    ['coach'],
    { showModal: (options) => options.success({ confirm: true, content: '降低强度' }) }
  );
  const instance = createInstance(page);
  instance.onShow();
  await flush();

  instance.onAttentionToggle({ detail: { value: true } });
  await flush();
  assert.equal(calls[1].payload.needsAttention, true);

  await instance.review({
    currentTarget: { dataset: { feedbackId: 'feedback_1', version: 0 } }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2].payload)), {
    feedbackId: 'feedback_1',
    expectedCoachCommentVersion: 0,
    comment: '降低强度'
  });
});

test('student competition page submits multiple project choices and cancels intent', async () => {
  const calls = [];
  const apiStub = {
    listStudentCompetitions: async () => ({
      competitions: [{
        competitionId: 'comp_1',
        title: '校际邀请赛',
        location: '田径场',
        eventDate: '2026-11-01',
        registrationStartAt: '2026-10-01 00:00',
        registrationEndAt: '2026-10-20 23:59',
        phase: 'open',
        capacityEnabled: false,
        events: [
          { eventCode: '100m', eventName: '100米', categories: ['甲组'] },
          { eventCode: 'long_jump', eventName: '跳远', categories: ['甲组'] }
        ]
      }]
    }),
    listMyCompetitionIntents: async () => ({
      registrations: [{
        registrationId: 'reg_1',
        competitionTitle: '校际邀请赛',
        status: 'submitted',
        items: [{ eventName: '100米', category: '甲组' }]
      }]
    }),
    submitCompetitionIntent: async (payload) => {
      calls.push({ type: 'submit', payload });
      return { registration: { registrationId: 'reg_1' }, duplicate: false };
    },
    cancelCompetitionIntent: async (payload) => {
      calls.push({ type: 'cancel', payload });
      return { registration: { registrationId: 'reg_1', status: 'cancelled' } };
    }
  };
  const { page } = loadPage(
    'miniprogram/pages/student-competitions/student-competitions.js',
    apiStub,
    ['student'],
    { showModal: (options) => options.success({ confirm: true }) }
  );
  const instance = createInstance(page);
  instance.onShow();
  await flush();
  instance.toggleIntentForm({ currentTarget: { dataset: { competitionId: 'comp_1' } } });
  instance.onItemChange({ detail: { value: ['100m|甲组', 'long_jump|甲组'] } });
  await instance.submitIntent();
  assert.equal(calls[0].type, 'submit');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload.items)), [
    { eventCode: '100m', category: '甲组' },
    { eventCode: 'long_jump', category: '甲组' }
  ]);
  await instance.cancelIntent({ currentTarget: { dataset: { registrationId: 'reg_1' } } });
  assert.equal(calls[1].type, 'cancel');
});

test('competition manage exports a real xlsx payload and keeps status actions versioned', async () => {
  const calls = [];
  let writtenBase64 = '';
  const apiStub = {
    listCompetitionMeta: async () => ({
      groups: [{ id: 'group_a', name: '短跑组' }],
      events: [{ code: '100m', name: '100米' }]
    }),
    listManageCompetitions: async () => ({
      competitions: [
        {
          competitionId: 'comp_1',
          title: '校际邀请赛',
          location: '田径场',
          eventDate: '2026-11-01',
          registrationStartAt: '2026-10-01 00:00',
          registrationEndAt: '2026-10-20 23:59',
          phase: 'open',
          status: 'published',
          version: 2,
          capacityEnabled: false,
          trainingGroupIds: ['group_a'],
          events: [{ eventCode: '100m', eventName: '100米' }]
        }
      ]
    }),
    listManagedRegistrations: async () => ({
      registrations: [
        {
          registrationId: 'reg_1',
          studentName: '模拟学生',
          status: 'submitted',
          items: [{ eventName: '100米', category: '甲组' }],
          trainingGroupNames: ['短跑组'],
          version: 1
        }
      ]
    }),
    exportRegistrationRows: async () => ({
      rows: [
        {
          competitionTitle: '校际邀请赛',
          studentName: '模拟学生',
          trainingGroups: '短跑组',
          eventName: '100米',
          category: '甲组',
          status: 'submitted',
          reviewNote: '',
          contactNote: ''
        }
      ]
    }),
    closeCompetition: async (payload) => {
      calls.push({ type: 'close', payload });
      return { competition: { competitionId: 'comp_1', status: 'closed' } };
    }
  };
  const { page } = loadPage(
    'miniprogram/pages/competition-manage/competition-manage.js',
    apiStub,
    ['coach'],
    {
      showModal: (options) => options.success({ confirm: true }),
      getFileSystemManager: () => ({
        writeFile: (options) => {
          writtenBase64 = options.data;
          options.success();
        }
      })
    }
  );
  const instance = createInstance(page);
  instance.onShow();
  await flush();
  assert.equal(instance.data.competitions.length, 1);

  await instance.loadRegistrations({
    currentTarget: { dataset: { competitionId: 'comp_1' } }
  });
  assert.equal(instance.data.registrations.length, 1);

  await instance.exportRegistrations({
    currentTarget: { dataset: { competitionId: 'comp_1' } }
  });
  assert.match(writtenBase64, /^UEsDB/);

  await instance.transition({
    currentTarget: {
      dataset: { competitionId: 'comp_1', version: 2, action: 'close' }
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload)), {
    competitionId: 'comp_1',
    expectedVersion: 2
  });
});
