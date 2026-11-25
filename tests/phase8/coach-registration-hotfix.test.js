'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const createCoachActions = require('../../cloudfunctions/api/actions/coach');
const createRegistrationActions = require('../../cloudfunctions/api/actions/registrations');
const createUserAdminActions = require('../../cloudfunctions/api/actions/users');
const { IDENTITY, createFakeRepository } = require('./helpers');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function setup() {
  const repository = createFakeRepository();
  const developer = repository.seedStudent({
    _id: 'usr_dev',
    openid: 'openid_dev',
    status: 'active',
    roles: ['developer'],
    createdAt: new Date('2026-10-01T00:00:00Z')
  });
  repository.seedRoleBinding(developer._id, 'developer', 'active', {
    grantedBy: 'secure_bootstrap'
  });
  const actions = {
    ...createCoachActions({ repository }),
    ...createRegistrationActions({ repository }),
    ...createUserAdminActions({ repository })
  };
  return { repository, developer, actions };
}

async function submitCoachProfile(actions, openid, payload = {}) {
  return actions['coach.submit_profile']({
    identity: IDENTITY(openid),
    payload: {
      name: '王教练',
      identityNote: '短跑项目执教',
      ...payload
    }
  });
}

async function approveCoach(actions, developer, targetUserId) {
  return actions['admin.review_registration']({
    identity: IDENTITY(developer.openid),
    payload: {
      targetUserId,
      decision: 'approve',
      profileType: 'coach',
      comment: '实名资料核验通过'
    }
  });
}

test('新教练注册提交实名资料后进入待审核且不直接获得coach角色', async () => {
  const { repository, actions } = setup();
  const result = await submitCoachProfile(actions, 'openid_new_coach');

  assert.equal(result.status, 'pending_review');
  assert.deepEqual(result.profile.name, '王教练');
  assert.equal(result.profile.reviewStatus, 'pending');

  const user = repository.usersById.get(result.profile.userId);
  assert.equal(user.status, 'pending_review');
  assert.deepEqual(user.roles, []);
  assert.equal(user.pendingProfileType, 'coach');

  const profiles = repository.readCollection('coach_profiles');
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, '王教练');
  assert.equal(profiles[0].reviewStatus, 'pending');

  const reviews = repository.readCollection('registration_reviews');
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].profileType, 'coach');
  assert.equal(reviews[0].status, 'pending');

  const audits = repository.readCollection('audit_logs');
  assert.equal(audits.some((item) => item.action === 'coach.profile.submitted'), true);
});

test('空白教练姓名被服务端拒绝且不写入资料或审核记录', async () => {
  const { repository, actions } = setup();
  await assert.rejects(
    submitCoachProfile(actions, 'openid_blank_coach', { name: '   ' }),
    (error) => error.code === 'INVALID_FIELD'
  );
  assert.equal(repository.readCollection('coach_profiles').length, 0);
  assert.equal(repository.readCollection('registration_reviews').length, 0);
  assert.equal(repository.readCollection('audit_logs').length, 0);
});

test('待审教练实名资料不能重复提交并生成多个待审记录', async () => {
  const { repository, actions } = setup();
  await submitCoachProfile(actions, 'openid_duplicate_coach');
  await assert.rejects(
    submitCoachProfile(actions, 'openid_duplicate_coach', { name: '王教练二' }),
    (error) => error.code === 'REVIEW_ALREADY_PENDING'
  );

  assert.equal(repository.readCollection('coach_profiles').length, 1);
  assert.equal(repository.readCollection('registration_reviews').length, 1);
  assert.equal(
    repository.readCollection('audit_logs').filter(
      (item) => item.action === 'coach.profile.submitted'
    ).length,
    1
  );
});

test('开发者审核通过新教练后授予角色并建立绑定', async () => {
  const { repository, developer, actions } = setup();
  const submitted = await submitCoachProfile(actions, 'openid_new_coach');
  const user = repository.usersById.get(submitted.profile.userId);

  const result = await approveCoach(actions, developer, user._id);
  assert.equal(result.status, 'active');
  assert.deepEqual(result.roles, ['coach']);

  const updated = repository.usersById.get(user._id);
  assert.equal(updated.status, 'active');
  assert.deepEqual(updated.roles, ['coach']);
  assert.equal(updated.pendingProfileType, '');

  const binding = repository
    .readCollection('role_bindings')
    .find((item) => item.userId === user._id && item.role === 'coach');
  assert.equal(binding.status, 'active');

  const audit = repository
    .readCollection('audit_logs')
    .find((item) => item.action === 'admin.registration.approved');
  assert.equal(audit.metadata.profileType, 'coach');
});

