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
  'cloudfunctions/api/lib/performance-events.js',
  'cloudfunctions/api/actions/performance.js',
  'miniprogram/pages/profile-edit/profile-edit.js',
  'miniprogram/pages/profile-edit/profile-edit.wxml',
  'miniprogram/pages/performance/performance.js',
  'miniprogram/pages/performance/performance.wxml',
  'miniprogram/pages/profile-view/profile-view.js',
  'miniprogram/pages/profile-view/profile-view.wxml'
]) {
  check(exists(file), `阶段2文件存在：${file}`);
}

const appConfig = JSON.parse(readText('miniprogram/app.json'));
for (const page of [
  'pages/profile-edit/profile-edit',
  'pages/performance/performance',
  'pages/profile-view/profile-view'
]) {
  check(appConfig.pages.includes(page), `app.json 已声明阶段2页面：${page}`);
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    check(exists(`miniprogram/${page}${extension}`), `阶段2页面四件套存在：${page}${extension}`);
  }
}

const constants = readText('cloudfunctions/api/lib/constants.js');
check(constants.includes("BODY_MEASUREMENTS: 'body_measurements'"), '已声明身体指标集合常量');
check(constants.includes("PERFORMANCE_RECORDS: 'performance_records'"), '已声明成绩记录集合常量');
check(constants.includes('PERFORMANCE_APPROVED'), '已声明成绩审核通过审计动作');

const events = readText('cloudfunctions/api/lib/performance-events.js');
check(events.includes("comparison: 'lower'"), '存在计时项目越小越好规则');
check(events.includes("comparison: 'higher'"), '存在远度项目越大越好规则');

const profileSource = readText('cloudfunctions/api/actions/profile.js');
check(profileSource.includes('admin.get_student_profile'), '已注册学生档案查看接口');
check(profileSource.includes('profile.add_measurement'), '已注册身体指标接口');
check(profileSource.includes('loadActiveActor(repository, identity, [ROLES.STUDENT])'), '学生档案写入要求学生角色');

const performanceSource = readText('cloudfunctions/api/actions/performance.js');
for (const action of [
  'performance.list_events',
  'performance.submit',
  'performance.list_mine',
  'admin.list_pending_performances',
  'admin.review_performance'
]) {
  check(performanceSource.includes(action), `成绩接口已注册：${action}`);
}
check(performanceSource.includes("status: 'pending'"), '学生提交成绩默认进入待审核状态');
check(performanceSource.includes('OUT_OF_SCOPE'), '教练跨组审核成绩会返回范围拒绝');

const apiService = readText('miniprogram/services/api.js');
for (const method of [
  'updateStudentProfile',
  'addMeasurement',
  'listPerformanceEvents',
  'submitPerformance',
  'listMyPerformances',
  'getStudentProfile'
]) {
  check(apiService.includes(method), `前端 API 已接入：${method}`);
}

const apiFiles = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collect(entryPath);
    } else if (entry.name.endsWith('.js')) {
      apiFiles.push(entryPath);
    }
  }
}
collect(absolute('cloudfunctions/api'));
const directSetIdPattern =
  /\.set\(\s*\{[\s\S]{0,220}?data\s*:\s*\{[\s\S]{0,220}?\b_id\s*:/;
for (const file of apiFiles) {
  check(
    !directSetIdPattern.test(fs.readFileSync(file, 'utf8')),
    `${path.relative(root, file)} 的 set(data) 未重复写入 _id`
  );
}

if (errors.length) {
  console.error('阶段2结构校验失败：');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`阶段2结构校验通过，共 ${passed} 项。`);
console.log('本校验不执行云端部署、集合变更或业务数据写入。');
