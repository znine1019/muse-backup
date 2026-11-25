'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createAuthActions = require('../../cloudfunctions/api/actions/auth');
const createCoachActions = require('../../cloudfunctions/api/actions/coach');
const createDirectoryActions = require('../../cloudfunctions/api/actions/directory');
const createParentActions = require('../../cloudfunctions/api/actions/parent');
const createProfileActions = require('../../cloudfunctions/api/actions/profile');
const createRegistrationActions = require('../../cloudfunctions/api/actions/registrations');
const createUserAdminActions = require('../../cloudfunctions/api/actions/users');
const { IDENTITY, createFakeRepository } = require('./helpers');

const STUDENT_PAYLOAD = Object.freeze({
  name: '测试学生',
  gender: 'unspecified',
  birthDate: '2010-01-02',
  heightCm: 170,
  weightKg: 60,
  primaryTrainingProject: '短跑',
  requestedTrainingGroupId: ''
});

function setupActions(repository) {
  return {
    ...createAuthActions({ repository }),
    ...createCoachActions({ repository }),
    ...createDirectoryActions({ repository }),
    ...createParentActions({ repository }),
    ...createProfileActions({ repository }),
    ...createRegistrationActions({ repository }),
    ...createUserAdminActions({ repository })
  };
}

function collectionCount(repository, name) {
  return repository.readCollection(name).length;
}

function assertNoIdentitySecrets(record, identity) {
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes(identity.openid), false);
  assert.equal(serialized.includes(identity.unionid), false);
  assert.equal(serialized.includes('openid'), false);
  assert.equal(serialized.includes('unionid'), false);
  assert.equal(serialized.includes('token'), false);
}

test('V1.6.2 未注册微信身份登录只返回未注册会话，不创建账号或审计', async () => {
  const repository = createFakeRepository();
  const actions = setupActions(repository);
  const identity = {
    ...IDENTITY('openid_v162_unknown_login'),
    unionid: 'unionid_v162_unknown_login'
  };

  const result = await actions['auth.login']({ identity, payload: {} });

  assert.equal(result.registered, false);
  assert.equal(result.session.registered, false);
  assert.equal(result.session.user.status, 'unregistered');
  assert.deepEqual(result.session.user.roles, []);
  assert.equal(collectionCount(repository, 'users'), 0);
  assert.equal(collectionCount(repository, 'audit_logs'), 0);
  assert.equal(repository.counters.writes, 0);
  assert.equal(repository.counters.transactions, 0);
});

test('V1.6.2 三种实名注册在姓名为空或仅空格时均零事务零写入', async () => {
  const cases = [
    {
      action: 'profile.submit',
      payload: { ...STUDENT_PAYLOAD, name: '   ' }
    },
    {
      action: 'parent.submit_profile',
      payload: { name: '\t', relation: 'guardian' }
    },
    {
      action: 'coach.submit_profile',
      payload: { name: '  ', identityNote: '' }
    }
  ];

  for (const item of cases) {
    const repository = createFakeRepository();
    const actions = setupActions(repository);
    await assert.rejects(
      actions[item.action]({
        identity: IDENTITY(`openid_v162_blank_${item.action}`),
        payload: item.payload
      }),
      (error) => error.code === 'INVALID_FIELD'
    );
    assert.equal(collectionCount(repository, 'users'), 0, item.action);
    assert.equal(collectionCount(repository, 'audit_logs'), 0, item.action);
    assert.equal(repository.counters.writes, 0, item.action);
    assert.equal(repository.counters.transactions, 0, item.action);
  }
});

test('V1.6.2 首次有效实名提交原子创建唯一用户、资料、审核和成功审计', async () => {
  const cases = [
    {
      action: 'profile.submit',
      payload: STUDENT_PAYLOAD,
      profileCollection: 'student_profiles',
      profileType: 'student',
      auditAction: 'profile.submitted'
    },
    {
      action: 'parent.submit_profile',
      payload: { name: '测试家长', relation: 'guardian' },
      profileCollection: 'parent_profiles',
      profileType: 'parent',
      auditAction: 'parent.profile.submitted'
    },
    {
      action: 'coach.submit_profile',
      payload: { name: '测试教练', identityNote: '定向测试' },
      profileCollection: 'coach_profiles',
      profileType: 'coach',
      auditAction: 'coach.profile.submitted'
    }
  ];

  for (const item of cases) {
    const repository = createFakeRepository();
    const actions = setupActions(repository);
    const identity = IDENTITY(`openid_v162_valid_${item.profileType}`);
    const result = await actions[item.action]({
      identity,
      payload: item.payload
    });
    const userId = repository.userIdForIdentity(identity);

    assert.equal(collectionCount(repository, 'users'), 1, item.action);
    assert.equal(collectionCount(repository, item.profileCollection), 1, item.action);
    assert.equal(collectionCount(repository, 'registration_reviews'), 1, item.action);
    assert.equal(collectionCount(repository, 'audit_logs'), 1, item.action);
    assert.equal(collectionCount(repository, 'role_bindings'), 0, item.action);

    const user = repository.usersById.get(userId);
    const profile = repository.readCollection(item.profileCollection)[0];
    const review = repository.readCollection('registration_reviews')[0];
    const audit = repository.readCollection('audit_logs')[0];

    assert.equal(user.status, 'pending_review');
    assert.deepEqual(user.roles, []);
    assert.equal(user.pendingProfileType, item.profileType);
    assert.equal(profile.userId, userId);
    assert.equal(profile.reviewStatus, 'pending');
    assert.equal(review.userId, userId);
    assert.equal(review.profileType, item.profileType);
    assert.equal(review.status, 'pending');
    assert.equal(audit.action, item.auditAction);
    assert.equal(audit.result, 'success');
    assert.equal(audit.actorUserId, userId);
    assertNoIdentitySecrets(user, identity);
    assertNoIdentitySecrets(profile, identity);
    assertNoIdentitySecrets(review, identity);
    assertNoIdentitySecrets(audit, identity);
  }
});

