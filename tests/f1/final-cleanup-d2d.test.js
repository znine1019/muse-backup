'use strict';

/**
 * F1-D2d｜最终遗留样式与组件注册清理回归测试
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PARENT_WXML = path.join(PROJECT_ROOT, 'miniprogram/pages/parent/parent.wxml');
const PARENT_WXSS = path.join(PROJECT_ROOT, 'miniprogram/pages/parent/parent.wxss');
const PARENT_JS = path.join(PROJECT_ROOT, 'miniprogram/pages/parent/parent.js');
const DEMO_WXML = path.join(PROJECT_ROOT, 'miniprogram/pages/demo/demo.wxml');
const DEMO_JS = path.join(PROJECT_ROOT, 'miniprogram/pages/demo/demo.js');
const DEMO_JSON = path.join(PROJECT_ROOT, 'miniprogram/pages/demo/demo.json');
const APP_JSON = path.join(PROJECT_ROOT, 'miniprogram/app.json');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function matchingBlockEnd(wxml, start) {
  const tokenPattern = /<\/?block\b[^>]*>/g;
  tokenPattern.lastIndex = start;
  let depth = 0;
  let match;

  while ((match = tokenPattern.exec(wxml))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) {
      return tokenPattern.lastIndex;
    }
  }
  throw new Error('未找到匹配的 block 结束标签');
}

function usedClasses(wxml, prefix) {
  const classes = new Set();
  for (const attribute of wxml.match(/class="[^"]*"/g) || []) {
    for (const token of attribute.match(/\b[a-z0-9-]+\b/g) || []) {
      if (token.startsWith(prefix)) {
        classes.add(token);
      }
    }
  }
  return classes;
}

test('F1-D2d 家长计划列表仅保留有效 jg-list 样式类', () => {
  const wxml = read(PARENT_WXML);
  const wxss = read(PARENT_WXSS);
  const appWxss = read(path.join(PROJECT_ROOT, 'miniprogram/app.wxss'));

  assert.ok(!wxml.includes('plan-list'), '未定义的 plan-list 类应删除');
  assert.ok(!wxss.includes('.plan-list'), '不得为废弃装饰类新增无意义 CSS');
  assert.match(wxml, /<view wx:else class="jg-list">/, '训练计划列表应继续使用有效 jg-list');
  assert.match(appWxss, /\.jg-list\s*\{/, 'jg-list 应继续由公共样式提供');

  for (const className of usedClasses(wxml, 'plan-')) {
    assert.match(wxss, new RegExp(`\\.${className}\\s*\\{`), `${className} 应保留实际样式定义`);
  }
});

test('F1-D2d 家长训练计划详情与截断提示保持完整', () => {
  const wxml = read(PARENT_WXML);
  const js = read(PARENT_JS);

  assert.match(wxml, /bindtap="togglePlanDetail"/);
  assert.match(wxml, /data-plan-id="\{\{item\.planId\}\}"/);
  assert.match(wxml, /\{\{expandedPlanId === item\.planId \? '收起' : '查看'\}\}/);
  assert.match(wxml, /wx:if="\{\{expandedPlanId === item\.planId\}\}"/);
  assert.match(wxml, /wx:if="\{\{item\.hasTruncatedItems\}\}"/);
  assert.match(wxml, /这不是完整详情/);
  assert.match(js, /togglePlanDetail\(event\)/);
  assert.match(js, /hasTruncatedItems:\s*itemCount > items\.length/);
});

test('F1-D2d demo 页面组件注册与实际引用一致', () => {
  const config = JSON.parse(read(DEMO_JSON));
  const wxml = read(DEMO_WXML);
  const usingComponents = config.usingComponents;

  assert.deepEqual(Object.keys(usingComponents), ['jg-page-head']);
  assert.equal(usingComponents['jg-page-head'], '/components/jg-page-head/jg-page-head');
  assert.ok(!Object.prototype.hasOwnProperty.call(usingComponents, 'jg-empty'));
  assert.ok(!wxml.includes('<jg-empty'));
  assert.match(wxml, /<jg-page-head/);
});

test('F1-D2d demo 页面路由与原有交互事件保持不变', () => {
  const appConfig = JSON.parse(read(APP_JSON));
  const wxml = read(DEMO_WXML);
  const js = read(DEMO_JS);

  assert.ok(appConfig.pages.includes('pages/demo/demo'));
  const handlers = new Set(
    Array.from(
      wxml.matchAll(/(?:bindtap|bindinput|bindchange|bindsubmit|catchtap|bind:action)="([A-Za-z0-9_]+)"/g),
      (match) => match[1]
    )
  );
  assert.ok(handlers.size >= 10, 'demo 页面应保留完整事件入口');
  for (const handler of handlers) {
    assert.ok(js.includes(`${handler}(`), `demo.js 缺少处理器 ${handler}`);
  }
});

test('F1-D2d BUG-F06 退出区域仍在学生关联分支之外', () => {
  const wxml = read(PARENT_WXML);
  const accountHeading = wxml.indexOf('账户与安全');
  const logout = wxml.indexOf('bindtap="goHome"');
  const studentsBranch = wxml.indexOf('<block wx:if="{{!loading && students.length}}">');
  const studentsBranchEnd = matchingBlockEnd(wxml, studentsBranch);

  assert.ok(accountHeading > studentsBranchEnd, '退出区域不得重新放回 students.length 分支');
  assert.ok(logout > accountHeading, '退出事件应位于账户与安全区域内');
  assert.equal((wxml.match(/账户与安全/g) || []).length, 1);
  assert.equal((wxml.match(/bindtap="goHome"/g) || []).length, 1);
});

test('F1-D2d 家长只读视觉和原交互入口保持', () => {
  const wxml = read(PARENT_WXML);
  const js = read(PARENT_JS);

  assert.ok(!wxml.includes('<button'));
  assert.ok(!wxml.includes('jg-btn'));
  assert.ok(!wxml.includes('jg-btn-accent'));
  assert.ok(wxml.includes('id="sec-account"'));
  assert.ok(wxml.includes('scroll-into-view="{{scrollIntoView}}"'));

  for (const [handler, binding] of [
    ['onJumpTap', 'bindtap'],
    ['togglePlanDetail', 'bindtap'],
    ['onStudentChange', 'bindchange'],
    ['goHome', 'bindtap']
  ]) {
    assert.match(wxml, new RegExp(`${binding}="${handler}"`));
    assert.ok(js.includes(`${handler}(`), `parent.js 缺少处理器 ${handler}`);
  }
});

test('F1-D2d 家长与 demo 页面四文件及路由均保持完整', () => {
  const appConfig = JSON.parse(read(APP_JSON));
  for (const route of ['pages/parent/parent', 'pages/demo/demo']) {
    assert.ok(appConfig.pages.includes(route), `${route} 应保持注册`);
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(fs.existsSync(path.join(PROJECT_ROOT, `miniprogram/${route}.${extension}`)));
    }
  }
});
