'use strict';

const PERFORMANCE_EVENTS = Object.freeze({
  '100m': Object.freeze({
    code: '100m',
    name: '100米',
    unit: '秒',
    comparison: 'lower',
    min: 8,
    max: 60,
    decimals: 2
  }),
  '200m': Object.freeze({
    code: '200m',
    name: '200米',
    unit: '秒',
    comparison: 'lower',
    min: 20,
    max: 120,
    decimals: 2
  }),
  '400m': Object.freeze({
    code: '400m',
    name: '400米',
    unit: '秒',
    comparison: 'lower',
    min: 40,
    max: 300,
    decimals: 2
  }),
  '800m': Object.freeze({
    code: '800m',
    name: '800米',
    unit: '秒',
    comparison: 'lower',
    min: 100,
    max: 600,
    decimals: 2
  }),
  '1500m': Object.freeze({
    code: '1500m',
    name: '1500米',
    unit: '秒',
    comparison: 'lower',
    min: 200,
    max: 1200,
    decimals: 2
  }),
  long_jump: Object.freeze({
    code: 'long_jump',
    name: '跳远',
    unit: '米',
    comparison: 'higher',
    min: 0.5,
    max: 10,
    decimals: 2
  }),
  high_jump: Object.freeze({
    code: 'high_jump',
    name: '跳高',
    unit: '米',
    comparison: 'higher',
    min: 0.5,
    max: 3,
    decimals: 2
  }),
  shot_put: Object.freeze({
    code: 'shot_put',
    name: '铅球',
    unit: '米',
    comparison: 'higher',
    min: 0.5,
    max: 30,
    decimals: 2
  })
});

function getPerformanceEvent(eventCode) {
  return PERFORMANCE_EVENTS[eventCode] || null;
}

function listPerformanceEvents() {
  return Object.values(PERFORMANCE_EVENTS).map((event) => ({ ...event }));
}

module.exports = {
  PERFORMANCE_EVENTS,
  getPerformanceEvent,
  listPerformanceEvents
};
