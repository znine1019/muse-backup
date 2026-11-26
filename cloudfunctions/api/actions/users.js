'use strict';

const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  MEMBERSHIP_STATUS,
  PARENT_LINK_KIND,
  PARENT_LINK_STATUS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { deterministicId } = require('../lib/repository');
const { hasRealNameProfile } = require('../lib/profile-name');
const { loadActiveActor } = require('../lib/session');
const {
  nextParentAuthorizationVersion,
  parentAuthorizationVersion
} = require('../lib/policy');
const { getDocumentOrNull } = require('../lib/transaction');
const {
  validateRolePayload,
  safeId,
  validateUserDeletionPayload,
  validateUserStatusPayload
} = require('../lib/validation');

// Each revocation performs 4 + 3N transaction operations. Keep N at 20
// so the worst case is 64 operations, below CloudBase's 100-operation limit.
const MAX_PARENT_LINKS_PER_REVOCATION = 20;
const REVOCABLE_PARENT_LINK_STATUSES = Object.freeze([
  PARENT_LINK_STATUS.ACTIVE,
  PARENT_LINK_STATUS.PENDING_STUDENT,
  PARENT_LINK_STATUS.PENDING_REVIEW
]);
const MAX_ACCOUNT_DELETION_RELATIONS = 40;
const ADMIN_GUARD_DOC_ID = 'bootstrap';
const MAX_ADMIN_USER_LIST = 1000;

