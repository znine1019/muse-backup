'use strict';

/**
 * V1.6 功能补全第一批｜家长端
 *
 * 服务端职责（全部在此模块内判定，前端隐藏按钮不构成权限）：
 *   1. 家长注册资料提交与状态查询
 *   2. 学生生成一次性关联凭证（仅存哈希、短时有效、失败次数限制）
 *   3. 家长使用凭证发起关联 → 学生确认 → developer 核验
 *   4. 关联撤销（家长 / 学生 / developer）
 *   5. 家长读取已授权关联学生的白名单字段（只读）
 *
 * 安全约束：
 *   - 家长默认只读，不提供任何修改类路由
 *   - 每次读取都重新校验：账号 active、parent 角色有效、关联关系 status=active、学生属于该家长
 *   - 只返回白名单字段，绝不返回学生完整文档
 *   - 不返回精确 GPS 坐标、请假原因、健康信息、其他学生资料、教练内部评价
 */

const crypto = require('crypto');
const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  LIMITS,
  PARENT_LINK_KIND,
  PARENT_LINK_STATUS,
  REVIEW_STATUS,
  ROLES,
  USER_STATUS
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const { deterministicId } = require('../lib/repository');
const { loadActiveActor, loadUser } = require('../lib/session');
const { getDocumentOrNull } = require('../lib/transaction');
const { clubDateOnly } = require('../lib/dates');
const { buildAutomaticReport } = require('../lib/report-builder');
const {
  normalizeInviteCode,
  validateParentProfilePayload,
  validateParentInviteCreatePayload,
  validateParentInviteRedeemPayload,
  validateParentLinkDecisionPayload,
  validateParentLinkReviewPayload,
  validateParentLinkRevokePayload,
  validateParentStudentQueryPayload
} = require('../lib/validation');

/* 不含易混淆字符（0/O/1/I）的凭证字母表 */
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_HASH_PEPPER = 'joger_parent_invite_v1';
/* 同一家长在窗口期内允许的凭证失败次数上限（防枚举） */
const INVITE_FAIL_WINDOW_MINUTES = 15;
const INVITE_FAIL_LIMIT = 10;

function randomInviteCode(length) {
  const bytes = crypto.randomBytes(length * 2);
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += INVITE_ALPHABET[bytes[index] % INVITE_ALPHABET.length];
  }
  return code;
}

function hashInviteCode(code) {
  return crypto
    .createHash('sha256')
    .update(`${INVITE_HASH_PEPPER}|${normalizeInviteCode(code)}`)
    .digest('hex');
}

function currentMonthRange() {
  const today = clubDateOnly();
  return { firstDay: `${today.slice(0, 7)}-01`, today };
}

function shortDate(value) {
  if (!value) {
    return '';
  }
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : text;
}

function readableParentProfile(profile) {
  if (!profile) {
    return null;
  }
  return {
    parentUserId: profile.userId,
    name: profile.name || '',
    relation: profile.relation || 'guardian',
    note: profile.note || '',
    reviewStatus: profile.reviewStatus || REVIEW_STATUS.PENDING,
    reviewComment: profile.reviewComment || '',
    submittedAt: profile.submittedAt || null,
    reviewedAt: profile.reviewedAt || null
  };
}

function readableLink(link, extra = {}) {
  return {
    linkId: link._id,
    parentUserId: link.parentUserId,
    studentUserId: link.studentUserId,
    status: link.status,
    studentConfirmedAt: link.studentConfirmedAt || null,
    reviewedAt: link.reviewedAt || null,
    reviewComment: link.reviewComment || '',
    revokedAt: link.revokedAt || null,
    createdAt: link.createdAt || null,
    updatedAt: link.updatedAt || null,
    parentName: extra.parentName || '',
    studentName: extra.studentName || '',
    trainingGroupNames: extra.trainingGroupNames || []
  };
}

