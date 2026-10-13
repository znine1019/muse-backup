'use strict';

/**
 * D1-B｜三角色模拟业务联动 + 权限隔离 + 云端零调用测试
 * （仅存在于 demo/showcase-v1 分支）
 *
 * 全部为行为级断言：直接驱动统一模拟数据源与教练端模拟操作，
 * 再断言学生端 / 家长端的选择器结果，以及全程未发生任何云调用。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

const store = require(path.join(PROJECT_ROOT, 'miniprogram/demo/showcase-store.js'));
const coach = require(path.join(PROJECT_ROOT, 'miniprogram/demo/coach-demo.js'));
const SHOWCASE = require(path.join(PROJECT_ROOT, 'miniprogram/demo/showcase.js'));

const COACH_LIN = 'coach_lin';
const COACH_SU = 'coach_su';
const STUDENT_LIN = 'stu_lin';
const STUDENT_SU = 'stu_su';

function withCloudSpy(fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'wx');
  const previous = global.wx;
  const calls = { init: 0, callFunction: [] };
  global.wx = {
    cloud: {
      init: () => {
        calls.init += 1;
      },
      callFunction: (options) => {
        calls.callFunction.push(options);
        return Promise.resolve({ result: { ok: true, data: {} } });
      }
    }
  };
  try {
    const result = fn();
    return { result, calls };
  } finally {
    if (had) {
      global.wx = previous;
    } else {
      delete global.wx;
    }
  }
}

function findPendingPerformance(studentId, eventCode) {
  return store
    .getState()
    .performances.find(
      (item) => item.studentId === studentId && item.eventCode === eventCode && item.status === store.PERF_STATUS.PENDING
    );
}

/* ============================================================ 统一数据源 */

test('D1-B 三个角色共用同一份虚构数据源', () => {
  /* 训练组：README 记录的中长跑队 / 四项组 / 专项组 */
  const groupNames = store.GROUPS.map((item) => item.name).sort();
  assert.deepEqual(groupNames, ['中长跑队', '四项组', '专项组'].sort(), '应包含三个模拟训练组');

  /* 学生 / 教练 / 家长均来自同一数据源 */
  assert.ok(store.STUDENTS.length >= 3, '应至少有 3 名虚构学生');
  assert.ok(store.COACHES.length >= 2, '应至少有 2 名虚构教练');
  assert.ok(store.PARENTS.length >= 1, '应至少有 1 名虚构家长');

  /* 教练名册由"学生所属训练组"派生，而不是各自独立维护 */
  const linRoster = store.studentsOfCoach(COACH_LIN).map((item) => item.id).sort();
  const suRoster = store.studentsOfCoach(COACH_SU).map((item) => item.id).sort();
  assert.ok(linRoster.includes(STUDENT_LIN), '林教练应带队专项组（含林越）');
  assert.ok(suRoster.includes(STUDENT_SU), '苏教练应带队四项组（含苏晴）');
  assert.notDeepEqual(linRoster, suRoster, '两位教练的名册应不同（教练轮换带队）');

  /* 家长关联同样来自同一数据源 */
  const linked = store.linkedStudentsOfParent('parent_lin').map((item) => item.id).sort();
  assert.deepEqual(linked, [STUDENT_LIN, STUDENT_SU].sort(), '家长应关联两名虚构学生');
});

test('D1-B 预置授权不依赖任何模拟审批', () => {
  /* 教练授权、家长关联都在初始数据里直接可用 */
  assert.ok(store.groupsOfCoach(COACH_LIN).length > 0, '教练授权应为预置');
  assert.equal(store.isLinkActive('parent_lin', STUDENT_LIN), true, '林越的家长关联应预置为已生效');
  /* 数据源里不存在任何"待开发者审批"的中间态阻断 */
  const state = store.getState();
  assert.ok(!state.parentReviews, 'DEMO 数据源不应包含开发者审批队列');
});

