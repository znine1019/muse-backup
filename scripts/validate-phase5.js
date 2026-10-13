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
  'cloudfunctions/api/actions/competitions.js',
  'cloudfunctions/api/actions/notices.js',
  'cloudfunctions/api/actions/feedback.js',
  'miniprogram/utils/xlsx-writer.js',
  'miniprogram/pages/student-competitions/student-competitions.js',
  'miniprogram/pages/student-competitions/student-competitions.json',
  'miniprogram/pages/student-competitions/student-competitions.wxml',
  'miniprogram/pages/student-competitions/student-competitions.wxss',
  'miniprogram/pages/competition-manage/competition-manage.js',
  'miniprogram/pages/competition-manage/competition-manage.json',
  'miniprogram/pages/competition-manage/competition-manage.wxml',
  'miniprogram/pages/competition-manage/competition-manage.wxss',
  'miniprogram/pages/student-notices/student-notices.js',
  'miniprogram/pages/student-notices/student-notices.json',
  'miniprogram/pages/student-notices/student-notices.wxml',
  'miniprogram/pages/student-notices/student-notices.wxss',
  'miniprogram/pages/notice-manage/notice-manage.js',
  'miniprogram/pages/notice-manage/notice-manage.json',
  'miniprogram/pages/notice-manage/notice-manage.wxml',
  'miniprogram/pages/notice-manage/notice-manage.wxss',
  'miniprogram/pages/student-feedback/student-feedback.js',
  'miniprogram/pages/student-feedback/student-feedback.json',
  'miniprogram/pages/student-feedback/student-feedback.wxml',
  'miniprogram/pages/student-feedback/student-feedback.wxss',
  'miniprogram/pages/feedback-manage/feedback-manage.js',
  'miniprogram/pages/feedback-manage/feedback-manage.json',
  'miniprogram/pages/feedback-manage/feedback-manage.wxml',
  'miniprogram/pages/feedback-manage/feedback-manage.wxss',
  'tests/phase5/helpers.js',
  'tests/phase5/competitions.test.js',
  'tests/phase5/notices.test.js',
  'tests/phase5/feedback.test.js',
  'tests/phase5/pages.test.js',
  'tests/phase5/xlsx.test.js',
  'docs/阶段5_赛事通知反馈系统设计.md'
]) {
  check(exists(file), `阶段5文件存在：${file}`);
}

const appConfig = JSON.parse(readText('miniprogram/app.json'));
for (const page of [
  'pages/student-competitions/student-competitions',
  'pages/competition-manage/competition-manage',
  'pages/student-notices/student-notices',
  'pages/notice-manage/notice-manage',
  'pages/student-feedback/student-feedback',
  'pages/feedback-manage/feedback-manage'
]) {
  check(appConfig.pages.includes(page), `app.json 已声明阶段5页面：${page}`);
}

const constants = readText('cloudfunctions/api/lib/constants.js');
for (const token of [
  "COMPETITIONS: 'competitions'",
  "COMPETITION_REGISTRATIONS: 'competition_registrations'",
  "CLUB_NOTICES: 'club_notices'",
  "NOTICE_READS: 'notice_reads'",
  "TRAINING_FEEDBACK: 'training_feedback'",
  'COMPETITION_STATUS',
  'COMPETITION_REGISTRATION_STATUS',
  'NOTICE_STATUS',
  'NOTICE_CATEGORIES',
  'NOTICE_PRIORITIES',
  'FEEDBACK_COMPLETION'
]) {
  check(constants.includes(token), `常量已声明：${token}`);
}

const repository = readText('cloudfunctions/api/lib/repository.js');
for (const token of [
  'getCompetition',
  'listCompetitions',
  'getRegistration',
  'listRegistrations',
  'countRegistrations',
  'getClubNotice',
  'listClubNotices',
  'getNoticeRead',
  'listNoticeReads',
  'getTrainingFeedback',
  'listTrainingFeedback',
  'competitionIdForRequest',
  'registrationIdForStudentCompetition',
  'noticeIdForRequest',
  'noticeReadId',
  'feedbackIdForStudentSession'
]) {
  check(repository.includes(token), `仓储层方法已实现：${token}`);
}

