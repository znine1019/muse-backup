'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createProfileActions = require('../../cloudfunctions/api/actions/profile');

const IDENTITY = {
  appid: 'wx_test_app',
  openid: 'openid_student_0001'
};

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to be rejected');
}

test('duplicate pending profile submission is idempotent and starts no transaction', async () => {
  let transactionCalls = 0;
  const repository = {
    ensureUser: async () => ({
      _id: 'usr_student',
      status: 'pending_review',
      roles: []
    }),
    db: {
      async runTransaction() {
        transactionCalls += 1;
        throw new Error('transaction should not start');
      }
    }
  };
  const actions = createProfileActions({ repository });

  const result = await actions['profile.submit']({
    identity: IDENTITY,
    payload: {},
    context: {}
  });

  assert.deepEqual(result, {
    userStatus: 'pending_review',
    reviewStatus: 'pending',
    duplicate: true
  });
  assert.equal(transactionCalls, 0);
});

test('student cannot submit a disabled or missing training group', async () => {
  let transactionCalls = 0;
  const repository = {
    ensureUser: async () => ({
      _id: 'usr_student',
      status: 'pending_profile',
      roles: []
    }),
    getTrainingGroup: async () => ({
      _id: 'group_disabled',
      enabled: false
    }),
    db: {
      async runTransaction() {
        transactionCalls += 1;
      }
    }
  };
  const actions = createProfileActions({ repository });

  const error = await captureError(
    actions['profile.submit']({
      identity: IDENTITY,
      payload: {
        name: '模拟学生',
        gender: 'unspecified',
        birthDate: '2010-01-02',
        heightCm: 170,
        weightKg: 60,
        primaryTrainingProject: '短跑',
        requestedTrainingGroupId: 'group_disabled'
      },
      context: {}
    })
  );

  assert.equal(error.code, 'INVALID_TRAINING_GROUP');
  assert.equal(transactionCalls, 0);
});
