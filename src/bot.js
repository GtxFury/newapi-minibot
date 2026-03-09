import { Markup, Telegraf } from "telegraf";
import {
  formatApiError,
  formatOperationResult,
  formatSubscriptionPlans,
  formatSubscriptionSelf,
  formatTokenDetail,
  formatTokenGroupSummary,
  formatTokenList,
  formatUsage,
  formatUserSelf,
  truncateText
} from "./formatters.js";
import { TelegramRegisterService } from "./telegramRegisterService.js";

function parseArgs(text = "") {
  const firstSpace = text.indexOf(" ");
  if (firstSpace < 0) {
    return [];
  }
  return text
    .slice(firstSpace + 1)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on", "y"].includes(String(value).toLowerCase());
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    return null;
  }
  return n;
}

function parseInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return null;
  }
  return n;
}

function parsePositiveNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

function parseKeyStatusInput(value) {
  const v = String(value || "").trim().toLowerCase();
  if (["1", "enable", "enabled", "on", "true", "启用"].includes(v)) {
    return 1;
  }
  if (["0", "2", "disable", "disabled", "off", "false", "禁用"].includes(v)) {
    return 2;
  }
  return null;
}

function findArray(data, candidates = ["items", "list", "tokens", "rows", "data"]) {
  if (Array.isArray(data)) {
    return data;
  }
  if (!data || typeof data !== "object") {
    return [];
  }
  for (const key of candidates) {
    if (Array.isArray(data[key])) {
      return data[key];
    }
  }
  return [];
}

function extractSubscriptionPlans(data) {
  return findArray(data, ["items", "list", "plans", "data"])
    .map((item) => item?.plan || item)
    .filter((item) => item && typeof item === "object");
}

