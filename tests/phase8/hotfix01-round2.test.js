'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createAuthActions = require('../../cloudfunctions/api/actions/auth');
const createGroupAdminActions = require('../../cloudfunctions/api/actions/groups');
const createUserAdminActions = require('../../cloudfunctions/api/actions/users');
const { deterministicId } = require('../../cloudfunctions/api/lib/repository');
const { IDENTITY, createFakeRepository } = require('./helpers');

function setup() {
  const repository = createFakeRepository();
  const developer = repository.seedStudent({
    _id: 'usr_dev_main',
    openid: 'openid_dev_main',
    status: 'active',
    roles: ['developer'],
    createdAt: new Date('2026-10-01T00:00:00Z')
  });
  repository.seedRoleBinding(developer._id, 'developer', 'active', {
    grantedBy: 'secure_bootstrap'
  });
  const actions = {
    ...createAuthActions({ repository }),
    ...createUserAdminActions({ repository }),
    ...createGroupAdminActions({ repository })
  };
  return { repository, developer, actions };
}

async function seedManagedUser(repository, overrides = {}) {
  const user = repository.seedStudent({
    _id: 'usr_managed',
    openid: 'openid_managed',
    status: 'active',
    roles: ['parent'],
    createdAt: new Date('2026-10-02T00:00:00Z'),
    ...overrides
  });
  const role = (user.roles || [])[0];
  if (role) {
    await repository.setRoleBinding({
      userId: user._id,
      role,
      grantedBy: 'usr_dev_main',
      active: true
    });
  }
  return user;
}

function seedTrainingGroup(repository, overrides = {}) {
  const groupId = overrides._id || 'group_unused';
  return repository.seedRecord('training_groups', {
    _id: groupId,
    groupId,
    name: '未使用训练组',
    seasonLabel: '2026',
    enabled: true,
    createdBy: 'usr_dev_main',
    ...overrides
  });
}

test('开发者用户管理可见删除账号入口与脱敏标识', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..', '..');
  const wxml = fs.readFileSync(
    path.join(root, 'miniprogram/pages/admin/admin.wxml'),
    'utf8'
  );
  assert.match(wxml, /bindtap="deleteUserAccount"/);
  assert.match(wxml, /删除账号/);
  assert.match(wxml, /identityHintText/);
  assert.doesNotMatch(wxml, /未完善真实姓名/);
  assert.match(wxml, /bindtap="toggleUserStatus"/);
  assert.match(wxml, /bindtap="deleteTrainingGroup"/);
  const js = fs.readFileSync(
    path.join(root, 'miniprogram/pages/admin/admin.js'),
    'utf8'
  );
  assert.match(js, /二次确认删除账号/);
  assert.match(js, /二次确认删除训练组/);
});

test('普通角色不能调用账号删除接口', async () => {
  const { repository, actions } = setup();
  const student = repository.seedStudent({
    _id: 'usr_student_actor',
    openid: 'openid_student_actor',
    status: 'active',
    roles: ['student']
  });
  const target = await seedManagedUser(repository, {
    _id: 'usr_target_regular',
    openid: 'openid_target_regular'
  });

  await assert.rejects(
    actions['admin.delete_user']({
      identity: IDENTITY(student.openid),
      payload: {
        targetUserId: target._id,
        confirmationText: 'DELETE_ACCOUNT',
        acknowledgeAssociations: true
      }
    }),
    (error) => error.code === 'FORBIDDEN'
  );
});

test('开发者不能删除自己，也不能删除任何合法开发者', async () => {
  const { repository, developer, actions } = setup();
  const otherDeveloper = repository.seedStudent({
    _id: 'usr_dev_other',
    openid: 'openid_dev_other',
    status: 'active',
    roles: ['developer']
  });

  await assert.rejects(
    actions['admin.delete_user']({
      identity: IDENTITY(developer.openid),
      payload: {
        targetUserId: developer._id,
        confirmationText: 'DELETE_ACCOUNT'
      }
    }),
    (error) => error.code === 'SELF_DELETE_FORBIDDEN'
  );
  await assert.rejects(
    actions['admin.delete_user']({
      identity: IDENTITY(developer.openid),
      payload: {
        targetUserId: otherDeveloper._id,
        confirmationText: 'DELETE_ACCOUNT'
      }
    }),
    (error) => error.code === 'DEVELOPER_DELETE_FORBIDDEN'
  );
});

