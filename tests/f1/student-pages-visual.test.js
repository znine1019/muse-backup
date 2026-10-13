'use strict';

/**
 * F1-B1｜学生核心业务页面视觉统一回归测试
 *
 * 覆盖四个学生正式页面：训练计划、签到请假、训练反馈、成绩申报。
 * 重点不是"页面好看"，而是证明：
 *   1. 已迁移到 jg- 设计语言（根容器 / 组件 / 无遗留青绿 / 类都有定义）；
 *   2. 原有业务入口、表单控件与数据绑定一个都没少；
 *   3. 路由仍然注册；
 *   4. 业务 JS 未被改动（未把逻辑搬进 WXML）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function pageFile(page, extension) {
  return `miniprogram/pages/${page}/${page}.${extension}`;
}

const PAGES = ['student-plans', 'student-attendance', 'student-feedback', 'performance'];

/* 阶段0—6 遗留青绿体系：迁移后不应再出现在这些页面上 */
const LEGACY_TOKENS = ['#123C4D', '#207788', '#437A86', '#E9F6F8', '#10263C', '#4A6B94', '#718493'];

/* 遗留类名（按 class token 精确匹配） */
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

function classTokens(source) {
  const tokens = [];
  for (const attribute of source.match(/class="[^"]*"/g) || []) {
    const value = attribute.replace(/^class="/, '').replace(/"$/, '');
    const cleaned = value.replace(/\{\{[^}]*\}\}/g, ' ');
    for (const token of cleaned.split(/\s+/)) {
      if (token) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

function jgClassesUsed(source) {
  const used = new Set();
  for (const token of classTokens(source)) {
    if (token.startsWith('jg-')) {
      used.add(token);
    }
  }
  return used;
}

/* ------------------------------------------------------------ 视觉迁移 */

test('F1-B1 四个学生页面已迁移到 jg- 设计语言', () => {
  for (const page of PAGES) {
    const wxml = read(pageFile(page, 'wxml'));

    assert.match(wxml, /class="jg-page/, `${page} 根容器应使用 jg-page`);
    assert.match(wxml, /<jg-page-head/, `${page} 应使用统一页头组件`);
    assert.match(wxml, /<jg-empty/, `${page} 应使用统一空状态组件`);

    /* 不再出现遗留类 */
    for (const token of classTokens(wxml)) {
      assert.ok(!LEGACY_CLASSES.has(token), `${page}.wxml 残留遗留类 .${token}`);
    }

    /* 不再出现遗留青绿与旧页面底 */
    const wxss = read(pageFile(page, 'wxss'));
    for (const token of LEGACY_TOKENS) {
      assert.ok(!wxml.includes(token), `${page}.wxml 残留遗留色值 ${token}`);
      assert.ok(!wxss.includes(token), `${page}.wxss 残留遗留色值 ${token}`);
    }
    assert.ok(!/#F4F7FA/i.test(wxml + wxss), `${page} 不应再使用旧页面底色`);
  }
});

test('F1-B1 四个页面注册了公共组件且路由仍然有效', () => {
  const pages = JSON.parse(read('miniprogram/app.json')).pages;

  for (const page of PAGES) {
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
    assert.ok(
      pages.includes(`pages/${page}/${page}`),
      `${page} 必须在 app.json 中注册`
    );
  }
});

test('F1-B1 页面使用的 jg- 类全部有定义', () => {
  const defined = new Set();
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(full);
      } else if (entry.name.endsWith('.wxss')) {
        for (const match of fs.readFileSync(full, 'utf8').matchAll(/\.(jg-[a-z0-9-]+)/g)) {
          defined.add(match[1]);
        }
      }
    }
  };
  collect(path.join(PROJECT_ROOT, 'miniprogram'));

  for (const page of PAGES) {
    for (const token of jgClassesUsed(read(pageFile(page, 'wxml')))) {
      assert.ok(defined.has(token), `${page}.wxml 使用了未定义的样式 .${token}`);
    }
  }
});

/* ------------------------------------------------------- 业务入口保留 */

test('F1-B1 训练计划：范围切换、重试与详情展开入口全部保留', () => {
  const wxml = read(pageFile('student-plans', 'wxml'));

  assert.match(wxml, /bindtap="onScopeTap"/, '范围切换入口不得丢失');
  assert.match(wxml, /bindtap="retry"/, '重试入口不得丢失');
  assert.match(wxml, /bindtap="toggleDetail"/, '查看/收起详情入口不得丢失');

  /* 原有数据绑定必须保持 */
  for (const binding of ['{{scopes}}', '{{plans}}', '{{total}}', '{{truncated}}', '{{expandedPlanId', '{{item.dateText}}', '{{item.statusLabel}}']) {
    assert.ok(wxml.includes(binding), `训练计划缺少绑定 ${binding}`);
  }
  /* 计划内容明细字段不能少 */
  for (const field of ['planItem.name', 'planItem.categoryLabel', 'planItem.eventName', 'planItem.target', 'planItem.requirementText', 'planItem.notes']) {
    assert.ok(wxml.includes(field), `训练明细缺少字段 ${field}`);
  }
});

test('F1-B1 签到请假：签到、请假提交与撤销入口全部保留', () => {
  const wxml = read(pageFile('student-attendance', 'wxml'));

  for (const handler of ['retry', 'checkIn', 'onLeaveSessionChange', 'onLeaveReasonInput', 'submitLeave', 'cancelLeave']) {
    assert.match(wxml, new RegExp(`bindtap="${handler}"|bindinput="${handler}"|bindchange="${handler}"`), `签到请假缺少 ${handler}`);
  }

  /* 表单控件不得被简化 */
  assert.match(wxml, /<textarea[^>]*bindinput="onLeaveReasonInput"/, '请假原因输入框不得丢失');
  assert.match(wxml, /<picker[^>]*bindchange="onLeaveSessionChange"/, '场次选择器不得丢失');
  assert.match(wxml, /loading="\{\{submitting\}\}"/, '提交中的 loading 状态不得丢失');

  /* 出勤统计四个指标与历史记录保持 */
  for (const field of ['summary.checkedIn', 'summary.late', 'summary.leaveApproved', 'summary.pendingVerification', '{{records}}', '{{leaves}}', '{{checkInMessage}}']) {
    assert.ok(wxml.includes(field), `签到请假缺少绑定 ${field}`);
  }
});

test('F1-B1 训练反馈：完成情况、RPE、说明与提交/修改入口全部保留', () => {
  const wxml = read(pageFile('student-feedback', 'wxml'));

  for (const handler of ['retry', 'startFeedback', 'editFeedback', 'onCompletionChange', 'onRpeChange', 'onCommentInput', 'submitFeedback', 'cancelEdit']) {
    assert.match(wxml, new RegExp(`bindtap="${handler}"|bindinput="${handler}"|bindchange="${handler}"`), `训练反馈缺少 ${handler}`);
  }

  assert.match(wxml, /<picker[^>]*bindchange="onCompletionChange"/, '完成情况选择器不得丢失');
  assert.match(wxml, /<slider[^>]*bindchange="onRpeChange"/, 'RPE 滑块不得丢失');
  assert.match(wxml, /<textarea[^>]*bindinput="onCommentInput"/, '反馈说明输入框不得丢失');
  assert.ok(wxml.includes('{{completionOptions[completionIndex].label}}'), '完成情况选项绑定不得丢失');
  assert.ok(wxml.includes('{{history}}'), '反馈历史不得丢失');
});

test('F1-B1 成绩申报：项目选择、数值/日期/说明输入与提交入口全部保留', () => {
  const wxml = read(pageFile('performance', 'wxml'));

  assert.match(wxml, /<picker[^>]*bindchange="onEventChange"/, '项目选择器不得丢失');
  assert.match(wxml, /bindinput="onFieldInput"/, '表单输入处理器不得丢失');
  assert.match(wxml, /bindtap="submitPerformance"/, '提交申报入口不得丢失');

  /* 四个输入控件都要在：项目 / 数值 / 日期 / 说明 */
  assert.ok(wxml.includes('data-field="value"'), '成绩数值输入不得丢失');
  assert.ok(wxml.includes('data-field="achievedAt"'), '取得日期输入不得丢失');
  assert.ok(wxml.includes('data-field="note"'), '成绩说明输入不得丢失');
  assert.ok(wxml.includes('{{events[eventIndex].unit}}'), '单位显示不得丢失');

  /* 审核状态与申报记录保持 */
  assert.ok(wxml.includes('{{item.statusLabel}}'), '审核状态不得丢失');
  assert.ok(wxml.includes('{{performances}}'), '申报记录不得丢失');
});

/* ------------------------------------------------------- 业务逻辑未动 */

test('F1-B1 四个页面的业务 JS 未被改动（仍由 services/api 提供数据）', () => {
  for (const page of PAGES) {
    const js = read(pageFile(page, 'js'));
    assert.ok(
      /require\([^)]*services\/api/.test(js),
      `${page}.js 仍应通过 services/api 取数（说明未把逻辑搬进页面）`
    );
    assert.ok(!/jg-/.test(js), `${page}.js 不应出现样式类名`);
    assert.ok(!/wx\.cloud\.database/.test(js), `${page}.js 不得直连数据库`);
  }
});

test('F1-B1 学生身份校验与可见性提示保持不变', () => {
  for (const page of PAGES) {
    const js = read(pageFile(page, 'js'));
    assert.ok(
      js.includes("sessionHasRole(session, 'student')"),
      `${page} 应保留学生身份校验`
    );
    assert.ok(
      js.includes('getSessionDestination'),
      `${page} 应保留无权访问时的会话跳转`
    );
  }

  /* 训练计划仍明确告知草稿不可见 */
  assert.ok(
    read(pageFile('student-plans', 'wxml')).includes('草稿'),
    '训练计划页面应继续说明草稿不可见'
  );
});
