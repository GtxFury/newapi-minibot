import crypto from "node:crypto";
import axios from "axios";

function pickMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return "请求失败";
  }
  return payload.message || payload.msg || payload.error || payload.detail || "请求失败";
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

export class TelegramRegisterService {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.botToken = options.botToken;
    this.adminToken = options.adminToken;
    this.adminUserId = Number(options.adminUserId);
    this.usernamePrefix = options.usernamePrefix || "tg_";
    this.passwordSecret = options.passwordSecret || options.botToken;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 20000,
      validateStatus: () => true,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  get enabled() {
    return Boolean(this.botToken && this.adminToken && Number.isFinite(this.adminUserId) && this.adminUserId > 0);
  }

  get canLoginByTelegram() {
    return Boolean(this.botToken);
  }

  get canAutoRegister() {
    return Boolean(this.adminToken && Number.isFinite(this.adminUserId) && this.adminUserId > 0);
  }

  normalizeUsernamePrefix() {
    const clean = String(this.usernamePrefix || "tg_").replace(/[^a-zA-Z0-9_]/g, "") || "tg_";
    return clean.slice(0, 10);
  }

  sanitizeUsernamePart(input) {
    return String(input || "")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_");
  }

  buildUsernameCandidate(basePart, suffix = "") {
    const maxLen = 20;
    const prefix = this.normalizeUsernamePrefix();
    const safeBase = this.sanitizeUsernamePart(basePart);
    const safeSuffix = this.sanitizeUsernamePart(suffix);

    const suffixLen = safeSuffix ? safeSuffix.length + 1 : 0;
    const baseMax = Math.max(1, maxLen - prefix.length - suffixLen);
    const finalBase = (safeBase || "u").slice(0, baseMax);
    const candidate = `${prefix}${finalBase}${safeSuffix ? `_${safeSuffix}` : ""}`;
    return candidate.slice(0, maxLen);
  }

  usernameForTelegramId(telegramId) {
    const prefix = this.normalizeUsernamePrefix();
    const idPart = String(telegramId).replace(/[^0-9]/g, "");
    let username = `${prefix}${idPart}`;
    if (username.length > 20) {
      const remain = Math.max(1, 20 - idPart.length);
      username = `${prefix.slice(0, remain)}${idPart}`.slice(0, 20);
    }
    return username;
  }

  usernameCandidatesForTelegramUser(telegramUser) {
    const candidates = [];
    const idPart = String(telegramUser?.id || "").replace(/[^0-9]/g, "");
    const tgUsername = this.sanitizeUsernamePart(telegramUser?.username || "");

    if (tgUsername) {
      candidates.push(this.buildUsernameCandidate(tgUsername));
      if (idPart) {
        candidates.push(this.buildUsernameCandidate(tgUsername, idPart.slice(-4)));
      }
    }
    candidates.push(this.usernameForTelegramId(telegramUser?.id));

    return [...new Set(candidates.filter(Boolean))];
  }

