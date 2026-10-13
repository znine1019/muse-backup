'use strict';

/**
 * F1-A2 补充｜开发者专用学生端 / 家长端 DEMO 预览测试
 *
 * 覆盖：
 *   1. 演示守卫：仅 develop/trial + 真实 developer 可进入
 *   2. 非 developer / release 环境被拒绝
 *   3. 演示页不引入 services/api，不存在业务写入路径
 *   4. 演示目录中的每个模块都能构建（入口全部可达）
 *   5. 家长端多学生切换与只读字段白名单
 *   6. 演示页渲染、导航、退出回到开发者工作台
 *   7. 不改变真实账号角色（演示页不写任何存储、不调 assignRole 等）
 *   8. 不影响既有运动数据报告 DEMO
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

const DEMO_PAGE_JS = path.join(PROJECT_ROOT, 'miniprogram/pages/demo/demo.js');
const DEMO_GUARD = require(path.join(PROJECT_ROOT, 'miniprogram/demo/demo-guard.js'));
const STUDENT_DEMO = require(path.join(PROJECT_ROOT, 'miniprogram/demo/student-demo.js'));
const PARENT_DEMO = require(path.join(PROJECT_ROOT, 'miniprogram/demo/parent-demo.js'));

function withWx(stub, fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'wx');
  const previous = global.wx;
  global.wx = stub;
  try {
    return fn();
  } finally {
    if (had) {
      global.wx = previous;
    } else {
      delete global.wx;
    }
  }
}

function wxWithEnv(envVersion, extra = {}) {
  return {
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
    removeStorageSync: () => {},
    ...extra
  };
}

function developerSession() {
  return { sessionVersion: 1, user: { id: 'usr_dev', status: 'active', roles: ['developer'] } };
}

/* ------------------------------------------------------------- 演示守卫 */

test('演示守卫：develop/trial 环境 + 真实 developer 才允许进入', () => {
  for (const envVersion of ['develop', 'trial']) {
    const result = withWx(wxWithEnv(envVersion), () =>
      DEMO_GUARD.checkDemoAccess(developerSession())
    );
    assert.equal(result.ok, true, `${envVersion} 环境应允许 developer 进入`);
  }
});

test('演示守卫：release 环境一律拒绝', () => {
  const result = withWx(wxWithEnv('release'), () =>
    DEMO_GUARD.checkDemoAccess(developerSession())
  );
  assert.equal(result.ok, false, 'release 环境不得进入演示');
  assert.match(result.reason, /环境/);
});

test('演示守卫：非 developer 身份一律拒绝（含 student / coach / parent）', () => {
  for (const role of ['student', 'coach', 'parent']) {
    const session = { user: { id: 'usr_x', status: 'active', roles: [role] } };
    const result = withWx(wxWithEnv('develop'), () => DEMO_GUARD.checkDemoAccess(session));
    assert.equal(result.ok, false, `${role} 不得进入演示`);
    assert.match(result.reason, /开发者/);
  }
});

test('演示守卫：停用账号即使有 developer 角色也被拒绝', () => {
  const session = { user: { id: 'usr_dev', status: 'disabled', roles: ['developer'] } };
  const result = withWx(wxWithEnv('develop'), () => DEMO_GUARD.checkDemoAccess(session));
  assert.equal(result.ok, false, '停用账号不得进入演示');
});

test('演示守卫：未知角色参数不被支持', () => {
  assert.equal(DEMO_GUARD.isSupportedDemoRole('student'), true);
  assert.equal(DEMO_GUARD.isSupportedDemoRole('parent'), true);
  assert.equal(DEMO_GUARD.isSupportedDemoRole('developer'), false);
  assert.equal(DEMO_GUARD.isSupportedDemoRole(''), false);
});

/* --------------------------------------------------------- 演示数据与隔离 */

test('演示数据：学生端目录每一项都能构建（入口全部可达）', () => {
  assert.ok(STUDENT_DEMO.catalog.length >= 12, '学生端演示模块应覆盖主要业务');
  for (const item of STUDENT_DEMO.catalog) {
    const module = STUDENT_DEMO.buildStudentModule(item.id);
    assert.equal(module.id, item.id);
    assert.ok(module.subtitle, `${item.id} 应有副标题`);
    assert.ok(
      Array.isArray(module.rows) || Array.isArray(module.form),
      `${item.id} 应给出列表或表单内容`
    );
  }
  assert.throws(() => STUDENT_DEMO.buildStudentModule('not_exist'), /演示模块不存在/);
});

test('演示数据：家长端目录每一项都能构建，且两种授权状态都可展示', () => {
  assert.ok(PARENT_DEMO.catalog.length >= 6, '家长端演示模块应覆盖主要业务');
  for (const item of PARENT_DEMO.catalog) {
    const module = PARENT_DEMO.buildParentModule(item.id, 0);
    assert.equal(module.id, item.id);
  }
  /* 至少两名虚构学生，且存在“已生效 / 待核验”两种关联状态 */
  assert.ok(PARENT_DEMO.STUDENTS.length >= 2, '家长端至少两名虚构学生');
  const states = PARENT_DEMO.STUDENTS.map((item) => item.linkState);
  assert.ok(states.includes('active') && states.includes('pending_review'), '应覆盖不同授权状态');
});

