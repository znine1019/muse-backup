'use strict';

const fs = require('fs');
const path = require('path');

const VOID_TAGS = new Set([
  'input',
  'image',
  'icon',
  'progress',
  'slider',
  'switch',
  'checkbox',
  'radio'
]);

function parseAttributes(attributeText) {
  const attributes = {};
  const pattern = /([:\w-]+)(?:\s*=\s*"([^"]*)")?/g;
  let match = pattern.exec(attributeText);
  while (match) {
    attributes[match[1]] = match[2] === undefined ? '' : match[2];
    match = pattern.exec(attributeText);
  }
  return attributes;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function lintWxml(source, fileLabel = '') {
  const errors = [];
  const root = {
    tag: '#root',
    lastChildHadCondition: false,
    lastChildTag: null,
    selfHadCondition: false
  };
  const stack = [root];
  const tagPattern =
    /<!--[\s\S]*?-->|<\/\s*([A-Za-z][\w-]*)\s*>|<\s*([A-Za-z][\w-]*)([^>]*?)(\/?)>/g;
  let match = tagPattern.exec(source);

  while (match) {
    const raw = match[0];
    if (raw.startsWith('<!--')) {
      match = tagPattern.exec(source);
      continue;
    }

    if (match[1]) {
      const tag = match[1];
      const frame = stack.pop();
      if (!frame || frame.tag !== tag) {
        errors.push(`标签闭合不匹配：</${tag}>`);
      } else {
        const parent = stack[stack.length - 1];
        parent.lastChildHadCondition = frame.selfHadCondition;
        parent.lastChildTag = frame.tag;
      }
      match = tagPattern.exec(source);
      continue;
    }

    const tag = match[2];
    const attributes = parseAttributes(match[3] || '');
    const selfClosing = match[4] === '/' || VOID_TAGS.has(tag);
    const hasIf = hasOwn(attributes, 'wx:if');
    const hasElif = hasOwn(attributes, 'wx:elif');
    const hasElse = hasOwn(attributes, 'wx:else');
    const hasFor = hasOwn(attributes, 'wx:for');

    if (hasIf && hasFor) {
      errors.push(
        `<${tag}> 同时使用 wx:if 与 wx:for，会导致 wx:else 匹配失败`
      );
    }
    if (hasFor && !hasOwn(attributes, 'wx:key')) {
      errors.push(`<${tag}> 使用 wx:for 但缺少 wx:key`);
    }
    if (hasElse || hasElif) {
      const parent = stack[stack.length - 1];
      if (!parent.lastChildHadCondition) {
        errors.push(
          `<${tag}> 的 ${hasElse ? 'wx:else' : 'wx:elif'} 找不到同级 wx:if/wx:elif`
        );
      }
    }

    if (selfClosing) {
      const parent = stack[stack.length - 1];
      parent.lastChildHadCondition = hasIf || hasElif;
      parent.lastChildTag = tag;
    } else {
      stack.push({
        tag,
        lastChildHadCondition: false,
        lastChildTag: null,
        selfHadCondition: hasIf || hasElif
      });
    }

    match = tagPattern.exec(source);
  }

  if (stack.length > 1) {
    const unclosed = stack
      .slice(1)
      .map((frame) => `<${frame.tag}>`)
      .join(', ');
    errors.push(`存在未闭合标签：${unclosed}`);
  }

  return errors.map((error) => (fileLabel ? `${fileLabel}: ${error}` : error));
}

function collectWxmlFiles(directory) {
  const files = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectWxmlFiles(entryPath));
    } else if (entry.name.endsWith('.wxml')) {
      files.push(entryPath);
    }
  }
  return files;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const wxmlRoot = path.join(root, 'miniprogram');
  const errors = [];
  for (const file of collectWxmlFiles(wxmlRoot)) {
    const relative = path.relative(root, file);
    errors.push(...lintWxml(fs.readFileSync(file, 'utf8'), relative));
  }
  if (errors.length) {
    console.error('WXML结构检查失败：');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log('WXML结构检查通过。');
}

module.exports = {
  collectWxmlFiles,
  lintWxml,
  parseAttributes
};
