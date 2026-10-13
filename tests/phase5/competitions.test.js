'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createCompetitionActions = require('../../cloudfunctions/api/actions/competitions');
const { addDays, clubDateOnly } = require('../../cloudfunctions/api/lib/dates');
const {
  GROUP_A,
  GROUP_B,
  IDENTITIES,
  STUDENT_A,
  STUDENT_B,
  STUDENT_C,
  captureError,
  createHarness
} = require('./helpers');

function competitionPayload(overrides = {}) {
  const today = clubDateOnly();
  return {
    clientRequestId: 'comp_req_1',
    title: '市青少年田径赛',
    description: '虚构演示赛事',
    location: '市体育中心',
    eventDate: addDays(today, 30),
    registrationStartAt: `${addDays(today, -1)} 00:00`,
    registrationEndAt: `${addDays(today, 7)} 23:59`,
    requirements: '身体健康，服从教练安排',
    events: [
      { eventCode: '100m', categories: ['甲组', '乙组'] },
      { eventCode: 'long_jump', categories: ['甲组'] }
    ],
    trainingGroupIds: [GROUP_A],
    capacityEnabled: false,
    notes: '内部统筹，官方报名由教练完成',
    ...overrides
  };
}

async function createPublishedCompetition(actions, overrides = {}) {
  const created = await actions['competition.create']({
    identity: IDENTITIES.coachA,
    payload: competitionPayload(overrides)
  });
  const published = await actions['competition.publish']({
    identity: IDENTITIES.coachA,
    payload: {
      competitionId: created.competition.competitionId,
      expectedVersion: created.competition.version
    }
  });
  return published.competition;
}

test('competition create is idempotent and publishes by default as draft first', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });

  const first = await actions['competition.create']({
    identity: IDENTITIES.coachA,
    payload: competitionPayload()
  });
  const second = await actions['competition.create']({
    identity: IDENTITIES.coachA,
    payload: competitionPayload()
  });

  assert.equal(first.competition.status, 'draft');
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(harness.state.competitions.size, 1);
  assert.ok(
    Array.from(harness.state.audits.values()).some(
      (entry) => entry.action === 'coach.competition.created'
    )
  );
});

test('draft is hidden from students and published competition becomes visible', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const created = await actions['competition.create']({
    identity: IDENTITIES.coachA,
    payload: competitionPayload()
  });

  const before = await actions['competition.list_student']({
    identity: IDENTITIES.studentA
  });
  assert.equal(before.competitions.length, 0);

  await actions['competition.publish']({
    identity: IDENTITIES.coachA,
    payload: {
      competitionId: created.competition.competitionId,
      expectedVersion: 1
    }
  });
  const after = await actions['competition.list_student']({
    identity: IDENTITIES.studentA
  });
  assert.equal(after.competitions.length, 1);
  assert.equal(after.competitions[0].phase, 'open');
});

test('competition update uses version lock and only drafts are editable', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const created = await actions['competition.create']({
    identity: IDENTITIES.coachA,
    payload: competitionPayload()
  });

  const updated = await actions['competition.update']({
    identity: IDENTITIES.coachA,
    payload: {
      ...competitionPayload(),
      competitionId: created.competition.competitionId,
      expectedVersion: 1,
      title: '市青少年田径赛（更新）'
    }
  });
  assert.equal(updated.competition.version, 2);

  const stale = await captureError(
    actions['competition.update']({
      identity: IDENTITIES.coachA,
      payload: {
        ...competitionPayload(),
        competitionId: created.competition.competitionId,
        expectedVersion: 1,
        title: '过期更新'
      }
    })
  );
  assert.equal(stale.code, 'COMPETITION_VERSION_CONFLICT');

  await actions['competition.publish']({
    identity: IDENTITIES.coachA,
    payload: { competitionId: created.competition.competitionId, expectedVersion: 2 }
  });
  const publishedEdit = await captureError(
    actions['competition.update']({
      identity: IDENTITIES.coachA,
      payload: {
        ...competitionPayload(),
        competitionId: created.competition.competitionId,
        expectedVersion: 3,
        title: '已发布赛事修改'
      }
    })
  );
  assert.equal(publishedEdit.code, 'COMPETITION_NOT_DRAFT');
});

