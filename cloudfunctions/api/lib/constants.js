'use strict';

const COLLECTIONS = Object.freeze({
  USERS: 'users',
  STUDENT_PROFILES: 'student_profiles',
  ROLE_BINDINGS: 'role_bindings',
  REGISTRATION_REVIEWS: 'registration_reviews',
  TRAINING_GROUPS: 'training_groups',
  GROUP_MEMBERSHIPS: 'group_memberships',
  BODY_MEASUREMENTS: 'body_measurements',
  PERFORMANCE_RECORDS: 'performance_records',
  TRAINING_PLANS: 'training_plans',
  ATTENDANCE_SESSIONS: 'attendance_sessions',
  ATTENDANCE_RECORDS: 'attendance_records',
  LEAVE_REQUESTS: 'leave_requests',
  COMPETITIONS: 'competitions',
  COMPETITION_REGISTRATIONS: 'competition_registrations',
  CLUB_NOTICES: 'club_notices',
  NOTICE_READS: 'notice_reads',
  TRAINING_FEEDBACK: 'training_feedback',
  AUDIT_LOGS: 'audit_logs',
  SYSTEM_CONFIG: 'system_config'
});

const ROLES = Object.freeze({
  DEVELOPER: 'developer',
  COACH: 'coach',
  STUDENT: 'student'
});

const ROLE_VALUES = Object.freeze(Object.values(ROLES));

const USER_STATUS = Object.freeze({
  PENDING_PROFILE: 'pending_profile',
  PENDING_REVIEW: 'pending_review',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  DISABLED: 'disabled'
});

const REVIEW_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
});

const MEMBERSHIP_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive'
});

const PLAN_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived'
});

const ATTENDANCE_SESSION_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  CLOSED: 'closed',
  CANCELLED: 'cancelled'
});

const ATTENDANCE_RECORD_STATUS = Object.freeze({
  CHECKED_IN: 'checked_in',
  LATE: 'late',
  LEAVE_APPROVED: 'leave_approved',
  PENDING_VERIFICATION: 'pending_verification',
  ABSENT: 'absent'
});

const LEAVE_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
});

const COMPETITION_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  CLOSED: 'closed',
  ARCHIVED: 'archived'
});

const COMPETITION_REGISTRATION_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  PROCESSING: 'processing',
  REGISTERED: 'registered',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

const NOTICE_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  WITHDRAWN: 'withdrawn',
  ARCHIVED: 'archived'
});

const NOTICE_CATEGORIES = Object.freeze([
  'training',
  'competition',
  'announcement',
  'other'
]);

const NOTICE_PRIORITIES = Object.freeze(['normal', 'important']);

const FEEDBACK_COMPLETION = Object.freeze({
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  NOT_COMPLETED: 'not_completed'
});

