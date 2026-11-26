'use strict';

const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  COMPETITION_ATTACHMENT_STATUS,
  COMPETITION_MATERIAL_POLICY,
  COMPETITION_REGISTRATION_STATUS,
  COMPETITION_STATUS,
  ROLES
} = require('../lib/constants');
const { clubDateTimeString } = require('../lib/dates');
const { fail } = require('../lib/errors');
const {
  assertCanFullyManageScopesInTransaction,
  canFullyManageScope,
  isDeveloperActor
} = require('../lib/management-scope');
const { listPerformanceEvents } = require('../lib/performance-events');
const { deterministicId } = require('../lib/repository');
const { loadActiveActor } = require('../lib/session');
const defaultStorage = require('../lib/storage');
const { getDocumentOrNull } = require('../lib/transaction');
const {
  safeId,
  validateCompetitionActionPayload,
  validateCompetitionCreatePayload,
  validateCompetitionQueryPayload,
  validateCompetitionUpdatePayload,
  validateGetMaterialUrlPayload,
  validateIntentCancelPayload,
  validateIntentSubmitPayload,
  validateListMyMaterialsPayload,
  validateListRegistrationMaterialsPayload,
  validateMaterialPolicyPayload,
  validateRegisterMaterialPayload,
  validateRegistrationQueryPayload,
  validateRegistrationStatusPayload,
  validateRemoveMaterialPayload
} = require('../lib/validation');

const ACTIVE_REGISTRATION_STATUSES = Object.freeze([
  COMPETITION_REGISTRATION_STATUS.SUBMITTED,
  COMPETITION_REGISTRATION_STATUS.PROCESSING,
  COMPETITION_REGISTRATION_STATUS.REGISTERED,
  COMPETITION_REGISTRATION_STATUS.FAILED
]);

function isDeveloper(actor) {
  return isDeveloperActor(actor);
}

function competitionPhase(competition, now = new Date()) {
  if (competition.status === COMPETITION_STATUS.DRAFT) {
    return 'draft';
  }
  if (competition.status === COMPETITION_STATUS.ARCHIVED) {
    return 'archived';
  }
  if (competition.status === COMPETITION_STATUS.CLOSED) {
    return 'closed';
  }
  const current = clubDateTimeString(now);
  if (current < competition.registrationStartAt) {
    return 'not_started';
  }
  if (current > competition.registrationEndAt) {
    return 'closed';
  }
  return 'open';
}

function readableCompetition(competition, extra = {}) {
  return {
    id: competition._id,
    competitionId: competition.competitionId || competition._id,
    title: competition.title,
    description: competition.description || '',
    location: competition.location,
    eventDate: competition.eventDate,
    registrationStartAt: competition.registrationStartAt,
    registrationEndAt: competition.registrationEndAt,
    requirements: competition.requirements || '',
    events: (competition.events || []).map((event) => ({ ...event })),
    trainingGroupIds: competition.trainingGroupIds || [],
    trainingGroupNames: extra.trainingGroupNames || [],
    canManage: extra.canManage === true,
    capacityEnabled: competition.capacityEnabled === true,
    capacity: competition.capacity === undefined ? null : competition.capacity,
    activeStudentCount: Number(competition.activeStudentCount) || 0,
    notes: competition.notes || '',
    status: competition.status,
    phase: extra.phase || competitionPhase(competition),
    version: Number(competition.version) || 1,
    createdBy: competition.createdBy,
    createdAt: competition.createdAt || null,
    updatedAt: competition.updatedAt || null,
    registration: extra.registration || null,
    stats: extra.stats || null
  };
}

function readableIntentItem(item) {
  return {
    itemId: item.itemId || '',
    eventCode: item.eventCode,
    eventName: item.eventName,
    unit: item.unit || '',
    category: item.category
  };
}

function readableRegistration(registration, extra = {}) {
  return {
    id: registration._id,
    registrationId: registration.registrationId || registration._id,
    competitionId: registration.competitionId,
    competitionTitle: extra.competitionTitle || '',
    studentUserId: registration.studentUserId,
    studentName: extra.studentName || '',
    trainingGroupIds: registration.trainingGroupIds || [],
    trainingGroupNames: extra.trainingGroupNames || [],
    items: (registration.items || []).map(readableIntentItem),
    contactNote: registration.contactNote || '',
    status: registration.status,
    reviewNote: registration.reviewNote || '',
    reviewedBy: registration.reviewedBy || '',
    reviewedAt: registration.reviewedAt || null,
    statusHistory: (registration.statusHistory || []).map((entry) => ({
      status: entry.status,
      at: entry.at || null,
      by: entry.by || '',
      note: entry.note || ''
    })),
    version: Number(registration.version) || 1,
    createdAt: registration.createdAt || null,
    updatedAt: registration.updatedAt || null
  };
}

function itemKey(eventCode, category) {
  return `${eventCode}|${category}`;
}

function readableAttachment(attachment) {
  return {
    id: attachment._id,
    attachmentId: attachment._id,
    competitionId: attachment.competitionId,
    registrationId: attachment.registrationId,
    studentUserId: attachment.studentUserId,
    fileName: attachment.fileName,
    extension: attachment.extension,
    contentType: attachment.contentType,
    sizeBytes: Number(attachment.sizeBytes) || 0,
    status: attachment.status,
    createdAt: attachment.createdAt || null,
    updatedAt: attachment.updatedAt || null,
    removedAt: attachment.removedAt || null
  };
}

