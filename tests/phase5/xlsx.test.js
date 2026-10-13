'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSheetXml,
  buildXlsx,
  buildXlsxBase64,
  columnName,
  escapeXml
} = require('../../miniprogram/utils/xlsx-writer');

function bytesToLatin1(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

test('xlsx writer builds a real zip-based workbook', () => {
  const rows = [
    ['赛事名称', '学生姓名', '参赛项目', '组别'],
    ['市青少年田径赛', '学生甲', '100米', '甲组'],
    ['市青少年田径赛', '学生甲', '跳远', '甲组']
  ];
  const bytes = buildXlsx('报名名单', rows);
  const raw = Buffer.from(bytes).toString('utf8');

  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
  assert.match(raw, /\[Content_Types\]\.xml/);
  assert.match(raw, /xl\/worksheets\/sheet1\.xml/);
  assert.match(raw, /市青少年田径赛/);
  assert.match(raw, /学生甲/);
  assert.match(raw, /spreadsheetml\.sheet\.main\+xml/);
});

test('xlsx writer base64 output decodes back to the same bytes', () => {
  const bytes = buildXlsx('名单', [['姓名'], ['学生甲']]);
  const base64 = buildXlsxBase64('名单', [['姓名'], ['学生甲']]);
  const decoded = new Uint8Array(Buffer.from(base64, 'base64'));
  assert.deepEqual(Array.from(decoded), Array.from(bytes));
});

test('xlsx metadata contains one central directory entry per file', () => {
  const bytes = buildXlsx('Sheet1', [['A', 'B'], ['1', 2]]);
  let centralCount = 0;
  for (let index = 0; index + 4 <= bytes.length; index += 1) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x01 &&
      bytes[index + 3] === 0x02
    ) {
      centralCount += 1;
    }
  }
  assert.equal(centralCount, 5);

  let eocdCount = 0;
  for (let index = 0; index + 4 <= bytes.length; index += 1) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x05 &&
      bytes[index + 3] === 0x06
    ) {
      eocdCount += 1;
    }
  }
  assert.equal(eocdCount, 1);
});

test('sheet xml escapes text and keeps numbers numeric', () => {
  assert.equal(escapeXml('A&B<C>"D\'E'), 'A&amp;B&lt;C&gt;&quot;D&apos;E');
  const xml = buildSheetXml([
    ['<学生>', 'A&B'],
    ['数值', 12.5]
  ]);
  assert.match(xml, /&lt;学生&gt;/);
  assert.match(xml, /A&amp;B/);
  assert.match(xml, /<c r="B2"><v>12.5<\/v><\/c>/);
});

test('column letters follow spreadsheet naming', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(27), 'AB');
});
