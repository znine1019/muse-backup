'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createFeedbackActions = require('../../cloudfunctions/api/actions/feedback');
const { deterministicId } = require('../../cloudfunctions/api/lib/repository');
const { clubDateOnly } = require('../../cloudfunctions/api/lib/dates');
const {
  GROUP_A,
  GROUP_B,
  IDENTITIES,
  STUDENT_A,
  STUDENT_C,
  captureError,
  createHarness
} = require('./helpers');

function seedAttendance(state, options) {
  const {
    sessionId,
    studentUserId,
    status,
    trainingGroupId = GROUP_A,
    attendanceDate = clubDateOnly(),
    planId = ''
  } = options;
  state.sessions.set(sessionId, {
    _id: sessionId,
    sessionId,
    trainingGroupId,
    planId,
    title: '速度训练',
    locationName: '田径场',
    attendanceDate,
    status: 'scheduled',
    version: 1
  });
  const recordId = deterministicId('attend', sessionId, studentUserId);
  state.attendanceRecords.set(recordId, {
    _id: recordId,
    recordId,
    sessionId,
    studentUserId,
    trainingGroupId,
    attendanceDate,
    status,
    source: 'gps'
  });
}

function feedbackPayload(overrides = {}) {
  return {
    clientRequestId: 'feedback_req_1',
    sessionId: 'att_session_1',
    completionStatus: 'completed',
    rpe: 6,
    comment: '训练完成，状态正常',
    ...overrides
  };
}

test('eligible feedback sessions require a real check-in or late record', async () => {
  const harness = createHarness();
  const actions = createFeedbackActions({ repository: harness.repository });
  seedAttendance(harness.state, {
    sessionId: 'att_session_1',
    studentUserId: STUDENT_A._id,
    status: 'checked_in'
  });
  seedAttendance(harness.state, {
    sessionId: 'att_session_leave',
    studentUserId: STUDENT_A._id,
    status: 'leave_approved'
  });

  const result = await actions['feedback.list_eligible_sessions']({
    identity: IDENTITIES.studentA
  });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].session.sessionId, 'att_session_1');
  assert.equal(result.sessions[0].feedback, null);
});

test('student submits feedback idempotently without changing attendance facts', async () => {
  const harness = createHarness();
  const actions = createFeedbackActions({ repository: harness.repository });
  seedAttendance(harness.state, {
    sessionId: 'att_session_1',
    studentUserId: STUDENT_A._id,
    status: 'checked_in'
  });

  const first = await actions['feedback.submit']({
    identity: IDENTITIES.studentA,
    payload: feedbackPayload()
  });
  const second = await actions['feedback.submit']({
    identity: IDENTITIES.studentA,
    payload: feedbackPayload()
  });

  assert.equal(first.feedback.completionStatus, 'completed');
  assert.equal(first.feedback.rpe, 6);
  assert.equal(second.duplicate, true);
  assert.equal(harness.state.feedback.size, 1);
  const record = await harness.repository.getAttendanceRecord(
    'att_session_1',
    STUDENT_A._id
  );
  assert.equal(record.status, 'checked_in');
  assert.ok(
    Array.from(harness.state.audits.values()).some(
      (entry) => entry.action === 'student.training_feedback.submitted'
    )
  );
});

test('feedback rejects invalid RPE and missing attendance', async () => {
  const harness = createHarness();
  const actions = createFeedbackActions({ repository: harness.repository });
  seedAttendance(harness.state, {
    sessionId: 'att_session_1',
    studentUserId: STUDENT_A._id,
    status: 'checked_in'
  });

  const rpeError = await captureError(
    actions['feedback.submit']({
      identity: IDENTITIES.studentA,
      payload: feedbackPayload({ rpe: 11 })
    })
  );
  assert.equal(rpeError.code, 'INVALID_FIELD');

  const attendanceError = await captureError(
    actions['feedback.submit']({
      identity: IDENTITIES.studentA,
      payload: feedbackPayload({ sessionId: 'att_session_none' })
    })
  );
  assert.equal(attendanceError.code, 'SESSION_NOT_FOUND');

  seedAttendance(harness.state, {
    sessionId: 'att_session_absent',
    studentUserId: STUDENT_A._id,
    status: 'absent'
  });
  const absentError = await captureError(
    actions['feedback.submit']({
      identity: IDENTITIES.studentA,
      payload: feedbackPayload({ sessionId: 'att_session_absent' })
    })
  );
  assert.equal(absentError.code, 'ATTENDANCE_REQUIRED');
});

