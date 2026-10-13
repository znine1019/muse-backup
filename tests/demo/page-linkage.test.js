'use strict';

/**
 * D1-B 补充｜三角色页面级联动回归测试
 *
 * 与 linkage.test.js（数据源层）不同，这里验证的是**页面实际渲染使用的数据**：
 * 会真实加载 pages/demo/demo.js，按角色执行 onLoad，再断言 instance.data.*
 * （即 WXML 直接绑定的那些字段）。
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

const DEMO_PAGE = path.join(PROJECT_ROOT, 'miniprogram/pages/demo/demo.js');
const SHOWCASE = require(path.join(PROJECT_ROOT, 'miniprogram/demo/showcase.js'));
const STORE = require(path.join(PROJECT_ROOT, 'miniprogram/demo/showcase-store.js'));
const STUDENT_DEMO = require(path.join(PROJECT_ROOT, 'miniprogram/demo/student-demo.js'));
const PARENT_DEMO = require(path.join(PROJECT_ROOT, 'miniprogram/demo/parent-demo.js'));
const COACH_DEMO = require(path.join(PROJECT_ROOT, 'miniprogram/demo/coach-demo.js'));
const DEMO_GUARD = require(path.join(PROJECT_ROOT, 'miniprogram/demo/demo-guard.js'));
const SESSION_UTILS = require(path.join(PROJECT_ROOT, 'miniprogram/utils/session.js'));

function loadDemoPage(role, options = {}) {
  const source = fs.readFileSync(DEMO_PAGE, 'utf8');
  let page = null;
  const cloudCalls = { init: 0, callFunction: [] };

  const wx = {
    navigateTo: () => {},
    navigateBack: () => {},
    reLaunch: () => {},
    showToast: () => {},
    getCurrentPages: () => [{}],
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: (key) => (key === SHOWCASE.DEMO_SESSION_STORAGE_KEY ? role : ''),
    setStorageSync: () => {},
    removeStorageSync: () => {},
    cloud: {
      init: () => {
        cloudCalls.init += 1;
      },
      callFunction: (opts) => {
        cloudCalls.callFunction.push(opts);
        return Promise.resolve({ result: { ok: true, data: {} } });
      }
    },
    ...(options.wxOverrides || {})
  };

  vm.runInNewContext(
    source,
    {
      require: (request) => {
        if (request.includes('demo/demo-guard')) return DEMO_GUARD;
        if (request.includes('demo/student-demo')) return STUDENT_DEMO;
        if (request.includes('demo/parent-demo')) return PARENT_DEMO;
        if (request.includes('demo/coach-demo')) return COACH_DEMO;
        if (request.includes('demo/showcase-store')) return STORE;
        if (request.includes('demo/showcase')) {
          return { ...SHOWCASE, clearActiveDemoRole: () => {} };
        }
        if (request.includes('utils/session')) return SESSION_UTILS;
        throw new Error(`未打桩的依赖：${request}`);
      },
      Page: (value) => {
        page = value;
      },
      getApp: () => ({
        ensureSession: async () => SHOWCASE.buildDemoSession(role),
        globalData: { session: SHOWCASE.buildDemoSession(role) }
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
      JSON,
      encodeURIComponent
    },
    { filename: DEMO_PAGE }
  );

  assert.ok(page, 'demo 页面应注册 Page');
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update, callback) {
      for (const [key, value] of Object.entries(update)) {
        this.data[key] = value;
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
  return { instance, cloudCalls, wx };
}

async function flush() {
  let chain = Promise.resolve();
  for (let index = 0; index < 6; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return chain;
}

async function render(role, options = {}) {
  const { instance, cloudCalls, wx } = loadDemoPage(role, options);
  /*
   * demo-guard 的 isDemoAllowed() 会在**Node 全局**读取 wx.getAccountInfoSync()，
   * 因此这里必须在调用期间把同一个 wx 桩注入全局作用域。
   */
  const hadWx = Object.prototype.hasOwnProperty.call(global, 'wx');
  const previousWx = global.wx;
  global.wx = wx;
  try {
    await instance.onLoad({ role, ...(options.params || {}) });
    await flush();
  } finally {
    if (hadWx) {
      global.wx = previousWx;
    } else {
      delete global.wx;
    }
  }
  return { instance, cloudCalls };
}

