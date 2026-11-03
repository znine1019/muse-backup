'use strict';

const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  NOTICE_STATUS,
  ROLES
} = require('../lib/constants');
const { fail } = require('../lib/errors');
const {
  assertCanFullyManageScopesInTransaction,
  canFullyManageScope,
  isDeveloperActor
} = require('../lib/management-scope');
const { loadActiveActor } = require('../lib/session');
const { getDocumentOrNull } = require('../lib/transaction');
const {
  safeId,
  validateNoticeActionPayload,
  validateNoticeCreatePayload,
  validateNoticeQueryPayload,
  validateNoticeReadPayload,
  validateNoticeUpdatePayload
} = require('../lib/validation');

function isDeveloper(actor) {
  return isDeveloperActor(actor);
}

function readableNotice(notice, extra = {}) {
  return {
    id: notice._id,
    noticeId: notice.noticeId || notice._id,
    title: notice.title,
    content: notice.content,
    category: notice.category,
    priority: notice.priority || 'normal',
    trainingGroupIds: notice.trainingGroupIds || [],
    trainingGroupNames: extra.trainingGroupNames || [],
    canManage: extra.canManage === true,
    status: notice.status,
    version: Number(notice.version) || 1,
    publishedAt: notice.publishedAt || null,
    withdrawnAt: notice.withdrawnAt || null,
    archivedAt: notice.archivedAt || null,
    createdBy: notice.createdBy,
    createdAt: notice.createdAt || null,
    updatedAt: notice.updatedAt || null,
    isRead: extra.isRead === true,
    readAt: extra.readAt || null
  };
}

function visibleToGroups(notice, groupIds) {
  const allowed = notice.trainingGroupIds || [];
  if (!allowed.length) {
    return true;
  }
  return allowed.some((groupId) => groupIds.includes(groupId));
}

