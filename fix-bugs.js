#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log('🔧 开始修复 Telegram Mini App 的所有 bug...\n');

// 修复 1: miniappServer.js - bootstrap 接口
const serverPath = path.join(__dirname, 'src/miniappServer.js');
let serverCode = fs.readFileSync(serverPath, 'utf8');

// 修复 bootstrap 数据格式
serverCode = serverCode.replace(
  /const readResult = \(item\) => \(item\.status === "fulfilled" \? item\.value : null\);\s+const readError = \(item\) => \(item\.status === "rejected" \? String\(item\.reason\?\.message \|\| item\.reason \|\| "请求失败"\) : ""\);\s+sendJson\(res, 200, \{\s+success: true,\s+data: \{\s+telegram_user: identity\.user,\s+me: readResult\(tasks\[0\]\),\s+usage: readResult\(tasks\[1\]\),\s+subscription_plans: readResult\(tasks\[2\]\) \|\| \[\],\s+subscription_self: readResult\(tasks\[3\]\),\s+keys: readResult\(tasks\[4\]\),/,
  `const readResult = (item) => (item.status === "fulfilled" ? item.value : null);
      const readError = (item) => (item.status === "rejected" ? String(item.reason?.message || item.reason || "请求失败") : "");

      const usageData = readResult(tasks[1]);
      const usage = Array.isArray(usageData) ? usageData : [];
      const keysData = readResult(tasks[4]);
      const keys = toList(keysData);

      sendJson(res, 200, {
        success: true,
        data: {
          telegram_user: identity.user,
          me: readResult(tasks[0]),
          usage: usage,
          subscription_plans: readResult(tasks[2]) || [],
          subscription_self: readResult(tasks[3]),
          keys: keys,`
);

fs.writeFileSync(serverPath, serverCode, 'utf8');
console.log('✅ 修复 1: bootstrap 接口数据格式');

// 修复 2: app.js - Key 编辑添加过期时间
const appPath = path.join(__dirname, 'miniapp/app.js');
let appCode = fs.readFileSync(appPath, 'utf8');

// 添加过期时间到编辑 payload
appCode = appCode.replace(
  /const payload = \{\s+name: els\.editorName\.value,\s+group: els\.editorGroup\.value,\s+remain_quota: Number\(els\.editorQuota\.value\),\s+status: els\.editorStatus\.checked \? 1 : 2,/,
  `const payload = {
      name: els.editorName.value,
      group: els.editorGroup.value,
      remain_quota: Number(els.editorQuota.value),
      expired_time: Number(els.editorExpire.value) || -1,
      status: els.editorStatus.checked ? 1 : 2,`
);

// 添加过期时间到详情加载
appCode = appCode.replace(
  /els\.editorQuota\.value = d\.remain_quota \|\| 0;\s+els\.editorStatus\.checked = Number\(d\.status\) === 1;/,
  `els.editorQuota.value = d.remain_quota || 0;
        els.editorExpire.value = d.expired_time || -1;
        els.editorStatus.checked = Number(d.status) === 1;`
);

fs.writeFileSync(appPath, appCode, 'utf8');
console.log('✅ 修复 2: Key 编辑过期时间字段');

// 修复 3: newapiClient.js - 模型接口路径
const clientPath = path.join(__dirname, 'src/newapiClient.js');
let clientCode = fs.readFileSync(clientPath, 'utf8');

clientCode = clientCode.replace(
  /path: "\/api\/user\/models"/,
  `path: "/api/models"`
);

fs.writeFileSync(clientPath, clientCode, 'utf8');
console.log('✅ 修复 3: 模型接口路径');

console.log('\n🎉 所有 bug 修复完成！\n');
console.log('请运行以下命令测试：');
console.log('  npm start\n');