/* ================================================== 1. 训练计划联动 */

test('页面联动｜教练发布计划后学生页面出现该计划', async () => {
  STORE.resetState();

  /* 发布前：学生页面看不到草稿 */
  const before = await render('student');
  const draft = STORE.draftPlans().find((plan) => plan.trainingGroupId === 'group_sprint');
  assert.ok(draft, '应存在专项组草稿');
  const beforeIds = before.instance.data.student.planOverview.items.map((item) => item.title);
  assert.ok(!beforeIds.includes(draft.title), '发布前学生页面不得出现草稿');

  /* 教练发布（使用教练页面同一套模拟操作分发） */
  const coachPage = await render('coach');
  coachPage.instance.runDemoAction('publish-plan', draft.planId);

  /* 重新进入学生页面：应出现新计划 */
  const after = await render('student');
  const titles = after.instance.data.student.planOverview.items.map((item) => item.title);
  assert.ok(titles.includes(draft.title), '发布后学生页面应出现该计划');
  assert.equal(after.instance.data.student.planOverview.publishedCount, titles.length);

  /* 计划模块同样可见，且不含其它草稿 */
  const plansModule = STUDENT_DEMO.buildStudentModule('plans');
  assert.ok(
    plansModule.rows.some((row) => row.t === draft.title),
    '学生计划模块应包含已发布计划'
  );
  for (const row of plansModule.rows) {
    assert.ok(!/草稿/.test(row.t), '学生计划模块不得出现草稿');
  }
});

/* ================================================== 2. 成绩审核联动 */

test('页面联动｜教练通过成绩后学生 PB 与家长成绩同步更新', async () => {
  STORE.resetState();
  const pending = STORE
    .getState()
    .performances.find((item) => item.studentId === 'stu_lin' && item.eventCode === '100m' && item.status === 'pending');
  assert.ok(pending, '王浩樊应有待审核 100 米成绩');

  const before = await render('student');
  const pbBefore = before.instance.data.student.pb.value;

  const coachPage = await render('coach');
  const approve = coachPage.instance.runDemoAction('approve-performance', pending.performanceId);
  assert.equal(approve.ok, true);

  /* 学生页面：PB 更新，成绩模块显示"已通过" */
  const after = await render('student');
  assert.notEqual(after.instance.data.student.pb.value, pbBefore, '通过后学生页面 PB 应更新');
  assert.equal(after.instance.data.student.pb.value, String(pending.value));

  const performanceModule = STUDENT_DEMO.buildStudentModule('performance');
  assert.ok(
    performanceModule.rows.some((row) => row.chip === '已通过' && row.v.indexOf(String(pending.value)) >= 0),
    '学生成绩模块应显示该成绩为已通过'
  );

  /* 模拟排行榜同步更新 */
  const leaderboard = STUDENT_DEMO.buildStudentModule('leaderboard');
  assert.ok(
    leaderboard.rows.some((row) => row.v.indexOf(String(pending.value)) >= 0),
    '排行榜应包含新通过的成绩'
  );

  /* 家长页面：已授权学生的成绩同步更新 */
  const parent = await render('parent');
  assert.ok(
    parent.instance.data.parent.performanceRows.some((row) => row.value === pending.value),
    '家长页面应显示更新后的成绩'
  );
});

test('页面联动｜教练驳回成绩后学生 PB 不变', async () => {
  STORE.resetState();
  const pending = STORE
    .getState()
    .performances.find((item) => item.studentId === 'stu_su' && item.eventCode === 'long_jump' && item.status === 'pending');

  const coachPage = await render('coach');
  const before = STORE.personalBests('stu_su').find((item) => item.eventCode === 'long_jump');
  const result = coachPage.instance.runDemoAction('reject-performance', pending.performanceId);
  assert.equal(result.ok, true);

  const after = STORE.personalBests('stu_su').find((item) => item.eventCode === 'long_jump');
  assert.equal(after.value, before.value, '驳回后 PB 不得变化');
});

/* ================================================== 3. 请假审批联动 */

