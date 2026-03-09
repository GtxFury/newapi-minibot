import crypto from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { TelegramRegisterService } from "./telegramRegisterService.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    return null;
  }
  return n;
}

function readMethodCode(method) {
  const v = String(method || "").trim();
  if (!v) return "";
  return v;
}

function normalizePaymentMethod(item) {
  if (!item) return "";
  if (typeof item === "string") return item.trim();
  if (typeof item !== "object") return "";
  return String(item.type || item.method || item.code || item.value || "").trim();
}

function parseMaybeArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractPaymentMethods(info) {
  const methods = [];
  const push = (v) => {
    const m = String(v || "").trim();
    if (!m) return;
    if (["stripe", "creem"].includes(m.toLowerCase())) return;
    if (!methods.includes(m)) {
      methods.push(m);
    }
  };

  const arr = Array.isArray(info?.pay_methods)
    ? info.pay_methods
    : parseMaybeArray(info?.pay_methods);
  for (const item of arr) {
    push(normalizePaymentMethod(item));
  }

  if (!methods.length) {
    push("alipay");
    push("wxpay");
  }
  return methods;
}

function buildGatewayPayUrl(payload) {
  const direct =
    String(payload?.data?.pay_link || "").trim() ||
    String(payload?.data?.checkout_url || "").trim();
  if (direct) {
    return direct;
  }

  const base = String(payload?.url || "").trim();
  if (!base) {
    return "";
  }

  const paramsObj = payload?.data;
  if (!paramsObj || typeof paramsObj !== "object" || Array.isArray(paramsObj)) {
    return base;
  }

  const entries = Object.entries(paramsObj).filter(([, value]) => {
    return ["string", "number", "boolean"].includes(typeof value);
  });

  if (!entries.length) {
    return base;
  }

  try {
    const u = new URL(base);
    for (const [key, value] of entries) {
      u.searchParams.set(key, String(value));
    }
    return u.toString();
  } catch {
    const query = entries
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
    return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
  }
}

function extractOrderNo(payload) {
  return (
    String(payload?.data?.out_trade_no || "").trim() ||
    String(payload?.data?.order_id || "").trim() ||
    String(payload?.out_trade_no || "").trim()
  );
}

