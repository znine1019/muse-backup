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

function cloneDocuments(source) {
  return new Map(
    Array.from(source.entries()).map(([key, value]) => [key, clone(value)])
  );
}

function createTransactionHarness(options = {}) {
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
        name: '模拟学生',
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
  let workingDocuments = null;

  function shouldFail(type, collectionName) {
    return options.failOn === `${collectionName}_${type}`;
  }

  function createReference(collectionName, id) {
    const key = `${collectionName}/${id}`;
    return {
      async get() {
        if (!workingDocuments.has(key)) {
          throw new Error('document not found');
        }
        return { data: clone(workingDocuments.get(key)) };
      },
      async update({ data }) {
        if (shouldFail('update', collectionName)) {
          throw new Error('simulated transaction update failure');
        }
        const current = workingDocuments.get(key);
        if (!current) {
          throw new Error('document not found');
        }
        const next = { ...current, ...clone(data) };
        workingDocuments.set(key, next);
        writes.push({ type: 'update', collectionName, id, data: clone(data) });
        return {};
      },
      async set({ data }) {
        if (shouldFail('set', collectionName)) {
          throw new Error('simulated transaction set failure');
        }
        workingDocuments.set(key, { _id: id, ...clone(data) });
        writes.push({ type: 'set', collectionName, id, data: clone(data) });
        return {};
      }
    };
  }

  const transaction = {
    collection(collectionName) {
      return {
        doc(id) {
          return createReference(collectionName, id);
        }
      };
    }
  };

  return {
    documents,
    writes,
    transaction,
    async runTransaction(work) {
      workingDocuments = cloneDocuments(documents);
      const writesBefore = writes.length;
      try {
        const result = await work(transaction);
        documents.clear();
        for (const [key, value] of workingDocuments.entries()) {
          documents.set(key, value);
        }
        return result;
      } catch (error) {
        writes.length = writesBefore;
        throw error;
      } finally {
        workingDocuments = null;
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
        return harness.runTransaction(work);
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

test('registration approval failure rolls back every partial write', async () => {
  const harness = createTransactionHarness({ failOn: 'audit_logs_set' });
  let transactionCalls = 0;
  const repository = {
    ensureUser: async () => DEVELOPER,
    getUserById: async () => clone(STUDENT),
    getProfile: async () =>
      clone(harness.documents.get('student_profiles/profile_student')),
    getCoachGroupIds: async () => [],
    profileIdForUser: () => 'profile_student',
    roleBindingId: (userId, role) => `role_${role}_${userId}`,
    membershipId: (groupId, userId) => `member_${groupId}_${userId}`,
    db: {
      async runTransaction(work) {
        transactionCalls += 1;
        return harness.runTransaction(work);
      },
      serverDate: () => new Date()
    }
  };
  const actions = createRegistrationActions({ repository });
  const before = cloneDocuments(harness.documents);

  await assert.rejects(
    actions['admin.review_registration']({
      identity: IDENTITY,
      payload: {
        targetUserId: STUDENT._id,
        decision: 'approve',
        comment: '模拟失败回滚'
      }
    }),
    /simulated transaction set failure/
  );

  assert.equal(transactionCalls, 1);
  assert.deepEqual(harness.documents, before);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.documents.get('users/usr_student').status, 'pending_review');
  assert.deepEqual(harness.documents.get('users/usr_student').roles, []);
  assert.equal(
    harness.documents.get('student_profiles/profile_student').reviewStatus,
    'pending'
  );
  assert.equal(harness.documents.has('role_bindings/role_student_usr_student'), false);
  assert.equal(harness.documents.has('group_memberships/member_group_a_usr_student'), false);
});