test('历史已开通教练补实名资料时保持active和coach角色', async () => {
  const { repository, actions } = setup();
  const legacy = repository.seedStudent({
    _id: 'usr_legacy_coach',
    openid: 'openid_legacy_coach',
    status: 'active',
    roles: ['coach'],
    createdAt: new Date('2026-10-02T00:00:00Z')
  });

  const result = await submitCoachProfile(actions, legacy.openid, {
    name: '李教练'
  });
  assert.equal(result.status, 'active');
  assert.equal(result.profile.source, 'legacy_backfill');

  const updated = repository.usersById.get(legacy._id);
  assert.equal(updated.status, 'active');
  assert.deepEqual(updated.roles, ['coach']);
  assert.equal(updated.pendingProfileType, 'coach');
});

test('历史教练实名审核通过时保留原有效角色绑定来源', async () => {
  const { repository, developer, actions } = setup();
  const legacy = repository.seedStudent({
    _id: 'usr_legacy_binding',
    openid: 'openid_legacy_binding',
    status: 'active',
    roles: ['coach'],
    createdAt: new Date('2026-10-02T01:00:00Z')
  });
  await repository.setRoleBinding({
    userId: legacy._id,
    role: 'coach',
    grantedBy: 'usr_original_grantor',
    active: true
  });
  await submitCoachProfile(actions, legacy.openid, { name: '历史教练' });
  await approveCoach(actions, developer, legacy._id);

  const binding = repository
    .readCollection('role_bindings')
    .find((item) => item.userId === legacy._id && item.role === 'coach');
  assert.equal(binding.status, 'active');
  assert.equal(binding.grantedBy, 'usr_original_grantor');
});

test('教练资料驳回后重新提交并批准时保留两轮审核与审计记录', async () => {
  const { repository, developer, actions } = setup();
  const firstSubmission = await submitCoachProfile(actions, 'openid_retry_coach');
  const user = repository.usersById.get(firstSubmission.profile.userId);

  await actions['admin.review_registration']({
    identity: IDENTITY(developer.openid),
    payload: {
      targetUserId: user._id,
      decision: 'reject',
      profileType: 'coach',
      comment: '请补充身份说明'
    }
  });
  await submitCoachProfile(actions, 'openid_retry_coach', {
    name: '王教练',
    identityNote: '补充后重新提交'
  });
  await approveCoach(actions, developer, user._id);

  assert.equal(repository.readCollection('registration_reviews').length, 2);
  const reviewAudits = repository
    .readCollection('audit_logs')
    .filter((item) =>
      ['admin.registration.approved', 'admin.registration.rejected'].includes(
        item.action
      )
    );
  assert.equal(reviewAudits.length, 2);
  assert.equal(new Set(reviewAudits.map((item) => item._id)).size, 2);
});

test('pending_profile账号不能被普通admin.assign_role直接授予coach', async () => {
  const { repository, developer, actions } = setup();
  const pending = repository.seedStudent({
    _id: 'usr_pending',
    openid: 'openid_pending',
    status: 'pending_profile',
    roles: [],
    createdAt: new Date('2026-10-03T00:00:00Z')
  });

  await assert.rejects(
    actions['admin.assign_role']({
      identity: IDENTITY(developer.openid),
      payload: { targetUserId: pending._id, role: 'coach', grant: true }
    }),
    (error) => error.code === 'COACH_REGISTRATION_APPROVAL_REQUIRED'
  );
  assert.deepEqual(repository.usersById.get(pending._id).roles, []);
  assert.equal(
    repository
      .readCollection('role_bindings')
      .filter((item) => item.userId === pending._id && item.role === 'coach').length,
    0
  );
});

test('已通过实名审核的教练可以由开发者恢复coach角色', async () => {
  const { repository, developer, actions } = setup();
  const coach = repository.seedStudent({
    _id: 'usr_approved_coach',
    openid: 'openid_approved_coach',
    status: 'pending_profile',
    roles: [],
    createdAt: new Date('2026-10-04T00:00:00Z')
  });
  repository.seedCoachProfile(coach._id, {
    name: '赵教练',
    reviewStatus: 'approved'
  });

  const result = await actions['admin.assign_role']({
    identity: IDENTITY(developer.openid),
    payload: { targetUserId: coach._id, role: 'coach', grant: true }
  });
  assert.equal(result.status, 'active');
  assert.deepEqual(result.roles, ['coach']);
});

test('开发者待审列表包含教练实名注册', async () => {
  const { repository, developer, actions } = setup();
  await submitCoachProfile(actions, 'openid_new_coach');
  const result = await actions['admin.list_pending_registrations']({
    identity: IDENTITY(developer.openid),
    payload: {}
  });
  assert.equal(result.registrations.length, 1);
  assert.equal(result.registrations[0].profileType, 'coach');
  assert.equal(result.registrations[0].name, '王教练');
  assert.equal(result.registrations[0].coachIdentityNote, '短跑项目执教');
});

