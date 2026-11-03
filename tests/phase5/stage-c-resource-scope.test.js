'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const createCompetitionActions = require('../../cloudfunctions/api/actions/competitions');
const createNoticeActions = require('../../cloudfunctions/api/actions/notices');
const { addDays, clubDateOnly } = require('../../cloudfunctions/api/lib/dates');
const {
  COACH_A,
  GROUP_A,
  GROUP_B,
  IDENTITIES,
  captureError,
  createHarness
} = require('./helpers');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function noticePayload(overrides = {}) {
  return {
    clientRequestId: 'stage_c_notice',
    title: '训练安排',
    content: '按计划完成训练。',
    category: 'training',
    priority: 'normal',
    trainingGroupIds: [],
    ...overrides
  };
}

function competitionPayload(overrides = {}) {
  const today = clubDateOnly();
  return {
    clientRequestId: 'stage_c_competition',
    title: '训练交流赛',
    description: '虚构测试赛事',
    location: '训练场',
    eventDate: addDays(today, 30),
    registrationStartAt: `${addDays(today, -1)} 00:00`,
    registrationEndAt: `${addDays(today, 7)} 23:59`,
    requirements: '身体健康',
    events: [{ eventCode: '100m', categories: ['甲组'] }],
    trainingGroupIds: [],
    capacityEnabled: false,
    notes: '',
    ...overrides
  };
}

function grantCoachCoverage(harness, groupId) {
  const current = harness.state.coachGroups[COACH_A._id] || [];
  if (!current.includes(groupId)) {
    harness.state.coachGroups[COACH_A._id] = [...current, groupId];
  }
  const membershipId = `coach_a_${groupId}`;
  harness.state.groupMemberships.set(membershipId, {
    _id: membershipId,
    userId: COACH_A._id,
    groupId,
    roleInGroup: 'coach',
    status: 'active'
  });
}

test('Coach can see global notices but cannot manage them', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  const created = await actions['notice.create']({
    identity: IDENTITIES.developer,
    payload: noticePayload()
  });

  const list = await actions['notice.list_manage']({
    identity: IDENTITIES.coachA,
    payload: {}
  });
  assert.equal(list.notices.length, 1);
  assert.equal(list.notices[0].canManage, false);

  for (const action of [
    'notice.get_manage_detail',
    'notice.publish'
  ]) {
    const error = await captureError(
      actions[action]({
        identity: IDENTITIES.coachA,
        payload: {
          noticeId: created.notice.noticeId,
          expectedVersion: 1
        }
      })
    );
    assert.equal(error.code, 'OUT_OF_SCOPE');
  }
});

test('Coach must cover every group of a multi-group notice to manage it', async () => {
  const harness = createHarness();
  const actions = createNoticeActions({ repository: harness.repository });
  const created = await actions['notice.create']({
    identity: IDENTITIES.developer,
    payload: noticePayload({
      clientRequestId: 'stage_c_notice_multi',
      trainingGroupIds: [GROUP_A, GROUP_B]
    })
  });

  const partialError = await captureError(
    actions['notice.publish']({
      identity: IDENTITIES.coachA,
      payload: { noticeId: created.notice.noticeId, expectedVersion: 1 }
    })
  );
  assert.equal(partialError.code, 'OUT_OF_SCOPE');

  grantCoachCoverage(harness, GROUP_B);
  const published = await actions['notice.publish']({
    identity: IDENTITIES.coachA,
    payload: { noticeId: created.notice.noticeId, expectedVersion: 1 }
  });
  assert.equal(published.notice.status, 'published');
});

test('Coach can see global competitions but cannot manage them', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const created = await actions['competition.create']({
    identity: IDENTITIES.developer,
    payload: competitionPayload()
  });

  const list = await actions['competition.list_manage']({
    identity: IDENTITIES.coachA,
    payload: {}
  });
  assert.equal(list.competitions.length, 1);
  assert.equal(list.competitions[0].canManage, false);

  for (const action of [
    'competition.get_manage_detail',
    'competition.publish'
  ]) {
    const error = await captureError(
      actions[action]({
        identity: IDENTITIES.coachA,
        payload: {
          competitionId: created.competition.competitionId,
          expectedVersion: 1
        }
      })
    );
    assert.equal(error.code, 'OUT_OF_SCOPE');
  }
});

test('Coach must cover every group of a multi-group competition to manage it', async () => {
  const harness = createHarness();
  const actions = createCompetitionActions({ repository: harness.repository });
  const created = await actions['competition.create']({
    identity: IDENTITIES.developer,
    payload: competitionPayload({
      clientRequestId: 'stage_c_competition_multi',
      trainingGroupIds: [GROUP_A, GROUP_B]
    })
  });

  const partialError = await captureError(
    actions['competition.publish']({
      identity: IDENTITIES.coachA,
      payload: {
        competitionId: created.competition.competitionId,
        expectedVersion: 1
      }
    })
  );
  assert.equal(partialError.code, 'OUT_OF_SCOPE');

  grantCoachCoverage(harness, GROUP_B);
  const published = await actions['competition.publish']({
    identity: IDENTITIES.coachA,
    payload: {
      competitionId: created.competition.competitionId,
      expectedVersion: 1
    }
  });
  assert.equal(published.competition.status, 'published');
});

test('Developer retains global notice and competition management', async () => {
  const harness = createHarness();
  const noticeActions = createNoticeActions({ repository: harness.repository });
  const competitionActions = createCompetitionActions({
    repository: harness.repository
  });

  const notice = await noticeActions['notice.create']({
    identity: IDENTITIES.developer,
    payload: noticePayload({ clientRequestId: 'stage_c_dev_notice' })
  });
  await noticeActions['notice.publish']({
    identity: IDENTITIES.developer,
    payload: { noticeId: notice.notice.noticeId, expectedVersion: 1 }
  });

  const competition = await competitionActions['competition.create']({
    identity: IDENTITIES.developer,
    payload: competitionPayload({ clientRequestId: 'stage_c_dev_competition' })
  });
  await competitionActions['competition.publish']({
    identity: IDENTITIES.developer,
    payload: {
      competitionId: competition.competition.competitionId,
      expectedVersion: 1
    }
  });

  assert.equal(
    (await noticeActions['notice.get_manage_detail']({
      identity: IDENTITIES.developer,
      payload: { noticeId: notice.notice.noticeId }
    })).notice.canManage,
    true
  );
  assert.equal(
    (await competitionActions['competition.get_manage_detail']({
      identity: IDENTITIES.developer,
      payload: { competitionId: competition.competition.competitionId }
    })).competition.canManage,
    true
  );
});

test('management buttons are gated by server-provided canManage flags', () => {
  const noticeWxml = fs.readFileSync(
    path.join(PROJECT_ROOT, 'miniprogram/pages/notice-manage/notice-manage.wxml'),
    'utf8'
  );
  const competitionWxml = fs.readFileSync(
    path.join(PROJECT_ROOT, 'miniprogram/pages/competition-manage/competition-manage.wxml'),
    'utf8'
  );

  assert.match(noticeWxml, /item\.canManage && item\.status === 'draft'/);
  assert.match(noticeWxml, /item\.canManage && item\.status === 'published'/);
  assert.match(competitionWxml, /item\.canManage && item\.status === 'draft'/);
  assert.match(competitionWxml, /item\.canManage && item\.status === 'published'/);
});
