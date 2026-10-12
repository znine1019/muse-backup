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
  pageSize: 50,
  heightCmMin: 50,
  heightCmMax: 250,
  weightKgMin: 20,
  weightKgMax: 300
});

module.exports = {
  AUDIT_ACTIONS,
  COLLECTIONS,
  LIMITS,
  MEMBERSHIP_STATUS,
  PLAN_STATUS,
  REVIEW_STATUS,
  ROLES,
  ROLE_VALUES,
  USER_STATUS
};