test('页面联动｜教练批准请假后学生与家长页面显示对应状态', async () => {
  STORE.resetState();
  const leave = STORE.coachTodos('coach_lin').leaves.find((item) => item.studentId === 'stu_lin');
  assert.ok(leave, '王浩樊应有待批请假');

  const coachPage = await render('coach');
  const result = coachPage.instance.runDemoAction('approve-leave', leave.leaveId);
  assert.equal(result.ok, true);

  /* 学生页面：考勤模块显示"已批准请假" */
  const studentModule = STUDENT_DEMO.buildStudentModule('attendance');
  const studentRows = studentModule.rows.concat(studentModule.extraRows || []);
  assert.ok(
    studentRows.some((row) => row.chip === '已批准请假'),
    '学生考勤模块应显示已批准请假'
  );

  /* 家长页面：只显示考勤状态，不含请假原因 */
  const parent = await render('parent');
  const attendanceModule = PARENT_DEMO.buildParentModule('attendance', 0);
  assert.ok(
    attendanceModule.rows.some((row) => row.chip === '已批准请假'),
    '家长考勤应显示已批准请假'
  );
  for (const row of attendanceModule.rows) {
    assert.ok(!/原因/.test(row.m), '家长端不得展示请假原因');
  }
  const parentJson = JSON.stringify(parent.instance.data.parent);
  assert.ok(!parentJson.includes(leave.reason), '家长页面数据不得包含请假原因原文');
});

/* ================================================== 4. 通知联动 */

test('页面联动｜教练发布通知后学生页面显示该通知', async () => {
  STORE.resetState();

  const before = await render('student');
  const beforeCount = before.instance.data.student.notices.length;

  const coachPage = await render('coach');
  const result = coachPage.instance.runDemoAction('publish-notice', '');
  assert.equal(result.ok, true);

  const after = await render('student');
  assert.equal(after.instance.data.student.notices.length, beforeCount + 1, '学生页面应多出一条通知');

  const noticesModule = STUDENT_DEMO.buildStudentModule('notices');
  assert.ok(
    noticesModule.rows.some((row) => row.t === '演示：训练时间调整' && row.detailType === 'notice'),
    '学生通知模块应出现新通知且可打开详情'
  );
});

/* ============================================ 5. 家长详情授权校验（页面级） */

test('页面联动｜家长以未授权详情 ID 直接打开会被拒绝', async () => {
  STORE.resetState();

  /* notice_3 仅面向 group_four（乔格送髋王），其家长关联仍为待核验 → 未授权 */
  const page = await render('parent', { params: { detail: 'notice', id: 'notice_3' } });
  assert.ok(page.instance.data.restrictedDetail, '应进入"无权查看"状态');
  assert.match(page.instance.data.restrictedDetail.message, /授权/);
  assert.equal(page.instance.data.detail, null, '不得渲染任何详情数据');

  /* 对照组：已授权范围内的通知可正常打开 */
  const allowed = await render('parent', { params: { detail: 'notice', id: 'notice_1' } });
  assert.equal(allowed.instance.data.restrictedDetail, null);
  assert.ok(allowed.instance.data.detail, '已授权通知应正常渲染');
});

test('页面联动｜切换学生后使用旧详情 ID 仍受授权约束', async () => {
  STORE.resetState();

  /* 先以已授权学生打开通知详情（正常） */
  const allowed = await render('parent', { params: { detail: 'notice', id: 'notice_1' } });
  assert.ok(allowed.instance.data.detail);

  /* 切换到待核验学生后再用同一详情 ID（模拟返回后停留在旧详情）：仍按授权判定 */
  const switched = await render('parent', { params: { student: '1', detail: 'notice', id: 'notice_3' } });
  assert.ok(switched.instance.data.restrictedDetail, '未授权学生的详情应被拒绝');

  /* 家长工作台在待核验学生下同样不返回受保护数据 */
  const workbench = await render('parent', { params: { student: '1' } });
  assert.equal(workbench.instance.data.parent.linkActive, false);
  assert.equal(workbench.instance.data.parent.overview, null);
});

/* ================================================= 6. 云端零调用 */