  isCredentialError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    const needles = [
      "用户名或密码错误",
      "账号或密码错误",
      "password",
      "credential",
      "invalid",
      "incorrect"
    ];
    return needles.some((item) => message.includes(item));
  }

  passwordForTelegramId(telegramId) {
    return crypto
      .createHmac("sha256", this.passwordSecret)
      .update(String(telegramId))
      .digest("base64url")
      .slice(0, 20);
  }

  buildTelegramAuthParams(telegramUser) {
    const params = {
      id: String(telegramUser.id),
      auth_date: String(Math.floor(Date.now() / 1000))
    };

    if (telegramUser.first_name) params.first_name = String(telegramUser.first_name);
    if (telegramUser.last_name) params.last_name = String(telegramUser.last_name);
    if (telegramUser.username) params.username = String(telegramUser.username);

    const dataCheckString = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("\n");

    const secret = crypto.createHash("sha256").update(this.botToken).digest();
    const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

    return {
      ...params,
      hash
    };
  }

  async telegramLogin(params) {
    const response = await this.http.get("/api/oauth/telegram/login", { params });
    const payload = response.data;

    if (response.status >= 400) {
      throw new Error(pickMessage(payload));
    }

    if (!payload?.success) {
      throw new Error(pickMessage(payload));
    }

    return {
      user: payload.data,
      cookie: buildCookieHeader(response.headers["set-cookie"])
    };
  }

  async createUserByAdmin(username, password) {
    const response = await this.http.post(
      "/api/user/",
      {
        username,
        password,
        display_name: username,
        role: 1
      },
      {
        headers: {
          Authorization: `Bearer ${this.adminToken}`,
          "New-Api-User": String(this.adminUserId)
        }
      }
    );

    const payload = response.data;

    if (response.status >= 400) {
      throw new Error(pickMessage(payload));
    }

    if (payload?.success === true) {
      return;
    }

    const message = pickMessage(payload);
    // 用户名已存在时允许继续走登录
    if (message.includes("存在") || message.includes("exists") || message.includes("duplicate")) {
      return;
    }

    throw new Error(message);
  }

  async loginByPassword(username, password) {
    const response = await this.http.post("/api/user/login", {
      username,
      password
    });

    const payload = response.data;
    if (response.status >= 400) {
      throw new Error(pickMessage(payload));
    }
    if (!payload?.success) {
      throw new Error(pickMessage(payload));
    }

    const cookie = buildCookieHeader(response.headers["set-cookie"]);
    if (!cookie) {
      throw new Error("登录后未获得会话 Cookie，无法继续绑定 Telegram");
    }

    return {
      cookie,
      user: payload.data
    };
  }

  async bindTelegram(cookie, params) {
    const response = await this.http.get("/api/oauth/telegram/bind", {
      params,
      maxRedirects: 0,
      headers: {
        Cookie: cookie
      }
    });

    if (response.status === 302) {
      return;
    }

    const payload = response.data;
    if (payload?.success === true) {
      return;
    }

    const message = pickMessage(payload);
    if (message.includes("已被绑定") || message.includes("already")) {
      return;
    }

    throw new Error(message || "绑定 Telegram 失败");
  }

  async generateAccessToken(cookie, userId) {
    const response = await this.http.get("/api/user/token", {
      headers: {
        Cookie: cookie,
        "New-Api-User": String(userId)
      }
    });

    const payload = response.data;
    if (response.status >= 400) {
      throw new Error(pickMessage(payload));
    }
    if (!payload?.success) {
      throw new Error(pickMessage(payload));
    }
    return payload.data;
  }

  async registerOrLoginByTelegram(telegramUser) {
    if (!this.canLoginByTelegram) {
      throw new Error("Telegram OAuth 未启用：缺少 BOT_TOKEN");
    }

    const authParams = this.buildTelegramAuthParams(telegramUser);

    // 已绑定用户：直接登录
    try {
      const loginRes = await this.telegramLogin(authParams);
      const data = loginRes.user;
      let accessToken = "";
      try {
        if (loginRes.cookie && data?.id) {
          accessToken = await this.generateAccessToken(loginRes.cookie, data.id);
        }
      } catch {
        // 不阻断主流程
      }
      return {
        alreadyRegistered: true,
        user: data || null,
        username: data?.username || this.usernameForTelegramId(telegramUser.id),
        accessToken
      };
    } catch (error) {
      const message = String(error?.message || error || "");
      if (!message.includes("未绑定") && !message.includes("not")) {
        throw error;
      }
    }

    if (!this.canAutoRegister) {
      throw new Error("该 Telegram 尚未绑定账号，且未配置管理员凭证，无法自动注册。请联系管理员开启自动注册或先在网页端绑定一次。");
    }

    // 未绑定：创建用户 -> 登录 -> 绑定 -> 再走 telegram 登录确认
    const password = this.passwordForTelegramId(telegramUser.id);
    const candidates = this.usernameCandidatesForTelegramUser(telegramUser);
    let username = "";
    let loginResult = null;
    let lastCredentialError = null;

    for (const candidate of candidates) {
      await this.createUserByAdmin(candidate, password);
      try {
        loginResult = await this.loginByPassword(candidate, password);
        username = candidate;
        break;
      } catch (error) {
        if (this.isCredentialError(error)) {
          lastCredentialError = error;
          continue;
        }
        throw error;
      }
    }

    if (!loginResult || !username) {
      if (lastCredentialError) {
        throw lastCredentialError;
      }
      throw new Error("自动注册失败：无法为该 Telegram 账户分配可用用户名。");
    }

    const userId = loginResult.user?.id;
    if (!userId) {
      throw new Error("登录成功但未获取用户 ID");
    }

    await this.bindTelegram(loginResult.cookie, authParams);

    const finalLogin = await this.telegramLogin(authParams);
    const finalUser = finalLogin.user;

    let accessToken = "";
    try {
      const cookieForToken = finalLogin.cookie || loginResult.cookie;
      accessToken = await this.generateAccessToken(cookieForToken, finalUser?.id || userId);
    } catch {
      // access token 获取失败不影响注册主流程
    }

    return {
      alreadyRegistered: false,
      user: finalUser,
      username,
      accessToken
    };
  }
}
