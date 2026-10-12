'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRepository } = require('../../cloudfunctions/api/lib/repository');
const { buildAutomaticReport, buildPersonalBests } = require('../../cloudfunctions/api/lib/report-builder');

const COLLECTION_NAMES = [
  'users',
  'student_profiles',
  'registration_reviews',
  'role_bindings',
  'training_groups',
  'group_memberships',
  'body_measurements',
  'performance_records',
  'audit_logs',
  'system_config'
];

function matchesWhere(record, where) {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([field, expected]) => {
    if (expected && typeof expected === 'object' && expected.__in) {
      return expected.__in.includes(record[field]);
    }
    return record[field] === expected;
  });
}

function compareValues(left, right) {
  if (left instanceof Date || right instanceof Date) {
    return new Date(left || 0).getTime() - new Date(right || 0).getTime();
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

function createFakeDb(collections, options = {}) {
  const getStats = [];
  let getCallCount = 0;

  function resolve(name, where, orderBy) {
    let data = (collections[name] || []).filter((record) =>
      matchesWhere(record, where)
    );
    for (let index = orderBy.length - 1; index >= 0; index -= 1) {
      const order = orderBy[index];
      const direction = order.direction === 'desc' ? -1 : 1;
      data = [...data].sort(
        (left, right) =>
          direction * compareValues(left[order.field], right[order.field])
      );
    }
    return data;
  }

  class Query {
    constructor(name, where = null, orderBy = [], offset = 0, limitValue = 1000) {
      this.name = name;
      this.condition = where;
      this.orders = orderBy;
      this.offset = offset;
      this.limitValue = limitValue;
    }

    where(condition) {
      return new Query(this.name, condition, this.orders, this.offset, this.limitValue);
    }

    orderBy(field, direction) {
      return new Query(
        this.name,
        this.condition,
        [...this.orders, { field, direction }],
        this.offset,
        this.limitValue
      );
    }

    skip(offset) {
      return new Query(this.name, this.condition, this.orders, offset, this.limitValue);
    }

    limit(limitValue) {
      return new Query(this.name, this.condition, this.orders, this.offset, limitValue);
    }

    async get() {
      getCallCount += 1;
      getStats.push({
        collection: this.name,
        where: this.condition,
        orderBy: this.orders,
        offset: this.offset,
        limit: this.limitValue
      });
      if (options.failOnGetCall === getCallCount) {
        throw new Error('mock query failure');
      }
      const data = resolve(this.name, this.condition, this.orders);
      return { data: data.slice(this.offset, this.offset + this.limitValue) };
    }

    async count() {
      return { total: resolve(this.name, this.condition, []).length };
    }
  }

  const db = {
    command: {
      in: (values) => ({ __in: values })
    },
    collection: (name) => ({
      where: (condition) => new Query(name, condition),
      count: () => new Query(name).count()
    }),
    serverDate: () => new Date()
  };

  for (const name of COLLECTION_NAMES) {
    if (!collections[name]) {
      collections[name] = [];
    }
  }

  return { db, getStats };
}

function performanceRecord(id, eventCode, value, achievedAt, status = 'approved') {
  return {
    _id: id,
    studentUserId: 'usr_student_1',
    eventCode,
    eventName: eventCode === '100m' ? '100m' : 'long jump',
    value,
    unit: eventCode === '100m' ? 's' : 'm',
    comparison: eventCode === '100m' ? 'lower' : 'higher',
    achievedAt,
    status,
    source: 'student_report'
  };
}

function dateForIndex(index) {
  return new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
}

test('approved history beyond 300 records is fully paged in stable order', async () => {
  const records = [];
  for (let index = 0; index < 350; index += 1) {
    records.push(
      performanceRecord(
        `perf_${String(index).padStart(3, '0')}`,
        '100m',
        Number((20 - index * 0.01).toFixed(2)),
        dateForIndex(index)
      )
    );
  }
  records.push(performanceRecord('perf_pending', '100m', 5, dateForIndex(351), 'pending'));
  records.push(performanceRecord('perf_rejected', '100m', 4, dateForIndex(352), 'rejected'));

  const { db, getStats } = createFakeDb({ performance_records: records });
  const repository = createRepository(db);
  const result = await repository.listApprovedPerformanceRecords('usr_student_1');

  assert.equal(result.total, 350);
  assert.equal(result.records.length, 350);
  assert.equal(result.incomplete, false);
  assert.equal(
    getStats.filter((entry) => entry.collection === 'performance_records').length,
    4
  );
  assert.equal(result.records[0].achievedAt, dateForIndex(0));
  assert.equal(result.records[349].achievedAt, dateForIndex(349));
  assert.equal(result.records.some((record) => record.status !== 'approved'), false);

  const best = buildPersonalBests(result.records);
  assert.equal(best.find((item) => item.eventCode === '100m').value, 16.51);
});

test('personal best beyond the 300th record still reaches the chart metadata', async () => {
  const records = [];
  for (let index = 0; index < 350; index += 1) {
    records.push(
      performanceRecord(
        `perf_${String(index).padStart(3, '0')}`,
        '100m',
        Number((20 - index * 0.01).toFixed(2)),
        dateForIndex(index)
      )
    );
  }
  const { db } = createFakeDb({ performance_records: records });
  const repository = createRepository(db);
  const result = await repository.listApprovedPerformanceRecords('usr_student_1');
  const report = buildAutomaticReport({
    profile: { userId: 'usr_student_1', name: 'student', examGoal: {} },
    measurements: [],
    performanceRecords: result.records
  });

  assert.equal(report.personalBests[0].value, 16.51);
  assert.equal(report.stageChanges[0].latestValue, 16.51);
  assert.equal(report.performanceSeries['100m'].length, 120);
  assert.equal(report.performanceMeta.approvedTotal, 350);
  assert.deepEqual(report.performanceMeta.truncatedEvents, ['100m']);
});

test('same-day records use a stable id tiebreaker', async () => {
  const achievedAt = '2026-03-01';
  const { db } = createFakeDb({
    performance_records: [
      performanceRecord('perf_b', '100m', 12, achievedAt),
      performanceRecord('perf_a', '100m', 13, achievedAt),
      performanceRecord('perf_c', 'long_jump', 5.5, achievedAt)
    ]
  });
  const repository = createRepository(db);
  const result = await repository.listApprovedPerformanceRecords('usr_student_1');

  assert.deepEqual(
    result.records.filter((record) => record.eventCode === '100m').map((record) => record._id),
    ['perf_a', 'perf_b']
  );
});

test('duplicate ids during pagination are detected as incomplete instead of ignored', async () => {
  const { db } = createFakeDb({
    performance_records: [
      performanceRecord('perf_same', '100m', 12, dateForIndex(0)),
      performanceRecord('perf_same', '100m', 12, dateForIndex(0)),
      performanceRecord('perf_other', '100m', 13, dateForIndex(1))
    ]
  });
  const repository = createRepository(db);
  const result = await repository.listApprovedPerformanceRecords('usr_student_1');

  assert.equal(result.total, 3);
  assert.equal(result.records.length, 2);
  assert.equal(result.incomplete, true);
});

test('a query failure propagates instead of returning a partial personal best', async () => {
  const records = [];
  for (let index = 0; index < 250; index += 1) {
    records.push(
      performanceRecord(
        `perf_${String(index).padStart(3, '0')}`,
        '100m',
        Number((20 - index * 0.01).toFixed(2)),
        dateForIndex(index)
      )
    );
  }
  const { db } = createFakeDb(
    { performance_records: records },
    { failOnGetCall: 2 }
  );
  const repository = createRepository(db);

  await assert.rejects(
    () => repository.listApprovedPerformanceRecords('usr_student_1'),
    /mock query failure/
  );
});

test('body measurement history is paged and sorted by measured date', async () => {
  const measurements = [];
  for (let index = 0; index < 130; index += 1) {
    measurements.push({
      _id: `measure_${String(1000 - index).padStart(4, '0')}`,
      userId: 'usr_student_1',
      heightCm: 170 + index * 0.1,
      weightKg: 60 + index * 0.1,
      measuredAt: dateForIndex(index)
    });
  }
  const shuffled = [...measurements].reverse();
  const { db, getStats } = createFakeDb({ body_measurements: shuffled });
  const repository = createRepository(db);
  const result = await repository.listMeasurementsForReport('usr_student_1');

  assert.equal(result.total, 130);
  assert.equal(result.records.length, 130);
  assert.equal(result.incomplete, false);
  assert.equal(
    getStats.filter((entry) => entry.collection === 'body_measurements').length,
    2
  );
  for (let index = 1; index < result.records.length; index += 1) {
    assert.ok(
      result.records[index - 1].measuredAt <= result.records[index].measuredAt
    );
  }
});