/* ================================================================ 联动 */

test('D1-B 联动：教练发布草稿后学生端立即可见', () => {
  store.resetState();
  const draft = store.draftPlans().find((plan) => plan.trainingGroupId === 'group_sprint');
  assert.ok(draft, '应存在专项组草稿');

  const before = store.visiblePlansForStudent(STUDENT_LIN).map((item) => item.planId);
  assert.ok(!before.includes(draft.planId), '发布前学生端不得看到草稿');

  const result = withCloudSpy(() => store.publishPlan(draft.planId));
  assert.equal(result.result.ok, true);

  const after = store.visiblePlansForStudent(STUDENT_LIN).map((item) => item.planId);
  assert.ok(after.includes(draft.planId), '发布后学生端应立即看到该计划');
  assert.equal(result.calls.callFunction.length, 0, '模拟发布不得调用云函数');
});

test('D1-B 联动：教练通过成绩后才进入 PB 与排行榜', () => {
  store.resetState();
  const pending = findPendingPerformance(STUDENT_LIN, '100m');
  assert.ok(pending, '林越应有待审核的 100 米成绩');

  const pbBefore = store.personalBests(STUDENT_LIN).find((item) => item.eventCode === '100m');
  const boardBefore = store.performanceLeaderboard('100m', 'group_sprint');
  assert.ok(!boardBefore.some((row) => row.value === pending.value), '未审核成绩不得进入排行榜');

  const result = withCloudSpy(() => store.reviewPerformance(pending.performanceId, 'approve'));
  assert.equal(result.result.ok, true);

  const pbAfter = store.personalBests(STUDENT_LIN).find((item) => item.eventCode === '100m');
  assert.notEqual(pbAfter.value, pbBefore.value, '通过后正式 PB 应更新');
  assert.equal(pbAfter.value, pending.value);

  const boardAfter = store.performanceLeaderboard('100m', 'group_sprint');
  assert.ok(boardAfter.some((row) => row.value === pending.value), '通过后应进入排行榜');
  assert.equal(result.calls.callFunction.length, 0, '模拟审核不得调用云函数');
});

test('D1-B 联动：教练驳回成绩不会进入正式数据', () => {
  store.resetState();
  const pending = findPendingPerformance(STUDENT_SU, 'long_jump');
  assert.ok(pending, '苏晴应有待审核的跳远成绩');

  const pbBefore = store.personalBests(STUDENT_SU).find((item) => item.eventCode === 'long_jump');
  const result = store.reviewPerformance(pending.performanceId, 'reject');
  assert.equal(result.ok, true);

  const approved = store.approvedPerformances(STUDENT_SU).map((item) => item.performanceId);
  assert.ok(!approved.includes(pending.performanceId), '驳回成绩不得进入正式成绩');
  const pbAfter = store.personalBests(STUDENT_SU).find((item) => item.eventCode === 'long_jump');
  assert.equal(pbAfter.value, pbBefore.value, '驳回后 PB 不应变化');
});

test('D1-B 联动：教练批准请假后学生考勤同步为已批准请假', () => {
  store.resetState();
  const todo = store.coachTodos(COACH_SU).leaves[0];
  assert.ok(todo, '苏教练应有待批请假');

  const result = store.reviewLeave(todo.leaveId, 'approve');
  assert.equal(result.ok, true);

  const record = store
    .attendanceOfStudent(todo.studentId)
    .find((item) => item.sessionId === todo.sessionId);
  assert.ok(record, '批准后应生成对应考勤记录');
  assert.equal(record.status, store.ATTENDANCE_STATUS.LEAVE_APPROVED);
});