function sendJson(res, statusCode, body) {
  const text = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function sendError(res, statusCode, message, detail = "") {
  sendJson(res, statusCode, {
    success: false,
    error: message,
    message,
    detail,
    timestamp: Date.now()
  });
}

const rateLimiter = new Map();
function checkRateLimit(userId, bucket = "global", limit = 60, window = 60000) {
  void userId;
  void bucket;
  void limit;
  void window;
  rateLimiter.clear();
  return true;
}

function resolveRateLimitPolicy(method, pathname) {
  const normalizedMethod = String(method || "").toUpperCase();
  const normalizedPath = String(pathname || "");

  if (normalizedMethod === "POST" && normalizedPath === "/miniapi/chat/completions") {
    return {
      bucket: `${normalizedMethod}:${normalizedPath}`,
      limit: 45,
      window: 60000
    };
  }

  if (normalizedMethod === "GET") {
    return {
      bucket: `${normalizedMethod}:${normalizedPath}`,
      limit: 180,
      window: 60000
    };
  }

  return {
    bucket: `${normalizedMethod}:${normalizedPath}`,
    limit: 90,
    window: 60000
  };
}

function mimeByPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (!text) {
          resolve({});
          return;
        }
        const parsed = JSON.parse(text);
        resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  if (!left.length || !right.length || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) {
    return { ok: false, error: "missing_init_data" };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  if (!hash) {
    return { ok: false, error: "missing_hash" };
  }

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  if (!timingSafeEqualHex(calc, hash)) {
    return { ok: false, error: "hash_mismatch" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (Number.isFinite(authDate) && authDate > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - authDate) > 86400) {
      return { ok: false, error: "auth_expired" };
    }
  }

  let user = null;
  try {
    const rawUser = params.get("user");
    if (rawUser) {
      user = JSON.parse(rawUser);
    }
  } catch {
    user = null;
  }

  const userId = parsePositiveInt(user?.id);
  if (!userId) {
    return { ok: false, error: "missing_user" };
  }

  return { ok: true, user };
}

function getTelegramIdentity(req, urlObj, config) {
  const initDataHeader = req.headers["x-telegram-init-data"];
  const initData = typeof initDataHeader === "string" ? initDataHeader : "";

  if (initData) {
    const verified = verifyTelegramInitData(initData, config.botToken);
    if (!verified.ok) {
      throw new Error(`Telegram 鉴权失败: ${verified.error}`);
    }
    return {
      userId: parsePositiveInt(verified.user.id),
      user: verified.user,
      source: "telegram"
    };
  }

  if (config.miniAppDevBypassAuth) {
    const devHeader = req.headers["x-miniapp-dev-user"];
    const devQuery = urlObj.searchParams.get("tg_user_id") || "";
    const userId = parsePositiveInt(typeof devHeader === "string" ? devHeader : devQuery);
    if (userId) {
      return {
        userId,
        user: {
          id: userId,
          first_name: "Dev",
          username: `dev_${userId}`
        },
        source: "dev"
      };
    }
  }

  throw new Error("缺少 Telegram WebApp 鉴权数据");
}

function resolveNewApiAuth(config, store, telegramUserId) {
  const own = store.getAuth(String(telegramUserId));
  let token = "";
  let userId = null;

  if (own?.token) {
    token = String(own.token);
    userId = own.userId ?? config.defaultNewapiUserId ?? null;
  } else if (config.defaultNewapiToken) {
    token = String(config.defaultNewapiToken);
    userId = config.defaultNewapiUserId ?? null;
  }

  if (!token) {
    throw new Error("当前账号未绑定访问凭证，请先在 Bot 内完成绑定。");
  }

  const parsedUserId = parsePositiveInt(userId);
  if (!parsedUserId) {
    throw new Error("缺少 NewAPI 用户 ID，请先在 Bot 内绑定。\n用法：/settoken <token> <user_id>");
  }

  return {
    token,
    userId: parsedUserId
  };
}

function deriveTelegramPassword(config, telegramUserId) {
  const secret = String(config.registerPasswordSecret || config.botToken || "").trim();
  if (!secret) {
    return "";
  }
  return crypto
    .createHmac("sha256", secret)
    .update(String(telegramUserId || ""))
    .digest("base64url")
    .slice(0, 20);
}

function buildUpdateTokenPayload(current, tokenId) {
  return {
    id: parsePositiveInt(current?.id) || parsePositiveInt(tokenId) || Number(tokenId),
    name: String(current?.name || ""),
    status: Number(current?.status ?? 1),
    expired_time: Number(current?.expired_time ?? -1),
    remain_quota: Number(current?.remain_quota ?? 0),
    unlimited_quota: Boolean(current?.unlimited_quota),
    model_limits_enabled: Boolean(current?.model_limits_enabled),
    model_limits: typeof current?.model_limits === "string" ? current.model_limits : "",
    allow_ips: current?.allow_ips ?? "",
    group: current?.group ?? "",
    cross_group_retry: Boolean(current?.cross_group_retry)
  };
}

function toList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const candidates = ["items", "list", "tokens", "rows", "data"];
  for (const key of candidates) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function normalizeModels(data) {
  return toList(data)
    .map((item) => {
      if (typeof item === "string") {
        return { id: item, quota: null };
      }
      if (!item || typeof item !== "object") {
        return null;
      }
      const id = String(item.id || item.model || item.name || item.value || "").trim();
      if (!id) {
        return null;
      }
      return {
        ...item,
        id,
        quota: item.quota ?? item.multiplier ?? item.price ?? null
      };
    })
    .filter(Boolean);
}

function normalizeSubscriptionPlans(data) {
  return toList(data)
    .map((item) => {
      const plan = item?.plan || item;
      if (!plan || typeof plan !== "object") {
        return null;
      }
      const unit = String(plan.duration_unit || "").trim().toLowerCase();
      const value = Number(plan.duration_value ?? 0);
      const customSeconds = Number(plan.custom_seconds || 0);
      const days = Number(plan.days || 0);

      let durationLabel = "周期未设置";
      if (unit === "custom") {
        if (customSeconds >= 86400) durationLabel = `${Math.floor(customSeconds / 86400)}天`;
        else if (customSeconds >= 3600) durationLabel = `${Math.floor(customSeconds / 3600)}小时`;
        else if (customSeconds > 0) durationLabel = `${customSeconds}秒`;
      } else if (value > 0) {
        const unitLabels = { year: "年", month: "个月", day: "天", hour: "小时" };
        durationLabel = `${value}${unitLabels[unit] || unit}`;
      } else if (days > 0) {
        durationLabel = `${days}天`;
      }

      return {
        ...plan,
        duration_label: durationLabel
      };
    })
    .filter((item) => item && typeof item === "object");
}

function normalizeDelimitedList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  return String(value || "")
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTokenEnabled(token) {
  if (Number(token?.status ?? 1) !== 1) {
    return false;
  }

  const expiredTime = Number(token?.expired_time ?? token?.expiredTime ?? -1);
  const now = Math.floor(Date.now() / 1000);
  if (expiredTime !== -1 && expiredTime > 0 && expiredTime < now) {
    return false;
  }
  if (expiredTime === 0) {
    return false;
  }

  const unlimitedQuota = Boolean(token?.unlimited_quota ?? token?.unlimitedQuota);
  const remainQuota = Number(token?.remain_quota ?? token?.remainQuota ?? 0);
  if (!unlimitedQuota && remainQuota <= 0) {
    return false;
  }

  return true;
}

function compareChatKeys(left, right) {
  const scoreOf = (item) => {
    const name = String(item?.name || "").toLowerCase();
    let score = 0;
    if (name.includes("miniapp")) score += 50;
    if (name.includes("chat")) score += 40;
    if (name.includes("mini")) score += 20;
    if (name.includes("api")) score += 10;
    return score;
  };

  const scoreDiff = scoreOf(right) - scoreOf(left);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  return (parsePositiveInt(right?.id) || 0) - (parsePositiveInt(left?.id) || 0);
}

function resolveChatModels(token, allModels) {
  const models = normalizeModels(allModels);
  if (!models.length) {
    return [];
  }

  if (!Boolean(token?.model_limits_enabled)) {
    return models;
  }

  const allowed = new Set(
    normalizeDelimitedList(token?.model_limits).map((item) => item.toLowerCase())
  );

  if (!allowed.size) {
    return [];
  }

  return models.filter((item) => allowed.has(String(item.id || "").toLowerCase()));
}

function summarizeChatKey(token, allModels) {
  if (!token || !isTokenEnabled(token)) {
    return null;
  }

  const id = parsePositiveInt(token.id);
  if (!id) {
    return null;
  }

  const availableModels = resolveChatModels(token, allModels);
  return {
    id,
    name: String(token.name || `API Key #${id}`),
    status: Number(token.status ?? 1),
    model_limits_enabled: Boolean(token?.model_limits_enabled),
    model_limits: String(token?.model_limits || ""),
    available_models: availableModels,
    model_count: availableModels.length
  };
}

function listChatKeys(tokens, allModels) {
  return toList(tokens)
    .slice()
    .sort(compareChatKeys)
    .map((token) => summarizeChatKey(token, allModels))
    .filter(Boolean);
}

function pickChatKey(tokens, allModels) {
  return listChatKeys(tokens, allModels)[0] || null;
}

function findChatKeyById(tokens, keyId) {
  const target = parsePositiveInt(keyId);
  if (!target) {
    return null;
  }
  return toList(tokens).find((item) => parsePositiveInt(item?.id) === target) || null;
}

function buildChatBootstrapPayload(tokens, allModels, selectedKeyId = null) {
  const keys = listChatKeys(tokens, allModels);
  const selected =
    keys.find((item) => item.id === parsePositiveInt(selectedKeyId)) ||
    keys[0] ||
    null;
  const selectedModels = Array.isArray(selected?.available_models) ? selected.available_models : [];

  return {
    has_key: keys.length > 0,
    auto_create_available: true,
    keys,
    selected_key_id: selected?.id || null,
    selected_model: selectedModels[0]?.id || "",
    models: selectedModels
  };
}

async function getChatKeyModels(auth, apiClient, tokens, allModels, keyId) {
  const rawToken = findChatKeyById(tokens, keyId);
  if (!rawToken || !isTokenEnabled(rawToken)) {
    return [];
  }

  let mergedToken = rawToken;
  try {
    const detail = await apiClient.getTokenById(auth, keyId);
    if (detail && typeof detail === "object") {
      mergedToken = {
        ...rawToken,
        ...detail
      };
    }
  } catch {}

  const plainKey = extractTokenPlainKey(mergedToken);
  if (plainKey) {
    try {
      const relayModels = normalizeModels(await apiClient.getRelayModelsByKey(plainKey));
      if (relayModels.length) {
        return relayModels;
      }
    } catch {}
  }

  return resolveChatModels(mergedToken, allModels);
}

async function ensureChatKey(auth, apiClient) {
  const allModels = await apiClient.getModels(auth);
  const initialTokens = toList(await apiClient.listTokens(auth));
  const initial = pickChatKey(initialTokens, allModels);
  if (initial) {
    return {
      created: false,
      selectedKeyId: initial.id,
      allModels,
      tokens: initialTokens
    };
  }

  const name = "MiniApp Chat";
  await apiClient.createToken(auth, {
    name,
    expired_time: -1,
    unlimited_quota: true
  });

  const refreshedTokens = toList(await apiClient.listTokens(auth));
  const selected =
    refreshedTokens
      .slice()
      .sort((left, right) => (parsePositiveInt(right?.id) || 0) - (parsePositiveInt(left?.id) || 0))
      .find((item) => String(item?.name || "").trim() === name && isTokenEnabled(item)) ||
    findChatKeyById(refreshedTokens, pickChatKey(refreshedTokens, allModels)?.id);

  const keyId = parsePositiveInt(selected?.id);
  if (!keyId) {
    throw new Error("自动创建聊天 Key 失败，请稍后重试");
  }

  return {
    created: true,
    selectedKeyId: keyId,
    allModels,
    tokens: refreshedTokens
  };
}

function normalizeChatMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const role = String(item.role || "").trim().toLowerCase();
      const content = typeof item.content === "string"
        ? item.content.trim()
        : Array.isArray(item.content)
          ? item.content
              .map((part) => (typeof part?.text === "string" ? part.text : ""))
              .join("")
              .trim()
          : "";
      if (!["system", "user", "assistant"].includes(role) || !content) {
        return null;
      }
      return { role, content };
    })
    .filter(Boolean)
    .slice(-20);
}