test('演示数据：家长端只读字段白名单（无 GPS / 请假原因 / 教练内部评价）', () => {
  const source = read('miniprogram/demo/parent-demo.js');
  /* 只检查“字段级”敏感内容，避免把说明性文字（如“不展示精确 GPS 位置”）误判为泄漏 */
  const forbiddenFields = [
    /latitude\s*:/,
    /longitude\s*:/,
    /gps\w*\s*:/i,
    /leaveReason\s*:/,
    /coachComment\s*:/,
    /internalNote\s*:/
  ];
  for (const pattern of forbiddenFields) {
    assert.ok(!pattern.test(source), `家长端演示数据不得包含字段 ${pattern}`);
  }
  /* 面板文案应明确说明不展示位置与原因 */
  assert.match(source, /不展示精确位置|不展示精确 GPS 位置/);
});

test('演示数据：全部为本地虚构数据，不读取真实 CloudBase', () => {
  for (const file of [
    'miniprogram/demo/student-demo.js',
    'miniprogram/demo/parent-demo.js',
    'miniprogram/demo/demo-guard.js'
  ]) {
    const source = read(file);
    assert.ok(!/wx\.cloud/.test(source), `${file} 不得访问 wx.cloud`);
    assert.ok(!/services\/api/.test(source), `${file} 不得引用 services/api`);
  }
});

/* ------------------------------------------------------------- 演示页面 */

function loadDemoPage(options = {}) {
  const {
    envAllowed = true,
    session = developerSession(),
    denyReason = '只有已启用的开发者身份可以进入演示预览。',
    wxOverrides = {},
    /* 页面栈深度：>1 表示从列表页进入详情的常规路径 */
    pageStackDepth = 1,
    /* 模拟 selector 版 pageScrollTo 不被支持（用于验证兼容路径） */
    scrollSelectorFails = false,
    /* 兼容路径下的元素位置与当前页面滚动位置 */
    rectTop = 640,
    viewportScrollTop = 100
  } = options;

  const source = fs.readFileSync(DEMO_PAGE_JS, 'utf8');
  let page = null;
  const calls = {
    navigateTo: [],
    reLaunch: [],
    removeStorageSync: [],
    navigateBack: [],
    pageScrollTo: []
  };

  const wx = {
    navigateTo: (opts) => calls.navigateTo.push(opts.url),
    reLaunch: (opts) => calls.reLaunch.push(opts.url),
    navigateBack: (opts) => calls.navigateBack.push(opts || {}),
    removeStorageSync: (key) => calls.removeStorageSync.push(key),
    pageScrollTo: (opts) => {
      calls.pageScrollTo.push(opts || {});
      if (scrollSelectorFails && opts && typeof opts.fail === 'function') {
        opts.fail({ errMsg: 'pageScrollTo:fail' });
      }
    },
    /* 仅用于验证“selector 不可用”时的兼容路径 */
    createSelectorQuery: () => ({
      select: () => ({
        boundingClientRect: (callback) => ({ exec: () => callback({ top: rectTop, height: 200 }) })
      }),
      selectViewport: () => ({
        scrollOffset: (callback) => ({ exec: () => callback({ scrollTop: viewportScrollTop }) })
      })
    }),
    getStorageSync: () => '',
    setStorageSync: () => {},
    ...wxOverrides
  };

  vm.runInNewContext(
    source,
    {
      require: (request) => {
        if (request.includes('demo/demo-guard')) {
          return {
            DEMO_MARKER: 'DEMO｜虚构演示数据',
            DEMO_NOTICE: '仅用于功能及界面预览，不代表真实学生信息。',
            DEMO_STATE_KEYS: ['demo_preview_state_v1'],
            checkDemoAccess: () => (envAllowed ? { ok: true, reason: '' } : { ok: false, reason: denyReason }),
            clearDemoState: () => {
              wx.removeStorageSync('demo_preview_state_v1');
            },
            isSupportedDemoRole: (role) => role === 'student' || role === 'parent',
            roleLabel: (role) => ({ student: '学生端', parent: '家长端' }[role] || '')
          };
        }
        if (request.includes('demo/student-demo')) {
          return STUDENT_DEMO;
        }
        if (request.includes('demo/parent-demo')) {
          return PARENT_DEMO;
        }
        if (request.includes('utils/session')) {
          return { getSessionDestination: () => ({ url: '/pages/admin/admin' }) };
        }
        throw new Error(`未打桩的依赖：${request}`);
      },
      Page: (value) => {
        page = value;
      },
      getApp: () => ({
        ensureSession: async () => session
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
      encodeURIComponent,
      /* 供“返回列表”分支判断页面栈深度 */
      getCurrentPages: () => new Array(pageStackDepth).fill({})
    },
    { filename: DEMO_PAGE_JS }
  );

  assert.ok(page, 'demo 页面应注册 Page');
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update) {
      for (const [key, value] of Object.entries(update)) {
        this.data[key] = value;
      }
    }
  };
  for (const [key, value] of Object.entries(page)) {
    if (typeof value === 'function') {
      instance[key] = value.bind(instance);
    }
  }
  return { page, instance, wx, calls };
}

