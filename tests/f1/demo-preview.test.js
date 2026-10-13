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
    wxOverrides = {}
  } = options;

  const source = fs.readFileSync(DEMO_PAGE_JS, 'utf8');
  let page = null;
  const calls = { navigateTo: [], reLaunch: [], removeStorageSync: [] };

  const wx = {
    navigateTo: (opts) => calls.navigateTo.push(opts.url),
    reLaunch: (opts) => calls.reLaunch.push(opts.url),
    removeStorageSync: (key) => calls.removeStorageSync.push(key),
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
      encodeURIComponent
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
