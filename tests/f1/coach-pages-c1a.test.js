'use strict';

/**
 * F1-C1a｜教练训练计划与考勤页面视觉统一回归测试
 *
 * 本轮不改业务 JS，只验证模板迁移后原有事件、字段和状态入口完整。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PAGES = ['coach-plan-list', 'coach-plan-edit', 'attendance-manage'];

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
      if (token && !token.includes('{') && !token.includes('}')) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

const LEGACY_CLASSES = new Set([
  'container',
  'brand',
  'title',
  'sub',
  'card',
  'card-title',
  'card-sub',
  'pill',
  'notice',
  'action',
  'button-primary',
  'button-secondary',
  'button-danger',
  'button-row',
  'form-card',
  'field',
  'field-label',
  'input',
  'picker-field',
  'textarea',
  'muted',
  'error',
  'success',
  'empty',
  'tag',
  'list-item',
  'list-title',
  'list-meta',
  'section-title',
  'section-sub',
  'row',
  'kpi'
]);

const LEGACY_TOKENS = [
  '#123C4D',
  '#207788',
  '#437A86',
  '#E9F6F8',
  '#10263C',
  '#4A6B94',
  '#718493',
  '#F4F7FA'
];

test('F1-C1a 三个教练页面已迁移到 jg- 设计语言', () => {
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

test('F1-C1a 页面使用的 jg- 类均已定义', () => {
  const defined = new Set();
  const collect = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collect(fullPath);
      } else if (entry.name.endsWith('.wxss')) {
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

test('F1-C1a 组件注册与路由保持有效', () => {
  const appPages = JSON.parse(read('miniprogram/app.json')).pages;
  for (const page of PAGES) {
    const route = `pages/${page}/${page}`;
    assert.ok(appPages.includes(route), `${route} 应保持注册`);

    const config = JSON.parse(read(pageFile(page, 'json')));
    assert.equal(
      config.usingComponents['jg-page-head'],
      '/components/jg-page-head/jg-page-head',
      `${page} 应注册 jg-page-head`
    );
  }

  assert.equal(
    JSON.parse(read(pageFile('coach-plan-list', 'json'))).usingComponents['jg-empty'],
    '/components/jg-empty/jg-empty'
  );
  assert.equal(
    JSON.parse(read(pageFile('attendance-manage', 'json'))).usingComponents['jg-empty'],
    '/components/jg-empty/jg-empty'
  );
});

test('F1-C1a 训练计划列表原有事件与详情入口完整', () => {
  const wxml = read(pageFile('coach-plan-list', 'wxml'));
  for (const handler of [
    'goCreate',
    'onStatusChange',
    'retry',
    'toggleDetail',
    'goEdit',
    'copyPlan',
    'publishPlan',
    'archivePlan',
    'goHome'
  ]) {
    assert.match(
      wxml,
      new RegExp(`bind(?:tap|change)="${handler}"`),
      `缺少事件 ${handler}`
    );
  }
  for (const binding of [
    '{{plans}}',
    '{{total}}',
    '{{truncated}}',
    '{{expandedPlanId',
    'item.trainingGroupName',
    '{{item.dateText}}',
    '{{item.statusLabel}}',
    '{{item.itemCount}}',
    '{{item.version}}',
    '{{planItem.requirementText}}',
    '{{planItem.notes}}'
  ]) {
    assert.ok(wxml.includes(binding), `训练计划列表缺少绑定 ${binding}`);
  }
});

test('F1-C1a 训练计划编辑器保留全部字段与保存/发布按钮', () => {
  const wxml = read(pageFile('coach-plan-edit', 'wxml'));
  for (const handler of [
    'loadPage',
    'onFieldInput',
    'onGroupChange',
    'onItemCategoryChange',
    'onItemFieldInput',
    'removeItem',
    'addItem',
    'saveDraft',
    'publishPlan',
    'goBack'
  ]) {
    assert.match(
      wxml,
      new RegExp(`bind(?:tap|input|change)="${handler}"`),
      `缺少事件 ${handler}`
    );
  }

  for (const field of [
    'title',
    'startDate',
    'endDate',
    'notes',
    'name',
    'target',
    'sets',
    'reps',
    'distanceMeters',
    'durationSeconds',
    'restSeconds',
    'load'
  ]) {
    assert.match(wxml, new RegExp(`data-field="${field}"`), `缺少字段 ${field}`);
  }

  assert.match(wxml, /bindtap="saveDraft"[^>]*>保存草稿</, '保存草稿入口必须独立存在');
  assert.match(wxml, /bindtap="publishPlan"[^>]*>发布计划</, '发布计划入口必须独立存在');
  assert.match(wxml, /bindtap="addItem"/, '添加训练项入口不得丢失');
  assert.match(wxml, /bindtap="removeItem"/, '删除训练项入口不得丢失');
});

test('F1-C1a 考勤管理保留场次、名单、核实和请假入口', () => {
  const wxml = read(pageFile('attendance-manage', 'wxml'));
  for (const handler of [
    'toggleCreateForm',
    'retry',
    'onGroupChange',
    'onFormInput',
    'createSession',
    'selectSession',
    'manualVerify',
    'reviewLeave'
  ]) {
    assert.match(
      wxml,
      new RegExp(`bind(?:tap|input|change)="${handler}"`),
      `缺少事件 ${handler}`
    );
  }

  for (const field of [
    'attendanceDate',
    'locationName',
    'latitude',
    'longitude',
    'radiusMeters',
    'accuracyThresholdMeters',
    'checkInOpenTime',
    'checkInCloseTime',
    'lateAfterTime'
  ]) {
    assert.match(wxml, new RegExp(`data-field="${field}"`), `缺少考勤字段 ${field}`);
  }

  for (const binding of [
    '{{sessions}}',
    '{{selectedSessionId',
    '{{summary.expected}}',
    '{{summary.checkedIn}}',
    '{{summary.late}}',
    '{{roster}}',
    '{{pendingLeaves}}',
    '{{pendingCount}}'
  ]) {
    assert.ok(wxml.includes(binding), `考勤管理缺少绑定 ${binding}`);
  }
});

test('F1-C1a 空状态、加载态和错误态仍由页面状态驱动', () => {
  for (const page of PAGES) {
    const wxml = read(pageFile(page, 'wxml'));
    assert.match(wxml, /wx:if="\{\{loading\}\}"/, `${page} 应保留加载状态`);
    assert.match(wxml, /jg-state-err/, `${page} 应保留错误状态`);
  }

  assert.match(read(pageFile('coach-plan-list', 'wxml')), /<jg-empty/, '计划列表应保留空状态');
  assert.match(read(pageFile('attendance-manage', 'wxml')), /<jg-empty/, '考勤管理应保留空状态');
});

test('F1-C1a 角色权限与训练组范围逻辑未改变', () => {
  for (const page of ['coach-plan-list', 'coach-plan-edit', 'attendance-manage']) {
    const js = read(pageFile(page, 'js'));
    assert.ok(js.includes("sessionHasRole(session, 'coach')"), `${page} 应保留教练角色校验`);
    assert.ok(js.includes("sessionHasRole(session, 'developer')"), `${page} 应保留开发者合法访问`);
    assert.ok(js.includes('getSessionDestination'), `${page} 应保留无权限跳转`);
    assert.ok(js.includes('services/api'), `${page} 应继续通过 API 层取数`);
  }
});
