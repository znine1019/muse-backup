'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createProfileActions = require('../../cloudfunctions/api/actions/profile');

const STUDENT = { _id: 'usr_student_a', status: 'active', roles: ['student'] };
const COACH = { _id: 'usr_coach_a', status: 'active', roles: ['coach'] };
const DEVELOPER = {
  _id: 'usr_developer',
  status: 'active',
  roles: ['developer']
};
const IDENTITIES = {
  student: { appid: 'wx_test_app', openid: 'openid_student_0001' },
  coach: { appid: 'wx_test_app', openid: 'openid_coach_0001' },
  developer: { appid: 'wx_test_app', openid: 'openid_developer_0001' }
};

function clone(value) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)])
    );
  }
  return value;
}

function createHarness() {
  const state = {
    profiles: new Map([
      [
        'profile_usr_student_a',
        {
          _id: 'profile_usr_student_a',
          userId: STUDENT._id,
          name: '模拟学生',
          gender: 'unspecified',
          birthDate: '2010-01-02',
          heightCm: 170,
          weightKg: 60,
          primaryTrainingProject: '短跑',
          requestedTrainingGroupId: 'group_a',
          reviewStatus: 'approved',
          schemaVersion: 1
        }
      ],
      [
        'profile_usr_student_b',
        {
          _id: 'profile_usr_student_b',
          userId: 'usr_student_b',
          name: '模拟学生乙',
          gender: 'unspecified',
          birthDate: '2009-01-02',
          reviewStatus: 'approved',
          schemaVersion: 1
        }
      ]
    ]),
    measurements: new Map(),
    performances: new Map(),
    audits: new Map(),
    users: new Map([
      [STUDENT._id, clone(STUDENT)],
      ['usr_student_b', { _id: 'usr_student_b', status: 'active', roles: ['student'] }],
      [COACH._id, clone(COACH)],
      [DEVELOPER._id, clone(DEVELOPER)]
    ])
  };
  const writes = [];

  function collectionState(collectionName) {
    if (collectionName === 'student_profiles') {
      return state.profiles;
    }
    if (collectionName === 'body_measurements') {
      return state.measurements;
    }
    if (collectionName === 'audit_logs') {
      return state.audits;
    }
    throw new Error(`Unexpected collection: ${collectionName}`);
  }

  function createReference(collectionName, id) {
    const collection = collectionState(collectionName);
    return {
      async get() {
        if (!collection.has(id)) {
          throw new Error('document not found');
        }
        return { data: clone(collection.get(id)) };
      },
      async set({ data }) {
        writes.push({ collectionName, id, data: clone(data) });
        collection.set(id, { _id: id, ...clone(data) });
      },
      async update({ data }) {
        const current = collection.get(id);
        if (!current) {
          throw new Error('document not found');
        }
        collection.set(id, { ...current, ...clone(data) });
      }
    };
  }

  const repository = {
    ensureUser: async (identity) => {
      if (identity.openid === IDENTITIES.student.openid) {
        return clone(STUDENT);
      }
      if (identity.openid === IDENTITIES.coach.openid) {
        return clone(COACH);
      }
      return clone(DEVELOPER);
    },
    profileIdForUser: (userId) => `profile_${userId}`,
    ensureUserById: (userId) => state.users.get(userId) || null,
    getUserById: async (userId) => clone(state.users.get(userId) || null),
    getProfile: async (userId) =>
      clone(state.profiles.get(`profile_${userId}`) || null),
    listAllProfiles: async () => Array.from(state.profiles.values()).map(clone),
    getProfilesMap: async (userIds) =>
      new Map(
        userIds
          .map((userId) => state.profiles.get(`profile_${userId}`))
          .filter(Boolean)
          .map((profile) => [profile.userId, clone(profile)])
      ),
    measurementIdForUser: (userId, measuredAt, heightCm, weightKg) =>
      `measure_${userId}_${measuredAt}_${heightCm}_${weightKg}`,
    listMeasurements: async (userId) =>
      Array.from(state.measurements.values())
        .filter((item) => item.userId === userId)
        .map(clone),
    listPerformanceRecords: async () => [],
    getCoachGroupIds: async () => ['group_a'],
    getStudentUserIdsForGroups: async (groupIds) => {
      const map = { group_a: [STUDENT._id], group_b: ['usr_student_b'] };
      return groupIds.flatMap((groupId) => map[groupId] || []);
    },
    db: {
      serverDate: () => new Date(),
      async runTransaction(work) {
        return work({
          collection(collectionName) {
            return {
              doc(id) {
                return createReference(collectionName, id);
              }
            };
          }
        });
      }
    }
  };

  return { repository, state, writes };
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to be rejected');
}

test('student updates only own extended profile and writes audit', async () => {
  const harness = createHarness();
  const actions = createProfileActions({ repository: harness.repository });

  const result = await actions['profile.update']({
    identity: IDENTITIES.student,
    payload: {
      primaryEventCode: '100m',
      secondaryEventCodes: ['long_jump'],
      trainingStartYear: 2023,
      trainingExperienceSummary: '模拟训练经历',
      examGoal: { targetScore: '12秒', examYear: 2027 }
    }
  });

  assert.equal(result.profile.primaryEventCode, '100m');
  assert.deepEqual(result.profile.secondaryEventCodes, ['long_jump']);
  assert.equal(harness.state.audits.size, 1);
  assert.equal(
    harness.state.audits.get([...harness.state.audits.keys()][0]).action,
    'profile.updated'
  );
});

test('height and weight measurement updates profile history without repeated _id field', async () => {
  const harness = createHarness();
  const actions = createProfileActions({ repository: harness.repository });

  const first = await actions['profile.add_measurement']({
    identity: IDENTITIES.student,
    payload: { heightCm: 172, weightKg: 61, measuredAt: '2026-10-01' }
  });
  const second = await actions['profile.add_measurement']({
    identity: IDENTITIES.student,
    payload: { heightCm: 172, weightKg: 61, measuredAt: '2026-10-01' }
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(harness.state.measurements.size, 1);
  const measurement = [...harness.state.measurements.values()][0];
  assert.equal(measurement.heightCm, 172);
  assert.equal(measurement.weightKg, 61);
  assert.equal(
    harness.state.profiles.get('profile_usr_student_a').currentHeightCm,
    172
  );
  const measurementWrite = harness.writes.find(
    (write) => write.collectionName === 'body_measurements'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(measurementWrite.data, '_id'),
    false
  );
});

test('coach profile access is limited to assigned groups', async () => {
  const harness = createHarness();
  const actions = createProfileActions({ repository: harness.repository });

  const own = await actions['admin.get_student_profile']({
    identity: IDENTITIES.coach,
    payload: { targetUserId: STUDENT._id }
  });
  assert.equal(own.profile.userId, STUDENT._id);

  const error = await captureError(
    actions['admin.get_student_profile']({
      identity: IDENTITIES.coach,
      payload: { targetUserId: 'usr_student_b' }
    })
  );
  assert.equal(error.code, 'OUT_OF_SCOPE');
});

test('student cannot read another student profile through the admin action', async () => {
  const harness = createHarness();
  const actions = createProfileActions({ repository: harness.repository });
  const error = await captureError(
    actions['admin.get_student_profile']({
      identity: IDENTITIES.student,
      payload: { targetUserId: 'usr_student_b' }
    })
  );
  assert.equal(error.code, 'FORBIDDEN');
});