async function flush() {
  let chain = Promise.resolve();
  for (let index = 0; index < 6; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return chain;
}

test('演示页：developer 进入学生端后渲染工作台且不调用业务接口', async () => {
  const { instance } = loadDemoPage();
  await instance.onLoad({ role: 'student' });
  await flush();

  assert.equal(instance.data.ready, true);
  assert.equal(instance.data.error, '');
  assert.equal(instance.data.isParent, false);
  assert.ok(instance.data.student, '应构建学生演示数据');
  assert.equal(instance.data.student.todaySessions.length, 2);
  assert.ok(instance.data.student.pb.value);
  assert.ok(instance.data.catalogGroups.length >= 3);

  /* 页面源码中不存在任何业务接口调用 */
  const source = read('miniprogram/pages/demo/demo.js');
  assert.ok(
    !/require\([^)]*services\/api/.test(source),
    '演示页不得 require services/api'
  );
  assert.ok(!/\bapi\.[a-zA-Z]+\(/.test(source), '演示页不得调用 api.*');
});

test('演示页：developer 进入家长端后可切换学生且保持只读', async () => {
  const { instance } = loadDemoPage();
  await instance.onLoad({ role: 'parent' });
  await flush();

  assert.equal(instance.data.ready, true);
  assert.equal(instance.data.isParent, true);
  assert.equal(instance.data.parent.students.length, 2);

  const first = instance.data.parent.currentStudent.name;
  instance.onStudentChange({ detail: { value: '1' } });
  const second = instance.data.parent.currentStudent.name;
  assert.notEqual(first, second, '切换学生后应展示另一名虚构学生');
  assert.equal(instance.data.parent.studentIndex, 1);

  /* 切回第一名学生仍然可用 */
  instance.onStudentChange({ detail: { value: '0' } });
  assert.equal(instance.data.parent.currentStudent.name, first);
});

test('演示页：非 developer / release 环境拒绝进入且不渲染演示数据', async () => {
  const { instance } = loadDemoPage({ envAllowed: false, denyReason: '当前环境不允许进入演示预览（仅开发版与体验版可用）。' });
  await instance.onLoad({ role: 'student' });
  await flush();

  assert.equal(instance.data.ready, false);
  assert.ok(instance.data.error, '应给出拒绝原因');
  assert.equal(instance.data.student, null, '拒绝时不得构建任何演示数据');
});

test('演示页：非法 role 参数被拒绝', async () => {
  const { instance } = loadDemoPage();
  await instance.onLoad({ role: 'developer' });
  await flush();

  assert.equal(instance.data.ready, false);
  assert.equal(instance.data.student, null);
  assert.match(instance.data.error, /演示参数/);
});

test('演示页：模块导航与返回工作台使用同一演示页，不跳转正式业务页面', async () => {
  const { instance, calls } = loadDemoPage();
  await instance.onLoad({ role: 'student' });
  await flush();

  instance.goModule({ currentTarget: { dataset: { module: 'plans' } } });
  assert.deepEqual(calls.navigateTo, ['/pages/demo/demo?role=student&module=plans']);

  instance.goCatalog();
  assert.deepEqual(calls.navigateTo[1], '/pages/demo/demo?role=student&view=catalog');

  /* 家长端导航应带上当前学生下标 */
  const parent = loadDemoPage();
  await parent.instance.onLoad({ role: 'parent' });
  await flush();
  parent.instance.onStudentChange({ detail: { value: '1' } });
  parent.instance.goModule({ currentTarget: { dataset: { module: 'performance' } } });
  assert.deepEqual(parent.calls.navigateTo, ['/pages/demo/demo?role=parent&module=performance&student=1']);

  /* 所有演示导航目标都指向演示页本身，绝不指向正式业务页面 */
  for (const url of [...calls.navigateTo, ...parent.calls.navigateTo]) {
    assert.ok(url.startsWith('/pages/demo/demo'), `演示导航不得跳转正式页面：${url}`);
  }
});

test('演示页：模拟提交只改变本地状态', async () => {
  const { instance } = loadDemoPage();
  await instance.onLoad({ role: 'student', module: 'performance-submit' });
  await flush();

  assert.equal(instance.data.module.form.length, 4);
  assert.equal(instance.data.simulatedSubmit, '');
  instance.simulateSubmit();
  assert.match(instance.data.simulatedSubmit, /本地模拟/);
});

test('演示页：退出预览回到开发者工作台并清理演示状态', async () => {
  const { instance, calls } = loadDemoPage();
  await instance.onLoad({ role: 'parent' });
  await flush();

  instance.goAdmin();
  assert.deepEqual(calls.reLaunch, ['/pages/admin/admin']);
  assert.deepEqual(calls.removeStorageSync, ['demo_preview_state_v1'], '退出时应清理演示状态');

  /* 演示页不得出现任何角色变更调用 */
  const source = read('miniprogram/pages/demo/demo.js');
  for (const forbidden of ['assignRole', 'setUserStatus', 'setGroupCoach', 'reviewRegistration']) {
    assert.ok(!source.includes(forbidden), `演示页不得调用 ${forbidden}`);
  }
});

/* --------------------------------------------------- 开发者工作台入口 */
/* ------------------------------------------- BUG-01 家长授权隔离修正 */

test('家长授权：演示状态取值与正式系统 PARENT_LINK_STATUS 完全一致', () => {
  const server = require(path.join(PROJECT_ROOT, 'cloudfunctions/api/lib/constants.js'));
  assert.deepEqual(
    { ...PARENT_DEMO.PARENT_LINK_STATUS },
    { ...server.PARENT_LINK_STATUS },
    '演示不得自创正式状态名'
  );
});

test('家长授权：仅“已生效”状态允许读取受保护数据', () => {
  /* 已生效：工作台返回完整业务数据 */
  const active = PARENT_DEMO.buildParentWorkbench(0);
  assert.equal(active.linkActive, true);
  assert.ok(active.overview && active.overview.pb.value, '已生效应返回概览');
  assert.ok(active.plans.length > 0, '已生效应返回训练计划');
  assert.ok(active.performanceRows.length > 0, '已生效应返回已审核成绩');
  assert.ok(active.attendanceRows.length > 0, '已生效应返回考勤记录');
  assert.ok(active.feedbackRows.length > 0, '已生效应返回训练反馈');
  assert.ok(active.noticeRows.length > 0, '已生效应返回通知');

  /* 非生效状态：六个受保护集合全部为空，且不返回概览 */
  const status = PARENT_DEMO.PARENT_LINK_STATUS;
  const blocked = [
    status.PENDING_STUDENT,
    status.PENDING_REVIEW,
    status.REJECTED,
    status.REVOKED,
    status.EXPIRED,
    status.OPEN,
    status.USED,
    status.LOCKED
  ];
  for (const linkState of blocked) {
    const view = PARENT_DEMO.buildParentWorkbench(0, { linkState });
    assert.equal(view.linkActive, false, `${linkState} 不应视为生效`);
    assert.equal(view.overview, null, `${linkState} 不得返回概览数据`);
    for (const key of [
      'plans',
      'performanceRows',
      'attendanceRows',
      'feedbackRows',
      'competitionRows',
      'noticeRows'
    ]) {
      assert.deepEqual(view[key], [], `${linkState} 不得返回 ${key}`);
    }
    assert.ok(view.accessNotice, `${linkState} 应给出授权说明`);
  }
});

test('家长授权：待审核学生（默认预置）确实被隔离', () => {
  const pending = PARENT_DEMO.buildParentWorkbench(1);
  assert.equal(pending.linkState, PARENT_DEMO.PARENT_LINK_STATUS.PENDING_REVIEW);
  assert.equal(pending.linkActive, false);
  assert.equal(pending.overview, null);
  assert.deepEqual(pending.plans, []);
  assert.deepEqual(pending.performanceRows, []);
  assert.deepEqual(pending.attendanceRows, []);
  /* 但学生标识与状态必须保留，供家长辨认 */
  assert.ok(pending.currentStudent.name);
  assert.equal(pending.linkStateLabel, '待开发者核验');
});

test('家长授权：受保护模块的详情直达不能绕过隔离', () => {
  const status = PARENT_DEMO.PARENT_LINK_STATUS;
  for (const linkState of [status.PENDING_REVIEW, status.REJECTED, status.REVOKED]) {
    for (const moduleId of PARENT_DEMO.PROTECTED_MODULE_IDS) {
      const module = PARENT_DEMO.buildParentModule(moduleId, 0, { linkState });
      assert.equal(module.restricted, true, `${linkState}/${moduleId} 应被限制`);
      assert.deepEqual(module.rows, [], `${linkState}/${moduleId} 不得返回数据行`);
      assert.equal(module.summary, undefined, `${linkState}/${moduleId} 不得返回数值卡`);
      assert.ok(module.restrictedReason, `${linkState}/${moduleId} 应给出限制原因`);
    }
  }
  /* 授权管理类模块仍可访问（只展示状态） */
  const link = PARENT_DEMO.buildParentModule('link', 1);
  assert.notEqual(link.restricted, true);
  assert.ok(link.rows.length >= 2, '关联管理应展示各学生状态');
});

test('家长授权：切换到待审核学生后不残留上一位学生的数据', async () => {
  const { instance } = loadDemoPage();
  await instance.onLoad({ role: 'parent' });
  await flush();

  /* 第一名为已生效：有数据 */
  const before = instance.data.parent;
  assert.equal(before.linkActive, true);
  const previousPb = before.overview.pb.value;
  assert.ok(previousPb);
  assert.ok(before.performanceRows.length > 0);

  /* 切到待审核学生：上一个学生的数据必须全部消失 */
  instance.onStudentChange({ detail: { value: '1' } });
  const after = instance.data.parent;
  assert.equal(after.linkActive, false);
  assert.equal(after.overview, null, '不得用上一位学生的数据填充');
  assert.deepEqual(after.performanceRows, []);
  assert.deepEqual(after.plans, []);
  assert.deepEqual(after.attendanceRows, []);
  assert.notEqual(after.currentStudent.name, before.currentStudent.name);

  /* 切回已生效学生：数据恢复 */
  instance.onStudentChange({ detail: { value: '0' } });
  const restored = instance.data.parent;
  assert.equal(restored.linkActive, true);
  assert.equal(restored.overview.pb.value, previousPb, '切回后应恢复同一份已授权数据');
});

/* ------------------------------------------- BUG-02 学生计划可见性 */

test('学生计划：演示数据确实包含草稿，但学生可见集合不含草稿', () => {
  const draftCount = STUDENT_DEMO.ALL_PLANS.filter(
    (item) => item.status === STUDENT_DEMO.PLAN_STATUS.DRAFT
  ).length;
  assert.ok(draftCount > 0, '演示数据应包含草稿，用于验证过滤确实生效');

  const visible = STUDENT_DEMO.visibleStudentPlans();
  assert.ok(visible.length > 0, '应存在已发布计划');
  for (const item of visible) {
    assert.equal(item.status, STUDENT_DEMO.PLAN_STATUS.PUBLISHED);
  }
  assert.equal(
    visible.length,
    STUDENT_DEMO.ALL_PLANS.length - draftCount,
    '可见集合应等于全部计划减去草稿'
  );
});

test('学生计划：列表、概览与统计数量一致且均无草稿', () => {
  const workbench = STUDENT_DEMO.buildStudentWorkbench();
  const module = STUDENT_DEMO.buildStudentModule('plans');
  const visible = STUDENT_DEMO.visibleStudentPlans();

  /* 计划列表 */
  assert.equal(module.rows.length, visible.length, '计划列表条数应与可见计划一致');
  assert.equal(module.summary.value, String(visible.length), '计划统计数量应与列表一致');
  for (const item of module.rows) {
    assert.notEqual(item.chip, '草稿', '学生计划列表不得出现草稿');
    assert.ok(!/草稿/.test(item.t) && !/草稿/.test(item.m), '列表内容不得包含草稿条目');
  }

  /* 工作台概览使用同一份过滤结果 */
  assert.equal(workbench.planOverview.publishedCount, visible.length);
  assert.equal(workbench.planOverview.items.length, visible.length);
  for (const item of workbench.planOverview.items) {
    assert.ok(!/草稿/.test(item.title) && !/草稿/.test(item.meta), '工作台概览不得包含草稿');
  }

  /* 全部功能目录中也没有草稿痕迹 */
  const catalogText = JSON.stringify(STUDENT_DEMO.catalog);
  assert.ok(!/草稿/.test(catalogText), '学生端目录不应出现草稿字样');
});

/* ------------------------------------------- 演示时间口径一致性 */

test('演示口径：固定周期不声称“本月”，签到状态不声称“签到中”', () => {
  const studentSource = read('miniprogram/demo/student-demo.js');
  const parentSource = read('miniprogram/demo/parent-demo.js');
  const pageSource = read('miniprogram/pages/demo/demo.wxml');

  for (const source of [studentSource, parentSource, pageSource]) {
    assert.ok(!/本月/.test(source), '固定 6 月数据不得标记为“本月”');
    assert.ok(!/'签到中'/.test(source) && !/>签到中</.test(source), '演示不得声称真实“签到中”');
  }
  assert.ok(/演示周期/.test(parentSource), '周期类文案应使用“演示周期”');
  assert.ok(/模拟签到状态/.test(studentSource), '签到状态应明确标识为模拟');

  /* 工作台实际渲染的数据也必须是模拟标识 */
  const workbench = STUDENT_DEMO.buildStudentWorkbench();
  assert.equal(workbench.todaySessions[0].phaseLabel, '模拟签到状态');
});

/* --------------------------------------------------- 开发者工作台入口 */

test('开发者工作台提供两个 DEMO 入口且受 demoAvailable 控制', () => {
  const js = read('miniprogram/pages/admin/admin.js');
  const wxml = read('miniprogram/pages/admin/admin.wxml');

  assert.ok(js.includes('goDemoStudent('), '应定义 goDemoStudent');
  assert.ok(js.includes('goDemoParent('), '应定义 goDemoParent');
  assert.match(js, /openDemo\('student'\)/);
  assert.match(js, /openDemo\('parent'\)/);
  assert.match(
    js,
    /navigateTo\(\{\s*url:\s*`\/pages\/demo\/demo\?role=\$\{role\}`\s*\}\)/,
    '演示入口应跳转到演示页'
  );

  assert.ok(wxml.includes('bindtap="goDemoStudent"'), '工作台应提供学生端 DEMO 入口');
  assert.ok(wxml.includes('bindtap="goDemoParent"'), '工作台应提供家长端 DEMO 入口');
  assert.ok(wxml.includes('预览学生端（DEMO）'));
  assert.ok(wxml.includes('预览家长端（DEMO）'));

  /* 两个入口都必须由 demoAvailable 控制（release 环境隐藏） */
  const gated = wxml.match(/wx:if="\{\{demoAvailable\}\}"[\s\S]{0,120}?bindtap="goDemo(Student|Parent)"/g) || [];
  assert.equal(gated.length, 2, `两个 DEMO 入口都应受 demoAvailable 控制（实际 ${gated.length}）`);
});

test('演示页已在 app.json 注册', () => {
  const pages = JSON.parse(read('miniprogram/app.json')).pages;
  assert.ok(pages.includes('pages/demo/demo'), 'pages/demo/demo 应已注册');
});

/* ------------------------------------------------- 不破坏既有 DEMO */

test('既有运动数据报告 DEMO 不受影响', () => {
  const adminJs = read('miniprogram/pages/admin/admin.js');
  assert.ok(adminJs.includes('goDemoReport('), '应保留运动数据报告 DEMO 入口');
  assert.match(
    adminJs,
    /navigateTo\(\{\s*url:\s*'\/pages\/student-report\/student-report\?demo=1'\s*\}\)/,
    '运动数据报告 DEMO 跳转应保持不变'
  );
  const reportJs = read('miniprogram/pages/student-report/student-report.js');
  assert.ok(reportJs.includes('buildDemoReport'), '报告 DEMO 数据构建应保留');
  assert.ok(reportJs.includes('isDemoRequest'), '报告 DEMO 参数解析应保留');
  /* 原有 demo 数据模块仍在 */
  assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'miniprogram/demo/sport-report-demo.js')));
});

