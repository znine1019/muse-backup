'use strict';

/**
 * F1-C1b｜教练成绩审核与统计工作台视觉统一回归测试
 *
 * 业务 JS 未修改；本文件验证模板迁移后的组件、事件、字段和跨角色约束。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PAGES = ['coach-performance-review', 'stats-workbench'];

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

test('F1-C1b 两个页面已迁移到 jg- 设计语言', () => {
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

test('F1-C1b 页面使用的 jg- 类均已定义', () => {
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

test('F1-C1b 组件注册与路由保持有效', () => {
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

test('F1-C1b 成绩审核页面保留通过、驳回与错误恢复入口', () => {
  const wxml = read(pageFile('coach-performance-review', 'wxml'));
  for (const handler of ['retry', 'review', 'goHome']) {
    assert.match(wxml, new RegExp(`bindtap="${handler}"`), `缺少事件 ${handler}`);
  }
  assert.match(wxml, /data-decision="approve"/, '缺少审核通过入口');
  assert.match(wxml, /data-decision="reject"/, '缺少审核驳回入口');
  assert.match(wxml, /bindtap="review"[\s\S]*?data-decision="approve"|data-decision="approve"[\s\S]*?bindtap="review"/, '通过操作应调用 review');
  assert.match(wxml, /bindtap="review"[\s\S]*?data-decision="reject"|data-decision="reject"[\s\S]*?bindtap="review"/, '驳回操作应调用 review');
});

test('F1-C1b 成绩审核字段绑定完整', () => {
  const wxml = read(pageFile('coach-performance-review', 'wxml'));
  for (const binding of [
    '{{performances}}',
    '{{pendingCount}}',
    '{{truncated}}',
    'item.studentName',
    'item.groupText',
    'item.eventName',
    'item.value',
    'item.unit',
    'item.achievedAt',
    'item.sourceLabel',
    'item.note',
    'reviewingId',
    '待审核'
  ]) {
    assert.ok(wxml.includes(binding), `成绩审核缺少绑定 ${binding}`);
  }
});

test('F1-C1b 统计工作台保留全部筛选事件', () => {
  const wxml = read(pageFile('stats-workbench', 'wxml'));
  for (const handler of [
    'onGroupChange',
    'onPeriodTypeChange',
    'onYearChange',
    'onMonthChange',
    'onQuarterChange',
    'retry'
  ]) {
    assert.match(
      wxml,
      new RegExp(`bind(?:tap|change)="${handler}"`),
      `缺少统计筛选事件 ${handler}`
    );
  }
});

test('F1-C1b 统计工作台保留指标与口径说明', () => {
  const wxml = read(pageFile('stats-workbench', 'wxml'));
  for (const binding of [
    'overview.scope.groupCount',
    'overview.scope.studentCount',
    'overview.attendance.sessionCounts.valid',
    'overview.performance.approvedCount',
    'overview.attendanceSummary.plannedExpected',
    'overview.attendanceSummary.actualExpected',
    'overview.attendanceSummary.validAttendance',
    'overview.attendanceSummary.attendanceRateText',
    'overview.attendanceSummary.approvedLeave',
    'overview.attendanceSummary.pendingVerification',
    'overview.groupComparison',
    'overview.performance.summary.eventCounts',
    'overview.feedback.total',
    'overview.feedback.attentionCount',
    'overview.feedback.coachReviewed',
    'overview.feedback.averageRpe',
    'overview.dataQuality'
  ]) {
    assert.ok(wxml.includes(binding), `统计工作台缺少绑定 ${binding}`);
  }
});

test('F1-C1b Excel 导出和排行榜入口保持独立', () => {
  const wxml = read(pageFile('stats-workbench', 'wxml'));
  const js = read(pageFile('stats-workbench', 'js'));

  assert.match(wxml, /bindtap="exportPerformance"/, '缺少成绩导出入口');
  assert.match(wxml, /bindtap="exportAttendance"/, '缺少考勤导出入口');
  assert.match(wxml, /bindtap="goPerformanceLeaderboard"/, '缺少成绩排行榜入口');
  assert.match(wxml, /bindtap="goAttendanceStatistics"/, '缺少考勤排行榜入口');
  assert.match(js, /exportPerformance\(\)/, '页面应保留成绩导出方法');
  assert.match(js, /exportAttendance\(\)/, '页面应保留考勤导出方法');
  assert.match(js, /buildXlsxBase64/, '页面应继续使用现有 XLSX 构建逻辑');
});

test('F1-C1b 跨角色页面未写死教练角色标签且权限判断未变', () => {
  for (const page of PAGES) {
    const wxml = read(pageFile(page, 'wxml'));
    const js = read(pageFile(page, 'js'));
    assert.ok(!wxml.includes('role-label="教练员"'), `${page} 不应写死教练角色标签`);
    assert.ok(js.includes("sessionHasRole(session, 'coach')"), `${page} 应保留教练权限判断`);
    assert.ok(js.includes("sessionHasRole(session, 'developer')"), `${page} 应保留开发者权限判断`);
    assert.ok(js.includes('services/api'), `${page} 应继续通过 API 层取数`);
  }
});

test('F1-C1b 不通过前端伪造 BUG-F03 的教练统计字段', () => {
  const wxml = read(pageFile('stats-workbench', 'wxml'));
  assert.ok(!wxml.includes('负责教练：'), '统计页不得新增伪造负责教练展示');
  assert.ok(!wxml.includes('coachCount'), '统计页不得用前端伪造教练人数');
  assert.ok(!wxml.includes('coachNames'), '统计页不得用前端伪造教练姓名');
});