function createCompetitionActions({ repository, storage = defaultStorage }) {
  async function loadManageActor(identity) {
    return loadActiveActor(repository, identity, [
      ROLES.COACH,
      ROLES.DEVELOPER
    ]);
  }

  async function manageableGroupIds(actor) {
    return isDeveloper(actor)
      ? null
      : repository.getCoachGroupIds(actor._id);
  }

  async function assertGroupsManageable(actor, groupIds) {
    const groupMap = await repository.getGroupsMap(groupIds);
    if (groupMap.size !== groupIds.length) {
      fail('TRAINING_GROUP_NOT_FOUND', '存在无效的训练组。');
    }
    if (!isDeveloper(actor)) {
      const coachGroups = await repository.getCoachGroupIds(actor._id);
      const outside = groupIds.filter((groupId) => !coachGroups.includes(groupId));
      if (outside.length) {
        fail('OUT_OF_SCOPE', '只能向本人负责训练组发布赛事。');
      }
    }
  }

  function competitionVisibleToGroups(competition, groupIds) {
    const allowed = competition.trainingGroupIds || [];
    if (!allowed.length) {
      return true;
    }
    return allowed.some((groupId) => groupIds.includes(groupId));
  }

  async function assertCompetitionManageable(actor, competition) {
    if (isDeveloper(actor)) {
      return;
    }
    const coachGroups = await repository.getCoachGroupIds(actor._id);
    if (
      !canFullyManageScope({
        actor,
        resourceGroupIds: competition.trainingGroupIds || [],
        coachGroupIds: coachGroups
      })
    ) {
      fail('OUT_OF_SCOPE', '只能管理本人负责训练组的赛事。');
    }
  }

  async function listMeta({ identity }) {
    const actor = await loadManageActor(identity);
    const groupIds = await manageableGroupIds(actor);
    const groups =
      groupIds === null
        ? await repository.listEnabledTrainingGroups()
        : Array.from((await repository.getGroupsMap(groupIds)).values());
    return {
      groups: groups
        .filter((group) => group.enabled === true)
        .map((group) => ({
          id: group._id,
          groupId: group.groupId || group._id,
          name: group.name,
          seasonLabel: group.seasonLabel || '未标注'
        })),
      events: listPerformanceEvents()
    };
  }

  async function listManageCompetitions({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateCompetitionQueryPayload(payload || {});
    const result = await repository.listCompetitions({
      statuses: input.status ? [input.status] : null,
      maxRecords: 300
    });
    const coachGroups = isDeveloper(actor)
      ? null
      : await repository.getCoachGroupIds(actor._id);
    const visible = result.records.filter((competition) =>
      coachGroups === null
        ? true
        : competitionVisibleToGroups(competition, coachGroups)
    );
    const groupsMap = await repository.getGroupsMap(
      Array.from(
        new Set(visible.flatMap((competition) => competition.trainingGroupIds || []))
      )
    );
    return {
      competitions: visible.map((competition) =>
        readableCompetition(competition, {
          trainingGroupNames: (competition.trainingGroupIds || [])
            .map((groupId) => (groupsMap.get(groupId) || {}).name)
            .filter(Boolean)
          ,
          canManage:
            isDeveloper(actor) ||
            canFullyManageScope({
              actor,
              resourceGroupIds: competition.trainingGroupIds || [],
              coachGroupIds: coachGroups || []
            })
        })
      ),
      total: visible.length,
      truncated: result.incomplete
    };
  }

  async function getManageCompetitionDetail({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const competitionId = safeId(payload && payload.competitionId, '赛事');
    const competition = await repository.getCompetition(competitionId);
    if (!competition) {
      fail('COMPETITION_NOT_FOUND', '赛事不存在。');
    }
    await assertCompetitionManageable(actor, competition);
    const groupsMap = await repository.getGroupsMap(competition.trainingGroupIds || []);
    const registrations = await repository.listRegistrations({
      competitionId,
      statuses: ACTIVE_REGISTRATION_STATUSES,
      maxRecords: 1000
    });
    const eventCounts = {};
    for (const registration of registrations.records) {
      for (const item of registration.items || []) {
        eventCounts[item.eventCode] = (eventCounts[item.eventCode] || 0) + 1;
      }
    }
    return {
      competition: readableCompetition(competition, {
        trainingGroupNames: (competition.trainingGroupIds || [])
          .map((groupId) => (groupsMap.get(groupId) || {}).name)
          .filter(Boolean),
        canManage: true,
        stats: {
          studentCount: registrations.records.length,
          eventCounts
        }
      })
    };
  }

  async function createCompetition({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateCompetitionCreatePayload(payload);
    if (!isDeveloper(actor) && !input.trainingGroupIds.length) {
      fail('INVALID_FIELD', '教练发布赛事时必须指定可见训练组。');
    }
    await assertGroupsManageable(actor, input.trainingGroupIds);
    const competitionId = repository.competitionIdForRequest(
      actor._id,
      input.clientRequestId
    );
    const existing = await repository.getCompetition(competitionId);
    if (existing) {
      return { competition: readableCompetition(existing), duplicate: true };
    }
    const now = new Date();
    const competitionData = {
      competitionId,
      ...input,
      status: COMPETITION_STATUS.DRAFT,
      activeStudentCount: 0,
      version: 1,
      createdBy: actor._id,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1
    };
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.COMPETITIONS)
        .doc(competitionId);
      const current = await getDocumentOrNull(reference);
      if (current) {
        return;
      }
      await assertCanFullyManageScopesInTransaction({
        transaction,
        actor,
        resourceGroupIdSets: [input.trainingGroupIds]
      });
      await reference.set({ data: competitionData });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_competition_create_${competitionId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.COMPETITION_CREATED,
            targetType: 'competition',
            targetId: competitionId,
            result: 'success',
            metadata: {
              title: input.title,
              trainingGroupIds: input.trainingGroupIds,
              capacityEnabled: input.capacityEnabled
            },
            createdAt: now
          }
        });
    });
    const created = await repository.getCompetition(competitionId);
    return { competition: readableCompetition(created), duplicate: false };
  }

  async function updateCompetition({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateCompetitionUpdatePayload(payload);
    const competition = await repository.getCompetition(input.competitionId);
    if (!competition) {
      fail('COMPETITION_NOT_FOUND', '赛事不存在。');
    }
    await assertCompetitionManageable(actor, competition);
    if (competition.status !== COMPETITION_STATUS.DRAFT) {
      fail('COMPETITION_NOT_DRAFT', '已发布赛事不可直接修改，请关闭后归档并重新创建。');
    }
    await assertGroupsManageable(actor, input.trainingGroupIds);
    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.COMPETITIONS)
        .doc(input.competitionId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('COMPETITION_NOT_FOUND', '赛事不存在。');
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
        fail('COMPETITION_VERSION_CONFLICT', '赛事已被其他操作更新，请重新加载。');
      }
      await reference.update({
        data: {
          title: input.title,
          description: input.description,
          location: input.location,
          eventDate: input.eventDate,
          registrationStartAt: input.registrationStartAt,
          registrationEndAt: input.registrationEndAt,
          requirements: input.requirements,
          events: input.events,
          trainingGroupIds: input.trainingGroupIds,
          capacityEnabled: input.capacityEnabled,
          capacity: input.capacity,
          notes: input.notes,
          version: input.expectedVersion + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_competition_update_${input.competitionId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.COMPETITION_UPDATED,
            targetType: 'competition',
            targetId: input.competitionId,
            result: 'success',
            metadata: { fromVersion: input.expectedVersion },
            createdAt: now
          }
        });
    });
    const updated = await repository.getCompetition(input.competitionId);
    return { competition: readableCompetition(updated) };
  }

  async function transitionCompetition({ identity, payload, targetStatus, auditAction }) {
    const actor = await loadManageActor(identity);
    const input = validateCompetitionActionPayload(payload);
    const competition = await repository.getCompetition(input.competitionId);
    if (!competition) {
      fail('COMPETITION_NOT_FOUND', '赛事不存在。');
    }
    await assertCompetitionManageable(actor, competition);
    if (competition.status === targetStatus) {
      return {
        competition: readableCompetition(competition),
        alreadyInTarget: true
      };
    }
    if (competition.status === COMPETITION_STATUS.ARCHIVED) {
      fail('COMPETITION_ARCHIVED', '已归档赛事不可再变更状态。');
    }
    if (
      targetStatus === COMPETITION_STATUS.PUBLISHED &&
      competition.status !== COMPETITION_STATUS.DRAFT
    ) {
      fail('COMPETITION_NOT_DRAFT', '只有草稿赛事可以发布。');
    }
    if (targetStatus === COMPETITION_STATUS.PUBLISHED) {
      const current = clubDateTimeString(new Date());
      if (current > competition.registrationEndAt) {
        fail('COMPETITION_WINDOW_ENDED', '报名截止时间已过，不能发布赛事。');
      }
    }
    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.COMPETITIONS)
        .doc(input.competitionId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('COMPETITION_NOT_FOUND', '赛事不存在。');
      }
      await assertCanFullyManageScopesInTransaction({
        transaction,
        actor,
        resourceGroupIdSets: [current.trainingGroupIds || []]
      });
      if ((Number(current.version) || 1) !== input.expectedVersion) {
        fail('COMPETITION_VERSION_CONFLICT', '赛事已被其他操作更新，请重新加载。');
      }
      await reference.update({
        data: {
          status: targetStatus,
          version: input.expectedVersion + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_competition_${targetStatus}_${input.competitionId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: auditAction,
            targetType: 'competition',
            targetId: input.competitionId,
            result: 'success',
            metadata: {
              fromStatus: current.status,
              toStatus: targetStatus
            },
            createdAt: now
          }
        });
    });
    const updated = await repository.getCompetition(input.competitionId);
    return { competition: readableCompetition(updated), alreadyInTarget: false };
  }

  async function publishCompetition({ identity, payload }) {
    return transitionCompetition({
      identity,
      payload,
      targetStatus: COMPETITION_STATUS.PUBLISHED,
      auditAction: AUDIT_ACTIONS.COMPETITION_PUBLISHED
    });
  }

  async function closeCompetition({ identity, payload }) {
    return transitionCompetition({
      identity,
      payload,
      targetStatus: COMPETITION_STATUS.CLOSED,
      auditAction: AUDIT_ACTIONS.COMPETITION_CLOSED
    });
  }

  async function archiveCompetition({ identity, payload }) {
    return transitionCompetition({
      identity,
      payload,
      targetStatus: COMPETITION_STATUS.ARCHIVED,
      auditAction: AUDIT_ACTIONS.COMPETITION_ARCHIVED
    });
  }

  async function listStudentCompetitions({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const groupIds = await repository.getStudentGroupIds(actor._id);
    const groupsMap = await repository.getGroupsMap(groupIds);
    const enabledGroupIds = groupIds.filter(
      (groupId) => (groupsMap.get(groupId) || {}).enabled === true
    );
    const result = await repository.listCompetitions({
      statuses: [COMPETITION_STATUS.PUBLISHED, COMPETITION_STATUS.CLOSED],
      maxRecords: 300
    });
    const visible = result.records.filter((competition) =>
      competitionVisibleToGroups(competition, enabledGroupIds)
    );
    const registrationResult = await repository.listRegistrations({
      studentUserId: actor._id,
      maxRecords: 300
    });
    const registrationMap = new Map(
      registrationResult.records.map((registration) => [
        registration.competitionId,
        registration
      ])
    );
    return {
      competitions: visible.map((competition) =>
        readableCompetition(competition, {
          registration: registrationMap.has(competition.competitionId)
            ? readableRegistration(
                registrationMap.get(competition.competitionId)
              )
            : null
        })
      )
    };
  }

  async function getStudentCompetitionDetail({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const competitionId = safeId(payload && payload.competitionId, '赛事');
    const competition = await repository.getCompetition(competitionId);
    if (!competition || competition.status === COMPETITION_STATUS.DRAFT) {
      fail('COMPETITION_NOT_FOUND', '赛事不存在或尚未发布。');
    }
    const groupIds = await repository.getStudentGroupIds(actor._id);
    const groupsMap = await repository.getGroupsMap(groupIds);
    const enabledGroupIds = groupIds.filter(
      (groupId) => (groupsMap.get(groupId) || {}).enabled === true
    );
    if (!competitionVisibleToGroups(competition, enabledGroupIds)) {
      fail('OUT_OF_SCOPE', '该赛事不在本人训练组可见范围内。');
    }
    const registrationId = repository.registrationIdForStudentCompetition(
      actor._id,
      competitionId
    );
    const registration = await repository.getRegistration(registrationId);
    return {
      competition: readableCompetition(competition, {
        trainingGroupNames: (competition.trainingGroupIds || [])
          .map((groupId) => (groupsMap.get(groupId) || {}).name)
          .filter(Boolean),
        registration: registration ? readableRegistration(registration) : null
      })
    };
  }

  async function submitIntent({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateIntentSubmitPayload(payload);
    const competition = await repository.getCompetition(input.competitionId);
    if (!competition || competition.status !== COMPETITION_STATUS.PUBLISHED) {
      fail('COMPETITION_NOT_OPEN', '赛事不存在或未开放报名意向。');
    }
    if (competitionPhase(competition) !== 'open') {
      fail('COMPETITION_NOT_OPEN', '当前不在报名意向开放时间内。');
    }
    const groupIds = await repository.getStudentGroupIds(actor._id);
    const groupsMap = await repository.getGroupsMap(groupIds);
    const enabledGroupIds = groupIds.filter(
      (groupId) => (groupsMap.get(groupId) || {}).enabled === true
    );
    if (!competitionVisibleToGroups(competition, enabledGroupIds)) {
      fail('OUT_OF_SCOPE', '该赛事不在本人训练组报名范围内。');
    }
    const allowedItems = new Set();
    for (const event of competition.events || []) {
      for (const category of event.categories || []) {
        allowedItems.add(itemKey(event.code || event.eventCode, category));
      }
    }
    for (const item of input.items) {
      if (!allowedItems.has(itemKey(item.eventCode, item.category))) {
        fail('INVALID_FIELD', '所选项目或组别不在赛事开放范围内。');
      }
    }

    const registrationId = repository.registrationIdForStudentCompetition(
      actor._id,
      input.competitionId
    );
    const existing = await repository.getRegistration(registrationId);
    if (
      existing &&
      existing.status === COMPETITION_REGISTRATION_STATUS.REGISTERED
    ) {
      fail('REGISTRATION_LOCKED', '官方报名已提交，不能在小程序中修改意向。');
    }
    const activeCount = await repository.countRegistrations(
      input.competitionId,
      ACTIVE_REGISTRATION_STATUSES
    );
    if (
      competition.capacityEnabled === true &&
      competition.capacity &&
      !existing &&
      activeCount >= competition.capacity
    ) {
      fail('CAPACITY_FULL', '该赛事意向人数已达上限。');
    }

    const now = new Date();
    const isNew = !existing;
    const isResubmit =
      existing && existing.status === COMPETITION_REGISTRATION_STATUS.CANCELLED;
    const existingItems = isResubmit || !existing ? [] : existing.items || [];
    const merged = new Map();
    for (const item of existingItems) {
      merged.set(itemKey(item.eventCode, item.category), item);
    }
    for (const item of input.items) {
      const key = itemKey(item.eventCode, item.category);
      merged.set(key, {
        itemId: `${registrationId}_${key}`,
        eventCode: item.eventCode,
        eventName: item.eventName,
        unit: item.unit,
        category: item.category,
        selectedAt: now
      });
    }
    const items = Array.from(merged.values());
    const status = isResubmit || !existing
      ? COMPETITION_REGISTRATION_STATUS.SUBMITTED
      : existing.status;
    const registrationData = {
      registrationId,
      competitionId: input.competitionId,
      studentUserId: actor._id,
      trainingGroupIds: enabledGroupIds,
      items,
      contactNote: input.contactNote,
      status,
      reviewNote: isResubmit || !existing ? '' : existing.reviewNote || '',
      reviewedBy: isResubmit || !existing ? '' : existing.reviewedBy || '',
      reviewedAt: isResubmit || !existing ? null : existing.reviewedAt || null,
      statusHistory: [
        ...((existing && existing.statusHistory) || []),
        {
          status,
          at: now,
          by: actor._id,
          note: isNew ? '提交参赛意向' : isResubmit ? '重新提交意向' : '更新报名项目'
        }
      ],
      version: existing ? (Number(existing.version) || 1) + 1 : 1,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      schemaVersion: 1
    };

    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.COMPETITION_REGISTRATIONS)
        .doc(registrationId);
      const current = await getDocumentOrNull(reference);
      if (
        current &&
        current.status === COMPETITION_REGISTRATION_STATUS.REGISTERED
      ) {
        fail('REGISTRATION_LOCKED', '官方报名已提交，不能修改意向。');
      }
      const competitionReference = transaction
        .collection(COLLECTIONS.COMPETITIONS)
        .doc(input.competitionId);
      const currentCompetition = await getDocumentOrNull(competitionReference);
      if (!currentCompetition) {
        fail('COMPETITION_NOT_FOUND', '赛事不存在。');
      }
      const isNewActiveRegistration =
        !current || current.status === COMPETITION_REGISTRATION_STATUS.CANCELLED;
      const activeCount = Number(currentCompetition.activeStudentCount) || 0;
      if (
        isNewActiveRegistration &&
        currentCompetition.capacityEnabled === true &&
        currentCompetition.capacity &&
        activeCount >= currentCompetition.capacity
      ) {
        fail('CAPACITY_FULL', '该赛事意向人数已达上限。');
      }
      if (isNewActiveRegistration) {
        await competitionReference.update({
          data: {
            activeStudentCount: activeCount + 1,
            updatedAt: now
          }
        });
      }
      if (current) {
        await reference.update({
          data: {
            ...registrationData,
            createdAt: current.createdAt
          }
        });
      } else {
        await reference.set({ data: registrationData });
      }
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_competition_intent_${registrationId}_${registrationData.version}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.REGISTRATION_SUBMITTED,
            targetType: 'competition_registration',
            targetId: registrationId,
            result: 'success',
            metadata: {
              competitionId: input.competitionId,
              itemCount: items.length,
              status
            },
            createdAt: now
          }
        });
    });

    const saved = await repository.getRegistration(registrationId);
    return { registration: readableRegistration(saved), duplicate: !isNew && !isResubmit };
  }

  async function cancelIntent({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateIntentCancelPayload(payload);
    const registration = await repository.getRegistration(input.registrationId);
    if (!registration || registration.studentUserId !== actor._id) {
      fail('REGISTRATION_NOT_FOUND', '报名意向不存在。');
    }
    if (registration.status === COMPETITION_REGISTRATION_STATUS.REGISTERED) {
      fail(
        'REGISTRATION_LOCKED',
        '官方报名已提交，请在小程序中取消意向不会自动撤销官方报名，请联系教练处理。'
      );
    }
    if (registration.status === COMPETITION_REGISTRATION_STATUS.CANCELLED) {
      return { registration: readableRegistration(registration), alreadyCancelled: true };
    }
    const removeCodes = new Set(input.eventCodes);
    const items = removeCodes.size
      ? (registration.items || []).filter((item) => !removeCodes.has(item.eventCode))
      : [];
    const status =
      items.length === 0
        ? COMPETITION_REGISTRATION_STATUS.CANCELLED
        : registration.status;
    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.COMPETITION_REGISTRATIONS)
        .doc(input.registrationId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('REGISTRATION_NOT_FOUND', '报名意向不存在。');
      }
      if (current.status === COMPETITION_REGISTRATION_STATUS.REGISTERED) {
        fail('REGISTRATION_LOCKED', '官方报名已提交，不能取消意向。');
      }
      const wasActive =
        current.status !== COMPETITION_REGISTRATION_STATUS.CANCELLED &&
        (current.items || []).length > 0;
      if (status === COMPETITION_REGISTRATION_STATUS.CANCELLED && wasActive) {
        const competitionReference = transaction
          .collection(COLLECTIONS.COMPETITIONS)
          .doc(current.competitionId);
        const competition = await getDocumentOrNull(competitionReference);
        if (competition) {
          await competitionReference.update({
            data: {
              activeStudentCount: Math.max(
                0,
                (Number(competition.activeStudentCount) || 0) - 1
              ),
              updatedAt: now
            }
          });
        }
      }
      await reference.update({
        data: {
          items,
          status,
          statusHistory: [
            ...(current.statusHistory || []),
            {
              status,
              at: now,
              by: actor._id,
              note: removeCodes.size ? '取消部分参赛项目' : '取消参赛意向'
            }
          ],
          version: (Number(current.version) || 1) + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_competition_intent_cancel_${input.registrationId}_${now.getTime()}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.REGISTRATION_CANCELLED,
            targetType: 'competition_registration',
            targetId: input.registrationId,
            result: 'success',
            metadata: {
              competitionId: current.competitionId,
              cancelledEvents: input.eventCodes,
              status
            },
            createdAt: now
          }
        });
    });
    const updated = await repository.getRegistration(input.registrationId);
    return { registration: readableRegistration(updated), alreadyCancelled: false };
  }

  async function listMyIntents({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const result = await repository.listRegistrations({
      studentUserId: actor._id,
      maxRecords: 300
    });
    const competitionMap = new Map();
    for (const registration of result.records) {
      if (!competitionMap.has(registration.competitionId)) {
        const competition = await repository.getCompetition(registration.competitionId);
        if (competition) {
          competitionMap.set(registration.competitionId, competition);
        }
      }
    }
    return {
      registrations: result.records.map((registration) =>
        readableRegistration(registration, {
          competitionTitle:
            (competitionMap.get(registration.competitionId) || {}).title || ''
        })
      )
    };
  }

  async function listManagedRegistrations({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateRegistrationQueryPayload(payload || {});
    let studentUserIds = null;
    if (!isDeveloper(actor)) {
      const groupIds = input.trainingGroupId
        ? [input.trainingGroupId]
        : await repository.getCoachGroupIds(actor._id);
      const coachGroups = await repository.getCoachGroupIds(actor._id);
      if (input.trainingGroupId && !coachGroups.includes(input.trainingGroupId)) {
        fail('OUT_OF_SCOPE', '只能查看本人负责训练组的报名意向。');
      }
      studentUserIds = await repository.getStudentUserIdsForGroups(groupIds);
      if (!studentUserIds.length) {
        return { registrations: [], total: 0, truncated: false };
      }
    }
    const result = await repository.listRegistrations({
      competitionId: input.competitionId,
      studentUserIds,
      statuses: input.status ? [input.status] : null,
      maxRecords: 300
    });
    const filtered = result.records.filter((registration) => {
      if (!input.eventCode && !input.category) {
        return true;
      }
      return (registration.items || []).some(
        (item) =>
          (!input.eventCode || item.eventCode === input.eventCode) &&
          (!input.category || item.category === input.category)
      );
    });
    const studentIds = Array.from(
      new Set(filtered.map((registration) => registration.studentUserId))
    );
    const profilesMap = await repository.getProfilesMap(studentIds);
    const groupNamesMap = new Map();
    for (const registration of filtered) {
      for (const groupId of registration.trainingGroupIds || []) {
        if (!groupNamesMap.has(groupId)) {
          groupNamesMap.set(groupId, groupId);
        }
      }
    }
    const groupsMap = await repository.getGroupsMap(
      Array.from(groupNamesMap.keys())
    );
    const competitionIds = Array.from(
      new Set(filtered.map((registration) => registration.competitionId))
    );
    const competitionsMap = new Map();
    for (const competitionId of competitionIds) {
      const competition = await repository.getCompetition(competitionId);
      if (competition) {
        competitionsMap.set(competitionId, competition);
      }
    }
    return {
      registrations: filtered.map((registration) =>
        readableRegistration(registration, {
          studentName: (profilesMap.get(registration.studentUserId) || {}).name || '',
          trainingGroupNames: (registration.trainingGroupIds || [])
            .map((groupId) => (groupsMap.get(groupId) || {}).name)
            .filter(Boolean),
          competitionTitle:
            (competitionsMap.get(registration.competitionId) || {}).title || ''
        })
      ),
      total: filtered.length,
      truncated: result.incomplete
    };
  }

  async function getManagedRegistrationDetail({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const registrationId = safeId(payload && payload.registrationId, '报名记录');
    const registration = await repository.getRegistration(registrationId);
    if (!registration) {
      fail('REGISTRATION_NOT_FOUND', '报名意向不存在。');
    }
    if (!isDeveloper(actor)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      const studentIds = await repository.getStudentUserIdsForGroups(groupIds);
      if (!studentIds.includes(registration.studentUserId)) {
        fail('OUT_OF_SCOPE', '只能查看本人负责训练组学生的报名资料。');
      }
    }
    const profile = await repository.getProfile(registration.studentUserId);
    return {
      registration: readableRegistration(registration, {
        studentName: (profile || {}).name || ''
      })
    };
  }

  async function updateRegistrationStatus({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateRegistrationStatusPayload(payload);
    const registration = await repository.getRegistration(input.registrationId);
    if (!registration) {
      fail('REGISTRATION_NOT_FOUND', '报名意向不存在。');
    }
    if (!isDeveloper(actor)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      const studentIds = await repository.getStudentUserIdsForGroups(groupIds);
      if (!studentIds.includes(registration.studentUserId)) {
        fail('OUT_OF_SCOPE', '只能处理本人负责训练组学生的报名。');
      }
    }
    if (registration.status === COMPETITION_REGISTRATION_STATUS.CANCELLED) {
      fail('REGISTRATION_CANCELLED', '已取消的报名意向不可变更办理状态。');
    }
    if (
      registration.status === COMPETITION_REGISTRATION_STATUS.REGISTERED &&
      input.status !== COMPETITION_REGISTRATION_STATUS.REGISTERED
    ) {
      fail('REGISTRATION_LOCKED', '已确认官方报名的记录不可回退状态。');
    }
    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const reference = transaction
        .collection(COLLECTIONS.COMPETITION_REGISTRATIONS)
        .doc(input.registrationId);
      const current = await getDocumentOrNull(reference);
      if (!current) {
        fail('REGISTRATION_NOT_FOUND', '报名意向不存在。');
      }
      if ((Number(current.version) || 1) !== input.expectedVersion) {
        fail('REGISTRATION_VERSION_CONFLICT', '报名记录已被其他操作更新，请重新加载。');
      }
      if (
        input.status === COMPETITION_REGISTRATION_STATUS.CANCELLED &&
        current.status !== COMPETITION_REGISTRATION_STATUS.CANCELLED
      ) {
        const competitionReference = transaction
          .collection(COLLECTIONS.COMPETITIONS)
          .doc(current.competitionId);
        const competition = await getDocumentOrNull(competitionReference);
        if (competition) {
          await competitionReference.update({
            data: {
              activeStudentCount: Math.max(
                0,
                (Number(competition.activeStudentCount) || 0) - 1
              ),
              updatedAt: now
            }
          });
        }
      }
      await reference.update({
        data: {
          status: input.status,
          reviewNote: input.comment,
          reviewedBy: actor._id,
          reviewedAt: now,
          statusHistory: [
            ...(current.statusHistory || []),
            {
              status: input.status,
              at: now,
              by: actor._id,
              note: input.comment || '更新报名办理状态'
            }
          ],
          version: input.expectedVersion + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_competition_reg_status_${input.registrationId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.REGISTRATION_STATUS_CHANGED,
            targetType: 'competition_registration',
            targetId: input.registrationId,
            result: 'success',
            metadata: {
              fromStatus: current.status,
              toStatus: input.status
            },
            createdAt: now
          }
        });
    });
    const updated = await repository.getRegistration(input.registrationId);
    return { registration: readableRegistration(updated) };
  }

  async function exportRegistrationRows({ identity, payload }) {
    const result = await listManagedRegistrations({ identity, payload });
    const rows = [];
    for (const registration of result.registrations) {
      for (const item of registration.items) {
        rows.push({
          competitionTitle: registration.competitionTitle,
          studentName: registration.studentName,
          trainingGroups: registration.trainingGroupNames.join('、'),
          eventName: item.eventName,
          category: item.category,
          status: registration.status,
          reviewNote: registration.reviewNote,
          contactNote: registration.contactNote,
          registrationId: registration.registrationId
        });
        if (rows.length >= 1000) {
          break;
        }
      }
      if (rows.length >= 1000) {
        break;
      }
    }
    return {
      rows,
      total: rows.length,
      truncated: result.truncated || rows.length >= 1000
    };
  }

  function attachmentIdFor(registrationId, clientRequestId) {
    if (typeof repository.competitionAttachmentIdForRequest === 'function') {
      return repository.competitionAttachmentIdForRequest(
        registrationId,
        clientRequestId
      );
    }
    return deterministicId(
      'competition_attachment',
      registrationId,
      clientRequestId
    );
  }

  async function listAttachmentsByFilter(filter) {
    if (typeof repository.listCompetitionAttachments === 'function') {
      const result = await repository.listCompetitionAttachments(filter);
      return result.records || [];
    }
    const where = {};
    if (filter.competitionId) {
      where.competitionId = filter.competitionId;
    }
    if (filter.registrationId) {
      where.registrationId = filter.registrationId;
    }
    if (filter.studentUserId) {
      where.studentUserId = filter.studentUserId;
    }
    if (filter.status) {
      where.status = filter.status;
    }
    const records = await repository.queryAll(
      repository.competitionAttachmentCollection,
      where,
      300
    );
    return records.sort(
      (left, right) =>
        new Date(right.createdAt || 0).getTime() -
        new Date(left.createdAt || 0).getTime()
    );
  }

  async function getAttachmentById(attachmentId) {
    if (typeof repository.getCompetitionAttachment === 'function') {
      return repository.getCompetitionAttachment(attachmentId);
    }
    const list = await repository.queryAll(
      repository.competitionAttachmentCollection,
      { _id: attachmentId },
      1
    );
    return list[0] || null;
  }

  async function getMaterialPolicy({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateMaterialPolicyPayload(payload);
    const competition = await repository.getCompetition(input.competitionId);
    if (!competition || competition.status === COMPETITION_STATUS.DRAFT) {
      fail('COMPETITION_NOT_FOUND', '赛事不存在。');
    }
    const studentGroupIds = await repository.getStudentGroupIds(actor._id);
    if (!competitionVisibleToGroups(competition, studentGroupIds)) {
      fail('OUT_OF_SCOPE', '该赛事不在本人训练组可见范围内。');
    }
    const activeAttachments = await listAttachmentsByFilter({
      competitionId: input.competitionId,
      studentUserId: actor._id,
      status: COMPETITION_ATTACHMENT_STATUS.ACTIVE
    });
    const uploadedCount = activeAttachments.length;
    const maxFiles = COMPETITION_MATERIAL_POLICY.MAX_FILES_PER_COMPETITION;
    return {
      competitionId: input.competitionId,
      allowedExtensions: [...COMPETITION_MATERIAL_POLICY.ALLOWED_EXTENSIONS],
      maxSizeBytes: COMPETITION_MATERIAL_POLICY.MAX_SIZE_BYTES,
      maxFilesPerCompetition: maxFiles,
      uploadedCount,
      remainingCount: Math.max(0, maxFiles - uploadedCount)
    };
  }

  async function registerMaterial({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateRegisterMaterialPayload(payload);

    const expectedPrefix = `${COMPETITION_MATERIAL_POLICY.STORAGE_PREFIX}/${input.competitionId}/${actor._id}/`;
    if (!input.cloudPath.startsWith(expectedPrefix)) {
      fail('INVALID_CLOUD_PATH', '材料存储路径必须归属于当前学生与目标赛事。');
    }
    const relativeSegment = input.cloudPath.slice(expectedPrefix.length);
    if (!relativeSegment || relativeSegment.includes('/')) {
      fail('INVALID_CLOUD_PATH', '材料存储路径不合法。');
    }

    const competition = await repository.getCompetition(input.competitionId);
    if (!competition) {
      fail('COMPETITION_NOT_FOUND', '赛事不存在。');
    }
    if (competition.status !== COMPETITION_STATUS.PUBLISHED) {
      fail('COMPETITION_NOT_OPEN', '当前赛事状态不允许上传报名材料。');
    }

    const registration = await repository.getRegistration(input.registrationId);
    if (
      !registration ||
      registration.competitionId !== input.competitionId ||
      registration.studentUserId !== actor._id ||
      !ACTIVE_REGISTRATION_STATUSES.includes(registration.status)
    ) {
      fail(
        'REGISTRATION_REQUIRED',
        '请先提交该赛事的有效参赛意向后再上传材料。'
      );
    }

    const attachmentId = attachmentIdFor(
      input.registrationId,
      input.clientRequestId
    );
    const existing = await getAttachmentById(attachmentId);
    if (
      existing &&
      existing.studentUserId === actor._id &&
      existing.competitionId === input.competitionId
    ) {
      return {
        attachment: readableAttachment(existing),
        duplicate: true
      };
    }

    const fileStat = await storage.statFile(input.fileId);
    if (
      !fileStat ||
      typeof fileStat.sizeBytes !== 'number' ||
      !Number.isFinite(fileStat.sizeBytes)
    ) {
      fail(
        'FILE_NOT_FOUND_IN_STORAGE',
        '未在云存储中校验到已上传的材料文件，请重新上传。'
      );
    }
    if (
      fileStat.sizeBytes <= 0 ||
      fileStat.sizeBytes > COMPETITION_MATERIAL_POLICY.MAX_SIZE_BYTES
    ) {
      fail('INVALID_FILE_SIZE', '材料文件实际大小超出允许范围（最大 10MB）。');
    }

    const verifiedSizeBytes = Math.floor(fileStat.sizeBytes);
    const now = new Date();
    const txResult = await repository.db.runTransaction(async (transaction) => {
      const attachmentReference = transaction
        .collection(COLLECTIONS.COMPETITION_ATTACHMENTS)
        .doc(attachmentId);
      const current = await getDocumentOrNull(attachmentReference);
      if (current) {
        if (
          current.studentUserId !== actor._id ||
          current.competitionId !== input.competitionId
        ) {
          fail('OUT_OF_SCOPE', '材料请求标识与当前学生或赛事不匹配。');
        }
        return { attachment: current, duplicate: true };
      }

      const activeQuery = await transaction
        .collection(COLLECTIONS.COMPETITION_ATTACHMENTS)
        .where({
          competitionId: input.competitionId,
          studentUserId: actor._id,
          status: COMPETITION_ATTACHMENT_STATUS.ACTIVE
        })
        .limit(COMPETITION_MATERIAL_POLICY.MAX_FILES_PER_COMPETITION)
        .get();
      if (
        (activeQuery.data || []).length >=
        COMPETITION_MATERIAL_POLICY.MAX_FILES_PER_COMPETITION
      ) {
        fail(
          'MATERIAL_LIMIT_EXCEEDED',
          `每人每场赛事最多上传 ${COMPETITION_MATERIAL_POLICY.MAX_FILES_PER_COMPETITION} 份材料。`
        );
      }

      const recordData = {
        competitionId: input.competitionId,
        registrationId: input.registrationId,
        studentUserId: actor._id,
        cloudPath: input.cloudPath,
        fileId: input.fileId,
        fileName: input.fileName,
        extension: input.extension,
        contentType: input.contentType,
        sizeBytes: verifiedSizeBytes,
        status: COMPETITION_ATTACHMENT_STATUS.ACTIVE,
        createdAt: now,
        updatedAt: now,
        removedAt: null,
        removedBy: '',
        uploadedBy: actor._id,
        schemaVersion: 1
      };
      await attachmentReference.set({ data: recordData });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(
          deterministicId(
            'audit_competition_material_reg',
            attachmentId,
            actor._id
          )
        )
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.COMPETITION_MATERIAL_REGISTERED,
            targetType: 'competition_attachment',
            targetId: attachmentId,
            result: 'success',
            metadata: {
              attachmentId,
              competitionId: input.competitionId,
              registrationId: input.registrationId,
              extension: input.extension,
              sizeBytes: verifiedSizeBytes
            },
            createdAt: now
          }
        });
      return {
        attachment: { _id: attachmentId, ...recordData },
        duplicate: false
      };
    });

    return {
      attachment: readableAttachment(txResult.attachment),
      duplicate: txResult.duplicate
    };
  }

  async function removeMaterial({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateRemoveMaterialPayload(payload);
    const existing = await getAttachmentById(input.attachmentId);
    if (!existing) {
      fail('ATTACHMENT_NOT_FOUND', '材料记录不存在。');
    }
    if (existing.studentUserId !== actor._id) {
      fail('OUT_OF_SCOPE', '只能删除本人上传的赛事材料。');
    }
    if (existing.status === COMPETITION_ATTACHMENT_STATUS.REMOVED) {
      return {
        attachment: readableAttachment(existing),
        alreadyRemoved: true
      };
    }

    /* Delete cloud storage file first; if storage deletion fails, keep DB record active so caller can retry cleanly. */
    await storage.deleteFile(existing.fileId);

    const now = new Date();
    const txResult = await repository.db.runTransaction(async (transaction) => {
      const attachmentReference = transaction
        .collection(COLLECTIONS.COMPETITION_ATTACHMENTS)
        .doc(existing._id);
      const current = await getDocumentOrNull(attachmentReference);
      if (!current) {
        fail('ATTACHMENT_NOT_FOUND', '材料记录不存在。');
      }
      if (current.studentUserId !== actor._id) {
        fail('OUT_OF_SCOPE', '只能删除本人上传的赛事材料。');
      }
      if (current.status === COMPETITION_ATTACHMENT_STATUS.REMOVED) {
        return { attachment: current, alreadyRemoved: true };
      }
      await attachmentReference.update({
        data: {
          status: COMPETITION_ATTACHMENT_STATUS.REMOVED,
          removedAt: now,
          removedBy: actor._id,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(
          deterministicId(
            'audit_competition_material_rm',
            existing._id,
            actor._id
          )
        )
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.COMPETITION_MATERIAL_REMOVED,
            targetType: 'competition_attachment',
            targetId: existing._id,
            result: 'success',
            metadata: {
              attachmentId: existing._id,
              competitionId: current.competitionId,
              registrationId: current.registrationId
            },
            createdAt: now
          }
        });
      return {
        attachment: {
          ...current,
          status: COMPETITION_ATTACHMENT_STATUS.REMOVED,
          removedAt: now,
          removedBy: actor._id,
          updatedAt: now
        },
        alreadyRemoved: false
      };
    });

    return {
      attachment: readableAttachment(txResult.attachment),
      alreadyRemoved: txResult.alreadyRemoved
    };
  }

  async function listMyMaterials({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateListMyMaterialsPayload(payload);
    const records = await listAttachmentsByFilter({
      competitionId: input.competitionId,
      studentUserId: actor._id,
      status: COMPETITION_ATTACHMENT_STATUS.ACTIVE
    });
    const activeOnly = records.filter(
      (record) => record.status === COMPETITION_ATTACHMENT_STATUS.ACTIVE
    );
    const maxFiles = COMPETITION_MATERIAL_POLICY.MAX_FILES_PER_COMPETITION;
    return {
      competitionId: input.competitionId,
      materials: activeOnly.map(readableAttachment),
      uploadedCount: activeOnly.length,
      maxFilesPerCompetition: maxFiles,
      remainingCount: Math.max(0, maxFiles - activeOnly.length)
    };
  }

  async function listRegistrationMaterials({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateListRegistrationMaterialsPayload(payload);
    const competition = await repository.getCompetition(input.competitionId);
    if (!competition) {
      fail('COMPETITION_NOT_FOUND', '赛事不存在。');
    }
    await assertCompetitionManageable(actor, competition);

    const records = await listAttachmentsByFilter({
      competitionId: input.competitionId,
      status: COMPETITION_ATTACHMENT_STATUS.ACTIVE
    });
    const activeOnly = records.filter(
      (record) => record.status === COMPETITION_ATTACHMENT_STATUS.ACTIVE
    );
    const byRegistration = {};
    const groupMap = new Map();
    for (const record of activeOnly) {
      const item = readableAttachment(record);
      if (!byRegistration[record.registrationId]) {
        byRegistration[record.registrationId] = [];
      }
      byRegistration[record.registrationId].push(item);
      if (!groupMap.has(record.registrationId)) {
        groupMap.set(record.registrationId, {
          registrationId: record.registrationId,
          studentUserId: record.studentUserId,
          materials: []
        });
      }
      groupMap.get(record.registrationId).materials.push(item);
    }

    return {
      competitionId: input.competitionId,
      byRegistration,
      groups: Array.from(groupMap.values()),
      total: activeOnly.length
    };
  }

  async function getMaterialUrl({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validateGetMaterialUrlPayload(payload);
    const attachment = await getAttachmentById(input.attachmentId);
    if (
      !attachment ||
      attachment.status !== COMPETITION_ATTACHMENT_STATUS.ACTIVE
    ) {
      fail('ATTACHMENT_NOT_FOUND', '材料记录不存在或已删除。');
    }
    const competition = await repository.getCompetition(attachment.competitionId);
    if (!competition) {
      fail('COMPETITION_NOT_FOUND', '赛事不存在。');
    }
    await assertCompetitionManageable(actor, competition);

    const expiresInSeconds = COMPETITION_MATERIAL_POLICY.TEMP_URL_MAX_AGE_SECONDS;
    const tempFileURL = await storage.getTempUrl(
      attachment.fileId,
      expiresInSeconds
    );

    await repository.writeAudit({
      actorUserId: actor._id,
      action: AUDIT_ACTIONS.COMPETITION_MATERIAL_DOWNLOADED,
      targetType: 'competition_attachment',
      targetId: attachment._id,
      result: 'success',
      metadata: {
        attachmentId: attachment._id,
        competitionId: attachment.competitionId,
        registrationId: attachment.registrationId
      }
    });

    return {
      attachmentId: attachment._id,
      competitionId: attachment.competitionId,
      registrationId: attachment.registrationId,
      fileName: attachment.fileName,
      extension: attachment.extension,
      contentType: attachment.contentType,
      sizeBytes: Number(attachment.sizeBytes) || 0,
      tempFileURL,
      expiresInSeconds
    };
  }

  return {
    'competition.list_meta': listMeta,
    'competition.list_manage': listManageCompetitions,
    'competition.get_manage_detail': getManageCompetitionDetail,
    'competition.create': createCompetition,
    'competition.update': updateCompetition,
    'competition.publish': publishCompetition,
    'competition.close': closeCompetition,
    'competition.archive': archiveCompetition,
    'competition.list_student': listStudentCompetitions,
    'competition.get_student_detail': getStudentCompetitionDetail,
    'competition.submit_intent': submitIntent,
    'competition.cancel_intent': cancelIntent,
    'competition.list_my_intents': listMyIntents,
    'competition.list_registrations': listManagedRegistrations,
    'competition.get_registration_detail': getManagedRegistrationDetail,
    'competition.update_registration_status': updateRegistrationStatus,
    'competition.export_rows': exportRegistrationRows,
    'competition.get_material_policy': getMaterialPolicy,
    'competition.register_material': registerMaterial,
    'competition.remove_material': removeMaterial,
    'competition.list_my_materials': listMyMaterials,
    'competition.list_registration_materials': listRegistrationMaterials,
    'competition.get_material_url': getMaterialUrl
  };
}

module.exports = createCompetitionActions;