/* ------------------------------------------- BUG-03 通知详情交互 */

test('学生通知：列表与全部功能入口都能定位到通知详情', () => {
  const workbench = STUDENT_DEMO.buildStudentWorkbench();
  assert.equal(workbench.notices.length, 2);
  for (const notice of workbench.notices) {
    assert.ok(notice.id, '每条通知必须有稳定 id');
    assert.ok(notice.preview, '列表需要摘要文案');
    assert.ok(notice.content, '详情需要完整正文');
    assert.ok(notice.publishedAt, '详情需要发布时间');
    assert.ok(notice.categoryLabel, '详情需要通知类型');
  }

  /* 全部功能 → 俱乐部通知：每一行都能定位到详情 */
  const module = STUDENT_DEMO.buildStudentModule('notices');
  assert.equal(module.rows.length, workbench.notices.length);
  for (const row of module.rows) {
    assert.equal(row.detailType, 'notice');
    assert.ok(row.detailId, '通知行必须带详情 id');
    assert.ok(STUDENT_DEMO.getStudentNotice(row.detailId), '行指向的通知必须存在');
  }
});

test('学生通知：工作台点击通知打开对应详情页', async () => {
  const list = loadDemoPage({ pageStackDepth: 2 });
  await list.instance.onLoad({ role: 'student' });
  await flush();

  const notices = list.instance.data.student.notices;
  list.instance.openDetail({ currentTarget: { dataset: { detail: 'notice', id: notices[0].id } } });
  assert.deepEqual(list.calls.navigateTo, [
    `/pages/demo/demo?role=student&detail=notice&id=${notices[0].id}`
  ]);

  const detail = loadDemoPage({ pageStackDepth: 2 });
  await detail.instance.onLoad({ role: 'student', detail: 'notice', id: notices[0].id });
  await flush();

  assert.equal(detail.instance.data.view, 'detail');
  assert.equal(detail.instance.data.detail.title, notices[0].title);
  assert.equal(detail.instance.data.detail.body, notices[0].content);
  assert.ok(detail.instance.data.detail.metaLine.includes(notices[0].publishedAt));
  assert.ok(detail.instance.data.detail.metaLine.includes(notices[0].categoryLabel));
});

