'use strict';

const {
  AUDIT_ACTIONS,
  COLLECTIONS,
  PLAN_STATUS,
  ROLES
} = require('../lib/constants');
const { clubDateOnly, endOfWeek, startOfWeek } = require('../lib/dates');
const { fail } = require('../lib/errors');
const { deterministicId } = require('../lib/repository');
const { loadActiveActor } = require('../lib/session');
const { getDocumentOrNull } = require('../lib/transaction');
const {
  PLAN_CATEGORIES,
  PLAN_STATUSES,
  safeId,
  validatePlanActionPayload,
  validatePlanCopyPayload,
  validatePlanCreatePayload,
  validatePlanManageQueryPayload,
  validatePlanUpdatePayload,
  validateStudentPlanQueryPayload
} = require('../lib/validation');

const CATEGORY_LABELS = Object.freeze({
  sprint: '短跑专项',
  middle_long_distance: '中长跑专项',
  strength: '力量训练',
  jump: '跳跃训练',
  throw: '投掷训练',
  recovery: '恢复训练',
  technique: '技术训练',
  other: '其他'
});

function readablePlanItem(item) {
  return {
    itemId: item.itemId || '',
    order: item.order,
    category: item.category,
    categoryLabel: CATEGORY_LABELS[item.category] || item.category,
    name: item.name,
    eventCode: item.eventCode || '',
    eventName: item.eventName || '',
    target: item.target || '',
    sets: item.sets,
    reps: item.reps,
    distanceMeters: item.distanceMeters,
    durationSeconds: item.durationSeconds,
    restSeconds: item.restSeconds,
    load: item.load || '',
    notes: item.notes || ''
  };
}

function readablePlan(plan, extra = {}) {
  return {
    id: plan._id,
    planId: plan.planId || plan._id,
    title: plan.title,
    trainingGroupId: plan.trainingGroupId,
    trainingGroupName: extra.trainingGroupName || '',
    coachUserId: plan.coachUserId,
    startDate: plan.startDate,
    endDate: plan.endDate,
    status: plan.status,
    version: Number(plan.version) || 1,
    notes: plan.notes || '',
    items: (plan.items || []).map(readablePlanItem),
    copiedFromPlanId: plan.copiedFromPlanId || '',
    publishedAt: plan.publishedAt || null,
    archivedAt: plan.archivedAt || null,
    createdAt: plan.createdAt || null,
    updatedAt: plan.updatedAt || null
  };
}

function buildPlanItems(planId, items) {
  return items.map((item) => ({
    itemId: deterministicId('planitem', planId, String(item.order)),
    ...item
  }));
}

function isDeveloper(actor) {
  return actor.roles.includes(ROLES.DEVELOPER);
}

