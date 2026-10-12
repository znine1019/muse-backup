'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createGroupAdminActions = require('../../cloudfunctions/api/actions/groups');
const createProfileActions = require('../../cloudfunctions/api/actions/profile');
const createRegistrationActions = require('../../cloudfunctions/api/actions/registrations');
const createUserAdminActions = require('../../cloudfunctions/api/actions/users');

const IDENTITIES = Object.freeze({
  developer: { appid: 'wx_test_app', openid: 'openid_developer_0001' },
  coach: { appid: 'wx_test_app', openid: 'openid_coach_0001' },
  student: { appid: 'wx_test_app', openid: 'openid_student_0001' }
});

const USERS = Object.freeze({
  developer: {
    _id: 'usr_developer',
    status: 'active',
    roles: ['developer']
  },
  coach: {
    _id: 'usr_coach',
    status: 'active',
    roles: ['coach']
  },
  student: {
    _id: 'usr_student',
    status: 'active',
    roles: ['student']
  },
  disabledStudent: {
    _id: 'usr_disabled_student',
    status: 'disabled',
    roles: ['student']
  }
});

function createActions(repository) {
  return Object.freeze({
    ...createUserAdminActions({ repository }),
    ...createProfileActions({ repository }),
    ...createRegistrationActions({ repository }),
    ...createGroupAdminActions({ repository })
  });
}

function createRepository(user, overrides = {}) {
  return {
    ensureUser: async () => user,
    db: {
      command: {
        in: (values) => ({ operator: 'in', values })
      },
      serverDate: () => new Date()
    },
    ...overrides
  };
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to be rejected');
}

test('student and coach cannot call developer-only admin actions', async () => {
  const developerOnlyActions = [
    'admin.assign_role',
    'admin.create_training_group',
    'admin.list_training_groups',
    'admin.list_users',
    'admin.set_group_coach',
    'admin.set_training_group_enabled',
    'admin.set_user_status'
  ];
  const studentBlockedActions = [
    ...developerOnlyActions,
    'admin.list_pending_registrations',
    'admin.review_registration'
  ];

  const cases = [
    { user: USERS.student, actions: studentBlockedActions },
    { user: USERS.coach, actions: developerOnlyActions }
  ];

  for (const { user, actions: blockedActions } of cases) {
    const actions = createActions(createRepository(user));
    for (const action of blockedActions) {
      const error = await captureError(
        actions[action]({
          identity: IDENTITIES.student,
          payload: {},
          context: {}
        })
      );
      assert.equal(error.code, 'FORBIDDEN', `${user._id} should not call ${action}`);
    }
  }
});

test('profile.get ignores a client-supplied targetUserId and returns only the caller profile', async () => {
  const ownProfile = {
    _id: 'profile_student',
    userId: USERS.student._id,
    name: '模拟学生',
    gender: 'unspecified',
    birthDate: '2008-01-01',
    heightCm: 170,
    weightKg: 60,
    primaryTrainingProject: '短跑',
    requestedTrainingGroupId: 'group_a',
    reviewStatus: 'pending',
    submittedAt: new Date('2026-10-13T00:00:00.000Z')
  };
  const repository = createRepository(USERS.student, {
    getProfile: async (userId) => {
      assert.equal(userId, USERS.student._id);
      return ownProfile;
    },
    getLatestReview: async () => null
  });
  const actions = createActions(repository);

  const result = await actions['profile.get']({
    identity: IDENTITIES.student,
    payload: { targetUserId: 'usr_other_student' }
  });

  assert.equal(result.profile.userId, USERS.student._id);
  assert.equal(result.profile.name, '模拟学生');
});

test('coach pending list only returns registrations inside assigned groups', async () => {
  const profiles = [
    {
      _id: 'profile_a',
      userId: 'usr_student_a',
      name: '模拟学生甲',
      gender: 'male',
      birthDate: '2008-01-01',
      heightCm: 170,
      weightKg: 60,
      primaryTrainingProject: '短跑',
      requestedTrainingGroupId: 'group_a',
      reviewStatus: 'pending',
      submittedAt: new Date('2026-10-13T00:00:00.000Z')
    },
    {
      _id: 'profile_b',
      userId: 'usr_student_b',
      name: '模拟学生乙',
      gender: 'female',
      birthDate: '2009-01-01',
      heightCm: 165,
      weightKg: 52,
      primaryTrainingProject: '短跑',
      requestedTrainingGroupId: 'group_b',
      reviewStatus: 'pending',
      submittedAt: new Date('2026-10-13T01:00:00.000Z')
    }
  ];
  const repository = createRepository(USERS.coach, {
    getCoachGroupIds: async () => ['group_a'],
    queryAll: async () => profiles,
    getGroupsMap: async () =>
      new Map([
        ['group_a', { _id: 'group_a', name: '模拟短跑组', seasonLabel: '2026测试周期' }],
        ['group_b', { _id: 'group_b', name: '模拟第二组', seasonLabel: '2027测试周期' }]
      ])
  });
  const actions = createActions(repository);

  const result = await actions['admin.list_pending_registrations']({
    identity: IDENTITIES.coach,
    payload: {}
  });

  assert.deepEqual(result.registrations.map((item) => item.userId), ['usr_student_a']);
  assert.equal(result.registrations[0].requestedTrainingGroupId, 'group_a');
});

