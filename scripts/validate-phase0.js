'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
const passed = [];

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function readText(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function check(condition, message) {
  if (condition) {
    passed.push(message);
    return;
  }
  errors.push(message);
}

function fileExists(relativePath) {
  return fs.existsSync(absolute(relativePath)) && fs.statSync(absolute(relativePath)).isFile();
}

const requiredFiles = [
  'project.config.json',
  'miniprogram/app.js',
  'miniprogram/app.json',
  'miniprogram/app.wxss',
  'miniprogram/sitemap.json',
  'cloudfunctions/README.txt'
];

for (const relativePath of requiredFiles) {
  check(fileExists(relativePath), `存在必要文件：${relativePath}`);
}

let projectConfig;
let appConfig;
let sitemap;

try {
  projectConfig = readJson('project.config.json');
  check(true, 'project.config.json 是有效 JSON');
} catch (error) {
  errors.push(`project.config.json 无法解析：${error.message}`);
}

try {
  appConfig = readJson('miniprogram/app.json');
  check(true, 'app.json 是有效 JSON');
} catch (error) {
  errors.push(`app.json 无法解析：${error.message}`);
}

try {
  sitemap = readJson('miniprogram/sitemap.json');
  check(true, 'sitemap.json 是有效 JSON');
} catch (error) {
  errors.push(`sitemap.json 无法解析：${error.message}`);
}

if (projectConfig) {
  check(projectConfig.miniprogramRoot === 'miniprogram/', 'miniprogramRoot 指向 miniprogram/');
  check(projectConfig.cloudfunctionRoot === 'cloudfunctions/', 'cloudfunctionRoot 指向 cloudfunctions/');
  check(projectConfig.compileType === 'miniprogram', 'compileType 为 miniprogram');
}

const declaredPages = appConfig && Array.isArray(appConfig.pages) ? appConfig.pages : [];
const expectedPages = [
  'pages/index/index',
  'pages/student/student',
  'pages/coach/coach',
  'pages/admin/admin'
];

check(
  declaredPages.length === expectedPages.length && expectedPages.every((page) => declaredPages.includes(page)),
  'app.json 已声明首页及三个用户端页面'
);

for (const page of declaredPages) {
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    const pageFile = `miniprogram/${page}${extension}`;
    check(fileExists(pageFile), `页面文件存在：${pageFile}`);
  }
}

if (fileExists('miniprogram/pages/index/index.js')) {
  const indexSource = readText('miniprogram/pages/index/index.js');
  const navigationUrls = [
    ...indexSource.matchAll(/wx\.navigateTo\s*\(\s*\{\s*url\s*:\s*['"]([^'"]+)['"]/g)
  ].map((match) => match[1]);

  check(navigationUrls.length === 3, '首页包含三个预览导航动作');
  for (const url of navigationUrls) {
    const route = url.startsWith('/') ? url.slice(1) : url;
    check(declaredPages.includes(route), `导航目标已在 app.json 声明：${url}`);
  }
}

if (fileExists('miniprogram/pages/index/index.wxml')) {
  check(readText('miniprogram/pages/index/index.wxml').includes('V1.6'), '首页显示 V1.6 开发基线');
}

if (sitemap) {
  check(
    Array.isArray(sitemap.rules) &&
      sitemap.rules.some((rule) => rule.action === 'disallow' && rule.page === '*'),
    'sitemap 禁止索引阶段0页面'
  );
}

if (fileExists('.gitignore')) {
  const ignoreRules = readText('.gitignore');
  check(ignoreRules.includes('project.private.config.json'), '.gitignore 忽略本地 IDE 私有配置');
  check(ignoreRules.includes('.env'), '.gitignore 忽略环境变量文件');
  check(ignoreRules.includes('*.xlsx'), '.gitignore 忽略运行期 Excel 导出');
}

const runtimeFiles = [
  'project.config.json',
  'miniprogram/app.js',
  'miniprogram/app.json',
  ...declaredPages.flatMap((page) =>
    ['.js', '.json', '.wxml', '.wxss'].map((extension) => `miniprogram/${page}${extension}`)
  )
];

const secretPatterns = [
  { label: '私钥', expression: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/ },
  { label: 'DeepSeek API Key', expression: /sk-[A-Za-z0-9_-]{16,}/ },
  {
    label: '前端密钥赋值',
    expression: /\b(?:appsecret|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*['"][^'"]+/i
  }
];

for (const relativePath of runtimeFiles) {
  if (!fileExists(relativePath)) {
    continue;
  }
  const source = readText(relativePath);
  for (const pattern of secretPatterns) {
    check(!pattern.expression.test(source), `${relativePath} 未发现${pattern.label}`);
  }
}

if (errors.length > 0) {
  console.error('阶段0静态校验失败：');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`阶段0静态校验通过，共 ${passed.length} 项。`);
console.log('注意：仍需在微信开发者工具中完成真实编译和页面点击验证。');