test('页面联动｜三角色页面渲染与模拟操作全程零云端调用', async () => {
  STORE.resetState();

  const student = await render('student');
  const coach = await render('coach');
  const parent = await render('parent');

  /* 再跑一轮模拟操作 */
  const draft = STORE.draftPlans()[0];
  coach.instance.runDemoAction('publish-plan', draft.planId);
  coach.instance.runDemoAction('publish-notice', '');
  student.instance.runDemoAction('submit-feedback', '');
  student.instance.runDemoAction('check-in', '');

  for (const cloudCalls of [student.cloudCalls, coach.cloudCalls, parent.cloudCalls]) {
    assert.equal(cloudCalls.init, 0, '页面不得初始化云开发');
    assert.equal(cloudCalls.callFunction.length, 0, '页面不得调用任何云函数');
  }
});

/* ================================================= 7. 既有功能未破坏 */

test('页面联动｜既有通知详情与家长快捷导航未被破坏', () => {
  const demoWxml = read('miniprogram/pages/demo/demo.wxml');

  /* 通知详情入口与返回 */
  assert.match(demoWxml, /bindtap="openDetail"/, '详情入口应保留');
  assert.match(demoWxml, /bindtap="goBackToList"/, '返回列表应保留');
  /* 家长快捷导航（页内跳转 + 锚点） */
  assert.match(demoWxml, /bindtap="goSection"/, '家长快捷导航应保留');
  assert.match(demoWxml, /id="sec-performance"/, '家长成绩锚点应保留');
  assert.match(demoWxml, /id="sec-attendance"/, '家长考勤锚点应保留');
  assert.match(demoWxml, /id="sec-events"/, '家长赛事锚点应保留');
  /* 通知详情组件/结构仍在父页面渲染 */
  assert.match(demoWxml, /demo-detail-body/, '通知正文容器应保留');
});

/* ============================================ 8. BUG-06 / BUG-07 计划交互 */

test('BUG-06 学生计划：点击列表行打开完整详情，返回后收起', async () => {
  STORE.resetState();
  const navigations = [];

  const list = await render('student', {
    params: { module: 'plans' },
    wxOverrides: { navigateTo: (options) => navigations.push(options.url) }
  });
  const planRow = list.instance.data.module.rows.find((row) => row.detailType === 'plan');
  assert.ok(planRow, '学生计划列表行必须带详情入口');
  list.instance.openDetail({ currentTarget: { dataset: { detail: planRow.detailType, id: planRow.detailId } } });
  assert.equal(
    navigations[0],
    `/pages/demo/demo?role=student&detail=plan&id=${planRow.detailId}`
  );

  const detail = await render('student', {
    params: { detail: 'plan', id: planRow.detailId },
    wxOverrides: { navigateTo: (options) => navigations.push(options.url) }
  });
  assert.equal(detail.instance.data.view, 'detail');
  assert.equal(detail.instance.data.detail.title, planRow.t);
  assert.match(detail.instance.data.detail.metaLine, /王浩樊（虚构）/);
  assert.match(detail.instance.data.detail.metaLine, /2026-06-15 至 2026-06-21/);
  assert.match(detail.instance.data.detail.body, /起跑器调试/);
  const detailText = detail.instance.data.detail.items.join('\n');
  assert.match(detailText, /60米加速跑/);
  assert.match(detailText, /6 组/);
  assert.match(detailText, /1 次/);
  assert.match(detailText, /恢复 3 分钟/);
  assert.deepEqual(detail.instance.data.detail.actions, [], '学生端计划详情不得出现发布或删除操作');
  detail.instance.goBackToList();
  assert.equal(navigations[navigations.length - 1], '/pages/demo/demo?role=student');
  assert.equal(detail.cloudCalls.init, 0);
  assert.equal(detail.cloudCalls.callFunction.length, 0);
});

test('BUG-06 学生计划：未发布草稿不能通过列表或详情 ID 查看', async () => {
  STORE.resetState();
  const module = STUDENT_DEMO.buildStudentModule('plans');
  assert.equal(module.rows.some((row) => row.detailId === 'plan_draft'), false);
  for (const row of module.rows) {
    assert.equal(row.detailType, 'plan');
    assert.ok(STUDENT_DEMO.getStudentPlan(row.detailId), '列表中的计划应可打开详情');
  }

  const direct = await render('student', { params: { detail: 'plan', id: 'plan_draft' } });
  assert.equal(direct.instance.data.detail, null);
  assert.match(direct.instance.data.error, /尚未发布/);
});