test('学生通知：不同通知打开后内容正确匹配、互不混淆', async () => {
  const all = STUDENT_DEMO.NOTICES;
  assert.equal(all.length, 2);
  assert.notEqual(all[0].content, all[1].content, '两条通知正文应不同');

  for (const notice of all) {
    const { instance } = loadDemoPage({ pageStackDepth: 2 });
    await instance.onLoad({ role: 'student', detail: 'notice', id: notice.id });
    await flush();
    assert.equal(instance.data.detail.title, notice.title);
    assert.equal(instance.data.detail.body, notice.content);
    assert.equal(instance.data.pageTitle, notice.title);
  }
});

test('学生通知：重要/未读状态与演示数据一致，标记已读只改本地', async () => {
  const { instance } = loadDemoPage({ pageStackDepth: 2 });
  await instance.onLoad({ role: 'student', detail: 'notice', id: 'demo_notice_1' });
  await flush();

  assert.equal(instance.data.detail.chip, '重要通知');
  assert.equal(instance.data.localRead, false, '演示数据为未读');
  instance.simulateMarkRead();
  assert.equal(instance.data.localRead, true, '标记已读只改本地状态');

  const source = read('miniprogram/pages/demo/demo.js');
  assert.ok(!/markNoticeRead/.test(source), '演示页不得调用正式已读接口');
});