test('教练不能审核教练实名注册', async () => {
  const { repository, actions } = setup();
  const coach = repository.seedStudent({
    _id: 'usr_reviewer_coach',
    openid: 'openid_reviewer_coach',
    status: 'active',
    roles: ['coach'],
    createdAt: new Date('2026-10-05T00:00:00Z')
  });
  const pending = repository.seedStudent({
    _id: 'usr_pending_coach',
    openid: 'openid_pending_coach',
    status: 'pending_review',
    roles: [],
    pendingProfileType: 'coach',
    createdAt: new Date('2026-10-06T00:00:00Z')
  });
  repository.seedCoachProfile(pending._id, {
    name: '待审教练',
    reviewStatus: 'pending'
  });

  await assert.rejects(
    actions['admin.review_registration']({
      identity: IDENTITY(coach.openid),
      payload: {
        targetUserId: pending._id,
        decision: 'approve',
        profileType: 'coach'
      }
    }),
    (error) => error.code === 'OUT_OF_SCOPE'
  );
});

test('开发者账号列表优先显示教练实名姓名且无姓名账号使用统一占位', async () => {
  const { repository, developer, actions } = setup();
  repository.seedStudent({
    _id: 'usr_named_coach',
    openid: 'openid_named_coach',
    status: 'active',
    roles: ['coach'],
    createdAt: new Date('2026-10-07T00:00:00Z')
  });
  repository.seedCoachProfile('usr_named_coach', {
    name: '实名教练',
    reviewStatus: 'approved'
  });
  repository.seedStudent({
    _id: 'usr_empty',
    openid: 'openid_empty',
    status: 'pending_profile',
    roles: [],
    createdAt: new Date('2026-10-08T00:00:00Z')
  });

  const result = await actions['admin.list_users']({
    identity: IDENTITY(developer.openid),
    payload: {}
  });
  const named = result.users.find((item) => item.userId === 'usr_named_coach');
  assert.equal(named.displayName, '实名教练');
  assert.equal(named.hasRealName, true);
  assert.equal(named.coachProfileApproved, true);
  assert.equal(result.users.some((item) => item.userId === 'usr_empty'), false);
});

test('多角色账号优先资料无姓名时可回退显示其他已实名资料', async () => {
  const { repository, developer, actions } = setup();
  const user = repository.seedStudent({
    _id: 'usr_multi_role',
    openid: 'openid_multi_role',
    status: 'active',
    roles: ['student', 'coach'],
    createdAt: new Date('2026-10-09T00:00:00Z')
  });
  repository.seedProfile(user._id, {
    name: '已有学生实名',
    reviewStatus: 'approved'
  });
  repository.seedCoachProfile(user._id, {
    name: '',
    reviewStatus: 'pending'
  });

  const result = await actions['admin.list_users']({
    identity: IDENTITY(developer.openid),
    payload: {}
  });
  const listed = result.users.find((item) => item.userId === user._id);
  assert.equal(listed.displayName, '已有学生实名');
  assert.equal(listed.hasRealName, true);
});

test('重复提交已approved教练资料被拒绝', async () => {
  const { repository, actions } = setup();
  const coach = repository.seedStudent({
    _id: 'usr_done_coach',
    openid: 'openid_done_coach',
    status: 'active',
    roles: ['coach'],
    createdAt: new Date('2026-10-09T00:00:00Z')
  });
  repository.seedCoachProfile(coach._id, {
    name: '已完成教练',
    reviewStatus: 'approved'
  });

  await assert.rejects(
    submitCoachProfile(actions, coach.openid),
    (error) => error.code === 'COACH_PROFILE_APPROVED'
  );
});

test('教练实名注册页面已注册且包含真实姓名强制提示', () => {
  const appJson = JSON.parse(read('miniprogram/app.json'));
  const page = read('miniprogram/pages/coach-register/coach-register.wxml');
  assert.equal(appJson.pages.includes('pages/coach-register/coach-register'), true);
  assert.match(page, /请填写您本人的真实姓名/);
  assert.match(page, /禁止使用微信昵称、网名、虚假姓名或他人姓名/);
  assert.match(page, /wx:if="\{\{canSubmit\}\}"/);
  assert.match(page, /wx:if="\{\{isActiveCoach\}\}"/);
});

test('开发者账号管理只展示服务端过滤后的实名账号', () => {
  const source = read('miniprogram/pages/admin/admin.js');
  const template = read('miniprogram/pages/admin/admin.wxml');
  const backend = read('cloudfunctions/api/actions/users.js');
  assert.match(backend, /filter\(\(entry\) => entry\.hasRealName\)/);
  assert.match(source, /filterUsers\(allUsers/);
  assert.match(source, /有姓名/);
  assert.doesNotMatch(source, /无姓名/);
  assert.match(template, /userNameFilters/);
  assert.match(template, /申请角色/);
  assert.match(template, /首次登录/);
});