function createNoticeActions({ repository }) {
  async function loadManageActor(identity) {
    return loadActiveActor(repository, identity, [
      ROLES.COACH,
      ROLES.DEVELOPER
    ]);
  }

  async function assertGroupsManageable(actor, groupIds) {
    const groupsMap = await repository.getGroupsMap(groupIds);
    if (groupsMap.size !== groupIds.length) {
      fail('TRAINING_GROUP_NOT_FOUND', '存在无效的训练组。');
    }
    if (!isDeveloper(actor)) {
      const coachGroups = await repository.getCoachGroupIds(actor._id);
      if (groupIds.some((groupId) => !coachGroups.includes(groupId))) {
        fail('OUT_OF_SCOPE', '只能向本人负责训练组发布通知。');
      }
    }
  }

  async function assertNoticeManageable(actor, notice) {
    if (isDeveloper(actor)) {
      return;
    }
    const coachGroups = await repository.getCoachGroupIds(actor._id);
    if (
      !canFullyManageScope({
        actor,
        resourceGroupIds: notice.trainingGroupIds || [],
        coachGroupIds: coachGroups
      })
    ) {
      fail('OUT_OF_SCOPE', '只能管理本人负责训练组的通知。');
    }
  }

  async function listManageNotices({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateNoticeQueryPayload(payload || {});
    const result = await repository.listClubNotices({
      statuses: input.status ? [input.status] : null,
      maxRecords: 300
    });
    const coachGroups = isDeveloper(actor)
      ? null
      : await repository.getCoachGroupIds(actor._id);
    const visible = result.records.filter(
      (notice) =>
        coachGroups === null || visibleToGroups(notice, coachGroups)
    );
    const groupsMap = await repository.getGroupsMap(
      Array.from(
        new Set(visible.flatMap((notice) => notice.trainingGroupIds || []))
      )
    );
    return {
      notices: visible
        .filter((notice) => !input.category || notice.category === input.category)
        .map((notice) =>
          readableNotice(notice, {
            trainingGroupNames: (notice.trainingGroupIds || [])
              .map((groupId) => (groupsMap.get(groupId) || {}).name)
              .filter(Boolean),
            canManage:
              isDeveloper(actor) ||
              canFullyManageScope({
                actor,
                resourceGroupIds: notice.trainingGroupIds || [],
                coachGroupIds: coachGroups || []
              })
          })
        ),
      total: visible.length,
      truncated: result.incomplete
    };
  }

  async function getManageNoticeDetail({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const noticeId = safeId(payload && payload.noticeId, '通知');
    const notice = await repository.getClubNotice(noticeId);
    if (!notice) {
      fail('NOTICE_NOT_FOUND', '通知不存在。');
    }
    await assertNoticeManageable(actor, notice);
    const groupsMap = await repository.getGroupsMap(notice.trainingGroupIds || []);
    return {
      notice: readableNotice(notice, {
        trainingGroupNames: (notice.trainingGroupIds || [])
          .map((groupId) => (groupsMap.get(groupId) || {}).name)
          .filter(Boolean),
        canManage: true
      })
    };
  }

  async function createNotice({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateNoticeCreatePayload(payload);
    if (!isDeveloper(actor) && !input.trainingGroupIds.length) {
      fail('INVALID_FIELD', '教练发布通知时必须指定可见训练组。');
    }
    await assertGroupsManageable(actor, input.trainingGroupIds);
    const noticeId = repository.noticeIdForRequest(
      actor._id,
      input.clientRequestId
    );
    const existing = await repository.getClubNotice(noticeId);
    if (existing) {
      return { notice: readableNotice(existing), duplicate: true };
    }
    const now = new Date();
    const noticeData = {
      noticeId,
      ...input,
      status: NOTICE_STATUS.DRAFT,
      version: 1,
      publishedAt: null,
      withdrawnAt: null,
      archivedAt: null,
      createdBy: actor._id,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1
    };
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.CLUB_NOTICES)
        .doc(noticeId);
      const current = await getDocumentOrNull(reference);
      if (current) {
        return;
      }
      await assertCanFullyManageScopesInTransaction({
        transaction,
        actor,
        resourceGroupIdSets: [input.trainingGroupIds]
      });
      await reference.set({ data: noticeData });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_notice_create_${noticeId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.NOTICE_CREATED,
            targetType: 'club_notice',
            targetId: noticeId,
            result: 'success',
            metadata: {
              category: input.category,
              priority: input.priority,
              trainingGroupIds: input.trainingGroupIds
            },
            createdAt: now
          }
        });
    });
    const created = await repository.getClubNotice(noticeId);
    return { notice: readableNotice(created), duplicate: false };
  }

  async function updateNotice({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateNoticeUpdatePayload(payload);
    const notice = await repository.getClubNotice(input.noticeId);
    if (!notice) {
      fail('NOTICE_NOT_FOUND', '通知不存在。');
    }
    await assertNoticeManageable(actor, notice);
    if (notice.status !== NOTICE_STATUS.DRAFT) {
      fail('NOTICE_NOT_DRAFT', '只有草稿通知可以修改。');
    }
    await assertGroupsManageable(actor, input.trainingGroupIds);
    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.CLUB_NOTICES)
        .doc(input.noticeId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('NOTICE_NOT_FOUND', '通知不存在。');
      }
      await assertCanFullyManageScopesInTransaction({
        transaction,
        actor,
        resourceGroupIdSets: [
          current.trainingGroupIds || [],
          input.trainingGroupIds
        ]
      });
      if ((Number(current.version) || 1) !== input.expectedVersion) {
        fail('NOTICE_VERSION_CONFLICT', '通知已被其他操作更新，请重新加载。');
      }
      await reference.update({
        data: {
          title: input.title,
          content: input.content,
          category: input.category,
          priority: input.priority,
          trainingGroupIds: input.trainingGroupIds,
          version: input.expectedVersion + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_notice_update_${input.noticeId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.NOTICE_UPDATED,
            targetType: 'club_notice',
            targetId: input.noticeId,
            result: 'success',
            metadata: { fromVersion: input.expectedVersion },
            createdAt: now
          }
        });
    });
    const updated = await repository.getClubNotice(input.noticeId);
    return { notice: readableNotice(updated) };
  }

  async function transitionNotice({
    identity,
    payload,
    allowedFrom,
    targetStatus,
    auditAction,
    timestampField
  }) {
    const actor = await loadManageActor(identity);
    const input = validateNoticeActionPayload(payload);
    const notice = await repository.getClubNotice(input.noticeId);
    if (!notice) {
      fail('NOTICE_NOT_FOUND', '通知不存在。');
    }
    await assertNoticeManageable(actor, notice);
    if (notice.status === targetStatus) {
      return { notice: readableNotice(notice), alreadyInTarget: true };
    }
    if (!allowedFrom.includes(notice.status)) {
      fail('NOTICE_STATUS_INVALID', '当前通知状态不允许执行该操作。');
    }
    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.CLUB_NOTICES)
        .doc(input.noticeId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('NOTICE_NOT_FOUND', '通知不存在。');
      }
      await assertCanFullyManageScopesInTransaction({
        transaction,
        actor,
        resourceGroupIdSets: [current.trainingGroupIds || []]
      });
      if ((Number(current.version) || 1) !== input.expectedVersion) {
        fail('NOTICE_VERSION_CONFLICT', '通知已被其他操作更新，请重新加载。');
      }
      await reference.update({
        data: {
          status: targetStatus,
          [timestampField]: now,
          version: input.expectedVersion + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_notice_${targetStatus}_${input.noticeId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: auditAction,
            targetType: 'club_notice',
            targetId: input.noticeId,
            result: 'success',
            metadata: {
              fromStatus: current.status,
              toStatus: targetStatus
            },
            createdAt: now
          }
        });
    });
    const updated = await repository.getClubNotice(input.noticeId);
    return { notice: readableNotice(updated), alreadyInTarget: false };
  }

  async function publishNotice({ identity, payload }) {
    return transitionNotice({
      identity,
      payload,
      allowedFrom: [NOTICE_STATUS.DRAFT],
      targetStatus: NOTICE_STATUS.PUBLISHED,
      auditAction: AUDIT_ACTIONS.NOTICE_PUBLISHED,
      timestampField: 'publishedAt'
    });
  }

  async function withdrawNotice({ identity, payload }) {
    return transitionNotice({
      identity,
      payload,
      allowedFrom: [NOTICE_STATUS.PUBLISHED],
      targetStatus: NOTICE_STATUS.WITHDRAWN,
      auditAction: AUDIT_ACTIONS.NOTICE_WITHDRAWN,
      timestampField: 'withdrawnAt'
    });
  }

  async function archiveNotice({ identity, payload }) {
    return transitionNotice({
      identity,
      payload,
      allowedFrom: [NOTICE_STATUS.PUBLISHED, NOTICE_STATUS.WITHDRAWN],
      targetStatus: NOTICE_STATUS.ARCHIVED,
      auditAction: AUDIT_ACTIONS.NOTICE_ARCHIVED,
      timestampField: 'archivedAt'
    });
  }

  async function loadStudentVisibleNotices(actor) {
    const groupIds = await repository.getStudentGroupIds(actor._id);
    const groupsMap = await repository.getGroupsMap(groupIds);
    const enabledGroupIds = groupIds.filter(
      (groupId) => (groupsMap.get(groupId) || {}).enabled === true
    );
    const result = await repository.listClubNotices({
      statuses: [NOTICE_STATUS.PUBLISHED],
      maxRecords: 300
    });
    return {
      notices: result.records.filter((notice) =>
        visibleToGroups(notice, enabledGroupIds)
      ),
      groupsMap,
      incomplete: result.incomplete
    };
  }

  async function listStudentNotices({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateNoticeQueryPayload(payload || {});
    const { notices, incomplete } = await loadStudentVisibleNotices(actor);
    const reads = await repository.listNoticeReads(actor._id, {
      noticeIds: notices.map((notice) => notice.noticeId || notice._id)
    });
    const readsMap = new Map(
      reads.records.map((read) => [read.noticeId, read])
    );
    const mapped = notices
      .map((notice) => {
        const noticeId = notice.noticeId || notice._id;
        const read = readsMap.get(noticeId) || null;
        return readableNotice(notice, {
          isRead: Boolean(read),
          readAt: read ? read.readAt : null
        });
      })
      .filter((notice) => !input.category || notice.category === input.category)
      .filter((notice) => !input.unreadOnly || !notice.isRead);
    mapped.sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority === 'important' ? -1 : 1;
      }
      return String(right.publishedAt || '').localeCompare(
        String(left.publishedAt || '')
      );
    });
    return {
      notices: mapped,
      unreadCount: mapped.filter((notice) => !notice.isRead).length,
      truncated: incomplete
    };
  }

  async function getStudentNoticeDetail({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateNoticeReadPayload(payload);
    const notice = await repository.getClubNotice(input.noticeId);
    if (!notice || notice.status !== NOTICE_STATUS.PUBLISHED) {
      fail('NOTICE_NOT_FOUND', '通知不存在或已不可查看。');
    }
    const groupIds = await repository.getStudentGroupIds(actor._id);
    const groupsMap = await repository.getGroupsMap(groupIds);
    const enabledGroupIds = groupIds.filter(
      (groupId) => (groupsMap.get(groupId) || {}).enabled === true
    );
    if (!visibleToGroups(notice, enabledGroupIds)) {
      fail('OUT_OF_SCOPE', '该通知不在本人可见范围内。');
    }
    const read = await repository.getNoticeRead(input.noticeId, actor._id);
    return {
      notice: readableNotice(notice, {
        isRead: Boolean(read),
        readAt: read ? read.readAt : null
      })
    };
  }

  async function markNoticeRead({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateNoticeReadPayload(payload);
    const notice = await repository.getClubNotice(input.noticeId);
    if (!notice || notice.status !== NOTICE_STATUS.PUBLISHED) {
      fail('NOTICE_NOT_FOUND', '通知不存在或已不可查看。');
    }
    const groupIds = await repository.getStudentGroupIds(actor._id);
    const groupsMap = await repository.getGroupsMap(groupIds);
    const enabledGroupIds = groupIds.filter(
      (groupId) => (groupsMap.get(groupId) || {}).enabled === true
    );
    if (!visibleToGroups(notice, enabledGroupIds)) {
      fail('OUT_OF_SCOPE', '该通知不在本人可见范围内。');
    }
    const readId = repository.noticeReadId(input.noticeId, actor._id);
    const existing = await repository.getNoticeRead(input.noticeId, actor._id);
    if (existing) {
      return { read: { noticeId: input.noticeId, readAt: existing.readAt }, duplicate: true };
    }
    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.NOTICE_READS)
        .doc(readId);
      const current = await getDocumentOrNull(reference);
      if (current) {
        return;
      }
      await reference.set({
        data: {
          readId,
          noticeId: input.noticeId,
          studentUserId: actor._id,
          readAt: now,
          schemaVersion: 1
        }
      });
    });
    return { read: { noticeId: input.noticeId, readAt: now }, duplicate: false };
  }

  async function getUnreadCount({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const { notices } = await loadStudentVisibleNotices(actor);
    const reads = await repository.listNoticeReads(actor._id, {
      noticeIds: notices.map((notice) => notice.noticeId || notice._id)
    });
    const readIds = new Set(reads.records.map((read) => read.noticeId));
    return {
      unreadCount: notices.filter(
        (notice) => !readIds.has(notice.noticeId || notice._id)
      ).length
    };
  }

  return {
    'notice.list_manage': listManageNotices,
    'notice.get_manage_detail': getManageNoticeDetail,
    'notice.create': createNotice,
    'notice.update': updateNotice,
    'notice.publish': publishNotice,
    'notice.withdraw': withdrawNotice,
    'notice.archive': archiveNotice,
    'notice.list_student': listStudentNotices,
    'notice.get_student_detail': getStudentNoticeDetail,
    'notice.mark_read': markNoticeRead,
    'notice.unread_count': getUnreadCount
  };
}

module.exports = createNoticeActions;
