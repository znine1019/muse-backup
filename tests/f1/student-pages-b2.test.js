'use strict';

/**
 * F1-B2｜学生端剩余正式业务页面视觉统一回归测试
 *
 * 覆盖 7 个页面：运动数据报告、训练统计、成绩排行榜、考勤排行榜、
 * 赛事意向、俱乐部通知、个人档案。
 *
 * 关注点：
 *   1. 已迁移到 jg- 设计语言且不再残留遗留青绿；
 *   2. 组件注册（含 trend-chart）与路由仍然有效；
 *   3. 每个页面的业务入口、事件绑定、关键数据绑定与口径说明一个都没少；
 *   4. 跨角色共用的页面不得写死“学生”角色标签；
 *   5. 业务 JS 未被改动。
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

/* 本轮迁移的 7 个页面 */
const PAGES = [
  'student-report',
  'student-statistics',
  'performance-leaderboard',
  'attendance-statistics',
  'student-competitions',
  'student-notices',
  'profile-edit'
];

/* 学生专有页面（可以带“学生”角色标签）；共用页面不得写死角色 */
const STUDENT_ONLY_PAGES = [
  'student-statistics',
  'student-competitions',
  'student-notices',
  'profile-edit'
];

/* 教练/开发者也会使用的共用页面 */
const SHARED_PAGES = ['student-report', 'performance-leaderboard', 'attendance-statistics'];

/* 每页必须保留的事件处理器（来自迁移前的模板绑定） */
const REQUIRED_HANDLERS = {
  'student-report': ['onEventChange', 'reload'],
  'student-statistics': [
    'onPeriodTypeChange',
    'onYearChange',
    'onMonthChange',
    'onQuarterChange',
    'goPerformanceLeaderboard',
    'goAttendanceStatistics',
    'goReport',
    'retry'
  ],
  'performance-leaderboard': [
    'onEventChange',
    'onGroupChange',
    'onPeriodTypeChange',
    'onYearChange',
    'onMonthChange',
    'onQuarterChange',
    'retry'
  ],
  'attendance-statistics': [
    'onGroupChange',
    'onPeriodTypeChange',
    'onYearChange',
    'onMonthChange',
    'onQuarterChange',
    'retry'
  ],
  'student-competitions': [
    'toggleIntentForm',
    'onItemChange',
    'onContactNoteInput',
    'submitIntent',
    'cancelIntent',
    'retry'
  ],
  'student-notices': ['onCategoryChange', 'onUnreadToggle', 'toggleNotice', 'markRead', 'retry'],
  'profile-edit': [
    'onPrimaryEventChange',
    'onSecondaryEventChange',
    'onFieldInput',
    'onTargetEventChange',
    'onExamGoalInput',
    'saveProfile',
    'addMeasurement'
  ]
};

const LEGACY_TOKENS = ['#123C4D', '#207788', '#437A86', '#E9F6F8', '#10263C', '#718493'];

