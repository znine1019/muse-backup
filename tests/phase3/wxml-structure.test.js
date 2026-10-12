'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { collectWxmlFiles, lintWxml } = require('../../scripts/wxml-lint');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const MINIPROGRAM_ROOT = path.join(PROJECT_ROOT, 'miniprogram');
const APP_JSON = path.join(MINIPROGRAM_ROOT, 'app.json');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function collectJsonFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(entryPath));
    } else if (entry.name.endsWith('.json')) {
      files.push(entryPath);
    }
  }
  return files;
}

function resolveComponentBase(jsonFile, componentPath) {
  if (componentPath.startsWith('/')) {
    return path.join(MINIPROGRAM_ROOT, componentPath);
  }
  return path.resolve(path.dirname(jsonFile), componentPath);
}

test('all WXML files pass structural lint', () => {
  const errors = [];
  for (const file of collectWxmlFiles(MINIPROGRAM_ROOT)) {
    const relative = path.relative(PROJECT_ROOT, file);
    errors.push(...lintWxml(readText(file), relative));
  }
  assert.deepEqual(errors, []);
});

test('profile edit keeps matching wx:if and wx:else branches', () => {
  const source = readText(
    path.join(MINIPROGRAM_ROOT, 'pages/profile-edit/profile-edit.wxml')
  );
  assert.match(source, /<block wx:if="\{\{measurements\.length\}\}">/);
  assert.match(source, /<view wx:else class="muted">暂无身体指标历史。<\/view>/);
  assert.match(source, /wx:for="\{\{measurements\}\}" wx:key="id"/);
  assert.doesNotMatch(source, /wx:if="\{\{measurements\.length\}\}"[^>]*wx:for/);
});

test('every registered page has four files and valid JSON', () => {
  const appConfig = JSON.parse(readText(APP_JSON));
  for (const page of appConfig.pages) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
      const file = path.join(MINIPROGRAM_ROOT, `${page}${extension}`);
      assert.ok(fs.existsSync(file), `${page}${extension} should exist`);
    }
    const jsonFile = path.join(MINIPROGRAM_ROOT, `${page}.json`);
    assert.doesNotThrow(() => JSON.parse(readText(jsonFile)));
  }
});

test('all usingComponents references resolve to existing component files', () => {
  const jsonFiles = collectJsonFiles(MINIPROGRAM_ROOT);
  for (const jsonFile of jsonFiles) {
    let config;
    try {
      config = JSON.parse(readText(jsonFile));
    } catch (error) {
      assert.fail(`${path.relative(PROJECT_ROOT, jsonFile)} is not valid JSON`);
    }
    const components = config.usingComponents || {};
    for (const [name, componentPath] of Object.entries(components)) {
      const base = resolveComponentBase(jsonFile, componentPath);
      for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
        assert.ok(
          fs.existsSync(`${base}${extension}`),
          `${name} -> ${componentPath}${extension} should exist`
        );
      }
      const componentConfig = JSON.parse(readText(`${base}.json`));
      assert.equal(
        componentConfig.component,
        true,
        `${componentPath} should be a component`
      );
    }
  }
});

test('page WXML event handlers exist in the matching page JavaScript', () => {
  const appConfig = JSON.parse(readText(APP_JSON));
  for (const page of appConfig.pages) {
    const wxml = readText(path.join(MINIPROGRAM_ROOT, `${page}.wxml`));
    const js = readText(path.join(MINIPROGRAM_ROOT, `${page}.js`));
    const handlerPattern = /(?:bind|catch)[\w:-]*\s*=\s*"([A-Za-z_$][\w$]*)"/g;
    let match = handlerPattern.exec(wxml);
    while (match) {
      const handler = match[1];
      const handlerPatternInJs = new RegExp(`\\b${handler}\\s*\\(`);
      assert.ok(
        handlerPatternInJs.test(js),
        `${page}.wxml handler ${handler} should exist in ${page}.js`
      );
      match = handlerPattern.exec(wxml);
    }
  }
});
