'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const API_ROOT = path.join(ROOT, 'cloudfunctions', 'api');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function resolveLocalRequire(fromFile, request) {
  const target = path.resolve(path.dirname(fromFile), request);
  const candidates = [target, `${target}.js`, `${target}.json`, path.join(target, 'index.js')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function inspectLocalRequires(entryFile) {
  const queue = [entryFile];
  const visited = new Set();
  const missing = [];
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const resolved = resolveLocalRequire(file, match[1]);
      if (!resolved) {
        missing.push({
          from: path.relative(ROOT, file),
          request: match[1]
        });
      } else if (resolved.endsWith('.js')) {
        queue.push(resolved);
      }
    }
  }
  return { visited, missing };
}

test('DEP-05 package.json固定wx-server-sdk 4.0.2且无额外生产依赖', () => {
  const packageJson = readJson('cloudfunctions/api/package.json');

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.main, 'index.js');
  assert.deepEqual(packageJson.dependencies, {
    'wx-server-sdk': '4.0.2'
  });
});

test('DEP-05 package-lock使用lockfileVersion 2并与package.json一致', () => {
  const packageJson = readJson('cloudfunctions/api/package.json');
  const lock = readJson('cloudfunctions/api/package-lock.json');
  const rootPackage = lock.packages[''];
  const sdkPackage = lock.packages['node_modules/wx-server-sdk'];

  assert.equal(lock.lockfileVersion, 2);
  assert.equal(lock.name, packageJson.name);
  assert.equal(lock.version, packageJson.version);
  assert.equal(rootPackage.name, packageJson.name);
  assert.equal(rootPackage.version, packageJson.version);
  assert.deepEqual(rootPackage.dependencies, packageJson.dependencies);
  assert.equal(sdkPackage.version, '4.0.2');
  assert.equal(typeof sdkPackage.resolved, 'string');
  assert.equal(typeof sdkPackage.integrity, 'string');
});

test('DEP-05 cloudbaserc保持Nodejs16.13云端安装依赖并忽略本地node_modules', () => {
  const cloudbase = readJson('cloudbaserc.json');
  const api = cloudbase.functions.find((item) => item.name === 'api');

  assert.equal(cloudbase.envId, 'cloud1-d8g0egkli3191959a');
  assert.equal(cloudbase.functionRoot, 'cloudfunctions');
  assert.ok(api);
  assert.equal(api.handler, 'index.main');
  assert.equal(api.runtime, 'Nodejs16.13');
  assert.equal(api.installDependency, true);
  assert.equal(api.ignore.includes('node_modules/**'), true);
  assert.equal(api.ignore.includes('.git/**'), true);
  assert.equal(api.ignore.includes('package-lock.json'), false);
});

test('DEP-05完整api部署单元包含入口、actions、lib与锁文件且本地引用全部可解析', () => {
  const requiredFiles = [
    'cloudfunctions/api/index.js',
    'cloudfunctions/api/package.json',
    'cloudfunctions/api/package-lock.json',
    'cloudfunctions/api/actions/auth.js',
    'cloudfunctions/api/actions/attendance.js',
    'cloudfunctions/api/actions/competitions.js',
    'cloudfunctions/api/actions/coach.js',
    'cloudfunctions/api/actions/directory.js',
    'cloudfunctions/api/actions/feedback.js',
    'cloudfunctions/api/actions/groups.js',
    'cloudfunctions/api/actions/notices.js',
    'cloudfunctions/api/actions/parent.js',
    'cloudfunctions/api/actions/profile.js',
    'cloudfunctions/api/actions/performance.js',
    'cloudfunctions/api/actions/plans.js',
    'cloudfunctions/api/actions/registrations.js',
    'cloudfunctions/api/actions/report.js',
    'cloudfunctions/api/actions/statistics.js',
    'cloudfunctions/api/actions/users.js',
    'cloudfunctions/api/lib/repository.js',
    'cloudfunctions/api/lib/validation.js',
    'cloudfunctions/api/lib/transaction.js'
  ];
  for (const file of requiredFiles) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), true, `missing ${file}`);
  }

  const inspection = inspectLocalRequires(path.join(API_ROOT, 'index.js'));
  assert.deepEqual(inspection.missing, []);
  assert.ok(inspection.visited.size >= 30, '应递归覆盖全部本地api模块');
});

test('DEP-05 parent 11个路由完整且入口已注册', () => {
  const createParentActions = require('../../cloudfunctions/api/actions/parent');
  const routes = Object.keys(createParentActions({ repository: {} })).sort();
  assert.deepEqual(routes, [
    'parent.create_invite',
    'parent.get_profile',
    'parent.get_student_overview',
    'parent.list_my_links',
    'parent.list_pending_links',
    'parent.list_students',
    'parent.redeem_invite',
    'parent.review_link',
    'parent.revoke_link',
    'parent.student_decision',
    'parent.submit_profile'
  ]);
});

test('DEP-05部署包包含BUG-F03、SEC-01与SEC-02修复', () => {
  const statistics = read('cloudfunctions/api/actions/statistics.js');
  const users = read('cloudfunctions/api/actions/users.js');
  const registrations = read('cloudfunctions/api/actions/registrations.js');

  assert.equal(statistics.includes('group.coachUserIds'), false);
  assert.equal(statistics.includes('listActiveCoachMembershipsForGroups'), true);
  assert.equal(statistics.includes('validCoachIds'), true);
  assert.equal(users.includes('PARENT_ROLE_APPROVAL_REQUIRED'), true);
  assert.equal(users.includes('revokeParentRole'), true);
  assert.equal(users.includes('parentAuthorizationVersion'), true);
  assert.match(users, /const MAX_PARENT_LINKS_PER_REVOCATION = 20;/);
  assert.equal(registrations.includes('parentAuthorizationVersion'), true);
});
