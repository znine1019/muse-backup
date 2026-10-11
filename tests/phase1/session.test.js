'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSessionDestination,
  sessionHasRole
} = require('../../miniprogram/utils/session');

test('role selection only routes to server-returned known roles', () => {
  const session = {
    user: {
      status: 'active',
      roles: ['coach', 'unknown_admin']
    }
  };

  const destination = getSessionDestination(session);
  assert.equal(destination.type, 'role');
  assert.equal(destination.role, 'coach');
  assert.equal(destination.url, '/pages/coach/coach');
  assert.equal(sessionHasRole(session, 'developer'), false);
});

test('multiple known roles require the role selection page', () => {
  const session = {
    user: {
      status: 'active',
      roles: ['student', 'coach']
    }
  };

  const destination = getSessionDestination(session);
  assert.equal(destination.type, 'role_select');
  assert.equal(destination.url, '/pages/role-select/role-select');
});
