'use strict';

/**
 * BUG-F06｜家长无有效关联学生时的退出入口可达性回归测试
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PARENT_WXML = path.join(PROJECT_ROOT, 'miniprogram/pages/parent/parent.wxml');
const PARENT_JS = path.join(PROJECT_ROOT, 'miniprogram/pages/parent/parent.js');
const PARENT_ACTIONS = path.join(PROJECT_ROOT, 'cloudfunctions/api/actions/parent.js');

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

function accountCondition(wxml) {
  const match = wxml.match(/<view wx:if="\{\{([^}]+)\}\}" class="jg-sect">/);
  assert.ok(match, '账户与安全区域应具有可验证的 wx:if 条件');
  return match[1];
}

function evaluateCondition(expression, state) {
  const identifiers = Array.from(
    new Set(expression.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [])
  );
  const evaluator = new Function(...identifiers, `return (${expression});`);
  return Boolean(evaluator(...identifiers.map((name) => state[name])));
}

test('BUG-F06 退出区域已移出 students.length 业务分支', () => {
  const wxml = read(PARENT_WXML);
  const branchStart = wxml.indexOf('<block wx:if="{{!loading && students.length}}">');
  assert.ok(branchStart > 0, '应保留有效学生业务分支');

  const branchEnd = matchingBlockEnd(wxml, branchStart);
  const accountStart = wxml.indexOf('<view wx:if="{{!loading}}" class="jg-sect">');
  const headingIndex = wxml.indexOf('账户与安全');
  const logoutIndex = wxml.indexOf('bindtap="goHome"');

  assert.ok(accountStart > branchEnd, '账户与安全区域必须位于学生业务分支之后');
  assert.ok(headingIndex > accountStart, '账户标题应位于退出区域内部');
  assert.ok(logoutIndex > headingIndex, '退出事件应位于账户与安全区域内');
});

test('BUG-F06 无关联学生、待审核和撤销场景均可显示退出入口', () => {
  const expression = accountCondition(read(PARENT_WXML));
  assert.ok(!expression.includes('students.length'), '退出入口不得依赖学生关联数量');

  const scenarios = {
    A_有效关联学生: { loading: false, students: [{ studentUserId: 'stu_1' }], error: '' },
    B_尚未关联学生: { loading: false, students: [], error: '' },
    C_关联等待审核: { loading: false, students: [], error: '' },
    D_关联已撤销: { loading: false, students: [], error: '' },
    E_关联多名有效学生: {
      loading: false,
      students: [{ studentUserId: 'stu_1' }, { studentUserId: 'stu_2' }],
      error: ''
    },
    F_请求失败: { loading: false, students: [], error: '家长工作台加载失败' },
    G_首次加载或非家长拦截: { loading: true, students: [], error: '' }
  };

  for (const [name, state] of Object.entries(scenarios)) {
    const visible = evaluateCondition(expression, state);
    if (name === 'G_首次加载或非家长拦截') {
      assert.equal(visible, false, `${name} 不应在会话识别完成前闪现退出入口`);
    } else {
      assert.equal(visible, true, `${name} 应显示退出入口`);
    }
  }
});

test('BUG-F06 待审核和撤销关系不会进入有效学生列表', () => {
  const source = read(PARENT_ACTIONS);
  const start = source.indexOf('async function listStudents');
  const end = source.indexOf('async function getStudentOverview', start);
  assert.ok(start > 0 && end > start, '应保留 parent.list_students 实现');

  const listStudents = source.slice(start, end);
  assert.match(listStudents, /status:\s*PARENT_LINK_STATUS\.ACTIVE/);
  assert.match(listStudents, /return\s+\{\s*students:\s*\[\]\s*\}/);
});

test('BUG-F06 空关联状态仍保留原有空状态和绑定入口', () => {
  const wxml = read(PARENT_WXML);
  assert.match(wxml, /<block wx:if="\{\{!loading && !students\.length && !error\}\}">/);
  assert.match(wxml, /title="尚未关联学生"/);
  assert.match(wxml, /bind:action="goBind"/);
});

test('BUG-F06 账户与安全区域只渲染一次且保留原退出事件', () => {
  const wxml = read(PARENT_WXML);
  const js = read(PARENT_JS);

  assert.equal((wxml.match(/账户与安全/g) || []).length, 1);
  assert.equal((wxml.match(/bindtap="goHome"/g) || []).length, 1);
  assert.match(js, /goHome\(\)\s*\{/);
  assert.match(js, /clearActiveRole\(\)/);
  assert.match(js, /getApp\(\)\.clearSession\(\)/);
  assert.match(js, /wx\.reLaunch\(\{\s*url:\s*'\/pages\/index\/index'\s*\}\)/);
});

test('BUG-F06 家长只读视觉和原业务交互保持', () => {
  const wxml = read(PARENT_WXML);
  const js = read(PARENT_JS);

  assert.ok(!wxml.includes('<button'));
  assert.ok(!wxml.includes('jg-btn'));
  assert.ok(!wxml.includes('jg-btn-accent'));
  assert.ok(wxml.includes('id="sec-account"'));
  assert.ok(wxml.includes('scroll-into-view="{{scrollIntoView}}"'));

  for (const handler of ['onJumpTap', 'togglePlanDetail', 'onStudentChange', 'goBind', 'goAllFeatures']) {
    assert.ok(
      new RegExp(`bind(?:tap|change)="${handler}"`).test(wxml),
      `缺少家长交互 ${handler}`
    );
    assert.ok(js.includes(`${handler}(`), `缺少家长处理器 ${handler}`);
  }
});

test('BUG-F06 非家长会话仍由原角色判断拦截', () => {
  const js = read(PARENT_JS);
  const wxml = read(PARENT_WXML);

  assert.match(js, /sessionHasRole\(session,\s*'parent'\)/);
  assert.match(js, /wx\.reLaunch\(\{\s*url:\s*getSessionDestination\(session\)\.url\s*\}\)/);
  assert.match(js, /loading:\s*true/);
  assert.equal(evaluateCondition(accountCondition(wxml), { loading: true }), false);
});
