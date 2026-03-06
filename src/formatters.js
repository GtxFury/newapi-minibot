function pickStringField(obj, keys = []) {
  if (!obj || typeof obj !== "object") {
    return "";
  }
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return "";
}

function formatEpochSeconds(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) {
    return "-";
  }
  return new Date(n * 1000).toLocaleString("zh-CN", { hour12: false });
}

function formatPlanDuration(plan) {
  const unitMap = {
    year: "年",
    month: "个月",
    day: "天",
    hour: "小时"
  };
  if (plan?.duration_unit === "custom") {
    const sec = Number(plan?.custom_seconds || 0);
    if (sec > 0) {
      if (sec % 86400 === 0) return `${sec / 86400} 天`;
      if (sec % 3600 === 0) return `${sec / 3600} 小时`;
      return `${sec} 秒`;
    }
    return "自定义";
  }
  const unit = unitMap[plan?.duration_unit] || "周期";
  return `${plan?.duration_value ?? "-"} ${unit}`;
}

function findArray(data) {
  if (Array.isArray(data)) {
    return data;
  }
  if (!data || typeof data !== "object") {
    return [];
  }

  const candidates = ["items", "list", "tokens", "rows", "data"];
  for (const key of candidates) {
    if (Array.isArray(data[key])) {
      return data[key];
    }
  }

  return [];
}

function normalizeApiKey(value) {
  const key = String(value || "").trim();
  if (!key) {
    return "";
  }
  return key.startsWith("sk-") ? key : `sk-${key}`;
}

function pickApiKey(item) {
  if (!item || typeof item !== "object") {
    return "";
  }
  return (
    normalizeApiKey(item.key) ||
    normalizeApiKey(item.token) ||
    normalizeApiKey(item.api_key) ||
    normalizeApiKey(item.access_token) ||
    normalizeApiKey(item.value)
  );
}

function tokenStatusText(status) {
  const n = Number(status);
  if (n === 1) return "启用";
  if (n === 2) return "禁用";
  if (n === 3) return "已过期";
  if (n === 4) return "额度耗尽";
  return String(status ?? "-");
}

export function formatUserSelf(data) {
  if (!data || typeof data !== "object") {
    return "账户信息获取成功。";
  }

  const lines = [
    "账户信息",
    `ID: ${data.id ?? "-"}`,
    `用户名: ${data.username ?? data.name ?? "-"}`,
    `邮箱: ${data.email ?? "-"}`,
    `余额: ${data.quota ?? data.balance ?? "-"}`,
    `状态: ${data.status ?? "-"}`
  ];

  return lines.join("\n");
}

export function formatUsage(data) {
  if (Array.isArray(data)) {
    if (!data.length) {
      return "用量数据：当前时间范围内无记录。";
    }
    const lines = ["用量数据（按天）"];
    for (const item of data.slice(0, 31)) {
      lines.push(`- ${item.date ?? item.day ?? "-"}: ${item.quota ?? item.value ?? 0}`);
    }
    return lines.join("\n");
  }

  if (!data || typeof data !== "object") {
    return "用量数据获取成功。";
  }

  const lines = [
    "用量数据",
    `今日: ${data.today ?? data.today_used ?? data.day ?? "-"}`,
    `本月: ${data.month ?? data.month_used ?? "-"}`,
    `总计: ${data.total ?? data.total_used ?? "-"}`
  ];

  return lines.join("\n");
}

export function formatTokenList(data) {
  const list = findArray(data);
  if (!list.length) {
    return "当前没有可展示的 API Key。";
  }

  const lines = ["API Key 列表（最多展示前 20 条）"];
  for (const item of list.slice(0, 20)) {
    const key = pickApiKey(item) || "-";
    lines.push(
      [
        `- ID: ${item.id ?? "-"}`,
        `名称: ${item.name ?? item.display_name ?? "-"}`,
        `分组: ${item.group || "默认"}`,
        `API Key: ${key}`,
        `剩余额度: ${item.remain_quota ?? item.quota ?? "-"}`,
        `状态: ${tokenStatusText(item.status)}`
      ].join(" | ")
    );
  }
  return lines.join("\n");
}

export function formatTokenDetail(token) {
  if (!token || typeof token !== "object") {
    return "未找到 Key 详情。";
  }
  const key = pickApiKey(token) || "-";
  const lines = [
    "API Key 详情",
    `ID: ${token.id ?? "-"}`,
    `名称: ${token.name ?? "-"}`,
    `分组: ${token.group || "默认"}`,
    `状态: ${tokenStatusText(token.status)}`,
    `API Key: ${key}`,
    `剩余额度: ${token.remain_quota ?? "-"}`,
    `已用额度: ${token.used_quota ?? "-"}`,
    `无限额度: ${token.unlimited_quota ? "是" : "否"}`,
    `到期时间: ${token.expired_time ?? "-"}`
  ];
  if (token.allow_ips) {
    lines.push(`IP 白名单: ${String(token.allow_ips).replace(/\n/g, ", ")}`);
  }
  if (token.model_limits_enabled) {
    lines.push(`模型限制: ${token.model_limits || "-"}`);
  }
  return lines.join("\n");
}