function extractTokenPlainKey(token) {
  return (
    String(token?.key || "").trim() ||
    String(token?.token || "").trim() ||
    String(token?.access_key || "").trim()
  );
}

function extractAssistantText(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? "";
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function normalizeCreateAspectRatio(value) {
  const normalized = String(value || "").trim();
  return ["16:9", "9:16", "1:1", "4:5"].includes(normalized) ? normalized : "16:9";
}

function normalizeCreateDuration(value) {
  const text = String(value || "").trim().toLowerCase();
  const matched = text.match(/(\d+)/);
  const seconds = matched ? Number(matched[1]) : 8;
  if (!Number.isFinite(seconds)) return 8;
  return Math.min(20, Math.max(5, seconds));
}

function extractFirstUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

function extractHtmlAttribute(html, tagName, attributeName) {
  const text = String(html || "");
  if (!text) return "";
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\s${attributeName}=["']([^"']+)["'][^>]*>`, "i");
  const match = text.match(pattern);
  return match ? String(match[1] || "").trim() : "";
}

function extractVideoSourceUrl(html) {
  const sourceSrc = extractHtmlAttribute(html, "source", "src");
  if (sourceSrc) {
    return sourceSrc;
  }
  const videoSrc = extractHtmlAttribute(html, "video", "src");
  if (videoSrc) {
    return videoSrc;
  }
  const mp4Match = String(html || "").match(/https?:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?/i);
  return mp4Match ? String(mp4Match[0] || "").trim() : "";
}

function extractImageUrl(value) {
  const text = String(value || "");
  const match = text.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i);
  return match ? String(match[0] || "").trim() : "";
}

function extractGrokVideoData(payload) {
  const content = extractAssistantText(payload);
  const payloadText = (() => {
    try {
      return JSON.stringify(payload);
    } catch {
      return "";
    }
  })();
  const htmlVideoUrl = extractVideoSourceUrl(content);
  const payloadVideoUrl = extractVideoSourceUrl(payloadText);
  const posterUrl =
    extractHtmlAttribute(content, "video", "poster") ||
    extractHtmlAttribute(payloadText, "video", "poster") ||
    extractImageUrl(payloadText);
  const directVideo =
    htmlVideoUrl ||
    payloadVideoUrl ||
    extractFirstUrl(payload?.video_url) ||
    extractFirstUrl(payload?.url) ||
    extractFirstUrl(payload?.data?.video_url) ||
    extractFirstUrl(payload?.data?.url) ||
    extractVideoSourceUrl(content) ||
    extractFirstUrl(content) ||
    extractVideoSourceUrl(payloadText) ||
    extractFirstUrl(payloadText);

  return {
    rawContent: content,
    videoUrl: directVideo,
    posterUrl,
    taskId:
      String(payload?.task_id || "").trim() ||
      String(payload?.data?.task_id || "").trim() ||
      String(payload?.id || "").trim()
  };
}

async function requestVideoGenerationByKey(apiClient, plainKey, { prompt, aspectRatio, duration, imageUrl = "" }) {
  const content = [{ type: "text", text: prompt }];
  if (imageUrl) {
    content.push({
      type: "image_url",
      image_url: {
        url: imageUrl
      }
    });
  }

  const payload = await apiClient.request({
    method: "POST",
    path: "/v1/chat/completions",
    token: plainKey,
    data: {
      model: "grok-imagine-1.0-video",
      messages: [
        {
          role: "user",
          content
        }
      ],
      stream: false,
      video_config: {
        duration,
        aspect_ratio: aspectRatio
      }
    },
    raw: true
  });

  const data = extractGrokVideoData(payload);
  if (!data.videoUrl && !data.taskId) {
    throw new Error("视频任务已提交，但未返回可识别的视频地址");
  }

  return {
    ...data,
    raw: payload
  };
}

async function handleMiniApi(req, res, urlObj, { config, store, apiClient }) {
  let identity;
  try {
    identity = getTelegramIdentity(req, urlObj, config);
  } catch (error) {
    sendError(res, 401, "鉴权失败", String(error?.message || error));
    return;
  }

  const pathname = urlObj.pathname;
  const method = readMethodCode(req.method).toUpperCase();
  void checkRateLimit;
  void resolveRateLimitPolicy;

  if (method === "POST" && pathname === "/miniapi/account/open") {
    try {
      const registerService = new TelegramRegisterService({
        baseUrl: config.baseUrl,
        botToken: config.botToken,
        adminToken: config.registerAdminToken,
        adminUserId: config.registerAdminUserId,
        usernamePrefix: config.registerUsernamePrefix,
        passwordSecret: config.registerPasswordSecret
      });

      const result = await registerService.registerOrLoginByTelegram(identity.user);
      const token = String(result?.accessToken || "").trim();
      const userId = parsePositiveInt(result?.user?.id);

      if (!token || !userId) {
        sendError(res, 502, "开号失败", "已完成注册或登录，但未拿到访问凭证");
        return;
      }

      await store.setAuth(identity.userId, { token, userId });
      const auth = { token, userId };
      const data = await apiClient.getUserSelf(auth).catch(() => result?.user || null);

      sendJson(res, 200, {
        success: true,
        message: result?.alreadyRegistered ? "账号已登录并绑定到 Mini App" : "账号已开通并绑定到 Mini App",
        data,
        meta: {
          already_registered: Boolean(result?.alreadyRegistered)
        }
      });
    } catch (error) {
      const detail = String(error?.message || error || "开号失败");
      sendError(res, 400, "开号失败", detail);
    }
    return;
  }

  let auth;
  try {
    auth = resolveNewApiAuth(config, store, identity.userId);
  } catch (error) {
    sendError(res, 401, "未绑定凭证", String(error?.message || error));
    return;
  }

  try {
    if (method === "GET" && pathname === "/miniapi/session") {
      sendJson(res, 200, {
        success: true,
        data: {
          telegram_user: identity.user,
          auth_source: identity.source,
          newapi_user_id: auth.userId
        }
      });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/bootstrap") {
      const now = Math.floor(Date.now() / 1000);
      const start = now - 30 * 24 * 3600;
      const tasks = await Promise.allSettled([
        apiClient.getUserSelf(auth),
        apiClient.getDataSelf(auth, { startTimestamp: start, endTimestamp: now }),
        apiClient.getSubscriptionPlans(auth),
        apiClient.getSubscriptionSelf(auth),
        apiClient.listTokens(auth),
        apiClient.getUserGroups(auth),
        apiClient.getTopupInfo(auth),
        apiClient.listMyTopups(auth)
      ]);

      const readResult = (item) => (item.status === "fulfilled" ? item.value : null);
      const readError = (item) => (item.status === "rejected" ? String(item.reason?.message || item.reason || "请求失败") : "");
      const usage = toList(readResult(tasks[1]));
      const subscriptionPlans = normalizeSubscriptionPlans(readResult(tasks[2]));
      const keys = toList(readResult(tasks[4]));
      const userGroups = readResult(tasks[5]);
      const topupRecords = toList(readResult(tasks[7]));

      sendJson(res, 200, {
        success: true,
        data: {
          telegram_user: identity.user,
          me: readResult(tasks[0]),
          usage,
          subscription_plans: subscriptionPlans,
          subscription_self: readResult(tasks[3]),
          keys,
          user_groups: userGroups,
          topup_info: readResult(tasks[6]),
          topup_records: topupRecords
        },
        errors: {
          me: readError(tasks[0]),
          usage: readError(tasks[1]),
          subscription_plans: readError(tasks[2]),
          subscription_self: readError(tasks[3]),
          keys: readError(tasks[4]),
          user_groups: readError(tasks[5]),
          topup_info: readError(tasks[6]),
          topup_records: readError(tasks[7])
        }
      });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/me") {
      const data = await apiClient.getUserSelf(auth);
      sendJson(res, 200, { success: true, data });
      return;
    }

    if (method === "PUT" && pathname === "/miniapi/me") {
      const body = await readJsonBody(req);
      const payload = {};
      if (body.username !== undefined) payload.username = String(body.username || "").trim();
      if (body.display_name !== undefined) payload.display_name = String(body.display_name || "").trim();
      if (body.password !== undefined) payload.password = String(body.password || "");
      if (body.original_password !== undefined) payload.original_password = String(body.original_password || "");

      if (!Object.keys(payload).length) {
        sendError(res, 400, "缺少更新字段");
        return;
      }
      if (!payload.original_password && (payload.password || payload.username || payload.display_name)) {
        const derivedPassword = deriveTelegramPassword(config, identity.userId);
        if (derivedPassword) {
          payload.original_password = derivedPassword;
        }
      }

      await apiClient.updateUserSelf(auth, payload);
      const data = await apiClient.getUserSelf(auth);
      sendJson(res, 200, { success: true, message: "账户信息已更新", data });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/verification") {
      const email = String(urlObj.searchParams.get("email") || "").trim();
      const turnstile = String(urlObj.searchParams.get("turnstile") || "").trim();
      if (!email) {
        sendError(res, 400, "缺少邮箱地址");
        return;
      }
      const data = await apiClient.sendEmailVerification({ email, turnstile });
      sendJson(res, 200, {
        success: true,
        message: data?.message || "验证码发送成功，请检查邮箱"
      });
      return;
    }

    if (method === "POST" && pathname === "/miniapi/me/email-bind") {
      const body = await readJsonBody(req);
      const email = String(body.email || "").trim();
      const code = String(body.code || "").trim();
      if (!email || !code) {
        sendError(res, 400, "缺少邮箱或验证码");
        return;
      }

      const login = await apiClient.loginByTelegram({
        botToken: config.botToken,
        telegramUser: identity.user
      });
      if (!login.cookie) {
        sendError(res, 400, "未获取到登录会话，无法绑定邮箱");
        return;
      }

      await apiClient.bindEmailWithCookie({
        cookie: login.cookie,
        email,
        code
      });
      const data = await apiClient.getUserSelf(auth);
      sendJson(res, 200, { success: true, message: "邮箱绑定成功", data });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/models") {
      const data = await apiClient.getModels(auth);
      sendJson(res, 200, { success: true, data: normalizeModels(data) });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/chat/bootstrap") {
      const [tokens, allModels] = await Promise.all([
        apiClient.listTokens(auth),
        apiClient.getModels(auth)
      ]);
      const payload = buildChatBootstrapPayload(tokens, allModels);
      if (payload.selected_key_id) {
        const selectedModels = await getChatKeyModels(auth, apiClient, tokens, allModels, payload.selected_key_id);
        payload.models = selectedModels;
        payload.selected_model = selectedModels[0]?.id || "";
        payload.keys = payload.keys.map((item) => String(item.id) === String(payload.selected_key_id)
          ? { ...item, available_models: selectedModels, model_count: selectedModels.length }
          : item);
      }
      sendJson(res, 200, {
        success: true,
        data: payload
      });
      return;
    }

    if (method === "POST" && pathname === "/miniapi/chat/ensure-key") {
      const ensured = await ensureChatKey(auth, apiClient);
      const payload = buildChatBootstrapPayload(ensured.tokens, ensured.allModels, ensured.selectedKeyId);
      if (payload.selected_key_id) {
        const selectedModels = await getChatKeyModels(auth, apiClient, ensured.tokens, ensured.allModels, payload.selected_key_id);
        payload.models = selectedModels;
        payload.selected_model = selectedModels[0]?.id || "";
        payload.keys = payload.keys.map((item) => String(item.id) === String(payload.selected_key_id)
          ? { ...item, available_models: selectedModels, model_count: selectedModels.length }
          : item);
      }
      sendJson(res, 200, {
        success: true,
        message: ensured.created ? "已自动创建聊天 Key" : "已找到可用聊天 Key",
        data: payload
      });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/chat/key-models") {
      const keyId = parsePositiveInt(urlObj.searchParams.get("key_id"));
      if (!keyId) {
        sendError(res, 400, "缺少 key_id");
        return;
      }
      const [tokens, allModels] = await Promise.all([
        apiClient.listTokens(auth),
        apiClient.getModels(auth)
      ]);
      const models = await getChatKeyModels(auth, apiClient, tokens, allModels, keyId);
      sendJson(res, 200, {
        success: true,
        data: {
          key_id: keyId,
          models,
          selected_model: models[0]?.id || ""
        }
      });
      return;
    }

    if (method === "POST" && pathname === "/miniapi/chat/completions") {
      const body = await readJsonBody(req);
      const messages = normalizeChatMessages(body.messages);
      if (!messages.length) {
        sendError(res, 400, "消息不能为空");
        return;
      }

      const requestedModel = String(body.model || "").trim();
      const wantsStream = Boolean(body.stream);
      if (!requestedModel) {
        sendError(res, 400, "请选择模型");
        return;
      }

      let selectedKeyId = parsePositiveInt(body.key_id);
      let allModels;
      let tokens;

      if (!selectedKeyId) {
        const ensured = await ensureChatKey(auth, apiClient);
        selectedKeyId = ensured.selectedKeyId;
        allModels = ensured.allModels;
        tokens = ensured.tokens;
      } else {
        [tokens, allModels] = await Promise.all([
          apiClient.listTokens(auth),
          apiClient.getModels(auth)
        ]);
      }

      const rawToken = findChatKeyById(tokens, selectedKeyId);
      if (!rawToken || !isTokenEnabled(rawToken)) {
        sendError(res, 400, "当前密钥不可用，请重新选择");
        return;
      }

      const detail = await apiClient.getTokenById(auth, selectedKeyId);
      const mergedToken = {
        ...rawToken,
        ...(detail && typeof detail === "object" ? detail : {})
      };
      const availableModels = resolveChatModels(mergedToken, allModels);
      if (!availableModels.some((item) => String(item.id || "") === requestedModel)) {
        sendError(res, 400, "该模型不在当前 Key 的可用范围内");
        return;
      }

      const plainKey = extractTokenPlainKey(mergedToken);
      if (!plainKey) {
        sendError(res, 500, "无法读取当前 Key 的明文，请重新创建后再试");
        return;
      }

      if (wantsStream) {
        const upstream = await apiClient.requestStream({
          method: "POST",
          path: "/v1/chat/completions",
          token: plainKey,
          data: {
            model: requestedModel,
            messages,
            stream: true
          }
        });

        res.writeHead(200, {
          "Content-Type": upstream.headers?.["content-type"] || "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });

        const stream = upstream.data;
        const cleanup = () => {
          if (stream && typeof stream.destroy === "function") {
            stream.destroy();
          }
        };
        req.on("close", cleanup);
        stream.on("error", () => {
          if (!res.writableEnded) {
            res.end();
          }
        });
        stream.pipe(res);
        return;
      }

      const payload = await apiClient.request({
        method: "POST",
        path: "/v1/chat/completions",
        token: plainKey,
        data: {
          model: requestedModel,
          messages,
          stream: false
        },
        raw: true
      });

      const message = extractAssistantText(payload);
      if (!message) {
        sendError(res, 502, "模型未返回有效内容");
        return;
      }

      sendJson(res, 200, {
        success: true,
        data: {
          key_id: selectedKeyId,
          model: requestedModel,
          message,
          usage: payload?.usage || null,
          raw: payload
        }
      });
      return;
    }

    if (method === "POST" && pathname === "/miniapi/create/video") {
      const body = await readJsonBody(req);
      const prompt = String(body?.prompt || "").trim();
      const model = String(body?.model || "").trim();
      const aspectRatio = normalizeCreateAspectRatio(body?.aspect_ratio || body?.aspectRatio);
      const duration = normalizeCreateDuration(body?.duration);
      const imageUrl = String(body?.image_url || body?.imageUrl || "").trim();
      let selectedKeyId = parsePositiveInt(body?.key_id || body?.keyId);

      if (!prompt) {
        sendError(res, 400, "请输入视频提示词");
        return;
      }

      if (model && !["grok-video", "grok-imagine-1.0-video"].includes(model)) {
        sendError(res, 400, "当前仅接入 Grok Video，其他模型暂未开放真实生成");
        return;
      }

      const [tokens, allModels] = await Promise.all([
        apiClient.listTokens(auth),
        apiClient.getModels(auth)
      ]);

      if (!selectedKeyId) {
        selectedKeyId = pickChatKey(tokens, allModels)?.id || null;
      }
      if (!selectedKeyId) {
        sendError(res, 400, "当前没有可用 Key，请先创建或选择一个 Key");
        return;
      }

      const rawToken = findChatKeyById(tokens, selectedKeyId);
      if (!rawToken || !isTokenEnabled(rawToken)) {
        sendError(res, 400, "当前 Key 不可用，请重新选择");
        return;
      }

      const detail = await apiClient.getTokenById(auth, selectedKeyId);
      const mergedToken = {
        ...rawToken,
        ...(detail && typeof detail === "object" ? detail : {})
      };

      const plainKey = extractTokenPlainKey(mergedToken);
      if (!plainKey) {
        sendError(res, 500, "无法读取当前 Key 的明文，请重新创建后再试");
        return;
      }

      try {
        const relayModels = normalizeModels(await apiClient.getRelayModelsByKey(plainKey));
        if (relayModels.length && !relayModels.some((item) => String(item?.id || "") === "grok-imagine-1.0-video")) {
          sendError(res, 400, "当前 Key 不支持固定视频模型 grok-imagine-1.0-video");
          return;
        }
      } catch {}

      const result = await requestVideoGenerationByKey(apiClient, plainKey, {
        prompt,
        aspectRatio,
        duration,
        imageUrl
      });

      sendJson(res, 200, {
        success: true,
        data: {
          key_id: selectedKeyId,
          model: "grok-imagine-1.0-video",
          prompt,
          aspect_ratio: aspectRatio,
          duration,
          image_url: imageUrl,
          video_url: result.videoUrl,
          poster_url: result.posterUrl,
          task_id: result.taskId,
          raw_content: result.rawContent,
          raw: result.raw
        }
      });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/logs") {
      const p = parsePositiveInt(urlObj.searchParams.get("p")) || 1;
      const pageSize = parsePositiveInt(urlObj.searchParams.get("page_size")) || 20;
      const tokenName = urlObj.searchParams.get("token_name") || "";
      const modelName = urlObj.searchParams.get("model_name") || "";
      const result = await apiClient.getLogs(auth, { p, pageSize, tokenName, modelName });
      const items = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
      const total = result?.total || 0;
      sendJson(res, 200, { success: true, data: items, total, page: p, page_size: pageSize });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/logs/stat") {
      const result = await apiClient.getLogs(auth, { p: 1, pageSize: 100 });
      const items = Array.isArray(result?.items) ? result.items : [];
      const models = {};
      const tokens = {};
      let totalQuota = 0;

      for (const log of items) {
        const model = String(log?.model_name || "unknown");
        const token = String(log?.token_name || "unknown");
        const quota = Number(log?.quota || 0);

        models[model] = (models[model] || 0) + 1;
        tokens[token] = (tokens[token] || 0) + 1;
        totalQuota += quota;
      }

      sendJson(res, 200, {
        success: true,
        data: {
          total_requests: items.length,
          total_quota: totalQuota,
          models,
          tokens
        }
      });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/affiliate") {
      const data = await apiClient.getAffiliate(auth);
      const affiliatePayload = data && typeof data === "object" && !Array.isArray(data) ? data : null;
      const affCode = String(affiliatePayload?.aff_code || affiliatePayload?.code || data || "").trim();
      const inviteUrl = affCode ? `${config.baseUrl}/register?aff=${encodeURIComponent(affCode)}` : "";
      sendJson(res, 200, {
        success: true,
        data: {
          ...(affiliatePayload || {}),
          aff_code: affCode,
          invite_url: inviteUrl
        }
      });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/usage") {
      const daysArg = Number(urlObj.searchParams.get("days") || 30);
      const days = Number.isFinite(daysArg) ? Math.min(Math.max(daysArg, 1), 30) : 30;
      const end = Math.floor(Date.now() / 1000);
      const start = end - days * 24 * 3600;
      const data = await apiClient.getDataSelf(auth, { startTimestamp: start, endTimestamp: end });
      sendJson(res, 200, { success: true, data, days });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/sub/plans") {
      const data = await apiClient.getSubscriptionPlans(auth);
      sendJson(res, 200, { success: true, data: normalizeSubscriptionPlans(data) });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/sub/self") {
      const data = await apiClient.getSubscriptionSelf(auth);
      sendJson(res, 200, { success: true, data });
      return;
    }

    if (method === "PUT" && pathname === "/miniapi/subscription/preference") {
      const body = await readJsonBody(req);
      const preference = String(body.billing_preference || "").trim();
      const allowed = new Set(["subscription_first", "wallet_first", "subscription_only", "wallet_only"]);
      if (!allowed.has(preference)) {
        sendError(res, 400, "扣费策略无效");
        return;
      }
      await apiClient.updateSubscriptionPreference(auth, preference);
      const data = await apiClient.getSubscriptionSelf(auth);
      sendJson(res, 200, { success: true, message: "扣费策略已更新", data });
      return;
    }

    if (method === "POST" && pathname === "/miniapi/subscription/buy") {
      const body = await readJsonBody(req);
      const planId = parsePositiveInt(body.plan_id);
      const paymentMethod = String(body.payment_method || "").trim();
      if (!planId || !paymentMethod) {
        sendError(res, 400, "缺少套餐 ID 或支付方式");
        return;
      }
      const payload = await apiClient.createSubscriptionEpay(auth, {
        planId,
        paymentMethod
      });
      sendJson(res, 200, {
        success: true,
        message: payload?.message || "success",
        pay_url: buildGatewayPayUrl(payload),
        order_no: extractOrderNo(payload),
        raw: payload
      });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/keys") {
      const data = await apiClient.listTokens(auth);
      const list = toList(data);
      const groups = {};
      for (const item of list) {
        const group = (item?.group && String(item.group).trim()) || "默认";
        if (!groups[group]) {
          groups[group] = { total: 0, enabled: 0 };
        }
        groups[group].total += 1;
        if (Number(item?.status) === 1) {
          groups[group].enabled += 1;
        }
      }
      sendJson(res, 200, { success: true, data: list, groups });
      return;
    }

    if (method === "POST" && pathname === "/miniapi/keys") {
      const body = await readJsonBody(req);
      const name = String(body.name || "").trim();
      if (!name) {
        sendError(res, 400, "Key 名称不能为空");
        return;
      }
      const payload = { name };
      if (body.remain_quota !== undefined) payload.remain_quota = Number(body.remain_quota);
      if (body.expired_time !== undefined) payload.expired_time = Number(body.expired_time);
      if (body.unlimited_quota !== undefined) payload.unlimited_quota = Boolean(body.unlimited_quota);
      if (body.group !== undefined) payload.group = String(body.group || "").trim();
      if (body.allow_ips !== undefined) payload.allow_ips = String(body.allow_ips || "");
      if (body.model_limits_enabled !== undefined) payload.model_limits_enabled = Boolean(body.model_limits_enabled);
      if (body.model_limits !== undefined) payload.model_limits = String(body.model_limits || "");

      await apiClient.createToken(auth, payload);
      const listData = await apiClient.listTokens(auth);
      const list = toList(listData);
      const created = list.find((item) => String(item?.name || "") === name) || list[0] || null;

      sendJson(res, 200, {
        success: true,
        message: "API Key 创建成功",
        data: created,
        keys: list
      });
      return;
    }

    const keyIdMatch = pathname.match(/^\/miniapi\/keys\/(\d+)$/);
    if (keyIdMatch && method === "GET") {
      const id = parsePositiveInt(keyIdMatch[1]);
      const data = await apiClient.getTokenById(auth, id);
      sendJson(res, 200, { success: true, data });
      return;
    }

    if (keyIdMatch && method === "PUT") {
      const id = parsePositiveInt(keyIdMatch[1]);
      const body = await readJsonBody(req);
      const current = await apiClient.getTokenById(auth, id);
      const payload = buildUpdateTokenPayload(current, id);

      const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
      if (has("name")) payload.name = String(body.name || "");
      if (has("status")) payload.status = Number(body.status);
      if (has("expired_time")) payload.expired_time = Number(body.expired_time);
      if (has("remain_quota")) payload.remain_quota = Number(body.remain_quota);
      if (has("unlimited_quota")) payload.unlimited_quota = Boolean(body.unlimited_quota);
      if (has("group")) payload.group = String(body.group || "").trim();
      if (has("allow_ips")) payload.allow_ips = String(body.allow_ips || "");
      if (has("cross_group_retry")) payload.cross_group_retry = Boolean(body.cross_group_retry);
      if (has("model_limits_enabled")) payload.model_limits_enabled = Boolean(body.model_limits_enabled);
      if (has("model_limits")) payload.model_limits = String(body.model_limits || "");

      const statusOnly = Boolean(body.status_only) || (has("status") && Object.keys(body).length <= 2);
      const data = await apiClient.updateToken(auth, payload, { statusOnly });
      sendJson(res, 200, { success: true, message: "更新成功", data });
      return;
    }

    if (keyIdMatch && method === "DELETE") {
      const id = parsePositiveInt(keyIdMatch[1]);
      await apiClient.deleteToken(auth, id);
      sendJson(res, 200, { success: true, message: "删除成功" });
      return;
    }

    if (method === "POST" && pathname === "/miniapi/pay") {
      const body = await readJsonBody(req);
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        sendError(res, 400, "充值数量无效");
        return;
      }

      let paymentMethod = String(body.payment_method || "").trim();
      if (!paymentMethod) {
        const info = await apiClient.getTopupInfo(auth);
        const methods = extractPaymentMethods(info);
        paymentMethod = methods[0] || "alipay";
      }

      const payload = await apiClient.createPayment(auth, {
        amount,
        payment_method: paymentMethod
      });

      sendJson(res, 200, {
        success: true,
        message: payload?.message || "success",
        pay_url: buildGatewayPayUrl(payload),
        order_no: extractOrderNo(payload),
        payment_method: paymentMethod,
        raw: payload
      });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/topup/info") {
      const data = await apiClient.getTopupInfo(auth);
      sendJson(res, 200, {
        success: true,
        data,
        methods: extractPaymentMethods(data)
      });
      return;
    }

    if (method === "GET" && pathname === "/miniapi/topup/self") {
      const data = await apiClient.listMyTopups(auth);
      sendJson(res, 200, { success: true, data: toList(data) });
      return;
    }

    if (method === "POST" && pathname === "/miniapi/redeem") {
      const body = await readJsonBody(req);
      const code = String(body.code || "").trim();
      if (!code) {
        sendError(res, 400, "兑换码不能为空");
        return;
      }
      const data = await apiClient.redeemCode(auth, code);
      sendJson(res, 200, { success: true, message: "兑换成功", data });
      return;
    }

    sendError(res, 404, "接口不存在");
  } catch (error) {
    const message = String(error?.message || error || "请求失败");
    const status = Number(error?.status) || 500;
    const payloadDetail = error?.payload && typeof error.payload === "object"
      ? String(error.payload.detail || error.payload.error || error.payload.message || "").trim()
      : "";
    sendError(res, status >= 400 && status < 600 ? status : 500, message, payloadDetail);
  }
}

async function serveFile(res, filePath) {
  const content = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": mimeByPath(filePath),
    "Cache-Control": "public, max-age=120"
  });
  res.end(content);
}

export async function startMiniAppServer({ config, store, apiClient }) {
  if (!config.miniAppEnabled) {
    return null;
  }

  const rootDir = process.cwd();
  const miniDir = path.resolve(rootDir, "miniapp");
  const logoPath = path.resolve(rootDir, "logo.png");

  const server = createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = urlObj.pathname;

      if (pathname === "/miniapi/health") {
        sendJson(res, 200, {
          success: true,
          status: "ok",
          timestamp: Date.now(),
          uptime: process.uptime()
        });
        return;
      }

      if (pathname.startsWith("/miniapi/")) {
        await handleMiniApi(req, res, urlObj, { config, store, apiClient });
        return;
      }

      if (pathname === "/") {
        res.writeHead(302, { Location: "/miniapp/" });
        res.end();
        return;
      }

      if (pathname === "/miniapp") {
        res.writeHead(302, { Location: "/miniapp/" });
        res.end();
        return;
      }

      if (pathname === "/logo.png" || pathname === "/miniapp/logo.png") {
        await serveFile(res, logoPath);
        return;
      }

      if (pathname.startsWith("/miniapp/")) {
        let relative = pathname.slice("/miniapp/".length);
        if (!relative || relative.endsWith("/")) {
          relative += "index.html";
        }

        const filePath = path.resolve(miniDir, relative);
        if (!filePath.startsWith(miniDir)) {
          sendError(res, 403, "禁止访问");
          return;
        }

        try {
          await serveFile(res, filePath);
          return;
        } catch {
          const fallback = path.resolve(miniDir, "index.html");
          await serveFile(res, fallback);
          return;
        }
      }

      sendError(res, 404, "Not Found");
    } catch (error) {
      const status = Number(error?.status);
      const detail =
        String(
          error?.payload?.detail ||
          error?.payload?.error?.message ||
          error?.payload?.message ||
          error?.message ||
          error
        );
      sendError(res, Number.isFinite(status) && status >= 400 ? status : 500, "服务器错误", detail);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.miniAppPort, config.miniAppHost, resolve);
  });

  const hostForLog = config.miniAppHost === "0.0.0.0" ? "127.0.0.1" : config.miniAppHost;
  const localUrl = `http://${hostForLog}:${config.miniAppPort}/miniapp/`;

  return {
    server,
    localUrl,
    close: () =>
      new Promise((resolveClose) => {
        server.close(() => resolveClose());
      })
  };
}
