'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createProfileActions = require('../../cloudfunctions/api/actions/profile');

const IDENTITY = {
  appid: 'wx_test_app',
  openid: 'openid_student_0001'
};

test('concurrent pending profile submissions create only one profile and one review', async () => {
  const state = {
    user: {
      _id: 'usr_student',
      status: 'pending_profile',
      roles: []
    },
    profiles: new Map(),
    reviews: new Map(),
    audits: new Map()
  };
  let transactionTail = Promise.resolve();
  const writes = [];

  function collectionState(collectionName) {
    if (collectionName === 'users') {
      return {
        get: () => state.user,
        set: (value) => {
          state.user = { ...value };
        }
      };
    }
    if (collectionName === 'student_profiles') {
      return state.profiles;
    }
    if (collectionName === 'registration_reviews') {
      return state.reviews;
    }
    if (collectionName === 'audit_logs') {
      return state.audits;
    }
    throw new Error(`Unexpected collection: ${collectionName}`);
  }

  function createReference(collectionName, id) {
    const collection = collectionState(collectionName);
    if (collectionName === 'users') {
      return {
        async get() {
          return { data: { ...collection.get() } };
        },
        async set({ data }) {
          collection.set(data);
        },
        async update({ data }) {
          collection.set({ ...collection.get(), ...data });
        }
      };
    }
    return {
      async get() {
        if (!collection.has(id)) {
          throw new Error('document not found');
        }
        return { data: { ...collection.get(id) } };
      },
      async set({ data }) {
        collection.set(id, { _id: id, ...data });
        writes.push({ collectionName, id, data: { ...data } });
      },
      async update({ data }) {
        collection.set(id, { ...(collection.get(id) || {}), ...data });
      }
    };
  }

  const repository = {
    ensureUser: async () => ({ ...state.user }),
    getTrainingGroup: async () => ({ _id: 'group_a', enabled: true }),
    profileIdForUser: () => 'profile_student',
    db: {
      serverDate: () => new Date(),
      runTransaction(work) {
        const next = transactionTail.then(() =>
          work({
            collection(collectionName) {
              return {
                doc(id) {
                  return createReference(collectionName, id);
                }
              };
            }
          })
        );
        transactionTail = next.catch(() => undefined);
        return next;
      }
    }
  };
  const actions = createProfileActions({ repository });
  const payload = {
    name: '模拟并发学生',
    gender: 'unspecified',
    birthDate: '2010-01-02',
    heightCm: 170,
    weightKg: 60,
    primaryTrainingProject: '短跑',
    requestedTrainingGroupId: 'group_a'
  };

  const [first, second] = await Promise.all([
    actions['profile.submit']({
      identity: IDENTITY,
      payload,
      context: { requestId: 'request_a' }
    }),
    actions['profile.submit']({
      identity: IDENTITY,
      payload,
      context: { requestId: 'request_b' }
    })
  ]);

  assert.equal([first.duplicate, second.duplicate].filter(Boolean).length, 1);
  assert.equal(state.user.status, 'pending_review');
  assert.equal(state.profiles.size, 1);
  assert.equal(state.reviews.size, 1);
  assert.equal(state.audits.size, 1);

  const profileWrite = writes.find(
    (write) => write.collectionName === 'student_profiles'
  );
  const reviewWrite = writes.find(
    (write) => write.collectionName === 'registration_reviews'
  );
  assert.equal(profileWrite.id, 'profile_student');
  assert.equal(Object.prototype.hasOwnProperty.call(profileWrite.data, '_id'), false);
  assert.equal(reviewWrite.id.startsWith('review_'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(reviewWrite.data, '_id'), false);
  assert.equal(reviewWrite.data.profileId, 'profile_student');
});
