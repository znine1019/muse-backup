'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PROFILE_EDIT_JS = 'miniprogram/pages/profile-edit/profile-edit.js';
const PROFILE_EDIT_WXML = 'miniprogram/pages/profile-edit/profile-edit.wxml';
const PROFILE_VIEW_JS = 'miniprogram/pages/profile-view/profile-view.js';
const PROFILE_VIEW_WXML = 'miniprogram/pages/profile-view/profile-view.wxml';

const EVENTS = [
  { code: '100m', name: '100m', unit: 's', comparison: 'lower' },
  { code: 'long_jump', name: 'long jump', unit: 'm', comparison: 'higher' }
];
const TARGET_OPTIONS = [{ code: '', name: 'none' }, ...EVENTS];

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function loadPage(relativePath) {
  const file = path.join(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  let page = null;
  const wx = {
    navigateTo: () => {},
    reLaunch: () => {}
  };

  vm.runInNewContext(
    source,
    {
      require: (request) => {
        if (request.includes('services/api')) {
          return {};
        }
        if (request.includes('utils/session')) {
          return {
            getSessionDestination: () => ({ url: '/pages/index/index' }),
            sessionHasRole: () => true
          };
        }
        return {};
      },
      Page: (value) => {
        page = value;
      },
      getApp: () => ({ ensureSession: async () => ({}) }),
      wx,
      console
    },
    { filename: file }
  );

  assert.ok(page, `${relativePath} should register a Page`);
  return { page, source, wx };
}

function toPlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

test('profile view page parses and coach report entry passes the student id', () => {
  const { page, wx } = loadPage(PROFILE_VIEW_JS);
  const navigations = [];
  wx.navigateTo = (options) => navigations.push(options);

  assert.equal(typeof page.goReport, 'function');
  page.goReport.call({ data: { userId: 'usr_student_1' } });

  assert.equal(navigations.length, 1);
  assert.equal(
    navigations[0].url,
    '/pages/student-report/student-report?userId=usr_student_1'
  );
  assert.match(readProjectFile(PROFILE_VIEW_WXML), /bindtap="goReport"/);
});

test('profile payload keeps one examGoal object and clears the value without a target', () => {
  const { page, source } = loadPage(PROFILE_EDIT_JS);
  assert.equal(typeof page.buildProfilePayload, 'function');
  assert.match(
    source,
    /await api\.updateStudentProfile\(this\.buildProfilePayload\(\)\)/
  );

  const payload = toPlainObject(
    page.buildProfilePayload.call({
      data: {
        events: EVENTS,
        primaryEventIndex: 0,
        secondaryEvents: EVENTS.map((event, index) => ({
          ...event,
          checked: index === 1
        })),
        targetEventOptions: TARGET_OPTIONS,
        targetEventIndex: 0,
        trainingStartYear: '2023',
        trainingExperienceSummary: 'summary',
        examGoal: {
          targetEventCode: '100m',
          targetValue: 12.5,
          targetScore: 'goal text',
          examYear: 2027,
          targetSchool: 'school',
          note: 'note'
        }
      }
    })
  );

  assert.equal(payload.examGoal.targetEventCode, '');
  assert.equal(payload.examGoal.targetValue, '');
  assert.equal(payload.examGoal.targetScore, 'goal text');
  assert.equal(payload.examGoal.examYear, 2027);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'examGoal'), true);
  assert.equal('targetUnit' in payload.examGoal, false);
  assert.equal('targetComparison' in payload.examGoal, false);
  assert.deepEqual(payload.secondaryEventCodes, ['long_jump']);
});

test('selected target event is submitted with its value and no client-derived unit or comparison', () => {
  const { page } = loadPage(PROFILE_EDIT_JS);
  const payload = toPlainObject(
    page.buildProfilePayload.call({
      data: {
        events: EVENTS,
        primaryEventIndex: 1,
        secondaryEvents: EVENTS.map((event) => ({ ...event, checked: false })),
        targetEventOptions: TARGET_OPTIONS,
        targetEventIndex: 1,
        trainingStartYear: '',
        trainingExperienceSummary: '',
        examGoal: {
          targetEventCode: '',
          targetValue: '12.5',
          targetScore: 'goal text'
        }
      }
    })
  );

  assert.equal(payload.primaryEventCode, 'long_jump');
  assert.equal(payload.examGoal.targetEventCode, '100m');
  assert.equal(payload.examGoal.targetValue, '12.5');
  assert.equal(payload.examGoal.targetScore, 'goal text');
  assert.equal('targetUnit' in payload.examGoal, false);
  assert.equal('targetComparison' in payload.examGoal, false);
});

test('legacy exam goal and an out-of-range target index remain editable', () => {
  const { page } = loadPage(PROFILE_EDIT_JS);
  const payload = toPlainObject(
    page.buildProfilePayload.call({
      data: {
        events: EVENTS,
        primaryEventIndex: 0,
        secondaryEvents: [],
        targetEventOptions: TARGET_OPTIONS,
        targetEventIndex: 99,
        trainingStartYear: '',
        trainingExperienceSummary: '',
        examGoal: {
          targetScore: 'legacy text'
        }
      }
    })
  );

  assert.equal(payload.examGoal.targetEventCode, '');
  assert.equal(payload.examGoal.targetValue, '');
  assert.equal(payload.examGoal.targetScore, 'legacy text');
});

test('target picker uses an explicit none option before the event list', () => {
  const wxml = readProjectFile(PROFILE_EDIT_WXML);
  assert.match(wxml, /range="\{\{targetEventOptions\}\}"/);
  assert.doesNotMatch(
    wxml,
    /range="\{\{events\}\}"\s+range-key="name"\s+value="\{\{targetEventIndex\}\}"/
  );
});
