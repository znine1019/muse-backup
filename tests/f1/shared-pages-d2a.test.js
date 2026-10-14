'use strict';

/**
 * F1-D2a｜系统入口、注册与审核状态页面视觉统一回归测试
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PAGES = ['index', 'register', 'pending'];

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
  const session = options.session || { user: { id: 'u1', status: 'pending_profile', roles: [] } };
  const destination = options.destination || { type: 'review', url: '/pages/pending/pending', label: '查看审核状态' };
  const wx = {
    reLaunch: (payload) => calls.reLaunch.push(payload.url),
    navigateTo: (payload) => calls.navigateTo.push(payload.url),
    ...(options.wx || {})
  };

  vm.runInNewContext(
    read(relativePath),
    {
      require: (request) => {
        if (request.includes('services/api')) return api;
        if (request.includes('utils/session')) {
          return {
            getSessionDestination: () => destination,
            getStatusLabel: (status) =>
              ({ pending_profile: '待完善资料', pending_review: '待审核', rejected: '审核未通过', disabled: '已停用', active: '已启用' }[status] || status)
          };
        }
        throw new Error(`未打桩的依赖：${request}`);
      },
      Page: (value) => {
        definition = value;
      },
      getApp: () => ({
        ensureSession: async () => session,
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
        if (key.startsWith('form.')) {
          this.data.form[key.slice(5)] = value;
        } else {
          this.data[key] = value;
        }
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

test('F1-D2a 三个共用页面已迁移到 jg- 设计语言', () => {
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

test('F1-D2a 页面使用的 jg- 类均已定义', () => {
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

test('F1-D2a 路由和组件注册正确', () => {
  const appPages = JSON.parse(read('miniprogram/app.json')).pages;
  for (const page of PAGES) {
    assert.ok(appPages.includes(`pages/${page}/${page}`), `${page} 应保持注册`);
    assert.equal(
      JSON.parse(read(pageFile(page, 'json'))).usingComponents['jg-page-head'],
      '/components/jg-page-head/jg-page-head',
      `${page} 应注册 jg-page-head`
    );
  }
});

test('F1-D2a index 保留身份识别、登录和健康检查绑定', () => {
  const wxml = read(pageFile('index', 'wxml'));
  const js = read(pageFile('index', 'js'));
  assert.match(wxml, /bindtap="\{\{session \? 'handleContinue' : 'handleLogin'\}\}"/, '动态登录按钮绑定不得丢失');
  assert.match(wxml, /bindtap="handleHealthCheck"/, '健康检查入口不得丢失');
  for (const binding of ['session', 'statusLabel', 'actionLabel', 'loading', 'error', 'healthText']) {
    assert.ok(wxml.includes(binding), `index 缺少绑定 ${binding}`);
  }
  assert.ok(js.includes('getSessionDestination'), '应保留身份分流');
  assert.ok(js.includes('healthCheck'), '应保留连接检查');
});

test('F1-D2a register 保留全部学生注册字段和提交分支', () => {
  const wxml = read(pageFile('register', 'wxml'));
  assert.match(wxml, /<form[^>]*bindsubmit="handleSubmit"/, '表单提交绑定不得丢失');
  for (const field of ['name','heightCm','weightKg','primaryTrainingProject']) {
    assert.match(wxml, new RegExp(`name="${field}"`), `缺少表单字段 ${field}`);
  }
  for (const handler of ['onFieldInput','onGenderChange','onBirthDateChange','onGroupChange']) {
    assert.match(wxml, new RegExp(`bind(?:input|change)="${handler}"`), `缺少注册事件 ${handler}`);
  }
  assert.ok(wxml.includes('form.birthDate'), '出生日期绑定不得丢失');
  assert.ok(wxml.includes('form.requestedTrainingGroupId') || wxml.includes('groupOptions'), '训练组绑定不得丢失');
  assert.ok(wxml.includes('form-type="submit"'), '提交按钮类型不得丢失');
  assert.ok(wxml.includes('disabled="{{submitting}}"'), '提交中禁用状态不得丢失');
});

test('F1-D2a pending 保留全部审核状态和原操作', () => {
  const wxml = read(pageFile('pending', 'wxml'));
  for (const status of ['pending_profile','pending_review','rejected','disabled']) {
    assert.ok(wxml.includes(`status === '${status}'`), `缺少状态分支 ${status}`);
  }
  for (const handler of ['refresh','goRegister','goParentRegister','goHome']) {
    assert.match(wxml, new RegExp(`bindtap="${handler}"`), `缺少事件 ${handler}`);
  }
  for (const binding of ['statusLabel','reviewComment','profile.name','profile.birthDate','profile.primaryTrainingProject','profile.heightCm','profile.weightKg']) {
    assert.ok(wxml.includes(binding), `pending 缺少绑定 ${binding}`);
  }
  assert.ok(wxml.includes('资料已提交'), '待审核状态文案不得丢失');
  assert.ok(wxml.includes('审核未通过'), '审核驳回文案不得丢失');
  assert.ok(wxml.includes('账号已停用'), '停用状态文案不得丢失');
});

test('F1-D2a 页面未新增未经授权的业务入口', () => {
  const combined = PAGES.map((page) => read(pageFile(page, 'wxml'))).join('\n');
  for (const forbidden of ['bootstrap', '发布成绩', '审核注册', '修改角色']) {
    assert.ok(!combined.includes(forbidden), `不应新增入口 ${forbidden}`);
  }
});

test('F1-D2a index 页面实际识别会话并跳转', async () => {
  const { instance, calls } = loadPage(pageFile('index', 'js'), {}, {
    session: { user: { id: 'u1', status: 'active', roles: ['student'] } },
    destination: { type: 'role', url: '/pages/student/student', label: '进入学生端' }
  });
  instance.onShow();
  await flush();
  assert.equal(instance.data.session.user.id, 'u1');
  assert.equal(instance.data.statusLabel, '已启用');
  assert.equal(instance.data.actionLabel, '进入学生端');
  assert.equal(calls.reLaunch[0], '/pages/student/student');
});

test('F1-D2a pending 页面实际加载状态并提供家长注册入口', async () => {
  const api = {
    getProfile: async () => ({
      userStatus: 'pending_review',
      profile: { name: '家长申请人', birthDate: '', primaryTrainingProject: '', heightCm: '', weightKg: '' },
      reviewComment: ''
    })
  };
  const { instance, calls } = loadPage(pageFile('pending', 'js'), api, {
    session: { user: { id: 'u1', status: 'pending_review', roles: [] } }
  });
  instance.onShow();
  await flush();
  assert.equal(instance.data.status, 'pending_review');
  assert.equal(instance.data.statusLabel, '待审核');
  instance.goParentRegister();
  assert.equal(calls.navigateTo[0], '/pages/parent-register/parent-register');
  instance.goHome();
  assert.equal(calls.reLaunch[0], '/pages/index/index');
});