test('student updates own feedback with version protection', async () => {
  const harness = createHarness();
  const actions = createFeedbackActions({ repository: harness.repository });
  seedAttendance(harness.state, {
    sessionId: 'att_session_1',
    studentUserId: STUDENT_A._id,
    status: 'late'
  });
  const submitted = await actions['feedback.submit']({
    identity: IDENTITIES.studentA,
    payload: feedbackPayload()
  });

  const updated = await actions['feedback.update']({
    identity: IDENTITIES.studentA,
    payload: {
      feedbackId: submitted.feedback.feedbackId,
      expectedVersion: 1,
      completionStatus: 'partial',
      rpe: 7,
      comment: '完成大部分训练'
    }
  });
  assert.equal(updated.feedback.version, 2);
  assert.equal(updated.feedback.completionStatus, 'partial');

  const stale = await captureError(
    actions['feedback.update']({
      identity: IDENTITIES.studentA,
      payload: {
        feedbackId: submitted.feedback.feedbackId,
        expectedVersion: 1,
        completionStatus: 'completed',
        rpe: 5,
        comment: '过期修改'
      }
    })
  );
  assert.equal(stale.code, 'FEEDBACK_VERSION_CONFLICT');
});

test('coach reviews feedback and concurrent comments are protected', async () => {
  const harness = createHarness();
  const actions = createFeedbackActions({ repository: harness.repository });
  seedAttendance(harness.state, {
    sessionId: 'att_session_1',
    studentUserId: STUDENT_A._id,
    status: 'checked_in'
  });
  const submitted = await actions['feedback.submit']({
    identity: IDENTITIES.studentA,
    payload: feedbackPayload({ rpe: 8, comment: '训练较困难' })
  });

  const reviewed = await actions['feedback.review']({
    identity: IDENTITIES.coachA,
    payload: {
      feedbackId: submitted.feedback.feedbackId,
      expectedCoachCommentVersion: 0,
      comment: '注意恢复，下次降低强度'
    }
  });
  assert.equal(reviewed.feedback.coachCommentVersion, 1);
  assert.ok(
    Array.from(harness.state.audits.values()).some(
      (entry) => entry.action === 'coach.training_feedback.reviewed'
    )
  );

  const concurrent = await captureError(
    actions['feedback.review']({
      identity: IDENTITIES.developer,
      payload: {
        feedbackId: submitted.feedback.feedbackId,
        expectedCoachCommentVersion: 0,
        comment: '并发评价'
      }
    })
  );
  assert.equal(concurrent.code, 'FEEDBACK_COMMENT_CONFLICT');
});

test('coach feedback scope is limited to assigned groups', async () => {
  const harness = createHarness();
  const actions = createFeedbackActions({ repository: harness.repository });
  seedAttendance(harness.state, {
    sessionId: 'att_session_b',
    studentUserId: STUDENT_C._id,
    status: 'checked_in',
    trainingGroupId: GROUP_B
  });
  const submitted = await actions['feedback.submit']({
    identity: IDENTITIES.studentC,
    payload: feedbackPayload({ sessionId: 'att_session_b' })
  });

  const error = await captureError(
    actions['feedback.review']({
      identity: IDENTITIES.coachA,
      payload: {
        feedbackId: submitted.feedback.feedbackId,
        expectedCoachCommentVersion: 0,
        comment: '跨组评价'
      }
    })
  );
  assert.equal(error.code, 'OUT_OF_SCOPE');

  const list = await actions['feedback.list_manage']({
    identity: IDENTITIES.coachA,
    payload: {}
  });
  assert.equal(list.feedback.length, 0);
});

test('coach list flags feedback needing attention', async () => {
  const harness = createHarness();
  const actions = createFeedbackActions({ repository: harness.repository });
  seedAttendance(harness.state, {
    sessionId: 'att_session_1',
    studentUserId: STUDENT_A._id,
    status: 'checked_in'
  });
  await actions['feedback.submit']({
    identity: IDENTITIES.studentA,
    payload: feedbackPayload({
      completionStatus: 'not_completed',
      rpe: 9,
      comment: '训练中感觉不适'
    })
  });

  const list = await actions['feedback.list_manage']({
    identity: IDENTITIES.coachA,
    payload: {}
  });
  assert.equal(list.feedback.length, 1);
  assert.equal(list.feedback[0].needsAttention, true);
  assert.equal(list.attentionCount, 1);
});

test('student history and disabled account rules', async () => {
  const harness = createHarness();
  const actions = createFeedbackActions({ repository: harness.repository });
  seedAttendance(harness.state, {
    sessionId: 'att_session_1',
    studentUserId: STUDENT_A._id,
    status: 'checked_in'
  });
  await actions['feedback.submit']({
    identity: IDENTITIES.studentA,
    payload: feedbackPayload()
  });

  const mine = await actions['feedback.list_mine']({
    identity: IDENTITIES.studentA
  });
  assert.equal(mine.feedback.length, 1);

  const disabledError = await captureError(
    actions['feedback.list_mine']({ identity: IDENTITIES.disabledStudent })
  );
  assert.equal(disabledError.code, 'ACCOUNT_DISABLED');
});