const competitions = readText('cloudfunctions/api/actions/competitions.js');
for (const route of [
  'competition.list_meta',
  'competition.list_manage',
  'competition.get_manage_detail',
  'competition.create',
  'competition.update',
  'competition.publish',
  'competition.close',
  'competition.archive',
  'competition.list_student',
  'competition.get_student_detail',
  'competition.submit_intent',
  'competition.cancel_intent',
  'competition.list_my_intents',
  'competition.list_registrations',
  'competition.get_registration_detail',
  'competition.update_registration_status',
  'competition.export_rows'
]) {
  check(competitions.includes(route), `赛事接口已注册：${route}`);
}
check(competitions.includes('activeStudentCount'), '赛事按学生级人数维护上限');
check(competitions.includes('CAPACITY_FULL'), '赛事上限返回明确错误');
check(competitions.includes('REGISTRATION_LOCKED'), '官方报名提交后锁定意向');
check(competitions.includes('COMPETITION_VERSION_CONFLICT'), '赛事有版本并发保护');

const notices = readText('cloudfunctions/api/actions/notices.js');
for (const route of [
  'notice.list_manage',
  'notice.get_manage_detail',
  'notice.create',
  'notice.update',
  'notice.publish',
  'notice.withdraw',
  'notice.archive',
  'notice.list_student',
  'notice.get_student_detail',
  'notice.mark_read',
  'notice.unread_count'
]) {
  check(notices.includes(route), `通知接口已注册：${route}`);
}
check(notices.includes('visibleToGroups'), '通知按训练组过滤可见范围');
check(notices.includes('NOTICE_VERSION_CONFLICT'), '通知有版本并发保护');

const feedback = readText('cloudfunctions/api/actions/feedback.js');
for (const route of [
  'feedback.list_eligible_sessions',
  'feedback.list_mine',
  'feedback.submit',
  'feedback.update',
  'feedback.list_manage',
  'feedback.review'
]) {
  check(feedback.includes(route), `反馈接口已注册：${route}`);
}
check(feedback.includes('ATTENDANCE_REQUIRED'), '反馈要求真实签到或迟到记录');
check(feedback.includes('FEEDBACK_COMMENT_CONFLICT'), '教练评价有并发保护');

const apiService = readText('miniprogram/services/api.js');
for (const method of [
  'listCompetitionMeta',
  'listManageCompetitions',
  'createCompetition',
  'publishCompetition',
  'closeCompetition',
  'archiveCompetition',
  'listStudentCompetitions',
  'submitCompetitionIntent',
  'cancelCompetitionIntent',
  'listMyCompetitionIntents',
  'listManagedRegistrations',
  'updateRegistrationStatus',
  'exportRegistrationRows',
  'listManageNotices',
  'createNotice',
  'publishNotice',
  'withdrawNotice',
  'archiveNotice',
  'listStudentNotices',
  'getStudentNotice',
  'markNoticeRead',
  'getUnreadNoticeCount',
  'listEligibleFeedbackSessions',
  'listMyFeedback',
  'submitFeedback',
  'updateFeedback',
  'listManagedFeedback',
  'reviewFeedback'
]) {
  check(apiService.includes(method), `前端 API 已接入：${method}`);
}

for (const file of [
  'miniprogram/pages/student/student.wxml',
  'miniprogram/pages/coach/coach.wxml',
  'miniprogram/pages/admin/admin.wxml'
]) {
  check(readText(file).includes('goCompetition'), `${file} 已提供赛事入口`);
  check(readText(file).includes('goNotice'), `${file} 已提供通知入口`);
  check(readText(file).includes('goFeedback'), `${file} 已提供反馈入口`);
}

check(
  readText('miniprogram/pages/student-competitions/student-competitions.wxml').includes(
    '官方报名'
  ),
  '学生赛事页面明确区分官方报名'
);
check(
  readText('miniprogram/pages/student-notices/student-notices.wxml').includes(
    '标记已读'
  ),
  '学生通知页面支持标记已读'
);
check(
  readText('miniprogram/pages/student-feedback/student-feedback.wxml').includes(
    'RPE'
  ),
  '学生反馈页面包含RPE'
);
check(
  readText('miniprogram/pages/feedback-manage/feedback-manage.wxml').includes(
    '需要关注'
  ),
  '教练反馈页面支持关注筛选'
);
check(
  readText('docs/阶段5_赛事通知反馈系统设计.md').includes('ADMINONLY'),
  '阶段5设计文档记录集合权限'
);
check(
  !readText('docs/阶段5_赛事通知反馈系统设计.md').includes('设备SDK对接方案'),
  '阶段5不包含第三方体测设备对接'
);

if (errors.length) {
  console.error('阶段5结构校验失败：');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`阶段5结构校验通过，共 ${passed} 项。`);
console.log('本校验不执行云端部署、集合变更或业务数据写入。');