test('账号删除前返回完整业务关联影响并要求显式确认', async () => {
  const { repository, developer, actions } = setup();
  const target = await seedManagedUser(repository);
  repository.seedProfile(target._id, {
    name: '',
    reviewStatus: 'pending',
    requestedTrainingGroupId: ''
  });
  repository.seedRecord('registration_reviews', {
    _id: 'review_pending',
    userId: target._id,
    status: 'pending',
    profileType: 'parent'
  });
  repository.seedRecord('group_memberships', {
    _id: 'member_active',
    groupId: 'group_member',
    userId: target._id,
    roleInGroup: 'parent',
    status: 'active'
  });
  repository.seedRecord('performance_records', {
    _id: 'performance_1',
    studentUserId: target._id,
    status: 'approved'
  });
  repository.seedRecord('parent_links', {
    _id: 'parent_link_1',
    kind: 'relation',
    status: 'active',
    parentUserId: target._id,
    studentUserId: 'usr_other_student'
  });

  const result = await actions['admin.get_user_deletion_impact']({
    identity: IDENTITY(developer.openid),
    payload: { targetUserId: target._id }
  });
  assert.equal(result.impact.requiresAcknowledgement, true);
  assert.equal(result.impact.associationCounts.activeRoleBindings, 1);
  assert.equal(result.impact.associationCounts.activeGroupMemberships, 1);
  assert.equal(result.impact.associationCounts.performanceRecords, 1);
  assert.equal(result.impact.associationCounts.activeParentLinks, 1);
  assert.match(result.impact.identityHint, /^账号尾号/);

  await assert.rejects(
    actions['admin.delete_user']({
      identity: IDENTITY(developer.openid),
      payload: {
        targetUserId: target._id,
        confirmationText: 'DELETE_ACCOUNT'
      }
    }),
    (error) => error.code === 'ACCOUNT_ASSOCIATIONS_REQUIRE_ACK'
  );
  assert.equal(repository.usersById.get(target._id).status, 'active');
});

test('账号逻辑删除撤销有效权限但保留历史业务记录', async () => {
  const { repository, developer, actions } = setup();
  const target = await seedManagedUser(repository);
  repository.seedProfile(target._id, {
    userId: target._id,
    reviewStatus: 'pending',
    requestedTrainingGroupId: ''
  });
  repository.seedRecord('registration_reviews', {
    _id: 'review_pending_delete',
    userId: target._id,
    status: 'pending',
    profileType: 'parent'
  });
  repository.seedRecord('group_memberships', {
    _id: 'member_delete',
    groupId: 'group_member',
    userId: target._id,
    roleInGroup: 'parent',
    status: 'active'
  });
  repository.seedRecord('parent_links', {
    _id: 'parent_link_delete',
    kind: 'relation',
    status: 'pending_review',
    parentUserId: target._id,
    studentUserId: 'usr_other_student'
  });
  repository.seedRecord('performance_records', {
    _id: 'performance_delete',
    studentUserId: target._id,
    status: 'approved'
  });

  const result = await actions['admin.delete_user']({
    identity: IDENTITY(developer.openid),
    payload: {
      targetUserId: target._id,
      confirmationText: 'DELETE_ACCOUNT',
      acknowledgeAssociations: true
    }
  });

  assert.equal(result.status, 'deleted');
  const user = repository.usersById.get(target._id);
  assert.equal(user.status, 'deleted');
  assert.deepEqual(user.roles, []);
  assert.equal(user.deletionMode, 'logical');
  assert.equal(
    repository.readCollection('role_bindings').find(
      (item) => item.userId === target._id
    ).status,
    'revoked'
  );
  assert.equal(
    repository.readCollection('group_memberships').find(
      (item) => item._id === 'member_delete'
    ).status,
    'inactive'
  );
  assert.equal(
    repository.readCollection('parent_links').find(
      (item) => item._id === 'parent_link_delete'
    ).status,
    'revoked'
  );
  assert.equal(
    repository.readCollection('student_profiles').find(
      (item) => item.userId === target._id
    ).reviewStatus,
    'rejected'
  );
  assert.equal(repository.readCollection('performance_records').length, 1);
  assert.equal(
    repository.readCollection('audit_logs').some(
      (item) => item.action === 'admin.user.deleted'
    ),
    true
  );
});