test('coach cross-group review is rejected before any transaction starts', async () => {
  let transactionCalls = 0;
  const repository = createRepository(USERS.coach, {
    getUserById: async () => ({
      _id: 'usr_target_student',
      status: 'pending_review',
      roles: []
    }),
    getProfile: async () => ({
      _id: 'profile_target',
      userId: 'usr_target_student',
      reviewStatus: 'pending',
      requestedTrainingGroupId: 'group_b',
      currentReviewId: 'review_target'
    }),
    getCoachGroupIds: async () => ['group_a'],
    db: {
      command: {
        in: (values) => ({ operator: 'in', values })
      },
      serverDate: () => new Date(),
      runTransaction: async () => {
        transactionCalls += 1;
        throw new Error('transaction should not start');
      }
    }
  });
  const actions = createActions(repository);

  const error = await captureError(
    actions['admin.review_registration']({
      identity: IDENTITIES.coach,
      payload: {
        targetUserId: 'usr_target_student',
        decision: 'approve',
        comment: '模拟审核'
      }
    })
  );

  assert.equal(error.code, 'OUT_OF_SCOPE');
  assert.equal(transactionCalls, 0);
});

test('last active developer cannot be revoked or disabled', async () => {
  const targetDeveloper = {
    _id: 'usr_only_developer',
    status: 'active',
    roles: ['developer']
  };
  const repository = createRepository(USERS.developer, {
    getUserById: async () => targetDeveloper,
    userCollection: {
      where: () => ({
        limit: () => ({
          get: async () => ({ data: [targetDeveloper] })
        })
      })
    }
  });
  const actions = createActions(repository);

  const revokeError = await captureError(
    actions['admin.assign_role']({
      identity: IDENTITIES.developer,
      payload: {
        targetUserId: targetDeveloper._id,
        role: 'developer',
        grant: false
      }
    })
  );
  assert.equal(revokeError.code, 'LAST_DEVELOPER');

  const disableError = await captureError(
    actions['admin.set_user_status']({
      identity: IDENTITIES.developer,
      payload: {
        targetUserId: targetDeveloper._id,
        status: 'disabled'
      }
    })
  );
  assert.equal(disableError.code, 'LAST_DEVELOPER');
});

test('developer can list users but never receives OpenID in the response', async () => {
  const records = [
    {
      _id: 'usr_developer',
      _openid: 'openid_developer_0001',
      status: 'active',
      roles: ['developer'],
      createdAt: new Date('2026-10-12T00:00:00.000Z')
    },
    {
      _id: 'usr_student',
      _openid: 'openid_student_0001',
      status: 'active',
      roles: ['student'],
      createdAt: new Date('2026-10-13T00:00:00.000Z')
    }
  ];
  const repository = createRepository(USERS.developer, {
    queryAll: async () => records,
    getProfilesMap: async () =>
      new Map([['usr_student', { name: '模拟学生' }]])
  });
  const actions = createActions(repository);

  const result = await actions['admin.list_users']({
    identity: IDENTITIES.developer,
    payload: {}
  });

  assert.equal(result.users.length, 2);
  assert.equal(
    result.users.find((user) => user.userId === 'usr_developer').roles.includes('developer'),
    true
  );
  assert.equal(
    result.users.find((user) => user.userId === 'usr_student').displayName,
    '模拟学生'
  );
  assert.equal(JSON.stringify(result).includes('_openid'), false);
  assert.equal(JSON.stringify(result).includes('openid_'), false);
});

test('disabled account is rejected before any protected action runs', async () => {
  const repository = createRepository(USERS.disabledStudent);
  const actions = createActions(repository);

  const error = await captureError(
    actions['admin.list_users']({
      identity: IDENTITIES.student,
      payload: {}
    })
  );

  assert.equal(error.code, 'ACCOUNT_DISABLED');
});
