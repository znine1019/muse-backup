'use strict';

/**
 * D1-A｜DEMO 展示工作区安全隔离测试（仅存在于 demo/showcase-v1 分支）
 *
 * 对应任务第八节的 7 条安全验收，全部为**行为级**断言：
 *   1. 四角色入口均不要求真实角色授权；
 *   2. DEMO 不能调用正式业务 API；
 *   3. DEMO 不读取/写入正式 CloudBase 业务数据；
 *   4. DEMO 不能调用真实开发者管理接口；
 *   5. 待审核家长关联仍不能访问受保护数据；
 *   6. 学生不能查看未发布训练计划；
 *   7. DEMO 工作区修改不会污染 main 分支。
 *
 * 说明：本文件不依赖任何页面文案或"按钮被隐藏"作为安全依据。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

const SHOWCASE = require(path.join(PROJECT_ROOT, 'miniprogram/demo/showcase.js'));
const BUILD_MODE = require(path.join(PROJECT_ROOT, 'miniprogram/config/build-mode.js'));
const DEMO_GUARD = require(path.join(PROJECT_ROOT, 'miniprogram/demo/demo-guard.js'));
const STUDENT_DEMO = require(path.join(PROJECT_ROOT, 'miniprogram/demo/student-demo.js'));
const PARENT_DEMO = require(path.join(PROJECT_ROOT, 'miniprogram/demo/parent-demo.js'));
const API = require(path.join(PROJECT_ROOT, 'miniprogram/services/api.js'));

/* 演示基线：demo/showcase-v1 必须基于该提交派生 */
const BASELINE_COMMIT = '3274cbb';

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

function wxCloudSpy() {
  const calls = { init: 0, callFunction: [] };
  return {
    calls,
    wx: {
      cloud: {
        init: () => {
          calls.init += 1;
        },
        callFunction: (options) => {
          calls.callFunction.push(options);
          return Promise.resolve({ result: { ok: true, data: {} } });
        }
      },
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      getStorageSync: (key) =>
        key === SHOWCASE.DEMO_SESSION_STORAGE_KEY ? 'student' : '',
      setStorageSync: () => {},
      removeStorageSync: () => {},
      showToast: () => {},
      navigateTo: () => {}
    }
  };
}

/* ============================================================ 1. 四角色入口 */

test('D1-A 展示入口包含四种模拟身份，且不需要真实角色授权', () => {
  /* D1-B：DEMO 首页只保留三个体验入口，已移除开发者端 */
  const roles = SHOWCASE.SHOWCASE_ROLES.map((item) => item.role).sort();
  assert.deepEqual(roles, ['coach', 'parent', 'student'], '应只包含学生/教练员/家长三个入口');
  assert.ok(!roles.includes('developer'), 'DEMO 不再提供开发者端入口');

  for (const item of SHOWCASE.SHOWCASE_ROLES) {
    assert.ok(item.label && item.desc, `${item.role} 入口应有名称与说明`);
    /* 模拟会话：带 demo 标记，且不含任何真实微信身份凭据 */
    const session = SHOWCASE.buildDemoSession(item.role);
    assert.equal(session.demo, true, `${item.role} 会话应为模拟会话`);
    assert.ok(session.user.id.startsWith('demo_'), `${item.role} 不应使用真实用户标识`);
    assert.equal(session.user.openid, undefined, `${item.role} 不得包含真实 openid`);
  }

  assert.equal(SHOWCASE.buildDemoSession('not_a_role'), null, '未知角色不得签发会话');
});

test('D1-A 未选择身份时守卫拒绝，选择后放行（develop/trial）', () => {
  const { wx } = wxCloudSpy();

  /* 未选择身份：拒绝且给出明确引导 */
  const noRole = withWx(wx, () => DEMO_GUARD.checkDemoAccess(null));
  assert.equal(noRole.ok, false);
  assert.match(noRole.reason, /DEMO 入口/);

  /* 选择学生身份后：放行，且整个过程不需要真实 developer 角色 */
  const studentSession = SHOWCASE.buildDemoSession('student');
  const allowed = withWx(wx, () => DEMO_GUARD.checkDemoAccess(studentSession));
  assert.equal(allowed.ok, true, '模拟学生身份应可进入 DEMO');
});

/* ====================================================== 2. 正式业务 API */

test('D1-A DEMO 不能调用正式业务 API（接口层直接拒绝且不触碰 wx.cloud）', async () => {
  const { calls, wx } = wxCloudSpy();

  await withWx(wx, async () => {
    const actions = [
      () => API.login(),
      () => API.getProfile(),
      () => API.listStudentPlans({ scope: 'today' }),
      () => API.listStudentNotices({}),
      () => API.getMyReport(),
      () => API.getMyStatistics({ periodType: 'month' })
    ];
    for (const invoke of actions) {
      await assert.rejects(
        () => invoke(),
        (error) => error.code === 'DEMO_BUILD_BLOCKED',
        '正式业务接口调用应被 DEMO 隔离门拒绝'
      );
    }
  });

  assert.equal(calls.init, 0, '不应初始化云开发');
  assert.equal(calls.callFunction.length, 0, '不应发生任何云函数调用');
});

