'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createAuthActions = require('../../cloudfunctions/api/actions/auth');
const createAttendanceActions = require('../../cloudfunctions/api/actions/attendance');
const createCompetitionActions = require('../../cloudfunctions/api/actions/competitions');
const createDirectoryActions = require('../../cloudfunctions/api/actions/directory');
const createFeedbackActions = require('../../cloudfunctions/api/actions/feedback');
const createGroupAdminActions = require('../../cloudfunctions/api/actions/groups');
const createNoticeActions = require('../../cloudfunctions/api/actions/notices');
const createProfileActions = require('../../cloudfunctions/api/actions/profile');
const createPerformanceActions = require('../../cloudfunctions/api/actions/performance');
const createPlanActions = require('../../cloudfunctions/api/actions/plans');
const createRegistrationActions = require('../../cloudfunctions/api/actions/registrations');
const createReportActions = require('../../cloudfunctions/api/actions/report');
const createUserAdminActions = require('../../cloudfunctions/api/actions/users');

test('phase 1 and phase 2 business action routes remain registered', () => {
  const repository = {};
  const routes = {
    ...createAuthActions({ repository }),
    ...createAttendanceActions({ repository }),
    ...createCompetitionActions({ repository }),
    ...createDirectoryActions({ repository }),
    ...createFeedbackActions({ repository }),
    ...createNoticeActions({ repository }),
    ...createProfileActions({ repository }),
    ...createPerformanceActions({ repository }),
    ...createPlanActions({ repository }),
    ...createRegistrationActions({ repository }),
    ...createReportActions({ repository }),
    ...createUserAdminActions({ repository }),
    ...createGroupAdminActions({ repository })
  };

  for (const action of [
    'auth.login',
    'auth.bootstrap',
    'directory.list_training_groups',
    'profile.get',
    'profile.update',
    'profile.add_measurement',
    'profile.list_measurements',
    'profile.submit',
    'admin.list_student_profiles',
    'admin.get_student_profile',
    'admin.list_pending_registrations',
    'admin.review_registration',
    'admin.list_users',
    'admin.assign_role',
    'admin.set_user_status',
    'admin.list_training_groups',
    'admin.create_training_group',
    'admin.set_training_group_enabled',
    'admin.set_group_coach',
    'performance.list_events',
    'performance.submit',
    'performance.list_mine',
    'report.get_my_report',
    'admin.get_student_report',
    'admin.list_pending_performances',
    'admin.review_performance',
    'plan.list_meta',
    'plan.list_manage',
    'plan.get_manage_detail',
    'plan.create',
    'plan.update',
    'plan.publish',
    'plan.archive',
    'plan.copy',
    'plan.list_student',
    'plan.get_student',
    'attendance.list_manage_sessions',
    'attendance.get_session_roster',
    'attendance.create_session',
    'attendance.update_session',
    'attendance.cancel_session',
    'attendance.manual_verify',
    'attendance.get_student_today',
    'attendance.list_student_records',
    'attendance.check_in',
    'leave.create',
    'leave.cancel',
    'leave.list_mine',
    'leave.list_pending',
    'leave.list_reviewed',
    'leave.review',
    'competition.list_meta',
    'competition.list_manage',
    'competition.get_manage_detail',
    'competition.create',
    'competition.update',
    'competition.publish',
    'competition.close',
    'competition.archive',
    'competition.list_student',
    'competition.get_student_detail',
    'competition.submit_intent',
    'competition.cancel_intent',
    'competition.list_my_intents',
    'competition.list_registrations',
    'competition.get_registration_detail',
    'competition.update_registration_status',
    'competition.export_rows',
    'notice.list_manage',
    'notice.get_manage_detail',
    'notice.create',
    'notice.update',
    'notice.publish',
    'notice.withdraw',
    'notice.archive',
    'notice.list_student',
    'notice.get_student_detail',
    'notice.mark_read',
    'notice.unread_count',
    'feedback.list_eligible_sessions',
    'feedback.list_mine',
    'feedback.submit',
    'feedback.update',
    'feedback.list_manage',
    'feedback.review'
  ]) {
    assert.equal(typeof routes[action], 'function', `${action} should be registered`);
  }
});
