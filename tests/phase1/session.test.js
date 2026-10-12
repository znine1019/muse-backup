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

test('active single roles route to their matching workbench', () => {
  assert.equal(
    getSessionDestination({ user: { status: 'active', roles: ['developer'] } }).url,
    '/pages/admin/admin'
  );
  assert.equal(
    getSessionDestination({ user: { status: 'active', roles: ['coach'] } }).url,
    '/pages/coach/coach'
  );
  assert.equal(
    getSessionDestination({ user: { status: 'active', roles: ['student'] } }).url,
    '/pages/student/student'
  );
});

test('inactive accounts route to the review status page', () => {
  assert.equal(
    getSessionDestination({ user: { status: 'pending_review', roles: [] } }).url,
    '/pages/pending/pending'
  );
  assert.equal(
    getSessionDestination({ user: { status: 'disabled', roles: ['student'] } }).url,
    '/pages/pending/pending'
  );
});