test('V1.6.2 重复与并发实名提交不会产生重复用户、资料或审核', async () => {
  const repository = createFakeRepository();
  const actions = setupActions(repository);
  const identity = IDENTITY('openid_v162_concurrent_student');

  const [first, second] = await Promise.all([
    actions['profile.submit']({ identity, payload: STUDENT_PAYLOAD }),
    actions['profile.submit']({ identity, payload: STUDENT_PAYLOAD })
  ]);
  const duplicate = await actions['profile.submit']({
    identity,
    payload: STUDENT_PAYLOAD
  });

  assert.equal(
    [first, second].every((item) => typeof item.duplicate === 'boolean'),
    true
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(collectionCount(repository, 'users'), 1);
  assert.equal(collectionCount(repository, 'student_profiles'), 1);
  assert.equal(collectionCount(repository, 'registration_reviews'), 1);
  assert.equal(collectionCount(repository, 'audit_logs'), 1);
});

test('V1.6.2 客户端伪造 userId 不参与可信身份建号', async () => {
  const repository = createFakeRepository();
  const actions = setupActions(repository);
  const identity = IDENTITY('openid_v162_forged_user_id');

  const result = await actions['coach.submit_profile']({
    identity,
    payload: {
      userId: 'usr_forged_by_client',
      openid: 'openid_forged_by_client',
      roles: ['developer'],
      name: '测试教练',
      identityNote: ''
    }
  });

  const expectedUserId = repository.userIdForIdentity(identity);
  assert.equal(result.profile.userId, expectedUserId);
  assert.equal(repository.usersById.has('usr_forged_by_client'), false);
  assert.equal(repository.usersById.get(expectedUserId).status, 'pending_review');
  assert.deepEqual(repository.usersById.get(expectedUserId).roles, []);
});

test('V1.6.2 已审核 Developer+Coach 登录和角色保持不变', async () => {
  const repository = createFakeRepository();
  const user = repository.seedStudent({
    _id: 'usr_v162_dual_role',
    openid: 'openid_v162_dual_role',
    status: 'active',
    roles: ['developer', 'coach']
  });
  repository.seedCoachProfile(user._id, {
    name: '测试双角色',
    reviewStatus: 'approved'
  });
  const actions = setupActions(repository);
  const writesBefore = repository.counters.writes;

  const result = await actions['auth.login']({
    identity: IDENTITY(user.openid),
    payload: {}
  });

  assert.equal(result.session.registered, true);
  assert.equal(result.session.user.status, 'active');
  assert.deepEqual(result.session.user.roles, ['developer', 'coach']);
  assert.equal(result.session.capabilities.developer, true);
  assert.equal(result.session.capabilities.coach, true);
  assert.deepEqual(repository.usersById.get(user._id).roles, [
    'developer',
    'coach'
  ]);
  assert.equal(repository.counters.writes, writesBefore);
});

test('V1.6.2 Developer 账号与待审列表排除无实名资料账号并保留实名待审申请', async () => {
  const repository = createFakeRepository();
  const developer = repository.seedStudent({
    _id: 'usr_v162_developer',
    openid: 'openid_v162_developer',
    status: 'active',
    roles: ['developer']
  });
  repository.seedCoachProfile(developer._id, {
    name: '测试开发者',
    reviewStatus: 'approved'
  });

  const namedStudent = repository.seedStudent({
    _id: 'usr_v162_named_student',
    openid: 'openid_v162_named_student',
    status: 'pending_review',
    roles: [],
    pendingProfileType: 'student'
  });
  repository.seedProfile(namedStudent._id, {
    userId: namedStudent._id,
    name: '实名待审学生',
    reviewStatus: 'pending'
  });
  repository.seedRecord('registration_reviews', {
    _id: 'review_v162_named_student',
    userId: namedStudent._id,
    profileType: 'student',
    status: 'pending'
  });

  const blankStudent = repository.seedStudent({
    _id: 'usr_v162_blank_student',
    openid: 'openid_v162_blank_student',
    status: 'pending_review',
    roles: [],
    pendingProfileType: 'student'
  });
  repository.seedProfile(blankStudent._id, {
    name: '   ',
    reviewStatus: 'pending'
  });
  repository.seedRecord('registration_reviews', {
    _id: 'review_v162_blank_student',
    userId: blankStudent._id,
    profileType: 'student',
    status: 'pending'
  });

  const unnamed = repository.seedStudent({
    _id: 'usr_v162_unnamed',
    openid: 'openid_v162_unnamed',
    status: 'pending_profile',
    roles: []
  });

  const namedPendingCoach = repository.seedStudent({
    _id: 'usr_v162_named_coach',
    openid: 'openid_v162_named_coach',
    status: 'pending_review',
    roles: [],
    pendingProfileType: 'coach'
  });
  repository.seedCoachProfile(namedPendingCoach._id, {
    name: '实名待审教练',
    reviewStatus: 'pending'
  });

  const namedPendingParent = repository.seedStudent({
    _id: 'usr_v162_named_parent',
    openid: 'openid_v162_named_parent',
    status: 'pending_review',
    roles: [],
    pendingProfileType: 'parent'
  });
  repository.seedParentProfile(namedPendingParent._id, {
    userId: namedPendingParent._id,
    name: '实名待审家长',
    reviewStatus: 'pending'
  });

  const actions = setupActions(repository);
  const usersResult = await actions['admin.list_users']({
    identity: IDENTITY(developer.openid),
    payload: {}
  });
  const userIds = usersResult.users.map((item) => item.userId);

  assert.equal(userIds.includes(namedStudent._id), true);
  assert.equal(userIds.includes(namedPendingCoach._id), true);
  assert.equal(userIds.includes(namedPendingParent._id), true);
  assert.equal(userIds.includes(blankStudent._id), false);
  assert.equal(userIds.includes(unnamed._id), false);
  assert.equal(
    usersResult.users.every((item) => item.hasRealName === true),
    true
  );

  const registrations = await actions['admin.list_pending_registrations']({
    identity: IDENTITY(developer.openid),
    payload: {}
  });
  const registrationUserIds = registrations.registrations.map(
    (item) => item.userId
  );
  assert.equal(registrationUserIds.includes(namedStudent._id), true);
  assert.equal(registrationUserIds.includes(namedPendingCoach._id), true);
  assert.equal(registrationUserIds.includes(namedPendingParent._id), true);
  assert.equal(registrationUserIds.includes(blankStudent._id), false);
  assert.equal(registrationUserIds.includes(unnamed._id), false);
});

test('V1.6.2 未注册身份可读取启用训练组但停用账号仍被拒绝', async () => {
  const repository = createFakeRepository();
  repository.seedRecord('training_groups', {
    _id: 'group_v162_registration',
    name: '实名注册可选训练组',
    seasonLabel: '2026',
    enabled: true
  });
  const actions = setupActions(repository);

  const beforeWrites = repository.counters.writes;
  const directory = await actions['directory.list_training_groups']({
    identity: IDENTITY('openid_v162_directory_unregistered'),
    payload: {}
  });
  assert.equal(directory.groups.length, 1);
  assert.equal(repository.counters.writes, beforeWrites);

  repository.seedStudent({
    _id: 'usr_v162_directory_disabled',
    openid: 'openid_v162_directory_disabled',
    status: 'disabled',
    roles: []
  });
  await assert.rejects(
    actions['directory.list_training_groups']({
      identity: IDENTITY('openid_v162_directory_disabled'),
      payload: {}
    }),
    (error) => error.code === 'ACCOUNT_DISABLED'
  );
});

test('V1.6.2 旧admin.assign_role不能绕过学生实名审核', async () => {
  const repository = createFakeRepository();
  const developer = repository.seedStudent({
    _id: 'usr_v162_role_developer',
    openid: 'openid_v162_role_developer',
    status: 'active',
    roles: ['developer']
  });
  repository.seedCoachProfile(developer._id, {
    name: '测试开发者',
    reviewStatus: 'approved'
  });
  const target = repository.seedStudent({
    _id: 'usr_v162_role_unnamed',
    openid: 'openid_v162_role_unnamed',
    status: 'pending_profile',
    roles: []
  });
  const actions = setupActions(repository);
  const writesBefore = repository.counters.writes;

  await assert.rejects(
    actions['admin.assign_role']({
      identity: IDENTITY(developer.openid),
      payload: { targetUserId: target._id, role: 'student', grant: true }
    }),
    (error) => error.code === 'STUDENT_REGISTRATION_APPROVAL_REQUIRED'
  );
  assert.deepEqual(repository.usersById.get(target._id).roles, []);
  assert.equal(repository.counters.writes, writesBefore);
});
