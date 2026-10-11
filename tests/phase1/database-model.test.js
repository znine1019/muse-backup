'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deterministicId
} = require('../../cloudfunctions/api/lib/repository');

function buildUserId(appid, openid) {
  return deterministicId('usr', appid, openid);
}

function buildGroupId(name, seasonLabel) {
  return deterministicId('group', name.toLowerCase(), seasonLabel.toLowerCase());
}

test('trusted OpenID maps to one deterministic user id', () => {
  const first = buildUserId('wx_test_app', 'openid_test_user_0001');
  const second = buildUserId('wx_test_app', 'openid_test_user_0001');
  const different = buildUserId('wx_test_app', 'openid_test_user_0002');

  assert.equal(first, second);
  assert.notEqual(first, different);
});

test('same group name in different seasons uses different group ids', () => {
  const first = buildGroupId('短跑一组', '2026春季');
  const same = buildGroupId('短跑一组', '2026春季');
  const nextSeason = buildGroupId('短跑一组', '2027春季');

  assert.equal(first, same);
  assert.notEqual(first, nextSeason);
});

test('role and membership identifiers remain stable for idempotent writes', () => {
  const roleFirst = deterministicId('role', 'usr_test', 'coach');
  const roleSecond = deterministicId('role', 'usr_test', 'coach');
  const membershipFirst = deterministicId('member', 'group_test', 'usr_test');
  const membershipSecond = deterministicId('member', 'group_test', 'usr_test');

  assert.equal(roleFirst, roleSecond);
  assert.equal(membershipFirst, membershipSecond);
});
