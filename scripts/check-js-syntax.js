'use strict';

/**
 * 全仓库 JavaScript 语法检查
 *
 * 覆盖范围（与阶段1—阶段6报告一致）：仓库内全部 .js 源文件，
 * 包括 miniprogram / cloudfunctions / tests / scripts，排除 node_modules 与 .git。
 *
 * 历史记录说明：阶段6报告为 115 个文件，阶段7-1/7-2 报告为 69 个文件，
 * 差异原因是后者只统计了 miniprogram + cloudfunctions。本脚本固定统计全仓库范围。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.tmp', 'dist', 'build']);
const TARGET_DIRS = ['miniprogram', 'cloudfunctions', 'tests', 'scripts'];

const files = [];

function walk(directory) {
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
}

for (const target of TARGET_DIRS) {
  walk(path.join(root, target));
}

files.sort();

const failures = [];
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    const output = `${(error.stdout || '').toString()}${(error.stderr || '').toString()}`;
    failures.push({
      file: path.relative(root, file),
      message: output.trim().split('\n').slice(0, 3).join(' | ')
    });
  }
}

const byDirectory = TARGET_DIRS.map((target) => {
  const count = files.filter((file) =>
    path.relative(root, file).startsWith(`${target}${path.sep}`)
  ).length;
  return `${target}=${count}`;
});

if (failures.length) {
  console.error('JavaScript 语法检查未通过：');
  for (const failure of failures) {
    console.error(` - ${failure.file}: ${failure.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `JavaScript 语法检查通过，共 ${files.length} 个文件（${byDirectory.join('、')}）。`
  );
  console.log('检查范围：全仓库 .js 源文件（含 miniprogram、cloudfunctions、tests、scripts）。');
}
