'use strict';

/**
 * 阶段7-1 / 7-2 结构校验
 * 校验 F1 融合设计系统落地、三个工作台样板、真实数据绑定与模拟数据隔离。
 * 本脚本只做静态检查，不执行云端部署，也不写入任何数据。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
let passed = 0;

function check(condition, message) {
  if (condition) {
    passed += 1;
  } else {
    errors.push(message);
  }
}

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(absolute(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

/* ---------- 1. 文件存在性 ---------- */
for (const file of [
  'miniprogram/app.wxss',
  'miniprogram/components/jg-page-head/jg-page-head.js',
  'miniprogram/components/jg-page-head/jg-page-head.json',
  'miniprogram/components/jg-page-head/jg-page-head.wxml',
  'miniprogram/components/jg-page-head/jg-page-head.wxss',
  'miniprogram/components/jg-empty/jg-empty.js',
  'miniprogram/components/jg-empty/jg-empty.json',
  'miniprogram/components/jg-empty/jg-empty.wxml',
  'miniprogram/components/jg-empty/jg-empty.wxss',
  'miniprogram/components/trend-chart/trend-chart.js',
  'miniprogram/pages/student/student.js',
  'miniprogram/pages/student/student.json',
  'miniprogram/pages/student/student.wxml',
  'miniprogram/pages/student/student.wxss',
  'miniprogram/pages/coach/coach.js',
  'miniprogram/pages/coach/coach.json',
  'miniprogram/pages/coach/coach.wxml',
  'miniprogram/pages/coach/coach.wxss',
  'miniprogram/pages/admin/admin.js',
  'miniprogram/pages/admin/admin.json',
  'miniprogram/pages/admin/admin.wxml',
  'miniprogram/pages/admin/admin.wxss',
  'docs/ui-phase7/F1_融合设计系统与交互规范.md'
]) {
  check(exists(file), `阶段7文件存在：${file}`);
}

/* ---------- 2. 设计令牌与样式兼容 ---------- */
const appWxss = readText('miniprogram/app.wxss');

for (const token of [
  '#103A6B', // 品牌主色
  '#00A7C4', // 竞技青
  '#F2711C', // 能量橙
  '#0F7B5A', // 成功
  '#B45309', // 警告
  '#C0392B', // 错误
  '#F2F5F9', // 页面背景
  '#0F3563' // 深蓝竞技数据卡
]) {
  check(appWxss.includes(token), `设计令牌已定义：${token}`);
}

for (const className of [
  '.jg-page',
  '.jg-h1',
  '.jg-card',
  '.jg-data-card',
  '.jg-kpi',
  '.jg-dstrip',
  '.jg-chip',
  '.jg-list',
  '.jg-todo',
  '.jg-btn',
  '.jg-prog',
  '.jg-note',
  '.jg-skeleton',
  '.jg-state-err',
  '.jg-safe-bottom'
]) {
  check(appWxss.includes(className), `jg 设计系统类已定义：${className}`);
}

check(appWxss.includes('--jg-touch: 88rpx'), '触控目标令牌为 88rpx（约 44px）');
check(
  /\.jg-body\s*\{[^}]*font-size:\s*27rpx/.test(appWxss),
  '正文最小字号为 27rpx（约 14px）'
);

/* 旧公共样式必须保留，未改造的 25 个页面继续可用 */
for (const legacy of [
  '.container',
  '.button-primary',
  '.button-secondary',
  '.button-danger',
  '.form-card',
  '.field-label',
  '.list-item',
  '.section-title',
  '.empty'
]) {
  check(appWxss.includes(legacy), `旧公共样式保留：${legacy}`);
}

/* ---------- 3. 页面注册与组件声明 ---------- */
const appConfig = JSON.parse(readText('miniprogram/app.json'));
for (const page of [
  'pages/student/student',
  'pages/coach/coach',
  'pages/admin/admin'
]) {
  check(appConfig.pages.includes(page), `app.json 已声明工作台页面：${page}`);
}
check(
  appConfig.pages.length >= 28,
  `页面总数未减少（当前 ${appConfig.pages.length} 个）`
);

for (const page of ['student', 'coach', 'admin']) {
  const config = JSON.parse(readText(`miniprogram/pages/${page}/${page}.json`));
  check(
    config.usingComponents && config.usingComponents['jg-page-head'],
    `${page} 已注册 jg-page-head 组件`
  );
  check(
    config.usingComponents && config.usingComponents['jg-empty'],
    `${page} 已注册 jg-empty 组件`
  );
  check(
    config.enablePullDownRefresh === true,
    `${page} 工作台支持下拉刷新`
  );
}

/* ---------- 4. 入口可点击性（历史阶段入口不得丢失） ---------- */
const REQUIRED_ENTRIES = {
  'miniprogram/pages/student/student.wxml': [
    'goPlans',
    'goAttendance',
    'goCompetitions',
    'goNotices',
    'goFeedback',
    'goStatistics'
  ],
  'miniprogram/pages/coach/coach.wxml': [
    'goPlans',
    'goAttendanceManage',
    'goPerformanceReview',
    'goStatsWorkbench',
    'goCompetitionManage',
    'goNoticeManage',
    'goFeedbackManage'
  ],
  'miniprogram/pages/admin/admin.wxml': [
    'goPlans',
    'goAttendanceManage',
    'goPerformanceReview',
    'goStatsWorkbench',
    'goCompetitionManage',
    'goNoticeManage',
    'goFeedbackManage',
    'goDemoReport'
  ]
};
for (const [file, handlers] of Object.entries(REQUIRED_ENTRIES)) {
  const source = readText(file);
  for (const handler of handlers) {
    check(source.includes(handler), `${file} 已提供入口：${handler}`);
  }
}
check(
  readText('miniprogram/pages/admin/admin.wxml').includes('wx:if="{{demoAvailable}}"'),
  'DEMO 预览入口受环境开关控制'
);