test('competition close and archive keep history', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);

  const closed = await actions['competition.close']({
    identity: IDENTITIES.coachA,
    payload: { competitionId: competition.competitionId, expectedVersion: 2 }
  });
  assert.equal(closed.competition.status, 'closed');

  const archived = await actions['competition.archive']({
    identity: IDENTITIES.coachA,
    payload: { competitionId: competition.competitionId, expectedVersion: 3 }
  });
  assert.equal(archived.competition.status, 'archived');
  assert.ok(harness.state.competitions.has(competition.competitionId));
});

test('student multi-project intent merges items and counts one student', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);

  const result = await actions['competition.submit_intent']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'intent_a_1',
      competitionId: competition.competitionId,
      items: [
        { eventCode: '100m', category: '甲组' },
        { eventCode: 'long_jump', category: '甲组' }
      ],
      contactNote: ''
    }
  });

  assert.equal(result.registration.status, 'submitted');
  assert.equal(result.registration.items.length, 2);
  const stored = harness.state.competitions.get(competition.competitionId);
  assert.equal(stored.activeStudentCount, 1);

  const detail = await actions['competition.get_manage_detail']({
    identity: IDENTITIES.coachA,
    payload: { competitionId: competition.competitionId }
  });
  assert.equal(detail.competition.stats.studentCount, 1);
  assert.equal(detail.competition.stats.eventCounts['100m'], 1);
  assert.equal(detail.competition.stats.eventCounts.long_jump, 1);
});

test('duplicate project and category is idempotent', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);
  const payload = {
    clientRequestId: 'intent_dup',
    competitionId: competition.competitionId,
    items: [{ eventCode: '100m', category: '甲组' }]
  };

  const first = await actions['competition.submit_intent']({
    identity: IDENTITIES.studentA,
    payload
  });
  const second = await actions['competition.submit_intent']({
    identity: IDENTITIES.studentA,
    payload
  });

  assert.equal(first.registration.items.length, 1);
  assert.equal(second.duplicate, true);
  assert.equal(second.registration.items.length, 1);
  assert.equal(
    harness.state.competitions.get(competition.competitionId).activeStudentCount,
    1
  );
});

test('unlimited competition allows more than 100 students', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);
  harness.state.competitions.get(competition.competitionId).activeStudentCount = 150;

  const result = await actions['competition.submit_intent']({
    identity: IDENTITIES.studentB,
    payload: {
      clientRequestId: 'intent_unlimited',
      competitionId: competition.competitionId,
      items: [{ eventCode: '100m', category: '甲组' }]
    }
  });
  assert.equal(result.registration.status, 'submitted');
  assert.equal(
    harness.state.competitions.get(competition.competitionId).activeStudentCount,
    151
  );
});

test('configured capacity blocks new students only', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions, {
    capacityEnabled: true,
    capacity: 1
  });

  await actions['competition.submit_intent']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'intent_cap_a',
      competitionId: competition.competitionId,
      items: [{ eventCode: '100m', category: '甲组' }]
    }
  });
  const error = await captureError(
    actions['competition.submit_intent']({
      identity: IDENTITIES.studentB,
      payload: {
        clientRequestId: 'intent_cap_b',
        competitionId: competition.competitionId,
        items: [{ eventCode: '100m', category: '甲组' }]
      }
    })
  );
  assert.equal(error.code, 'CAPACITY_FULL');
});

test('concurrent intents cannot exceed the configured capacity', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions, {
    capacityEnabled: true,
    capacity: 1
  });

  const settled = await Promise.allSettled([
    actions['competition.submit_intent']({
      identity: IDENTITIES.studentA,
      payload: {
        clientRequestId: 'intent_race_a',
        competitionId: competition.competitionId,
        items: [{ eventCode: '100m', category: '甲组' }]
      }
    }),
    actions['competition.submit_intent']({
      identity: IDENTITIES.studentB,
      payload: {
        clientRequestId: 'intent_race_b',
        competitionId: competition.competitionId,
        items: [{ eventCode: '100m', category: '甲组' }]
      }
    })
  ]);
  const fulfilled = settled.filter((item) => item.status === 'fulfilled');
  const rejected = settled.filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'CAPACITY_FULL');
  assert.equal(
    harness.state.competitions.get(competition.competitionId).activeStudentCount,
    1
  );
});

