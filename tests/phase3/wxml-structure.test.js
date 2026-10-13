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
  /* F1-B2 已将该页迁移到 jg- 设计系统（空状态改用 jg-empty、列表改用 jg-list），
     因此这里断言“分支仍然成对 + 绑定未丢失 + 不得同标签 wx:if/wx:for”，
     不再绑定具体样式类名。 */
  assert.match(source, /wx:if="\{\{!measurements\.length\}\}"/, '应保留身体指标空状态分支');
  assert.match(source, /wx:else/, '空状态必须有配对的 wx:else 列表分支');
  assert.match(source, /wx:for="\{\{measurements\}\}" wx:key="id"/, '身体指标列表绑定不得丢失');
  assert.doesNotMatch(source, /wx:if="[^"]*"[^>]*wx:for/, 'wx:if 与 wx:for 不得写在同一标签上');
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
