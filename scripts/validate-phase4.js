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
  'cloudfunctions/api/actions/attendance.js',
  'cloudfunctions/api/lib/geo.js',
  'miniprogram/pages/student-attendance/student-attendance.js',
  'miniprogram/pages/student-attendance/student-attendance.json',
  'miniprogram/pages/student-attendance/student-attendance.wxml',
  'miniprogram/pages/student-attendance/student-attendance.wxss',
  'miniprogram/pages/attendance-manage/attendance-manage.js',
  'miniprogram/pages/attendance-manage/attendance-manage.json',
  'miniprogram/pages/attendance-manage/attendance-manage.wxml',
  'miniprogram/pages/attendance-manage/attendance-manage.wxss',
  'tests/phase4/attendance-actions.test.js',
  'tests/phase4/attendance-pages.test.js',
  'docs/阶段4_GPS考勤与请假系统设计.md'
]) {
  check(exists(file), `阶段4文件存在：${file}`);
}

const appConfig = JSON.parse(readText('miniprogram/app.json'));
for (const page of [
  'pages/student-attendance/student-attendance',
  'pages/attendance-manage/attendance-manage'
]) {
  check(appConfig.pages.includes(page), `app.json 已声明阶段4页面：${page}`);
}

const constants = readText('cloudfunctions/api/lib/constants.js');
for (const token of [
  "ATTENDANCE_SESSIONS: 'attendance_sessions'",
  "ATTENDANCE_RECORDS: 'attendance_records'",
  "LEAVE_REQUESTS: 'leave_requests'",
  'ATTENDANCE_RECORD_STATUS',
  'LEAVE_STATUS'
]) {
  check(constants.includes(token), `常量已声明：${token}`);
}

const repository = readText('cloudfunctions/api/lib/repository.js');
for (const token of [
  'getAttendanceSession',
  'listAttendanceSessions',
  'getAttendanceRecord',
  'listAttendanceRecordsBySession',
  'listAttendanceRecordsByStudent',
  'getLeaveRequest',
  'listLeaveRequests',
  'countPendingLeaveRequests'
]) {
  check(repository.includes(token), `仓储层方法已实现：${token}`);
}

const actions = readText('cloudfunctions/api/actions/attendance.js');
for (const route of [
  'attendance.list_manage_sessions',
  'attendance.get_session_roster',
  'attendance.create_session',
  'attendance.update_session',
  'attendance.cancel_session',
  'attendance.manual_verify',
  'attendance.get_student_today',
  'attendance.list_student_records',
  'attendance.check_in',
  'leave.create',
  'leave.cancel',
  'leave.list_mine',
  'leave.list_pending',
  'leave.list_reviewed',
  'leave.review'
]) {
  check(actions.includes(route), `阶段4接口已注册：${route}`);
}
check(actions.includes('haversineMeters'), '服务端计算签到距离');
check(actions.includes('roundCoordinate(input.latitude, 4)'), '签到坐标降精度存储');
check(actions.includes('SESSION_VERSION_CONFLICT'), '考勤场次有版本冲突保护');
check(actions.includes('LEAVE_NOT_PENDING'), '请假重复审批被拒绝');
check(actions.includes('ATTENDANCE_CONFLICT'), '请假审批不会覆盖真实签到');
check(!actions.includes('console.log'), '考勤模块不输出坐标或敏感日志');

const apiService = readText('miniprogram/services/api.js');
for (const method of [
  'listManageAttendanceSessions',
  'getAttendanceRoster',
  'createAttendanceSession',
  'updateAttendanceSession',
  'cancelAttendanceSession',
  'manualVerifyAttendance',
  'getStudentTodayAttendance',
  'listStudentAttendance',
  'checkInAttendance',
  'createLeave',
  'cancelLeave',
  'listMyLeaves',
  'listPendingLeaves',
  'listReviewedLeaves',
  'reviewLeave'
]) {
  check(apiService.includes(method), `前端 API 已接入：${method}`);
}

for (const file of [
  'miniprogram/pages/student/student.wxml',
  'miniprogram/pages/coach/coach.wxml',
  'miniprogram/pages/admin/admin.wxml'
]) {
  check(readText(file).includes('goAttendance'), `${file} 已提供考勤入口`);
}

check(
  readText('miniprogram/pages/student-report/student-report.wxml').includes(
    'comparison="neutral"'
  ),
  '身高体重趋势使用中性说明'
);
check(
  readText('miniprogram/pages/student-report/student-report.wxml').includes(
    '虚构演示数据，仅供界面预览'
  ),
  'DEMO模式使用虚构数据说明'
);

if (errors.length) {
  console.error('阶段4结构校验失败：');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`阶段4结构校验通过，共 ${passed} 项。`);
console.log('本校验不执行云端部署、集合变更或业务数据写入。');