const LEGACY_CLASSES = new Set([
  'container',
  'brand',
  'title',
  'sub',
  'card',
  'card-title',
  'pill',
  'notice',
  'button-primary',
  'button-secondary',
  'button-danger',
  'button-row',
  'field',
  'field-label',
  'input',
  'picker-field',
  'textarea',
  'muted',
  'empty',
  'tag',
  'list-item',
  'list-title',
  'list-meta',
  'section-title',
  'section-sub',
  'overview-grid',
  'overview-item',
  'overview-label',
  'overview-value',
  'ranking-row',
  'rank-number',
  'rank-main'
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

/* ------------------------------------------------------------ 视觉迁移 */

test('F1-B2 七个学生页面已迁移到 jg- 设计语言且无遗留青绿', () => {
  for (const page of PAGES) {
    const wxml = read(pageFile(page, 'wxml'));
    const wxss = read(pageFile(page, 'wxss'));

    assert.match(wxml, /class="jg-page/, `${page} 根容器应使用 jg-page`);
    assert.match(wxml, /<jg-page-head/, `${page} 应使用统一页头组件`);

    for (const token of classTokens(wxml)) {
      assert.ok(!LEGACY_CLASSES.has(token), `${page}.wxml 残留遗留类 .${token}`);
    }

    for (const token of LEGACY_TOKENS) {
      assert.ok(!wxml.includes(token), `${page}.wxml 残留遗留色值 ${token}`);
      assert.ok(!wxss.includes(token), `${page}.wxss 残留遗留色值 ${token}`);
    }
    assert.ok(!/#F4F7FA/i.test(wxml + wxss), `${page} 不应再使用旧页面底色`);
  }
});

test('F1-B2 组件注册与路由仍然有效（含 trend-chart）', () => {
  const pages = JSON.parse(read('miniprogram/app.json')).pages;

  for (const page of PAGES) {
    const config = JSON.parse(read(pageFile(page, 'json')));
    const wxml = read(pageFile(page, 'wxml'));

    assert.equal(
      config.usingComponents['jg-page-head'],
      '/components/jg-page-head/jg-page-head',
      `${page} 应注册 jg-page-head`
    );
    assert.ok(
      pages.includes(`pages/${page}/${page}`),
      `${page} 必须在 app.json 中注册`
    );

    /* 模板里用到的自定义组件都必须注册，否则运行时不会渲染 */
    for (const tag of ['jg-page-head', 'jg-empty', 'trend-chart']) {
      if (wxml.includes(`<${tag}`)) {
        assert.ok(
          config.usingComponents[tag],
          `${page} 使用了 <${tag}> 但未在 json 中注册`
        );
      }
    }
  }
});

test('F1-B2 页面使用的 jg- 类全部有定义', () => {
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
    for (const token of classTokens(read(pageFile(page, 'wxml')))) {
      if (token.startsWith('jg-')) {
        assert.ok(defined.has(token), `${page}.wxml 使用了未定义的样式 .${token}`);
      }
    }
  }
});

test('F1-B2 跨角色共用页面不写死角色标签（避免把教练/开发者标成学生）', () => {
  for (const page of SHARED_PAGES) {
    const wxml = read(pageFile(page, 'wxml'));
    assert.ok(
      !/role-label="学生"/.test(wxml),
      `${page} 同时供教练/开发者使用，不得写死 role-label="学生"`
    );
  }
  /* 学生专有页面仍应明确标注角色 */
  for (const page of STUDENT_ONLY_PAGES) {
    const wxml = read(pageFile(page, 'wxml'));
    assert.match(wxml, /role-label="学生"/, `${page} 应标注学生角色`);
  }
});

/* ------------------------------------------------------- 业务入口保留 */

test('F1-B2 每页原有事件处理器与关键绑定全部保留', () => {
  for (const page of PAGES) {
    const wxml = read(pageFile(page, 'wxml'));
    for (const handler of REQUIRED_HANDLERS[page]) {
      assert.match(
        wxml,
        new RegExp(`bind(?:tap|input|change|submit)="${handler}"|bind:[a-z]+="${handler}"`),
        `${page} 缺少事件绑定 ${handler}`
      );
    }
  }
});

test('F1-B2 各页关键数据绑定与口径说明保持不变', () => {
  /* 运动报告：概览 + 三条趋势 + PB + 目标 + 阶段变化 */
  const report = read(pageFile('student-report', 'wxml'));
  for (const binding of [
    '{{overview.pbText}}',
    '{{heightSeries}}',
    '{{weightSeries}}',
    '{{selectedSeries}}',
    '{{report.personalBests}}',
    'report.targetComparison',
    '{{report.stageChanges}}',
    '{{isDemoMode}}',
    '{{demoMarker}}'
  ]) {
    assert.ok(report.includes(binding), `运动报告缺少绑定 ${binding}`);
  }

  /* 训练统计：周期筛选 + 考勤/成绩/反馈三类统计 */
  const stats = read(pageFile('student-statistics', 'wxml'));
  for (const binding of [
    '{{periodTypeOptions}}',
    '{{yearOptions}}',
    '{{monthOptions}}',
    '{{quarterOptions}}',
    '{{data.attendanceRateText}}',
    '{{data.performance.approvedCount}}',
    '{{data.personalBests}}',
    '{{data.latestPerformances}}',
    'data.feedback.averageRpe',
    '{{rpeSeries}}'
  ]) {
    assert.ok(stats.includes(binding), `训练统计缺少绑定 ${binding}`);
  }

  /* 成绩排行榜：排名 + 项目 + 成绩 + 训练组 + 教练 + 历史PB */
  const ranking = read(pageFile('performance-leaderboard', 'wxml'));
  for (const binding of [
    '{{item.rank}}',
    '{{item.studentName}}',
    '{{item.valueText}}',
    '{{item.trainingGroupNames',
    '{{item.coachNames',
    '{{item.historicalText}}',
    '{{item.isSelf'
  ]) {
    assert.ok(ranking.includes(binding), `成绩排行榜缺少绑定 ${binding}`);
  }

  /* 考勤排行榜：出勤率 + 样本门槛 + 名次 */
  const attendance = read(pageFile('attendance-statistics', 'wxml'));
  for (const binding of [
    '{{summary.attendanceRateText}}',
    '{{summary.validAttendance}}',
    '{{dataQuality.minSampleSessions}}',
    '{{item.rankText}}',
    '{{item.sampleSufficient'
  ]) {
    assert.ok(attendance.includes(binding), `考勤排行缺少绑定 ${binding}`);
  }

  /* 赛事意向：赛事信息 + 多选项目 + 意向状态 + 取消 */
  const competitions = read(pageFile('student-competitions', 'wxml'));
  for (const binding of [
    '{{item.registrationStartAt}}',
    '{{item.registrationEndAt}}',
    '{{item.phaseLabel}}',
    '{{item.itemOptions}}',
    '{{item.registrationStatusLabel}}',
    '{{contactNote}}',
    '{{intents}}',
    '{{item.canCancel}}'
  ]) {
    assert.ok(competitions.includes(binding), `赛事意向缺少绑定 ${binding}`);
  }

  /* 通知：分类筛选 + 未读 + 详情正文 + 标记已读 */
  const notices = read(pageFile('student-notices', 'wxml'));
  for (const binding of [
    '{{categoryOptions}}',
    '{{unreadOnly}}',
    '{{unreadCount}}',
    '{{notice.isRead',
    '{{detail.content}}',
    '{{markingId'
  ]) {
    assert.ok(notices.includes(binding), `通知页缺少绑定 ${binding}`);
  }

  /* 个人档案：专项 + 副项 + 训练经历 + 体考目标 + 身体指标 */
  const profile = read(pageFile('profile-edit', 'wxml'));
  for (const binding of [
    '{{primaryEventIndex}}',
    '{{secondaryEvents}}',
    '{{trainingExperienceSummary}}',
    '{{targetEventOptions}}',
    '{{examGoal.targetValue}}',
    '{{examGoal.examYear}}',
    '{{examGoal.targetSchool}}',
    '{{measurementHeight}}',
    '{{measurementWeight}}',
    '{{measurements}}'
  ]) {
    assert.ok(profile.includes(binding), `个人档案缺少绑定 ${binding}`);
  }
});

test('F1-B2 统计与考勤口径说明未被改动', () => {
  assert.ok(
    read(pageFile('student-statistics', 'wxml')).includes('未签到不等同于已核实无故缺勤'),
    '训练统计应保留出勤口径说明'
  );
  assert.ok(
    read(pageFile('attendance-statistics', 'wxml')).includes('未签到不等同于已核实无故缺勤'),
    '考勤排行应保留出勤口径说明'
  );
  assert.ok(
    read(pageFile('performance-leaderboard', 'wxml')).includes('并列成绩使用相同名次'),
    '成绩榜应保留并列名次规则说明'
  );
  assert.ok(
    read(pageFile('student-competitions', 'wxml')).includes('不代表主办方审核通过'),
    '赛事页应保留“意向不等于报名成功”的说明'
  );
  assert.ok(
    read(pageFile('student-notices', 'wxml')).includes('撤回或归档通知不会出现在列表中'),
    '通知页应保留可见范围说明'
  );
});

/* ------------------------------------------------------- 组件与业务保护 */

test('F1-B2 趋势图只改容器样式，Canvas 绘制逻辑未改动', () => {
  const wxss = read('miniprogram/components/trend-chart/trend-chart.wxss');
  const js = read('miniprogram/components/trend-chart/trend-chart.js');

  /* 容器/文字已换到统一色板 */
  assert.ok(!/#123c4d|#10263c|#718096/i.test(wxss), '趋势图样式不应残留遗留色值');
  assert.ok(wxss.includes('#0E1A28'), '趋势图标题应使用统一主文字色');

  /* 绘制逻辑仍在，且未引入样式类或接口调用 */
  assert.match(js, /createSelectorQuery/, 'Canvas 绘制逻辑不得丢失');
  assert.match(js, /series/, 'series 数据契约不得丢失');
  assert.ok(!/jg-/.test(js), '趋势图逻辑不应出现样式类名');
});

test('F1-B2 七个页面的业务 JS 未被改动（仍经 services/api 取数）', () => {
  for (const page of PAGES) {
    const js = read(pageFile(page, 'js'));
    assert.ok(
      /require\([^)]*services\/api/.test(js),
      `${page}.js 仍应通过 services/api 取数`
    );
    assert.ok(!/jg-/.test(js), `${page}.js 不应出现样式类名`);
    assert.ok(!/wx\.cloud\.database/.test(js), `${page}.js 不得直连数据库`);
  }
});
