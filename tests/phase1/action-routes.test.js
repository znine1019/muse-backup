'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createAuthActions = require('../../cloudfunctions/api/actions/auth');
const createDirectoryActions = require('../../cloudfunctions/api/actions/directory');
const createGroupAdminActions = require('../../cloudfunctions/api/actions/groups');
const createProfileActions = require('../../cloudfunctions/api/actions/profile');
const createPerformanceActions = require('../../cloudfunctions/api/actions/performance');
const createRegistrationActions = require('../../cloudfunctions/api/actions/registrations');
const createUserAdminActions = require('../../cloudfunctions/api/actions/users');

test('phase 1 and phase 2 business action routes remain registered', () => {
  const repository = {};
  const routes = {
    ...createAuthActions({ repository }),
    ...createDirectoryActions({ repository }),
    ...createProfileActions({ repository }),
    ...createPerformanceActions({ repository }),
    ...createRegistrationActions({ repository }),
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
    'admin.list_pending_performances',
    'admin.review_performance'
  ]) {
    assert.equal(typeof routes[action], 'function', `${action} should be registered`);
  }
});