test('重复删除幂等且不会重复写删除审计', async () => {
  const { repository, developer, actions } = setup();
  const target = await seedManagedUser(repository, {
    _id: 'usr_repeat_delete',
    openid: 'openid_repeat_delete',
    roles: []
  });

  const first = await actions['admin.delete_user']({
    identity: IDENTITY(developer.openid),
    payload: {
      targetUserId: target._id,
      confirmationText: 'DELETE_ACCOUNT'
    }
  });
  const second = await actions['admin.delete_user']({
    identity: IDENTITY(developer.openid),
    payload: {
      targetUserId: target._id,
      confirmationText: 'DELETE_ACCOUNT'
    }
  });

  assert.equal(first.alreadyDeleted, false);
  assert.equal(second.alreadyDeleted, true);
  assert.equal(
    repository.readCollection('audit_logs').filter(
      (item) => item.action === 'admin.user.deleted'
    ).length,
    1
  );
});

test('删除账号事务失败时用户、角色和关联全部回滚', async () => {
  const { repository, developer, actions } = setup();
  const target = await seedManagedUser(repository, {
    _id: 'usr_rollback_delete',
    openid: 'openid_rollback_delete'
  });
  repository.seedRecord('parent_links', {
    _id: 'parent_link_rollback',
    kind: 'relation',
    status: 'active',
    parentUserId: target._id,
    studentUserId: 'usr_other_student'
  });
  const originalRunTransaction = repository.db.runTransaction.bind(repository.db);
  repository.db.runTransaction = async (handler) =>
    originalRunTransaction(async (transaction) => {
      const originalCollection = transaction.collection.bind(transaction);
      transaction.collection = (name) => {
        if (name === 'audit_logs') {
          return {
            doc: () => ({
              set: async () => {
                throw new Error('simulated account deletion audit failure');
              }
            })
          };
        }
        return originalCollection(name);
      };
      return handler(transaction);
    });

  await assert.rejects(
    actions['admin.delete_user']({
      identity: IDENTITY(developer.openid),
      payload: {
        targetUserId: target._id,
        confirmationText: 'DELETE_ACCOUNT',
        acknowledgeAssociations: true
      }
    }),
    /simulated account deletion audit failure/
  );

  assert.equal(repository.usersById.get(target._id).status, 'active');
  assert.deepEqual(repository.usersById.get(target._id).roles, ['parent']);
  assert.equal(
    repository.readCollection('role_bindings').find(
      (item) => item.userId === target._id
    ).status,
    'active'
  );
  assert.equal(
    repository.readCollection('parent_links').find(
      (item) => item._id === 'parent_link_rollback'
    ).status,
    'active'
  );
});

test('账号待处理关联合计超过事务安全上限时拒绝删除', async () => {
  const { repository, developer, actions } = setup();
  const target = await seedManagedUser(repository, {
    _id: 'usr_relation_limit',
    openid: 'openid_relation_limit',
    roles: []
  });
  for (let index = 0; index < 41; index += 1) {
    repository.seedRecord('group_memberships', {
      _id: `member_limit_${index}`,
      userId: target._id,
      groupId: `group_limit_${index}`,
      roleInGroup: 'student',
      status: 'active'
    });
  }

  await assert.rejects(
    actions['admin.delete_user']({
      identity: IDENTITY(developer.openid),
      payload: {
        targetUserId: target._id,
        confirmationText: 'DELETE_ACCOUNT',
        acknowledgeAssociations: true
      }
    }),
    (error) => error.code === 'ACCOUNT_DELETION_RELATION_LIMIT'
  );
  assert.equal(repository.usersById.get(target._id).status, 'active');
  assert.equal(
    repository.readCollection('group_memberships').filter(
      (item) => item.userId === target._id && item.status === 'active'
    ).length,
    41
  );
});

