'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
const passed = [];

function check(condition, message) {
  if (condition) {
    passed.push(message);
    return;
  }
  errors.push(message);
}

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function fileExists(relativePath) {
  return fs.existsSync(absolute(relativePath)) && fs.statSync(absolute(relativePath)).isFile();
}

function readText(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

const requiredFiles = [
  'miniprogram/config/env.js',
  'miniprogram/services/api.js',
  'miniprogram/utils/session.js',
  'miniprogram/pages/register/register.js',
  'miniprogram/pages/pending/pending.js',
  'miniprogram/pages/role-select/role-select.js',
  'miniprogram/pages/bootstrap/bootstrap.js',
  'cloudfunctions/api/index.js',
  'cloudfunctions/api/actions/auth.js',
  'cloudfunctions/api/actions/directory.js',
  'cloudfunctions/api/actions/profile.js',
  'cloudfunctions/api/actions/registrations.js',
  'cloudfunctions/api/actions/users.js',
  'cloudfunctions/api/actions/groups.js',
  'cloudfunctions/api/lib/policy.js',
  'cloudfunctions/api/lib/repository.js',
  'cloudfunctions/api/lib/session.js',
  'cloudfunctions/api/lib/validation.js',
  'cloudfunctions/health_check/index.js'
];

for (const relativePath of requiredFiles) {
  check(fileExists(relativePath), `存在阶段1文件：${relativePath}`);
}

const envModule = require(absolute('miniprogram/config/env.js'));
check(/^cloud\d+-[a-z0-9]+$/.test(envModule.CLOUD_ENV_ID), '前端使用真实云环境 ID 格式');
check(envModule.CLOUD_ENV_ID !== 'your-env-id', '未使用占位环境 ID');
check(envModule.API_FUNCTION_NAME === 'api', 'API 云函数名称已配置');
check(envModule.HEALTH_FUNCTION_NAME === 'health_check', '连接测试云函数名称已配置');

const appSource = readText('miniprogram/app.js');
check(appSource.includes('wx.cloud.init'), 'app.js 已初始化 wx.cloud');
check(!/process\.env/.test(appSource), '前端未读取云函数环境变量');

const appConfig = readJson('miniprogram/app.json');
const pages = Array.isArray(appConfig.pages) ? appConfig.pages : [];
for (const page of [
  'pages/index/index',
  'pages/register/register',
  'pages/pending/pending',
  'pages/role-select/role-select',
  'pages/student/student',
  'pages/coach/coach',
  'pages/admin/admin',
  'pages/bootstrap/bootstrap'
]) {
  check(pages.includes(page), `app.json 已声明页面：${page}`);
}

for (const page of pages) {
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    check(fileExists(`miniprogram/${page}${extension}`), `页面四件套存在：${page}${extension}`);
  }
}

const apiIndex = readText('cloudfunctions/api/index.js');
check(apiIndex.includes('cloud.DYNAMIC_CURRENT_ENV'), 'API 云函数使用动态当前环境');
check(!apiIndex.includes('cloud1-'), '云函数未硬编码前端环境 ID');
check(apiIndex.includes('getTrustedIdentity'), 'API 云函数读取可信微信身份');
check(apiIndex.includes("require('./actions/auth')"), 'API action 已按域拆分');

const healthIndex = readText('cloudfunctions/health_check/index.js');
check(healthIndex.includes('cloud.DYNAMIC_CURRENT_ENV'), '连接测试云函数使用动态当前环境');
check(!healthIndex.includes('cloud1-'), '连接测试云函数未硬编码前端环境 ID');

const authSource = readText('cloudfunctions/api/actions/auth.js');
check(authSource.includes('BOOTSTRAP_ADMIN_CODE'), '首个开发者使用云函数环境初始化码');
check(!authSource.includes('payload.role'), '登录初始化未信任前端角色');
check(authSource.includes('timingSafeEqual'), '初始化码使用恒定时间比较');

const frontendFiles = [];
function collectFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(entryPath);
    } else if (/\.(js|json|wxml|wxss)$/.test(entry.name)) {
      frontendFiles.push(entryPath);
    }
  }
}
collectFiles(absolute('miniprogram'));

const forbiddenFrontendPatterns = [
  {
    label: 'AppSecret 或 API Key',
    expression: /\b(?:appsecret|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*['"][^'"]+/i
  },
  { label: '私钥', expression: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/ },
  { label: 'DeepSeek Key', expression: /sk-[A-Za-z0-9_-]{16,}/ },
  { label: '客户端数据库直连', expression: /wx\.cloud\.database\s*\(/ },
  { label: '云函数环境变量', expression: /process\.env/ }
];

for (const filePath of frontendFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const pattern of forbiddenFrontendPatterns) {
    check(
      !pattern.expression.test(source),
      `${path.relative(root, filePath)} 未发现${pattern.label}`
    );
  }
}

if (errors.length > 0) {
  console.error('阶段1结构校验失败：');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`阶段1结构校验通过，共 ${passed.length} 项。`);
console.log('未执行云端部署，也未验证真实数据库读写。');
