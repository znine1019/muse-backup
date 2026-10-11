'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertBootstrapAllowed,
  buildCompletedConfig,
  parseAllowedOpenIds,
  secureStringEqual
} = require('../../cloudfunctions/api/lib/bootstrap-policy');
const {
  assertRegistrationPending,
  getProfileSubmissionDecision
} = require('../../cloudfunctions/api/lib/state-guards');

const PRIMARY_OPENID = 'openid_primary_admin_0001';
const SECOND_OPENID = 'openid_secondary_admin_0002';
const CODE = 'bootstrap-code-1234567890';

function captureCode(callback) {
  try {
    callback();
    return '';
  } catch (error) {
    return error.code || error.message;
  }
}

test('bootstrap requires both a preauthorized OpenID and the one-time code', () => {
  const allowedOpenIds = parseAllowedOpenIds(
    `${PRIMARY_OPENID},${SECOND_OPENID}`
  );

  assert.equal(secureStringEqual(CODE, CODE), true);
  assert.doesNotThrow(() =>
    assertBootstrapAllowed({
      identity: { openid: PRIMARY_OPENID },
      providedCode: CODE,
      expectedCode: CODE,
      allowedOpenIds,
      config: { developerInitialized: false }
    })
  );
  assert.equal(
    captureCode(() =>
      assertBootstrapAllowed({
        identity: { openid: 'openid_ordinary_user_0003' },
        providedCode: CODE,
        expectedCode: CODE,
        allowedOpenIds,
        config: { developerInitialized: false }
      })
    ),
    'BOOTSTRAP_REJECTED'
  );
  assert.equal(
    captureCode(() =>
      assertBootstrapAllowed({
        identity: { openid: PRIMARY_OPENID },
        providedCode: 'wrong-code-1234567890',
        expectedCode: CODE,
        allowedOpenIds,
        config: { developerInitialized: false }
      })
    ),
    'BOOTSTRAP_REJECTED'
  );
});

test('completed bootstrap configuration permanently rejects initialization', () => {
  const completed = buildCompletedConfig({
    initializedBy: 'usr_primary',
    completedAt: new Date('2026-10-12T00:00:00.000Z')
  });

  assert.equal(completed.developerInitialized, true);
  assert.equal(
    captureCode(() =>
      assertBootstrapAllowed({
        identity: { openid: PRIMARY_OPENID },
        providedCode: CODE,
        expectedCode: CODE,
        allowedOpenIds: [PRIMARY_OPENID],
        config: completed
      })
    ),
    'BOOTSTRAP_COMPLETED'
  );
});

test('serialized concurrent bootstrap attempts allow only one winner', async () => {
  let config = { developerInitialized: false };
  let transactionTail = Promise.resolve();

  function runSerialized(work) {
    const next = transactionTail.then(work);
    transactionTail = next.catch(() => undefined);
    return next;
  }

  function attempt(openid) {
    return runSerialized(() => {
      assertBootstrapAllowed({
        identity: { openid },
        providedCode: CODE,
        expectedCode: CODE,
        allowedOpenIds: [PRIMARY_OPENID, SECOND_OPENID],
        config
      });
      config = buildCompletedConfig({
        initializedBy: openid,
        completedAt: new Date()
      });
      return openid;
    });
  }

  const results = await Promise.allSettled([
    attempt(PRIMARY_OPENID),
    attempt(SECOND_OPENID)
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'BOOTSTRAP_COMPLETED');
});

test('duplicate pending registration is idempotent instead of creating another review', () => {
  assert.deepEqual(getProfileSubmissionDecision('pending_review'), {
    action: 'idempotent',
    status: 'pending_review'
  });
  assert.deepEqual(getProfileSubmissionDecision('rejected'), {
    action: 'submit',
    status: 'rejected'
  });
  assert.equal(captureCode(() => getProfileSubmissionDecision('active')), 'PROFILE_NOT_EDITABLE');
});

test('processed registrations cannot be reviewed again', () => {
  assert.equal(assertRegistrationPending({ reviewStatus: 'pending' }), true);
  assert.equal(
    captureCode(() => assertRegistrationPending({ reviewStatus: 'approved' })),
    'REVIEW_NOT_PENDING'
  );
});
