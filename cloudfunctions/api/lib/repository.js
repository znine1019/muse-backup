'use strict';

const crypto = require('crypto');
const {
  COLLECTIONS,
  MEMBERSHIP_STATUS,
  ROLES,
  USER_STATUS
} = require('./constants');

function isNotFoundError(error) {
  const message = String((error && error.message) || '').toLowerCase();
  return (
    message.includes('not exist') ||
    message.includes('not found') ||
    message.includes('document not found')
  );
}

function deterministicId(prefix, ...values) {
  const digest = crypto
    .createHash('sha256')
    .update(values.join('|'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function compareTrainingGroups(left, right) {
  const seasonOrder = String(right.seasonLabel || '').localeCompare(
    String(left.seasonLabel || ''),
    'zh-CN'
  );
  if (seasonOrder) {
    return seasonOrder;
  }
  return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
}

function createRepository(db) {
  const userCollection = db.collection(COLLECTIONS.USERS);
  const profileCollection = db.collection(COLLECTIONS.STUDENT_PROFILES);
  const parentProfileCollection = db.collection(COLLECTIONS.PARENT_PROFILES);
  const parentLinkCollection = db.collection(COLLECTIONS.PARENT_LINKS);
  const reviewCollection = db.collection(COLLECTIONS.REGISTRATION_REVIEWS);
  const roleCollection = db.collection(COLLECTIONS.ROLE_BINDINGS);
  const groupCollection = db.collection(COLLECTIONS.TRAINING_GROUPS);
  const membershipCollection = db.collection(COLLECTIONS.GROUP_MEMBERSHIPS);
  const measurementCollection = db.collection(COLLECTIONS.BODY_MEASUREMENTS);
  const performanceCollection = db.collection(COLLECTIONS.PERFORMANCE_RECORDS);
  const trainingPlanCollection = db.collection(COLLECTIONS.TRAINING_PLANS);
  const attendanceSessionCollection = db.collection(COLLECTIONS.ATTENDANCE_SESSIONS);
  const attendanceRecordCollection = db.collection(COLLECTIONS.ATTENDANCE_RECORDS);
  const leaveRequestCollection = db.collection(COLLECTIONS.LEAVE_REQUESTS);
  const competitionCollection = db.collection(COLLECTIONS.COMPETITIONS);
  const competitionRegistrationCollection = db.collection(
    COLLECTIONS.COMPETITION_REGISTRATIONS
  );
  const clubNoticeCollection = db.collection(COLLECTIONS.CLUB_NOTICES);
  const noticeReadCollection = db.collection(COLLECTIONS.NOTICE_READS);
  const trainingFeedbackCollection = db.collection(COLLECTIONS.TRAINING_FEEDBACK);
  const auditCollection = db.collection(COLLECTIONS.AUDIT_LOGS);
  const systemCollection = db.collection(COLLECTIONS.SYSTEM_CONFIG);

  async function getDoc(collection, id) {
    try {
      const result = await collection.doc(id).get();
      return result.data || null;
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  function userIdForIdentity(identity) {
    return deterministicId('usr', identity.appid || 'unknown-app', identity.openid);
  }

  function profileIdForUser(userId) {
    return deterministicId('profile', userId);
  }

  function parentProfileIdForUser(userId) {
    return deterministicId('parent_profile', userId);
  }

  /* 一次性关联凭证：同一学生同一请求标识只会生成一张凭证（幂等） */
  function parentInviteIdForRequest(studentUserId, clientRequestId) {
    return deterministicId('parent_invite', studentUserId, clientRequestId);
  }

  /* 家长—学生关联关系：一对（家长, 学生）只有一条关系记录 */
  function parentLinkIdForPair(parentUserId, studentUserId) {
    return deterministicId('parent_link', parentUserId, studentUserId);
  }

  function roleBindingId(userId, role) {
    return deterministicId('role', userId, role);
  }

  function membershipId(groupId, userId) {
    return deterministicId('member', groupId, userId);
  }

  function measurementIdForUser(userId, measuredAt, heightCm, weightKg) {
    return deterministicId(
      'measure',
      userId,
      measuredAt,
      String(heightCm),
      String(weightKg)
    );
  }

  function performanceIdForSubmission(
    studentUserId,
    eventCode,
    achievedAt,
    value
  ) {
    return deterministicId(
      'perf',
      studentUserId,
      eventCode,
      achievedAt,
      String(value)
    );
  }

  function planIdForRequest(actorUserId, clientRequestId) {
    return deterministicId('plan', actorUserId, clientRequestId);
  }

  function copyPlanIdForRequest(actorUserId, sourcePlanId, clientRequestId) {
    return deterministicId(
      'plan_copy',
      actorUserId,
      sourcePlanId,
      clientRequestId
    );
  }

  function attendanceSessionIdForRequest(actorUserId, clientRequestId) {
    return deterministicId('att', actorUserId, clientRequestId);
  }

  function attendanceRecordId(sessionId, studentUserId) {
    return deterministicId('attend', sessionId, studentUserId);
  }

  function leaveRequestId(studentUserId, sessionId, clientRequestId) {
    return deterministicId('leave', studentUserId, sessionId, clientRequestId);
  }

  function competitionIdForRequest(actorUserId, clientRequestId) {
    return deterministicId('compete', actorUserId, clientRequestId);
  }

  function registrationIdForStudentCompetition(studentUserId, competitionId) {
    return deterministicId('compreg', studentUserId, competitionId);
  }

  function noticeIdForRequest(actorUserId, clientRequestId) {
    return deterministicId('notice', actorUserId, clientRequestId);
  }

  function noticeReadId(noticeId, studentUserId) {
    return deterministicId('noticeread', noticeId, studentUserId);
  }

  function feedbackIdForStudentSession(studentUserId, sessionId) {
    return deterministicId('feedback', studentUserId, sessionId);
  }

  async function getUserById(userId) {
    return getDoc(userCollection, userId);
  }

  async function getUserByOpenId(openid) {
    const result = await userCollection.where({ _openid: openid }).limit(1).get();
    return (result.data || [])[0] || null;
  }

  async function ensureUser(identity) {
    const userId = userIdForIdentity(identity);
    let user = await getUserById(userId);

    if (user) {
      return user;
    }

    user = await getUserByOpenId(identity.openid);
    if (user) {
      return user;
    }

    const userData = {
      _id: userId,
      _openid: identity.openid,
      unionid: identity.unionid || '',
      status: USER_STATUS.PENDING_PROFILE,
      roles: [],
      schemaVersion: 1,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };

    try {
      await userCollection.add({ data: userData });
    } catch (error) {
      user = await getUserById(userId);
      if (!user) {
        user = await getUserByOpenId(identity.openid);
      }
      if (!user) {
        throw error;
      }
      return user;
    }

    user = await getUserById(userId);
    if (!user) {
      throw new Error('USER_CREATE_READBACK_FAILED');
    }

    await writeAudit({
      actorUserId: userId,
      action: 'auth.login.created',
      targetType: 'user',
      targetId: userId,
      result: 'success',
      metadata: { status: USER_STATUS.PENDING_PROFILE }
    });

    return user;
  }

  async function getProfile(userId) {
    return getDoc(profileCollection, profileIdForUser(userId));
  }

  async function getParentProfile(userId) {
    return getDoc(parentProfileCollection, parentProfileIdForUser(userId));
  }

  async function getParentLink(linkId) {
    return getDoc(parentLinkCollection, linkId);
  }

  async function listParentLinks(where, maxRecords = 100) {
    return queryAll(parentLinkCollection, where, maxRecords);
  }

  async function countParentLinksByStatus(where) {
    const result = await parentLinkCollection.where(where).count();
    return Number(result.total) || 0;
  }

  async function expireParentInvite(inviteId) {
    try {
      await parentLinkCollection.doc(inviteId).update({
        data: {
          status: 'expired',
          updatedAt: db.serverDate()
        }
      });
    } catch (error) {
      /* 凭证可能已被并发处理，忽略失效更新失败 */
    }
  }

  /*
   * 凭证失败计数（防枚举）：窗口期外自动重置。
   * 计数写在 users 文档上而不是家长档案上：账号一定存在，避免“家长档案缺失时限流失效”；
   * 调用方（loadActiveActor）已经读到该用户文档，因此不额外增加读请求。
   */
  async function recordParentInviteFailure(userId) {
    const user = await getDoc(userCollection, userId);
    if (!user) {
      return 0;
    }
    const windowAt = user.inviteFailWindowAt
      ? new Date(user.inviteFailWindowAt).getTime()
      : 0;
    const inWindow = windowAt && Date.now() - windowAt < 15 * 60 * 1000;
    const nextCount = inWindow ? Number(user.inviteFailCount || 0) + 1 : 1;
    await userCollection.doc(userId).update({
      data: {
        inviteFailCount: nextCount,
        inviteFailWindowAt: inWindow ? user.inviteFailWindowAt : db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
    return nextCount;
  }

  async function getLatestReview(userId) {
    const result = await reviewCollection.where({ userId }).limit(20).get();
    return (result.data || []).sort((left, right) => {
      const leftTime = new Date(left.createdAt || left.submittedAt || 0).getTime();
      const rightTime = new Date(right.createdAt || right.submittedAt || 0).getTime();
      return rightTime - leftTime;
    })[0] || null;
  }

  async function getTrainingGroup(groupId) {
    return getDoc(groupCollection, groupId);
  }

  async function getCoachGroupIds(userId) {
    const result = await membershipCollection
      .where({
        userId,
        roleInGroup: ROLES.COACH,
        status: MEMBERSHIP_STATUS.ACTIVE
      })
      .limit(100)
      .get();
    return (result.data || []).map((item) => item.groupId);
  }

  async function queryAll(collection, where, maxRecords = 300) {
    const batchSize = 100;
    const records = [];
    let offset = 0;

    while (records.length < maxRecords) {
      const query = where ? collection.where(where) : collection;
      const result = await query
        .skip(offset)
        .limit(Math.min(batchSize, maxRecords - records.length))
        .get();
      const batch = result.data || [];
      records.push(...batch);
      if (batch.length < batchSize) {
        break;
      }
      offset += batch.length;
    }

    return records;
  }


  async function getMeasurement(measurementId) {
    return getDoc(measurementCollection, measurementId);
  }

  async function countWhere(collection, where) {
    const result = await collection.where(where).count();
    return Number(result.total) || 0;
  }

  async function fetchAllOrdered(collection, where, orderBy, options = {}) {
    const batchSize = options.batchSize || 100;
    const maxRecords = options.maxRecords || 5000;
    const total = await countWhere(collection, where);
    if (!total) {
      return { records: [], total: 0, incomplete: false };
    }

    const records = [];
    const seen = new Set();
    let offset = 0;
    while (offset < total && records.length < maxRecords) {
      let query = collection.where(where);
      for (const order of orderBy) {
        query = query.orderBy(order.field, order.direction);
      }
      const limit = Math.min(
        batchSize,
        total - offset,
        maxRecords - records.length
      );
      const result = await query.skip(offset).limit(limit).get();
      const batch = result.data || [];
      if (!batch.length) {
        break;
      }
      for (const record of batch) {
        const key = record._id || `${offset}:${records.length}`;
        if (!seen.has(key)) {
          seen.add(key);
          records.push(record);
        }
      }
      offset += batch.length;
    }

    return {
      records,
      total,
      incomplete: records.length !== total
    };
  }

  async function listMeasurements(userId, maxRecords = 100) {
    const result = await measurementCollection
      .where({ userId })
      .limit(Math.min(maxRecords, 100))
      .get();
    return (result.data || []).sort(
      (left, right) =>
        new Date(right.measuredAt || 0).getTime() -
        new Date(left.measuredAt || 0).getTime()
    );
  }

  async function getPerformanceRecord(performanceId) {
    return getDoc(performanceCollection, performanceId);
  }

  async function getTrainingPlan(planId) {
    return getDoc(trainingPlanCollection, planId);
  }

  async function listTrainingPlans(options = {}) {
    if (Array.isArray(options.groupIds) && options.groupIds.length === 0) {
      return { records: [], total: 0, incomplete: false };
    }
    const where = {};
    if (Array.isArray(options.groupIds) && options.groupIds.length) {
      where.trainingGroupId = db.command.in(options.groupIds);
    }
    if (Array.isArray(options.statuses) && options.statuses.length) {
      where.status = db.command.in(options.statuses);
    }
    if (options.fromDate) {
      where.endDate = db.command.gte(options.fromDate);
    }
    if (options.toDate) {
      where.startDate = db.command.lte(options.toDate);
    }
    const direction = options.orderDirection === 'desc' ? 'desc' : 'asc';
    return fetchAllOrdered(
      trainingPlanCollection,
      where,
      [
        { field: 'startDate', direction },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 300 }
    );
  }

  async function getStudentGroupIds(userId) {
    const result = await membershipCollection
      .where({
        userId,
        roleInGroup: ROLES.STUDENT,
        status: MEMBERSHIP_STATUS.ACTIVE
      })
      .limit(100)
      .get();
    return Array.from(
      new Set((result.data || []).map((item) => item.groupId))
    );
  }

  async function getAttendanceSession(sessionId) {
    return getDoc(attendanceSessionCollection, sessionId);
  }

  async function listAttendanceSessions(options = {}) {
    if (Array.isArray(options.groupIds) && options.groupIds.length === 0) {
      return { records: [], total: 0, incomplete: false };
    }
    const where = {};
    if (Array.isArray(options.groupIds) && options.groupIds.length) {
      where.trainingGroupId = db.command.in(options.groupIds);
    }
    if (Array.isArray(options.statuses) && options.statuses.length) {
      where.status = db.command.in(options.statuses);
    }
    if (options.fromDate) {
      where.attendanceDate = db.command.gte(options.fromDate);
    }
    if (options.toDate) {
      where.attendanceDate = db.command.lte(options.toDate);
    }
    return fetchAllOrdered(
      attendanceSessionCollection,
      where,
      [
        { field: 'attendanceDate', direction: 'asc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 300 }
    );
  }

  async function getAttendanceRecord(sessionId, studentUserId) {
    return getDoc(
      attendanceRecordCollection,
      attendanceRecordId(sessionId, studentUserId)
    );
  }

  async function listAttendanceRecordsBySession(sessionId, options = {}) {
    return fetchAllOrdered(
      attendanceRecordCollection,
      { sessionId },
      [{ field: 'studentUserId', direction: 'asc' }],
      { maxRecords: options.maxRecords || 300 }
    );
  }

  async function listAttendanceRecordsBySessions(sessionIds, options = {}) {
    if (!sessionIds.length) {
      return { records: [], total: 0, incomplete: false };
    }
    const records = [];
    let total = 0;
    let incomplete = false;
    for (let index = 0; index < sessionIds.length; index += 100) {
      const chunk = sessionIds.slice(index, index + 100);
      const result = await fetchAllOrdered(
        attendanceRecordCollection,
        { sessionId: db.command.in(chunk) },
        [
          { field: 'sessionId', direction: 'asc' },
          { field: '_id', direction: 'asc' }
        ],
        { maxRecords: options.maxRecords || 10000 }
      );
      records.push(...result.records);
      total += result.total;
      incomplete = incomplete || result.incomplete;
    }
    return { records, total, incomplete };
  }

  async function listAttendanceRecordsByStudent(studentUserId, options = {}) {
    const where = { studentUserId };
    if (options.fromDate) {
      where.attendanceDate = db.command.gte(options.fromDate);
    }
    if (options.toDate) {
      where.attendanceDate = db.command.lte(options.toDate);
    }
    return fetchAllOrdered(
      attendanceRecordCollection,
      where,
      [
        { field: 'attendanceDate', direction: 'desc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 300 }
    );
  }

  async function getLeaveRequest(leaveId) {
    return getDoc(leaveRequestCollection, leaveId);
  }

  async function listLeaveRequests(options = {}) {
    if (Array.isArray(options.sessionIds) && options.sessionIds.length === 0) {
      return { records: [], total: 0, incomplete: false };
    }
    if (
      Array.isArray(options.studentUserIds) &&
      options.studentUserIds.length === 0
    ) {
      return { records: [], total: 0, incomplete: false };
    }
    const where = {};
    if (Array.isArray(options.sessionIds) && options.sessionIds.length) {
      where.sessionId = db.command.in(options.sessionIds);
    }
    if (
      Array.isArray(options.studentUserIds) &&
      options.studentUserIds.length
    ) {
      where.studentUserId = db.command.in(options.studentUserIds);
    }
    if (Array.isArray(options.statuses) && options.statuses.length) {
      where.status = db.command.in(options.statuses);
    }
    if (options.fromDate) {
      where.attendanceDate = db.command.gte(options.fromDate);
    }
    if (options.toDate) {
      where.attendanceDate = db.command.lte(options.toDate);
    }
    return fetchAllOrdered(
      leaveRequestCollection,
      where,
      [
        { field: 'createdAt', direction: 'desc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 300 }
    );
  }

  async function countPendingLeaveRequests(studentUserIds) {
    if (!studentUserIds) {
      return countWhere(leaveRequestCollection, { status: 'pending' });
    }
    if (!studentUserIds.length) {
      return 0;
    }
    let total = 0;
    for (let index = 0; index < studentUserIds.length; index += 100) {
      const chunk = studentUserIds.slice(index, index + 100);
      total += await countWhere(leaveRequestCollection, {
        status: 'pending',
        studentUserId: db.command.in(chunk)
      });
    }
    return total;
  }

  async function getCompetition(competitionId) {
    return getDoc(competitionCollection, competitionId);
  }

  async function listCompetitions(options = {}) {
    const where = {};
    if (Array.isArray(options.statuses) && options.statuses.length) {
      where.status = db.command.in(options.statuses);
    }
    if (options.fromDate) {
      where.eventDate = db.command.gte(options.fromDate);
    }
    if (options.toDate) {
      where.eventDate = db.command.lte(options.toDate);
    }
    return fetchAllOrdered(
      competitionCollection,
      where,
      [
        { field: 'eventDate', direction: 'asc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 300 }
    );
  }

  async function getRegistration(registrationId) {
    return getDoc(competitionRegistrationCollection, registrationId);
  }

  async function listRegistrations(options = {}) {
    if (
      Array.isArray(options.competitionIds) &&
      options.competitionIds.length === 0
    ) {
      return { records: [], total: 0, incomplete: false };
    }
    if (
      Array.isArray(options.studentUserIds) &&
      options.studentUserIds.length === 0
    ) {
      return { records: [], total: 0, incomplete: false };
    }
    const where = {};
    if (options.competitionId) {
      where.competitionId = options.competitionId;
    }
    if (Array.isArray(options.competitionIds) && options.competitionIds.length) {
      where.competitionId = db.command.in(options.competitionIds);
    }
    if (options.studentUserId) {
      where.studentUserId = options.studentUserId;
    }
    if (
      Array.isArray(options.studentUserIds) &&
      options.studentUserIds.length
    ) {
      where.studentUserId = db.command.in(options.studentUserIds);
    }
    if (Array.isArray(options.statuses) && options.statuses.length) {
      where.status = db.command.in(options.statuses);
    }
    return fetchAllOrdered(
      competitionRegistrationCollection,
      where,
      [
        { field: 'createdAt', direction: 'desc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 300 }
    );
  }

  async function countRegistrations(competitionId, statuses) {
    const where = { competitionId };
    if (Array.isArray(statuses) && statuses.length) {
      where.status = db.command.in(statuses);
    }
    return countWhere(competitionRegistrationCollection, where);
  }

  async function getClubNotice(noticeId) {
    return getDoc(clubNoticeCollection, noticeId);
  }

  async function listClubNotices(options = {}) {
    const where = {};
    if (Array.isArray(options.statuses) && options.statuses.length) {
      where.status = db.command.in(options.statuses);
    }
    return fetchAllOrdered(
      clubNoticeCollection,
      where,
      [
        { field: 'publishedAt', direction: 'desc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 300 }
    );
  }

  async function getNoticeRead(noticeId, studentUserId) {
    return getDoc(noticeReadCollection, noticeReadId(noticeId, studentUserId));
  }

  async function listNoticeReads(studentUserId, options = {}) {
    const where = { studentUserId };
    if (Array.isArray(options.noticeIds) && options.noticeIds.length) {
      where.noticeId = db.command.in(options.noticeIds);
    }
    return fetchAllOrdered(
      noticeReadCollection,
      where,
      [
        { field: 'readAt', direction: 'desc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 300 }
    );
  }

  async function getTrainingFeedback(feedbackId) {
    return getDoc(trainingFeedbackCollection, feedbackId);
  }

  async function listTrainingFeedback(options = {}) {
    if (
      Array.isArray(options.studentUserIds) &&
      options.studentUserIds.length === 0
    ) {
      return { records: [], total: 0, incomplete: false };
    }
    const where = {};
    if (options.studentUserId) {
      where.studentUserId = options.studentUserId;
    }
    if (
      Array.isArray(options.studentUserIds) &&
      options.studentUserIds.length
    ) {
      where.studentUserId = db.command.in(options.studentUserIds);
    }
    if (options.trainingGroupId) {
      where.trainingGroupId = options.trainingGroupId;
    }
    if (options.planId) {
      where.planId = options.planId;
    }
    if (options.fromDate) {
      where.attendanceDate = db.command.gte(options.fromDate);
    }
    if (options.toDate) {
      where.attendanceDate = db.command.lte(options.toDate);
    }
    return fetchAllOrdered(
      trainingFeedbackCollection,
      where,
      [
        { field: 'attendanceDate', direction: 'desc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 300 }
    );
  }

  async function listMeasurementsForReport(userId, options = {}) {
    return fetchAllOrdered(
      measurementCollection,
      { userId },
      [
        { field: 'measuredAt', direction: 'asc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 5000 }
    );
  }

  async function listPerformanceRecords(userId, maxRecords = 100) {
    const result = await performanceCollection
      .where({ studentUserId: userId })
      .limit(Math.min(maxRecords, 100))
      .get();
    return (result.data || []).sort(
      (left, right) =>
        new Date(right.achievedAt || 0).getTime() -
        new Date(left.achievedAt || 0).getTime()
    );
  }

  async function listPendingPerformanceRecords(maxRecords = 300) {
    const result = await fetchAllOrdered(
      performanceCollection,
      { status: 'pending' },
      [
        { field: 'createdAt', direction: 'asc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords }
    );
    return result.records;
  }

  async function listApprovedPerformanceRecords(userId, options = {}) {
    return fetchAllOrdered(
      performanceCollection,
      { studentUserId: userId, status: 'approved' },
      [
        { field: 'achievedAt', direction: 'asc' },
        { field: '_id', direction: 'asc' }
      ],
      { maxRecords: options.maxRecords || 5000 }
    );
  }

  async function listApprovedPerformanceRecordsForStatistics(options = {}) {
    const baseWhere = { status: 'approved' };
    if (options.eventCode) {
      baseWhere.eventCode = options.eventCode;
    }
    if (options.fromDate) {
      baseWhere.achievedAt = db.command.gte(options.fromDate);
    }
    if (options.toDate) {
      baseWhere.achievedAt = db.command.lte(options.toDate);
    }
    const maxRecords = options.maxRecords || 10000;
    const orderBy = [
      { field: 'achievedAt', direction: 'asc' },
      { field: '_id', direction: 'asc' }
    ];
    if (Array.isArray(options.studentUserIds)) {
      if (!options.studentUserIds.length) {
        return { records: [], total: 0, incomplete: false };
      }
      const records = [];
      let total = 0;
      let incomplete = false;
      for (let index = 0; index < options.studentUserIds.length; index += 100) {
        const chunk = options.studentUserIds.slice(index, index + 100);
        const result = await fetchAllOrdered(
          performanceCollection,
          { ...baseWhere, studentUserId: db.command.in(chunk) },
          orderBy,
          { maxRecords }
        );
        records.push(...result.records);
        total += result.total;
        incomplete = incomplete || result.incomplete;
      }
      const unique = new Map(records.map((record) => [record._id, record]));
      const merged = Array.from(unique.values()).sort((left, right) => {
        const leftDate = new Date(left.achievedAt || 0).getTime();
        const rightDate = new Date(right.achievedAt || 0).getTime();
        if (leftDate !== rightDate) {
          return leftDate - rightDate;
        }
        return String(left._id).localeCompare(String(right._id));
      });
      return { records: merged, total, incomplete };
    }
    return fetchAllOrdered(
      performanceCollection,
      baseWhere,
      orderBy,
      { maxRecords }
    );
  }
  async function listMembershipsForGroups(groupIds, options = {}) {
    if (!groupIds.length) {
      return { records: [], total: 0, incomplete: false };
    }
    const records = [];
    let total = 0;
    let incomplete = false;
    for (let index = 0; index < groupIds.length; index += 100) {
      const chunk = groupIds.slice(index, index + 100);
      const where = {
        groupId: db.command.in(chunk),
        roleInGroup: ROLES.STUDENT
      };
      if (Array.isArray(options.statuses) && options.statuses.length) {
        where.status = db.command.in(options.statuses);
      }
      const result = await fetchAllOrdered(
        membershipCollection,
        where,
        [
          { field: 'groupId', direction: 'asc' },
          { field: '_id', direction: 'asc' }
        ],
        { maxRecords: options.maxRecords || 5000 }
      );
      records.push(...result.records);
      total += result.total;
      incomplete = incomplete || result.incomplete;
    }
    const unique = new Map(records.map((record) => [record._id, record]));
    return {
      records: Array.from(unique.values()),
      total,
      incomplete
    };
  }

  async function getStudentUserIdsForGroups(groupIds) {
    if (!groupIds.length) {
      return [];
    }
    const userIds = new Set();
    for (let index = 0; index < groupIds.length; index += 100) {
      const chunk = groupIds.slice(index, index + 100);
      const result = await fetchAllOrdered(
        membershipCollection,
        {
          groupId: db.command.in(chunk),
          roleInGroup: ROLES.STUDENT,
          status: MEMBERSHIP_STATUS.ACTIVE
        },
        [
          { field: 'groupId', direction: 'asc' },
          { field: '_id', direction: 'asc' }
        ],
        { maxRecords: 5000 }
      );
      for (const item of result.records) {
        userIds.add(item.userId);
      }
    }
    return Array.from(userIds);
  }

  async function getStudentGroupNamesMap(userIds) {
    const resultMap = new Map();
    if (!userIds.length) {
      return resultMap;
    }

    const memberships = [];
    for (let index = 0; index < userIds.length; index += 100) {
      const chunk = userIds.slice(index, index + 100);
      const batch = await queryAll(
        membershipCollection,
        {
          userId: db.command.in(chunk),
          roleInGroup: ROLES.STUDENT,
          status: MEMBERSHIP_STATUS.ACTIVE
        },
        Math.max(chunk.length * 10, 100)
      );
      memberships.push(...batch);
    }

    const groupIds = Array.from(
      new Set(memberships.map((item) => item.groupId))
    );
    const groupsMap = await getGroupsMap(groupIds);
    for (const membership of memberships) {
      const group = groupsMap.get(membership.groupId);
      if (!group) {
        continue;
      }
      const names = resultMap.get(membership.userId) || [];
      names.push(`${group.name}（${group.seasonLabel || '未标注'}）`);
      resultMap.set(membership.userId, names);
    }
    return resultMap;
  }

  async function countPendingPerformanceRecords(studentUserIds) {
    if (!studentUserIds) {
      return countWhere(performanceCollection, { status: 'pending' });
    }
    if (!studentUserIds.length) {
      return 0;
    }
    let total = 0;
    for (let index = 0; index < studentUserIds.length; index += 100) {
      const chunk = studentUserIds.slice(index, index + 100);
      total += await countWhere(performanceCollection, {
        status: 'pending',
        studentUserId: db.command.in(chunk)
      });
    }
    return total;
  }

  async function listAllProfiles(maxRecords = 300) {
    return queryAll(profileCollection, null, maxRecords);
  }
  async function listEnabledTrainingGroups() {
    const groups = await queryAll(groupCollection, { enabled: true }, 300);
    return groups.sort(compareTrainingGroups);
  }

  async function listAllTrainingGroups() {
    const groups = await queryAll(groupCollection, null, 300);
    return groups.sort(compareTrainingGroups);
  }

  async function getProfilesMap(userIds) {
    if (!userIds.length) {
      return new Map();
    }
    const profiles = [];
    for (let index = 0; index < userIds.length; index += 100) {
      const chunk = userIds.slice(index, index + 100);
      const batch = await queryAll(
        profileCollection,
        { userId: db.command.in(chunk) },
        chunk.length
      );
      profiles.push(...batch);
    }
    return new Map(profiles.map((profile) => [profile.userId, profile]));
  }

  async function getUsersMap(userIds) {
    if (!userIds.length) {
      return new Map();
    }
    const users = [];
    for (let index = 0; index < userIds.length; index += 100) {
      const chunk = userIds.slice(index, index + 100);
      const batch = await queryAll(
        userCollection,
        { _id: db.command.in(chunk) },
        chunk.length
      );
      users.push(...batch);
    }
    return new Map(users.map((user) => [user._id, user]));
  }

  async function getGroupsMap(groupIds) {
    if (!groupIds.length) {
      return new Map();
    }
    const groups = [];
    for (let index = 0; index < groupIds.length; index += 100) {
      const chunk = groupIds.slice(index, index + 100);
      const batch = await queryAll(
        groupCollection,
        { _id: db.command.in(chunk) },
        chunk.length
      );
      groups.push(...batch);
    }
    return new Map(groups.map((group) => [group._id, group]));
  }

  async function writeAudit(entry) {
    await auditCollection.add({
      data: {
        actorUserId: entry.actorUserId || '',
        action: entry.action,
        targetType: entry.targetType || '',
        targetId: entry.targetId || '',
        result: entry.result || 'success',
        metadata: entry.metadata || {},
        createdAt: db.serverDate()
      }
    });
  }

  async function setRoleBinding({ userId, role, grantedBy, active }) {
    const id = roleBindingId(userId, role);
    await roleCollection.doc(id).set({
      data: {
        userId,
        role,
        status: active ? 'active' : 'revoked',
        grantedBy,
        updatedAt: db.serverDate(),
        ...(active ? { grantedAt: db.serverDate() } : { revokedAt: db.serverDate() })
      }
    });
  }

  async function setGroupMembership({
    userId,
    groupId,
    roleInGroup,
    assignedBy,
    active
  }) {
    const id = membershipId(groupId, userId);
    await membershipCollection.doc(id).set({
      data: {
        userId,
        groupId,
        roleInGroup,
        status: active ? MEMBERSHIP_STATUS.ACTIVE : MEMBERSHIP_STATUS.INACTIVE,
        assignedBy,
        updatedAt: db.serverDate(),
        ...(active ? { assignedAt: db.serverDate() } : { removedAt: db.serverDate() })
      }
    });
  }

  async function setSystemConfig(id, data) {
    await systemCollection.doc(id).set({
      data: {
        ...data,
        updatedAt: db.serverDate()
      }
    });
  }

  async function getSystemConfig(id) {
    return getDoc(systemCollection, id);
  }

  return {
    attendanceRecordCollection,
    parentProfileCollection,
    parentLinkCollection,
    parentProfileIdForUser,
    parentInviteIdForRequest,
    parentLinkIdForPair,
    getParentProfile,
    getParentLink,
    listParentLinks,
    countParentLinksByStatus,
    expireParentInvite,
    recordParentInviteFailure,
    attendanceRecordId,
    attendanceSessionCollection,
    attendanceSessionIdForRequest,
    competitionIdForRequest,
    feedbackIdForStudentSession,
    noticeIdForRequest,
    noticeReadId,
    registrationIdForStudentCompetition,
    auditCollection,
    clubNoticeCollection,
    competitionCollection,
    competitionRegistrationCollection,
    noticeReadCollection,
    trainingFeedbackCollection,
    bodyMeasurementCollection: measurementCollection,
    db,
    ensureUser,
    getMeasurement,
    getPerformanceRecord,
    getCoachGroupIds,
    countRegistrations,
    getClubNotice,
    getCompetition,
    getNoticeRead,
    getRegistration,
    getTrainingFeedback,
    getAttendanceRecord,
    getAttendanceSession,
    getStudentUserIdsForGroups,
    getUsersMap,
    listMembershipsForGroups,
    listClubNotices,
    listCompetitions,
    listNoticeReads,
    listRegistrations,
    listTrainingFeedback,
    getGroupsMap,
    getLatestReview,
    getProfile,
    getProfilesMap,
    getSystemConfig,
    getTrainingGroup,
    getTrainingPlan,
    getUserById,
    groupCollection,
    getStudentGroupIds,
    listAllProfiles,
    listAttendanceRecordsBySession,
    listAttendanceRecordsBySessions,
    listAttendanceRecordsByStudent,
    listAttendanceSessions,
    listTrainingPlans,
    listApprovedPerformanceRecords,
    listApprovedPerformanceRecordsForStatistics,
    listAllTrainingGroups,
    listEnabledTrainingGroups,
    listMeasurements,
    listMeasurementsForReport,
    listPendingPerformanceRecords,
    getLeaveRequest,
    leaveRequestCollection,
    leaveRequestId,
    listLeaveRequests,
    countPendingLeaveRequests,
    listPerformanceRecords,
    countPendingPerformanceRecords,
    membershipCollection,
    getStudentGroupNamesMap,
    membershipId,
    measurementIdForUser,
    performanceCollection,
    performanceIdForSubmission,
    planIdForRequest,
    copyPlanIdForRequest,
    profileCollection,
    trainingPlanCollection,
    profileIdForUser,
    reviewCollection,
    queryAll,
    roleBindingId,
    roleCollection,
    setGroupMembership,
    setRoleBinding,
    setSystemConfig,
    systemCollection,
    userCollection,
    userIdForIdentity,
    writeAudit
  };
}

module.exports = {
  createRepository,
  deterministicId
};
