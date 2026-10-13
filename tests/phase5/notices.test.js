'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createNoticeActions = require('../../cloudfunctions/api/actions/notices');
const {
  GROUP_A,
  GROUP_B,
  IDENTITIES,
  captureError,
  createHarness
} = require('./helpers');

function noticePayload(overrides = {}) {
  return {
    clientRequestId: 'notice_req_1',
    title: '本周训练安排',
    content: '周三、周五正常训练，请提前到场。',
    category: 'training',
    priority: 'normal',
    trainingGroupIds: [GROUP_A],
    ...overrides
  };
}

async function createPublishedNotice(actions, overrides = {}) {
  const created = await actions['notice.create']({
    identity: IDENTITIES.coachA,
    payload: noticePayload(overrides)
  });
  const published = await actions['notice.publish']({
    identity: IDENTITIES.coachA,
    payload: { noticeId: created.notice.noticeId, expectedVersion: 1 }
  });
  return published.notice;
}

test('notice create is idempotent and starts as draft', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });

  const first = await actions['notice.create']({
    identity: IDENTITIES.coachA,
    payload: noticePayload()
  });
  const second = await actions['notice.create']({
    identity: IDENTITIES.coachA,
    payload: noticePayload()
  });

  assert.equal(first.notice.status, 'draft');
  assert.equal(second.duplicate, true);
  assert.equal(harness.state.notices.size, 1);
  assert.ok(
    Array.from(harness.state.audits.values()).some(
      (entry) => entry.action === 'coach.notice.created'
    )
  );
});

test('draft notice is hidden and published notice is visible to the group', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  const created = await actions['notice.create']({
    identity: IDENTITIES.coachA,
    payload: noticePayload()
  });

  const before = await actions['notice.list_student']({
    identity: IDENTITIES.studentA
  });
  assert.equal(before.notices.length, 0);

  await actions['notice.publish']({
    identity: IDENTITIES.coachA,
    payload: { noticeId: created.notice.noticeId, expectedVersion: 1 }
  });
  const after = await actions['notice.list_student']({
    identity: IDENTITIES.studentA
  });
  assert.equal(after.notices.length, 1);
  assert.equal(after.notices[0].isRead, false);
  assert.equal(after.unreadCount, 1);
});

test('notice update uses version lock and published notices are immutable', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  const created = await actions['notice.create']({
    identity: IDENTITIES.coachA,
    payload: noticePayload()
  });

  const updated = await actions['notice.update']({
    identity: IDENTITIES.coachA,
    payload: {
      ...noticePayload(),
      noticeId: created.notice.noticeId,
      expectedVersion: 1,
      title: '本周训练安排（更新）'
    }
  });
  assert.equal(updated.notice.version, 2);

  await actions['notice.publish']({
    identity: IDENTITIES.coachA,
    payload: { noticeId: created.notice.noticeId, expectedVersion: 2 }
  });
  const error = await captureError(
    actions['notice.update']({
      identity: IDENTITIES.coachA,
      payload: {
        ...noticePayload(),
        noticeId: created.notice.noticeId,
        expectedVersion: 3,
        title: '修改已发布通知'
      }
    })
  );
  assert.equal(error.code, 'NOTICE_NOT_DRAFT');
});

test('withdraw hides a notice and archive keeps history', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  const published = await createPublishedNotice(actions);

  const withdrawn = await actions['notice.withdraw']({
    identity: IDENTITIES.coachA,
    payload: { noticeId: published.noticeId, expectedVersion: 2 }
  });
  assert.equal(withdrawn.notice.status, 'withdrawn');

  const studentList = await actions['notice.list_student']({
    identity: IDENTITIES.studentA
  });
  assert.equal(studentList.notices.length, 0);

  const archived = await actions['notice.archive']({
    identity: IDENTITIES.coachA,
    payload: { noticeId: published.noticeId, expectedVersion: 3 }
  });
  assert.equal(archived.notice.status, 'archived');
});

test('coach group scope isolates notices between groups', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  const published = await createPublishedNotice(actions);

  const coachBList = await actions['notice.list_manage']({
    identity: IDENTITIES.coachB,
    payload: {}
  });
  assert.equal(coachBList.notices.length, 0);

  const detailError = await captureError(
    actions['notice.get_manage_detail']({
      identity: IDENTITIES.coachB,
      payload: { noticeId: published.noticeId }
    })
  );
  assert.equal(detailError.code, 'OUT_OF_SCOPE');

  const studentB = await actions['notice.list_student']({
    identity: IDENTITIES.studentC
  });
  assert.equal(studentB.notices.length, 0);
});

