'use strict';

const { ROLES, USER_STATUS } = require('../lib/constants');
const { fail } = require('../lib/errors');
const { buildAutomaticReport } = require('../lib/report-builder');
const { loadActiveActor } = require('../lib/session');
const { safeId } = require('../lib/validation');

function createReportActions({ repository }) {
  async function buildReportForStudent(studentUserId) {
    const [profile, measurementResult, performanceResult] = await Promise.all([
      repository.getProfile(studentUserId),
      repository.listMeasurementsForReport(studentUserId),
      repository.listApprovedPerformanceRecords(studentUserId)
    ]);
    if (!profile) {
      fail('PROFILE_NOT_FOUND', '学生档案不存在。');
    }
    const incompleteSources = [];
    if (measurementResult.incomplete) {
      incompleteSources.push('身体指标');
    }
    if (performanceResult.incomplete) {
      incompleteSources.push('成绩');
    }
    if (incompleteSources.length) {
      fail(
        'REPORT_INCOMPLETE',
        `${incompleteSources.join('、')}历史数据读取不完整，暂时无法生成准确报告，请稍后重试。`
      );
    }
    return buildAutomaticReport({
      profile,
      measurements: measurementResult.records,
      performanceRecords: performanceResult.records
    });
  }

  async function getMyReport({ identity }) {
    const actor = await loadActiveActor(repository, identity, [ROLES.STUDENT]);
    return { report: await buildReportForStudent(actor._id) };
  }

  async function getStudentReport({ identity, payload }) {
    const actor = await loadActiveActor(repository, identity, [
      ROLES.DEVELOPER,
      ROLES.COACH
    ]);
    const targetUserId = safeId(payload && payload.targetUserId, '学生账号');
    const targetUser = await repository.getUserById(targetUserId);
    if (
      !targetUser ||
      targetUser.status !== USER_STATUS.ACTIVE ||
      !(targetUser.roles || []).includes(ROLES.STUDENT)
    ) {
      fail('STUDENT_NOT_FOUND', '未找到有效学生账号。');
    }

    if (actor.roles.includes(ROLES.COACH) && !actor.roles.includes(ROLES.DEVELOPER)) {
      const groupIds = await repository.getCoachGroupIds(actor._id);
      const studentIds = await repository.getStudentUserIdsForGroups(groupIds);
      if (!studentIds.includes(targetUserId)) {
        fail('OUT_OF_SCOPE', '只能查看本人负责训练组内学生的运动报告。');
      }
    }

    return { report: await buildReportForStudent(targetUserId) };
  }

  return {
    'report.get_my_report': getMyReport,
    'admin.get_student_report': getStudentReport
  };
}

module.exports = createReportActions;