test('BUG-07 家长计划：点击已授权学生计划打开完整详情并正常返回', async () => {
  STORE.resetState();
  const navigations = [];

  const list = await render('parent', {
    params: { module: 'plans' },
    wxOverrides: { navigateTo: (options) => navigations.push(options.url) }
  });
  const planRow = list.instance.data.module.rows.find((row) => row.detailType === 'plan');
  assert.ok(planRow, '家长计划列表行必须带详情入口');
  list.instance.openDetail({ currentTarget: { dataset: { detail: planRow.detailType, id: planRow.detailId } } });
  assert.equal(
    navigations[0],
    `/pages/demo/demo?role=parent&detail=plan&id=${planRow.detailId}&student=0`
  );

  const detail = await render('parent', {
    params: { detail: 'plan', id: planRow.detailId },
    wxOverrides: { navigateTo: (options) => navigations.push(options.url) }
  });
  assert.equal(detail.instance.data.view, 'detail');
  assert.equal(detail.instance.data.detail.title, planRow.t);
  assert.match(detail.instance.data.detail.metaLine, /王浩樊（虚构）/);
  assert.match(detail.instance.data.detail.metaLine, /2026-06-15 至 2026-06-21/);
  assert.match(detail.instance.data.detail.body, /起跑器调试/);
  assert.match(detail.instance.data.detail.items.join('\n'), /6 组/);
  assert.deepEqual(detail.instance.data.detail.actions, [], '家长端计划详情必须保持只读');
  detail.instance.goBackToList();
  assert.equal(
    navigations[navigations.length - 1],
    '/pages/demo/demo?role=parent&student=0'
  );
});

test('BUG-07 家长计划：待核验学生与未授权详情 ID 均不能读取', async () => {
  STORE.resetState();
  const pending = await render('parent', { params: { student: '1', module: 'plans' } });
  assert.equal(pending.instance.data.module.restricted, true);
  assert.deepEqual(pending.instance.data.module.rows, []);

  const wrongStudent = await render('parent', {
    params: { student: '0', detail: 'plan', id: 'plan_jump' }
  });
  assert.ok(wrongStudent.instance.data.restrictedDetail);
  assert.equal(wrongStudent.instance.data.detail, null);

  const oldIdAfterSwitch = await render('parent', {
    params: { student: '1', detail: 'plan', id: 'plan_speed' }
  });
  assert.ok(oldIdAfterSwitch.instance.data.restrictedDetail);
  assert.equal(oldIdAfterSwitch.instance.data.detail, null);
});

test('BUG-06/07 计划联动：教练发布后学生与家长均可打开同一份计划详情', async () => {
  STORE.resetState();
  const draft = STORE.draftPlans().find((plan) => plan.planId === 'plan_draft');
  assert.ok(draft);

  const coach = await render('coach');
  assert.equal(coach.instance.runDemoAction('publish-plan', draft.planId).ok, true);

  const student = await render('student', { params: { detail: 'plan', id: draft.planId } });
  const parent = await render('parent', { params: { detail: 'plan', id: draft.planId } });
  assert.equal(student.instance.data.detail.title, draft.title);
  assert.equal(parent.instance.data.detail.title, draft.title);
  assert.equal(student.instance.data.detail.metaLine, parent.instance.data.detail.metaLine);
  assert.deepEqual(student.instance.data.detail.items, parent.instance.data.detail.items);
  assert.match(student.instance.data.detail.metaLine, /2026-06-22 至 2026-06-28/);
  assert.match(student.instance.data.detail.items.join('\n'), /阶梯跑/);
  assert.deepEqual(student.instance.data.detail.actions, []);
  assert.deepEqual(parent.instance.data.detail.actions, []);
  assert.equal(student.cloudCalls.callFunction.length, 0);
  assert.equal(parent.cloudCalls.callFunction.length, 0);
});