export function formatTokenGroupSummary(data) {
  const list = findArray(data);
  if (!list.length) {
    return "当前没有 API Key，暂无分组可统计。";
  }
  const grouped = new Map();
  for (const item of list) {
    const group = (item?.group && String(item.group).trim()) || "默认";
    const prev = grouped.get(group) || { total: 0, enabled: 0 };
    prev.total += 1;
    if (Number(item?.status) === 1) {
      prev.enabled += 1;
    }
    grouped.set(group, prev);
  }
  const lines = ["API Key 分组统计"];
  for (const [group, stat] of grouped.entries()) {
    lines.push(`- ${group}: 共 ${stat.total} 个，启用 ${stat.enabled} 个`);
  }
  lines.push("可用命令：/keygroup <id> <group>");
  return lines.join("\n");
}

export function formatOperationResult(title, data) {
  if (data === undefined || data === null) {
    return `${title}成功。`;
  }

  if (typeof data === "object" && !Array.isArray(data)) {
    const message = pickStringField(data, ["message", "msg", "detail", "description", "status"]);
    const leaf = data.data;
    if (typeof leaf === "string" && leaf.trim()) {
      return `${title}成功：${leaf.trim()}`;
    }
    if (typeof leaf === "number" || typeof leaf === "boolean") {
      return `${title}成功：${String(leaf)}`;
    }
    if (message && !["success", "ok"].includes(message.toLowerCase())) {
      return `${title}成功：${message}`;
    }
    return `${title}成功。`;
  }

  return `${title}成功：${String(data)}`;
}

export function formatSubscriptionPlans(data) {
  const list = Array.isArray(data) ? data : [];
  if (!list.length) {
    return "当前没有可购买的订阅套餐。";
  }

  const lines = ["可购买套餐（最多展示前 20 个）"];
  list.slice(0, 20).forEach((item) => {
    const plan = item?.plan || item;
    lines.push(
      [
        `- 套餐ID: ${plan?.id ?? "-"}`,
        `名称: ${plan?.title ?? "-"}`,
        `价格: ${plan?.currency || "USD"} ${plan?.price_amount ?? "-"}`,
        `有效期: ${formatPlanDuration(plan)}`,
        `总额度: ${plan?.total_amount ?? "-"}`,
        `升级分组: ${plan?.upgrade_group || "-"}`,
        `状态: ${plan?.enabled ? "可用" : "禁用"}`
      ].join(" | ")
    );
  });
  lines.push("购买示例：/subbuy 3");
  lines.push("购买示例：/subbuy 3 alipay");
  return lines.join("\n");
}

export function formatSubscriptionSelf(data) {
  if (!data || typeof data !== "object") {
    return "我的订阅获取成功。";
  }
  const pref = data.billing_preference || "-";
  const active = Array.isArray(data.subscriptions) ? data.subscriptions : [];
  const all = Array.isArray(data.all_subscriptions) ? data.all_subscriptions : [];
  const lines = [
    "我的订阅",
    `扣费策略: ${pref}`,
    `活跃订阅数: ${active.length}`,
    `全部订阅数: ${all.length}`
  ];

  const pick = active.length ? active : all;
  if (pick.length) {
    lines.push("订阅明细（最多前 10 条）");
    pick.slice(0, 10).forEach((item) => {
      const sub = item?.subscription || item;
      lines.push(
        [
          `- 订阅ID: ${sub?.id ?? "-"}`,
          `套餐ID: ${sub?.plan_id ?? "-"}`,
          `状态: ${sub?.status ?? "-"}`,
          `总额度: ${sub?.amount_total ?? "-"}`,
          `已用: ${sub?.amount_used ?? "-"}`,
          `开始: ${formatEpochSeconds(sub?.start_time)}`,
          `结束: ${formatEpochSeconds(sub?.end_time)}`,
          `升级分组: ${sub?.upgrade_group || "-"}`
        ].join(" | ")
      );
    });
  }
  lines.push("偏好设置：/subpref wallet_first 或 /subpref subscription_first");
  return lines.join("\n");
}

export function truncateText(text, limit = 3500) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n\n...输出过长，已截断`;
}

export function formatApiError(error) {
  const lines = ["请求失败"];
  if (error?.status) {
    lines.push(`HTTP: ${error.status}`);
  }
  if (error?.message) {
    lines.push(`错误: ${error.message}`);
  }
  const payload = error?.payload;
  if (payload && typeof payload === "object") {
    const detail =
      pickStringField(payload, ["message", "msg", "error", "detail", "description"]) ||
      (typeof payload.data === "string" ? payload.data : "");
    if (detail) {
      lines.push(`详情: ${detail}`);
    }
  } else if (payload && typeof payload === "string") {
    lines.push(`详情: ${payload}`);
  }
  return truncateText(lines.join("\n"));
}
