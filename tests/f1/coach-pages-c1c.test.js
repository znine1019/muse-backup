'use strict';

/**
 * F1-C1c｜赛事、通知与训练反馈页面视觉统一回归测试
 *
 * 业务 JS 未修改；测试聚焦模板迁移后的组件、事件、字段与状态语义。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PAGES = ['competition-manage', 'notice-manage', 'feedback-manage'];

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

test('F1-C1c 三个页面已迁移到 jg- 设计语言', () => {
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

test('F1-C1c 页面使用的 jg- 类均已定义', () => {
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

test('F1-C1c 组件注册与路由保持有效', () => {
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
    assert.equal(
      config.usingComponents['jg-empty'],
      '/components/jg-empty/jg-empty',
      `${page} 应注册 jg-empty`
    );
  }
});

test('F1-C1c 赛事页面保留全部表单字段和事件', () => {
  const wxml = read(pageFile('competition-manage', 'wxml'));
  for (const handler of [
    'toggleCreateForm','retry','onFormInput','onEventSelect','onGroupSelect',
    'onCapacityToggle','createCompetition','transition','loadRegistrations',
    'exportRegistrations','updateStatus'
  ]) {
    assert.match(wxml, new RegExp(`bind(?:tap|input|change)="${handler}"`), `缺少赛事事件 ${handler}`);
  }
  for (const field of [
    'title','location','eventDate','registrationStartDate','registrationStartTime',
    'registrationEndDate','registrationEndTime','categoriesText','capacity','requirements','description'
  ]) {
    assert.match(wxml, new RegExp(`data-field="${field}"`), `缺少赛事字段 ${field}`);
  }
});

test('F1-C1c 赛事页面区分内部意向和官方报名状态', () => {
  const wxml = read(pageFile('competition-manage', 'wxml'));
  assert.ok(wxml.includes('registration.statusLabel'), '应展示学生报名意向状态');
  assert.ok(wxml.includes('registration.reviewNote'), '应展示教练处理说明');
  assert.ok(wxml.includes('官方提交'), '应保留官方报名提交操作');
  assert.ok(wxml.includes('不代表主办方审核通过'), '应明确官方提交不等于审核通过');
  assert.ok(wxml.includes('exportRegistrations'), '应保留名单导出入口');
});

test('F1-C1c 通知页面保留创建、范围、发布和详情内容', () => {
  const wxml = read(pageFile('notice-manage', 'wxml'));
  for (const handler of [
    'toggleCreateForm','retry','onFormInput','onCategoryChange','onPriorityChange',
    'onGroupSelect','createNotice','transition'
  ]) {
    assert.match(wxml, new RegExp(`bind(?:tap|input|change)="${handler}"`), `缺少通知事件 ${handler}`);
  }
  for (const binding of [
    'form.title','form.content','categoryOptions','priorityOptions','groups',
    'notices','item.categoryLabel','item.priorityLabel','item.statusLabel',
    'item.groupText','item.timeText','item.content'
  ]) {
    assert.ok(wxml.includes(binding), `通知页面缺少绑定 ${binding}`);
  }
  assert.ok(wxml.includes('isDeveloper'), '应保留开发者全体通知范围说明');
  assert.ok(wxml.includes('visible') || wxml.includes('可见范围'), '应展示通知可见范围');
});

test('F1-C1c 训练反馈页面保留完整反馈与教练评价字段', () => {
  const wxml = read(pageFile('feedback-manage', 'wxml'));
  for (const handler of ['retry', 'onAttentionToggle', 'review']) {
    assert.match(wxml, new RegExp(`bind(?:tap|change)="${handler}"`), `缺少反馈事件 ${handler}`);
  }
  for (const binding of [
    'attentionCount','attentionOnly','feedback','item.studentName','item.trainingGroupId',
    'item.completionLabel','item.rpeText','item.comment','item.coachComment',
    'item.coachCommentVersion','item.needsAttention'
  ]) {
    assert.ok(wxml.includes(binding), `反馈页面缺少绑定 ${binding}`);
  }
  assert.ok(wxml.includes('教练只能查看和评价当前授权训练组'), '应保留反馈权限说明');
});

test('F1-C1c 跨角色页面未写死教练角色标签', () => {
  for (const page of PAGES) {
    const wxml = read(pageFile(page, 'wxml'));
    assert.ok(!wxml.includes('role-label="教练员"'), `${page} 不应写死教练角色标签`);
  }
});

test('F1-C1c coach/developer 权限判断未改变', () => {
  for (const page of PAGES) {
    const js = read(pageFile(page, 'js'));
    assert.ok(js.includes("sessionHasRole(session, 'coach')"), `${page} 应保留教练权限判断`);
    assert.ok(js.includes("sessionHasRole(session, 'developer')"), `${page} 应保留开发者权限判断`);
    assert.ok(js.includes('services/api'), `${page} 应继续通过 API 层取数`);
  }
});

test('F1-C1c 页面没有新增发布或审核以外的越权入口', () => {
  const competition = read(pageFile('competition-manage', 'wxml'));
  const notice = read(pageFile('notice-manage', 'wxml'));
  const feedback = read(pageFile('feedback-manage', 'wxml'));

  assert.ok(!competition.includes('删除赛事'), '赛事页不应新增删除入口');
  assert.ok(!notice.includes('删除通知'), '通知页不应新增删除入口');
  assert.ok(!feedback.includes('删除反馈'), '反馈页不应新增删除入口');
  assert.ok(!feedback.includes('家长'), '反馈管理页不应新增家长访问入口');
});
