'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createRegistrationActions = require('../../cloudfunctions/api/actions/registrations');

const DEVELOPER = {
  _id: 'usr_developer',
  status: 'active',
  roles: ['developer']
};
const STUDENT = {
  _id: 'usr_student',
  status: 'pending_review',
  roles: []
};
const IDENTITY = {
  appid: 'wx_test_app',
  openid: 'openid_developer_0001'
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

function createTransactionHarness() {
  const documents = new Map([
    [
      'users/usr_student',
      {
        _id: STUDENT._id,
        status: 'pending_review',
        roles: []
      }
    ],
    [
      'student_profiles/profile_student',
      {
        _id: 'profile_student',
        userId: STUDENT._id,
        reviewStatus: 'pending',
        requestedTrainingGroupId: 'group_a',
        currentReviewId: 'review_1'
      }
    ],
    [
      'registration_reviews/review_1',
      {
        _id: 'review_1',
        userId: STUDENT._id,
        profileId: 'profile_student',
        status: 'pending',
        comment: ''
      }
    ]
  ]);
  const writes = [];

  function createReference(collectionName, id) {
    const key = `${collectionName}/${id}`;
    return {
      async get() {
        if (!documents.has(key)) {
          throw new Error('document not found');
        }
        return { data: clone(documents.get(key)) };
      },
      async update({ data }) {
        const current = documents.get(key);
        if (!current) {
          throw new Error('document not found');
        }
        const next = { ...current, ...clone(data) };
        documents.set(key, next);
        writes.push({ type: 'update', collectionName, id, data: clone(data) });
        return {};
      },
      async set({ data }) {
        documents.set(key, { _id: id, ...clone(data) });
        writes.push({ type: 'set', collectionName, id, data: clone(data) });
        return {};
      }
    };
  }

  return {
    documents,
    writes,
    transaction: {
      collection(collectionName) {
        return {
          doc(id) {
            return createReference(collectionName, id);
          }
        };
      }
    }
  };
}

test('developer approval grants student access and writes scoped audit records', async () => {
  const harness = createTransactionHarness();
  let transactionCalls = 0;
  const repository = {
    ensureUser: async () => DEVELOPER,
    getUserById: async () => clone(STUDENT),
    getProfile: async () => clone(harness.documents.get('student_profiles/profile_student')),
    getCoachGroupIds: async () => [],
    profileIdForUser: () => 'profile_student',
    roleBindingId: (userId, role) => `role_${role}_${userId}`,
    membershipId: (groupId, userId) => `member_${groupId}_${userId}`,
    db: {
      async runTransaction(work) {
        transactionCalls += 1;
        return work(harness.transaction);
      },
      serverDate: () => new Date()
    }
  };
  const actions = createRegistrationActions({ repository });

  const result = await actions['admin.review_registration']({
    identity: IDENTITY,
    payload: {
      targetUserId: STUDENT._id,
      decision: 'approve',
      comment: '模拟测试通过'
    }
  });

  assert.equal(transactionCalls, 1);
  assert.equal(result.status, 'active');
  assert.deepEqual(result.roles, ['student']);
  assert.deepEqual(
    harness.documents.get('users/usr_student').roles,
    ['student']
  );
  assert.equal(
    harness.documents.get('student_profiles/profile_student').reviewStatus,
    'approved'
  );

  const roleWrite = harness.writes.find(
    (write) => write.collectionName === 'role_bindings'
  );
  const membershipWrite = harness.writes.find(
    (write) => write.collectionName === 'group_memberships'
  );
  const auditWrite = harness.writes.find(
    (write) => write.collectionName === 'audit_logs'
  );

  assert.equal(roleWrite.data.role, 'student');
  assert.equal(roleWrite.data.status, 'active');
  assert.equal(membershipWrite.data.groupId, 'group_a');
  assert.equal(membershipWrite.data.roleInGroup, 'student');
  assert.equal(membershipWrite.data.status, 'active');
  assert.equal(auditWrite.data.action, 'admin.registration.approved');
  assert.equal(auditWrite.data.result, 'success');
});