test('学生通知：不存在的通知 id 不返回任何详情数据', async () => {
  const { instance } = loadDemoPage({ pageStackDepth: 2 });
  await instance.onLoad({ role: 'student', detail: 'notice', id: 'not_exist_notice' });
  await flush();

  assert.equal(instance.data.ready, false);
  assert.equal(instance.data.detail, null);
  assert.ok(instance.data.error);
});

test('学生通知：从列表返回走原生返回，直接打开时退回演示工作台', async () => {
  const fromList = loadDemoPage({ pageStackDepth: 2 });
  await fromList.instance.onLoad({ role: 'student', detail: 'notice', id: 'demo_notice_2' });
  await flush();
  fromList.instance.goBackToList();
  /* 注意：跨 VM 边界传回的对象原型不同，故逐字段断言 */
  assert.equal(fromList.calls.navigateBack.length, 1, '有上一页时应原生返回以保留列表状态');
  assert.equal(fromList.calls.navigateBack[0].delta, 1);
  assert.deepEqual(fromList.calls.navigateTo, []);

  const direct = loadDemoPage({ pageStackDepth: 1 });
  await direct.instance.onLoad({ role: 'student', detail: 'notice', id: 'demo_notice_2' });
  await flush();
  direct.instance.goBackToList();
  assert.deepEqual(direct.calls.navigateBack, []);
  assert.deepEqual(direct.calls.navigateTo, ['/pages/demo/demo?role=student']);
});