test('developer can publish global notices visible to all groups', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  const created = await actions['notice.create']({
    identity: IDENTITIES.developer,
    payload: noticePayload({
      clientRequestId: 'notice_global',
      trainingGroupIds: [],
      priority: 'important'
    })
  });
  const published = await actions['notice.publish']({
    identity: IDENTITIES.developer,
    payload: { noticeId: created.notice.noticeId, expectedVersion: 1 }
  });

  const groupA = await actions['notice.list_student']({
    identity: IDENTITIES.studentA
  });
  const groupB = await actions['notice.list_student']({
    identity: IDENTITIES.studentC
  });
  assert.equal(groupA.notices.length, 1);
  assert.equal(groupB.notices.length, 1);
  assert.equal(groupA.notices[0].priority, 'important');

  const coachGlobal = await captureError(
    actions['notice.create']({
      identity: IDENTITIES.coachB,
      payload: noticePayload({
        clientRequestId: 'notice_coach_global',
        trainingGroupIds: []
      })
    })
  );
  assert.equal(coachGlobal.code, 'INVALID_FIELD');
  assert.equal(published.notice.status, 'published');
});

test('mark read is idempotent and unread count updates', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  const published = await createPublishedNotice(actions);

  const first = await actions['notice.mark_read']({
    identity: IDENTITIES.studentA,
    payload: { noticeId: published.noticeId }
  });
  const second = await actions['notice.mark_read']({
    identity: IDENTITIES.studentA,
    payload: { noticeId: published.noticeId }
  });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(harness.state.reads.size, 1);

  const unread = await actions['notice.unread_count']({
    identity: IDENTITIES.studentA
  });
  assert.equal(unread.unreadCount, 0);

  const otherUnread = await actions['notice.unread_count']({
    identity: IDENTITIES.studentB
  });
  assert.equal(otherUnread.unreadCount, 1);
});

test('important notices are ordered first', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  await createPublishedNotice(actions, {
    clientRequestId: 'notice_normal',
    title: '普通通知',
    priority: 'normal'
  });
  await createPublishedNotice(actions, {
    clientRequestId: 'notice_important',
    title: '重要通知',
    priority: 'important'
  });

  const list = await actions['notice.list_student']({
    identity: IDENTITIES.studentA
  });
  assert.equal(list.notices[0].title, '重要通知');
  assert.equal(list.notices[1].title, '普通通知');
});

test('students cannot manage notices and disabled accounts are rejected', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });

  const error = await captureError(
    actions['notice.create']({
      identity: IDENTITIES.studentA,
      payload: noticePayload({ clientRequestId: 'notice_student' })
    })
  );
  assert.equal(error.code, 'FORBIDDEN');

  const disabledError = await captureError(
    actions['notice.list_student']({
      identity: IDENTITIES.disabledStudent
    })
  );
  assert.equal(disabledError.code, 'ACCOUNT_DISABLED');
});

test('student cannot read a notice outside the visible group', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  const created = await actions['notice.create']({
    identity: IDENTITIES.coachB,
    payload: noticePayload({
      trainingGroupIds: [GROUP_B],
      clientRequestId: 'notice_group_b'
    })
  });
  const published = await actions['notice.publish']({
    identity: IDENTITIES.coachB,
    payload: { noticeId: created.notice.noticeId, expectedVersion: 1 }
  }).then((result) => result.notice);

  const studentA = await actions['notice.list_student']({
    identity: IDENTITIES.studentA
  });
  assert.equal(studentA.notices.length, 0);

  const error = await captureError(
    actions['notice.get_student_detail']({
      identity: IDENTITIES.studentA,
      payload: { noticeId: published.noticeId }
    })
  );
  assert.equal(error.code, 'OUT_OF_SCOPE');
});

test('notice group visibility uses enabled training groups', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  await createPublishedNotice(actions, {
    trainingGroupIds: [GROUP_A],
    clientRequestId: 'notice_disabled_group'
  });
  harness.state.groups.get(GROUP_A).enabled = false;

  const list = await actions['notice.list_student']({
    identity: IDENTITIES.studentA
  });
  assert.equal(list.notices.length, 0);
});