const AUDIT_ACTIONS = Object.freeze({
  LOGIN_CREATED: 'auth.login.created',
  DEVELOPER_BOOTSTRAPPED: 'auth.bootstrap.developer_created',
  PROFILE_SUBMITTED: 'profile.submitted',
  REGISTRATION_APPROVED: 'admin.registration.approved',
  REGISTRATION_REJECTED: 'admin.registration.rejected',
  ROLE_GRANTED: 'admin.role.granted',
  ROLE_REVOKED: 'admin.role.revoked',
  USER_ENABLED: 'admin.user.enabled',
  USER_DISABLED: 'admin.user.disabled',
  PROFILE_UPDATED: 'profile.updated',
  MEASUREMENT_RECORDED: 'profile.measurement_recorded',
  PERFORMANCE_SUBMITTED: 'performance.submitted',
  PERFORMANCE_APPROVED: 'admin.performance.approved',
  PERFORMANCE_REJECTED: 'admin.performance.rejected',
  PLAN_CREATED: 'coach.training_plan.created',
  PLAN_UPDATED: 'coach.training_plan.updated',
  PLAN_PUBLISHED: 'coach.training_plan.published',
  PLAN_ARCHIVED: 'coach.training_plan.archived',
  PLAN_COPIED: 'coach.training_plan.copied',
  ATTENDANCE_SESSION_CREATED: 'coach.attendance_session.created',
  ATTENDANCE_SESSION_UPDATED: 'coach.attendance_session.updated',
  ATTENDANCE_SESSION_CANCELLED: 'coach.attendance_session.cancelled',
  ATTENDANCE_CHECKED_IN: 'student.attendance.checked_in',
  ATTENDANCE_MANUAL_VERIFIED: 'coach.attendance.manual_verified',
  LEAVE_SUBMITTED: 'student.leave.submitted',
  LEAVE_APPROVED: 'coach.leave.approved',
  LEAVE_REJECTED: 'coach.leave.rejected',
  LEAVE_CANCELLED: 'student.leave.cancelled',
  COMPETITION_CREATED: 'coach.competition.created',
  COMPETITION_UPDATED: 'coach.competition.updated',
  COMPETITION_PUBLISHED: 'coach.competition.published',
  COMPETITION_CLOSED: 'coach.competition.closed',
  COMPETITION_ARCHIVED: 'coach.competition.archived',
  REGISTRATION_SUBMITTED: 'student.competition.intent_submitted',
  REGISTRATION_STATUS_CHANGED: 'coach.competition.registration_status_changed',
  REGISTRATION_CANCELLED: 'student.competition.intent_cancelled',
  NOTICE_CREATED: 'coach.notice.created',
  NOTICE_UPDATED: 'coach.notice.updated',
  NOTICE_PUBLISHED: 'coach.notice.published',
  NOTICE_WITHDRAWN: 'coach.notice.withdrawn',
  NOTICE_ARCHIVED: 'coach.notice.archived',
  FEEDBACK_SUBMITTED: 'student.training_feedback.submitted',
  FEEDBACK_UPDATED: 'student.training_feedback.updated',
  FEEDBACK_REVIEWED: 'coach.training_feedback.reviewed',
  GROUP_CREATED: 'admin.training_group.created',
  GROUP_STATUS_CHANGED: 'admin.training_group.status_changed',
  GROUP_COACH_ASSIGNED: 'admin.training_group.coach_assigned'
});

const LIMITS = Object.freeze({
  nameMaxLength: 40,
  projectMaxLength: 80,
  commentMaxLength: 300,
  planTitleMaxLength: 60,
  planItemNameMaxLength: 60,
  planNotesMaxLength: 300,
  sessionTitleMaxLength: 60,
  locationNameMaxLength: 80,
  leaveReasonMaxLength: 300,
  competitionTitleMaxLength: 80,
  competitionDescriptionMaxLength: 2000,
  competitionRequirementsMaxLength: 1000,
  noticeTitleMaxLength: 80,
  noticeContentMaxLength: 3000,
  feedbackCommentMaxLength: 500,
  coachCommentMaxLength: 500,
  maxCompetitionEvents: 20,
  maxEventCategories: 10,
  pageSize: 50,
  heightCmMin: 50,
  heightCmMax: 250,
  weightKgMin: 20,
  weightKgMax: 300
});

module.exports = {
  COMPETITION_REGISTRATION_STATUS,
  COMPETITION_STATUS,
  FEEDBACK_COMPLETION,
  NOTICE_CATEGORIES,
  NOTICE_PRIORITIES,
  NOTICE_STATUS,
  ATTENDANCE_RECORD_STATUS,
  ATTENDANCE_SESSION_STATUS,
  AUDIT_ACTIONS,
  COLLECTIONS,
  LEAVE_STATUS,
  LIMITS,
  MEMBERSHIP_STATUS,
  PLAN_STATUS,
  REVIEW_STATUS,
  ROLES,
  ROLE_VALUES,
  USER_STATUS
};