/* ---------- 5. 模拟数据隔离：正式页面不得出现 F1 原型演示数据 ---------- */
const DEMO_LITERALS = [
  '11.82',
  '94.2',
  '16:30',
  '乔格田径场',
  '陈雨桐',
  '赵子墨',
  '周可欣',
  '训练反馈平均 RPE 7.2',
  '报名中 1 场'
];
for (const file of [
  'miniprogram/pages/student/student.wxml',
  'miniprogram/pages/coach/coach.wxml',
  'miniprogram/pages/admin/admin.wxml'
]) {
  const source = readText(file);
  for (const literal of DEMO_LITERALS) {
    check(
      !source.includes(literal),
      `${file} 未硬编码原型演示数据：${literal}`
    );
  }
}

/* ---------- 6. 真实接口复用（不得新增后端） ---------- */
const studentJs = readText('miniprogram/pages/student/student.js');
for (const method of [
  'api.getProfile()',
  'api.getStudentTodayAttendance()',
  'api.getMyStatistics(',
  'api.listStudentNotices('
]) {
  check(studentJs.includes(method), `学生工作台复用现有接口：${method}`);
}

const coachJs = readText('miniprogram/pages/coach/coach.js');
for (const method of [
  'api.listManageAttendanceSessions(',
  'api.getAttendanceRoster(',
  'api.listPendingLeaves()',
  'api.listPendingPerformances()',
  'api.listManagedFeedback(',
  'api.listManageCompetitions(',
  'api.listPendingRegistrations()'
]) {
  check(coachJs.includes(method), `教练工作台复用现有接口：${method}`);
}

const adminJs = readText('miniprogram/pages/admin/admin.js');
for (const method of [
  'api.healthCheck()',
  'api.listUsers()',
  'api.listAllTrainingGroups()',
  'api.listPendingRegistrations()',
  'api.listPendingPerformances()',
  'api.listPendingLeaves()'
]) {
  check(adminJs.includes(method), `开发者工作台复用现有接口：${method}`);
}

/* 业务写入必须经过二次确认 */
for (const [file, source] of [
  ['coach', coachJs],
  ['admin', adminJs]
]) {
  check(
    source.includes('wx.showModal'),
    `${file} 工作台的真实写入操作保留二次确认`
  );
}

/* 开发者角色文案不得出现教练端标识 */
const adminWxml = readText('miniprogram/pages/admin/admin.wxml');
check(!/\bCOACH\b/.test(adminWxml), '开发者工作台不包含 COACH 模块名');
check(!/教练端/.test(adminWxml), '开发者工作台不包含“教练端”文案');
check(adminWxml.includes('role-label="开发者"'), '开发者工作台使用开发者角色标识');

/* 三端均不重复页面顶部英文模块名 */
for (const file of [
  'miniprogram/pages/student/student.wxml',
  'miniprogram/pages/coach/coach.wxml',
  'miniprogram/pages/admin/admin.wxml'
]) {
  const source = readText(file);
  check(!/\b(COACH|STUDENT|DEVELOPER|ATTENDANCE|STATISTICS)\b/.test(source), `${file} 已移除英文模块名`);
}

/* ---------- 7. 业务保护：阶段7不得触碰后端与契约 ---------- */
const cloudTouchedFiles = [
  'cloudfunctions/api/index.js',
  'cloudfunctions/api/actions/statistics.js',
  'cloudfunctions/api/actions/attendance.js'
];
for (const file of cloudTouchedFiles) {
  check(exists(file), `云函数文件仍存在：${file}`);
}
check(
  readText('miniprogram/utils/session.js').includes('ROLE_ROUTES'),
  '角色路由表保持不变'
);

/* ---------- 8. JSON 配置检查 ---------- */
for (const file of [
  'miniprogram/app.json',
  'miniprogram/pages/student/student.json',
  'miniprogram/pages/coach/coach.json',
  'miniprogram/pages/admin/admin.json',
  'miniprogram/components/jg-page-head/jg-page-head.json',
  'miniprogram/components/jg-empty/jg-empty.json',
  'miniprogram/components/trend-chart/trend-chart.json',
  'project.config.json'
]) {
  let parsed = null;
  try {
    parsed = JSON.parse(readText(file));
  } catch (error) {
    parsed = null;
  }
  check(parsed !== null, `JSON 配置可解析：${file}`);
}

/* ---------- 9. 组件注册引用路径检查 ---------- */
for (const page of ['student', 'coach', 'admin']) {
  const config = JSON.parse(readText(`miniprogram/pages/${page}/${page}.json`));
  for (const componentPath of Object.values(config.usingComponents || {})) {
    /* usingComponents 使用小程序根路径（/components/...），需补上 miniprogram/ 前缀 */
    const relative = `miniprogram/${componentPath.replace(/^\//, '')}`;
    check(
      ['js', 'json', 'wxml', 'wxss'].every((ext) => exists(`${relative}.${ext}`)),
      `${page} 组件文件完整：${componentPath}`
    );
  }
}

if (errors.length) {
  console.error('阶段7结构校验未通过：');
  for (const error of errors) {
    console.error(` - ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`阶段7结构校验通过，共 ${passed} 项。`);
  console.log('本校验不执行云端部署、集合变更或业务数据写入。');
}
