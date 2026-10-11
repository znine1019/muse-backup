'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canReviewRegistration,
  hasRole,
  isActiveUser
} = require('../../cloudfunctions/api/lib/policy');
const { buildSession } = require('../../cloudfunctions/api/lib/session');

const developer = {
  _id: 'usr_developer',
  status: 'active',
  roles: ['developer']
};

const coach = {
  _id: 'usr_coach',
  status: 'active',
  roles: ['coach']
};

const student = {
  _id: 'usr_student',
  status: 'active',
  roles: ['student']
};

test('developer and coach roles are recognized on the server', () => {
  assert.equal(hasRole(developer, 'developer'), true);
  assert.equal(hasRole(coach, 'coach'), true);
  assert.equal(hasRole(student, 'developer'), false);
  assert.equal(isActiveUser(student), true);
});

test('coach can only review a registration inside an assigned group', () => {
  assert.equal(canReviewRegistration(coach, 'group_a', ['group_a']), true);
  assert.equal(canReviewRegistration(coach, 'group_b', ['group_a']), false);
  assert.equal(canReviewRegistration(coach, '', ['group_a']), false);
});

test('developer can review without a group scope but student cannot', () => {
  assert.equal(canReviewRegistration(developer, '', []), true);
  assert.equal(canReviewRegistration(student, 'group_a', ['group_a']), false);
});

test('session filters unknown roles and keeps only server-known roles', () => {
  const session = buildSession({
    _id: 'usr_test',
    status: 'active',
    roles: ['student', 'invented_admin']
  });

  assert.deepEqual(session.user.roles, ['student']);
  assert.equal(session.capabilities.student, true);
  assert.equal(session.capabilities.developer, false);
});