function createPlanActions({ repository }) {
  async function loadManageActor(identity) {
    return loadActiveActor(repository, identity, [
      ROLES.COACH,
      ROLES.DEVELOPER
    ]);
  }

  async function loadManageablePlan(actor, planId) {
    const plan = await repository.getTrainingPlan(planId);
    if (!plan) {
      fail('PLAN_NOT_FOUND', '训练计划不存在。');
    }
    const group = await repository.getTrainingGroup(plan.trainingGroupId);
    if (!group) {
      fail('TRAINING_GROUP_NOT_FOUND', '训练组不存在。');
    }
    if (!isDeveloper(actor)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      if (!groupIds.includes(plan.trainingGroupId)) {
        fail('OUT_OF_SCOPE', '只能管理本人负责训练组的训练计划。');
      }
    }
    return { plan, group };
  }

  async function assertGroupManageable(actor, trainingGroupId) {
    const group = await repository.getTrainingGroup(trainingGroupId);
    if (!group) {
      fail('TRAINING_GROUP_NOT_FOUND', '训练组不存在。');
    }
    if (!isDeveloper(actor)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      if (!groupIds.includes(trainingGroupId)) {
        fail('OUT_OF_SCOPE', '只能管理本人负责训练组的训练计划。');
      }
    }
    return group;
  }

  async function listPlanMeta({ identity }) {
    const actor = await loadManageActor(identity);
    let groups = [];
    if (isDeveloper(actor)) {
      groups = await repository.listAllTrainingGroups();
    } else {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      const groupsMap = await repository.getGroupsMap(groupIds);
      groups = groupIds
        .map((groupId) => groupsMap.get(groupId))
        .filter(Boolean);
    }
    return {
      categories: PLAN_CATEGORIES.map((code) => ({
        code,
        label: CATEGORY_LABELS[code] || code
      })),
      groups: groups
        .filter((group) => group.enabled === true)
        .map((group) => ({
          id: group._id,
          groupId: group.groupId || group._id,
          name: group.name,
          seasonLabel: group.seasonLabel || '未标注'
        })),
      statuses: PLAN_STATUSES.slice()
    };
  }

  async function listManagePlans({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validatePlanManageQueryPayload(payload || {});
    let groupIds = null;

    if (!isDeveloper(actor)) {
      groupIds = await repository.getCoachGroupIds(actor._id);
      if (input.trainingGroupId && !groupIds.includes(input.trainingGroupId)) {
        fail('OUT_OF_SCOPE', '只能查看本人负责训练组的训练计划。');
      }
    }

    const result = await repository.listTrainingPlans({
      groupIds: input.trainingGroupId ? [input.trainingGroupId] : groupIds,
      statuses: input.status ? [input.status] : null,
      fromDate: input.fromDate,
      toDate: input.toDate,
      orderDirection: 'asc',
      maxRecords: 300
    });
    const groupIdsInResult = Array.from(
      new Set(result.records.map((plan) => plan.trainingGroupId))
    );
    const groupsMap = await repository.getGroupsMap(groupIdsInResult);

    return {
      plans: result.records.map((plan) =>
        readablePlan(plan, {
          trainingGroupName: (groupsMap.get(plan.trainingGroupId) || {}).name || ''
        })
      ),
      total: result.total,
      truncated: result.incomplete
    };
  }

  async function getManagePlanDetail({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const planId = safeId(payload && payload.planId, '训练计划');
    const { plan, group } = await loadManageablePlan(actor, planId);
    return {
      plan: readablePlan(plan, { trainingGroupName: group.name })
    };
  }

  async function createPlan({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validatePlanCreatePayload(payload);
    const group = await assertGroupManageable(actor, input.trainingGroupId);
    if (group.enabled !== true) {
      fail('TRAINING_GROUP_DISABLED', '训练组已停用，不能创建训练计划。');
    }

    const planId = repository.planIdForRequest(actor._id, input.clientRequestId);
    const existing = await repository.getTrainingPlan(planId);
    if (existing) {
      return {
        plan: readablePlan(existing, { trainingGroupName: group.name }),
        duplicate: true
      };
    }

    const now = new Date();
    const planData = {
      planId,
      coachUserId: actor._id,
      trainingGroupId: input.trainingGroupId,
      title: input.title,
      startDate: input.startDate,
      endDate: input.endDate,
      notes: input.notes,
      items: buildPlanItems(planId, input.items),
      status: PLAN_STATUS.DRAFT,
      version: 1,
      copiedFromPlanId: '',
      publishedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1
    };

    await repository.db.runTransaction(async (transaction) => {
      const planReference = transaction
        .collection(COLLECTIONS.TRAINING_PLANS)
        .doc(planId);
      const current = await getDocumentOrNull(planReference);
      if (current) {
        return;
      }
      await planReference.set({ data: planData });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_plan_create_${planId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.PLAN_CREATED,
            targetType: 'training_plan',
            targetId: planId,
            result: 'success',
            metadata: {
              trainingGroupId: input.trainingGroupId,
              startDate: input.startDate,
              endDate: input.endDate,
              status: PLAN_STATUS.DRAFT
            },
            createdAt: now
          }
        });
    });

    const created = await repository.getTrainingPlan(planId);
    return {
      plan: readablePlan(created, { trainingGroupName: group.name }),
      duplicate: false
    };
  }

  async function updatePlan({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validatePlanUpdatePayload(payload);
    const { plan, group } = await loadManageablePlan(actor, input.planId);
    if (plan.status === PLAN_STATUS.ARCHIVED) {
      fail('PLAN_ARCHIVED', '已归档计划不可编辑。');
    }

    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const planReference = transaction
        .collection(COLLECTIONS.TRAINING_PLANS)
        .doc(input.planId);
      const current = await getDocumentOrNull(planReference);
      if (!current) {
        fail('PLAN_NOT_FOUND', '训练计划不存在。');
      }
      if (current.status === PLAN_STATUS.ARCHIVED) {
        fail('PLAN_ARCHIVED', '已归档计划不可编辑。');
      }
      if ((Number(current.version) || 1) !== input.expectedVersion) {
        fail('PLAN_VERSION_CONFLICT', '计划已被其他操作更新，请重新加载后再保存。');
      }

      const update = {
        title: input.title,
        startDate: input.startDate,
        endDate: input.endDate,
        notes: input.notes,
        items: buildPlanItems(input.planId, input.items),
        version: input.expectedVersion + 1,
        updatedAt: now
      };
      await planReference.update({ data: update });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_plan_update_${input.planId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.PLAN_UPDATED,
            targetType: 'training_plan',
            targetId: input.planId,
            result: 'success',
            metadata: {
              fromVersion: input.expectedVersion,
              toVersion: input.expectedVersion + 1,
              status: current.status
            },
            createdAt: now
          }
        });
    });

    const updated = await repository.getTrainingPlan(input.planId);
    return {
      plan: readablePlan(updated, { trainingGroupName: group.name })
    };
  }

  async function publishPlan({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validatePlanActionPayload(payload);
    const { plan, group } = await loadManageablePlan(actor, input.planId);
    if (group.enabled !== true) {
      fail('TRAINING_GROUP_DISABLED', '训练组已停用，不能发布训练计划。');
    }
    if (plan.status === PLAN_STATUS.ARCHIVED) {
      fail('PLAN_ARCHIVED', '已归档计划不可发布。');
    }
    if (plan.status === PLAN_STATUS.PUBLISHED) {
      if ((Number(plan.version) || 1) !== input.expectedVersion) {
        fail('PLAN_VERSION_CONFLICT', '计划已被其他操作更新，请重新加载。');
      }
      return {
        plan: readablePlan(plan, { trainingGroupName: group.name }),
        alreadyPublished: true
      };
    }

    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const planReference = transaction
        .collection(COLLECTIONS.TRAINING_PLANS)
        .doc(input.planId);
      const current = await getDocumentOrNull(planReference);
      if (!current) {
        fail('PLAN_NOT_FOUND', '训练计划不存在。');
      }
      if (current.status !== PLAN_STATUS.DRAFT) {
        fail('PLAN_NOT_DRAFT', '只有草稿计划可以发布。');
      }
      if ((Number(current.version) || 1) !== input.expectedVersion) {
        fail('PLAN_VERSION_CONFLICT', '计划已被其他操作更新，请重新加载。');
      }
      await planReference.update({
        data: {
          status: PLAN_STATUS.PUBLISHED,
          publishedAt: now,
          version: input.expectedVersion + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_plan_publish_${input.planId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.PLAN_PUBLISHED,
            targetType: 'training_plan',
            targetId: input.planId,
            result: 'success',
            metadata: {
              trainingGroupId: current.trainingGroupId,
              fromVersion: input.expectedVersion,
              toVersion: input.expectedVersion + 1
            },
            createdAt: now
          }
        });
    });

    const published = await repository.getTrainingPlan(input.planId);
    return {
      plan: readablePlan(published, { trainingGroupName: group.name }),
      alreadyPublished: false
    };
  }

  async function archivePlan({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validatePlanActionPayload(payload);
    const { plan, group } = await loadManageablePlan(actor, input.planId);
    if (plan.status === PLAN_STATUS.ARCHIVED) {
      return {
        plan: readablePlan(plan, { trainingGroupName: group.name }),
        alreadyArchived: true
      };
    }

    const now = new Date();
    await repository.db.runTransaction(async (transaction) => {
      const planReference = transaction
        .collection(COLLECTIONS.TRAINING_PLANS)
        .doc(input.planId);
      const current = await getDocumentOrNull(planReference);
      if (!current) {
        fail('PLAN_NOT_FOUND', '训练计划不存在。');
      }
      if (current.status === PLAN_STATUS.ARCHIVED) {
        return;
      }
      if ((Number(current.version) || 1) !== input.expectedVersion) {
        fail('PLAN_VERSION_CONFLICT', '计划已被其他操作更新，请重新加载。');
      }
      await planReference.update({
        data: {
          status: PLAN_STATUS.ARCHIVED,
          archivedAt: now,
          version: input.expectedVersion + 1,
          updatedAt: now
        }
      });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_plan_archive_${input.planId}_${input.expectedVersion + 1}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.PLAN_ARCHIVED,
            targetType: 'training_plan',
            targetId: input.planId,
            result: 'success',
            metadata: {
              trainingGroupId: current.trainingGroupId,
              fromStatus: current.status,
              fromVersion: input.expectedVersion,
              toVersion: input.expectedVersion + 1
            },
            createdAt: now
          }
        });
    });

    const archived = await repository.getTrainingPlan(input.planId);
    return {
      plan: readablePlan(archived, { trainingGroupName: group.name }),
      alreadyArchived: false
    };
  }

  async function copyPlan({ identity, payload }) {
    const actor = await loadManageActor(identity);
    const input = validatePlanCopyPayload(payload);
    const { plan: sourcePlan, group } = await loadManageablePlan(
      actor,
      input.sourcePlanId
    );
    if (group.enabled !== true) {
      fail('TRAINING_GROUP_DISABLED', '训练组已停用，不能复制训练计划。');
    }

    const newPlanId = repository.copyPlanIdForRequest(
      actor._id,
      input.sourcePlanId,
      input.clientRequestId
    );
    const existing = await repository.getTrainingPlan(newPlanId);
    if (existing) {
      return {
        plan: readablePlan(existing, { trainingGroupName: group.name }),
        duplicate: true
      };
    }

    const startDate = input.startDate || sourcePlan.startDate;
    const endDate = input.endDate || (input.startDate ? input.startDate : sourcePlan.endDate);
    if (endDate < startDate) {
      fail('INVALID_FIELD', '计划结束日期不能早于开始日期。');
    }
    const title = (input.title || `${sourcePlan.title}（副本）`).slice(0, 60);
    const now = new Date();
    const planData = {
      planId: newPlanId,
      coachUserId: actor._id,
      trainingGroupId: sourcePlan.trainingGroupId,
      title,
      startDate,
      endDate,
      notes: sourcePlan.notes || '',
      items: buildPlanItems(newPlanId, sourcePlan.items || []),
      status: PLAN_STATUS.DRAFT,
      version: 1,
      copiedFromPlanId: input.sourcePlanId,
      publishedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1
    };

    await repository.db.runTransaction(async (transaction) => {
      const planReference = transaction
        .collection(COLLECTIONS.TRAINING_PLANS)
        .doc(newPlanId);
      const current = await getDocumentOrNull(planReference);
      if (current) {
        return;
      }
      await planReference.set({ data: planData });
      await transaction
        .collection(COLLECTIONS.AUDIT_LOGS)
        .doc(`audit_plan_copy_${newPlanId}`)
        .set({
          data: {
            actorUserId: actor._id,
            action: AUDIT_ACTIONS.PLAN_COPIED,
            targetType: 'training_plan',
            targetId: newPlanId,
            result: 'success',
            metadata: {
              sourcePlanId: input.sourcePlanId,
              trainingGroupId: sourcePlan.trainingGroupId,
              startDate,
              endDate
            },
            createdAt: now
          }
        });
    });

    const copied = await repository.getTrainingPlan(newPlanId);
    return {
      plan: readablePlan(copied, { trainingGroupName: group.name }),
      duplicate: false
    };
  }

  async function listStudentPlans({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const input = validateStudentPlanQueryPayload(payload || {});
    const date = input.date || clubDateOnly();
    const groupIds = await repository.getStudentGroupIds(actor._id);
    if (!groupIds.length) {
      return { scope: input.scope, date, plans: [], total: 0, truncated: false };
    }

    const groupsMap = await repository.getGroupsMap(groupIds);
    const enabledGroupIds = groupIds.filter(
      (groupId) => (groupsMap.get(groupId) || {}).enabled === true
    );
    if (!enabledGroupIds.length) {
      return { scope: input.scope, date, plans: [], total: 0, truncated: false };
    }

    let fromDate = '';
    let toDate = '';
    let orderDirection = 'asc';
    if (input.scope === 'today') {
      fromDate = date;
      toDate = date;
    } else if (input.scope === 'week') {
      fromDate = startOfWeek(date);
      toDate = endOfWeek(date);
    } else {
      toDate = date;
      orderDirection = 'desc';
    }

    const result = await repository.listTrainingPlans({
      groupIds: enabledGroupIds,
      statuses: [PLAN_STATUS.PUBLISHED],
      fromDate,
      toDate,
      orderDirection,
      maxRecords: 300
    });

    return {
      scope: input.scope,
      date,
      plans: result.records.map((plan) =>
        readablePlan(plan, {
          trainingGroupName: (groupsMap.get(plan.trainingGroupId) || {}).name || ''
        })
      ),
      total: result.total,
      truncated: result.incomplete
    };
  }

  async function getStudentPlanDetail({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    const planId = safeId(payload && payload.planId, '训练计划');
    const plan = await repository.getTrainingPlan(planId);
    if (!plan || plan.status !== PLAN_STATUS.PUBLISHED) {
      fail('PLAN_NOT_FOUND', '训练计划不存在或尚未发布。');
    }
    const groupIds = await repository.getStudentGroupIds(actor._id);
    if (!groupIds.includes(plan.trainingGroupId)) {
      fail('OUT_OF_SCOPE', '只能查看本人训练组的训练计划。');
    }
    const group = await repository.getTrainingGroup(plan.trainingGroupId);
    if (!group || group.enabled !== true) {
      fail('PLAN_NOT_AVAILABLE', '训练计划所属训练组当前不可用。');
    }
    return {
      plan: readablePlan(plan, { trainingGroupName: group.name })
    };
  }

  return {
    'plan.list_meta': listPlanMeta,
    'plan.list_manage': listManagePlans,
    'plan.get_manage_detail': getManagePlanDetail,
    'plan.create': createPlan,
    'plan.update': updatePlan,
    'plan.publish': publishPlan,
    'plan.archive': archivePlan,
    'plan.copy': copyPlan,
    'plan.list_student': listStudentPlans,
    'plan.get_student': getStudentPlanDetail
  };
}

module.exports = createPlanActions;
