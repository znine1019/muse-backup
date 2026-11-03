'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateCoachProfilePayload,
  validateParentProfilePayload,
  validateProfilePayload
} = require('../../cloudfunctions/api/lib/validation');

const ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function loadPage(relativePath) {
  let definition = null;
  global.Page = (config) => {
    definition = config;
  };
  const absolutePath = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(absolutePath)];
  require(absolutePath);
  delete global.Page;
  assert.ok(definition, `${relativePath} 未注册 Page`);
  definition.setData = function setData(patch) {
    this.data = { ...this.data, ...patch };
  };
  return definition;
}

function validStudentProfile(overrides = {}) {
  return {
    name: '  张同学  ',
    gender: 'male',
    birthDate: '2010-01-01',
    heightCm: 170,
    weightKg: 60,
    primaryTrainingProject: '100米',
    requestedTrainingGroupId: '',
    ...overrides
  };
}

test('学生、家长、教练注册页均显示统一真实姓名提醒和角色专属说明', () => {
  const student = read('miniprogram/pages/register/register.wxml');
  const parent = read('miniprogram/pages/parent-register/parent-register.wxml');
  const coach = read('miniprogram/pages/coach-register/coach-register.wxml');

  for (const wxml of [student, parent, coach]) {
    assert.match(wxml, /真实姓名填写提醒/);
    assert.match(wxml, /请务必填写您本人的真实姓名/);
    assert.match(wxml, /俱乐部人员管理、身份审核、训练成绩记录及考勤管理/);
    assert.match(wxml, /禁止使用微信昵称、网名、虚假姓名或他人姓名/);
    assert.match(wxml, /jg-realname-alert/);
  }

  assert.match(student, /请填写学生本人真实姓名/);
  assert.match(parent, /请填写家长本人真实姓名，请勿填写孩子的姓名/);
  assert.match(coach, /请填写教练员本人真实姓名/);
});

test('三个注册姓名输入均限制 40 字符并位于提醒之后', () => {
  const cases = [
    ['miniprogram/pages/register/register.wxml', '请填写学生本人真实姓名'],
    ['miniprogram/pages/parent-register/parent-register.wxml', '请输入真实姓名'],
    ['miniprogram/pages/coach-register/coach-register.wxml', '请填写您本人的真实姓名']
  ];
  for (const [file, placeholder] of cases) {
    const wxml = read(file);
    const noticeIndex = wxml.indexOf('真实姓名填写提醒');
    const inputIndex = wxml.indexOf(`placeholder="${placeholder}"`);
    assert.ok(noticeIndex >= 0, `${file} 缺少姓名提醒`);
    assert.ok(inputIndex > noticeIndex, `${file} 姓名输入应位于提醒之后`);
    assert.match(wxml, /maxlength="40"/);
  }
});

test('学生前端拒绝空姓名和仅空格姓名并保留表单', async () => {
  const page = loadPage('miniprogram/pages/register/register.js');
  page.data = {
    ...page.data,
    submitting: false,
    form: { ...page.data.form, name: '   ' }
  };
  await page.handleSubmit();
  assert.equal(page.data.formError, '请填写学生本人真实姓名。');
  assert.equal(page.data.submitting, false);
});

test('学生前端提交前自动去除姓名首尾空格', async () => {
  const api = require('../../miniprogram/services/api');
  const originalSubmit = api.submitProfile;
  let submitted = null;
  api.submitProfile = async (payload) => {
    submitted = payload;
    return {};
  };
  global.wx = { reLaunch() {} };
  try {
    const page = loadPage('miniprogram/pages/register/register.js');
    page.data = {
      ...page.data,
      submitting: false,
      form: validStudentProfile()
    };
    await page.handleSubmit();
    assert.equal(submitted.name, '张同学');
  } finally {
    api.submitProfile = originalSubmit;
    delete global.wx;
  }
});

test('家长前端拒绝仅空格姓名并提示填写家长本人姓名', async () => {
  const page = loadPage('miniprogram/pages/parent-register/parent-register.js');
  page.data = { ...page.data, submitting: false, name: '   ' };
  await page.submit();
  assert.equal(
    page.data.formError,
    '请填写家长本人真实姓名，请勿填写孩子的姓名。'
  );
  assert.equal(page.data.submitting, false);
});

test('教练前端拒绝仅空格姓名并提示填写教练本人姓名', async () => {
  const page = loadPage('miniprogram/pages/coach-register/coach-register.js');
  page.data = { ...page.data, submitting: false, name: '   ' };
  await page.submit();
  assert.equal(page.data.formError, '请填写教练员本人真实姓名。');
  assert.equal(page.data.submitting, false);
});

test('后端学生姓名拒绝空值和仅空格并自动去除首尾空格', () => {
  assert.equal(validateProfilePayload(validStudentProfile()).name, '张同学');
  assert.throws(
    () => validateProfilePayload(validStudentProfile({ name: '' })),
    (error) => error.code === 'INVALID_FIELD'
  );
  assert.throws(
    () => validateProfilePayload(validStudentProfile({ name: '    ' })),
    (error) => error.code === 'INVALID_FIELD'
  );
});

test('后端家长姓名拒绝空值和仅空格并自动去除首尾空格', () => {
  assert.equal(validateParentProfilePayload({ name: '  李家长  ' }).name, '李家长');
  assert.throws(
    () => validateParentProfilePayload({ name: '' }),
    (error) => error.code === 'INVALID_FIELD'
  );
  assert.throws(
    () => validateParentProfilePayload({ name: '   ' }),
    (error) => error.code === 'INVALID_FIELD'
  );
});

test('后端教练姓名拒绝空值和仅空格并自动去除首尾空格', () => {
  assert.equal(validateCoachProfilePayload({ name: '  王教练  ' }).name, '王教练');
  assert.throws(
    () => validateCoachProfilePayload({ name: '' }),
    (error) => error.code === 'INVALID_FIELD'
  );
  assert.throws(
    () => validateCoachProfilePayload({ name: '   ' }),
    (error) => error.code === 'INVALID_FIELD'
  );
});

test('三个角色姓名长度规则一致，40字符允许、41字符拒绝', () => {
  const forty = '张'.repeat(40);
  const fortyOne = '张'.repeat(41);

  assert.equal(validateProfilePayload(validStudentProfile({ name: forty })).name, forty);
  assert.equal(validateParentProfilePayload({ name: forty }).name, forty);
  assert.equal(validateCoachProfilePayload({ name: forty }).name, forty);

  assert.throws(() => validateProfilePayload(validStudentProfile({ name: fortyOne })));
  assert.throws(() => validateParentProfilePayload({ name: fortyOne }));
  assert.throws(() => validateCoachProfilePayload({ name: fortyOne }));
});