test('已删除账号再次登录被拒绝且不会静默恢复', async () => {
  const { repository, developer, actions } = setup();
  const target = await seedManagedUser(repository, {
    _id: 'usr_deleted_login',
    openid: 'openid_deleted_login',
    roles: []
  });
  await actions['admin.delete_user']({
    identity: IDENTITY(developer.openid),
    payload: {
      targetUserId: target._id,
      confirmationText: 'DELETE_ACCOUNT'
    }
  });

  await assert.rejects(
    actions['auth.login']({
      identity: IDENTITY(target.openid),
      payload: {}
    }),
    (error) => error.code === 'ACCOUNT_DELETED'
  );
  assert.equal(repository.usersById.get(target._id).status, 'deleted');
});

test('停用与删除保持不同语义，停用账号仍可重新启用', async () => {
  const { repository, developer, actions } = setup();
  const target = await seedManagedUser(repository, {
    _id: 'usr_disable_keep',
    openid: 'openid_disable_keep',
    roles: ['parent']
  });

  await actions['admin.set_user_status']({
    identity: IDENTITY(developer.openid),
    payload: { targetUserId: target._id, status: 'disabled' }
  });
  await actions['admin.set_user_status']({
    identity: IDENTITY(developer.openid),
    payload: { targetUserId: target._id, status: 'active' }
  });

  assert.equal(repository.usersById.get(target._id).status, 'active');
  assert.equal(
    repository.readCollection('audit_logs').some(
      (item) => item.action === 'admin.user.deleted'
    ),
    false
  );
});

test('已删除账号从开发者正常账号列表隐藏', async () => {
  const { repository, developer, actions } = setup();
  const target = await seedManagedUser(repository, {
    _id: 'usr_hidden_deleted',
    openid: 'openid_hidden_deleted',
    roles: []
  });
  await actions['admin.delete_user']({
    identity: IDENTITY(developer.openid),
    payload: {
      targetUserId: target._id,
      confirmationText: 'DELETE_ACCOUNT'
    }
  });
  const result = await actions['admin.list_users']({
    identity: IDENTITY(developer.openid),
    payload: {}
  });
  assert.equal(result.users.some((user) => user.userId === target._id), false);
});

test('普通角色不能调用训练组删除接口', async () => {
  const { repository, actions } = setup();
  const coach = repository.seedStudent({
    _id: 'usr_group_actor',
    openid: 'openid_group_actor',
    status: 'active',
    roles: ['coach']
  });
  const group = seedTrainingGroup(repository);
  await assert.rejects(
    actions['admin.delete_training_group']({
      identity: IDENTITY(coach.openid),
      payload: {
        trainingGroupId: group._id,
        confirmationText: 'DELETE_TRAINING_GROUP'
      }
    }),
    (error) => error.code === 'FORBIDDEN'
  );
});

test('无业务关联训练组安全归档、写审计并从正常列表隐藏', async () => {
  const { repository, developer, actions } = setup();
  const group = seedTrainingGroup(repository);

  const result = await actions['admin.delete_training_group']({
    identity: IDENTITY(developer.openid),
    payload: {
      trainingGroupId: group._id,
      confirmationText: 'DELETE_TRAINING_GROUP'
    }
  });
  assert.equal(result.status, 'deleted');
  assert.equal(result.alreadyDeleted, false);
  assert.equal(await repository.getTrainingGroup(group._id), null);
  const archived = await repository.getTrainingGroupIncludingDeleted(group._id);
  assert.equal(archived.status, 'deleted');
  assert.equal(archived.enabled, false);
  assert.equal(
    repository.readCollection('audit_logs').filter(
      (item) => item.action === 'admin.training_group.deleted'
    ).length,
    1
  );
  assert.equal(
    (await repository.listAllTrainingGroups()).some((item) => item._id === group._id),
    false
  );
});

