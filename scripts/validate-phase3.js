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
  'cloudfunctions/api/actions/plans.js',
  'cloudfunctions/api/lib/dates.js',
  'miniprogram/pages/coach-plan-list/coach-plan-list.js',
  'miniprogram/pages/coach-plan-list/coach-plan-list.json',
  'miniprogram/pages/coach-plan-list/coach-plan-list.wxml',
  'miniprogram/pages/coach-plan-list/coach-plan-list.wxss',
  'miniprogram/pages/coach-plan-edit/coach-plan-edit.js',
  'miniprogram/pages/coach-plan-edit/coach-plan-edit.json',
  'miniprogram/pages/coach-plan-edit/coach-plan-edit.wxml',
  'miniprogram/pages/coach-plan-edit/coach-plan-edit.wxss',
  'miniprogram/pages/student-plans/student-plans.js',
  'miniprogram/pages/student-plans/student-plans.json',
  'miniprogram/pages/student-plans/student-plans.wxml',
  'miniprogram/pages/student-plans/student-plans.wxss',
  'tests/phase3/plan-actions.test.js',
  'tests/phase3/plan-pages.test.js',
  'tests/phase3/plan-validation.test.js'
]) {
  check(exists(file), `阶段3文件存在：${file}`);
}

const appConfig = JSON.parse(readText('miniprogram/app.json'));
for (const page of [
  'pages/coach-plan-list/coach-plan-list',
  'pages/coach-plan-edit/coach-plan-edit',
  'pages/student-plans/student-plans'
]) {
  check(appConfig.pages.includes(page), `app.json 已声明阶段3页面：${page}`);
}

const constants = readText('cloudfunctions/api/lib/constants.js');
check(constants.includes("TRAINING_PLANS: 'training_plans'"), '已声明训练计划集合常量');
check(constants.includes('PLAN_STATUS'), '已声明训练计划状态常量');
check(constants.includes('PLAN_PUBLISHED'), '已声明计划发布审计动作');

const repository = readText('cloudfunctions/api/lib/repository.js');
check(repository.includes('getTrainingPlan'), '仓储层提供计划详情查询');
check(repository.includes('listTrainingPlans'), '仓储层提供计划列表查询');
check(repository.includes('getStudentGroupIds'), '仓储层提供学生训练组归属');
check(repository.includes('planIdForRequest'), '计划创建使用确定性请求ID');
check(repository.includes('copyPlanIdForRequest'), '计划复制使用确定性请求ID');

const plans = readText('cloudfunctions/api/actions/plans.js');
for (const action of [
  'plan.list_meta',
  'plan.list_manage',
  'plan.get_manage_detail',
  'plan.create',
  'plan.update',
  'plan.publish',
  'plan.archive',
  'plan.copy',
  'plan.list_student',
  'plan.get_student'
]) {
  check(plans.includes(action), `训练计划接口已注册：${action}`);
}
check(plans.includes('OUT_OF_SCOPE'), '教练跨训练组访问会被拒绝');
check(plans.includes('PLAN_VERSION_CONFLICT'), '计划并发编辑有版本保护');
check(plans.includes('AUDIT_ACTIONS.PLAN_PUBLISHED'), '计划发布写入审计');
check(plans.includes('PLAN_STATUS.DRAFT'), '复制和新建计划默认为草稿');
check(plans.includes('statuses: [PLAN_STATUS.PUBLISHED]'), '学生查询只读取已发布计划');

const validation = readText('cloudfunctions/api/lib/validation.js');
check(validation.includes('validatePlanCreatePayload'), '训练计划创建校验已实现');
check(validation.includes('validatePlanUpdatePayload'), '训练计划更新校验已实现');
check(validation.includes('validateStudentPlanQueryPayload'), '学生计划查询校验已实现');
check(validation.includes('训练顺序不能重复'), '训练顺序重复会被拒绝');

const dates = readText('cloudfunctions/api/lib/dates.js');
check(dates.includes('CLUB_UTC_OFFSET_MINUTES'), '日期工具处理中国时区偏移');
check(dates.includes('startOfWeek'), '日期工具提供周一为起点的周范围');

const apiService = readText('miniprogram/services/api.js');
for (const method of [
  'listPlanMeta',
  'listManagePlans',
  'getManagePlan',
  'createPlan',
  'updatePlan',
  'publishPlan',
  'archivePlan',
  'copyPlan',
  'listStudentPlans',
  'getStudentPlan'
]) {
  check(apiService.includes(method), `前端 API 已接入：${method}`);
}

for (const file of [
  'miniprogram/pages/student/student.wxml',
  'miniprogram/pages/coach/coach.wxml',
  'miniprogram/pages/admin/admin.wxml'
]) {
  check(readText(file).includes('goPlans'), `${file} 已提供训练计划入口`);
}

check(
  readText('docs/阶段3_训练计划系统设计.md').includes('training_plans'),
  '阶段3设计文档已记录训练计划集合'
);

if (errors.length) {
  console.error('阶段3结构校验失败：');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`阶段3结构校验通过，共 ${passed} 项。`);
console.log('本校验不执行云端部署、集合变更或业务数据写入。');