function createUserAdminActions({ repository }) {
  async function loadDeveloperActorInTransaction(transaction, actorUserId) {
    const actorReference = transaction
      .collection(COLLECTIONS.USERS)
      .doc(actorUserId);
    const actor = await getDocumentOrNull(actorReference);
    if (
      !actor ||
      actor.status !== USER_STATUS.ACTIVE ||
      !(actor.roles || []).includes(ROLES.DEVELOPER)
    ) {
      fail('FORBIDDEN', '当前账号的开发者权限已失效，请重新登录。');
    }
    const bindingReference = transaction
      .collection(COLLECTIONS.ROLE_BINDINGS)
      .doc(repository.roleBindingId(actorUserId, ROLES.DEVELOPER));
    const binding = await getDocumentOrNull(bindingReference);
    if (!binding || binding.status !== 'active') {
      fail('FORBIDDEN', '当前账号的开发者绑定无效，请重新登录。');
    }
    return actor;
  }

  async function loadAdminGuardInTransaction(transaction) {
    const guardReference = transaction
      .collection(COLLECTIONS.SYSTEM_CONFIG)
      .doc(ADMIN_GUARD_DOC_ID);
    const guard = await getDocumentOrNull(guardReference);
    if (!guard || guard.state !== 'completed') {
      fail('ADMIN_GUARD_NOT_READY', '开发者安全保护配置尚未完成初始化。');
    }
    const version = Number(guard.adminGuardVersion);
    return {
      reference: guardReference,
      version: Number.isSafeInteger(version) && version >= 0 ? version : 0
    };
  }

  async function loadActiveDeveloperUsersInTransaction(transaction) {
    const result = await transaction
      .collection(COLLECTIONS.USERS)
      .where({ roles: ROLES.DEVELOPER })
      .limit(100)
      .get();
    const users = (result.data || []).filter(
      (user) => user.status === USER_STATUS.ACTIVE
    );
    if (!users.length) {
      return [];
    }
    const bindings = await transaction
      .collection(COLLECTIONS.ROLE_BINDINGS)
      .where({ role: ROLES.DEVELOPER, status: 'active' })
      .limit(100)
      .get();
    const activeUserIds = new Set(
      (bindings.data || []).map((binding) => binding.userId).filter(Boolean)
    );
    return users.filter((user) => activeUserIds.has(user._id));
  }

  async function writeAdminGuardVersion(transaction, guard, now) {
    const nextVersion = guard.version + 1;
    await guard.reference.update({
      data: {
        adminGuardVersion: nextVersion,
        adminGuardUpdatedAt: now
      }
    });
    return nextVersion;
  }

  async function loadRoleBindingInTransaction(transaction, userId, role) {
    return getDocumentOrNull(
      transaction
        .collection(COLLECTIONS.ROLE_BINDINGS)
        .doc(repository.roleBindingId(userId, role))
    );
  }

  async function writeRoleAuditInTransaction(params) {
    const {
      transaction,
      actorUserId,
      targetUserId,
      role,
      action,
      now,
      guardVersion
    } = params;
    const auditId = deterministicId(
      'audit_role_mutation',
      targetUserId,
      role,
      action,
      String(guardVersion === undefined ? now.getTime() : guardVersion)
    );
    await transaction
      .collection(COLLECTIONS.AUDIT_LOGS)
      .doc(auditId)
      .set({
        data: {
          actorUserId,
          action,
          targetType: 'user',
          targetId: targetUserId,
          result: 'success',
          metadata: { role },
          createdAt: now
        }
      });
  }
  async function revokeParentRole({ actor, targetUser }) {
    const links = await repository.queryAll(
      repository.parentLinkCollection,
      {
        kind: PARENT_LINK_KIND.RELATION,
        parentUserId: targetUser._id,
        status: repository.db.command.in(REVOCABLE_PARENT_LINK_STATUSES)
      },
      MAX_PARENT_LINKS_PER_REVOCATION + 1
    );
    if (links.length > MAX_PARENT_LINKS_PER_REVOCATION) {
      fail(
        'PARENT_LINK_REVOKE_LIMIT',
        '待失效的亲子关联过多，请分批处理后重试。'
      );
    }

    const currentRoles = Array.isArray(targetUser.roles) ? targetUser.roles : [];
    if (!currentRoles.includes(ROLES.PARENT) && !links.length) {
      return {
        userId: targetUser._id,
        status: targetUser.status,
        roles: currentRoles,
        revokedLinkCount: 0
      };
    }

    return repository.db.runTransaction(async (transaction) => {
      const userReference = transaction
        .collection(COLLECTIONS.USERS)
        .doc(targetUser._id);
      const currentUser = await getDocumentOrNull(userReference);
      if (!currentUser) {
        fail('USER_NOT_FOUND', '未找到目标用户。');
      }

      const currentUserRoles = Array.isArray(currentUser.roles)
        ? currentUser.roles
        : [];
      const nextRoles = currentUserRoles.filter((role) => role !== ROLES.PARENT);
      let nextStatus = currentUser.status;
      if (currentUser.status !== USER_STATUS.DISABLED && !nextRoles.length) {
        nextStatus = USER_STATUS.PENDING_PROFILE;
      }
      const nextVersion = nextParentAuthorizationVersion(currentUser);
      const timestamp = repository.db.serverDate();

      await userReference.update({
        data: {
          status: nextStatus,
          roles: nextRoles,
          parentAuthorizationVersion: nextVersion,
          updatedAt: timestamp
        }
      });

      await transaction
        .collection(COLLECTIONS.ROLE_BINDINGS)
        .doc(repository.roleBindingId(currentUser._id, ROLES.PARENT))
        .set({
          data: {
            userId: currentUser._id,
            role: ROLES.PARENT,
            status: 'revoked',
            grantedBy: actor._id,
            revokedAt: timestamp,
            updatedAt: timestamp
          }
        });

      let revokedLinkCount = 0;
      for (const link of links) {
        const reference = transaction
          .collection(COLLECTIONS.PARENT_LINKS)
          .doc(link._id);
        const currentLink = await getDocumentOrNull(reference);
        if (
          !currentLink ||
          !REVOCABLE_PARENT_LINK_STATUSES.includes(currentLink.status)
        ) {
          continue;
        }
        await reference.update({
          data: {
            status: PARENT_LINK_STATUS.REVOKED,
            revokedBy: actor._id,
            revokedAt: timestamp,
            revokeReason: 'parent_role_revoked',
            revokedByRoleChange: true,
            authorizationVersionAtRevocation: parentAuthorizationVersion(currentLink),
            updatedAt: timestamp
          }
        });
        await transaction
          .collection(COLLECTIONS.AUDIT_LOGS)
          .doc(
            deterministicId(
              'audit_parent_link_role_revoke',
              currentLink._id,
              actor._id,
              String(nextVersion)
            )
          )
          .set({
            data: {
              actorUserId: actor._id,
              action: AUDIT_ACTIONS.PARENT_LINK_REVOKED,
              targetType: 'parent_link',
              targetId: currentLink._id,
              result: 'success',
              metadata: {
                reason: 'parent_role_revoked',
                parentUserId: currentUser._id
              },
              createdAt: timestamp
            }
          });
        revokedLinkCount += 1;
      }

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(
          deterministicId(
            'audit_role_parent_revoke',
            currentUser._id,
            actor._id,
            String(nextVersion)
          )
        )
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.ROLE_REVOKED,
            targetType: 'user',
            targetId: currentUser._id,
            result: 'success',
            metadata: {
              role: ROLES.PARENT,
              revokedLinkCount,
              parentAuthorizationVersion: nextVersion
            },
            createdAt: timestamp
          }
        });

      return {
        userId: currentUser._id,
        status: nextStatus,
        roles: nextRoles,
        revokedLinkCount,
        parentAuthorizationVersion: nextVersion
      };
    });
  }


  function identityHint(userId) {
    const compact = String(userId || '').replace(/[^A-Za-z0-9]/g, '');
    return compact ? `账号尾号${compact.slice(-4).toUpperCase()}` : '账号尾号未知';
  }

  async function buildUserDeletionImpact(targetUser) {
    const userId = targetUser._id;
    const parentStatuses = repository.db.command.in(REVOCABLE_PARENT_LINK_STATUSES);
    const counts = await Promise.all([
      repository.countWhere(repository.profileCollection, { userId }),
      repository.countWhere(repository.parentProfileCollection, { userId }),
      repository.countWhere(repository.coachProfileCollection, { userId }),
      repository.countWhere(repository.reviewCollection, { userId }),
      repository.countWhere(repository.roleCollection, { userId }),
      repository.countWhere(repository.roleCollection, { userId, status: 'active' }),
      repository.countWhere(repository.membershipCollection, { userId }),
      repository.countWhere(repository.membershipCollection, {
        userId,
        status: MEMBERSHIP_STATUS.ACTIVE
      }),
      repository.countWhere(repository.bodyMeasurementCollection, { userId }),
      repository.countWhere(repository.performanceCollection, { studentUserId: userId }),
      repository.countWhere(repository.trainingPlanCollection, { coachUserId: userId }),
      repository.countWhere(repository.attendanceSessionCollection, { createdBy: userId }),
      repository.countWhere(repository.attendanceRecordCollection, { studentUserId: userId }),
      repository.countWhere(repository.leaveRequestCollection, { studentUserId: userId }),
      repository.countWhere(repository.competitionCollection, { createdBy: userId }),
      repository.countWhere(repository.competitionRegistrationCollection, {
        studentUserId: userId
      }),
      repository.countWhere(repository.clubNoticeCollection, { createdBy: userId }),
      repository.countWhere(repository.noticeReadCollection, { studentUserId: userId }),
      repository.countWhere(repository.trainingFeedbackCollection, { studentUserId: userId }),
      repository.countWhere(repository.parentLinkCollection, { parentUserId: userId }),
      repository.countWhere(repository.parentLinkCollection, { studentUserId: userId }),
      repository.countWhere(repository.parentLinkCollection, {
        parentUserId: userId,
        kind: PARENT_LINK_KIND.RELATION,
        status: parentStatuses
      }),
      repository.countWhere(repository.parentLinkCollection, {
        studentUserId: userId,
        kind: PARENT_LINK_KIND.RELATION,
        status: parentStatuses
      }),
      repository.countWhere(repository.groupCollection, { createdBy: userId }),
      repository.countWhere(repository.auditCollection, { actorUserId: userId })
    ]);
    const [
      studentProfileCount,
      parentProfileCount,
      coachProfileCount,
      registrationReviewCount,
      roleBindingCount,
      activeRoleBindingCount,
      groupMembershipCount,
      activeGroupMembershipCount,
      bodyMeasurementCount,
      performanceRecordCount,
      trainingPlanCount,
      attendanceSessionCount,
      attendanceRecordCount,
      leaveRequestCount,
      competitionCount,
      competitionRegistrationCount,
      noticeCount,
      noticeReadCount,
      trainingFeedbackCount,
      parentLinkAsParentCount,
      parentLinkAsStudentCount,
      activeParentLinkAsParentCount,
      activeParentLinkAsStudentCount,
      createdTrainingGroupCount,
      auditLogCount
    ] = counts;
    const associationCounts = {
      studentProfiles: studentProfileCount,
      parentProfiles: parentProfileCount,
      coachProfiles: coachProfileCount,
      registrationReviews: registrationReviewCount,
      roleBindings: roleBindingCount,
      activeRoleBindings: activeRoleBindingCount,
      groupMemberships: groupMembershipCount,
      activeGroupMemberships: activeGroupMembershipCount,
      bodyMeasurements: bodyMeasurementCount,
      performanceRecords: performanceRecordCount,
      trainingPlans: trainingPlanCount,
      attendanceSessions: attendanceSessionCount,
      attendanceRecords: attendanceRecordCount,
      leaveRequests: leaveRequestCount,
      competitions: competitionCount,
      competitionRegistrations: competitionRegistrationCount,
      notices: noticeCount,
      noticeReads: noticeReadCount,
      trainingFeedback: trainingFeedbackCount,
      parentLinks: parentLinkAsParentCount + parentLinkAsStudentCount,
      activeParentLinks:
        activeParentLinkAsParentCount + activeParentLinkAsStudentCount,
      createdTrainingGroups: createdTrainingGroupCount,
      auditLogs: auditLogCount
    };
    const protectedDeveloper =
      (targetUser.roles || []).includes(ROLES.DEVELOPER) ||
      (activeRoleBindingCount > 0 &&
        (await repository.countWhere(repository.roleCollection, {
          userId,
          role: ROLES.DEVELOPER,
          status: 'active'
        })) > 0);
    const deleted = targetUser.status === USER_STATUS.DELETED;
    const businessAssociationCount =
      studentProfileCount +
      parentProfileCount +
      coachProfileCount +
      registrationReviewCount +
      roleBindingCount +
      groupMembershipCount +
      bodyMeasurementCount +
      performanceRecordCount +
      trainingPlanCount +
      attendanceSessionCount +
      attendanceRecordCount +
      leaveRequestCount +
      competitionCount +
      competitionRegistrationCount +
      noticeCount +
      noticeReadCount +
      trainingFeedbackCount +
      parentLinkAsParentCount +
      parentLinkAsStudentCount +
      createdTrainingGroupCount;

    return {
      targetUserId: userId,
      identityHint: identityHint(userId),
      status: targetUser.status,
      roles: Array.isArray(targetUser.roles) ? targetUser.roles : [],
      deleted,
      protectedDeveloper,
      businessAssociationCount,
      requiresAcknowledgement:
        businessAssociationCount > 0 && !deleted && !protectedDeveloper,
      canDelete:
        !deleted && !protectedDeveloper,
      associationCounts
    };
  }

  async function loadUserDeletionRelations(targetUser) {
    const userId = targetUser._id;
    const [roleBindings, memberships, linksAsParent, linksAsStudent, pendingReviews] =
      await Promise.all([
        repository.queryAll(
          repository.roleCollection,
          { userId, status: 'active' },
          MAX_ACCOUNT_DELETION_RELATIONS + 1
        ),
        repository.queryAll(
          repository.membershipCollection,
          { userId, status: MEMBERSHIP_STATUS.ACTIVE },
          MAX_ACCOUNT_DELETION_RELATIONS + 1
        ),
        repository.queryAll(
          repository.parentLinkCollection,
          {
            parentUserId: userId,
            kind: PARENT_LINK_KIND.RELATION,
            status: repository.db.command.in(REVOCABLE_PARENT_LINK_STATUSES)
          },
          MAX_ACCOUNT_DELETION_RELATIONS + 1
        ),
        repository.queryAll(
          repository.parentLinkCollection,
          {
            studentUserId: userId,
            kind: PARENT_LINK_KIND.RELATION,
            status: repository.db.command.in(REVOCABLE_PARENT_LINK_STATUSES)
          },
          MAX_ACCOUNT_DELETION_RELATIONS + 1
        ),
        repository.queryAll(
          repository.reviewCollection,
          { userId, status: 'pending' },
          MAX_ACCOUNT_DELETION_RELATIONS + 1
        )
      ]);
    const parentLinks = Array.from(
      new Map(
        linksAsParent.concat(linksAsStudent).map((link) => [link._id, link])
      ).values()
    );
    const profiles = [
      {
        collectionName: COLLECTIONS.STUDENT_PROFILES,
        profile: await repository.getProfile(userId)
      },
      {
        collectionName: COLLECTIONS.PARENT_PROFILES,
        profile: await repository.getParentProfile(userId)
      },
      {
        collectionName: COLLECTIONS.COACH_PROFILES,
        profile: await repository.getCoachProfile(userId)
      }
    ]
      .filter((item) => item.profile)
      .map((item) => ({ ...item.profile, collectionName: item.collectionName }));
    const mutableRelationCount =
      roleBindings.length +
      memberships.length +
      parentLinks.length +
      pendingReviews.length +
      profiles.filter((profile) => profile.reviewStatus === 'pending').length;
    if (mutableRelationCount > MAX_ACCOUNT_DELETION_RELATIONS) {
      fail(
        'ACCOUNT_DELETION_RELATION_LIMIT',
        '账号待处理关联过多，请先由开发者人工清理关联后再删除。'
      );
    }
    return { roleBindings, memberships, parentLinks, pendingReviews, profiles };
  }

  async function loadUserDeletionRelationsInTransaction(transaction, targetUser) {
    const userId = targetUser._id;
    const parentStatuses = repository.db.command.in(REVOCABLE_PARENT_LINK_STATUSES);
    const [
      roleBindingsResult,
      membershipsResult,
      linksAsParentResult,
      linksAsStudentResult,
      pendingReviewsResult
    ] = await Promise.all([
      transaction
        .collection(COLLECTIONS.ROLE_BINDINGS)
        .where({ userId, status: 'active' })
        .limit(MAX_ACCOUNT_DELETION_RELATIONS + 1)
        .get(),
      transaction
        .collection(COLLECTIONS.GROUP_MEMBERSHIPS)
        .where({ userId, status: MEMBERSHIP_STATUS.ACTIVE })
        .limit(MAX_ACCOUNT_DELETION_RELATIONS + 1)
        .get(),
      transaction
        .collection(COLLECTIONS.PARENT_LINKS)
        .where({
          parentUserId: userId,
          kind: PARENT_LINK_KIND.RELATION,
          status: parentStatuses
        })
        .limit(MAX_ACCOUNT_DELETION_RELATIONS + 1)
        .get(),
      transaction
        .collection(COLLECTIONS.PARENT_LINKS)
        .where({
          studentUserId: userId,
          kind: PARENT_LINK_KIND.RELATION,
          status: parentStatuses
        })
        .limit(MAX_ACCOUNT_DELETION_RELATIONS + 1)
        .get(),
      transaction
        .collection(COLLECTIONS.REGISTRATION_REVIEWS)
        .where({ userId, status: 'pending' })
        .limit(MAX_ACCOUNT_DELETION_RELATIONS + 1)
        .get()
    ]);
    const parentLinks = Array.from(
      new Map(
        (linksAsParentResult.data || [])
          .concat(linksAsStudentResult.data || [])
          .map((link) => [link._id, link])
      ).values()
    );
    const profileSpecs = [
      {
        collectionName: COLLECTIONS.STUDENT_PROFILES,
        profileId: repository.profileIdForUser(userId)
      },
      {
        collectionName: COLLECTIONS.PARENT_PROFILES,
        profileId: repository.parentProfileIdForUser(userId)
      },
      {
        collectionName: COLLECTIONS.COACH_PROFILES,
        profileId: repository.coachProfileIdForUser(userId)
      }
    ];
    const profiles = [];
    for (const spec of profileSpecs) {
      const profile = await getDocumentOrNull(
        transaction.collection(spec.collectionName).doc(spec.profileId)
      );
      if (profile) {
        profiles.push({ ...profile, collectionName: spec.collectionName });
      }
    }
    const mutableRelationCount =
      (roleBindingsResult.data || []).length +
      (membershipsResult.data || []).length +
      parentLinks.length +
      (pendingReviewsResult.data || []).length +
      profiles.filter((profile) => profile.reviewStatus === 'pending').length;
    if (mutableRelationCount > MAX_ACCOUNT_DELETION_RELATIONS) {
      fail(
        'ACCOUNT_DELETION_RELATION_LIMIT',
        '账号待处理关联过多，请先由开发者人工清理关联后再删除。'
      );
    }
    return {
      roleBindings: roleBindingsResult.data || [],
      memberships: membershipsResult.data || [],
      parentLinks,
      pendingReviews: pendingReviewsResult.data || [],
      profiles,
      mutableRelationCount
    };
  }

  async function listUsers({ identity }) {
    await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const allUsers = await repository.queryAll(
      repository.userCollection,
      null,
      MAX_ADMIN_USER_LIST + 1
    );
    if (allUsers.length > MAX_ADMIN_USER_LIST) {
      fail(
        'USER_LIST_LIMIT_EXCEEDED',
        '用户数量超过当前管理页安全上限，请先启用分页后再操作。'
      );
    }
    const users = allUsers
      .filter((user) => user.status !== USER_STATUS.DELETED)
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt || 0).getTime();
        const rightTime = new Date(right.createdAt || 0).getTime();
        return rightTime - leftTime;
      });
    const userIds = users.map((user) => user._id);
    const [studentProfiles, parentProfiles, coachProfiles] = await Promise.all([
      repository.getProfilesMap(userIds),
      repository.getParentProfilesMap(userIds),
      repository.getCoachProfilesMap(userIds)
    ]);

    const projectedUsers = users
      .map((user) => {
        const roles = Array.isArray(user.roles) ? user.roles : [];
        const pendingProfileType = user.pendingProfileType || '';
        const studentProfile = studentProfiles.get(user._id) || null;
        const parentProfile = parentProfiles.get(user._id) || null;
        const coachProfile = coachProfiles.get(user._id) || null;
        const rolePreferredProfile =
          roles.includes(ROLES.COACH) || pendingProfileType === ROLES.COACH
            ? coachProfile
            : roles.includes(ROLES.PARENT) || pendingProfileType === ROLES.PARENT
              ? parentProfile
              : studentProfile;
        /* 多角色账号优先当前角色资料；该资料未填姓名时回退到其他已实名资料 */
        const preferredProfile =
          [rolePreferredProfile, coachProfile, parentProfile, studentProfile].find(
            (profile) => String((profile && profile.name) || '').trim()
          ) || rolePreferredProfile;
        const preferredName = String(
          (preferredProfile && preferredProfile.name) || ''
        ).trim();
        return {
          userId: user._id,
          identityHint: identityHint(user._id),
          status: user.status,
          roles,
          displayName: preferredName || '未完善真实姓名',
          hasRealName: Boolean(preferredName),
          pendingProfileType,
          reviewStatus: (preferredProfile && preferredProfile.reviewStatus) || '',
          coachProfileApproved:
            Boolean(coachProfile) && coachProfile.reviewStatus === 'approved',
          profileNames: {
            student: (studentProfile && studentProfile.name) || '',
            parent: (parentProfile && parentProfile.name) || '',
            coach: (coachProfile && coachProfile.name) || ''
          },
          profileTypes: [
            studentProfile ? ROLES.STUDENT : '',
            parentProfile ? ROLES.PARENT : '',
            coachProfile ? ROLES.COACH : ''
          ].filter(Boolean),
          applicationRole: pendingProfileType || roles[0] || '',
          createdAt: user.createdAt || null,
          updatedAt: user.updatedAt || null
        };
      }).filter((entry) => entry.hasRealName)
    return {
      users: projectedUsers,
      totalVisible: projectedUsers.length,
      limit: MAX_ADMIN_USER_LIST,
      truncated: false
    };
  }

  async function getUserDeletionImpact({ identity, payload }) {
    await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const targetUserId = safeId(payload && payload.targetUserId, '用户账号');
    const targetUser = await repository.getUserById(targetUserId);
    if (!targetUser) {
      fail('USER_NOT_FOUND', '未找到目标用户。');
    }
    return { impact: await buildUserDeletionImpact(targetUser) };
  }

  async function deleteUser({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const input = validateUserDeletionPayload(payload);
    const targetUser = await repository.getUserById(input.targetUserId);
    if (!targetUser) {
      fail('USER_NOT_FOUND', '未找到目标用户。');
    }
    if (targetUser._id === actor._id) {
      fail('SELF_DELETE_FORBIDDEN', '开发者不能删除自己的账号。');
    }
    if (targetUser.status === USER_STATUS.DELETED) {
      return {
        targetUserId: targetUser._id,
        alreadyDeleted: true,
        identityHint: identityHint(targetUser._id)
      };
    }
    const impact = await buildUserDeletionImpact(targetUser);
    if (impact.protectedDeveloper) {
      fail('DEVELOPER_DELETE_FORBIDDEN', '合法开发者账号受保护，不能删除。');
    }
    if (impact.requiresAcknowledgement && !input.acknowledgeAssociations) {
      fail(
        'ACCOUNT_ASSOCIATIONS_REQUIRE_ACK',
        '该账号存在业务关联，确认关联影响后才能删除。'
      );
    }
    const deletionRelations = await loadUserDeletionRelations(targetUser);
    const now = new Date();

    return repository.db.runTransaction(async (transaction) => {
      const userReference = transaction.collection(COLLECTIONS.USERS).doc(targetUser._id);
      const currentUser = await getDocumentOrNull(userReference);
      if (!currentUser) {
        fail('USER_NOT_FOUND', '未找到目标用户。');
      }
      await loadDeveloperActorInTransaction(transaction, actor._id);
      if (currentUser.status === USER_STATUS.DELETED) {
        return { targetUserId: currentUser._id, alreadyDeleted: true };
      }
      if ((currentUser.roles || []).includes(ROLES.DEVELOPER)) {
        fail('DEVELOPER_DELETE_FORBIDDEN', '合法开发者账号受保护，不能删除。');
      }
      const transactionRelations = await loadUserDeletionRelationsInTransaction(
        transaction,
        currentUser
      );
      if (!input.acknowledgeAssociations && transactionRelations.mutableRelationCount > 0) {
        fail(
          'ACCOUNT_ASSOCIATIONS_REQUIRE_ACK',
          '该账号存在业务关联，确认关联影响后才能删除。'
        );
      }

      for (const binding of transactionRelations.roleBindings) {
        const reference = transaction
          .collection(COLLECTIONS.ROLE_BINDINGS)
          .doc(binding._id);
        const current = await getDocumentOrNull(reference);
        if (!current || current.status !== 'active') {
          continue;
        }
        await reference.update({
          data: {
            status: 'revoked',
            revokedBy: actor._id,
            revokedAt: now,
            revokeReason: 'account_deleted',
            updatedAt: now
          }
        });
      }

      for (const membership of transactionRelations.memberships) {
        const reference = transaction
          .collection(COLLECTIONS.GROUP_MEMBERSHIPS)
          .doc(membership._id);
        const current = await getDocumentOrNull(reference);
        if (!current || current.status !== MEMBERSHIP_STATUS.ACTIVE) {
          continue;
        }
        await reference.update({
          data: {
            status: MEMBERSHIP_STATUS.INACTIVE,
            removedBy: actor._id,
            removedAt: now,
            removalReason: 'account_deleted',
            updatedAt: now
          }
        });
      }

      for (const link of transactionRelations.parentLinks) {
        const reference = transaction
          .collection(COLLECTIONS.PARENT_LINKS)
          .doc(link._id);
        const current = await getDocumentOrNull(reference);
        if (!current || !REVOCABLE_PARENT_LINK_STATUSES.includes(current.status)) {
          continue;
        }
        await reference.update({
          data: {
            status: PARENT_LINK_STATUS.REVOKED,
            revokedBy: actor._id,
            revokedAt: now,
            revokeReason: 'account_deleted',
            updatedAt: now
          }
        });
      }

      for (const profile of transactionRelations.profiles) {
        if (profile.reviewStatus !== 'pending') {
          continue;
        }
        const collectionName = profile.collectionName;
        const reference = transaction.collection(collectionName).doc(profile._id);
        const current = await getDocumentOrNull(reference);
        if (!current || current.reviewStatus !== 'pending') {
          continue;
        }
        await reference.update({
          data: {
            reviewStatus: 'rejected',
            reviewComment: '账号已删除，注册申请终止',
            reviewedBy: actor._id,
            reviewedAt: now,
            updatedAt: now
          }
        });
      }

      for (const review of transactionRelations.pendingReviews) {
        const reference = transaction
          .collection(COLLECTIONS.REGISTRATION_REVIEWS)
          .doc(review._id);
        const current = await getDocumentOrNull(reference);
        if (!current || current.status !== 'pending') {
          continue;
        }
        await reference.update({
          data: {
            status: 'rejected',
            comment: '账号已删除，注册申请终止',
            reviewedBy: actor._id,
            reviewedAt: now
          }
        });
      }

      await userReference.update({
        data: {
          status: USER_STATUS.DELETED,
          roles: [],
          pendingProfileType: '',
          deletionMode: 'logical',
          deletionRevision: (Number(currentUser.deletionRevision) || 0) + 1,
          deletedBy: actor._id,
          deletedAt: now,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(deterministicId('audit_user_delete', currentUser._id, actor._id))
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.USER_DELETED,
            targetType: 'user',
            targetId: currentUser._id,
            result: 'success',
            metadata: {
              deletionMode: 'logical',
              businessAssociationCount: impact.businessAssociationCount,
              associationCounts: impact.associationCounts
            },
            createdAt: now
          }
        });

      return {
        targetUserId: currentUser._id,
        status: USER_STATUS.DELETED,
        alreadyDeleted: false,
        identityHint: identityHint(currentUser._id),
        associationCounts: impact.associationCounts
      };
    });
  }

  async function assignRole({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const roleInput = validateRolePayload(payload);
    if (roleInput.role === ROLES.PARENT && roleInput.grant) {
      fail(
        'PARENT_ROLE_APPROVAL_REQUIRED',
        '家长角色只能通过家长注册审核授予。'
      );
    }
    const targetUser = await repository.getUserById(roleInput.targetUserId);
    if (!targetUser) {
      fail('USER_NOT_FOUND', '未找到目标用户。');
    }
    if (targetUser.status === USER_STATUS.DELETED) {
      fail('ACCOUNT_DELETED', '目标账号已删除，不能变更角色。');
    }

    if (roleInput.role === ROLES.COACH && roleInput.grant) {
      const coachProfile = await repository.getCoachProfile(targetUser._id);
      if (
        !coachProfile ||
        coachProfile.reviewStatus !== 'approved' ||
        !hasRealNameProfile(coachProfile)
      ) {
        fail(
          'COACH_REGISTRATION_APPROVAL_REQUIRED',
          '教练角色只能通过教练实名注册审核授予。'
        );
      }
    }

    if (roleInput.role === ROLES.STUDENT && roleInput.grant) {
      const studentProfile = await repository.getProfile(targetUser._id);
      if (
        !studentProfile ||
        studentProfile.reviewStatus !== 'approved' ||
        !hasRealNameProfile(studentProfile)
      ) {
        fail(
          'STUDENT_REGISTRATION_APPROVAL_REQUIRED',
          '学生角色只能通过学生实名注册审核授予。'
        );
      }
    }

    if (roleInput.role === ROLES.PARENT) {
      return revokeParentRole({ actor, targetUser });
    }

    return repository.db.runTransaction(async (transaction) => {
      await loadDeveloperActorInTransaction(transaction, actor._id);
      const targetReference = transaction
        .collection(COLLECTIONS.USERS)
        .doc(targetUser._id);
      const currentTarget = await getDocumentOrNull(targetReference);
      if (!currentTarget || currentTarget.status === USER_STATUS.DELETED) {
        fail('ACCOUNT_DELETED', '目标账号已删除，不能变更角色。');
      }

      if (roleInput.role === ROLES.COACH && roleInput.grant) {
        const coachProfile = await getDocumentOrNull(
          transaction
            .collection(COLLECTIONS.COACH_PROFILES)
            .doc(repository.coachProfileIdForUser(currentTarget._id))
        );
        if (
          !coachProfile ||
          coachProfile.reviewStatus !== 'approved' ||
          !hasRealNameProfile(coachProfile)
        ) {
          fail(
            'COACH_REGISTRATION_APPROVAL_REQUIRED',
            '教练角色只能通过教练实名注册审核授予。'
          );
        }
      }

      if (roleInput.role === ROLES.STUDENT && roleInput.grant) {
        const studentProfile = await getDocumentOrNull(
          transaction
            .collection(COLLECTIONS.STUDENT_PROFILES)
            .doc(repository.profileIdForUser(currentTarget._id))
        );
        if (
          !studentProfile ||
          studentProfile.reviewStatus !== 'approved' ||
          !hasRealNameProfile(studentProfile)
        ) {
          fail(
            'STUDENT_REGISTRATION_APPROVAL_REQUIRED',
            '学生角色只能通过学生实名注册审核授予。'
          );
        }
      }

      const currentRoles = Array.isArray(currentTarget.roles)
        ? currentTarget.roles
        : [];
      const nextRoles = roleInput.grant
        ? Array.from(new Set([...currentRoles, roleInput.role]))
        : currentRoles.filter((role) => role !== roleInput.role);
      let nextStatus = currentTarget.status;
      if (currentTarget.status !== USER_STATUS.DISABLED) {
        if (roleInput.grant) {
          nextStatus = USER_STATUS.ACTIVE;
        } else if (!nextRoles.length) {
          nextStatus = USER_STATUS.PENDING_PROFILE;
        }
      }

      const roleBindingReference = transaction
        .collection(COLLECTIONS.ROLE_BINDINGS)
        .doc(repository.roleBindingId(currentTarget._id, roleInput.role));
      const currentBinding = await loadRoleBindingInTransaction(
        transaction,
        currentTarget._id,
        roleInput.role
      );
      const roleChanged = roleInput.grant
        ? !currentRoles.includes(roleInput.role)
        : currentRoles.includes(roleInput.role);
      const statusChanged = nextStatus !== currentTarget.status;
      const desiredBindingStatus = roleInput.grant ? 'active' : 'revoked';
      const bindingChanged = !currentBinding || currentBinding.status !== desiredBindingStatus;
      if (!roleChanged && !statusChanged && !bindingChanged) {
        return {
          userId: currentTarget._id,
          status: currentTarget.status,
          roles: currentRoles,
          duplicate: true
        };
      }

      const affectsDeveloperLifecycle =
        roleInput.role === ROLES.DEVELOPER || currentRoles.includes(ROLES.DEVELOPER);
      let guardVersion;
      if (affectsDeveloperLifecycle) {
        const activeDevelopers = await loadActiveDeveloperUsersInTransaction(transaction);
        const activeDeveloperIds = new Set(
          activeDevelopers.map((user) => user._id)
        );
        const targetWasActiveDeveloper = activeDeveloperIds.has(currentTarget._id);
        const targetWillBeActiveDeveloper =
          nextStatus === USER_STATUS.ACTIVE &&
          nextRoles.includes(ROLES.DEVELOPER) &&
          desiredBindingStatus === 'active';
        const remainingActiveDevelopers =
          activeDevelopers.length -
          (targetWasActiveDeveloper ? 1 : 0) +
          (targetWillBeActiveDeveloper ? 1 : 0);
        if (remainingActiveDevelopers < 1) {
          fail('LAST_DEVELOPER', '不能撤销系统中最后一个有效开发者。');
        }
        const guard = await loadAdminGuardInTransaction(transaction);
        guardVersion = await writeAdminGuardVersion(transaction, guard, new Date());
      }

      const now = new Date();
      await targetReference.update({
        data: {
          status: nextStatus,
          roles: nextRoles,
          updatedAt: now
        }
      });
      await roleBindingReference.set({
        data: {
          userId: currentTarget._id,
          role: roleInput.role,
          status: desiredBindingStatus,
          grantedBy: actor._id,
          ...(roleInput.grant ? { grantedAt: now } : { revokedAt: now }),
          updatedAt: now
        }
      });
      await writeRoleAuditInTransaction({
        transaction,
        actorUserId: actor._id,
        targetUserId: currentTarget._id,
        role: roleInput.role,
        action: roleInput.grant ? AUDIT_ACTIONS.ROLE_GRANTED : AUDIT_ACTIONS.ROLE_REVOKED,
        now,
        guardVersion
      });

      return {
        userId: currentTarget._id,
        status: nextStatus,
        roles: nextRoles,
        duplicate: false
      };
    });
  }

  async function setUserStatus({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const input = validateUserStatusPayload(payload);
    const targetUser = await repository.getUserById(input.targetUserId);
    if (!targetUser) {
      fail('USER_NOT_FOUND', '未找到目标用户。');
    }
    if (targetUser.status === USER_STATUS.DELETED) {
      fail('ACCOUNT_DELETED', '目标账号已删除，不能变更状态。');
    }
    return repository.db.runTransaction(async (transaction) => {
      await loadDeveloperActorInTransaction(transaction, actor._id);
      const targetReference = transaction
        .collection(COLLECTIONS.USERS)
        .doc(targetUser._id);
      const currentTarget = await getDocumentOrNull(targetReference);
      if (!currentTarget || currentTarget.status === USER_STATUS.DELETED) {
        fail('ACCOUNT_DELETED', '目标账号已删除，不能变更状态。');
      }
      if (currentTarget.status === input.status) {
        return {
          userId: currentTarget._id,
          status: currentTarget.status,
          roles: currentTarget.roles || [],
          duplicate: true
        };
      }
      if (input.status === USER_STATUS.ACTIVE && !(currentTarget.roles || []).length) {
        fail('USER_HAS_NO_ROLE', '请先为用户授予至少一个角色，再启用账号。');
      }

      const affectsDeveloperLifecycle = (currentTarget.roles || []).includes(
        ROLES.DEVELOPER
      );
      let guardVersion;
      if (affectsDeveloperLifecycle) {
        const activeDevelopers = await loadActiveDeveloperUsersInTransaction(transaction);
        const developerBinding = await loadRoleBindingInTransaction(
          transaction,
          currentTarget._id,
          ROLES.DEVELOPER
        );
        const activeDeveloperIds = new Set(
          activeDevelopers.map((user) => user._id)
        );
        const activeDeveloperBinding =
          developerBinding && developerBinding.status === 'active';
        if (
          input.status === USER_STATUS.ACTIVE &&
          (currentTarget.roles || []).includes(ROLES.DEVELOPER) &&
          !activeDeveloperBinding
        ) {
          fail('DEVELOPER_BINDING_INACTIVE', '开发者角色绑定无效，不能直接启用该账号。');
        }
        const targetWasActiveDeveloper = activeDeveloperIds.has(currentTarget._id);
        const targetWillBeActiveDeveloper =
          input.status === USER_STATUS.ACTIVE &&
          (currentTarget.roles || []).includes(ROLES.DEVELOPER) &&
          Boolean(activeDeveloperBinding);
        const remainingActiveDevelopers =
          activeDevelopers.length -
          (targetWasActiveDeveloper ? 1 : 0) +
          (targetWillBeActiveDeveloper ? 1 : 0);
        if (remainingActiveDevelopers < 1) {
          fail('LAST_DEVELOPER', '不能停用系统中最后一个有效开发者。');
        }
        const guard = await loadAdminGuardInTransaction(transaction);
        guardVersion = await writeAdminGuardVersion(transaction, guard, new Date());
      }

      const now = new Date();
      await targetReference.update({
        data: {
          status: input.status,
          updatedAt: now
        }
      });
      const action =
        input.status === USER_STATUS.ACTIVE
          ? AUDIT_ACTIONS.USER_ENABLED
          : AUDIT_ACTIONS.USER_DISABLED;
      const auditId = deterministicId(
        'audit_user_status',
        currentTarget._id,
        input.status,
        String(guardVersion === undefined ? now.getTime() : guardVersion)
      );
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(auditId)
        .set({
          data: {
            actorUserId: actor._id,
            action,
            targetType: 'user',
            targetId: currentTarget._id,
            result: 'success',
            metadata: { status: input.status },
            createdAt: now
          }
        });

      return {
        userId: currentTarget._id,
        status: input.status,
        roles: currentTarget.roles || [],
        duplicate: false
      };
    });
  }

  return {
    'admin.assign_role': assignRole,
    'admin.get_user_deletion_impact': getUserDeletionImpact,
    'admin.delete_user': deleteUser,
    'admin.list_users': listUsers,
    'admin.set_user_status': setUserStatus
  };
}

module.exports = createUserAdminActions;
