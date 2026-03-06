import path from "node:path";

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parsePositiveInt(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    return defaultValue;
  }
  return n;
}

export function loadConfig(env = process.env) {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error("缺少 BOT_TOKEN，请在 .env 中配置");
  }

  const baseUrl = (env.NEWAPI_BASE_URL || "https://api.newapi.ai").trim().replace(/\/+$/, "");
  const tokenStorePath = path.resolve(process.cwd(), env.TOKEN_STORE_PATH || "./data/user_tokens.json");
  const defaultNewapiUserId = env.DEFAULT_NEWAPI_USER_ID ? Number(env.DEFAULT_NEWAPI_USER_ID) : null;
  const registerAdminUserId = env.REGISTER_ADMIN_USER_ID ? Number(env.REGISTER_ADMIN_USER_ID) : null;

  return {
    botToken,
    baseUrl,
    defaultNewapiToken: env.DEFAULT_NEWAPI_TOKEN?.trim() || "",
    defaultNewapiUserId: Number.isFinite(defaultNewapiUserId) ? defaultNewapiUserId : null,
    allowRuntimeTokenBind: parseBoolean(env.ALLOW_RUNTIME_TOKEN_BIND, true),
    tokenStorePath,
    enableOneClickRegister: parseBoolean(env.ENABLE_ONE_CLICK_REGISTER, false),
    registerAdminToken: env.REGISTER_ADMIN_TOKEN?.trim() || "",
    registerAdminUserId: Number.isFinite(registerAdminUserId) ? registerAdminUserId : null,
    registerUsernamePrefix: env.REGISTER_USERNAME_PREFIX?.trim() || "tg_",
    registerPasswordSecret: env.REGISTER_PASSWORD_SECRET?.trim() || "",
    miniAppEnabled: parseBoolean(env.MINIAPP_ENABLED, true),
    miniAppHost: (env.MINIAPP_HOST || "0.0.0.0").trim(),
    miniAppPort: parsePositiveInt(env.MINIAPP_PORT, 8787),
    miniAppUrl: (env.MINIAPP_URL || "").trim(),
    miniAppDevBypassAuth: parseBoolean(env.MINIAPP_DEV_BYPASS_AUTH, false)
  };
}