/* ================================================ 3. 正式 CloudBase 数据 */

test('D1-A DEMO 不初始化云开发、不读写正式 CloudBase', () => {
  const source = read('miniprogram/app.js');
  let appConfig = null;
  const { calls, wx } = wxCloudSpy();

  vm.runInNewContext(
    source,
    {
      require: (request) => {
        if (request.includes('config/env')) {
          return { CLOUD_ENV_ID: 'cloud1-demo-test', API_FUNCTION_NAME: 'api', HEALTH_FUNCTION_NAME: 'health_check' };
        }
        if (request.includes('config/build-mode')) {
          return BUILD_MODE;
        }
        if (request.includes('demo/showcase')) {
          return SHOWCASE;
        }
        if (request.includes('services/api')) {
          return { login: () => Promise.resolve({ session: {} }) };
        }
        throw new Error(`未打桩的依赖：${request}`);
      },
      App: (config) => {
        appConfig = config;
      },
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
    { filename: path.join(PROJECT_ROOT, 'miniprogram/app.js') }
  );

  assert.ok(appConfig, 'app.js 应注册 App');
  appConfig.onLaunch();

  assert.equal(calls.init, 0, 'DEMO 构建不得调用 wx.cloud.init');
  assert.equal(appConfig.globalData.cloudReady, false, 'DEMO 构建不应处于云就绪状态');
  assert.equal(appConfig.globalData.demoBuild, true, 'DEMO 构建应标记 demoBuild');
});

test('D1-A DEMO 启动会话不经过正式登录接口', async () => {
  const source = read('miniprogram/app.js');
  let appConfig = null;
  const loginCalls = [];
  const { wx } = wxCloudSpy();

  vm.runInNewContext(
    source,
    {
      require: (request) => {
        if (request.includes('config/env')) {
          return { CLOUD_ENV_ID: 'cloud1-demo-test', API_FUNCTION_NAME: 'api', HEALTH_FUNCTION_NAME: 'health_check' };
        }
        if (request.includes('config/build-mode')) {
          return BUILD_MODE;
        }
        if (request.includes('demo/showcase')) {
          return SHOWCASE;
        }
        if (request.includes('services/api')) {
          return {
            login: () => {
              loginCalls.push(1);
              return Promise.resolve({ session: {} });
            }
          };
        }
        throw new Error(`未打桩的依赖：${request}`);
      },
      App: (config) => {
        appConfig = config;
      },
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
    { filename: path.join(PROJECT_ROOT, 'miniprogram/app.js') }
  );

  appConfig.onLaunch();
  /* showcase 模块在 Node 作用域中读取全局 wx，因此这里同样需要注入 */
  const session = await withWx(wx, () => appConfig.ensureSession.call(appConfig));

  assert.equal(loginCalls.length, 0, 'DEMO 构建不得调用正式登录接口');
  assert.equal(session.demo, true, '应返回本地模拟会话');
  assert.equal(session.user.roles.includes('student'), true, '模拟会话应携带所选模拟角色');
});

/* ============================================== 4. 真实开发者管理接口 */

test('D1-A DEMO 不能调用真实开发者管理接口', async () => {
  const { calls, wx } = wxCloudSpy();

  await withWx(wx, async () => {
    const adminActions = [
      () => API.listUsers(),
      () => API.assignRole({ targetUserId: 'x', role: 'developer', grant: true }),
      () => API.setUserStatus({ targetUserId: 'x', status: 'disabled' }),
      () => API.listPendingRegistrations(),
      () => API.reviewRegistration({ targetUserId: 'x', decision: 'approve' }),
      () => API.healthCheck(),
      () => API.bootstrapDeveloper('code')
    ];
    for (const invoke of adminActions) {
      await assert.rejects(
        () => invoke(),
        (error) => error.code === 'DEMO_BUILD_BLOCKED',
        '开发者管理接口应被 DEMO 隔离门拒绝'
      );
    }
  });

  assert.equal(calls.callFunction.length, 0, '开发者管理接口不得产生云函数调用');
});

test('D1-A 展示入口不导航到任何正式管理页面', () => {
  const source = read('miniprogram/pages/showcase/showcase.js');
  for (const forbidden of ['/pages/admin/admin', '/pages/bootstrap/bootstrap', '/pages/index/index']) {
    assert.ok(!source.includes(forbidden), `展示入口不得跳转 ${forbidden}`);
  }
  /* 只允许跳转到本地演示页 */
  const navigations = source.match(/url:\s*[`'"][^`'"]+/g) || [];
  assert.ok(navigations.length > 0, '应存在导航');
  for (const item of navigations) {
    assert.ok(item.includes('/pages/demo/demo'), `展示入口只能跳转演示页，发现：${item}`);
  }
});

/* ====================================== 5. 待审核家长关联的数据隔离 */

test('D1-A 待审核家长关联仍不能访问受保护数据', () => {
  const pending = PARENT_DEMO.buildParentWorkbench(1);
  assert.equal(pending.linkState, PARENT_DEMO.PARENT_LINK_STATUS.PENDING_REVIEW);
  assert.equal(pending.linkActive, false);
  assert.equal(pending.overview, null, '未生效关联不得返回概览');
  for (const key of ['plans', 'performanceRows', 'attendanceRows', 'feedbackRows', 'competitionRows', 'noticeRows']) {
    assert.deepEqual(pending[key], [], `未生效关联不得返回 ${key}`);
  }

  for (const moduleId of PARENT_DEMO.PROTECTED_MODULE_IDS) {
    const module = PARENT_DEMO.buildParentModule(moduleId, 1);
    assert.equal(module.restricted, true, `${moduleId} 应被限制`);
    assert.deepEqual(module.rows, [], `${moduleId} 不得返回数据行`);
  }

  /* 已生效关联仍可正常读取（对照组） */
  const active = PARENT_DEMO.buildParentWorkbench(0);
  assert.equal(active.linkActive, true);
  assert.ok(active.performanceRows.length > 0);
});

/* ==================================== 6. 未发布训练计划的数据隔离 */

test('D1-A 学生不能查看未发布的训练计划', () => {
  const draftCount = STUDENT_DEMO.ALL_PLANS.filter(
    (item) => item.status === STUDENT_DEMO.PLAN_STATUS.DRAFT
  ).length;
  assert.ok(draftCount > 0, '演示数据应含草稿以证明过滤生效');

  const visible = STUDENT_DEMO.visibleStudentPlans();
  assert.equal(visible.length, STUDENT_DEMO.ALL_PLANS.length - draftCount);

  const module = STUDENT_DEMO.buildStudentModule('plans');
  assert.equal(module.rows.length, visible.length, '计划列表应只含已发布计划');
  for (const row of module.rows) {
    assert.ok(!/草稿/.test(row.t) && !/草稿/.test(row.m), '学生端计划不得出现草稿');
  }

  const workbench = STUDENT_DEMO.buildStudentWorkbench();
  assert.equal(workbench.planOverview.publishedCount, visible.length);
  for (const item of workbench.planOverview.items) {
    assert.ok(!/草稿/.test(item.title), '今日计划概览不得出现草稿');
  }
});

/* ================================================ 7. 工作区隔离（Git） */

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd: cwd || PROJECT_ROOT,
    encoding: 'utf8'
  }).trim();
}

test('D1-A DEMO 工作区与 main 分支相互独立', () => {
  const porcelain = git(['worktree', 'list', '--porcelain']);
  const worktrees = porcelain
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const entry = {};
      for (const line of block.split('\n')) {
        const [key, ...rest] = line.split(' ');
        entry[key] = rest.join(' ');
      }
      return entry;
    });

  assert.equal(worktrees.length, 2, '应存在正式与 DEMO 两个工作区');
  const branches = worktrees.map((item) => (item.branch || '').replace('refs/heads/', '')).sort();
  assert.deepEqual(branches, ['demo/showcase-v1', 'main'].sort(), '两个工作区应分别在 main 与 DEMO 分支上');

  /* 当前测试运行在 DEMO 工作区 */
  const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.equal(currentBranch, 'demo/showcase-v1', '当前工作区应为 DEMO 分支');

  /* main 工作区：干净，且仍指向演示基线提交 */
  const mainRoot = worktrees.find((item) => (item.branch || '').endsWith('/main')).worktree;
  assert.equal(
    git(['status', '--porcelain'], mainRoot),
    '',
    'main 工作区应保持干净（DEMO 改动不得污染正式工作区）'
  );
  assert.equal(
    git(['rev-parse', '--short', 'HEAD'], mainRoot),
    BASELINE_COMMIT,
    `main 工作区应仍指向基线 ${BASELINE_COMMIT}`
  );
});

test('D1-A DEMO 分支未改动任何云函数或云端资源', () => {
  /* 与基线比较（含未提交的工作区改动，因此提交前也能验证） */
  const changedFiles = git(['diff', '--name-only', BASELINE_COMMIT])
    .split('\n')
    .filter(Boolean);

  assert.ok(changedFiles.length > 0, 'DEMO 分支应有改动');
  for (const file of changedFiles) {
    assert.ok(
      !file.startsWith('cloudfunctions/'),
      `DEMO 分支不得改动云函数：${file}`
    );
    assert.ok(
      !file.startsWith('cloudbaserc'),
      `DEMO 分支不得改动云端配置：${file}`
    );
    assert.ok(
      !file.startsWith('project.config.json'),
      `DEMO 分支不得改动小程序工程配置：${file}`
    );
  }
});