function createParentActions({ repository }) {
  /* ---------- 内部校验 ---------- */

  async function loadRelationOrFail(linkId) {
    const link = await repository.getParentLink(linkId);
    if (!link || link.kind !== PARENT_LINK_KIND.RELATION) {
      fail('LINK_NOT_FOUND', '未找到该关联关系。');
    }
    return link;
  }

  /** 家长是否已获得该学生的有效授权（所有家长读取的唯一入口） */
  async function assertActiveLink(actorUserId, studentUserId) {
    const linkId = repository.parentLinkIdForPair(actorUserId, studentUserId);
    const link = await repository.getParentLink(linkId);
    if (
      !link ||
      link.kind !== PARENT_LINK_KIND.RELATION ||
      link.status !== PARENT_LINK_STATUS.ACTIVE
    ) {
      fail('LINK_NOT_ACTIVE', '尚未获得该学生的授权，或授权已解除。');
    }
    return link;
  }

  async function assertLinkParentActive(repository, link) {
    const usersMap = await repository.getUsersMap([link.studentUserId]);
    const studentUser = usersMap.get(link.studentUserId);
    if (!studentUser || studentUser.status !== USER_STATUS.ACTIVE) {
      fail('STUDENT_NOT_ACTIVE', '该学生账号当前不可查看。');
    }
  }

  function groupNameList(groupIds, groupsMap) {
    return (groupIds || [])
      .map((groupId) => (groupsMap.get(groupId) || {}).name)
      .filter(Boolean);
  }

  /* ---------- 1. 家长注册 ---------- */

  async function submitParentProfile({ identity, payload }) {
    const user = await loadUser(repository, identity);
    const input = validateParentProfilePayload(payload);

    const profileId = repository.parentProfileIdForUser(user._id);
    const reviewId = deterministicId('parent_review', user._id, Date.now());

    return repository.db.runTransaction(async (transaction) => {
      const profileReference = transaction
        .collection(COLLECTIONS.PARENT_PROFILES)
        .doc(profileId);
      const current = await getDocumentOrNull(profileReference);
      if (current && current.reviewStatus === REVIEW_STATUS.APPROVED) {
        fail('PARENT_PROFILE_APPROVED', '家长资料已通过审核，无需重复提交。');
      }

      await profileReference.set({
        data: {
          userId: user._id,
          name: input.name,
          relation: input.relation,
          note: input.note,
          reviewStatus: REVIEW_STATUS.PENDING,
          reviewComment: '',
          currentReviewId: reviewId,
          submittedAt: repository.db.serverDate(),
          reviewedBy: '',
          reviewedAt: null,
          createdAt: (current && current.createdAt) || repository.db.serverDate(),
          updatedAt: repository.db.serverDate(),
          schemaVersion: 1
        }
      });

      await transaction
        .collection(COLLECTIONS.REGISTRATION_REVIEWS)
        .doc(reviewId)
        .set({
          data: {
            reviewId,
            userId: user._id,
            profileType: ROLES.PARENT,
            status: REVIEW_STATUS.PENDING,
            comment: '',
            requestedTrainingGroupId: '',
            submittedAt: repository.db.serverDate(),
            reviewedBy: '',
            reviewedAt: null
          }
        });

      const userReference = transaction.collection(COLLECTIONS.USERS).doc(user._id);
      const currentUser = await getDocumentOrNull(userReference);
      if (!currentUser) {
        fail('USER_NOT_FOUND', '未找到当前账号。');
      }
      /* 已有其它有效角色的账号不因家长资料待审而降级 */
      const nextStatus =
        currentUser.status === USER_STATUS.ACTIVE
          ? USER_STATUS.ACTIVE
          : USER_STATUS.PENDING_REVIEW;

      await userReference.update({
        data: {
          status: nextStatus,
          pendingProfileType: ROLES.PARENT,
          updatedAt: repository.db.serverDate()
        }
      });

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(deterministicId('audit_parent_profile', user._id, reviewId))
        .set({
          data: {
            actorUserId: user._id,
            action: AUDIT_ACTIONS.PARENT_PROFILE_SUBMITTED,
            targetType: 'user',
            targetId: user._id,
            result: 'success',
            metadata: { relation: input.relation },
            createdAt: repository.db.serverDate()
          }
        });

      return { status: nextStatus, profile: readableParentProfile({
        userId: user._id,
        name: input.name,
        relation: input.relation,
        note: input.note,
        reviewStatus: REVIEW_STATUS.PENDING,
        reviewComment: '',
        submittedAt: null
      }) };
    });
  }

  async function getParentProfile({ identity }) {
    const user = await loadUser(repository, identity);
    const profile = await repository.getParentProfile(user._id);
    return {
      userStatus: user.status,
      roles: user.roles || [],
      profile: readableParentProfile(profile)
    };
  }

  /* ---------- 2. 学生生成一次性关联凭证 ---------- */

  async function createInvite({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateParentInviteCreatePayload(payload);
    const code = randomInviteCode(LIMITS.parentInviteCodeLength);
    const codeHash = hashInviteCode(code);
    const expiresAt = new Date(
      Date.now() + LIMITS.parentInviteTtlMinutes * 60 * 1000
    );
    const inviteId = repository.parentInviteIdForRequest(
      actor._id,
      input.clientRequestId || `${Date.now()}`
    );

    return repository.db.runTransaction(async (transaction) => {
      /* 生成新凭证时，同一学生此前未使用的凭证立即失效 */
      const openInvites = await repository.listParentLinks(
        {
          kind: PARENT_LINK_KIND.INVITE,
          studentUserId: actor._id,
          status: PARENT_LINK_STATUS.OPEN
        },
        50
      );
      for (const invite of openInvites) {
        await transaction
          .collection(COLLECTIONS.PARENT_LINKS)
          .doc(invite._id)
          .update({
            data: {
              status: PARENT_LINK_STATUS.EXPIRED,
              updatedAt: repository.db.serverDate()
            }
          });
      }

      await transaction
        .collection(COLLECTIONS.PARENT_LINKS)
        .doc(inviteId)
        .set({
          data: {
            kind: PARENT_LINK_KIND.INVITE,
            studentUserId: actor._id,
            codeHash,
            status: PARENT_LINK_STATUS.OPEN,
            attempts: 0,
            maxAttempts: LIMITS.parentInviteMaxAttempts,
            expiresAt,
            usedByParentUserId: '',
            usedAt: null,
            createdAt: repository.db.serverDate(),
            updatedAt: repository.db.serverDate(),
            schemaVersion: 1
          }
        });

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(deterministicId('audit_parent_invite', actor._id, inviteId))
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.PARENT_INVITE_CREATED,
            targetType: 'parent_invite',
            targetId: inviteId,
            result: 'success',
            metadata: { ttlMinutes: LIMITS.parentInviteTtlMinutes },
            createdAt: repository.db.serverDate()
          }
        });

      /* 明文凭证只在本次响应中返回一次，数据库仅保存哈希 */
      return {
        inviteId,
        code,
        expiresAt: expiresAt.toISOString(),
        ttlMinutes: LIMITS.parentInviteTtlMinutes
      };
    });
  }

  /* ---------- 3. 家长使用凭证申请关联 ---------- */

  async function redeemInvite({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.PARENT]);
    const input = validateParentInviteRedeemPayload(payload);

    /* 防枚举：同一家长在窗口期内失败次数过多时直接拒绝，不再查找凭证 */
    const failWindowAt = actor.inviteFailWindowAt
      ? new Date(actor.inviteFailWindowAt).getTime()
      : 0;
    const failCount = Number(actor.inviteFailCount || 0);
    if (
      failWindowAt &&
      Date.now() - failWindowAt < INVITE_FAIL_WINDOW_MINUTES * 60 * 1000 &&
      failCount >= INVITE_FAIL_LIMIT
    ) {
      fail(
        'INVITE_REQUESTS_LIMITED',
        '关联凭证尝试次数过多，请稍后再试或联系俱乐部核验。'
      );
    }

    const codeHash = hashInviteCode(input.code);

    const candidates = await repository.listParentLinks(
      {
        kind: PARENT_LINK_KIND.INVITE,
        codeHash,
        status: PARENT_LINK_STATUS.OPEN
      },
      5
    );
    const invite = candidates[0] || null;
    if (!invite) {
      await repository.recordParentInviteFailure(actor._id);
      fail('INVALID_INVITE_CODE', '关联凭证无效或已被使用，请向学生确认最新凭证。');
    }

    /* 单张凭证自身的失败次数上限（已知凭证在无效状态被反复提交时累计） */
    if (
      Number(invite.attempts || 0) >=
      Number(invite.maxAttempts || LIMITS.parentInviteMaxAttempts)
    ) {
      fail('INVITE_LOCKED', '该关联凭证失败次数过多，已失效，请让学生重新生成。');
    }

    const expired =
      invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now();
    if (expired) {
      await repository.incrementInviteAttempts(invite._id);
      await repository.expireParentInvite(invite._id);
      fail('INVITE_EXPIRED', '关联凭证已过期，请让学生重新生成。');
    }
    if (invite.studentUserId === actor._id) {
      fail('INVALID_INVITE_CODE', '不能使用自己生成的关联凭证。');
    }

    const pairId = repository.parentLinkIdForPair(actor._id, invite.studentUserId);
    const existing = await repository.getParentLink(pairId);
    if (existing && existing.status === PARENT_LINK_STATUS.ACTIVE) {
      fail('LINK_ALREADY_ACTIVE', '已与该学生建立有效关联，无需重复申请。');
    }
    if (
      existing &&
      (existing.status === PARENT_LINK_STATUS.PENDING_STUDENT ||
        existing.status === PARENT_LINK_STATUS.PENDING_REVIEW)
    ) {
      fail('LINK_ALREADY_PENDING', '该关联申请正在处理中，请等待学生确认与开发者核验。');
    }

    const studentUser = await repository.getUsersMap([invite.studentUserId]);
    const target = studentUser.get(invite.studentUserId);
    if (!target || target.status !== USER_STATUS.ACTIVE) {
      fail('STUDENT_NOT_ACTIVE', '该学生账号当前不可关联。');
    }

    const activeCount = await repository.countParentLinksByStatus(
      { parentUserId: actor._id, status: PARENT_LINK_STATUS.ACTIVE }
    );
    if (activeCount >= LIMITS.parentMaxLinkedStudents) {
      fail('LINK_LIMIT_REACHED', '已达到可关联学生数量上限，请先解除部分关联。');
    }

    return repository.db.runTransaction(async (transaction) => {
      const linkReference = transaction
        .collection(COLLECTIONS.PARENT_LINKS)
        .doc(pairId);
      const inviteReference = transaction
        .collection(COLLECTIONS.PARENT_LINKS)
        .doc(invite._id);

      await linkReference.set({
        data: {
          kind: PARENT_LINK_KIND.RELATION,
          parentUserId: actor._id,
          studentUserId: invite.studentUserId,
          status: PARENT_LINK_STATUS.PENDING_STUDENT,
          createdFrom: invite._id,
          studentConfirmedAt: null,
          reviewedBy: '',
          reviewedAt: null,
          reviewComment: '',
          revokedBy: '',
          revokedAt: null,
          revokeReason: '',
          createdAt: repository.db.serverDate(),
          updatedAt: repository.db.serverDate(),
          schemaVersion: 1
        }
      });

      await inviteReference.update({
        data: {
          status: PARENT_LINK_STATUS.USED,
          usedByParentUserId: actor._id,
          usedAt: repository.db.serverDate(),
          updatedAt: repository.db.serverDate()
        }
      });

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(deterministicId('audit_parent_link_req', pairId, actor._id))
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.PARENT_LINK_REQUESTED,
            targetType: 'parent_link',
            targetId: pairId,
            result: 'success',
            metadata: { studentUserId: invite.studentUserId },
            createdAt: repository.db.serverDate()
          }
        });

      return { linkId: pairId, status: PARENT_LINK_STATUS.PENDING_STUDENT };
    });
  }

  /* ---------- 4. 学生确认 / 拒绝 ---------- */

  async function studentDecision({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateParentLinkDecisionPayload(payload);
    const link = await loadRelationOrFail(input.linkId);

    if (link.studentUserId !== actor._id) {
      fail('OUT_OF_SCOPE', '只能处理与本人相关的家长关联申请。');
    }
    if (link.status !== PARENT_LINK_STATUS.PENDING_STUDENT) {
      fail('LINK_NOT_PENDING', '该关联申请当前状态不能由学生处理。');
    }

    const approved = input.decision === 'confirm';
    const nextStatus = approved
      ? PARENT_LINK_STATUS.PENDING_REVIEW
      : PARENT_LINK_STATUS.REJECTED;

    return repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.PARENT_LINKS)
        .doc(link._id);
      const current = await getDocumentOrNull(reference);
      if (!current || current.status !== PARENT_LINK_STATUS.PENDING_STUDENT) {
        fail('LINK_NOT_PENDING', '该关联申请已被处理。');
      }

      await reference.update({
        data: {
          status: nextStatus,
          studentConfirmedAt: approved ? repository.db.serverDate() : null,
          reviewComment: input.comment,
          updatedAt: repository.db.serverDate()
        }
      });

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(deterministicId('audit_parent_link_student', link._id, actor._id))
        .set({
          data: {
            actorUserId: actor._id,
            action: approved
              ? AUDIT_ACTIONS.PARENT_LINK_CONFIRMED
              : AUDIT_ACTIONS.PARENT_LINK_STUDENT_REJECTED,
            targetType: 'parent_link',
            targetId: link._id,
            result: 'success',
            metadata: { decision: input.decision },
            createdAt: repository.db.serverDate()
          }
        });

      return { linkId: link._id, status: nextStatus };
    });
  }

  /* ---------- 5. developer 核验 ---------- */

  async function listPendingLinks({ identity }) {
    await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const pending = await repository.listParentLinks(
      { kind: PARENT_LINK_KIND.RELATION, status: PARENT_LINK_STATUS.PENDING_REVIEW },
      200
    );
    const userIds = Array.from(
      new Set(
        pending.flatMap((link) => [link.parentUserId, link.studentUserId]).filter(Boolean)
      )
    );
    const [profilesMap, parentsMap] = await Promise.all([
      repository.getProfilesMap(pending.map((link) => link.studentUserId)),
      repository.getUsersMap(pending.map((link) => link.parentUserId))
    ]);
    return {
      links: pending
        .sort(
          (left, right) =>
            new Date(left.studentConfirmedAt || left.updatedAt || 0).getTime() -
            new Date(right.studentConfirmedAt || right.updatedAt || 0).getTime()
        )
        .map((link) =>
          readableLink(link, {
            parentName: (parentsMap.get(link.parentUserId) || {}).displayName || '',
            studentName: (profilesMap.get(link.studentUserId) || {}).name || ''
          })
        ),
      total: pending.length,
      checkedUsers: userIds.length
    };
  }

  async function reviewLink({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.DEVELOPER]);
    const input = validateParentLinkReviewPayload(payload);
    const link = await loadRelationOrFail(input.linkId);
    if (link.status !== PARENT_LINK_STATUS.PENDING_REVIEW) {
      fail('LINK_NOT_PENDING', '该关联申请当前状态不能核验。');
    }

    const approved = input.decision === 'approve';
    const nextStatus = approved ? PARENT_LINK_STATUS.ACTIVE : PARENT_LINK_STATUS.REJECTED;

    return repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.PARENT_LINKS)
        .doc(link._id);
      const current = await getDocumentOrNull(reference);
      if (!current || current.status !== PARENT_LINK_STATUS.PENDING_REVIEW) {
        fail('LINK_NOT_PENDING', '该关联申请已被处理。');
      }

      await reference.update({
        data: {
          status: nextStatus,
          reviewedBy: actor._id,
          reviewedAt: repository.db.serverDate(),
          reviewComment: input.comment,
          updatedAt: repository.db.serverDate()
        }
      });

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(deterministicId('audit_parent_link_review', link._id, actor._id))
        .set({
          data: {
            actorUserId: actor._id,
            action: approved
              ? AUDIT_ACTIONS.PARENT_LINK_APPROVED
              : AUDIT_ACTIONS.PARENT_LINK_REJECTED,
            targetType: 'parent_link',
            targetId: link._id,
            result: 'success',
            metadata: { decision: input.decision },
            createdAt: repository.db.serverDate()
          }
        });

      return { linkId: link._id, status: nextStatus };
    });
  }

  /* ---------- 6. 撤销关联 ---------- */

  async function revokeLink({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.PARENT, ROLES.STUDENT, ROLES.DEVELOPER]);
    const input = validateParentLinkRevokePayload(payload);
    const link = await loadRelationOrFail(input.linkId);

    const isDeveloper = (actor.roles || []).includes(ROLES.DEVELOPER);
    const isParty =
      link.parentUserId === actor._id || link.studentUserId === actor._id;
    if (!isDeveloper && !isParty) {
      fail('OUT_OF_SCOPE', '只能解除与本人相关的关联。');
    }
    if (
      link.status === PARENT_LINK_STATUS.REVOKED ||
      link.status === PARENT_LINK_STATUS.REJECTED
    ) {
      fail('LINK_NOT_ACTIVE', '该关联已失效，无需重复解除。');
    }

    return repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.PARENT_LINKS)
        .doc(link._id);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('LINK_NOT_FOUND', '未找到该关联关系。');
      }

      await reference.update({
        data: {
          status: PARENT_LINK_STATUS.REVOKED,
          revokedBy: actor._id,
          revokedAt: repository.db.serverDate(),
          revokeReason: input.comment,
          updatedAt: repository.db.serverDate()
        }
      });

      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(deterministicId('audit_parent_link_revoke', link._id, actor._id))
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.PARENT_LINK_REVOKED,
            targetType: 'parent_link',
            targetId: link._id,
            result: 'success',
            metadata: { byDeveloper: isDeveloper },
            createdAt: repository.db.serverDate()
          }
        });

      return { linkId: link._id, status: PARENT_LINK_STATUS.REVOKED };
    });
  }

  /* ---------- 7. 关联列表（家长视角 / 学生视角） ---------- */

  async function listMyLinks({ identity }) {
    const user = await loadUser(repository, identity);
    const roles = user.roles || [];
    const result = { asParent: [], asStudent: [], parentProfile: null };

    if (roles.includes(ROLES.PARENT)) {
      const profile = await repository.getParentProfile(user._id);
      result.parentProfile = readableParentProfile(profile);
      const links = await repository.listParentLinks(
        { kind: PARENT_LINK_KIND.RELATION, parentUserId: user._id },
        50
      );
      const profilesMap = await repository.getProfilesMap(
        links.map((link) => link.studentUserId)
      );
      const studentsMap = await repository.getUsersMap(
        links.map((link) => link.studentUserId)
      );
      result.asParent = links
        .sort(
          (left, right) =>
            new Date(right.updatedAt || 0).getTime() -
            new Date(left.updatedAt || 0).getTime()
        )
        .map((link) => {
          const studentUser = studentsMap.get(link.studentUserId) || {};
          return readableLink(link, {
            studentName: (profilesMap.get(link.studentUserId) || {}).name || '',
            studentAccountActive: studentUser.status === USER_STATUS.ACTIVE
          });
        });
    }

    if (roles.includes(ROLES.STUDENT)) {
      const links = await repository.listParentLinks(
        { kind: PARENT_LINK_KIND.RELATION, studentUserId: user._id },
        50
      );
      const parentsMap = await repository.getUsersMap(
        links.map((link) => link.parentUserId)
      );
      result.asStudent = links
        .sort(
          (left, right) =>
            new Date(right.updatedAt || 0).getTime() -
            new Date(left.updatedAt || 0).getTime()
        )
        .map((link) =>
          readableLink(link, {
            parentName: (parentsMap.get(link.parentUserId) || {}).displayName || '家长'
          })
        );
    }

    return result;
  }

  /* ---------- 8. 家长读取已授权学生（白名单字段） ---------- */

  async function listStudents({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.PARENT]);
    const links = await repository.listParentLinks(
      {
        kind: PARENT_LINK_KIND.RELATION,
        parentUserId: actor._id,
        status: PARENT_LINK_STATUS.ACTIVE
      },
      50
    );
    if (!links.length) {
      return { students: [] };
    }
    const studentIds = links.map((link) => link.studentUserId);
    const [profilesMap, usersMap] = await Promise.all([
      repository.getProfilesMap(studentIds),
      repository.getUsersMap(studentIds)
    ]);
    const activeLinks = links.filter(
      (link) => (usersMap.get(link.studentUserId) || {}).status === USER_STATUS.ACTIVE
    );
    const groupsMapCache = new Map();
    const students = [];
    for (const link of activeLinks) {
      const profile = profilesMap.get(link.studentUserId) || {};
      const groupIds = await repository.getStudentGroupIds(link.studentUserId);
      if (!groupsMapCache.has('groups')) {
        groupsMapCache.set('groups', await repository.getGroupsMap(groupIds));
      }
      const groupsMap = groupsMapCache.get('groups');
      students.push({
        studentUserId: link.studentUserId,
        name: profile.name || '',
        primaryEventName: profile.primaryEventName || '',
        trainingGroupNames: groupNameList(groupIds, groupsMap),
        linkedAt: link.reviewedAt || link.updatedAt || null
      });
    }
    return { students };
  }

  async function getStudentOverview({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.PARENT]);
    const input = validateParentStudentQueryPayload(payload);
    const studentUserId = input.studentUserId;

    /* 授权校验与学生账号状态校验并行执行（任一失败即拒绝） */
    await Promise.all([
      assertActiveLink(actor._id, studentUserId),
      assertLinkParentActive(repository, { studentUserId })
    ]);

    const range = currentMonthRange();
    const groupIds = await repository.getStudentGroupIds(studentUserId);
    const groupsMap = await repository.getGroupsMap(groupIds);

    const [
      profilesMap,
      planResult,
      performanceResult,
      attendanceResult,
      feedbackResult,
      registrationResult,
      noticeResult
    ] = await Promise.all([
      repository.getProfilesMap([studentUserId]),
      repository.listTrainingPlans({
        groupIds,
        statuses: ['published'],
        fromDate: range.firstDay,
        toDate: range.today,
        maxRecords: 20
      }),
      repository.listApprovedPerformanceRecordsForStatistics({
        studentUserIds: [studentUserId],
        maxRecords: 200
      }),
      repository.listAttendanceRecordsByStudent(studentUserId, {
        fromDate: range.firstDay,
        toDate: range.today
      }),
      repository.listTrainingFeedback({
        studentUserIds: [studentUserId],
        maxRecords: 50
      }),
      repository.listRegistrations({
        studentUserIds: [studentUserId],
        maxRecords: 20
      }),
      repository.listClubNotices({ statuses: ['published'], maxRecords: 30 })
    ]);

    const profile = profilesMap.get(studentUserId) || {};
    const report = buildAutomaticReport({
      profile,
      measurements: [],
      performanceRecords: performanceResult.records || []
    });

    /* 考勤：只统计本自然月，已批准请假不计入应签到分母 */
    const attendanceRecords = attendanceResult.records || [];
    const counts = {
      valid: 0,
      late: 0,
      absent: 0,
      leave: 0,
      pendingVerification: 0,
      expected: 0
    };
    const attendanceRows = attendanceRecords.map((record) => {
      const status = record.status;
      if (status === 'leave_approved') {
        counts.leave += 1;
      } else {
        counts.expected += 1;
        if (status === 'checked_in' || status === 'late') {
          counts.valid += 1;
        }
        if (status === 'late') {
          counts.late += 1;
        }
        if (status === 'absent') {
          counts.absent += 1;
        }
        if (status === 'pending_verification') {
          counts.pendingVerification += 1;
        }
      }
      return {
        attendanceDate: record.attendanceDate || '',
        status,
        checkInAt: record.checkInAt || null
        /* 不返回经纬度、精度、距离等定位细节 */
      };
    });
    const attendanceRate = counts.expected
      ? Math.round((counts.valid / counts.expected) * 10000) / 10000
      : null;

    return {
      period: { label: `${range.firstDay.slice(0, 7)} 月度` },
      student: {
        studentUserId,
        name: profile.name || '',
        primaryEventName: profile.primaryEventName || '',
        trainingGroupNames: groupNameList(groupIds, groupsMap)
      },
      plans: (planResult.records || []).map((plan) => ({
        planId: plan.planId || plan._id,
        title: plan.title || '',
        startDate: plan.startDate || '',
        endDate: plan.endDate || '',
        itemCount: (plan.items || []).length,
        items: (plan.items || []).slice(0, 8).map((item) => ({
          name: item.name || '',
          sets: item.sets || null,
          reps: item.reps || null,
          distanceMeters: item.distanceMeters || null,
          restSeconds: item.restSeconds || null
        }))
      })),
      performance: {
        approvedCount: (performanceResult.records || []).length,
        personalBests: (report.personalBests || []).map((item) => ({
          eventCode: item.eventCode,
          eventName: item.eventName,
          value: item.value,
          unit: item.unit,
          date: item.date || item.achievedAt || ''
        })),
        stageChanges: (report.stageChanges || []).slice(0, 5),
        latestPerformances: (report.latestPerformances || []).slice(0, 6)
      },
      attendance: {
        validAttendance: counts.valid,
        actualExpected: counts.expected,
        late: counts.late,
        absent: counts.absent,
        approvedLeave: counts.leave,
        pendingVerification: counts.pendingVerification,
        attendanceRate,
        rows: attendanceRows
      },
      feedback: {
        total: (feedbackResult.records || []).length,
        completed: (feedbackResult.records || []).filter(
          (item) => item.completionStatus === 'completed'
        ).length,
        partial: (feedbackResult.records || []).filter(
          (item) => item.completionStatus === 'partial'
        ).length,
        notCompleted: (feedbackResult.records || []).filter(
          (item) => item.completionStatus === 'not_completed'
        ).length,
        /* 只共享学生的完成情况与主观用力程度，默认不暴露教练内部评价 */
        rows: (feedbackResult.records || []).slice(0, 20).map((item) => ({
          attendanceDate: item.attendanceDate || '',
          completionStatus: item.completionStatus || '',
          rpe: item.rpe || null
        }))
      },
      competitions: (registrationResult.records || []).slice(0, 10).map((item) => ({
        competitionId: item.competitionId,
        status: item.status,
        itemsText: (item.items || [])
          .map((entry) => entry.eventName || entry.eventCode || '')
          .filter(Boolean)
          .join('、')
      })),
      notices: (noticeResult.records || [])
        .filter((notice) => {
          const visible = notice.trainingGroupIds || [];
          return !visible.length || visible.some((groupId) => groupIds.includes(groupId));
        })
        .slice(0, 10)
        .map((notice) => ({
          noticeId: notice.noticeId || notice._id,
          title: notice.title || '',
          category: notice.category || '',
          priority: notice.priority || 'normal',
          publishedAt: notice.publishedAt || null
        }))
    };
  }

  return {
    'parent.submit_profile': submitParentProfile,
    'parent.get_profile': getParentProfile,
    'parent.create_invite': createInvite,
    'parent.redeem_invite': redeemInvite,
    'parent.student_decision': studentDecision,
    'parent.list_pending_links': listPendingLinks,
    'parent.review_link': reviewLink,
    'parent.revoke_link': revokeLink,
    'parent.list_my_links': listMyLinks,
    'parent.list_students': listStudents,
    'parent.get_student_overview': getStudentOverview
  };
}

module.exports = createParentActions;
module.exports.hashInviteCode = hashInviteCode;
module.exports.randomInviteCode = randomInviteCode;
