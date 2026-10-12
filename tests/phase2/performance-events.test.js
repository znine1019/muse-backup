'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPerformanceEvent,
  listPerformanceEvents
} = require('../../cloudfunctions/api/lib/performance-events');

test('performance event catalog supports times and distances with correct direction', () => {
  const sprint = getPerformanceEvent('100m');
  const longJump = getPerformanceEvent('long_jump');
  const shotPut = getPerformanceEvent('shot_put');

  assert.equal(sprint.unit, '秒');
  assert.equal(sprint.comparison, 'lower');
  assert.equal(longJump.unit, '米');
  assert.equal(longJump.comparison, 'higher');
  assert.equal(shotPut.comparison, 'higher');
  assert.equal(getPerformanceEvent('unknown_event'), null);
});

test('event catalog is safe to return to the client', () => {
  const events = listPerformanceEvents();
  assert.equal(events.length >= 8, true);
  assert.equal(events.every((event) => event.code && event.name && event.unit), true);
  assert.equal(JSON.stringify(events).includes('_id'), false);
});