test('家长端演示：赛事与通知同样可打开详情（最小修复）', async () => {
  const workbench = PARENT_DEMO.buildParentWorkbench(0);
  for (const notice of workbench.noticeRows) {
    assert.ok(notice.id && notice.detailText, '家长通知需要 id 与正文');
  }
  for (const item of workbench.competitionRows) {
    assert.ok(item.id && item.detailText, '赛事意向需要 id 与说明');
  }

  const module = PARENT_DEMO.buildParentModule('events', 0);
  assert.ok(module.rows.length >= 3);
  for (const row of module.rows) {
    assert.ok(['notice', 'competition'].indexOf(row.detailType) !== -1, '赛事/通知行必须带详情类型');
    assert.ok(row.detailId);
  }

  const notice = loadDemoPage({ pageStackDepth: 2 });
  await notice.instance.onLoad({ role: 'parent', detail: 'notice', id: workbench.noticeRows[0].id });
  await flush();
  assert.equal(notice.instance.data.detail.isNotice, true);
  assert.equal(notice.instance.data.detail.title, workbench.noticeRows[0].title);
  assert.equal(notice.instance.data.detail.body, workbench.noticeRows[0].detailText);

  const competition = loadDemoPage({ pageStackDepth: 2 });
  await competition.instance.onLoad({
    role: 'parent',
    detail: 'competition',
    id: workbench.competitionRows[0].id
  });
  await flush();
  assert.equal(competition.instance.data.detail.isNotice, false);
  assert.equal(competition.instance.data.detail.title, workbench.competitionRows[0].title);
});

/* ------------------------------------------- BUG-04 家长端快捷定位 */

test('家长端快捷定位：三个按钮都产生真实页面滚动，而不仅仅是切换颜色', async () => {
  const { instance, calls } = loadDemoPage();
  await instance.onLoad({ role: 'parent' });
  await flush();

  const cases = [
    ['performance', '#sec-performance'],
    ['attendance', '#sec-attendance'],
    ['events', '#sec-events']
  ];
  for (const [section, selector] of cases) {
    calls.pageScrollTo.length = 0;
    instance.goSection({ currentTarget: { dataset: { section } } });

    assert.equal(instance.data.activeSection, section, `选中态应切到 ${section}`);
    assert.equal(calls.pageScrollTo.length, 1, `${section} 必须触发一次真实滚动`);
    assert.equal(calls.pageScrollTo[0].selector, selector);
    assert.ok(calls.pageScrollTo[0].duration >= 0, '应给出滚动动画时长');
  }
});

