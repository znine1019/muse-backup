'use strict';

/**
 * F1-D2c｜coach/developer 共用页面身份标签回归测试
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PAGES = Object.freeze({
  coach: {
    route: 'pages/coach/coach',
    label: '训练管理',
    handlers: [
      'goPlans',
      'goAttendanceManage',
      'goPerformanceReview',
      'goCompetitionManage',
      'goNoticeManage',
      'goFeedbackManage',
      'goStatsWorkbench'
    ]
  },
  'coach-plan-list': {
    route: 'pages/coach-plan-list/coach-plan-list',
    label: '训练计划',
    handlers: [
      'onStatusChange',
      'goCreate',
      'goEdit',
      'toggleDetail',
      'copyPlan',
      'publishPlan',
      'archivePlan',
      'retry',
      'goHome'
    ]
  },
  'coach-plan-edit': {
    route: 'pages/coach-plan-edit/coach-plan-edit',
    label: '计划编辑',
    handlers: [
      'loadPage',
      'onFieldInput',
      'onGroupChange',
      'onItemFieldInput',
      'onItemCategoryChange',
      'addItem',
      'removeItem',
      'saveDraft',
      'publishPlan',
      'goBack'
    ]
  },
  'attendance-manage': {
    route: 'pages/attendance-manage/attendance-manage',
    label: '考勤管理',
    handlers: [
      'toggleCreateForm',
      'onGroupChange',
      'onFormInput',
      'createSession',
      'selectSession',
      'manualVerify',
      'reviewLeave',
      'retry'
    ]
  }
});

function pageFile(page, extension) {
  return path.join(PROJECT_ROOT, `miniprogram/pages/${page}/${page}.${extension}`);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function pageHead(wxml) {
  const start = wxml.indexOf('<jg-page-head');
  assert.ok(start >= 0, '页面应使用 jg-page-head');
  const end = wxml.indexOf('/>', start);
  assert.ok(end > start, 'jg-page-head 应完整闭合');
  return wxml.slice(start, end + 2);
}

function attribute(block, name) {
  const match = block.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : '';
}

function hasHandler(wxml, handler) {
  return new RegExp(`(?:bindtap|bindinput|bindchange|bindsubmit|catchtap|bind:action)="${handler}"`).test(
    wxml
  );
}

test('F1-D2c 共用页头不再写死账号身份标签', () => {
  for (const [page, expected] of Object.entries(PAGES)) {
    const head = pageHead(read(pageFile(page, 'wxml')));
    const label = attribute(head, 'role-label');

    assert.notEqual(label, '教练员', `${page} 不得把 developer 误标为教练员`);
    assert.notEqual(label, '开发者', `${page} 不得把 coach 误标为开发者`);
    assert.equal(label, expected.label, `${page} 应使用中性业务标签`);
    assert.equal(attribute(head, 'role-tone'), 'brand', `${page} 应保持 F1 页头样式`);
  }
});

test('F1-D2c 教练工作台继续用真实会话身份展示动态说明', () => {
  const wxml = read(pageFile('coach', 'wxml'));
  const js = read(pageFile('coach', 'js'));

  assert.match(wxml, /meta="\{\{headMeta\}\}"/, '工作台页头说明应绑定实际会话数据');
  assert.match(js, /const canManage =\s+sessionHasRole\(session, 'coach'\)/);
  assert.match(js, /canSwitchDeveloper: sessionHasRole\(session, 'developer'\)/);
  assert.match(js, /getRoleLabel\('coach'\)/);
});

test('F1-D2c coach/developer 原有服务端权限判断和跳转保留', () => {
  for (const page of Object.keys(PAGES)) {
    const js = read(pageFile(page, 'js'));
    assert.ok(js.includes("sessionHasRole(session, 'coach')"), `${page} 应保留 coach 权限`);
    assert.ok(js.includes("sessionHasRole(session, 'developer')"), `${page} 应保留 developer 权限`);
    assert.ok(js.includes('getSessionDestination'), `${page} 应保留无权限跳转`);
    assert.ok(js.includes('services/api'), `${page} 应继续通过 API 层访问业务`);
  }
});

test('F1-D2c 页面路由与 jg-page-head 注册保持有效', () => {
  const appConfig = JSON.parse(read(path.join(PROJECT_ROOT, 'miniprogram/app.json')));
  for (const [page, expected] of Object.entries(PAGES)) {
    assert.ok(appConfig.pages.includes(expected.route), `${page} 路由应保持注册`);
    const config = JSON.parse(read(pageFile(page, 'json')));
    assert.equal(
      config.usingComponents['jg-page-head'],
      '/components/jg-page-head/jg-page-head',
      `${page} 应继续注册统一页头组件`
    );
  }
});

test('F1-D2c 原有业务事件和页面入口未因标签修改而减少', () => {
  for (const [page, expected] of Object.entries(PAGES)) {
    const wxml = read(pageFile(page, 'wxml'));
    const js = read(pageFile(page, 'js'));
    for (const handler of expected.handlers) {
      assert.ok(hasHandler(wxml, handler), `${page} 模板缺少事件 ${handler}`);
      assert.ok(js.includes(`${handler}(`), `${page} 页面缺少处理器 ${handler}`);
    }
  }
});

test('F1-D2c 训练计划字段和考勤管理能力保持不变', () => {
  const planList = read(pageFile('coach-plan-list', 'wxml'));
  const planEdit = read(pageFile('coach-plan-edit', 'wxml'));
  const attendance = read(pageFile('attendance-manage', 'wxml'));

  for (const binding of ['item.statusLabel', 'item.title', 'item.dateText', 'item.itemCount']) {
    assert.ok(planList.includes(binding), `训练计划列表缺少绑定 ${binding}`);
  }
  for (const binding of [
    'value="{{title}}"',
    'value="{{startDate}}"',
    'value="{{endDate}}"',
    'value="{{item.name}}"',
    'value="{{item.sets}}"',
    'value="{{item.reps}}"',
    'value="{{item.distanceMeters}}"',
    'value="{{item.restSeconds}}"'
  ]) {
    assert.ok(planEdit.includes(binding), `训练计划编辑缺少绑定 ${binding}`);
  }
  for (const binding of [
    'form.title',
    'form.attendanceDate',
    'form.locationName',
    'item.phaseLabel',
    'item.studentName',
    'item.statusLabel',
    'item.reason'
  ]) {
    assert.ok(attendance.includes(binding), `考勤管理缺少绑定 ${binding}`);
  }
});

test('F1-D2c 四个页面不得新增账号身份写死或其他权限入口', () => {
  for (const page of Object.keys(PAGES)) {
    const wxml = read(pageFile(page, 'wxml'));
    assert.ok(!wxml.includes('role-label="教练员"'), `${page} 不应继续写死教练身份`);
    assert.ok(!wxml.includes('role-label="开发者"'), `${page} 不应继续写死开发者身份`);
    assert.ok(!wxml.includes('角色权限设置'), `${page} 不应新增角色权限入口`);
    assert.ok(!wxml.includes('分配角色'), `${page} 不应新增角色分配入口`);
  }
});