test('D1-B 联动：教练评价反馈后家长端仍看不到内部评价', () => {
  store.resetState();
  const entry = store.feedbackOfCoach(COACH_LIN).find((item) => !item.coachComment);
  assert.ok(entry, '林教练应有待评价反馈');

  const result = store.reviewFeedback(entry.feedbackId, '已关注，注意恢复（虚构）。');
  assert.equal(result.ok, true);

  const updated = store.feedbackOfCoach(COACH_LIN).find((item) => item.feedbackId === entry.feedbackId);
  assert.ok(updated.coachComment, '教练评价应写入模拟数据源');

  /* 家长端可见字段：仅完成情况与自评强度，不含 coachComment */
  const parentFeedback = require(path.join(PROJECT_ROOT, 'miniprogram/demo/parent-demo.js'));
  const workbench = parentFeedback.buildParentWorkbench(0);
  for (const row of workbench.feedbackRows) {
    assert.equal(row.coachComment, undefined, '家长端反馈不得包含教练内部评价');
  }
});

/* ============================================================ 权限隔离 */

test('D1-B 权限隔离：教练只能看到本人授权训练组的学生', () => {
  store.resetState();

  const linStudents = store.studentsOfCoach(COACH_LIN).map((item) => item.id);
  const suStudents = store.studentsOfCoach(COACH_SU).map((item) => item.id);

  assert.ok(linStudents.includes(STUDENT_LIN));
  assert.ok(!suStudents.includes(STUDENT_LIN), '苏教练不应看到专项组学生');

  /* 待办同样按训练组过滤 */
  const linTodos = store.coachTodos(COACH_LIN);
  for (const leave of linTodos.leaves) {
    assert.ok(linStudents.includes(leave.studentId), '待批请假必须属于本人训练组');
  }
  for (const performance of linTodos.performances) {
    assert.ok(linStudents.includes(performance.studentId), '待审成绩必须属于本人训练组');
  }
});

test('D1-B 权限隔离：待审核家长关联仍看不到受保护数据', () => {
  store.resetState();
  assert.equal(store.linkStatusOf('parent_lin', STUDENT_SU), store.LINK_STATUS.PENDING_REVIEW);
  assert.equal(store.isLinkActive('parent_lin', STUDENT_SU), false);

  const parentDemo = require(path.join(PROJECT_ROOT, 'miniprogram/demo/parent-demo.js'));
  const pending = parentDemo.buildParentWorkbench(1);
  assert.equal(pending.linkActive, false);
  assert.equal(pending.overview, null);
  for (const key of ['plans', 'performanceRows', 'attendanceRows', 'feedbackRows', 'competitionRows', 'noticeRows']) {
    assert.deepEqual(pending[key], [], `未生效关联不得返回 ${key}`);
  }
});

test('D1-B 权限隔离：学生端不出现未发布计划', () => {
  store.resetState();
  const draft = store.draftPlans()[0];
  assert.ok(draft, '演示数据应包含草稿');

  const visible = store.visiblePlansForStudent(STUDENT_LIN);
  for (const plan of visible) {
    assert.equal(plan.status, store.PLAN_VISIBLE_STATUS, '学生可见计划必须为已发布');
  }
  assert.ok(!visible.some((plan) => plan.planId === draft.planId), '草稿不得出现在学生可见计划中');
});

/* ======================================================== 云端零调用 */

