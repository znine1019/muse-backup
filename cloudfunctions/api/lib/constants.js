'use strict';

const COLLECTIONS = Object.freeze({
  USERS: 'users',
  STUDENT_PROFILES: 'student_profiles',
  COACH_PROFILES: 'coach_profiles',
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
  COMPETITION_ATTACHMENTS: 'competition_attachments',
  CLUB_NOTICES: 'club_notices',
  NOTICE_READS: 'notice_reads',
  TRAINING_FEEDBACK: 'training_feedback',
  PARENT_PROFILES: 'parent_profiles',
  PARENT_LINKS: 'parent_links',
  AUDIT_LOGS: 'audit_logs',
  SYSTEM_CONFIG: 'system_config'
});

const ROLES = Object.freeze({
  DEVELOPER: 'developer',
  COACH: 'coach',
  STUDENT: 'student',
  PARENT: 'parent'
});

/* 家长—学生关联：同一集合用 kind 区分一次性凭证与关联关系 */
const PARENT_LINK_KIND = Object.freeze({
  INVITE: 'invite',
  RELATION: 'relation'
});

const PARENT_LINK_STATUS = Object.freeze({
  /* 凭证状态 */
  OPEN: 'open',
  USED: 'used',
  EXPIRED: 'expired',
  LOCKED: 'locked',
  /* 关联关系状态机 */
  PENDING_STUDENT: 'pending_student',
  PENDING_REVIEW: 'pending_review',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  REVOKED: 'revoked'
});

const PARENT_RELATION_LABELS = Object.freeze([
  'father',
  'mother',
  'guardian',
  'other'
]);

const ROLE_VALUES = Object.freeze(Object.values(ROLES));

const USER_STATUS = Object.freeze({
  PENDING_PROFILE: 'pending_profile',
  PENDING_REVIEW: 'pending_review',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  DISABLED: 'disabled',
  DELETED: 'deleted'
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

const COMPETITION_ATTACHMENT_STATUS = Object.freeze({
  ACTIVE: 'active',
  REMOVED: 'removed'
});

const COMPETITION_MATERIAL_POLICY = Object.freeze({
  ALLOWED_EXTENSIONS: Object.freeze(['jpg', 'jpeg', 'png', 'pdf']),
  MAX_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_FILES_PER_COMPETITION: 3,
  TEMP_URL_MAX_AGE_SECONDS: 60,
  FILE_NAME_MAX_LENGTH: 80,
  STORAGE_PREFIX: 'competition-attachments',
  CONTENT_TYPES: Object.freeze({
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    pdf: 'application/pdf'
  })
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
  COACH_PROFILE_SUBMITTED: 'coach.profile.submitted',
  REGISTRATION_APPROVED: 'admin.registration.approved',
  REGISTRATION_REJECTED: 'admin.registration.rejected',
  ROLE_GRANTED: 'admin.role.granted',
  ROLE_REVOKED: 'admin.role.revoked',
  USER_ENABLED: 'admin.user.enabled',
  USER_DISABLED: 'admin.user.disabled',
  USER_DELETED: 'admin.user.deleted',
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
  COMPETITION_MATERIAL_REGISTERED: 'competition.material.registered',
  COMPETITION_MATERIAL_REMOVED: 'competition.material.removed',
  COMPETITION_MATERIAL_DOWNLOADED: 'competition.material.downloaded',
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
  GROUP_DELETED: 'admin.training_group.deleted',
  PARENT_PROFILE_SUBMITTED: 'parent.profile.submitted',
  PARENT_INVITE_CREATED: 'parent.link.invite_created',
  PARENT_LINK_REQUESTED: 'parent.link.requested',
  PARENT_LINK_CONFIRMED: 'parent.link.student_confirmed',
  PARENT_LINK_STUDENT_REJECTED: 'parent.link.student_rejected',
  PARENT_LINK_APPROVED: 'parent.link.approved',
  PARENT_LINK_REJECTED: 'parent.link.rejected',
  PARENT_LINK_REVOKED: 'parent.link.revoked',
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
  parentNameMaxLength: 40,
  coachNameMaxLength: 40,
  coachNoteMaxLength: 200,
  parentNoteMaxLength: 200,
  parentInviteCodeLength: 10,
  parentInviteTtlMinutes: 30,
  parentInviteMaxAttempts: 5,
  parentMaxLinkedStudents: 10,
  pageSize: 50,
  heightCmMin: 50,
  heightCmMax: 250,
  weightKgMin: 20,
  weightKgMax: 300
});

module.exports = {
  COMPETITION_ATTACHMENT_STATUS,
  COMPETITION_MATERIAL_POLICY,
  COMPETITION_REGISTRATION_STATUS,
  COMPETITION_STATUS,
  FEEDBACK_COMPLETION,
  NOTICE_CATEGORIES,
  NOTICE_PRIORITIES,
  NOTICE_STATUS,
  PARENT_LINK_KIND,
  PARENT_LINK_STATUS,
  PARENT_RELATION_LABELS,
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