test('partial and full cancellation keep the student count consistent', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);
  const submitted = await actions['competition.submit_intent']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'intent_cancel',
      competitionId: competition.competitionId,
      items: [
        { eventCode: '100m', category: '甲组' },
        { eventCode: 'long_jump', category: '甲组' }
      ]
    }
  });

  const partial = await actions['competition.cancel_intent']({
    identity: IDENTITIES.studentA,
    payload: {
      registrationId: submitted.registration.registrationId,
      eventCodes: ['100m']
    }
  });
  assert.equal(partial.registration.items.length, 1);
  assert.equal(
    harness.state.competitions.get(competition.competitionId).activeStudentCount,
    1
  );

  const full = await actions['competition.cancel_intent']({
    identity: IDENTITIES.studentA,
    payload: {
      registrationId: submitted.registration.registrationId,
      eventCodes: []
    }
  });
  assert.equal(full.registration.status, 'cancelled');
  assert.equal(
    harness.state.competitions.get(competition.competitionId).activeStudentCount,
    0
  );
});

test('registration status flow is coach-only and locked after registered', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);
  const submitted = await actions['competition.submit_intent']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'intent_status',
      competitionId: competition.competitionId,
      items: [{ eventCode: '100m', category: '甲组' }]
    }
  });

  const studentError = await captureError(
    actions['competition.update_registration_status']({
      identity: IDENTITIES.studentA,
      payload: {
        registrationId: submitted.registration.registrationId,
        status: 'registered',
        expectedVersion: 1
      }
    })
  );
  assert.equal(studentError.code, 'FORBIDDEN');

  await actions['competition.update_registration_status']({
    identity: IDENTITIES.coachA,
    payload: {
      registrationId: submitted.registration.registrationId,
      status: 'processing',
      expectedVersion: 1,
      comment: '资料核对中'
    }
  });
  await actions['competition.update_registration_status']({
    identity: IDENTITIES.coachA,
    payload: {
      registrationId: submitted.registration.registrationId,
      status: 'registered',
      expectedVersion: 2,
      comment: '已在官方平台提交'
    }
  });

  const lockError = await captureError(
    actions['competition.cancel_intent']({
      identity: IDENTITIES.studentA,
      payload: {
        registrationId: submitted.registration.registrationId,
        eventCodes: []
      }
    })
  );
  assert.equal(lockError.code, 'REGISTRATION_LOCKED');

  const registeredLock = await captureError(
    actions['competition.update_registration_status']({
      identity: IDENTITIES.coachA,
      payload: {
        registrationId: submitted.registration.registrationId,
        status: 'failed',
        expectedVersion: 3
      }
    })
  );
  assert.equal(registeredLock.code, 'REGISTRATION_LOCKED');

  const second = await actions['competition.submit_intent']({
    identity: IDENTITIES.studentB,
    payload: {
      clientRequestId: 'intent_status_b',
      competitionId: competition.competitionId,
      items: [{ eventCode: '100m', category: '甲组' }]
    }
  });
  await actions['competition.update_registration_status']({
    identity: IDENTITIES.coachA,
    payload: {
      registrationId: second.registration.registrationId,
      status: 'processing',
      expectedVersion: 1
    }
  });
  const staleError = await captureError(
    actions['competition.update_registration_status']({
      identity: IDENTITIES.coachA,
      payload: {
        registrationId: second.registration.registrationId,
        status: 'failed',
        expectedVersion: 1
      }
    })
  );
  assert.equal(staleError.code, 'REGISTRATION_VERSION_CONFLICT');
});

