'use strict';

const COLLECTIONS = Object.freeze({
  USERS: 'users',
  STUDENT_PROFILES: 'student_profiles',
  ROLE_BINDINGS: 'role_bindings',
  REGISTRATION_REVIEWS: 'registration_reviews',
  TRAINING_GROUPS: 'training_groups',
  GROUP_MEMBERSHIPS: 'group_memberships',
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
  GROUP_CREATED: 'admin.training_group.created',
  GROUP_COACH_ASSIGNED: 'admin.training_group.coach_assigned'
});

const LIMITS = Object.freeze({
  nameMaxLength: 40,
  projectMaxLength: 80,
  commentMaxLength: 300,
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
  REVIEW_STATUS,
  ROLES,
  ROLE_VALUES,
  USER_STATUS
};