test('训练组成员关联会阻止删除且不修改训练组', async () => {
  const { repository, developer, actions } = setup();
  const group = seedTrainingGroup(repository, { _id: 'group_with_member' });
  repository.seedRecord('group_memberships', {
    _id: 'member_block_group',
    groupId: group._id,
    userId: 'usr_member',
    roleInGroup: 'coach',
    status: 'active'
  });

  await assert.rejects(
    actions['admin.delete_training_group']({
      identity: IDENTITY(developer.openid),
      payload: {
        trainingGroupId: group._id,
        confirmationText: 'DELETE_TRAINING_GROUP'
      }
    }),
    (error) => error.code === 'TRAINING_GROUP_HAS_ASSOCIATIONS'
  );
  const current = await repository.getTrainingGroupIncludingDeleted(group._id);
  assert.equal(current.status || '', '');
  assert.equal(current.enabled, true);
});

test('训练计划等历史业务引用同样阻止训练组删除', async () => {
  const { repository, developer, actions } = setup();
  const group = seedTrainingGroup(repository, { _id: 'group_with_plan' });
  repository.seedRecord('training_plans', {
    _id: 'plan_for_group',
    trainingGroupId: group._id,
    status: 'published'
  });
  repository.seedRecord('competitions', {
    _id: 'competition_for_group',
    trainingGroupIds: [group._id]
  });

  await assert.rejects(
    actions['admin.delete_training_group']({
      identity: IDENTITY(developer.openid),
      payload: {
        trainingGroupId: group._id,
        confirmationText: 'DELETE_TRAINING_GROUP'
      }
    }),
    (error) => error.code === 'TRAINING_GROUP_HAS_ASSOCIATIONS'
  );
});

test('训练组重复删除幂等且不会重复写审计', async () => {
  const { repository, developer, actions } = setup();
  const group = seedTrainingGroup(repository, { _id: 'group_repeat_delete' });
  await actions['admin.delete_training_group']({
    identity: IDENTITY(developer.openid),
    payload: {
      trainingGroupId: group._id,
      confirmationText: 'DELETE_TRAINING_GROUP'
    }
  });
  const second = await actions['admin.delete_training_group']({
    identity: IDENTITY(developer.openid),
    payload: {
      trainingGroupId: group._id,
      confirmationText: 'DELETE_TRAINING_GROUP'
    }
  });
  assert.equal(second.alreadyDeleted, true);
  assert.equal(
    repository.readCollection('audit_logs').filter(
      (item) => item.action === 'admin.training_group.deleted'
    ).length,
    1
  );
});

test('已归档训练组不能通过同名创建接口静默恢复', async () => {
  const { repository, developer, actions } = setup();
  const group = seedTrainingGroup(repository, {
    _id: deterministicId('group', '同名训练组', '2026'),
    name: '同名训练组',
    seasonLabel: '2026'
  });
  await actions['admin.delete_training_group']({
    identity: IDENTITY(developer.openid),
    payload: {
      trainingGroupId: group._id,
      confirmationText: 'DELETE_TRAINING_GROUP'
    }
  });

  await assert.rejects(
    actions['admin.create_training_group']({
      identity: IDENTITY(developer.openid),
      payload: { name: '同名训练组', seasonLabel: '2026' }
    }),
    (error) => error.code === 'TRAINING_GROUP_DELETED_NAME_REUSED'
  );
});

test('账号和训练组删除都需要强确认文本，错误参数不能越权执行', async () => {
  const { repository, developer, actions } = setup();
  const target = await seedManagedUser(repository, {
    _id: 'usr_no_confirm',
    openid: 'openid_no_confirm',
    roles: []
  });
  const group = seedTrainingGroup(repository, { _id: 'group_no_confirm' });

  await assert.rejects(
    actions['admin.delete_user']({
      identity: IDENTITY(developer.openid),
      payload: { targetUserId: target._id, confirmationText: 'yes' }
    }),
    (error) => error.code === 'DELETE_CONFIRMATION_REQUIRED'
  );
  await assert.rejects(
    actions['admin.delete_training_group']({
      identity: IDENTITY(developer.openid),
      payload: { trainingGroupId: group._id, confirmationText: 'yes' }
    }),
    (error) => error.code === 'DELETE_CONFIRMATION_REQUIRED'
  );
  assert.equal(repository.usersById.get(target._id).status, 'active');
  assert.equal((await repository.getTrainingGroup(group._id)).enabled, true);
});
