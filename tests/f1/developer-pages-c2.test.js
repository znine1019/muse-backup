'use strict';

/**
 * F1-C2｜开发者端剩余页面视觉统一回归测试
 *
 * 覆盖 profile-view 与 bootstrap 的视觉迁移、字段绑定和安全流程保护。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PAGES = ['profile-view', 'bootstrap'];

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function pageFile(page, extension) {
  return `miniprogram/pages/${page}/${page}.${extension}`;
}

function classTokens(source) {
  const tokens = [];
  for (const match of source.matchAll(/class="([^"]*)"/g)) {
    const cleaned = match[1].replace(/\{\{[^}]*\}\}/g, ' ');
    for (const token of cleaned.split(/\s+/)) {
      if (token && !token.includes('{') && !token.includes('}')) tokens.push(token);
    }
  }
  return tokens;
}

const LEGACY_CLASSES = new Set([
  'container','brand','title','sub','card','card-title','card-sub','pill','notice','action',
  'button-primary','button-secondary','button-danger','button-row','form-card','field',
  'field-label','input','picker-field','textarea','muted','error','success','empty','tag',
  'list-item','list-title','list-meta','section-title','section-sub','row','kpi'
]);

const LEGACY_TOKENS = [
  '#123C4D','#207788','#437A86','#E9F6F8','#10263C','#4A6B94','#718493','#F4F7FA'
];

function loadPage(relativePath, api, options = {}) {
  let definition = null;
  const calls = { reLaunch: [], navigateTo: [] };
  const wx = {
    reLaunch: (payload) => calls.reLaunch.push(payload.url),
    navigateTo: (payload) => calls.navigateTo.push(payload.url),
    ...(options.wx || {})
  };
  const session = options.session || { user: { status: 'active', roles: ['developer'] } };

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
        ensureSession: options.ensureSession || (async () => session),
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
      JSON
    },
    { filename: path.join(PROJECT_ROOT, relativePath) }
  );

  assert.ok(definition, `${relativePath} 应注册 Page`);
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) {
      for (const [key, value] of Object.entries(update)) {
        this.data[key] = value;
      }
    }
  };
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function') instance[key] = value.bind(instance);
  }
  return { instance, calls };
}

function flush() {
  let chain = Promise.resolve();
  for (let index = 0; index < 5; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return chain;
}

test('F1-C2 两个页面已迁移到 jg- 设计语言', () => {
  for (const page of PAGES) {
    const wxml = read(pageFile(page, 'wxml'));
    const wxss = read(pageFile(page, 'wxss'));
    assert.match(wxml, /class="jg-page/, `${page} 应使用 jg-page`);
    assert.match(wxml, /<jg-page-head/, `${page} 应使用统一页头`);
    for (const token of classTokens(wxml)) {
      assert.ok(!LEGACY_CLASSES.has(token), `${page} 残留遗留类 .${token}`);
    }
    for (const token of LEGACY_TOKENS) {
      assert.ok(!wxml.includes(token), `${page}.wxml 残留旧色值 ${token}`);
      assert.ok(!wxss.includes(token), `${page}.wxss 残留旧色值 ${token}`);
    }
  }
});

test('F1-C2 页面使用的 jg- 类均已定义', () => {
  const defined = new Set();
  const collect = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(fullPath);
      else if (entry.name.endsWith('.wxss')) {
        for (const match of fs.readFileSync(fullPath, 'utf8').matchAll(/\.(jg-[a-z0-9-]+)/g)) {
          defined.add(match[1]);
        }
      }
    }
  };
  collect(path.join(PROJECT_ROOT, 'miniprogram'));
  for (const page of PAGES) {
    for (const token of classTokens(read(pageFile(page, 'wxml')))) {
      if (token.startsWith('jg-')) {
        assert.ok(defined.has(token), `${page} 使用了未定义样式 .${token}`);
      }
    }
  }
});

test('F1-C2 路由和组件注册正确', () => {
  const appPages = JSON.parse(read('miniprogram/app.json')).pages;
  for (const page of PAGES) {
    assert.ok(appPages.includes(`pages/${page}/${page}`), `${page} 应已注册`);
  }
  assert.equal(
    JSON.parse(read(pageFile('profile-view', 'json'))).usingComponents['jg-page-head'],
    '/components/jg-page-head/jg-page-head'
  );
  assert.equal(
    JSON.parse(read(pageFile('profile-view', 'json'))).usingComponents['jg-empty'],
    '/components/jg-empty/jg-empty'
  );
  assert.equal(
    JSON.parse(read(pageFile('bootstrap', 'json'))).usingComponents['jg-page-head'],
    '/components/jg-page-head/jg-page-head'
  );
});

test('F1-C2 profile-view 保留全部实际数据字段', () => {
  const wxml = read(pageFile('profile-view', 'wxml'));
  for (const binding of [
    'profile.name','profile.gender','profile.birthDate','profile.primaryEventName',
    'profile.primaryTrainingProject','profile.trainingYears',
    'profile.trainingExperienceSummary','profile.examGoal.targetScore',
    'secondaryEventsText','measurements','performances','item.heightCm','item.weightKg',
    'item.measuredAt','item.eventName','item.value','item.unit','item.achievedAt',
    'item.statusLabel','item.reviewComment'
  ]) {
    assert.ok(wxml.includes(binding), `学生档案缺少绑定 ${binding}`);
  }
  assert.match(wxml, /bindtap="goReport"/, '学生档案应保留运动报告入口');
});

test('F1-C2 profile-view 保留 coach/developer 权限判断', () => {
  const js = read(pageFile('profile-view', 'js'));
  assert.ok(js.includes("sessionHasRole(session, 'coach')"), '应保留教练权限判断');
  assert.ok(js.includes("sessionHasRole(session, 'developer')"), '应保留开发者权限判断');
  assert.ok(js.includes('getStudentProfile'), '应继续通过受控API读取学生档案');
  assert.ok(js.includes('getSessionDestination'), '应保留无权限跳转');
});

test('F1-C2 profile-view 页面实际加载学生数据并保留报告导航', async () => {
  const api = {
    getStudentProfile: async () => ({
      profile: {
        name: '学生甲',
        gender: '男',
        birthDate: '2009-01-01',
        primaryEventName: '100米',
        secondaryEventCodes: ['long_jump'],
        trainingYears: 2,
        trainingExperienceSummary: '模拟经历',
        examGoal: { targetScore: '11.50秒' }
      },
      measurements: [{ id: 'm1', heightCm: 170, weightKg: 60, measuredAt: '2026-10-01' }],
      performances: [{ id: 'p1', eventName: '100米', value: 11.8, unit: '秒', achievedAt: '2026-10-02', status: 'approved' }]
    })
  };
  const { instance, calls } = loadPage(pageFile('profile-view', 'js'), api);
  instance.onLoad({ userId: 'student_1' });
  await flush();

  assert.equal(instance.data.profile.name, '学生甲');
  assert.equal(instance.data.secondaryEventsText, 'long_jump');
  assert.equal(instance.data.performances[0].statusLabel, '已通过');
  instance.goReport();
  assert.equal(calls.navigateTo[0], '/pages/student-report/student-report?userId=student_1');
});

test('F1-C2 bootstrap 保留输入、提交和安全提示', () => {
  const wxml = read(pageFile('bootstrap', 'wxml'));
  assert.match(wxml, /bindinput="onInput"/, '缺少初始化码输入事件');
  assert.match(wxml, /bindtap="handleSubmit"/, '缺少初始化提交事件');
  assert.match(wxml, /一次性初始化码/, '缺少初始化码字段');
  assert.match(wxml, /初始化码只能配置在云函数环境变量中/, '缺少环境变量安全说明');
  assert.match(wxml, /使用完成后请立即删除/, '缺少使用后清理提示');
  assert.ok(!/重置|清空数据|重新初始化/.test(wxml), '不得新增危险初始化入口');
});

test('F1-C2 bootstrap 实际提交仍调用原有初始化和会话刷新', async () => {
  const bootstrapCalls = [];
  let ensureCalls = 0;
  const api = {
    bootstrapDeveloper: async (code) => {
      bootstrapCalls.push(code);
      return {};
    }
  };
  const { instance, calls: navCalls } = loadPage(pageFile('bootstrap', 'js'), api, {
    ensureSession: async () => {
      ensureCalls += 1;
      return { user: { status: 'active', roles: ['developer'] } };
    }
  });
  instance.onInput({ detail: { value: 'BOOT-CODE' } });
  await instance.handleSubmit();
  assert.equal(bootstrapCalls[0], 'BOOT-CODE');
  assert.equal(ensureCalls, 1);
  assert.equal(navCalls.reLaunch[0], '/pages/admin/admin');
  assert.equal(instance.data.bootstrapCode, '');
  assert.match(instance.data.message, /成功/);
});

test('F1-C2 bootstrap 未修改服务端安全限制与业务判断', () => {
  const js = read(pageFile('bootstrap', 'js'));
  assert.ok(js.includes('bootstrapDeveloper'), '应继续调用原有初始化接口');
  assert.ok(js.includes('ensureSession'), '初始化成功后应刷新会话');
  assert.ok(js.includes("wx.reLaunch({ url: '/pages/admin/admin' })"), '成功路径应保持原跳转');
  assert.ok(js.includes('submitting'), '应保留防重复提交');
  assert.ok(!/reset|clear|delete/i.test(js), '不应新增危险重置操作');
});
