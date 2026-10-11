'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateProfilePayload,
  validateReviewPayload,
  validateRolePayload,
  validateUserStatusPayload
} = require('../../cloudfunctions/api/lib/validation');

test('valid profile input is normalized', () => {
  const profile = validateProfilePayload({
    name: '  模拟学生  ',
    gender: 'unspecified',
    birthDate: '2010-01-02',
    heightCm: '170',
    weightKg: '60.5',
    primaryTrainingProject: ' 100米 ',
    requestedTrainingGroupId: ''
  });

  assert.equal(profile.name, '模拟学生');
  assert.equal(profile.heightCm, 170);
  assert.equal(profile.weightKg, 60.5);
  assert.equal(profile.primaryTrainingProject, '100米');
});

test('profile input rejects invalid gender and out-of-range body data', () => {
  assert.throws(
    () =>
      validateProfilePayload({
        name: '模拟学生',
        gender: 'invalid',
        birthDate: '2010-01-02',
        heightCm: 170,
        weightKg: 60,
        primaryTrainingProject: '100米'
      }),
    /性别选项不正确/
  );

  assert.throws(
    () =>
      validateProfilePayload({
        name: '模拟学生',
        gender: 'unspecified',
        birthDate: '2010-01-02',
        heightCm: 500,
        weightKg: 60,
        primaryTrainingProject: '100米'
      }),
    /身高应在/
  );
});

test('review and role payloads reject arbitrary values', () => {
  assert.throws(
    () => validateUserStatusPayload({ targetUserId: 'usr_1', status: 'deleted' }),
    /账号状态不正确/
  );
  assert.throws(
    () => validateReviewPayload({ targetUserId: 'usr_1', decision: 'approve_all' }),
    /审核结果不正确/
  );
  assert.throws(
    () => validateRolePayload({ targetUserId: 'usr_1', role: 'owner', grant: true }),
    /角色不正确/
  );
});
