# 🔧 Bil-Bot Mini App 完整修复清单

根据两个 agent 的深入分析，以下是所有需要修复的 bug 和具体修复方案。

## ✅ 已修复

1. **日志接口路径** - `newapiClient.js` 已改为 `/api/log/self`
2. **日志分页格式** - `miniappServer.js` 已适配分页返回
3. **订阅路径修复** - 已改为 `/miniapi/subscription/buy` 和 `/miniapi/subscription/preference`

## 🔴 需要立即修复的关键 Bug

### Bug 1: Keys 列表返回错误数据结构
**文件**: `miniappServer.js` 第 524 行
**问题**: 返回 `data` 而不是 `list`
```javascript
// 错误
sendJson(res, 200, { success: true, data, groups });

// 正确
sendJson(res, 200, { success: true, data: list, groups });
```

### Bug 2: 创建 Key 后返回错误数据
**文件**: `miniappServer.js` 第 558 行
```javascript
// 错误
keys: listData

// 正确
keys: list
```

### Bug 3: Bootstrap 接口数据格式问题
**文件**: `miniappServer.js` 第 366 行
```javascript
// 需要确保 usage 和 keys 是数组
const usageData = readResult(tasks[1]);
const usage = Array.isArray(usageData) ? usageData : [];

const keysData = readResult(tasks[4]);
const keys = toList(keysData);
```

### Bug 4: 前端 Key 编辑缺少过期时间
**文件**: `miniapp/app.js` 第 459 行
```javascript
const payload = {
  name: els.editorName.value,
  group: els.editorGroup.value,
  remain_quota: Number(els.editorQuota.value),
  expired_time: Number(els.editorExpire.value) || -1,  // 添加这行
  status: els.editorStatus.checked ? 1 : 2,
  unlimited_quota: els.editorUnlimited.checked,
  allow_ips: els.editorAllowIps.value,
  model_limits_enabled: els.editorModelLimitToggle.checked,
  model_limits: els.editorModelLimitToggle.checked ? els.editorModelLimits.value : ""
};
```

### Bug 5: 前端加载 Key 详情缺少过期时间赋值
**文件**: `miniapp/app.js` 第 406 行
```javascript
els.editorName.value = d.name || "";
els.editorGroup.value = d.group || "";
els.editorQuota.value = d.remain_quota || 0;
els.editorExpire.value = d.expired_time || -1;  // 添加这行
els.editorStatus.checked = Number(d.status) === 1;
```

### Bug 6: 模型接口路径可能错误
**文件**: `newapiClient.js` 第 293 行
```javascript
// 当前
path: "/api/user/models"

// 根据 newapi 分析，应该是
path: "/api/models"
```

### Bug 7: 推广接口路径错误
**文件**: `newapiClient.js` 第 318 行
```javascript
// 当前
path: "/api/user/aff"

// 正确应该是
path: "/api/user/aff"  // 这个是对的，保持不变
```

## 📝 完整修复步骤

### 步骤 1: 修复 miniappServer.js

```bash
# 在 F:/code/bil-api/bil-bot 目录执行
```

需要修改的位置：
1. 第 366-404 行 - bootstrap 接口
2. 第 524-540 行 - keys 列表接口
3. 第 558-569 行 - 创建 key 接口

### 步骤 2: 修复 app.js

需要修改的位置：
1. 第 406-416 行 - 加载 key 详情
2. 第 459-470 行 - 保存 key 编辑

### 步骤 3: 修复 newapiClient.js

需要修改的位置：
1. 第 293-300 行 - getModels 方法

## 🧪 测试清单

修复后需要测试的功能：
- [ ] 登录/鉴权
- [ ] 余额显示
- [ ] 用量图表
- [ ] 模型列表加载
- [ ] 创建密钥
- [ ] 编辑密钥（包括过期时间）
- [ ] 删除密钥
- [ ] 查看日志
- [ ] 搜索日志
- [ ] 充值
- [ ] 订阅购买
- [ ] 兑换码
- [ ] 邀请链接

## 🚀 快速修复命令

我将创建一个自动修复脚本...