test('cross-group coach cannot read or update other group intents', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);
  const submitted = await actions['competition.submit_intent']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'intent_scope',
      competitionId: competition.competitionId,
      items: [{ eventCode: '100m', category: '甲组' }]
    }
  });

  const list = await actions['competition.list_registrations']({
    identity: IDENTITIES.coachB,
    payload: {}
  });
  assert.equal(list.registrations.length, 0);

  const detailError = await captureError(
    actions['competition.get_registration_detail']({
      identity: IDENTITIES.coachB,
      payload: { registrationId: submitted.registration.registrationId }
    })
  );
  assert.equal(detailError.code, 'OUT_OF_SCOPE');

  const exportRows = await actions['competition.export_rows']({
    identity: IDENTITIES.coachB,
    payload: {}
  });
  assert.equal(exportRows.rows.length, 0);
});

test('developer can view and export all registration rows', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);
  await actions['competition.submit_intent']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'intent_export',
      competitionId: competition.competitionId,
      items: [
        { eventCode: '100m', category: '甲组' },
        { eventCode: 'long_jump', category: '甲组' }
      ]
    }
  });

  const rows = await actions['competition.export_rows']({
    identity: IDENTITIES.developer,
    payload: { competitionId: competition.competitionId }
  });
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[0].studentName, '学生甲');
  assert.equal(rows.rows[0].eventName !== undefined, true);
  assert.equal(rows.rows[0].category, '甲组');
});

test('closed registration window and invalid project are rejected', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);
  harness.state.competitions.get(competition.competitionId).registrationEndAt =
    `${addDays(clubDateOnly(), -1)} 23:59`;

  const closedError = await captureError(
    actions['competition.submit_intent']({
      identity: IDENTITIES.studentA,
      payload: {
        clientRequestId: 'intent_closed',
        competitionId: competition.competitionId,
        items: [{ eventCode: '100m', category: '甲组' }]
      }
    })
  );
  assert.equal(closedError.code, 'COMPETITION_NOT_OPEN');

  harness.state.competitions.get(competition.competitionId).registrationEndAt =
    `${addDays(clubDateOnly(), 7)} 23:59`;
  const invalidError = await captureError(
    actions['competition.submit_intent']({
      identity: IDENTITIES.studentA,
      payload: {
        clientRequestId: 'intent_invalid',
        competitionId: competition.competitionId,
        items: [{ eventCode: '100m', category: '丙组' }]
      }
    })
  );
  assert.equal(invalidError.code, 'INVALID_FIELD');
});

test('disabled account and out-of-scope group cannot submit intent', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);

  const disabledError = await captureError(
    actions['competition.submit_intent']({
      identity: IDENTITIES.disabledStudent,
      payload: {
        clientRequestId: 'intent_disabled',
        competitionId: competition.competitionId,
        items: [{ eventCode: '100m', category: '甲组' }]
      }
    })
  );
  assert.equal(disabledError.code, 'ACCOUNT_DISABLED');

  const scopeError = await captureError(
    actions['competition.submit_intent']({
      identity: IDENTITIES.studentC,
      payload: {
        clientRequestId: 'intent_scope_b',
        competitionId: competition.competitionId,
        items: [{ eventCode: '100m', category: '甲组' }]
      }
    })
  );
  assert.equal(scopeError.code, 'OUT_OF_SCOPE');
});

test('student list shows own registration status and history', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const competition = await createPublishedCompetition(actions);
  await actions['competition.submit_intent']({
    identity: IDENTITIES.studentA,
    payload: {
      clientRequestId: 'intent_mine',
      competitionId: competition.competitionId,
      items: [{ eventCode: '100m', category: '甲组' }]
    }
  });

  const list = await actions['competition.list_student']({
    identity: IDENTITIES.studentA
  });
  assert.equal(list.competitions.length, 1);
  assert.equal(list.competitions[0].registration.status, 'submitted');

  const mine = await actions['competition.list_my_intents']({
    identity: IDENTITIES.studentA
  });
  assert.equal(mine.registrations.length, 1);
  assert.equal(mine.registrations[0].competitionTitle, '市青少年田径赛');
});
