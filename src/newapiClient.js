import crypto from "node:crypto";
import axios from "axios";

export class ApiRequestError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

function extractText(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).filter(Boolean).join(" ").trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  for (const key of ["message", "error", "detail", "description", "msg", "type", "reason"]) {
    const text = extractText(value[key]);
    if (text) {
      return text;
    }
  }

  return "";
}

function pickMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return "请求失败";
  }

  return (
    extractText(payload.message) ||
    extractText(payload.msg) ||
    extractText(payload.error) ||
    extractText(payload.detail) ||
    extractText(payload.description) ||
    "请求失败"
  );
}

function unwrapData(payload) {
  if (payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.data;
  }
  return payload;
}

function buildCookieHeader(setCookieHeaders) {
  if (!Array.isArray(setCookieHeaders) || !setCookieHeaders.length) {
    return "";
  }
  return setCookieHeaders
    .map((item) => String(item).split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function countListItems(payload) {
  const data = unwrapData(payload);
  if (Array.isArray(data)) {
    return data.length;
  }
  if (!data || typeof data !== "object") {
    return 0;
  }
  for (const key of ["items", "list", "tokens", "rows", "data", "models"]) {
    if (Array.isArray(data[key])) {
      return data[key].length;
    }
  }
  return 0;
}

async function readStreamPayload(readable, maxBytes = 65536) {
  const chunks = [];
  let total = 0;
  for await (const chunk of readable) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      chunks.push(buffer.subarray(0, Math.max(0, maxBytes - (total - buffer.length))));
      break;
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export class NewApiClient {
  constructor(baseURL) {
    this.http = axios.create({
      baseURL,
      timeout: 20000,
      headers: {
        "Content-Type": "application/json"
      },
      validateStatus: () => true
    });
  }

  async requestWithFallback(options, fallbackPaths = []) {
    const paths = [options.path, ...fallbackPaths].filter(Boolean);
    let lastError = null;

    for (let index = 0; index < paths.length; index += 1) {
      try {
        return await this.request({
          ...options,
          path: paths[index]
        });
      } catch (error) {
        lastError = error;
        const status = Number(error?.status) || 0;
        const shouldFallback = index < paths.length - 1 && [404, 405].includes(status);
        if (!shouldFallback) {
          throw error;
        }
      }
    }

    throw lastError || new Error("请求失败");
  }

  async request({ method, path, token, params, data, userId, headers: extraHeaders, raw = false }) {
    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (userId) {
      headers["New-Api-User"] = String(userId);
    }
    if (extraHeaders && typeof extraHeaders === "object") {
      Object.assign(headers, extraHeaders);
    }

    const response = await this.http.request({
      method,
      url: path,
      headers,
      params,
      data
    });

    const payload = response.data;

    if (response.status >= 400) {
      throw new ApiRequestError(pickMessage(payload), {
        status: response.status,
        payload
      });
    }

    if (payload && typeof payload === "object" && payload.message === "error") {
      throw new ApiRequestError(pickMessage(payload) || "请求失败", {
        status: response.status,
        payload
      });
    }

    if (payload && typeof payload === "object" && payload.success === false) {
      throw new ApiRequestError(pickMessage(payload), {
        status: response.status,
        payload
      });
    }

    if (raw) {
      return payload;
    }

    return unwrapData(payload);
  }

  async requestStream({ method, path, token, params, data, userId, headers: extraHeaders }) {
    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (userId) {
      headers["New-Api-User"] = String(userId);
    }
    if (extraHeaders && typeof extraHeaders === "object") {
      Object.assign(headers, extraHeaders);
    }

    const response = await this.http.request({
      method,
      url: path,
      headers,
      params,
      data,
      responseType: "stream"
    });

    if (response.status >= 400) {
      const payload = await readStreamPayload(response.data);
      throw new ApiRequestError(pickMessage(payload), {
        status: response.status,
        payload
      });
    }

    return response;
  }

  getUserSelf(auth) {
    return this.request({
      method: "GET",
      path: "/api/user/self",
      token: auth.token,
      userId: auth.userId
    });
  }

  getUserGroups(auth) {
    return this.request({
      method: "GET",
      path: "/api/user/self/groups",
      token: auth.token,
      userId: auth.userId,
      raw: true
    }).then((payload) => unwrapData(payload));
  }

  updateUserSelf(auth, payload) {
    return this.request({
      method: "PUT",
      path: "/api/user/self",
      token: auth.token,
      userId: auth.userId,
      data: payload,
      raw: true
    });
  }

  sendEmailVerification({ email, turnstile = "" }) {
    return this.request({
      method: "GET",
      path: "/api/verification",
      params: {
        email,
        turnstile
      },
      raw: true
    });
  }

  async loginByTelegram({ botToken, telegramUser }) {
    const params = {
      id: String(telegramUser?.id || ""),
      auth_date: String(Math.floor(Date.now() / 1000))
    };
    if (telegramUser?.first_name) params.first_name = String(telegramUser.first_name);
    if (telegramUser?.last_name) params.last_name = String(telegramUser.last_name);
    if (telegramUser?.username) params.username = String(telegramUser.username);

    const dataCheckString = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("\n");
    const secret = crypto.createHash("sha256").update(String(botToken || "")).digest();
    params.hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

    const response = await this.http.request({
      method: "GET",
      url: "/api/oauth/telegram/login",
      params,
      maxRedirects: 0
    });
    const payload = response.data;

    if (response.status >= 400) {
      throw new ApiRequestError(pickMessage(payload), {
        status: response.status,
        payload
      });
    }
    if (payload && typeof payload === "object" && payload.success === false) {
      throw new ApiRequestError(pickMessage(payload), {
        status: response.status,
        payload
      });
    }

    return {
      data: unwrapData(payload),
      cookie: buildCookieHeader(response.headers["set-cookie"])
    };
  }

  bindEmailWithCookie({ cookie, email, code }) {
    return this.request({
      method: "GET",
      path: "/api/oauth/email/bind",
      headers: cookie ? { Cookie: cookie } : undefined,
      params: {
        email,
        code
      },
      raw: true
    });
  }

  updateUserSetting(auth, payload) {
    return this.request({
      method: "PUT",
      path: "/api/user/setting",
      token: auth.token,
      userId: auth.userId,
      data: payload,
      raw: true
    });
  }

  getDataSelf(auth, { startTimestamp, endTimestamp } = {}) {
    return this.request({
      method: "GET",
      path: "/api/data/self",
      token: auth.token,
      userId: auth.userId,
      params: {
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp
      }
    });
  }

  listTokens(auth, { page = 1, size = 100 } = {}) {
    return this.request({
      method: "GET",
      path: "/api/token/",
      token: auth.token,
      userId: auth.userId,
      params: {
        p: page,
        size
      }
    });
  }

  createToken(auth, payload) {
    return this.request({
      method: "POST",
      path: "/api/token/",
      token: auth.token,
      userId: auth.userId,
      data: payload
    });
  }

  deleteToken(auth, id) {
    return this.requestWithFallback({
      method: "DELETE",
      path: `/api/token/${encodeURIComponent(String(id))}`,
      token: auth.token,
      userId: auth.userId
    }, [`/api/token/${encodeURIComponent(String(id))}/`]);
  }

  getTokenById(auth, id) {
    return this.requestWithFallback({
      method: "GET",
      path: `/api/token/${encodeURIComponent(String(id))}`,
      token: auth.token,
      userId: auth.userId
    }, [`/api/token/${encodeURIComponent(String(id))}/`]);
  }

  updateToken(auth, payload, { statusOnly = false } = {}) {
    return this.request({
      method: "PUT",
      path: "/api/token/",
      token: auth.token,
      userId: auth.userId,
      params: statusOnly ? { status_only: "true" } : undefined,
      data: payload
    });
  }

  deleteTokenBatch(auth, ids) {
    return this.request({
      method: "POST",
      path: "/api/token/batch",
      token: auth.token,
      userId: auth.userId,
      data: { ids }
    });
  }

  redeemCode(auth, code) {
    return this.request({
      method: "POST",
      path: "/api/user/topup",
      token: auth.token,
      userId: auth.userId,
      data: { key: code }
    });
  }

  getTopupInfo(auth) {
    return this.request({
      method: "GET",
      path: "/api/user/topup/info",
      token: auth.token,
      userId: auth.userId
    });
  }

  listMyTopups(auth) {
    return this.request({
      method: "GET",
      path: "/api/user/topup/self",
      token: auth.token,
      userId: auth.userId
    });
  }

  getPayAmount(auth, amount) {
    return this.request({
      method: "POST",
      path: "/api/user/amount",
      token: auth.token,
      userId: auth.userId,
      data: { amount },
      raw: true
    });
  }

  createPayment(auth, payload) {
    return this.request({
      method: "POST",
      path: "/api/user/pay",
      token: auth.token,
      userId: auth.userId,
      data: payload,
      raw: true
    });
  }

  getSubscriptionPlans(auth) {
    return this.request({
      method: "GET",
      path: "/api/subscription/plans",
      token: auth.token,
      userId: auth.userId
    });
  }

  getSubscriptionSelf(auth) {
    return this.request({
      method: "GET",
      path: "/api/subscription/self",
      token: auth.token,
      userId: auth.userId
    });
  }

  updateSubscriptionPreference(auth, billingPreference) {
    return this.request({
      method: "PUT",
      path: "/api/subscription/self/preference",
      token: auth.token,
      userId: auth.userId,
      data: {
        billing_preference: billingPreference
      }
    });
  }

  createSubscriptionEpay(auth, { planId, paymentMethod }) {
    return this.request({
      method: "POST",
      path: "/api/subscription/epay/pay",
      token: auth.token,
      userId: auth.userId,
      data: {
        plan_id: planId,
        payment_method: paymentMethod
      },
      raw: true
    });
  }

  createSubscriptionStripe(auth, { planId }) {
    return this.request({
      method: "POST",
      path: "/api/subscription/stripe/pay",
      token: auth.token,
      userId: auth.userId,
      data: {
        plan_id: planId
      },
      raw: true
    });
  }

  createSubscriptionCreem(auth, { planId }) {
    return this.request({
      method: "POST",
      path: "/api/subscription/creem/pay",
      token: auth.token,
      userId: auth.userId,
      data: {
        plan_id: planId
      },
      raw: true
    });
  }

  getModels(auth) {
    return this.request({
      method: "GET",
      path: "/api/user/models",
      token: auth.token,
      userId: auth.userId,
      raw: true
    }).then(async (payload) => {
      if (countListItems(payload) > 0) {
        return unwrapData(payload);
      }
      const fallback = await this.request({
        method: "GET",
        path: "/api/models",
        token: auth.token,
        userId: auth.userId,
        raw: true
      });
      return unwrapData(fallback);
    }).catch(async (error) => {
      if (![404, 405].includes(Number(error?.status) || 0)) {
        throw error;
      }
      return this.request({
        method: "GET",
        path: "/api/models",
        token: auth.token,
        userId: auth.userId
      });
    });
  }

  getRelayModelsByKey(key) {
    return this.request({
      method: "GET",
      path: "/v1/models",
      token: key,
      raw: true
    }).then((payload) => unwrapData(payload));
  }

  getLogs(auth, { p = 1, pageSize = 20, tokenName = "", modelName = "", startTimestamp = 0, endTimestamp = 0 } = {}) {
    const params = { p, page_size: pageSize };
    if (tokenName) params.token_name = tokenName;
    if (modelName) params.model_name = modelName;
    if (startTimestamp) params.start_timestamp = startTimestamp;
    if (endTimestamp) params.end_timestamp = endTimestamp;

    return this.requestWithFallback({
      method: "GET",
      path: "/api/log/self",
      token: auth.token,
      userId: auth.userId,
      params
    }, ["/api/log/self/"]);
  }

  getAffiliate(auth) {
    return this.request({
      method: "GET",
      path: "/api/user/aff",
      token: auth.token,
      userId: auth.userId
    });
  }
}