function shortenLabel(input, max = 12) {
  const text = String(input || "").trim();
  if (!text) {
    return "-";
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function encodeCallbackPart(value) {
  return encodeURIComponent(String(value ?? ""));
}

function decodeCallbackPart(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

function sanitizeMethodValue(value) {
  return String(value || "").trim();
}

function normalizeApiKeyValue(value) {
  const key = String(value || "").trim();
  if (!key) {
    return "";
  }
  return key.startsWith("sk-") ? key : `sk-${key}`;
}

function extractApiKeyFromUnknown(input) {
  if (!input) {
    return "";
  }
  if (typeof input === "string") {
    return normalizeApiKeyValue(input);
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const key = extractApiKeyFromUnknown(item);
      if (key) {
        return key;
      }
    }
    return "";
  }
  if (typeof input !== "object") {
    return "";
  }

  const direct =
    normalizeApiKeyValue(input.key) ||
    normalizeApiKeyValue(input.token) ||
    normalizeApiKeyValue(input.api_key) ||
    normalizeApiKeyValue(input.access_token) ||
    normalizeApiKeyValue(input.value);
  if (direct) {
    return direct;
  }

  return (
    extractApiKeyFromUnknown(input.data) ||
    extractApiKeyFromUnknown(input.token_data) ||
    extractApiKeyFromUnknown(input.result)
  );
}

function extractPaymentMethods(data) {
  const methods = new Set();
  const blocked = new Set(["stripe", "creem"]);
  const add = (value) => {
    const normalized = sanitizeMethodValue(value);
    if (!normalized) {
      return;
    }
    if (blocked.has(normalized.toLowerCase())) {
      return;
    }
    methods.add(normalized);
  };
  const readList = (list) => {
    if (!Array.isArray(list)) {
      return;
    }
    for (const item of list) {
      if (typeof item === "string") {
        add(item);
        continue;
      }
      if (item && typeof item === "object") {
        if (item.enabled === false || item.available === false || item.status === false) {
          continue;
        }
        // NewAPI 支付方式核心字段是 type；name 只是展示文案。
        add(item.method || item.type || item.code || item.value || item.id || item.name);
      }
    }
  };

  // NewAPI 的 /api/user/topup/info 核心字段是 pay_methods（易支付方式）。
  readList(data?.pay_methods);
  readList(data?.payment_methods);
  readList(data?.paymentMethods);
  readList(data?.methods);

  if (!methods.size) {
    methods.add("alipay");
    methods.add("wxpay");
  }

  return [...methods].slice(0, 12);
}

function paymentMethodLabel(method) {
  const m = sanitizeMethodValue(method);
  const mk = m.toLowerCase();
  const map = {
    alipay: "支付宝",
    wxpay: "微信支付",
    wechat: "微信支付",
    wechatpay: "微信支付",
    qqpay: "QQ支付",
    usdt: "USDT"
  };
  const text = map[mk] || m;
  return `${text} (${m})`;
}

function normalizeSubPreference(input) {
  const raw = String(input || "").trim().toLowerCase();
  const map = {
    subscription_first: "subscription_first",
    wallet_first: "wallet_first",
    subscription_only: "subscription_only",
    wallet_only: "wallet_only",
    "优先订阅": "subscription_first",
    "优先钱包": "wallet_first",
    "仅订阅": "subscription_only",
    "仅钱包": "wallet_only"
  };
  return map[raw] || map[String(input || "").trim()] || "";
}

async function safeReply(ctx, text) {
  const message = truncateText(text);
  return ctx.reply(message);
}

async function safeReplyWithMarkup(ctx, text, markup) {
  const message = truncateText(text);
  return ctx.reply(message, markup);
}

function formatTopupRecords(page) {
  const items = Array.isArray(page?.items) ? page.items : [];
  if (!items.length) {
    return "暂无充值记录。";
  }

  const lines = ["最近充值记录（最多 20 条）"];
  for (const item of items.slice(0, 20)) {
    lines.push(
      `- 订单: ${item.trade_no ?? "-"} | 金额: ${item.amount ?? "-"} | 支付: ${item.payment_method ?? "-"} | 状态: ${item.status ?? "-"}`
    );
  }
  return lines.join("\n");
}

function getPaymentUrl(data) {
  const direct =
    String(data?.data?.pay_link || "").trim() ||
    String(data?.data?.checkout_url || "").trim();
  if (direct) {
    return direct;
  }

  const base = String(data?.url || "").trim();
  if (!base) {
    return "";
  }

  const paramsObj = data?.data;
  if (!paramsObj || typeof paramsObj !== "object" || Array.isArray(paramsObj)) {
    return base;
  }

  // 易支付返回的是网关地址 + 参数对象（前端通常用 form 自动提交）。
  // 这里构造完整可点击 URL，便于 Telegram 用户直接拉起支付。
  const entries = Object.entries(paramsObj).filter(([, v]) => {
    return ["string", "number", "boolean"].includes(typeof v);
  });
  if (!entries.length) {
    return base;
  }

  try {
    const url = new URL(base);
    for (const [k, v] of entries) {
      url.searchParams.set(k, String(v));
    }
    return url.toString();
  } catch {
    const query = entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (!query) {
      return base;
    }
    return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
  }
}

function getPaymentOrderId(data) {
  const id = data?.data?.order_id ?? data?.data?.out_trade_no ?? data?.out_trade_no ?? "";
  return String(id || "").trim();
}

async function replyPaymentResult(ctx, title, data) {
  const lines = [title];
  if (data?.message) {
    lines.push(`状态: ${data.message}`);
  }
  const payUrl = getPaymentUrl(data);
  const orderId = getPaymentOrderId(data);
  if (payUrl) {
    lines.push(`支付链接: ${payUrl}`);
  }
  if (orderId) {
    lines.push(`订单号: ${orderId}`);
  }

  if (payUrl) {
    return safeReplyWithMarkup(
      ctx,
      lines.join("\n"),
      Markup.inlineKeyboard([[Markup.button.url("去支付", payUrl)]])
    );
  }
  return safeReply(ctx, lines.join("\n"));
}

function formatTopupInfoSummary(info) {
  const methods = extractPaymentMethods(info);
  const lines = [
    "充值配置",
    `可用支付方式: ${methods.join("、") || "-"}`,
    `最低充值: ${info?.min_topup ?? "-"}`
  ];
  if (Array.isArray(info?.amount_options) && info.amount_options.length) {
    lines.push(`快捷金额: ${info.amount_options.join(" / ")}`);
  }
  const discount = info?.discount;
  if (discount && typeof discount === "object" && Object.keys(discount).length) {
    const pairs = Object.entries(discount)
      .slice(0, 8)
      .map(([k, v]) => `${k}=>${v}`);
    lines.push(`优惠档位: ${pairs.join("，")}`);
  }
  return lines.join("\n");
}

export function createBot({ config, store, apiClient }) {
  const bot = new Telegraf(config.botToken);
  const registerService = new TelegramRegisterService({
    baseUrl: config.baseUrl,
    botToken: config.botToken,
    adminToken: config.registerAdminToken,
    adminUserId: config.registerAdminUserId,
    usernamePrefix: config.registerUsernamePrefix,
    passwordSecret: config.registerPasswordSecret
  });
  const oneClickRegisterEnabled = config.enableOneClickRegister && registerService.canLoginByTelegram;
  const oneClickRegisterLocks = new Set();
  const miniAppUrl = String(config.miniAppUrl || "").trim();
  const localMiniAppDebugUrl = (() => {
    if (!config.miniAppEnabled) {
      return "";
    }
    const host = String(config.miniAppHost || "").trim();
    const port = parsePositiveInt(config.miniAppPort);
    if (!host || !port) {
      return "";
    }
    const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    return `http://${displayHost}:${port}/miniapp/`;
  })();

  function resolveAuth(ctx) {
    const telegramUserId = String(ctx.from?.id || "");
    if (!telegramUserId) {
      return null;
    }

    const own = store.getAuth(telegramUserId);
    if (own?.token) {
      return {
        token: own.token,
        userId: own.userId ?? config.defaultNewapiUserId ?? null
      };
    }

    if (config.defaultNewapiToken) {
      return {
        token: config.defaultNewapiToken,
        userId: config.defaultNewapiUserId ?? null
      };
    }

    return null;
  }

  function ensureAuth(ctx) {
    const auth = resolveAuth(ctx);
    if (!auth?.token) {
      throw new Error(
        config.allowRuntimeTokenBind
          ? "你还没有绑定凭证。请先执行 /settoken <access_token> <newapi_user_id>"
          : "当前未配置 DEFAULT_NEWAPI_TOKEN，且已禁用运行时绑定。"
      );
    }

    const uid = parsePositiveInt(auth.userId);
    if (!uid) {
      throw new Error("缺少 NewAPI 用户 ID。请执行 /settoken <access_token> <newapi_user_id>，或在 .env 设置 DEFAULT_NEWAPI_USER_ID。");
    }

    return {
      token: auth.token,
      userId: uid
    };
  }

  function menuKeyboard() {
    const rows = [];
    if (config.miniAppEnabled) {
      if (miniAppUrl) {
        rows.push([Markup.button.webApp("📱 Mini App", miniAppUrl)]);
      } else {
        rows.push([Markup.button.callback("📱 Mini App", "menu_miniapp")]);
      }
    }
    if (oneClickRegisterEnabled) {
      rows.push([Markup.button.callback("🆕 一键注册", "menu_register")]);
    }
    rows.push([Markup.button.callback("📦 订阅套餐", "menu_sub_plans"), Markup.button.callback("🧾 我的订阅", "menu_sub_self")]);
    rows.push([Markup.button.callback("👤 我的账户", "menu_me"), Markup.button.callback("📊 使用用量", "menu_usage")]);
    rows.push([Markup.button.callback("🔑 API Keys", "menu_keys"), Markup.button.callback("💳 充值中心", "menu_topup_help")]);
    rows.push([Markup.button.callback("🎟 兑换码", "menu_redeem_help"), Markup.button.callback("❓ 帮助", "menu_help")]);
    return Markup.inlineKeyboard(rows);
  }

  function miniAppKeyboard() {
    if (!miniAppUrl) {
      return null;
    }
    return Markup.inlineKeyboard([[Markup.button.webApp("📱 打开 Mini App", miniAppUrl)]]);
  }

  function subPreferenceKeyboard() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback("⚙ 优先订阅", "sub_pref:subscription_first"),
        Markup.button.callback("💼 优先钱包", "sub_pref:wallet_first")
      ],
      [
        Markup.button.callback("📦 仅订阅", "sub_pref:subscription_only"),
        Markup.button.callback("👛 仅钱包", "sub_pref:wallet_only")
      ],
      [Markup.button.callback("📦 返回套餐", "menu_sub_plans")]
    ]);
  }

  function subPlansKeyboard(plans) {
    const rows = [];
    for (const plan of plans.slice(0, 10)) {
      const planId = parsePositiveInt(plan?.id);
      if (!planId) {
        continue;
      }
      const title = shortenLabel(plan?.title || `套餐${planId}`, 14);
      rows.push([Markup.button.callback(`购买 ${title} #${planId}`, `sub_pick:${planId}`)]);
    }
    rows.push([
      Markup.button.callback("🧾 我的订阅", "menu_sub_self"),
      Markup.button.callback("🔄 刷新套餐", "menu_sub_plans")
    ]);
    rows.push([Markup.button.callback("⚙ 扣费策略", "sub_pref_menu")]);
    return Markup.inlineKeyboard(rows);
  }

  function subPayMethodsKeyboard(planId, methods) {
    const rows = [];
    for (const method of methods.slice(0, 8)) {
      const encodedMethod = encodeCallbackPart(method);
      rows.push([Markup.button.callback(paymentMethodLabel(method), `sub_buy_method:${planId}:${encodedMethod}`)]);
    }
    rows.push([Markup.button.callback("📦 返回套餐", "menu_sub_plans")]);
    return Markup.inlineKeyboard(rows);
  }

  function topupCenterKeyboard() {
    const quickAmounts = [5, 10, 20, 30, 50, 100];
    const rows = [];
    for (let i = 0; i < quickAmounts.length; i += 2) {
      const left = quickAmounts[i];
      const right = quickAmounts[i + 1];
      const row = [Markup.button.callback(`￥${left}`, `pay_amount:${left}`)];
      if (right !== undefined) {
        row.push(Markup.button.callback(`￥${right}`, `pay_amount:${right}`));
      }
      rows.push(row);
    }
    rows.push([
      Markup.button.callback("📋 支付方式配置", "menu_topup_methods"),
      Markup.button.callback("📜 充值记录", "menu_topup_records")
    ]);
    return Markup.inlineKeyboard(rows);
  }

  function topupMethodKeyboard(amount, methods) {
    const amountStr = String(amount);
    const rows = [];
    for (const method of methods.slice(0, 10)) {
      const encodedMethod = encodeCallbackPart(method);
      rows.push([Markup.button.callback(paymentMethodLabel(method), `pay_submit:${amountStr}:${encodedMethod}`)]);
    }
    rows.push([
      Markup.button.callback("↩ 重新选金额", "menu_topup_help"),
      Markup.button.callback("📋 查看方式", "menu_topup_methods")
    ]);
    return Markup.inlineKeyboard(rows);
  }

  function tokenManageKeyboard(data) {
    const tokens = findArray(data, ["items", "list", "tokens", "rows", "data"]);
    const rows = [
      [
        Markup.button.callback("➕ 快速创建Key", "key_new_quick"),
        Markup.button.callback("🔄 刷新列表", "menu_keys")
      ],
      [Markup.button.callback("🏷 分组统计", "key_groups")]
    ];
    for (const item of tokens.slice(0, 8)) {
      const id = item?.id;
      if (id === undefined || id === null || String(id).length === 0) {
        continue;
      }
      const encodedId = encodeCallbackPart(id);
      const name = shortenLabel(item?.name || item?.display_name || `ID:${id}`, 14);
      rows.push([Markup.button.callback(`🗑 删除 ${name}`, `key_del_ask:${encodedId}`)]);
    }
    return Markup.inlineKeyboard(rows);
  }

  async function runWithAuth(ctx, action) {
    try {
      const auth = ensureAuth(ctx);
      await action(auth);
    } catch (error) {
      await safeReply(ctx, error?.message || String(error));
    }
  }

  async function resolveCreatedApiKey(auth, createdData, expectedName = "") {
    let key = extractApiKeyFromUnknown(createdData);
    let tokenId = createdData?.id ?? createdData?.token_id ?? createdData?.data?.id ?? null;
    let tokenName = createdData?.name || createdData?.data?.name || expectedName || "";

    if (!key || !tokenId) {
      try {
        const listData = await apiClient.listTokens(auth);
        const list = findArray(listData, ["items", "list", "tokens", "rows", "data"]);
        const expected = String(expectedName || "").trim();
        let matched = null;
        if (expected) {
          matched = list.find((item) => String(item?.name || "").trim() === expected) || null;
        }
        if (!matched) {
          matched = list[0] || null;
        }
        if (matched) {
          key = key || extractApiKeyFromUnknown(matched);
          tokenId = tokenId ?? matched.id ?? null;
          tokenName = tokenName || matched.name || "";
        }
      } catch {
        // ignore list fallback error, keep current best effort result
      }
    }

    if (!key && tokenId !== null && tokenId !== undefined && String(tokenId).trim() !== "") {
      try {
        const tokenData = await apiClient.getTokenById(auth, tokenId);
        key = extractApiKeyFromUnknown(tokenData);
        tokenName = tokenName || tokenData?.name || "";
      } catch {
        // ignore token detail fallback error
      }
    }

    return {
      key,
      tokenId,
      tokenName: tokenName || expectedName || "-"
    };
  }

  function buildTokenUpdatePayload(token, tokenId) {
    return {
      id: parsePositiveInt(token?.id) || parsePositiveInt(tokenId) || Number(tokenId),
      name: String(token?.name || ""),
      status: Number(token?.status ?? 1),
      expired_time: Number(token?.expired_time ?? -1),
      remain_quota: Number(token?.remain_quota ?? 0),
      unlimited_quota: Boolean(token?.unlimited_quota),
      model_limits_enabled: Boolean(token?.model_limits_enabled),
      model_limits: typeof token?.model_limits === "string" ? token.model_limits : "",
      allow_ips: token?.allow_ips ?? "",
      group: token?.group ?? "",
      cross_group_retry: Boolean(token?.cross_group_retry)
    };
  }

  async function updateTokenWithPatch(ctx, tokenIdArg, patcher, options = {}) {
    const tokenId = parsePositiveInt(tokenIdArg);
    if (!tokenId) {
      await safeReply(ctx, "无效的 Key ID。");
      return;
    }
    const { statusOnly = false, successTitle = "更新 API Key" } = options;
    await runWithAuth(ctx, async (auth) => {
      try {
        const current = await apiClient.getTokenById(auth, tokenId);
        const payload = buildTokenUpdatePayload(current, tokenId);
        await patcher(payload, current);
        const data = await apiClient.updateToken(auth, payload, { statusOnly });
        await safeReply(ctx, `${successTitle}成功。\n\n${formatTokenDetail(data)}`);
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  }

  async function handleMe(ctx) {
    await runWithAuth(ctx, async (auth) => {
      const data = await apiClient.getUserSelf(auth);
      await safeReply(ctx, formatUserSelf(data));
    });
  }

  async function handleUsage(ctx) {
    const args = parseArgs(ctx.message?.text);
    const daysArg = args[0] ? Number(args[0]) : 30;
    const days = Number.isFinite(daysArg) ? Math.min(Math.max(daysArg, 1), 30) : 30;
    const end = Math.floor(Date.now() / 1000);
    const start = end - days * 24 * 3600;

    await runWithAuth(ctx, async (auth) => {
      const data = await apiClient.getDataSelf(auth, {
        startTimestamp: start,
        endTimestamp: end
      });
      await safeReply(ctx, `${formatUsage(data)}\n\n时间范围：最近 ${days} 天`);
    });
  }

  async function handleKeys(ctx) {
    await runWithAuth(ctx, async (auth) => {
      const data = await apiClient.listTokens(auth);
      await safeReplyWithMarkup(ctx, formatTokenList(data), tokenManageKeyboard(data));
    });
  }

  async function handleSubPlans(ctx) {
    await runWithAuth(ctx, async (auth) => {
      const data = await apiClient.getSubscriptionPlans(auth);
      const plans = extractSubscriptionPlans(data);
      await safeReplyWithMarkup(ctx, formatSubscriptionPlans(data), subPlansKeyboard(plans));
    });
  }

  async function handleSubSelf(ctx) {
    await runWithAuth(ctx, async (auth) => {
      const data = await apiClient.getSubscriptionSelf(auth);
      await safeReplyWithMarkup(ctx, formatSubscriptionSelf(data), subPreferenceKeyboard());
    });
  }

  async function handleSubPref(ctx, preference) {
    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.updateSubscriptionPreference(auth, preference);
        await safeReply(ctx, formatOperationResult("更新扣费策略", data));
        const subData = await apiClient.getSubscriptionSelf(auth);
        await safeReplyWithMarkup(ctx, formatSubscriptionSelf(subData), subPreferenceKeyboard());
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  }

  async function fetchTopupMethods(auth) {
    try {
      const info = await apiClient.getTopupInfo(auth);
      return {
        info,
        methods: extractPaymentMethods(info)
      };
    } catch {
      return {
        info: null,
        methods: extractPaymentMethods(null)
      };
    }
  }

  async function handleShowTopupCenter(ctx) {
    await safeReplyWithMarkup(
      ctx,
      "充值中心（默认易支付）\n1) 先选择金额\n2) 再点击系统支付方式即可下单\n\n也可命令：/pay <amount>（弹支付方式菜单）",
      topupCenterKeyboard()
    );
  }

  async function handleChoosePayMethod(ctx, amount) {
    const parsedAmount = parsePositiveNumber(amount);
    if (!parsedAmount) {
      await safeReply(ctx, "金额无效，请输入大于 0 的数字。");
      return;
    }
    await runWithAuth(ctx, async (auth) => {
      const { methods } = await fetchTopupMethods(auth);
      await safeReplyWithMarkup(
        ctx,
        `充值金额: ${parsedAmount}\n请选择支付方式：`,
        topupMethodKeyboard(parsedAmount, methods)
      );
    });
  }

  async function handleCreatePayment(ctx, amount, paymentMethod) {
    const parsedAmount = parsePositiveNumber(amount);
    const method = sanitizeMethodValue(paymentMethod);
    if (!parsedAmount || !method) {
      await safeReply(ctx, "支付参数无效。");
      return;
    }
    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.createPayment(auth, {
          amount: parsedAmount,
          payment_method: method
        });
        await replyPaymentResult(ctx, "支付请求结果", data);
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  }

  async function handleOneClickRegister(ctx) {
    if (!oneClickRegisterEnabled) {
      await safeReply(ctx, "一键注册功能未启用，请联系管理员配置 ENABLE_ONE_CLICK_REGISTER。");
      return;
    }

    const tgUserId = String(ctx.from?.id || "");
    if (!tgUserId) {
      await safeReply(ctx, "无法识别 Telegram 用户信息，请重试。");
      return;
    }

    if (oneClickRegisterLocks.has(tgUserId)) {
      await safeReply(ctx, "你已有一个注册流程正在处理中，请稍候。");
      return;
    }

    oneClickRegisterLocks.add(tgUserId);
    await safeReply(ctx, "正在为你执行一键注册与验证，通常需要 3~10 秒...");

    try {
      const result = await registerService.registerOrLoginByTelegram(ctx.from);
      const userId = parsePositiveInt(result?.user?.id);
      const token = result?.accessToken ? String(result.accessToken) : "";

      if (token && userId) {
        await store.setAuth(ctx.from.id, { token, userId });
      }

      const lines = [];
      if (result.alreadyRegistered) {
        lines.push("检测到你已经注册并绑定过 Telegram，已完成自动登录验证。");
      } else {
        lines.push("注册并绑定 Telegram 成功。");
      }
      lines.push(`用户名: ${result?.user?.username || result?.username || "-"}`);
      lines.push(`用户ID: ${result?.user?.id ?? "-"}`);
      if (token && userId) {
        lines.push("已自动签发并写入 access token，可直接使用 /me /keys /pay。");
      } else {
        lines.push("流程成功，但未拿到 access token。你仍可用 /settoken 作为备用绑定方式。");
      }
      await safeReply(ctx, lines.join("\n"));
    } catch (error) {
      const msg = String(error?.message || error || "注册失败");
      let extra = "";
      if (msg.includes("Turnstile")) {
        extra = "\n提示：当前站点开启了 Turnstile，机器人无法完成 /api/user/login。可临时关闭 Turnstile 或增加后端专用注册接口。";
      }
      await safeReply(ctx, `一键注册失败：${msg}${extra}`);
    } finally {
      oneClickRegisterLocks.delete(tgUserId);
    }
  }

  bot.start(async (ctx) => {
    await safeReply(ctx, "欢迎使用BilAPI，点击左下角的用户面板开始使用。");
    await ctx.reply("请选择操作：", menuKeyboard());
  });

  bot.command("menu", async (ctx) => {
    await ctx.reply("请选择操作：", menuKeyboard());
  });

  bot.command("help", async (ctx) => {
    await safeReply(ctx, "欢迎使用BilAPI，点击左下角的用户面板开始使用。");
  });

  bot.command("miniapp", async (ctx) => {
    if (!config.miniAppEnabled) {
      await safeReply(ctx, "Mini App 未启用，请联系管理员开启 MINIAPP_ENABLED。");
      return;
    }
    if (!miniAppUrl) {
      const lines = ["Mini App 地址未配置，请设置 MINIAPP_URL（公网 HTTPS 地址）。"];
      if (localMiniAppDebugUrl) {
        lines.push(`本地调试地址：${localMiniAppDebugUrl}`);
      }
      await safeReply(ctx, lines.join("\n"));
      return;
    }
    const text = [
      "点击按钮打开 Mini App：",
      miniAppUrl,
      "",
      "如需在 Telegram 内嵌打开，请在 BotFather 菜单按钮中配置同一 URL。"
    ].join("\n");
    await safeReplyWithMarkup(ctx, text, miniAppKeyboard());
  });

  bot.command("settoken", async (ctx) => {
    if (!config.allowRuntimeTokenBind) {
      await safeReply(ctx, "当前已禁用运行时绑定 Token。请联系管理员配置 DEFAULT_NEWAPI_TOKEN。");
      return;
    }

    const args = parseArgs(ctx.message?.text);
    const [token, userIdArg] = args;
    if (!token) {
      await safeReply(ctx, "用法：/settoken <newapi_access_token> <newapi_user_id>");
      return;
    }

    const userId = userIdArg ? parsePositiveInt(userIdArg) : config.defaultNewapiUserId;
    if (!userId) {
      await safeReply(ctx, "缺少 newapi_user_id。用法：/settoken <newapi_access_token> <newapi_user_id>");
      return;
    }

    await store.setAuth(ctx.from.id, { token, userId });
    await safeReply(ctx, "凭证已保存。你现在可以使用 /me /usage /keys /pay 等命令。\n请注意：凭证会保存在本机文件中，请确保服务器安全。");
  });

  bot.command("cleartoken", async (ctx) => {
    await store.clearAuth(ctx.from.id);
    await safeReply(ctx, "你的个人凭证已清除。");
  });

  bot.command("register", async (ctx) => {
    if (!oneClickRegisterEnabled) {
      await safeReply(ctx, "一键注册功能未启用，请联系管理员。");
      return;
    }
    await safeReply(ctx, "点击下方按钮，一次完成 Telegram 验证、账号注册与绑定：");
    await ctx.reply(
      "开始注册",
      Markup.inlineKeyboard([[Markup.button.callback("✅ 一键注册", "register_one_click")]])
    );
  });

  bot.command("me", async (ctx) => {
    await handleMe(ctx);
  });

  bot.command("usage", async (ctx) => {
    await handleUsage(ctx);
  });

  bot.command("subplans", async (ctx) => {
    await handleSubPlans(ctx);
  });

  bot.command("mysub", async (ctx) => {
    await handleSubSelf(ctx);
  });

  bot.command("subpref", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const preference = normalizeSubPreference(args[0]);
    const allowed = new Set(["subscription_first", "wallet_first", "subscription_only", "wallet_only"]);
    if (!allowed.has(preference)) {
      await safeReply(
        ctx,
        "用法：/subpref <subscription_first|wallet_first|subscription_only|wallet_only>\n中文别名：优先订阅/优先钱包/仅订阅/仅钱包\n示例：/subpref 优先钱包"
      );
      return;
    }
    await handleSubPref(ctx, preference);
  });

  bot.command("subbuy", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const [planIdArg, methodArg, legacyMethodArg] = args;
    const planId = parsePositiveInt(planIdArg);
    const provider = String(methodArg || "").toLowerCase();

    if (!planId) {
      await safeReply(
        ctx,
        "用法：/subbuy <plan_id> [payment_method]\n示例：/subbuy 3\n示例：/subbuy 3 alipay"
      );
      return;
    }

    if (!methodArg || ["epay", "stripe", "creem"].includes(provider)) {
      await runWithAuth(ctx, async (auth) => {
        const { methods } = await fetchTopupMethods(auth);
        await safeReplyWithMarkup(
          ctx,
          `套餐 #${planId} 默认走易支付，请选择支付方式：`,
          subPayMethodsKeyboard(planId, methods)
        );
      });
      if (provider === "stripe" || provider === "creem") {
        await safeReply(ctx, "当前已禁用 stripe/creem 渠道，统一使用易支付。");
      }
      return;
    }

    const paymentMethod = provider === "epay" ? legacyMethodArg : methodArg;
    if (!paymentMethod) {
      await safeReply(ctx, "缺少支付方式。示例：/subbuy 3 alipay");
      return;
    }

    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.createSubscriptionEpay(auth, {
          planId,
          paymentMethod: sanitizeMethodValue(paymentMethod)
        });
        await replyPaymentResult(ctx, "套餐购买请求结果", data);
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.command("keys", async (ctx) => {
    await handleKeys(ctx);
  });

  bot.command("keygroups", async (ctx) => {
    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.listTokens(auth);
        await safeReply(ctx, formatTokenGroupSummary(data));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.command("keydetail", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const id = args[0];
    if (!id) {
      await safeReply(ctx, "用法：/keydetail <id>");
      return;
    }
    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.getTokenById(auth, id);
        await safeReply(ctx, formatTokenDetail(data));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.command("keygroup", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const id = args[0];
    const groupInput = args.slice(1).join(" ").trim();
    if (!id || !groupInput) {
      await safeReply(ctx, "用法：/keygroup <id> <group>\n示例：/keygroup 12 svip\n清空分组：/keygroup 12 -");
      return;
    }
    const group = ["-", "default", "默认", "clear", "none"].includes(groupInput.toLowerCase()) ? "" : groupInput;
    await updateTokenWithPatch(
      ctx,
      id,
      async (payload) => {
        payload.group = group;
      },
      { successTitle: "更新 Key 分组" }
    );
  });

  bot.command("keyrename", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const id = args[0];
    const name = args.slice(1).join(" ").trim();
    if (!id || !name) {
      await safeReply(ctx, "用法：/keyrename <id> <name>\n示例：/keyrename 12 prod-key");
      return;
    }
    await updateTokenWithPatch(
      ctx,
      id,
      async (payload) => {
        payload.name = name;
      },
      { successTitle: "更新 Key 名称" }
    );
  });

  bot.command("keystatus", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const [id, statusArg] = args;
    const status = parseKeyStatusInput(statusArg);
    if (!id || status === null) {
      await safeReply(ctx, "用法：/keystatus <id> <enable|disable>\n示例：/keystatus 12 disable");
      return;
    }
    await updateTokenWithPatch(
      ctx,
      id,
      async (payload) => {
        payload.status = status;
      },
      { statusOnly: true, successTitle: "更新 Key 状态" }
    );
  });

  bot.command("keyquota", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const [id, quotaArg] = args;
    if (!id || !quotaArg) {
      await safeReply(ctx, "用法：/keyquota <id> <quota|unlimited>\n示例：/keyquota 12 500000\n示例：/keyquota 12 unlimited");
      return;
    }
    await updateTokenWithPatch(
      ctx,
      id,
      async (payload) => {
        const flag = String(quotaArg).toLowerCase();
        if (["unlimited", "inf", "无限", "不限"].includes(flag)) {
          payload.unlimited_quota = true;
          return;
        }
        const quota = parseInteger(quotaArg);
        if (quota === null || quota < 0) {
          throw new Error("额度必须是 >=0 的整数，或 unlimited。");
        }
        payload.unlimited_quota = false;
        payload.remain_quota = quota;
      },
      { successTitle: "更新 Key 额度" }
    );
  });

  bot.command("keyexpire", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const [id, expireArg] = args;
    const expiredTime = parseInteger(expireArg);
    if (!id || expiredTime === null) {
      await safeReply(ctx, "用法：/keyexpire <id> <unix|-1>\n示例：/keyexpire 12 1767225600\n示例：/keyexpire 12 -1");
      return;
    }
    if (!(expiredTime === -1 || expiredTime > 0)) {
      await safeReply(ctx, "到期时间必须是 -1（永不过期）或大于 0 的 Unix 秒时间戳。");
      return;
    }
    await updateTokenWithPatch(
      ctx,
      id,
      async (payload) => {
        payload.expired_time = expiredTime;
      },
      { successTitle: "更新 Key 到期时间" }
    );
  });

  bot.command("keyips", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const [id, ipsArg] = args;
    if (!id || !ipsArg) {
      await safeReply(ctx, "用法：/keyips <id> <ip1,ip2|clear>\n示例：/keyips 12 1.1.1.1,2.2.2.2");
      return;
    }
    await updateTokenWithPatch(
      ctx,
      id,
      async (payload) => {
        const raw = String(ipsArg).trim();
        if (["clear", "-", "none", "空"].includes(raw.toLowerCase())) {
          payload.allow_ips = "";
          return;
        }
        const ips = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (!ips.length) {
          throw new Error("IP 列表不能为空。");
        }
        payload.allow_ips = ips.join("\n");
      },
      { successTitle: "更新 Key IP 白名单" }
    );
  });

  bot.command("keymodels", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const [id, modelsArg] = args;
    if (!id || !modelsArg) {
      await safeReply(ctx, "用法：/keymodels <id> <off|model1,model2>\n示例：/keymodels 12 gpt-4o,gpt-4.1-mini");
      return;
    }
    await updateTokenWithPatch(
      ctx,
      id,
      async (payload) => {
        const raw = String(modelsArg).trim();
        if (["off", "disable", "clear", "-", "none"].includes(raw.toLowerCase())) {
          payload.model_limits_enabled = false;
          payload.model_limits = "";
          return;
        }
        const models = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (!models.length) {
          throw new Error("模型列表不能为空。");
        }
        payload.model_limits_enabled = true;
        payload.model_limits = models.join(",");
      },
      { successTitle: "更新 Key 模型限制" }
    );
  });

  bot.command("newkey", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const [name, quotaArg, expiredArg, unlimitedArg] = args;

    if (!name) {
      await safeReply(ctx, "用法：/newkey <name> [quota] [expired_unix] [unlimited]\n示例：/newkey dev-key 1000000 1767225600 false");
      return;
    }

    const payload = { name };
    if (quotaArg !== undefined) {
      payload.remain_quota = Number(quotaArg);
    }
    if (expiredArg !== undefined) {
      payload.expired_time = Number(expiredArg);
    }
    if (unlimitedArg !== undefined) {
      payload.unlimited_quota = parseBoolean(unlimitedArg, false);
    }

    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.createToken(auth, payload);
        const created = await resolveCreatedApiKey(auth, data, name);
        const lines = [
          "创建 API Key 成功",
          `名称: ${created.tokenName}`,
          `ID: ${created.tokenId ?? "-"}`
        ];
        if (created.key) {
          lines.push(`API Key: ${created.key}`);
        } else {
          lines.push("API Key: 后端未返回明文 key，请执行 /keys 查看。");
        }
        lines.push("安全提示：请妥善保管，不要在群聊泄露。");
        await safeReply(ctx, lines.join("\n"));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.command("delkey", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const id = args[0];
    if (!id) {
      await safeReply(ctx, "用法：/delkey <id>");
      return;
    }

    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.deleteToken(auth, id);
        await safeReply(ctx, formatOperationResult("删除 API Key", data));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.command("showkey", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const id = args[0];
    if (!id) {
      await safeReply(ctx, "用法：/showkey <id>");
      return;
    }

    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.getTokenById(auth, id);
        const key = extractApiKeyFromUnknown(data);
        const lines = [
          "API Key 明细",
          `ID: ${data?.id ?? id}`,
          `名称: ${data?.name ?? "-"}`
        ];
        if (key) {
          lines.push(`API Key: ${key}`);
        } else {
          lines.push("API Key: 当前接口未返回明文。");
        }
        await safeReply(ctx, lines.join("\n"));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.command("redeem", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const code = args[0];
    if (!code) {
      await safeReply(ctx, "用法：/redeem <code>");
      return;
    }

    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.redeemCode(auth, code);
        await safeReply(ctx, formatOperationResult("兑换", data));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.command("topupinfo", async (ctx) => {
    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.getTopupInfo(auth);
        await safeReply(ctx, formatTopupInfoSummary(data));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.command("amount", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const amount = Number(args[0]);
    if (!Number.isFinite(amount) || amount <= 0) {
      await safeReply(ctx, "用法：/amount <amount>\n示例：/amount 10");
      return;
    }

    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.getPayAmount(auth, amount);
        const payMoney =
          data?.data ??
          data?.amount ??
          data?.pay_amount ??
          data?.money ??
          data?.price ??
          "-";
        await safeReply(ctx, `金额试算\n充值数量: ${amount}\n预计支付: ${payMoney}`);
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.command("pay", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    const [amountArg, paymentMethod] = args;
    const amount = parsePositiveNumber(amountArg);
    if (!amount) {
      await safeReplyWithMarkup(ctx, "用法：/pay <amount> [payment_method]\n示例：/pay 10\n示例：/pay 10 alipay", topupCenterKeyboard());
      return;
    }

    if (!paymentMethod) {
      await handleChoosePayMethod(ctx, amount);
      return;
    }

    await handleCreatePayment(ctx, amount, paymentMethod);
  });

  // 兼容旧命令：/topup => /pay
  bot.command("topup", async (ctx) => {
    const args = parseArgs(ctx.message?.text);
    if (!args.length) {
      await safeReplyWithMarkup(
        ctx,
        "当前版本 /topup 为支付下单别名。\n用法：/topup <amount> [payment_method]\n示例：/topup 10\n示例：/topup 10 alipay\n兑换码请使用 /redeem <code>",
        topupCenterKeyboard()
      );
      return;
    }
    const [amountArg, paymentMethod] = args;
    const amount = parsePositiveNumber(amountArg);
    if (!amount) {
      await safeReply(ctx, "amount 必须是大于 0 的数字。示例：/topup 10 alipay");
      return;
    }

    if (!paymentMethod) {
      await handleChoosePayMethod(ctx, amount);
      return;
    }

    await handleCreatePayment(ctx, amount, paymentMethod);
  });

  bot.command("mytopups", async (ctx) => {
    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.listMyTopups(auth);
        await safeReply(ctx, formatTopupRecords(data));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.action("menu_me", async (ctx) => {
    await ctx.answerCbQuery();
    await handleMe(ctx);
  });

  bot.action("menu_usage", async (ctx) => {
    await ctx.answerCbQuery();
    await handleUsage(ctx);
  });

  bot.action("menu_keys", async (ctx) => {
    await ctx.answerCbQuery();
    await handleKeys(ctx);
  });

  bot.action("menu_sub_plans", async (ctx) => {
    await ctx.answerCbQuery();
    await handleSubPlans(ctx);
  });

  bot.action("menu_sub_self", async (ctx) => {
    await ctx.answerCbQuery();
    await handleSubSelf(ctx);
  });

  bot.action("sub_pref_menu", async (ctx) => {
    await ctx.answerCbQuery();
    await safeReplyWithMarkup(
      ctx,
      "请选择扣费策略：\n- subscription_first（优先订阅）\n- wallet_first（优先钱包）\n- subscription_only（仅订阅）\n- wallet_only（仅钱包）",
      subPreferenceKeyboard()
    );
  });

  bot.action(/^sub_pref:(subscription_first|wallet_first|subscription_only|wallet_only)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const preference = ctx.match?.[1];
    if (!preference) {
      await safeReply(ctx, "无效的策略参数。");
      return;
    }
    await handleSubPref(ctx, preference);
  });

  bot.action(/^sub_pick:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planId = parsePositiveInt(ctx.match?.[1]);
    if (!planId) {
      await safeReply(ctx, "无效的套餐 ID。");
      return;
    }
    await runWithAuth(ctx, async (auth) => {
      const { methods } = await fetchTopupMethods(auth);
      await safeReplyWithMarkup(
        ctx,
        `套餐 #${planId} 默认走易支付，请选择支付方式：`,
        subPayMethodsKeyboard(planId, methods)
      );
    });
  });

  bot.action(/^sub_epay_pick:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await safeReply(ctx, "已升级为默认易支付流程，请重新点套餐按钮选择支付方式。");
  });

  bot.action(/^sub_buy:(\d+):(epay|stripe|creem)(?::(.+))?$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planId = parsePositiveInt(ctx.match?.[1]);
    const provider = String(ctx.match?.[2] || "").toLowerCase();
    const paymentMethod = ctx.match?.[3] ? decodeCallbackPart(ctx.match[3]) : "";
    if (!planId || !["epay", "stripe", "creem"].includes(provider)) {
      await safeReply(ctx, "无效的套餐购买参数。");
      return;
    }
    if (provider !== "epay") {
      await safeReply(ctx, "当前已禁用 stripe/creem 渠道，统一使用易支付。");
      return;
    }
    if (!paymentMethod) {
      await safeReply(ctx, "epay 缺少支付方式参数。");
      return;
    }

    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.createSubscriptionEpay(auth, {
          planId,
          paymentMethod: sanitizeMethodValue(paymentMethod)
        });
        await replyPaymentResult(ctx, "套餐购买请求结果", data);
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.action(/^sub_buy_method:(\d+):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planId = parsePositiveInt(ctx.match?.[1]);
    const paymentMethod = decodeCallbackPart(ctx.match?.[2]);
    if (!planId || !paymentMethod) {
      await safeReply(ctx, "无效的套餐购买参数。");
      return;
    }
    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.createSubscriptionEpay(auth, {
          planId,
          paymentMethod: sanitizeMethodValue(paymentMethod)
        });
        await replyPaymentResult(ctx, "套餐购买请求结果", data);
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.action("key_new_quick", async (ctx) => {
    await ctx.answerCbQuery();
    await runWithAuth(ctx, async (auth) => {
      try {
        const name = `tg-${Date.now()}`;
        const data = await apiClient.createToken(auth, { name });
        const created = await resolveCreatedApiKey(auth, data, name);
        const lines = [
          "已快速创建 API Key",
          `名称: ${created.tokenName}`,
          `ID: ${created.tokenId ?? "-"}`
        ];
        if (created.key) {
          lines.push(`API Key: ${created.key}`);
        } else {
          lines.push("API Key: 后端未返回明文 key，请执行 /keys 查看。");
        }
        lines.push("安全提示：请妥善保管，不要在群聊泄露。");
        await safeReply(ctx, lines.join("\n"));
        const list = await apiClient.listTokens(auth);
        await safeReplyWithMarkup(ctx, formatTokenList(list), tokenManageKeyboard(list));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.action("key_groups", async (ctx) => {
    await ctx.answerCbQuery();
    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.listTokens(auth);
        await safeReply(ctx, formatTokenGroupSummary(data));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.action(/^key_del_ask:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const encodedId = String(ctx.match?.[1] || "");
    const id = decodeCallbackPart(encodedId);
    if (!id) {
      await safeReply(ctx, "无效的 Key ID。");
      return;
    }
    await safeReplyWithMarkup(
      ctx,
      `确认删除 API Key：${id} ?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ 确认删除", `key_del_confirm:${encodedId}`)],
        [Markup.button.callback("↩ 返回列表", "menu_keys")]
      ])
    );
  });

  bot.action(/^key_del_confirm:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const encodedId = String(ctx.match?.[1] || "");
    const id = decodeCallbackPart(encodedId);
    if (!id) {
      await safeReply(ctx, "无效的 Key ID。");
      return;
    }
    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.deleteToken(auth, id);
        await safeReply(ctx, formatOperationResult("删除 API Key", data));
        const list = await apiClient.listTokens(auth);
        await safeReplyWithMarkup(ctx, formatTokenList(list), tokenManageKeyboard(list));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.action("menu_register", async (ctx) => {
    await ctx.answerCbQuery();
    await handleOneClickRegister(ctx);
  });

  bot.action("register_one_click", async (ctx) => {
    await ctx.answerCbQuery();
    await handleOneClickRegister(ctx);
  });

  bot.action("menu_topup_help", async (ctx) => {
    await ctx.answerCbQuery();
    await handleShowTopupCenter(ctx);
  });

  bot.action("menu_topup_methods", async (ctx) => {
    await ctx.answerCbQuery();
    await runWithAuth(ctx, async (auth) => {
      try {
        const info = await apiClient.getTopupInfo(auth);
        await safeReply(ctx, formatTopupInfoSummary(info));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.action("menu_topup_records", async (ctx) => {
    await ctx.answerCbQuery();
    await runWithAuth(ctx, async (auth) => {
      try {
        const data = await apiClient.listMyTopups(auth);
        await safeReply(ctx, formatTopupRecords(data));
      } catch (error) {
        await safeReply(ctx, formatApiError(error));
      }
    });
  });

  bot.action(/^pay_amount:([0-9]+(?:\.[0-9]+)?)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const amount = parsePositiveNumber(ctx.match?.[1]);
    if (!amount) {
      await safeReply(ctx, "无效金额。");
      return;
    }
    await handleChoosePayMethod(ctx, amount);
  });

  bot.action(/^pay_submit:([0-9]+(?:\.[0-9]+)?):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const amount = parsePositiveNumber(ctx.match?.[1]);
    const method = decodeCallbackPart(ctx.match?.[2]);
    if (!amount || !method) {
      await safeReply(ctx, "支付参数无效。");
      return;
    }
    await handleCreatePayment(ctx, amount, method);
  });

  bot.action("menu_redeem_help", async (ctx) => {
    await ctx.answerCbQuery();
    await safeReply(ctx, "兑换充值码：/redeem <code>");
  });

  bot.action("menu_help", async (ctx) => {
    await ctx.answerCbQuery();
    await safeReply(ctx, "欢迎使用BilAPI，点击左下角的用户面板开始使用。");
  });

  bot.action("menu_miniapp", async (ctx) => {
    await ctx.answerCbQuery();
    if (!config.miniAppEnabled) {
      await safeReply(ctx, "Mini App 未启用。");
      return;
    }
    if (!miniAppUrl) {
      const lines = ["Mini App 地址未配置，请设置 MINIAPP_URL（公网 HTTPS 地址）。"];
      if (localMiniAppDebugUrl) {
        lines.push(`本地调试地址：${localMiniAppDebugUrl}`);
      }
      await safeReply(ctx, lines.join("\n"));
      return;
    }
    await safeReplyWithMarkup(ctx, `Mini App 地址：\n${miniAppUrl}`, miniAppKeyboard());
  });

  bot.catch(async (error, ctx) => {
    await safeReply(ctx, formatApiError(error));
  });

  return bot;
}
