'use strict';

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

for (const file of [
  'cloudfunctions/api/actions/statistics.js',
  'cloudfunctions/api/lib/statistics-builder.js',
  'cloudfunctions/api/lib/attendance-rules.js',
  'tests/phase6/helpers.js',
  'tests/phase6/statistics-actions.test.js',
  'tests/phase6/statistics-pages.test.js',
  'miniprogram/pages/student-statistics/student-statistics.js',
  'miniprogram/pages/student-statistics/student-statistics.json',
  'miniprogram/pages/student-statistics/student-statistics.wxml',
  'miniprogram/pages/student-statistics/student-statistics.wxss',
  'miniprogram/pages/performance-leaderboard/performance-leaderboard.js',
  'miniprogram/pages/performance-leaderboard/performance-leaderboard.json',
  'miniprogram/pages/performance-leaderboard/performance-leaderboard.wxml',
  'miniprogram/pages/performance-leaderboard/performance-leaderboard.wxss',
  'miniprogram/pages/attendance-statistics/attendance-statistics.js',
  'miniprogram/pages/attendance-statistics/attendance-statistics.json',
  'miniprogram/pages/attendance-statistics/attendance-statistics.wxml',
  'miniprogram/pages/attendance-statistics/attendance-statistics.wxss',
  'miniprogram/pages/stats-workbench/stats-workbench.js',
  'miniprogram/pages/stats-workbench/stats-workbench.json',
  'miniprogram/pages/stats-workbench/stats-workbench.wxml',
  'miniprogram/pages/stats-workbench/stats-workbench.wxss',
  'docs/阶段6_统计报表与排行榜系统设计.md'
]) {
  check(exists(file), `阶段6文件存在：${file}`);
}

const appConfig = JSON.parse(readText('miniprogram/app.json'));
for (const page of [
  'pages/student-statistics/student-statistics',
  'pages/performance-leaderboard/performance-leaderboard',
  'pages/attendance-statistics/attendance-statistics',
  'pages/stats-workbench/stats-workbench'
]) {
  check(appConfig.pages.includes(page), `app.json 已声明阶段6页面：${page}`);
}

const statistics = readText('cloudfunctions/api/actions/statistics.js');
for (const route of [
  'statistics.get_meta',
  'statistics.get_my_overview',
  'statistics.get_manage_overview',
  'leaderboard.performance',
  'leaderboard.attendance',
  'export.performance_rows',
  'export.attendance_rows'
]) {
  check(statistics.includes(route), `阶段6接口已注册：${route}`);
}
check(statistics.includes('EXPORT_RANGE_TOO_LARGE'), '导出超限返回明确错误');
check(statistics.includes('maskStudentName'), '学生榜单支持姓名脱敏');
check(statistics.includes('membershipHistoryNote'), '历史成员限制有明确说明');

const constants = readText('cloudfunctions/api/lib/constants.js');
for (const token of [
  'PERFORMANCE_RECORDS',
  'ATTENDANCE_RECORDS',
  'LEAVE_REQUESTS',
  'TRAINING_FEEDBACK'
]) {
  check(constants.includes(token), `统计复用现有集合常量：${token}`);
}
check(!statistics.includes('COLLECTIONS.' + 'STATISTICS'), '未新增统计缓存集合');

const repository = readText('cloudfunctions/api/lib/repository.js');
for (const method of [
  'listMembershipsForGroups',
  'listAttendanceRecordsBySessions',
  'listApprovedPerformanceRecordsForStatistics',
  'getUsersMap'
]) {
  check(repository.includes(method), `仓储层已提供统计查询：${method}`);
}

const dates = readText('cloudfunctions/api/lib/dates.js');
for (const token of ['periodRange', 'previousPeriodRange', 'dateOnlyFromValue']) {
  check(dates.includes(token), `日期工具已提供：${token}`);
}
const attendanceRules = readText('cloudfunctions/api/lib/attendance-rules.js');
for (const token of [
  'sessionPhase',
  'deriveStudentStatus',
  'buildAttendanceStatistics',
  'buildAttendanceDetailRows',
  'membershipHistoryEstimated'
]) {
  check(attendanceRules.includes(token), `考勤规则已提供：${token}`);
}
const builder = readText('cloudfunctions/api/lib/statistics-builder.js');
for (const token of [
  'buildPerformanceLeaderboard',
  'buildPerformanceRows',
  'buildPerformanceSummary',
  'buildFeedbackSummary'
]) {
  check(builder.includes(token), `统计构建器已提供：${token}`);
}

const apiService = readText('miniprogram/services/api.js');
for (const method of [
  'getStatisticsMeta',
  'getMyStatistics',
  'getManageStatistics',
  'getPerformanceLeaderboard',
  'getAttendanceLeaderboard',
  'exportPerformanceRows',
  'exportAttendanceRows'
]) {
  check(apiService.includes(method), `前端 API 已接入：${method}`);
}

for (const file of [
  'miniprogram/pages/student/student.wxml',
  'miniprogram/pages/coach/coach.wxml',
  'miniprogram/pages/admin/admin.wxml'
]) {
  const source = readText(file);
  check(source.includes('goStatistics') || source.includes('goStatsWorkbench'), `${file} 已提供阶段6入口`);
}
check(
  readText('miniprogram/pages/stats-workbench/stats-workbench.wxml').includes('导出正式成绩XLSX'),
  '教练/开发者工作台提供成绩导出'
);
check(
  readText('miniprogram/pages/stats-workbench/stats-workbench.wxml').includes('导出考勤XLSX'),
  '教练/开发者工作台提供考勤导出'
);
check(
  readText('miniprogram/pages/performance-leaderboard/performance-leaderboard.wxml').includes('历史PB'),
  '成绩排行榜区分历史PB'
);
check(
  readText('miniprogram/pages/attendance-statistics/attendance-statistics.wxml').includes('出勤率'),
  '考勤统计页面展示出勤率'
);
check(
  readText('docs/阶段6_统计报表与排行榜系统设计.md').includes('第三方体测仪器'),
  '阶段6文档保留第三方体测永久取消边界'
);

if (errors.length) {
  console.error('阶段6结构校验失败：');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`阶段6结构校验通过，共 ${passed} 项。`);
console.log('本校验不执行云端部署、集合变更或业务数据写入。');
