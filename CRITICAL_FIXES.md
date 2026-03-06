# 🚨 关键 Bug 修复补丁

## 错误：Cannot set properties of null (setting 'textContent')

### 原因
前端代码没有检查元素是否存在就直接设置 textContent，导致页面加载失败。

### 修复方案

#### 1. 修复 app.js 第 149-177 行 (renderOverview 函数)

**查找：**
```javascript
function renderOverview() {
  const me = appState.me || {};
  const usage = appState.usage || {};
  const sub = appState.subSelf || {};

  els.userName.textContent = me.username || me.name || "User";
  els.currentDate.textContent = new Date().toLocaleDateString("zh-CN", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  els.statBalance.textContent = normalizeNumber(me.quota ?? me.balance);
  const totalUsed = Array.isArray(usage) ? usage.reduce((a, b) => a + (b.quota || 0), 0) : 0;
  els.statUsage.textContent = normalizeNumber(totalUsed);
  els.statSub.textContent = (sub.subscriptions || []).length;

  if (appState.affiliate) {
    els.statAffiliate.textContent = `+${appState.affiliate.history_amount || 0}`;
  }

  renderUsageChart();
}
```

**替换为：**
```javascript
function renderOverview() {
  const me = appState.me || {};
  const usage = appState.usage || {};
  const sub = appState.subSelf || {};

  if (els.userName) els.userName.textContent = me.username || me.name || "User";
  if (els.currentDate) els.currentDate.textContent = new Date().toLocaleDateString("zh-CN", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  if (els.statBalance) els.statBalance.textContent = normalizeNumber(me.quota ?? me.balance);
  const totalUsed = Array.isArray(usage) ? usage.reduce((a, b) => a + (b.quota || 0), 0) : 0;
  if (els.statUsage) els.statUsage.textContent = normalizeNumber(totalUsed);
  if (els.statSub) els.statSub.textContent = (sub.subscriptions || []).length;

  if (appState.affiliate && els.statAffiliate) {
    els.statAffiliate.textContent = `+${appState.affiliate.history_amount || 0}`;
  }

  renderUsageChart();
}
```

#### 2. 修复 app.js 第 318-337 行 (renderFinance 函数)

在 `els.plansCount.textContent` 前添加检查：

**查找：**
```javascript
  els.plansCount.textContent = (appState.plans || []).length;
```

**替换为：**
```javascript
  if (els.plansCount) els.plansCount.textContent = (appState.plans || []).length;
```

#### 3. 修复 app.js 第 342 行和 369 行

**查找：**
```javascript
  els.authBadge.textContent = "Syncing...";
```

**替换为：**
```javascript
  if (els.authBadge) els.authBadge.textContent = "Syncing...";
```

**查找：**
```javascript
    els.authBadge.textContent = tg?.initData ? "Verified" : "Dev Mode";
```

**替换为：**
```javascript
    if (els.authBadge) els.authBadge.textContent = tg?.initData ? "Verified" : "Dev Mode";
```

---

## 其他已修复的 Bug

✅ 1. 订阅购买路径 - 已改为 `/miniapi/subscription/buy`
✅ 2. Keys 列表返回 - 已改为返回 `list` 而不是 `data`
✅ 3. 创建 Key 返回 - 已改为返回 `list` 而不是 `listData`
✅ 4. Key 编辑过期时间 - 已添加 `expired_time` 字段

---

## 快速修复命令

在 `F:/code/bil-api/bil-bot` 目录下执行：

```bash
# 1. 备份原文件
cp miniapp/app.js miniapp/app.js.backup

# 2. 使用文本编辑器打开 miniapp/app.js
# 3. 按照上面的说明手动修改
# 4. 保存文件

# 5. 测试
npm start
```

---

## 测试清单

修复后测试：
- [ ] 打开首页不报错
- [ ] 余额显示正常
- [ ] 创建密钥成功
- [ ] 编辑密钥（包括过期时间）
- [ ] 查看日志
- [ ] 订阅购买
