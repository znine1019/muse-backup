'use strict';

/**
 * F1-B3｜正式家长端视觉与训练计划交互回归测试
 *
 * 页面级测试真实调用页面方法并断言页面数据/视图状态，不把“存在 bindtap”当作交互完成。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function pageFile(page, extension) {
  return `miniprogram/pages/${page}/${page}.${extension}`;
}

function createInstance(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(update, callback) {
      for (const [key, value] of Object.entries(update || {})) {
        this.data[key] = value;
      }
      if (typeof callback === 'function') {
        callback();
      }
    }
  };
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function') {
      instance[key] = value.bind(instance);
    }
  }
  instance.overviewRequestId = 0;
  return instance;
}

function loadPage(relativePath, options = {}) {
  let definition = null;
  const calls = {
    reLaunch: [],
    navigateTo: [],
    stopPullDownRefresh: 0,
    showToast: [],
    showModal: []
  };
  const session =
    options.session || { user: { id: 'usr_parent', status: 'active', roles: ['parent'] } };
  const api = options.api || {};
  const wx = {
    reLaunch: (payload) => calls.reLaunch.push(payload.url),
    navigateTo: (payload) => calls.navigateTo.push(payload.url),
    stopPullDownRefresh: () => {
      calls.stopPullDownRefresh += 1;
    },
    showToast: (payload) => calls.showToast.push(payload),
    showModal: (payload) => {
      calls.showModal.push(payload);
      if (typeof payload.success === 'function') payload.success({ confirm: false });
    }
  };

  vm.runInNewContext(
    read(relativePath),
    {
      require: (request) => {
        if (request.includes('services/api')) return api;
        if (request.includes('utils/session')) {
          return {
            getSessionDestination: () => ({ url: '/pages/index/index' }),
            sessionHasRole: (value, role) =>
              Boolean(value && value.user && (value.user.roles || []).includes(role))
          };
        }
        if (request.includes('utils/active-role')) {
          return { clearActiveRole: () => {} };
        }
        if (request.includes('utils/performance-format')) {
          return require(path.join(
            PROJECT_ROOT,
            'miniprogram/utils/performance-format.js'
          ));
        }
        throw new Error(`未打桩的依赖：${request}`);
      },
      Page: (value) => {
        definition = value;
      },
      getApp: () => ({
        ensureSession: async () => session,
        clearSession: () => {},
        globalData: { session }
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
      JSON
    },
    { filename: path.join(PROJECT_ROOT, relativePath) }
  );

  assert.ok(definition, `${relativePath} 应注册 Page`);
  return { instance: createInstance(definition), calls };
}

function flush() {
  let chain = Promise.resolve();
  for (let index = 0; index < 6; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return chain;
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

function overviewFor(studentName, plan) {
  return {
    student: { name: studentName },
    plans: plan ? [plan] : [],
    performance: { approvedCount: 0, personalBests: [] },
    attendance: { validAttendance: 0, actualExpected: 0, late: 0, absent: 0, approvedLeave: 0, pendingVerification: 0, rows: [] },
    feedback: { rows: [] },
    competitions: [],
    notices: []
  };
}

const PLAN = {
  planId: 'plan_1',
  title: '第1周速度训练',
  startDate: '2026-10-14',
  endDate: '2026-10-16',
  itemCount: 2,
  items: [
    { name: '30米加速跑', sets: 6, reps: 1, distanceMeters: 30, restSeconds: 120 },
    { name: '深蹲', sets: 4, reps: 6, distanceMeters: null, restSeconds: null }
  ]
};

test('F1-B3 家长计划：点击展开/收起并展示接口实际字段', async () => {
  const api = {
    listParentStudents: async () => ({
      students: [{ studentUserId: 'stu_1', name: '学生甲', primaryEventName: '100米', trainingGroupNames: ['短跑组'] }]
    }),
    getParentStudentOverview: async () => overviewFor('学生甲', PLAN)
  };
  const { instance } = loadPage(pageFile('parent', 'js'), { api });

  instance.onLoad({ section: 'plans' });
  await instance.loadPage();
  await flush();

  assert.equal(instance.data.planItems.length, 1);
  assert.match(instance.data.planItems[0].items[0].requirementText, /6 组/);
  assert.match(instance.data.planItems[0].items[0].requirementText, /1 次/);
  assert.match(instance.data.planItems[0].items[0].requirementText, /30 米/);
  assert.match(instance.data.planItems[0].items[0].requirementText, /恢复 120 秒/);
  assert.equal(instance.data.expandedPlanId, '');
  assert.equal(instance.data.activeSection, 'plans');
  assert.equal(instance.data.scrollIntoView, 'sec-plans');

  instance.togglePlanDetail({ currentTarget: { dataset: { planId: 'plan_1' } } });
  assert.equal(instance.data.expandedPlanId, 'plan_1');
  instance.togglePlanDetail({ currentTarget: { dataset: { planId: 'plan_1' } } });
  assert.equal(instance.data.expandedPlanId, '');
});

test('F1-B3 家长计划：多个计划之间只保留一个展开状态', async () => {
  const secondPlan = { ...PLAN, planId: 'plan_2', title: '第2周技术训练' };
  const api = {
    listParentStudents: async () => ({ students: [{ studentUserId: 'stu_1', name: '学生甲', trainingGroupNames: [] }] }),
    getParentStudentOverview: async () => ({
      ...overviewFor('学生甲', PLAN),
      plans: [PLAN, secondPlan]
    })
  };
  const { instance } = loadPage(pageFile('parent', 'js'), { api });

  await instance.loadPage();
  await flush();
  instance.togglePlanDetail({ currentTarget: { dataset: { planId: 'plan_1' } } });
  assert.equal(instance.data.expandedPlanId, 'plan_1');
  instance.togglePlanDetail({ currentTarget: { dataset: { planId: 'plan_2' } } });
  assert.equal(instance.data.expandedPlanId, 'plan_2');
  instance.togglePlanDetail({ currentTarget: { dataset: { planId: 'plan_2' } } });
  assert.equal(instance.data.expandedPlanId, '');
});

test('F1-B3 家长计划：超过接口明细上限时明确提示非完整详情', async () => {
  const truncated = { ...PLAN, itemCount: 10, items: PLAN.items };
  const api = {
    listParentStudents: async () => ({ students: [{ studentUserId: 'stu_1', name: '学生甲', trainingGroupNames: [] }] }),
    getParentStudentOverview: async () => overviewFor('学生甲', truncated)
  };
  const { instance } = loadPage(pageFile('parent', 'js'), { api });

  await instance.loadPage();
  await flush();

  assert.equal(instance.data.planItems[0].items.length, 2);
  assert.equal(instance.data.planItems[0].itemCount, 10);
  assert.equal(instance.data.planItems[0].hasTruncatedItems, true);

  const wxml = read(pageFile('parent', 'wxml'));
  assert.match(wxml, /当前仅展示前 \{\{item\.items\.length\}\} 项，共 \{\{item\.itemCount\}\} 项；这不是完整详情/);
  assert.ok(!wxml.includes('完整详情如下'));
});

test('F1-B3 家长计划：切换学生立即清空展开状态和旧数据', async () => {
  const api = {
    listParentStudents: async () => ({ students: [] }),
    getParentStudentOverview: async () => overviewFor('学生乙', { ...PLAN, planId: 'plan_2', title: '第2周技术训练' })
  };
  const { instance } = loadPage(pageFile('parent', 'js'), { api });
  instance.setData({
    students: [
      { studentUserId: 'stu_1', name: '学生甲' },
      { studentUserId: 'stu_2', name: '学生乙' }
    ],
    planItems: [{ planId: 'plan_1', items: [{ name: '旧计划' }] }],
    expandedPlanId: 'plan_1'
  });

  instance.onStudentChange({ detail: { value: '1' } });

  assert.equal(instance.data.studentIndex, 1);
  assert.equal(instance.data.expandedPlanId, '');
  assert.equal(instance.data.planItems.length, 0);
  await flush();
  assert.equal(instance.data.planItems[0].planId, 'plan_2');
});

test('F1-B3 家长计划：旧学生异步响应不得覆盖当前学生', async () => {
  const first = deferred();
  const second = deferred();
  const api = {
    getParentStudentOverview: ({ studentUserId }) =>
      studentUserId === 'stu_1' ? first.promise : second.promise
  };
  const { instance } = loadPage(pageFile('parent', 'js'), { api });

  const firstRequest = instance.loadOverview('stu_1');
  const secondRequest = instance.loadOverview('stu_2');

  first.resolve(overviewFor('学生甲', PLAN));
  await firstRequest;
  assert.equal(instance.data.planItems.length, 0, '旧学生响应不得回填');

  second.resolve(overviewFor('学生乙', { ...PLAN, planId: 'plan_2', title: '第2周技术训练' }));
  await secondRequest;
  assert.equal(instance.data.planItems[0].planId, 'plan_2');
  assert.equal(instance.data.overview.student.name, '学生乙');
});

test('F1-B3 家长授权：接口拒绝时页面不保留任何计划数据', async () => {
  const api = {
    getParentStudentOverview: async () => {
      const error = new Error('尚未获得该学生的授权。');
      error.code = 'OUT_OF_SCOPE';
      throw error;
    }
  };
  const { instance } = loadPage(pageFile('parent', 'js'), { api });
  instance.setData({
    planItems: [{ planId: 'plan_untrusted' }],
    expandedPlanId: 'plan_untrusted'
  });

  await instance.loadOverview('stu_untrusted');
  assert.equal(instance.data.loading, false);
  assert.match(instance.data.error, /授权/);
  assert.equal(instance.data.expandedPlanId, '');
  assert.equal(instance.data.planItems.length, 0);
  assert.equal(instance.data.overview, null);
});

test('F1-B3 家长计划：只读渲染，不出现修改、发布或删除操作', () => {
  const wxml = read(pageFile('parent', 'wxml'));
  const js = read(pageFile('parent', 'js'));

  assert.match(wxml, /bindtap="togglePlanDetail"/);
  assert.ok(!/发布计划|修改计划|删除计划/.test(wxml));
  assert.ok(!/createPlan|updatePlan|publishPlan|archivePlan/.test(js));
  assert.ok(!wxml.includes('class="jg-btn '), '家长只读页不得出现实底操作按钮');
});

test('F1-B3 家长注册：视觉字段迁移后表单绑定与提交数据保持', async () => {
  let submitted = null;
  const api = {
    getParentProfile: async () => ({ profile: null }),
    submitParentProfile: async (payload) => {
      submitted = payload;
      return { status: 'pending_review' };
    }
  };
  const { instance } = loadPage(pageFile('parent-register', 'js'), {
    api,
    session: { user: { id: 'usr_new', status: 'pending_profile', roles: [] } }
  });

  await instance.loadPage();
  await flush();
  instance.onNameInput({ detail: { value: '家长甲' } });
  instance.onRelationChange({ detail: { value: '1' } });
  instance.onNoteInput({ detail: { value: '需核验监护关系' } });
  await instance.submit();

  assert.equal(submitted.name, '家长甲');
  assert.equal(submitted.relation, 'mother');
  assert.equal(submitted.note, '需核验监护关系');

  const wxml = read(pageFile('parent-register', 'wxml'));
  assert.match(wxml, /class="jg-card"/);
  assert.match(wxml, /class="jg-field-row"/);
  assert.match(wxml, /class="jg-field-label"/);
  assert.match(wxml, /class="jg-input"/);
  assert.ok(!wxml.includes('class="field"'));
  assert.ok(!wxml.includes('class="input"'));
});

test('F1-B3 家长关联：输入框迁移后提交关联申请仍正常', async () => {
  let redeemed = null;
  const api = {
    listMyParentLinks: async () => ({
      parentProfile: { name: '家长甲' },
      asParent: [{ linkId: 'link_1', studentName: '学生甲', status: 'pending_review' }]
    }),
    redeemParentInvite: async (payload) => {
      redeemed = payload;
      return {};
    }
  };
  const { instance } = loadPage(pageFile('parent-bind', 'js'), { api });

  await instance.loadPage();
  await flush();
  assert.equal(instance.data.links[0].statusLabel, '等待俱乐部核验');
  instance.onCodeInput({ detail: { value: 'K7MPQ2XR9T' } });
  await instance.redeem();

  assert.equal(redeemed.code, 'K7MPQ2XR9T');
  const wxml = read(pageFile('parent-bind', 'wxml'));
  assert.match(wxml, /<input class="jg-input"/);
  assert.ok(!wxml.includes('class="input"'));
});

test('F1-B3 学生训练计划原有展开交互保持不变', () => {
  const js = read(pageFile('student-plans', 'js'));
  const wxml = read(pageFile('student-plans', 'wxml'));

  assert.match(js, /expandedPlanId/);
  assert.match(js, /toggleDetail\(event\)/);
  assert.match(wxml, /bindtap="toggleDetail"/);
  assert.match(wxml, /wx:if="\{\{expandedPlanId === item\.planId\}\}"/);
});
