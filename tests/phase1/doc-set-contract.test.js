'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const API_ROOT = path.resolve(__dirname, '../../cloudfunctions/api');

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJavaScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }
  return files;
}

test('doc(id).set payloads never repeat the document id', () => {
  const directSetIdPattern =
    /\.set\(\s*\{[\s\S]{0,220}?data\s*:\s*\{[\s\S]{0,220}?\b_id\s*:/;
  const offenders = listJavaScriptFiles(API_ROOT).filter((filePath) =>
    directSetIdPattern.test(fs.readFileSync(filePath, 'utf8'))
  );

  assert.deepEqual(offenders, []);
});

test('training group, student profile, and review set payloads keep ids only in doc(id)', () => {
  const groupsSource = fs.readFileSync(
    path.join(API_ROOT, 'actions/groups.js'),
    'utf8'
  );
  const profileSource = fs.readFileSync(
    path.join(API_ROOT, 'actions/profile.js'),
    'utf8'
  );

  assert.equal(
    /\.doc\(groupId\)\.set\(\{\s*data:\s*\{\s*_id\s*:/.test(groupsSource),
    false
  );
  assert.equal(/_id:\s*profileId\s*,/.test(profileSource), false);
  assert.equal(/_id:\s*reviewId\s*,/.test(profileSource), false);
});