test('D1-B 三角色模拟操作全程零云端调用', () => {
  store.resetState();

  const { calls } = withCloudSpy(() => {
    /* 学生：签到 / 提交请假 / 提交成绩 / 提交反馈 / 提交赛事意向 / 标记已读 */
    store.checkIn(STUDENT_LIN, 'att_speed');
    store.submitLeave(STUDENT_SU, 'att_jump', '演示请假原因');
    store.submitPerformance(STUDENT_LIN, '100m', 11.62, '2026-06-21', '');
    store.submitFeedback(STUDENT_LIN, 'att_speed', 'completed', 7, '演示反馈');
    store.submitCompetitionIntent(STUDENT_LIN, 'comp_city', [{ eventCode: '100m', eventName: '100米', category: '公开组' }], '');
    store.markNoticeRead(STUDENT_LIN, 'notice_1');

    /* 教练：发布计划 / 审批请假 / 审核成绩 / 评价反馈 / 办理意向 / 发布通知 */
    store.publishPlan('plan_draft');
    const leave = store.coachTodos(COACH_SU).leaves[0];
    store.reviewLeave(leave.leaveId, 'approve');
    const pendingPerf = findPendingPerformance(STUDENT_SU, 'long_jump');
    store.reviewPerformance(pendingPerf.performanceId, 'approve');
    const fb = store.feedbackOfCoach(COACH_LIN).find((item) => !item.coachComment);
    store.reviewFeedback(fb.feedbackId, '演示评价');
    const intent = store.coachTodos(COACH_LIN);
    store.advanceCompetitionIntent('intent_lin_1', store.COMPETITION_STATUS.REGISTERED, '演示办理完成');
    store.publishNotice({
      title: '演示通知',
      publishedAt: '2026-06-21 09:00',
      content: '演示内容',
      groupIds: store.GROUPS.map((group) => group.id)
    });

    /* 教练端视图构建 */
    coach.buildCoachWorkbench(COACH_LIN);
    coach.buildCoachModule('plans', COACH_LIN);
    coach.buildCoachModule('leave', COACH_SU);
    coach.buildCoachDetail('performance', pendingPerf.performanceId);

    return true;
  });

  assert.equal(calls.init, 0, '模拟操作不得初始化云开发');
  assert.equal(calls.callFunction.length, 0, '模拟操作不得调用任何云函数');
});

test('D1-B 演示模块不引用正式业务接口', () => {
  for (const file of [
    'miniprogram/demo/showcase-store.js',
    'miniprogram/demo/coach-demo.js',
    'miniprogram/demo/showcase.js',
    'miniprogram/demo/student-demo.js',
    'miniprogram/demo/parent-demo.js'
  ]) {
    const source = read(file);
    assert.ok(!/require\([^)]*services\/api/.test(source), `${file} 不得引用业务接口`);
    assert.ok(!/wx\.cloud/.test(source), `${file} 不得直接访问 wx.cloud`);
  }
});

/* ==================================================== 入口与可用性 */

test('D1-B 展示首页只保留三角色且三者均可体验', () => {
  const roles = SHOWCASE.SHOWCASE_ROLES;
  assert.equal(roles.length, 3, 'DEMO 首页应只有三个入口');
  assert.deepEqual(roles.map((item) => item.role), ['student', 'coach', 'parent']);
  for (const item of roles) {
    assert.equal(item.status, 'ready', `${item.role} 应可体验`);
    assert.ok(item.desc && item.note, `${item.role} 应有说明`);
  }
});

test('D1-B 所有可点击入口都有实际模拟交互（无死入口）', () => {
  const wxml = read('miniprogram/pages/demo/demo.wxml');

  /* 每个 bindtap/bindchange 都必须对应页面或模块中真实存在的方法 */
  const handlers = Array.from(new Set((wxml.match(/bind(?:tap|change|input)="([A-Za-z0-9_]+)"/g) || []).map(
    (item) => item.replace(/.*="([A-Za-z0-9_]+)"/, '$1')
  )));
  const pageJs = read('miniprogram/pages/demo/demo.js');
  for (const handler of handlers) {
    assert.ok(
      new RegExp(`\\b${handler}\\s*\\(`).test(pageJs),
      `模板绑定了 ${handler}，但页面未实现该方法（死入口）`
    );
  }

  /* 教练端目录中的每个模块都能真正构建出内容 */
  for (const item of coach.COACH_CATALOG) {
    const module = coach.buildCoachModule(item.id, COACH_LIN);
    assert.ok(module.subtitle, `${item.id} 应有副标题`);
    assert.ok(
      Array.isArray(module.rows) || Array.isArray(module.form) || module.formFields,
      `${item.id} 应有可展示内容`
    );
  }
});