test('家长端快捷定位：滚动选择器与模板锚点一一对应', () => {
  const wxml = read('miniprogram/pages/demo/demo.wxml');
  const sectionAttrs = wxml.match(/data-section="[a-z]+"/g) || [];
  assert.equal(sectionAttrs.length, 3, '应只有三个快捷分区按钮');

  for (const section of ['performance', 'attendance', 'events']) {
    assert.ok(wxml.includes(`data-section="${section}"`), `缺少按钮 data-section=${section}`);
    assert.ok(wxml.includes(`id="sec-${section}"`), `模板缺少对应锚点 sec-${section}`);
  }
});

test('家长端快捷定位：连续点击同一分区仍重复滚动', async () => {
  const { instance, calls } = loadDemoPage();
  await instance.onLoad({ role: 'parent' });
  await flush();

  instance.goSection({ currentTarget: { dataset: { section: 'attendance' } } });
  instance.goSection({ currentTarget: { dataset: { section: 'attendance' } } });

  assert.equal(calls.pageScrollTo.length, 2, '同一分区连续点击应重复触发滚动');
  assert.deepEqual(
    calls.pageScrollTo.map((item) => item.selector),
    ['#sec-attendance', '#sec-attendance']
  );
});

test('家长端快捷定位：快速切换不同分区按点击顺序生效', async () => {
  const { instance, calls } = loadDemoPage();
  await instance.onLoad({ role: 'parent' });
  await flush();

  for (const section of ['performance', 'events', 'attendance']) {
    instance.goSection({ currentTarget: { dataset: { section } } });
  }

  assert.deepEqual(calls.pageScrollTo.map((item) => item.selector), [
    '#sec-performance',
    '#sec-events',
    '#sec-attendance'
  ]);
  assert.equal(instance.data.activeSection, 'attendance', '选中态应为最后一次点击');
});

test('家长端快捷定位：学生切换后定位能力仍然有效', async () => {
  const { instance, calls } = loadDemoPage();
  await instance.onLoad({ role: 'parent' });
  await flush();

  instance.goSection({ currentTarget: { dataset: { section: 'performance' } } });
  assert.equal(calls.pageScrollTo.length, 1);

  /* 切到待审核学生，再切回已生效学生 */
  instance.onStudentChange({ detail: { value: '1' } });
  assert.equal(instance.data.parent.linkActive, false);
  instance.onStudentChange({ detail: { value: '0' } });
  assert.equal(instance.data.parent.linkActive, true);

  instance.goSection({ currentTarget: { dataset: { section: 'events' } } });
  assert.equal(calls.pageScrollTo.length, 2, '切换学生后仍应能定位');
  assert.equal(calls.pageScrollTo[1].selector, '#sec-events');
});

test('家长端快捷定位：待审核学生不渲染快捷入口，也不泄露受保护数据', async () => {
  const { instance, calls } = loadDemoPage();
  await instance.onLoad({ role: 'parent', student: '1' });
  await flush();

  assert.equal(instance.data.parent.linkActive, false);
  assert.equal(instance.data.parent.overview, null);
  assert.deepEqual(instance.data.parent.performanceRows, []);
  assert.deepEqual(instance.data.parent.attendanceRows, []);

  /* 即使手动触发定位，也不会滚动到受保护分区，更不会产生数据 */
  instance.goSection({ currentTarget: { dataset: { section: 'performance' } } });
  assert.equal(calls.pageScrollTo.length, 0, '未授权时不应发起定位');

  /* 快捷入口与受保护分区都必须位于 linkActive 分支内 */
  const wxml = read('miniprogram/pages/demo/demo.wxml');
  const guardIndex = wxml.indexOf('wx:if="{{parent.linkActive}}"');
  const jumpIndex = wxml.indexOf('class="jg-jump"');
  const eventsIndex = wxml.indexOf('id="sec-events"');
  /* 用完整注释定位家长分支，避免匹配到其他位置的“关联未生效”字样 */
  const inactiveIndex = wxml.indexOf('<!-- 关联未生效：只展示学生标识');
  assert.ok(inactiveIndex > 0, '应存在关联未生效分支');
  assert.ok(guardIndex > 0, '应存在 linkActive 分支');
  assert.ok(jumpIndex > guardIndex, '快捷入口必须在 linkActive 分支内');
  assert.ok(eventsIndex > guardIndex && eventsIndex < inactiveIndex, '受保护分区必须在 linkActive 分支内');
});

test('家长端快捷定位：selector 不被支持时退回偏移计算路径', async () => {
  const { instance, calls } = loadDemoPage({
    scrollSelectorFails: true,
    rectTop: 640,
    viewportScrollTop: 100
  });
  await instance.onLoad({ role: 'parent' });
  await flush();

  instance.goSection({ currentTarget: { dataset: { section: 'events' } } });
  assert.equal(calls.pageScrollTo.length, 2, '应有一次 selector 调用与一次兼容路径调用');
  assert.equal(calls.pageScrollTo[0].selector, '#sec-events');
  /* 100 + 640 - 12 = 728 */
  assert.equal(calls.pageScrollTo[1].scrollTop, 728, '兼容路径应按元素偏移计算 scrollTop');
});
