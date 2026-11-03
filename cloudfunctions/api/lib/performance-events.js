'use strict';

function event(definition) {
  return Object.freeze(definition);
}

const PERFORMANCE_EVENTS = Object.freeze({
  power_clean: event({
    code: 'power_clean',
    name: '高翻',
    category: 'strength',
    categoryLabel: '力量训练',
    unit: 'kg',
    comparison: 'higher',
    min: 20,
    max: 300,
    decimals: 1,
    active: true
  }),
  bench_press: event({
    code: 'bench_press',
    name: '卧推',
    category: 'strength',
    categoryLabel: '力量训练',
    unit: 'kg',
    comparison: 'higher',
    min: 20,
    max: 400,
    decimals: 1,
    active: true
  }),
  back_squat: event({
    code: 'back_squat',
    name: '深蹲',
    category: 'strength',
    categoryLabel: '力量训练',
    unit: 'kg',
    comparison: 'higher',
    min: 20,
    max: 500,
    decimals: 1,
    active: true
  }),
  '30m': event({
    code: '30m',
    name: '30米',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 2.5,
    max: 15,
    decimals: 2,
    active: true
  }),
  '60m': event({
    code: '60m',
    name: '60米',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 5,
    max: 20,
    decimals: 2,
    active: true
  }),
  '100m': event({
    code: '100m',
    name: '100米',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 8,
    max: 60,
    decimals: 2,
    active: true
  }),
  '120m': event({
    code: '120m',
    name: '120米',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 10,
    max: 70,
    decimals: 2,
    active: true
  }),
  '150m': event({
    code: '150m',
    name: '150米',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 12,
    max: 90,
    decimals: 2,
    active: true
  }),
  '200m': event({
    code: '200m',
    name: '200米',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 20,
    max: 120,
    decimals: 2,
    active: true
  }),
  '300m': event({
    code: '300m',
    name: '300米',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 30,
    max: 180,
    decimals: 2,
    active: true
  }),
  '400m': event({
    code: '400m',
    name: '400米',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 40,
    max: 300,
    decimals: 2,
    active: true
  }),
  '800m': event({
    code: '800m',
    name: '800米',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 100,
    max: 600,
    decimals: 2,
    active: true
  }),
  '2000m': event({
    code: '2000m',
    name: '2公里',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 300,
    max: 1800,
    decimals: 2,
    active: true
  }),
  '4000m': event({
    code: '4000m',
    name: '4公里',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 600,
    max: 3600,
    decimals: 2,
    active: true
  }),
  '5000m': event({
    code: '5000m',
    name: '5公里',
    category: 'speed_endurance',
    categoryLabel: '速度及耐力项目',
    unit: '秒',
    comparison: 'lower',
    min: 800,
    max: 4500,
    decimals: 2,
    active: true
  }),
  '1500m': event({
    code: '1500m',
    name: '1500米',
    category: 'legacy',
    categoryLabel: '历史兼容项目',
    unit: '秒',
    comparison: 'lower',
    min: 200,
    max: 1200,
    decimals: 2,
    active: false
  }),
  long_jump: event({
    code: 'long_jump',
    name: '跳远',
    category: 'legacy',
    categoryLabel: '历史兼容项目',
    unit: '米',
    comparison: 'higher',
    min: 0.5,
    max: 10,
    decimals: 2,
    active: false
  }),
  high_jump: event({
    code: 'high_jump',
    name: '跳高',
    category: 'legacy',
    categoryLabel: '历史兼容项目',
    unit: '米',
    comparison: 'higher',
    min: 0.5,
    max: 3,
    decimals: 2,
    active: false
  }),
  shot_put: event({
    code: 'shot_put',
    name: '铅球',
    category: 'legacy',
    categoryLabel: '历史兼容项目',
    unit: '米',
    comparison: 'higher',
    min: 0.5,
    max: 30,
    decimals: 2,
    active: false
  })
});

function getPerformanceEvent(eventCode) {
  return PERFORMANCE_EVENTS[eventCode] || null;
}

function listPerformanceEvents() {
  return Object.values(PERFORMANCE_EVENTS)
    .filter((item) => item.active === true)
    .map((item) => ({ ...item }));
}

function listLegacyPerformanceEvents() {
  return Object.values(PERFORMANCE_EVENTS)
    .filter((item) => item.active === false)
    .map((item) => ({ ...item }));
}

function listAllPerformanceEvents() {
  return Object.values(PERFORMANCE_EVENTS).map((item) => ({ ...item }));
}

module.exports = {
  PERFORMANCE_EVENTS,
  getPerformanceEvent,
  listAllPerformanceEvents,
  listLegacyPerformanceEvents,
  listPerformanceEvents
};
