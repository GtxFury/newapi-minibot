const tg = window.Telegram?.WebApp;
const CHAT_KEY_STORAGE_KEY = "miniapp_chat_selected_key";
const CHAT_MODEL_STORAGE_KEY = "miniapp_chat_selected_models";
const CHAT_SESSIONS_STORAGE_KEY = "miniapp_chat_sessions";
const CHAT_CURRENT_SESSION_STORAGE_KEY = "miniapp_chat_current_session";

function safeReadStorage(key, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeWriteStorage(key, value) {
  try {
    if (value === null || value === undefined || value === "") {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, value);
  } catch {}
}

function loadPersistedChatModelSelections() {
  try {
    const raw = safeReadStorage(CHAT_MODEL_STORAGE_KEY, "");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function createChatSessionId() {
  return `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeChatSession(session) {
  if (!session || typeof session !== "object") return null;
  const id = String(session.id || "").trim() || createChatSessionId();
  const messages = Array.isArray(session.messages)
    ? session.messages
        .map((item) => {
          const role = String(item?.role || "").trim();
          const content = String(item?.content || "");
          const model = String(item?.model || "").trim();
          if (!["user", "assistant", "system"].includes(role) || (!content && role !== "assistant")) {
            return null;
          }
          return { role, content, model };
        })
        .filter(Boolean)
    : [];
  return {
    id,
    title: String(session.title || "新对话").trim() || "新对话",
    messages,
    keyId: String(session.keyId || session.key_id || "").trim(),
    modelId: String(session.modelId || session.model_id || "").trim(),
    createdAt: Number(session.createdAt || session.created_at || Date.now()),
    updatedAt: Number(session.updatedAt || session.updated_at || Date.now())
  };
}

function loadPersistedChatSessions() {
  try {
    const raw = safeReadStorage(CHAT_SESSIONS_STORAGE_KEY, "");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeChatSession).filter(Boolean);
  } catch {
    return [];
  }
}

function deriveChatSessionTitle(messages, fallback = "新对话") {
  const firstUser = (messages || []).find((item) => item?.role === "user" && String(item?.content || "").trim());
  if (!firstUser) {
    return fallback;
  }
  const plain = String(firstUser.content || "").replace(/\s+/g, " ").trim();
  if (!plain) return fallback;
  return plain.length > 24 ? `${plain.slice(0, 24)}...` : plain;
}

const appState = {
  telegramUser: null,
  me: null,
  usage: null,
  usageDays: 7,
  plans: [],
  subSelf: null,
  keys: [],
  models: [],
  topupInfo: null,
  topupRecords: null,
  paymentMethods: [],
  selectedPayAmount: 10,
  selectedPayMethod: "",
  themePreference: localStorage.getItem("miniapp_theme") || "auto",
  keyFilter: { search: "", status: "all" },
  modelSearch: "",
  editingKeyId: null,
  logs: [],
  logPage: 1,
  logHasMore: true,
  logSearch: "",
  logLoading: false,
  affiliate: null,
  chatInitialized: false,
  chatLoading: false,
  chatMessages: [],
  chatSessions: loadPersistedChatSessions(),
  currentChatSessionId: safeReadStorage(CHAT_CURRENT_SESSION_STORAGE_KEY, "") || null,
  chatKeys: [],
  selectedChatKeyId: safeReadStorage(CHAT_KEY_STORAGE_KEY, "") || null,
  selectedChatModel: "",
  chatModelSelections: loadPersistedChatModelSelections(),
  chatBusy: false,
  chatKeyMissing: false,
  chatKeyCreating: false,
  chatModelsRefreshing: false,
  modelsRequestPromise: null,
  chatSessionsDrawerOpen: false,
  chatKeyPickerOpen: false,
  chatModelPickerOpen: false
};

const els = {
  root: document.documentElement,
  scrollArea: document.getElementById("scrollArea"),
  toast: document.getElementById("toast"),
  refreshBtn: document.getElementById("refreshBtn"),
  themeBtn: document.getElementById("themeBtn"),
  tabs: document.getElementById("tabs"),
  userName: document.getElementById("userName"),
  currentDate: document.getElementById("currentDate"),
  statBalance: document.getElementById("statBalance"),
  statUsage: document.getElementById("statUsage"),
  statSub: document.getElementById("statSub"),
  statAffiliate: document.getElementById("statAffiliate"),
  authBadge: document.getElementById("authBadge"),
  usageBlock: document.getElementById("usageBlock"),
  usageRangeButtons: document.getElementById("usageRangeButtons"),
  modelsList: document.getElementById("modelsList"),
  modelSearchInput: document.getElementById("modelSearchInput"),
  newKeyName: document.getElementById("newKeyName"),
  newKeyGroup: document.getElementById("newKeyGroup"),
  newKeyQuota: document.getElementById("newKeyQuota"),
  createKeyBtn: document.getElementById("createKeyBtn"),
  keySearchInput: document.getElementById("keySearchInput"),
  keysResetBtn: document.getElementById("keysResetBtn"),
  keysList: document.getElementById("keysList"),
  logsList: document.getElementById("logsList"),
  logSearchInput: document.getElementById("logSearchInput"),
  loadMoreLogsBtn: document.getElementById("loadMoreLogsBtn"),
  amountOptions: document.getElementById("amountOptions"),
  methodOptions: document.getElementById("methodOptions"),
  payAmountInput: document.getElementById("payAmountInput"),
  payBtn: document.getElementById("payBtn"),
  payLink: document.getElementById("payLink"),
  subSelf: document.getElementById("subSelf"),
  plansList: document.getElementById("plansList"),
  plansCount: document.getElementById("plansCount"),
  topupList: document.getElementById("topupList"),
  redeemInput: document.getElementById("redeemInput"),
  redeemBtn: document.getElementById("redeemBtn"),
  keyEditorModal: document.getElementById("keyEditorModal"),
  keyEditorCloseBtn: document.getElementById("keyEditorCloseBtn"),
  keyEditorMeta: document.getElementById("keyEditorMeta"),
  editorName: document.getElementById("editorName"),
  editorGroup: document.getElementById("editorGroup"),
  editorQuota: document.getElementById("editorQuota"),
  editorExpire: document.getElementById("editorExpire"),
  editorUnlimited: document.getElementById("editorUnlimited"),
  editorStatus: document.getElementById("editorStatus"),
  editorAllowIps: document.getElementById("editorAllowIps"),
  editorKeyValue: document.getElementById("editorKeyValue"),
  editorCopyKeyBtn: document.getElementById("editorCopyKeyBtn"),
  editorSaveBtn: document.getElementById("editorSaveBtn"),
  editorModelLimitToggle: document.getElementById("editorModelLimitToggle"),
  editorModelLimitBox: document.getElementById("editorModelLimitBox"),
  editorModelLimits: document.getElementById("editorModelLimits"),
  inviteBtn: document.getElementById("inviteBtn"),
  affiliateModal: document.getElementById("affiliateModal"),
  affCloseBtn: document.getElementById("affCloseBtn"),
  affLinkInput: document.getElementById("affLinkInput"),
  affCopyBtn: document.getElementById("affCopyBtn"),
  affQuotaText: document.getElementById("affQuotaText"),
  affHistoryText: document.getElementById("affHistoryText"),
  openModelsPageBtn: document.getElementById("openModelsPageBtn"),
  modelsPage: document.getElementById("modelsPage"),
  closeModelsPageBtn: document.getElementById("closeModelsPageBtn"),
  chatSessionTitle: document.getElementById("chatSessionTitle"),
  chatSessionsBtn: document.getElementById("chatSessionsBtn"),
  chatNewSessionBtn: document.getElementById("chatNewSessionBtn"),
  chatSessionsDrawer: document.getElementById("chatSessionsDrawer"),
  chatSessionsBackdrop: document.getElementById("chatSessionsBackdrop"),
  chatSessionsCloseBtn: document.getElementById("chatSessionsCloseBtn"),
  chatSessionsCreateBtn: document.getElementById("chatSessionsCreateBtn"),
  chatSessionsList: document.getElementById("chatSessionsList"),
  chatStatusText: document.getElementById("chatStatusText"),
  chatKeyBadge: document.getElementById("chatKeyBadge"),
  chatKeyPicker: document.getElementById("chatKeyPicker"),
  chatKeyPickerBtn: document.getElementById("chatKeyPickerBtn"),
  chatKeyPickerValue: document.getElementById("chatKeyPickerValue"),
  chatKeyPickerMenu: document.getElementById("chatKeyPickerMenu"),
  chatModelPicker: document.getElementById("chatModelPicker"),
  chatModelPickerBtn: document.getElementById("chatModelPickerBtn"),
  chatModelPickerValue: document.getElementById("chatModelPickerValue"),
  chatModelPickerMenu: document.getElementById("chatModelPickerMenu"),
  chatEmptyState: document.getElementById("chatEmptyState"),
  chatEmptyTitle: document.getElementById("chatEmptyTitle"),
  chatKeyHint: document.getElementById("chatKeyHint"),
  chatEnsureBtn: document.getElementById("chatEnsureBtn"),
  chatMessages: document.getElementById("chatMessages"),
  chatComposer: document.getElementById("chatComposer"),
  chatComposerHint: document.getElementById("chatComposerHint"),
  chatInput: document.getElementById("chatInput"),
  chatSendBtn: document.getElementById("chatSendBtn"),
};

function toast(message, type = "info") {
  const node = els.toast;
  node.textContent = message;
  node.className = `toast-hub show ${type === "error" ? "error" : ""}`;
  setTimeout(() => node.classList.remove("show"), 2800);
}

function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatChatContent(value) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function formatDate(ts) {
  if (!ts || ts <= 0) return "永不过期";
  return new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function extractErrorText(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractErrorText(item)).filter(Boolean).join(" ").trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  for (const key of ["message", "error", "detail", "description", "msg", "type", "reason"]) {
    const text = extractErrorText(value[key]);
    if (text) {
      return text;
    }
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function buildMiniApiHeaders() {
  const headers = { "Content-Type": "application/json" };
  const initData = tg?.initData || "";
  if (initData) {
    headers["x-telegram-init-data"] = initData;
  } else {
    const devId = new URLSearchParams(window.location.search).get("tg_user_id");
    if (devId) headers["x-miniapp-dev-user"] = devId;
  }
  return headers;
}

function formatFullDate(ts) {
  if (!ts || ts <= 0) return "-";
  return new Date(ts * 1000).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function normalizeNumber(v) {
  const n = Number(v);
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

const DEFAULT_QUOTA_PER_UNIT = 500000;

function getQuotaPerUnit() {
  const raw = Number.parseFloat(localStorage.getItem("quota_per_unit") || "");
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_QUOTA_PER_UNIT;
}

function quotaToUsd(quota) {
  const value = Number(quota || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value / getQuotaPerUnit();
}

function formatUsdValue(amount, digits = 2) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatQuotaAsUsd(quota, digits = 2, { withSymbol = true } = {}) {
  const usd = quotaToUsd(quota);
  const formatted = formatUsdValue(usd, digits);
  return withSymbol ? `$${formatted}` : formatted;
}

const MODEL_USAGE_COLORS = ["#10a37f", "#0a84ff", "#8b5cf6", "#f59e0b", "#ef4444", "#14b8a6", "#6366f1", "#ec4899"];

function formatUsageHourKey(timestampMs) {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:00`;
}

function formatUsageHourLabel(hourKey, { includeYear = false } = {}) {
  const [datePart = "", timePart = ""] = String(hourKey || "").split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) {
    return hourKey || "-";
  }
  return `${includeYear ? `${year}-` : ""}${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")} ${timePart}`;
}

function getUsageHourTimestamps(endTimestampMs, days) {
  const points = [];
  const totalHours = Math.max(1, Number(days || 1) * 24);
  const end = new Date(endTimestampMs);
  end.setMinutes(0, 0, 0);
  const endMs = end.getTime();
  const startMs = endMs - (totalHours - 1) * 3600 * 1000;

  for (let ts = startMs; ts <= endMs; ts += 3600 * 1000) {
    points.push(ts);
  }
  return points;
}

function getModelUsageColor(index) {
  return MODEL_USAGE_COLORS[index % MODEL_USAGE_COLORS.length];
}

function toArray(data, candidates = ["items", "list", "tokens", "rows", "data"]) {
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

function formatPlanDuration(plan) {
  const unit = String(plan?.duration_unit || "").trim().toLowerCase();
  const value = Number(plan?.duration_value ?? 0);
  const customSeconds = Number(plan?.custom_seconds || 0);
  const days = Number(plan?.days || 0);

  if (unit === "custom") {
    if (customSeconds >= 86400) return `${Math.floor(customSeconds / 86400)}天`;
    if (customSeconds >= 3600) return `${Math.floor(customSeconds / 3600)}小时`;
    if (customSeconds > 0) return `${customSeconds}秒`;
  }

  if (value > 0) {
    const unitLabels = {
      year: "年",
      month: "个月",
      day: "天",
      hour: "小时"
    };
    return `${value}${unitLabels[unit] || unit}`;
  }

  if (days > 0) {
    return `${days}天`;
  }

  return "周期未设置";
}

function normalizePlans(data) {
  return toArray(data).map((item) => {
    const plan = item?.plan || item;
    if (!plan || typeof plan !== "object") {
      return null;
    }
    return {
      ...plan,
      duration_label: formatPlanDuration(plan)
    };
  }).filter(Boolean);
}

function normalizeModels(data) {
  return toArray(data).map((item) => {
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
  }).filter(Boolean);
}

function normalizePaymentMethods(info) {
  let list = Array.isArray(info?.pay_methods)
    ? info.pay_methods
    : Array.isArray(info?.payment_methods)
      ? info.payment_methods
      : [];

  if (!list.length && typeof info?.pay_methods === "string" && info.pay_methods.trim()) {
    try {
      const parsed = JSON.parse(info.pay_methods);
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      list = [];
    }
  }

  const methods = list.map((item) => {
    if (typeof item === "string") {
      return item.trim();
    }
    if (!item || typeof item !== "object") {
      return "";
    }
    if (item.enabled === false || item.available === false || item.status === false) {
      return "";
    }
    return String(item.method || item.type || item.code || item.value || item.id || item.name || "").trim();
  }).filter((item) => item && !["stripe", "creem"].includes(item.toLowerCase()));

  return [...new Set(methods.length ? methods : ["alipay", "wxpay"])];
}

function normalizeAffiliateData(data) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const affCode = String(data.aff_code || data.code || "").trim();
    return {
      raw: data,
      affCode,
      quota: Number(data.quota || data.history_amount || 0),
      ratio: Number(data.ratio || 0)
    };
  }

  const affCode = String(data || "").trim();
  return {
    raw: affCode ? { aff_code: affCode } : null,
    affCode,
    quota: 0,
    ratio: 0
  };
}

function renderPaymentIcon(method, { compact = false } = {}) {
  const key = String(method || "").trim().toLowerCase();

  if (["alipay"].includes(key)) {
    return compact
      ? `<span class="plan-pay-icon" aria-hidden="true"><svg fill="currentColor" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.695 15.07c3.426 1.158 4.203 1.22 4.203 1.22V3.846c0-2.124-1.705-3.845-3.81-3.845H3.914C1.808.001.102 1.722.102 3.846v16.31c0 2.123 1.706 3.845 3.813 3.845h16.173c2.105 0 3.81-1.722 3.81-3.845v-.157s-6.19-2.602-9.315-4.119c-2.096 2.602-4.8 4.181-7.607 4.181-4.75 0-6.361-4.19-4.112-6.949.49-.602 1.324-1.175 2.617-1.497 2.025-.502 5.247.313 8.266 1.317a16.796 16.796 0 0 0 1.341-3.302H5.781v-.952h4.799V6.975H4.77v-.953h5.81V3.591s0-.409.411-.409h2.347v2.84h5.744v.951h-5.744v1.704h4.69a19.453 19.453 0 0 1-1.986 5.06c1.424.52 2.702 1.011 3.654 1.333m-13.81-2.032c-.596.06-1.71.325-2.321.869-1.83 1.608-.735 4.55 2.968 4.55 2.151 0 4.301-1.388 5.99-3.61-2.403-1.182-4.438-2.028-6.637-1.809"/></svg></span>`
      : `<span class="method-brand method-brand--alipay" aria-hidden="true"><svg fill="currentColor" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.695 15.07c3.426 1.158 4.203 1.22 4.203 1.22V3.846c0-2.124-1.705-3.845-3.81-3.845H3.914C1.808.001.102 1.722.102 3.846v16.31c0 2.123 1.706 3.845 3.813 3.845h16.173c2.105 0 3.81-1.722 3.81-3.845v-.157s-6.19-2.602-9.315-4.119c-2.096 2.602-4.8 4.181-7.607 4.181-4.75 0-6.361-4.19-4.112-6.949.49-.602 1.324-1.175 2.617-1.497 2.025-.502 5.247.313 8.266 1.317a16.796 16.796 0 0 0 1.341-3.302H5.781v-.952h4.799V6.975H4.77v-.953h5.81V3.591s0-.409.411-.409h2.347v2.84h5.744v.951h-5.744v1.704h4.69a19.453 19.453 0 0 1-1.986 5.06c1.424.52 2.702 1.011 3.654 1.333m-13.81-2.032c-.596.06-1.71.325-2.321.869-1.83 1.608-.735 4.55 2.968 4.55 2.151 0 4.301-1.388 5.99-3.61-2.403-1.182-4.438-2.028-6.637-1.809"/></svg></span>`;
  }

  if (["wxpay", "wechat", "wechatpay"].includes(key)) {
    return compact
      ? `<span class="plan-pay-icon" aria-hidden="true"><svg fill="currentColor" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/></svg></span>`
      : `<span class="method-brand method-brand--wxpay" aria-hidden="true"><svg fill="currentColor" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/></svg></span>`;
  }

  if (["stripe"].includes(key)) {
    return compact
      ? `<span class="plan-pay-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M13.59 10.02c-1.78-.63-2.08-1.02-2.08-1.64 0-.5.43-.95 1.41-.95 1.41 0 2.84.54 3.63.97l.61-3.23A9.83 9.83 0 0 0 13.37 4c-3.11 0-5.28 1.63-5.28 4.35 0 2.03 1.53 3.2 3.79 3.97 1.85.66 2.23 1.08 2.23 1.74 0 .66-.57 1.07-1.67 1.07-1.53 0-3.22-.63-4.38-1.26l-.65 3.33c1.1.54 3.14 1.02 5.03 1.02 3.2 0 5.55-1.58 5.55-4.42 0-2.19-1.3-3.38-4.4-4.48Z" fill="currentColor"/></svg></span>`
      : `<span class="method-brand method-brand--stripe" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M13.59 10.02c-1.78-.63-2.08-1.02-2.08-1.64 0-.5.43-.95 1.41-.95 1.41 0 2.84.54 3.63.97l.61-3.23A9.83 9.83 0 0 0 13.37 4c-3.11 0-5.28 1.63-5.28 4.35 0 2.03 1.53 3.2 3.79 3.97 1.85.66 2.23 1.08 2.23 1.74 0 .66-.57 1.07-1.67 1.07-1.53 0-3.22-.63-4.38-1.26l-.65 3.33c1.1.54 3.14 1.02 5.03 1.02 3.2 0 5.55-1.58 5.55-4.42 0-2.19-1.3-3.38-4.4-4.48Z" fill="currentColor"/></svg></span>`;
  }

  return compact
    ? `<span class="plan-pay-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Zm2.5-.5a.5.5 0 0 0-.5.5v2h12v-2a.5.5 0 0 0-.5-.5h-11ZM6 11v6.5c0 .276.224.5.5.5h11a.5.5 0 0 0 .5-.5V11H6Zm2.25 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Z" fill="currentColor"/></svg></span>`
    : `<span class="method-brand method-brand--default" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Zm2.5-.5a.5.5 0 0 0-.5.5v2h12v-2a.5.5 0 0 0-.5-.5h-11ZM6 11v6.5c0 .276.224.5.5.5h11a.5.5 0 0 0 .5-.5V11H6Zm2.25 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Z" fill="currentColor"/></svg></span>`;
}

function getPaymentMeta(method) {
  const key = String(method || "").trim().toLowerCase();
  if (key === "alipay") {
    return { label: "支付宝", code: "ALIPAY" };
  }
  if (["wxpay", "wechat", "wechatpay"].includes(key)) {
    return { label: "微信支付", code: "WXPAY" };
  }
  if (key === "stripe") {
    return { label: "Stripe", code: "STRIPE" };
  }
  return { label: String(method || "").trim() || "支付方式", code: String(method || "").trim().toUpperCase() || "PAY" };
}

function normalizeDelimitedText(value) {
  return String(value || "")
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
}

function openPayLink(url) {
  const payUrl = String(url || "").trim();
  if (!payUrl) {
    if (els.payLink) {
      els.payLink.hidden = true;
      els.payLink.removeAttribute("href");
    }
    return;
  }

  if (els.payLink) {
    els.payLink.href = payUrl;
    els.payLink.hidden = false;
  }

  if (tg?.openLink) {
    tg.openLink(payUrl);
  } else {
    window.open(payUrl, "_blank", "noopener");
  }
}

async function api(path, options = {}) {
  const resp = await fetch(path, {
    method: options.method || "GET",
    headers: buildMiniApiHeaders(),
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.success === false) {
    const message = extractErrorText(json.message) || `Error ${resp.status}`;
    const detail = extractErrorText(json.detail);
    throw new Error(detail && detail !== message ? `${message}：${detail}` : message);
  }
  return json;
}

function extractStreamDelta(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = choice?.delta?.content ?? choice?.message?.content ?? "";
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .join("");
  }
  return "";
}

async function streamChatCompletion(payload, onDelta) {
  const resp = await fetch("/miniapi/chat/completions", {
    method: "POST",
    headers: buildMiniApiHeaders(),
    body: JSON.stringify({ ...payload, stream: true })
  });

  if (!resp.ok) {
    const text = await resp.text();
    try {
      const json = JSON.parse(text);
      const message = extractErrorText(json.message) || `Error ${resp.status}`;
      const detail = extractErrorText(json.detail);
      throw new Error(detail && detail !== message ? `${message}：${detail}` : message);
    } catch {
      throw new Error(text || `Error ${resp.status}`);
    }
  }

  if (!resp.body) {
    throw new Error("当前环境不支持流式响应");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const findBoundary = (text) => {
    const crlf = text.indexOf("\r\n\r\n");
    const lf = text.indexOf("\n\n");
    if (crlf === -1) return lf;
    if (lf === -1) return crlf;
    return Math.min(crlf, lf);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let boundaryIndex = findBoundary(buffer);
    while (boundaryIndex >= 0) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      const separatorLength = buffer.slice(boundaryIndex, boundaryIndex + 4) === "\r\n\r\n" ? 4 : 2;
      buffer = buffer.slice(boundaryIndex + separatorLength);
      const lines = rawEvent.split(/\r?\n/);
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      for (const line of dataLines) {
        if (!line) continue;
        if (line === "[DONE]") {
          return;
        }
        try {
          const parsed = JSON.parse(line);
          const delta = extractStreamDelta(parsed);
          if (delta) {
            onDelta(delta, parsed);
          }
        } catch {
          continue;
        }
      }
      boundaryIndex = findBoundary(buffer);
    }
  }
}

function applyTheme() {
  const pref = appState.themePreference;
  const tgScheme = tg?.colorScheme || "light";
  const final = pref === "auto" ? tgScheme : pref;
  els.root.setAttribute("data-theme", final);
}

function switchTab(tabId) {
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === `panel-${tabId}`));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  if (els.scrollArea) {
    els.scrollArea.scrollTop = 0;
  }
  
  if (tabId === "logs" && appState.logs.length === 0) {
    loadLogs(true);
  }

  if (tabId === "chat") {
    if (!appState.chatInitialized) {
      loadChatBootstrap();
    } else {
      renderChat();
    }
  }
}

function renderOverview() {
  const me = appState.me || {};
  const usage = Array.isArray(appState.usage) ? appState.usage : [];
  const availableQuota = Number(me.quota ?? me.balance ?? 0);
  const historyUsageQuota = usage.reduce((sum, item) => sum + Number(item?.quota || 0), 0);
  const requestCount = Number(
    me.request_count
    ?? me.requestCount
    ?? usage.reduce((sum, item) => sum + Number(item?.count || 0), 0)
  );

  if (els.userName) els.userName.textContent = me.username || me.name || "User";
  if (els.currentDate) els.currentDate.textContent = new Date().toLocaleDateString("zh-CN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  
  if (els.statBalance) els.statBalance.textContent = formatQuotaAsUsd(availableQuota, 2, { withSymbol: false });
  if (els.statUsage) els.statUsage.textContent = formatQuotaAsUsd(historyUsageQuota);
  if (els.statSub) els.statSub.textContent = requestCount.toLocaleString("zh-CN");

  if (appState.affiliate && els.statAffiliate) {
    els.statAffiliate.textContent = `+${appState.affiliate.history_amount || 0}`;
  }

  renderUsageChart();
}

function renderUsageChart() {
  const usage = appState.usage || [];
  els.usageRangeButtons?.querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("active", Number(b.dataset.days) === appState.usageDays));

  if (!Array.isArray(usage) || !usage.length) {
    els.usageBlock.innerHTML = '<div class="usage-empty">暂无用量数据</div>';
    return;
  }
  const byHour = new Map();
  let latestTimestampMs = 0;
  for (const item of usage) {
    const quota = Number(item?.quota || 0);
    const count = Number(item?.count || 0);
    const createdAt = Number(item?.created_at || 0);
    const modelName = String(item?.model_name || item?.model || "其他");
    if (!Number.isFinite(quota) || quota <= 0 || !createdAt) {
      continue;
    }
    const timestampMs = createdAt * 1000;
    latestTimestampMs = Math.max(latestTimestampMs, timestampMs);
    const hourKey = formatUsageHourKey(timestampMs);
    let bucket = byHour.get(hourKey);
    if (!bucket) {
      bucket = { hourKey, totalQuota: 0, totalCount: 0, models: new Map(), counts: new Map() };
      byHour.set(hourKey, bucket);
    }
    bucket.totalQuota += quota;
    bucket.totalCount += count;
    bucket.models.set(modelName, (bucket.models.get(modelName) || 0) + quota);
    bucket.counts.set(modelName, (bucket.counts.get(modelName) || 0) + count);
  }

  if (!byHour.size) {
    els.usageBlock.innerHTML = '<div class="usage-empty">暂无模型消耗数据</div>';
    return;
  }

  const endTimestampMs = latestTimestampMs || Date.now();
  const hourTimestamps = getUsageHourTimestamps(endTimestampMs, appState.usageDays);
  const showYear = hourTimestamps.length > 0
    && new Date(hourTimestamps[0]).getFullYear() !== new Date(hourTimestamps[hourTimestamps.length - 1]).getFullYear();
  const points = hourTimestamps.map((timestampMs) => {
    const hourKey = formatUsageHourKey(timestampMs);
    const existing = byHour.get(hourKey);
    return existing || { hourKey, totalQuota: 0, totalCount: 0, models: new Map(), counts: new Map() };
  });

  const modelTotals = new Map();
  const modelCounts = new Map();
  for (const point of points) {
    for (const [modelName, quota] of point.models.entries()) {
      modelTotals.set(modelName, (modelTotals.get(modelName) || 0) + quota);
    }
    for (const [modelName, count] of point.counts.entries()) {
      modelCounts.set(modelName, (modelCounts.get(modelName) || 0) + count);
    }
  }

  const rankedModels = Array.from(modelTotals.entries()).sort((a, b) => b[1] - a[1]);
  const primaryModels = rankedModels.slice(0, 4).map(([name]) => name);
  const legendModels = [...primaryModels];
  if (rankedModels.length > primaryModels.length) {
    legendModels.push("其他");
  }

  const legend = legendModels.map((name, index) => ({
    name,
    color: name === "其他" ? "#94a3b8" : getModelUsageColor(index)
  }));

  const chartData = points.map((point, index) => {
    const segmentsMap = new Map();
    const countMap = new Map();
    let otherQuota = 0;
    let otherCount = 0;
    for (const [modelName, quota] of point.models.entries()) {
      const count = point.counts.get(modelName) || 0;
      if (primaryModels.includes(modelName)) {
        segmentsMap.set(modelName, (segmentsMap.get(modelName) || 0) + quota);
        countMap.set(modelName, (countMap.get(modelName) || 0) + count);
      } else {
        otherQuota += quota;
        otherCount += count;
      }
    }
    if (otherQuota > 0) {
      segmentsMap.set("其他", otherQuota);
      countMap.set("其他", otherCount);
    }
    const totalQuota = Array.from(segmentsMap.values()).reduce((sum, value) => sum + value, 0);
    const totalCount = Array.from(countMap.values()).reduce((sum, value) => sum + value, 0);
    const segments = legend
      .map((item) => ({
        name: item.name,
        quota: segmentsMap.get(item.name) || 0,
        count: countMap.get(item.name) || 0,
        color: item.color
      }))
      .filter((item) => item.quota > 0)
      .sort((a, b) => a.quota - b.quota);
    const labelStep = Math.max(1, Math.ceil(points.length / 9));
    const isLast = index === points.length - 1;
    const displayLabel = index % labelStep === 0 || isLast;

    return {
      label: formatUsageHourLabel(point.hourKey, { includeYear: showYear }),
      axisLabel: displayLabel ? formatUsageHourLabel(point.hourKey, { includeYear: showYear }) : "",
      totalQuota,
      totalCount,
      totalUsd: quotaToUsd(totalQuota),
      segments
    };
  });

  const maxQuota = Math.max(...chartData.map((item) => item.totalQuota), 1);
  const totalQuota = chartData.reduce((sum, item) => sum + item.totalQuota, 0);
  const totalCount = chartData.reduce((sum, item) => sum + item.totalCount, 0);
  const topModel = rankedModels[0];
  const yAxisTicks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => ({
    ratio,
    label: formatQuotaAsUsd(maxQuota * ratio, 2)
  }));
  const denseChart = chartData.length > 24;
  const columnWidth = chartData.length > 240 ? 8 : chartData.length > 120 ? 10 : chartData.length > 48 ? 12 : 18;
  const columnGap = chartData.length > 120 ? 4 : chartData.length > 48 ? 6 : 10;

  els.usageBlock.innerHTML = `
    <div class="usage-chart-shell">
      <div class="usage-chart-summary">
        <div class="usage-chart-stat">
          <span class="usage-chart-stat__label">区间消耗</span>
          <strong class="usage-chart-stat__value">${formatUsdValue(quotaToUsd(totalQuota))}</strong>
        </div>
        <div class="usage-chart-stat">
          <span class="usage-chart-stat__label">请求次数</span>
          <strong class="usage-chart-stat__text">${totalCount.toLocaleString("zh-CN")}</strong>
          <span class="usage-chart-stat__meta">${topModel ? `${escapeHtml(topModel[0])} · ${formatQuotaAsUsd(topModel[1])}` : "暂无主力模型"}</span>
        </div>
      </div>
      <div class="usage-chart-board">
        <div class="usage-axis">
          ${yAxisTicks.map((tick) => `
            <span class="usage-axis-label" style="bottom:calc(${tick.ratio * 100}% - 8px)">${tick.label}</span>
          `).join("")}
        </div>
        <div class="usage-chart-scroll">
          <div class="usage-chart-canvas" style="--usage-columns:${chartData.length}; --usage-column-width:${columnWidth}px; --usage-gap:${columnGap}px;">
            ${chartData.map((item) => {
              const totalHeight = item.totalQuota > 0 ? Math.max(10, (item.totalQuota / maxQuota) * 100) : 0;
              const amount = formatQuotaAsUsd(item.totalQuota);
              return `
                <div class="usage-bar-wrapper" title="${item.label} · ${amount} · ${item.totalCount.toLocaleString("zh-CN")} 次">
                  ${denseChart ? "" : `<span class="usage-value">${amount}</span>`}
                  <div class="usage-bar-track">
                    <div class="usage-stack" style="height:${totalHeight}%">
                      ${item.segments.map((segment) => `
                        <span
                          class="usage-segment"
                          style="height:${Math.max(4, (segment.quota / item.totalQuota) * 100)}%; background:${segment.color};"
                          title="${escapeHtml(segment.name)} ${formatQuotaAsUsd(segment.quota)} · ${segment.count.toLocaleString("zh-CN")} 次"
                        ></span>
                      `).join("")}
                    </div>
                  </div>
                  <span class="usage-label">${item.axisLabel}</span>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </div>
      <div class="usage-legend">
        ${legend.map((item) => `
          <div class="usage-legend-item">
            <span class="usage-legend-swatch" style="background:${item.color};"></span>
            <span class="usage-legend-text">${escapeHtml(item.name)}</span>
            <span class="usage-legend-meta">${formatQuotaAsUsd(modelTotals.get(item.name) || 0)} / ${(modelCounts.get(item.name) || 0).toLocaleString("zh-CN")} 次</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

const LOBE_ICON_BASE = "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons";
const LOBE_DEFAULT_MODEL_ICON = `${LOBE_ICON_BASE}/submodel.svg`;
const GEMINI_BADGE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z" fill="#3186FF"></path><path d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z" fill="url(#geminiFill0)"></path><path d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z" fill="url(#geminiFill1)"></path><path d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z" fill="url(#geminiFill2)"></path><defs><linearGradient id="geminiFill0" x1="7" x2="11" y1="15.5" y2="12" gradientUnits="userSpaceOnUse"><stop stop-color="#08B962"></stop><stop offset="1" stop-color="#08B962" stop-opacity="0"></stop></linearGradient><linearGradient id="geminiFill1" x1="8" x2="11.5" y1="5.5" y2="11" gradientUnits="userSpaceOnUse"><stop stop-color="#F94543"></stop><stop offset="1" stop-color="#F94543" stop-opacity="0"></stop></linearGradient><linearGradient id="geminiFill2" x1="3.5" x2="17.5" y1="13.5" y2="12" gradientUnits="userSpaceOnUse"><stop stop-color="#FABC12"></stop><stop offset=".46" stop-color="#FABC12" stop-opacity="0"></stop></linearGradient></defs></svg>`;
const KEY_ICON_MARKUP = `<span class="chat-key-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor" stroke="none"/></svg></span>`;
const MODEL_ICON_RULES = [
  { provider: "openai", label: "OpenAI", slug: "openai", match: ["gpt", "chatgpt", "openai", "o1", "o3", "o4"] },
  { provider: "claude", label: "Claude", slug: "claude", match: ["claude", "anthropic"] },
  { provider: "gemini", label: "Gemini", slug: "gemini", match: ["gemini", "google", "learnlm"] },
  { provider: "deepseek", label: "DeepSeek", slug: "deepseek", match: ["deepseek"] },
  { provider: "xai", label: "xAI", slug: "xai", match: ["grok", "xai", "x-ai"] },
  { provider: "meta", label: "Meta", slug: "meta", match: ["llama", "meta"] },
  { provider: "qwen", label: "Qwen", slug: "qwen", match: ["qwen", "qwq", "tongyi"] },
  { provider: "moonshot", label: "Moonshot", slug: "moonshot", match: ["moonshot", "kimi"] },
  { provider: "doubao", label: "Doubao", slug: "volcengine", match: ["doubao", "volcengine", "ark"] },
  { provider: "hunyuan", label: "Hunyuan", slug: "tencent", match: ["hunyuan", "tencent"] },
  { provider: "zhipu", label: "ChatGLM", slug: "chatglm", match: ["chatglm", "glm-4", "glm-4v", "glm-4.5"] },
  { provider: "zhipu", label: "Zhipu", slug: "zhipu", match: ["zhipu", "bigmodel"] },
  { provider: "minimax", label: "MiniMax", slug: "minimax", match: ["minimax", "abab"] },
  { provider: "mistral", label: "Mistral", slug: "mistral", match: ["mistral", "ministral", "codestral", "pixtral"] },
  { provider: "perplexity", label: "Perplexity", slug: "perplexity", match: ["perplexity", "sonar"] },
  { provider: "openrouter", label: "OpenRouter", slug: "openrouter", match: ["openrouter"] },
  { provider: "ollama", label: "Ollama", slug: "ollama", match: ["ollama"] },
  { provider: "wenxin", label: "文心", slug: "wenxin", match: ["wenxin", "ernie", "baidu"] },
  { provider: "spark", label: "星火", slug: "spark", match: ["spark", "xinghuo"] },
  { provider: "yi", label: "Yi", slug: "yi", match: ["yi-", "yi-large", "yi-lightning", "lingyi", "01-ai"] },
  { provider: "zeroone", label: "零一万物", slug: "zeroone", match: ["zeroone", "01ai"] },
  { provider: "baichuan", label: "百川", slug: "baichuan", match: ["baichuan"] },
  { provider: "sensenova", label: "SenseNova", slug: "sensenova", match: ["sensenova", "sensechat"] },
  { provider: "stepfun", label: "阶跃", slug: "stepfun", match: ["stepfun", "step-"] },
  { provider: "yuanbao", label: "元宝", slug: "yuanbao", match: ["yuanbao"] },
  { provider: "tiangong", label: "天工", slug: "tiangong", match: ["tiangong"] }
];

function getModelVisual(modelId) {
  const id = String(modelId || "").toLowerCase();
  const rule = MODEL_ICON_RULES.find((item) => item.match.some((keyword) => id.includes(keyword)));
  if (!rule) {
    return {
      provider: "default",
      label: "Model",
      svg: "",
      maskUrl: LOBE_DEFAULT_MODEL_ICON
    };
  }

  return {
    provider: rule.provider,
    label: rule.label,
    svg: rule.provider === "gemini" ? GEMINI_BADGE_SVG : "",
    maskUrl: `${LOBE_ICON_BASE}/${rule.slug}.svg`
  };
}

function renderModelIconMarkup(modelId) {
  const visual = getModelVisual(modelId);
  return {
    visual,
    markup: `
      <span class="chat-model-brand chat-model-brand--${visual.provider}">
        ${visual.svg
          ? `<span class="chat-model-brand__svg">${visual.svg}</span>`
          : `<span class="chat-model-brand__glyph" style="--model-icon-mask:url('${visual.maskUrl || LOBE_DEFAULT_MODEL_ICON}')" aria-hidden="true"></span>`}
      </span>
    `
  };
}

function getProviderCategory(visual) {
  const map = {
    openai: "ChatGPT",
    claude: "Claude",
    gemini: "Gemini",
    deepseek: "DeepSeek",
    xai: "Grok",
    meta: "Llama",
    qwen: "Qwen",
    moonshot: "Kimi",
    doubao: "Doubao",
    hunyuan: "Hunyuan",
    zhipu: "GLM",
    minimax: "MiniMax",
    mistral: "Mistral",
    perplexity: "Perplexity",
    openrouter: "OpenRouter",
    ollama: "Ollama",
    wenxin: "文心",
    spark: "星火",
    yi: "Yi",
    zeroone: "零一万物",
    baichuan: "百川",
    sensenova: "SenseNova",
    stepfun: "阶跃",
    yuanbao: "元宝",
    tiangong: "天工",
    default: "其他"
  };
  return map[visual?.provider] || visual?.label || "其他";
}

const CHAT_MODEL_CATEGORY_ORDER = [
  "ChatGPT",
  "Gemini",
  "Claude",
  "DeepSeek",
  "Grok",
  "Llama",
  "Qwen",
  "Kimi",
  "Doubao",
  "Hunyuan",
  "GLM",
  "MiniMax",
  "Mistral",
  "Perplexity",
  "OpenRouter",
  "Ollama",
  "文心",
  "星火",
  "Yi",
  "零一万物",
  "百川",
  "SenseNova",
  "阶跃",
  "元宝",
  "天工",
  "其他"
];

function sortChatModelCategories(entries) {
  return entries.sort(([a], [b]) => {
    const indexA = CHAT_MODEL_CATEGORY_ORDER.indexOf(a);
    const indexB = CHAT_MODEL_CATEGORY_ORDER.indexOf(b);
    const orderA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
    const orderB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.localeCompare(b, "zh-CN");
  });
}

function renderModels() {
  const search = appState.modelSearch.toLowerCase();
  const filtered = appState.models.filter(m => (m.id || "").toLowerCase().includes(search));
  els.modelsList.innerHTML = filtered.map((m) => {
    const visual = getModelVisual(m.id);
    return `
      <div class="model-card model-card--${visual.provider}">
        <div class="model-icon-container">
          <span class="model-icon-badge model-icon-badge--${visual.provider}" aria-label="${escapeHtml(visual.label)}">
            ${visual.svg
              ? `<span class="model-icon-svg">${visual.svg}</span>`
              : `<span class="model-icon-glyph" style="--model-icon-mask:url('${visual.maskUrl || LOBE_DEFAULT_MODEL_ICON}')"></span>`}
          </span>
        </div>
        <div class="model-info">
          <div class="model-meta">${visual.label}</div>
          <div class="model-name">${m.id}</div>
          <div class="model-pricing">倍率: ${m.quota || "1.0"}x</div>
        </div>
      </div>
    `;
  }).join("") || '<div style="grid-column:1/-1; text-align:center; padding:40px; opacity:0.5;">未找到相关模型</div>';
}

function setModelsPageVisible(visible) {
  if (!els.modelsPage) return;
  els.modelsPage.classList.toggle("active", Boolean(visible));
  els.modelsPage.setAttribute("aria-hidden", visible ? "false" : "true");
}

function renderKeys() {
  const search = appState.keyFilter.search.toLowerCase();
  const filtered = (appState.keys || []).filter((k) => {
    const name = String(k?.name || "").toLowerCase();
    const id = String(k?.id || "");
    return name.includes(search) || id.includes(search);
  });
  els.keysList.innerHTML = filtered.map(k => {
    const statusColor = Number(k.status) === 1 ? "var(--success)" : "var(--danger)";
    return `
      <div class="item-card" data-key-id="${k.id}">
        <div style="flex:1">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:8px; height:8px; border-radius:50%; background:${statusColor}"></div>
            <strong style="font-size:15px;">${k.name || "API Key"}</strong>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">ID: ${k.id} · 剩余: ${k.unlimited_quota ? '无限' : normalizeNumber(k.remain_quota)}</div>
        </div>
        <div class="key-actions">
          <button class="action-circle sm key-copy" data-key="${k.key || ""}"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
          <button class="action-circle sm key-view"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
          <button class="action-circle sm key-delete" title="删除密钥"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
        </div>
      </div>`;
  }).join("") || '<div style="text-align:center; padding:40px; opacity:0.5;">暂无密钥</div>';
}

function renderLogs() {
  if (appState.logs.length === 0 && appState.logPage === 1) {
    els.logsList.innerHTML = '<div style="text-align:center; padding:40px; opacity:0.5;">暂无调用记录</div>';
    els.loadMoreLogsBtn.hidden = true;
    return;
  }

  const html = appState.logs.map(log => {
    const pTokens = log.prompt_tokens || 0;
    const cTokens = log.completion_tokens || 0;
    const time = formatFullDate(log.created_at);
    return `
      <div class="log-card">
        <div class="log-main">
          <div class="log-model">${log.model_name || "Unknown Model"}</div>
          <div class="log-meta">
            <span>${time}</span>
            <span>耗时: ${(log.use_time || 0)}s</span>
          </div>
          <div class="log-tokens">Tokens: ${pTokens} (Prompt) + ${cTokens} (Completion)</div>
        </div>
        <div class="log-quota">- ${normalizeNumber(log.quota || 0)}</div>
      </div>
    `;
  }).join("");

  els.logsList.innerHTML = html;
  els.loadMoreLogsBtn.hidden = !appState.logHasMore;
}

async function loadLogs(isRefresh = false) {
  if (appState.logLoading) return;

  if (isRefresh) {
    appState.logPage = 1;
    appState.logs = [];
    els.logsList.innerHTML = '<div style="text-align:center; padding:40px; opacity:0.5;">加载中...</div>';
  } else {
    els.loadMoreLogsBtn.textContent = "加载中...";
    els.loadMoreLogsBtn.disabled = true;
  }

  appState.logLoading = true;

  try {
    const res = await api(`/miniapi/logs?p=${appState.logPage}&page_size=10&model_name=${encodeURIComponent(appState.logSearch)}`);
    const newLogs = toArray(res.data);
    const total = Number(res.total || res.data?.total || 0);

    if (isRefresh) {
      appState.logs = newLogs;
    } else {
      appState.logs = [...appState.logs, ...newLogs];
    }

    appState.logHasMore = total > 0 ? appState.logs.length < total : newLogs.length >= 10;
    renderLogs();
  } catch (error) {
    els.logsList.innerHTML = '<div style="text-align:center; padding:40px; color:var(--danger);">加载失败,请重试</div>';
    toast("获取日志失败: " + (error.message || "网络错误"), "error");
  } finally {
    appState.logLoading = false;
    els.loadMoreLogsBtn.textContent = "加载更多";
    els.loadMoreLogsBtn.disabled = false;
  }
}

function renderFinance() {
  const info = appState.topupInfo || {};
  const options = info.amount_options || [10, 20, 50, 100, 200];
  els.amountOptions.innerHTML = options.map(a => `<div class="amount-chip ${a === appState.selectedPayAmount ? 'active' : ''}" data-amount="${a}">￥${a}</div>`).join("");
  els.methodOptions.innerHTML = appState.paymentMethods.map(m => {
    const meta = getPaymentMeta(m);
    return `<div class="item-card method-chip ${m === appState.selectedPayMethod ? 'active' : ''}" data-method="${m}" style="cursor:pointer; margin-bottom:8px; border:2px solid ${m === appState.selectedPayMethod ? 'var(--accent)' : 'transparent'}">${renderPaymentIcon(m)}<span class="method-chip-copy"><strong>${meta.label}</strong><small>${meta.code}</small></span></div>`;
  }).join("");
  const sub = appState.subSelf || {};
  els.subSelf.innerHTML = (sub.subscriptions || []).map(s => `<div class="item-card" style="background:var(--bg-secondary); border:none;"><div><div style="font-size:11px; font-weight:700; color:var(--text-secondary)">活跃订阅</div><div style="font-weight:700">Plan #${s.plan_id}</div></div><div class="badge">ACTIVE</div></div>`).join("") || '<div class="item-card" style="opacity:0.6; font-size:13px; justify-content:center;">暂无活跃订阅</div>';
  if (els.plansCount) els.plansCount.textContent = (appState.plans || []).length;
  els.plansList.innerHTML = (appState.plans || []).map(p => `
    <div class="card glass" style="padding:20px; margin-bottom:12px; border-radius:20px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div><h4 style="font-weight:700">${p.title || "套餐"}</h4><p style="font-size:12px; color:var(--text-secondary)">${p.upgrade_group || "default"}</p></div>
        <div style="text-align:right"><div style="font-size:20px; font-weight:800; color:var(--accent)">￥${p.price_amount}</div><div style="font-size:11px; opacity:0.6">${p.duration_label || formatPlanDuration(p)}</div></div>
      </div>
      <div style="display:flex; gap:8px; margin-top:16px;">
        ${appState.paymentMethods.map(m => {
          const meta = getPaymentMeta(m);
          return `<button class="primary-button plan-buy" style="flex:1; padding:8px; font-size:12px; height:auto;" data-plan-id="${p.id}" data-method="${m}">${renderPaymentIcon(m, { compact: true })}<span>${meta.label}</span></button>`;
        }).join("")}
      </div>
    </div>`).join("");
  if (els.topupList) {
    els.topupList.innerHTML = (appState.topupRecords || []).slice(0, 10).map(r => `<div class="item-card" style="font-size:13px;"><span>￥${r.amount} · ${r.payment_method}</span><span style="opacity:0.6">${formatDate(r.created_at)}</span></div>`).join("") || '<div class="item-card" style="opacity:0.6; font-size:13px; justify-content:center;">暂无充值记录</div>';
  }
}

function getSelectedChatKey() {
  return appState.chatKeys.find((item) => String(item.id) === String(appState.selectedChatKeyId)) || appState.chatKeys[0] || null;
}

function persistChatSessions() {
  const normalized = (appState.chatSessions || [])
    .map(normalizeChatSession)
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  appState.chatSessions = normalized;
  safeWriteStorage(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(normalized));
  safeWriteStorage(CHAT_CURRENT_SESSION_STORAGE_KEY, String(appState.currentChatSessionId || "").trim());
}

function getCurrentChatSession() {
  return appState.chatSessions.find((item) => String(item.id) === String(appState.currentChatSessionId)) || null;
}

function createChatSession({ title = "新对话", messages = [], keyId = "", modelId = "" } = {}) {
  const session = normalizeChatSession({
    id: createChatSessionId(),
    title,
    messages,
    keyId,
    modelId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  appState.chatSessions = [session, ...(appState.chatSessions || [])];
  appState.currentChatSessionId = session.id;
  persistChatSessions();
  return session;
}

function ensureChatSession() {
  let current = getCurrentChatSession();
  if (current) {
    return current;
  }
  if (Array.isArray(appState.chatSessions) && appState.chatSessions.length) {
    const [latest] = [...appState.chatSessions].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    appState.currentChatSessionId = latest?.id || null;
    persistChatSessions();
    return getCurrentChatSession();
  }
  return createChatSession({
    keyId: String(appState.selectedChatKeyId || "").trim(),
    modelId: String(appState.selectedChatModel || "").trim()
  });
}

function syncCurrentChatSession({ touch = true } = {}) {
  const current = ensureChatSession();
  if (!current) return null;
  current.messages = (appState.chatMessages || [])
    .filter((item) => ["user", "assistant", "system"].includes(String(item?.role || "")))
    .map((item) => ({
      role: item.role,
      content: String(item.content || ""),
      model: String(item.model || "").trim()
    }));
  current.keyId = String(appState.selectedChatKeyId || "").trim();
  current.modelId = String(appState.selectedChatModel || "").trim();
  current.title = deriveChatSessionTitle(current.messages, current.title || "新对话");
  if (touch) {
    current.updatedAt = Date.now();
  }
  persistChatSessions();
  return current;
}

function applyChatSession(session, { preserveOpenState = false } = {}) {
  const normalized = normalizeChatSession(session);
  if (!normalized) return;
  const keyId = String(normalized.keyId || "").trim();
  const modelId = String(normalized.modelId || "").trim();
  appState.currentChatSessionId = normalized.id;
  appState.chatMessages = normalized.messages.map((item) => ({
    role: item.role,
    content: item.content,
    model: item.model
  }));
  if (keyId) {
    appState.selectedChatKeyId = keyId;
  }
  syncChatSelection(modelId);
  if (!preserveOpenState) {
    appState.chatSessionsDrawerOpen = false;
  }
  persistChatSessions();
}

function openNewChatSession() {
  syncCurrentChatSession();
  const session = createChatSession({
    keyId: String(appState.selectedChatKeyId || "").trim(),
    modelId: String(appState.selectedChatModel || "").trim()
  });
  appState.chatMessages = [];
  applyChatSession(session);
  renderChat();
}

function deleteChatSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return;
  appState.chatSessions = (appState.chatSessions || []).filter((item) => String(item.id) !== id);
  if (String(appState.currentChatSessionId) === id) {
    appState.currentChatSessionId = null;
    const next = ensureChatSession();
    if (next) {
      applyChatSession(next, { preserveOpenState: true });
    } else {
      appState.chatMessages = [];
    }
  }
  persistChatSessions();
}

function getPersistedChatModelForKey(keyId) {
  const id = String(keyId || "").trim();
  if (!id) return "";
  return String(appState.chatModelSelections?.[id] || "").trim();
}

function persistChatSelection() {
  const keyId = String(appState.selectedChatKeyId || "").trim();
  safeWriteStorage(CHAT_KEY_STORAGE_KEY, keyId);

  const nextSelections = { ...(appState.chatModelSelections || {}) };
  if (keyId) {
    const modelId = String(appState.selectedChatModel || "").trim();
    if (modelId) {
      nextSelections[keyId] = modelId;
    } else {
      delete nextSelections[keyId];
    }
  }
  appState.chatModelSelections = nextSelections;
  safeWriteStorage(CHAT_MODEL_STORAGE_KEY, JSON.stringify(nextSelections));
}

function clearPersistedChatSelection(keyId = "") {
  const id = String(keyId || appState.selectedChatKeyId || "").trim();
  if (!id) {
    safeWriteStorage(CHAT_KEY_STORAGE_KEY, "");
    safeWriteStorage(CHAT_MODEL_STORAGE_KEY, JSON.stringify(appState.chatModelSelections || {}));
    return;
  }
  const nextSelections = { ...(appState.chatModelSelections || {}) };
  delete nextSelections[id];
  appState.chatModelSelections = nextSelections;
  if (String(appState.selectedChatKeyId || "") === id) {
    safeWriteStorage(CHAT_KEY_STORAGE_KEY, "");
  }
  safeWriteStorage(CHAT_MODEL_STORAGE_KEY, JSON.stringify(nextSelections));
}

function applyModelsToChatKey(keyId, models, preferredModel = "") {
  const normalized = normalizeModels(models);
  appState.chatKeys = appState.chatKeys.map((item) => String(item.id) === String(keyId)
    ? {
        ...item,
        available_models: normalized,
        model_count: normalized.length
      }
    : item);

  if (String(appState.selectedChatKeyId) === String(keyId)) {
    const preferred = String(preferredModel || appState.selectedChatModel || "").trim();
    const matched = normalized.find((item) => item.id === preferred);
    appState.selectedChatModel = (matched || normalized[0] || {}).id || "";
    persistChatSelection();
    syncCurrentChatSession({ touch: false });
  }
}

function hasReadyChatSelection() {
  const selectedKey = getSelectedChatKey();
  return Boolean(selectedKey && getUiAvailableModelsForKey(selectedKey).length);
}

function syncChatSelection(preferredModel = "") {
  const selectedKey = getSelectedChatKey();
  appState.chatKeyPickerOpen = false;
  appState.chatModelPickerOpen = false;
  if (!selectedKey) {
    appState.chatKeyMissing = true;
    appState.selectedChatKeyId = null;
    appState.selectedChatModel = "";
    persistChatSelection();
    return;
  }

  appState.chatKeyMissing = false;
  const keyId = String(selectedKey.id || "").trim();
  const currentSelectedModel = String(appState.selectedChatModel || "").trim();
  const sameKeyCurrentModel = String(appState.selectedChatKeyId || "") === keyId ? currentSelectedModel : "";
  const persistedModel = getPersistedChatModelForKey(keyId);
  appState.selectedChatKeyId = selectedKey.id;
  const models = getUiAvailableModelsForKey(selectedKey);
  const preferred = String(preferredModel || sameKeyCurrentModel || persistedModel || "").trim();
  const matched = models.find((item) => item.id === preferred);
  appState.selectedChatModel = (matched || models[0] || {}).id || "";
  persistChatSelection();
  syncCurrentChatSession({ touch: false });
}

function applyChatBootstrap(data) {
  appState.chatKeys = Array.isArray(data?.keys) ? data.keys : [];
  appState.selectedChatKeyId = data?.selected_key_id || appState.selectedChatKeyId;
  appState.chatKeyMissing = !Boolean(data?.has_key);
  syncChatSelection(data?.selected_model || "");
}

function buildChatStateFromLegacy(keysResp, modelsResp, preferredKeyId = null) {
  const allModels = normalizeModels(modelsResp?.data);
  const sharedModels = allModels.length ? allModels : normalizeModels(appState.models);
  const chatKeys = toArray(keysResp?.data).map((item) => {
    const allowed = Boolean(item?.model_limits_enabled)
      ? new Set(
          String(item?.model_limits || "")
            .split(/[\n,，]+/)
            .map((part) => part.trim().toLowerCase())
            .filter(Boolean)
        )
      : null;
    const availableModels = allowed
      ? sharedModels.filter((model) => allowed.has(String(model.id || "").toLowerCase()))
      : sharedModels;

    return {
      id: item?.id,
      name: item?.name || `API Key #${item?.id || ""}`,
      status: Number(item?.status ?? 1),
      model_limits_enabled: Boolean(item?.model_limits_enabled),
      model_limits: String(item?.model_limits || ""),
      available_models: availableModels,
      model_count: availableModels.length
    };
  }).filter((item) => Number(item.status) === 1);

  const selected = chatKeys.find((item) => String(item.id) === String(preferredKeyId)) || chatKeys[0] || null;
  const selectedModels = selected ? getUiAvailableModelsForKey(selected) : [];
  return {
    has_key: chatKeys.length > 0,
    auto_create_available: true,
    keys: chatKeys,
    selected_key_id: selected?.id || null,
    selected_model: selectedModels[0]?.id || "",
    models: selectedModels
  };
}

async function loadChatBootstrapLegacy(preferredKeyId = null) {
  const [keysResp, modelsResp] = await Promise.all([
    api("/miniapi/keys"),
    api("/miniapi/models")
  ]);
  return buildChatStateFromLegacy(keysResp, modelsResp, preferredKeyId);
}

function getUiAvailableModelsForKey(key) {
  const direct = normalizeModels(key?.available_models);
  if (direct.length) {
    return direct;
  }

  const sharedModels = normalizeModels(appState.models);
  if (!sharedModels.length) {
    return [];
  }

  if (!Boolean(key?.model_limits_enabled)) {
    return sharedModels;
  }

  const allowed = new Set(
    String(key?.model_limits || "")
      .split(/[\n,，]+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!allowed.size) {
    return sharedModels;
  }
  return sharedModels.filter((item) => allowed.has(String(item.id || "").toLowerCase()));
}

async function loadModelsShared({ force = false } = {}) {
  if (!force && appState.modelsRequestPromise) {
    return appState.modelsRequestPromise;
  }

  const request = api("/miniapi/models")
    .then((resp) => {
      const models = normalizeModels(resp.data);
      appState.models = models;
      renderModels();
      if (appState.chatInitialized || appState.chatKeys.length) {
        syncChatSelection();
        renderChat();
      }
      return models;
    })
    .catch((error) => {
      if (force) {
        appState.models = [];
        renderModels();
        if (appState.chatInitialized || appState.chatKeys.length) {
          syncChatSelection();
          renderChat();
        }
      }
      throw error;
    })
    .finally(() => {
      if (appState.modelsRequestPromise === request) {
        appState.modelsRequestPromise = null;
      }
    });

  appState.modelsRequestPromise = request;
  return request;
}

function resizeChatInput() {
  if (!els.chatInput) return;
  els.chatInput.style.height = "auto";
  els.chatInput.style.height = `${Math.min(els.chatInput.scrollHeight, 180)}px`;
}

function scrollChatToBottom() {
  if (!document.getElementById("panel-chat")?.classList.contains("active")) return;
  requestAnimationFrame(() => {
    if (els.scrollArea) {
      els.scrollArea.scrollTop = els.scrollArea.scrollHeight;
    }
  });
}

function renderChat() {
  if (!els.chatMessages) return;

  const currentSession = ensureChatSession();
  if (currentSession && !appState.chatMessages.length && Array.isArray(currentSession.messages) && currentSession.messages.length) {
    appState.chatMessages = currentSession.messages.map((item) => ({
      role: item.role,
      content: item.content,
      model: item.model
    }));
  }

  const selectedKey = getSelectedChatKey();
  const selectedModels = getUiAvailableModelsForKey(selectedKey);
  const hasSelectedKey = Boolean(selectedKey);
  const hasModelOptions = selectedModels.length > 0;

  if (els.chatSessionTitle) {
    els.chatSessionTitle.textContent = currentSession?.title || "新对话";
  }
  if (els.chatSessionsDrawer && els.chatSessionsList) {
    const sessions = [...(appState.chatSessions || [])].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    els.chatSessionsDrawer.hidden = !appState.chatSessionsDrawerOpen;
    els.chatSessionsDrawer.classList.toggle("active", appState.chatSessionsDrawerOpen);
    els.chatSessionsList.innerHTML = sessions.map((session) => {
      const preview = String(session.messages?.find((item) => item.role === "assistant" || item.role === "user")?.content || "").replace(/\s+/g, " ").trim();
      const meta = [
        session.modelId || "未选模型",
        session.messages?.length ? `${session.messages.length} 条消息` : "空白对话"
      ].filter(Boolean).join(" · ");
      return `
        <div class="chat-session-item ${String(session.id) === String(appState.currentChatSessionId) ? "active" : ""}" data-session-id="${escapeHtml(session.id)}">
          <button class="chat-session-main" type="button" data-session-open="${escapeHtml(session.id)}">
            <strong>${escapeHtml(session.title || "新对话")}</strong>
            <span>${escapeHtml(meta)}</span>
            <small>${escapeHtml(preview || "点击继续这个会话")}</small>
          </button>
          <button class="chat-session-delete" type="button" data-session-delete="${escapeHtml(session.id)}" aria-label="删除会话">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      `;
    }).join("") || '<div class="chat-picker-empty">还没有会话</div>';
  }

  if (els.chatKeyPickerBtn && els.chatKeyPickerValue && els.chatKeyPickerMenu) {
    const selectedKeyName = selectedKey?.name || `API Key #${selectedKey?.id || ""}`;
    const selectedKeyCopy = `<span class="chat-key-inline" aria-hidden="true">${KEY_ICON_MARKUP}</span>`;
    els.chatKeyPickerValue.innerHTML = selectedKeyCopy;
    els.chatKeyPickerBtn.title = selectedKey ? `${selectedKeyName} · ${selectedModels.length} 模型` : "选择 API Key";
    els.chatKeyPickerMenu.innerHTML = appState.chatKeys.map((item) => `
      <button class="chat-picker-option ${String(item.id) === String(appState.selectedChatKeyId) ? "active" : ""}" type="button" data-key-id="${item.id}">
        ${KEY_ICON_MARKUP}
        <span class="chat-pill-copy">
          <strong>${escapeHtml(item.name || `API Key #${item.id}`)}</strong>
          <small>${item.model_count || normalizeModels(item.available_models).length} 模型</small>
        </span>
      </button>
    `).join("") || '<div class="chat-picker-empty">暂无可用密钥</div>';
    const keyPickerOpen = appState.chatKeyPickerOpen && hasSelectedKey;
    els.chatKeyPickerMenu.hidden = !keyPickerOpen;
    els.chatKeyPickerMenu.style.display = keyPickerOpen ? "block" : "none";
    els.chatKeyPickerMenu.classList.toggle("is-open", keyPickerOpen);
    els.chatKeyPickerBtn.disabled = !hasSelectedKey || appState.chatBusy || appState.chatLoading;
    els.chatKeyPickerBtn.classList.toggle("active", appState.chatKeyPickerOpen && hasSelectedKey);
  }

  if (els.chatModelPickerBtn && els.chatModelPickerValue && els.chatModelPickerMenu) {
    const selectedModel = selectedModels.find((item) => item.id === appState.selectedChatModel) || selectedModels[0] || null;
    const selectedIcon = selectedModel ? renderModelIconMarkup(selectedModel.id) : null;
    els.chatModelPickerValue.innerHTML = selectedModel
      ? `${selectedIcon.markup}`
      : '<span class="chat-model-picker-placeholder">模型</span>';
    els.chatModelPickerBtn.title = selectedModel ? selectedModel.id : "选择模型";

    const grouped = selectedModels.reduce((acc, item) => {
      const icon = renderModelIconMarkup(item.id);
      const category = getProviderCategory(icon.visual);
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push({ item, icon });
      return acc;
    }, {});

    const menuHtml = sortChatModelCategories(Object.entries(grouped)).map(([category, items]) => `
      <section class="chat-model-group">
        <h4>${escapeHtml(category)}</h4>
        <div class="chat-model-options">
          ${items.map(({ item, icon }) => `
            <button class="chat-model-option ${item.id === appState.selectedChatModel ? "active" : ""}" type="button" data-model-id="${escapeHtml(item.id)}">
              ${icon.markup}
              <span class="chat-model-option-copy">
                <strong>${escapeHtml(item.id)}</strong>
                <small>${escapeHtml(icon.visual.label)}</small>
              </span>
            </button>
          `).join("")}
        </div>
      </section>
    `).join("");

    els.chatModelPickerMenu.innerHTML = menuHtml || '<div class="chat-picker-empty">暂无可用模型</div>';
    const modelPickerOpen = appState.chatModelPickerOpen && hasSelectedKey;
    els.chatModelPickerMenu.hidden = !modelPickerOpen;
    els.chatModelPickerMenu.style.display = modelPickerOpen ? "block" : "none";
    els.chatModelPickerMenu.classList.toggle("is-open", modelPickerOpen);
    els.chatModelPickerBtn.disabled = !hasSelectedKey || appState.chatBusy;
    els.chatModelPickerBtn.classList.toggle("active", appState.chatModelPickerOpen && hasSelectedKey);
  }

  if (els.chatKeyBadge) {
    els.chatKeyBadge.textContent = hasSelectedKey && appState.selectedChatModel
      ? `当前模型：${appState.selectedChatModel}`
      : "当前模型：未选择";
  }

  if (els.chatStatusText) {
    if (appState.chatLoading) {
      els.chatStatusText.textContent = "正在同步当前账号的可用密钥和模型...";
    } else if (hasSelectedKey && hasModelOptions) {
      els.chatStatusText.textContent = `${selectedKey.name || `API Key #${selectedKey.id}`} 已连接，可直接切换会话和模型继续对话。`;
    } else if (hasSelectedKey) {
      els.chatStatusText.textContent = `${selectedKey.name || `API Key #${selectedKey.id}`} 已连接，请先加载或选择可用模型。`;
    } else {
      els.chatStatusText.textContent = "当前没有可直接对话的 API Key，点一下即可自动创建。";
    }
  }

  if (els.chatEmptyTitle) {
    els.chatEmptyTitle.textContent = hasSelectedKey
      ? "聊天 Key 已创建"
      : "当前还没有可用的聊天 Key";
  }
  if (els.chatKeyHint) {
    els.chatKeyHint.textContent = hasSelectedKey && hasModelOptions
      ? `当前密钥 ${selectedKey.name || `API Key #${selectedKey.id}`} 已就绪，可从上方切换模型开始对话。`
      : hasSelectedKey
        ? `当前密钥 ${selectedKey.name || `API Key #${selectedKey.id}`} 已存在，但当前还没有拿到模型列表，请刷新或检查账号模型权限。`
        : "点击下方按钮后，将自动创建一个聊天专用 API Key，并立即为你加载可用模型。";
  }

  if (els.chatEmptyState) {
    els.chatEmptyState.hidden = hasSelectedKey;
  }
  if (els.chatEnsureBtn) {
    els.chatEnsureBtn.disabled = appState.chatKeyCreating || appState.chatLoading;
    els.chatEnsureBtn.hidden = hasSelectedKey;
    els.chatEnsureBtn.textContent = appState.chatKeyCreating ? "创建中..." : "自动创建并开始";
  }

  if (els.chatComposer) {
    els.chatComposer.hidden = !hasSelectedKey;
  }
  if (els.chatInput) {
    els.chatInput.disabled = !hasSelectedKey || appState.chatBusy || appState.chatLoading || !appState.selectedChatModel;
  }
  if (els.chatSendBtn) {
    els.chatSendBtn.disabled = !hasSelectedKey || !appState.selectedChatModel || appState.chatBusy || appState.chatLoading || !String(els.chatInput?.value || "").trim();
    els.chatSendBtn.innerHTML = appState.chatBusy
      ? '<span>发送中...</span>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg><span>发送</span>';
  }
  if (els.chatComposerHint) {
    els.chatComposerHint.hidden = true;
    els.chatComposerHint.textContent = "";
  }

  const messages = appState.chatMessages.map((item) => {
    const modelId = item.model || appState.selectedChatModel || "Assistant";
    const assistantIcon = renderModelIconMarkup(modelId);
    return `
    <div class="chat-message chat-message--${item.role === "user" ? "user" : "assistant"}">
      <div class="chat-message-meta">${item.role === "user" ? "你" : assistantIcon.markup}</div>
      <div class="chat-message-body">
        <div class="chat-message-label">${item.role === "user" ? "You" : escapeHtml(modelId)}</div>
        <div class="chat-message-content">${formatChatContent(item.content)}</div>
      </div>
    </div>
  `;
  }).join("");

  const hasStreamingAssistant = appState.chatMessages.some((item) => item?.streaming);
  const typingIcon = renderModelIconMarkup(appState.selectedChatModel || "Assistant");
  const typing = appState.chatBusy && !hasStreamingAssistant ? `
    <div class="chat-message chat-message--assistant chat-message--typing">
      <div class="chat-message-meta">${typingIcon.markup}</div>
      <div class="chat-message-body">
        <div class="chat-message-label">${escapeHtml(appState.selectedChatModel || "Assistant")}</div>
        <div class="chat-message-content">
          <span class="chat-dot"></span>
          <span class="chat-dot"></span>
          <span class="chat-dot"></span>
        </div>
      </div>
    </div>
  ` : "";

  const empty = hasSelectedKey && !appState.chatMessages.length ? '<div class="chat-empty-spacer"></div>' : "";

  els.chatMessages.innerHTML = empty + messages + typing;
  resizeChatInput();
  scrollChatToBottom();
}

async function loadChatBootstrap(force = false) {
  if (appState.chatLoading) return;
  if (appState.chatInitialized && !force) {
    renderChat();
    return;
  }

  appState.chatLoading = true;
  renderChat();
  try {
    try {
      const resp = await api("/miniapi/chat/bootstrap");
      applyChatBootstrap(resp.data || {});
    } catch (error) {
      if (!String(error.message || "").includes("接口不存在")) {
        throw error;
      }
      const legacyData = await loadChatBootstrapLegacy();
      applyChatBootstrap(legacyData);
    }
    const currentSession = ensureChatSession();
    if (currentSession) {
      if (currentSession.keyId) {
        appState.selectedChatKeyId = currentSession.keyId;
      }
      syncChatSelection(currentSession.modelId || "");
      appState.chatMessages = (currentSession.messages || []).map((item) => ({
        role: item.role,
        content: item.content,
        model: item.model
      }));
    }
    if (!hasReadyChatSelection() && !appState.chatModelsRefreshing) {
      appState.chatModelsRefreshing = true;
      try {
        await loadModelsShared();
        syncChatSelection();
      } catch {}
      appState.chatModelsRefreshing = false;
    }
    appState.chatInitialized = true;
    if (appState.selectedChatKeyId) {
      await loadSelectedChatKeyModels(appState.selectedChatKeyId, appState.selectedChatModel);
    }
    syncCurrentChatSession({ touch: false });
    renderChat();
  } catch (error) {
    toast("加载聊天环境失败: " + (error.message || "网络错误"), "error");
  } finally {
    appState.chatLoading = false;
    renderChat();
  }
}

async function loadSelectedChatKeyModels(keyId, preferredModel = "") {
  const targetKeyId = String(keyId || appState.selectedChatKeyId || "").trim();
  if (!targetKeyId) {
    return;
  }

  appState.chatModelsRefreshing = true;
  renderChat();
  try {
    const resp = await api(`/miniapi/chat/key-models?key_id=${encodeURIComponent(targetKeyId)}`);
    applyModelsToChatKey(targetKeyId, resp.data?.models, preferredModel || resp.data?.selected_model || "");
  } finally {
    appState.chatModelsRefreshing = false;
    renderChat();
  }
}

async function ensureChatReady() {
  if (appState.chatKeyCreating) return;
  appState.chatKeyCreating = true;
  renderChat();
  try {
    let payload;
    let message = "聊天 Key 已准备好";
    try {
      const resp = await api("/miniapi/chat/ensure-key", { method: "POST", body: {} });
      payload = resp.data || {};
      message = resp.message || message;
    } catch (error) {
      if (!String(error.message || "").includes("接口不存在")) {
        throw error;
      }
      const created = await api("/miniapi/keys", {
        method: "POST",
        body: {
          name: "MiniApp Chat",
          expired_time: -1,
          unlimited_quota: true
        }
      });
      payload = await loadChatBootstrapLegacy(created?.data?.id || null);
      message = "已通过兼容接口创建聊天 Key";
    }
    applyChatBootstrap(payload);
    const currentSession = ensureChatSession();
    if (currentSession) {
      if (currentSession.keyId) {
        appState.selectedChatKeyId = currentSession.keyId;
      }
      syncChatSelection(currentSession.modelId || payload?.selected_model || "");
      appState.chatMessages = (currentSession.messages || []).map((item) => ({
        role: item.role,
        content: item.content,
        model: item.model
      }));
    }
    if (!hasReadyChatSelection()) {
      appState.chatModelsRefreshing = true;
      try {
        await loadModelsShared();
        syncChatSelection(payload?.selected_model || "");
      } catch {}
      appState.chatModelsRefreshing = false;
    }
    appState.chatInitialized = true;
    if (appState.selectedChatKeyId) {
      await loadSelectedChatKeyModels(appState.selectedChatKeyId, payload?.selected_model || appState.selectedChatModel);
    }
    syncCurrentChatSession({ touch: false });
    toast(hasReadyChatSelection() ? message : `${message}，正在刷新模型列表`);
    renderChat();
    loadData();
  } catch (error) {
    toast("自动创建 Key 失败: " + (error.message || "网络错误"), "error");
  } finally {
    appState.chatKeyCreating = false;
    renderChat();
  }
}

async function sendChatMessage() {
  if (appState.chatBusy) return;
  const selectedKey = getSelectedChatKey();
  const text = String(els.chatInput?.value || "").trim();
  if (!selectedKey) {
    toast("当前没有可用聊天 Key", "error");
    return;
  }
  if (!appState.selectedChatModel) {
    toast("请先选择模型", "error");
    return;
  }
  if (!text) {
    return;
  }

  ensureChatSession();
  appState.chatMessages.push({ role: "user", content: text });
  const assistantIndex = appState.chatMessages.push({
    role: "assistant",
    content: "",
    model: appState.selectedChatModel,
    streaming: true
  }) - 1;
  appState.chatBusy = true;
  if (els.chatInput) {
    els.chatInput.value = "";
  }
  syncCurrentChatSession();
  renderChat();

  try {
    const requestMessages = appState.chatMessages
      .filter((item, index) => index !== assistantIndex && !item.streaming)
      .map((item) => ({ role: item.role, content: item.content }));

    await streamChatCompletion({
      key_id: selectedKey.id,
      model: appState.selectedChatModel,
      messages: requestMessages
    }, (delta) => {
      const assistant = appState.chatMessages[assistantIndex];
      if (!assistant) return;
      assistant.content = `${assistant.content || ""}${delta}`;
      renderChat();
    });

    const message = String(appState.chatMessages[assistantIndex]?.content || "").trim();
    if (!message) {
      throw new Error("模型未返回内容");
    }
    if (appState.chatMessages[assistantIndex]) {
      appState.chatMessages[assistantIndex].content = message;
      appState.chatMessages[assistantIndex].streaming = false;
    }
    syncCurrentChatSession();
  } catch (error) {
    const assistant = appState.chatMessages[assistantIndex];
    if (assistant?.content) {
      assistant.streaming = false;
    } else {
      appState.chatMessages.splice(assistantIndex, 1);
    }
    syncCurrentChatSession();
    toast("发送失败: " + (error.message || "网络错误"), "error");
  } finally {
    appState.chatBusy = false;
    renderChat();
  }
}

async function loadData() {
  if (els.authBadge) els.authBadge.textContent = "Syncing...";
  try {
    const resp = await api("/miniapi/bootstrap");
    const d = resp.data || {};
    appState.me = d.me || null;
    appState.usage = toArray(d.usage);
    appState.plans = normalizePlans(d.subscription_plans);
    appState.subSelf = d.subscription_self || null;
    appState.keys = toArray(d.keys);
    appState.topupInfo = d.topup_info || null;
    appState.topupRecords = toArray(d.topup_records);
    
    // Non-blocking fetch for models and affiliate
    loadModelsShared({ force: true }).catch(() => {});
    api("/miniapi/affiliate").then(r => { 
      const affiliate = normalizeAffiliateData(r.data);
      appState.affiliate = affiliate.raw; 
      renderOverview();
      const me = appState.me || {};
      const affQuota = Number(me.aff_quota || 0);
      const affHistoryQuota = Number(me.aff_history_quota || 0);
      if(affiliate.affCode || affiliate.raw) {
        els.affQuotaText.textContent = formatQuotaAsUsd(affQuota);
        els.affHistoryText.textContent = formatQuotaAsUsd(affHistoryQuota);
        const code = affiliate.affCode;
        els.affLinkInput.value = code ? `${window.location.origin}/register?aff=${code}` : "未生成";
      } else {
        els.affQuotaText.textContent = "$0.00";
        els.affHistoryText.textContent = "$0.00";
        els.affLinkInput.value = "未生成";
      }
    }).catch(()=>{});

    const payAmountOptions = Array.isArray(d.topup_info?.amount_options) ? d.topup_info.amount_options : [10, 20, 50, 100, 200];
    appState.paymentMethods = normalizePaymentMethods(d.topup_info);
    if (!appState.selectedPayMethod || !appState.paymentMethods.includes(appState.selectedPayMethod)) {
      appState.selectedPayMethod = appState.paymentMethods[0];
    }
    if (!payAmountOptions.includes(appState.selectedPayAmount)) {
      appState.selectedPayAmount = Number(payAmountOptions[0] || 10);
    }
    if (els.payAmountInput && (!els.payAmountInput.value || Number(els.payAmountInput.value) <= 0)) {
      els.payAmountInput.value = String(appState.selectedPayAmount);
    }
    
    renderOverview(); renderKeys(); renderFinance();
    if (appState.chatInitialized) {
      loadChatBootstrap(true);
    }
    if (els.authBadge) els.authBadge.textContent = tg?.initData ? "Verified" : "Dev Mode";
  } catch (e) {
    toast(e.message, "error");
    if (els.authBadge) els.authBadge.textContent = "Auth Error";
  }
}

function bindEvents() {
  els.chatSessionsBtn?.addEventListener("click", () => {
    appState.chatSessionsDrawerOpen = true;
    renderChat();
  });

  els.chatNewSessionBtn?.addEventListener("click", () => {
    openNewChatSession();
  });

  els.chatSessionsCreateBtn?.addEventListener("click", () => {
    openNewChatSession();
  });

  els.chatSessionsCloseBtn?.addEventListener("click", () => {
    appState.chatSessionsDrawerOpen = false;
    renderChat();
  });

  els.chatSessionsBackdrop?.addEventListener("click", () => {
    appState.chatSessionsDrawerOpen = false;
    renderChat();
  });

  els.chatSessionsList?.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest("[data-session-delete]");
    if (deleteBtn) {
      const sessionId = deleteBtn.dataset.sessionDelete || "";
      if ((appState.chatSessions || []).length <= 1) {
        toast("至少保留一个会话", "error");
        return;
      }
      const confirmed = window.confirm("确定删除这个会话吗？");
      if (!confirmed) return;
      deleteChatSession(sessionId);
      renderChat();
      return;
    }

    const openBtn = event.target.closest("[data-session-open]");
    if (!openBtn) return;
    syncCurrentChatSession();
    const session = (appState.chatSessions || []).find((item) => String(item.id) === String(openBtn.dataset.sessionOpen || ""));
    if (!session) return;
    applyChatSession(session);
    renderChat();
  });

  els.refreshBtn.addEventListener("click", () => {
    loadData();
    if (document.getElementById("panel-logs").classList.contains("active")) loadLogs(true);
    if (document.getElementById("panel-chat").classList.contains("active") || appState.chatInitialized) loadChatBootstrap(true);
  });
  
  els.themeBtn.addEventListener("click", () => {
    appState.themePreference = appState.themePreference === "light" ? "dark" : "light";
    localStorage.setItem("miniapp_theme", appState.themePreference);
    applyTheme();
  });
  
  els.tabs.addEventListener("click", e => { const btn = e.target.closest(".nav-btn"); if (btn) switchTab(btn.dataset.tab); });
  document.querySelectorAll("[data-nav-tab]").forEach(el => { el.addEventListener("click", () => switchTab(el.dataset.navTab)); });
  document.querySelectorAll("[data-scroll-target]").forEach(el => {
    el.addEventListener("click", () => {
      const target = document.getElementById(el.dataset.scrollTarget);
      if (!target) return;
      switchTab("overview");
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  });

  els.openModelsPageBtn?.addEventListener("click", () => {
    setModelsPageVisible(true);
  });

  els.closeModelsPageBtn?.addEventListener("click", () => {
    setModelsPageVisible(false);
  });

  els.chatKeyPickerBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (els.chatKeyPickerBtn.disabled) return;
    appState.chatModelPickerOpen = false;
    appState.chatKeyPickerOpen = !appState.chatKeyPickerOpen;
    renderChat();
  });

  els.chatKeyPickerMenu?.addEventListener("click", (event) => {
    event.stopPropagation();
    const option = event.target.closest("[data-key-id]");
    if (!option) return;
    appState.selectedChatKeyId = option.dataset.keyId || "";
    syncChatSelection();
    renderChat();
    loadSelectedChatKeyModels(appState.selectedChatKeyId).catch((error) => {
      toast("加载当前 Key 模型失败: " + (error.message || "网络错误"), "error");
    });
  });

  els.chatModelPickerBtn?.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (els.chatModelPickerBtn.disabled) return;
    appState.chatKeyPickerOpen = false;
    appState.chatModelPickerOpen = !appState.chatModelPickerOpen;
    renderChat();

    const selectedKey = getSelectedChatKey();
    if (!appState.chatModelPickerOpen || !selectedKey) {
      return;
    }

    if (!getUiAvailableModelsForKey(selectedKey).length && !appState.chatModelsRefreshing) {
      try {
        await loadSelectedChatKeyModels(selectedKey.id, appState.selectedChatModel);
      } catch (error) {
        toast("加载模型列表失败: " + (error.message || "网络错误"), "error");
      }
    }
  });

  els.chatModelPickerMenu?.addEventListener("click", (event) => {
    event.stopPropagation();
    const option = event.target.closest("[data-model-id]");
    if (!option) return;
    appState.selectedChatModel = option.dataset.modelId || "";
    appState.chatModelPickerOpen = false;
    persistChatSelection();
    renderChat();
  });

  document.addEventListener("click", (event) => {
    let changed = false;
    if (appState.chatModelPickerOpen && !els.chatModelPicker?.contains(event.target)) {
      appState.chatModelPickerOpen = false;
      changed = true;
    }
    if (appState.chatKeyPickerOpen && !els.chatKeyPicker?.contains(event.target)) {
      appState.chatKeyPickerOpen = false;
      changed = true;
    }
    if (changed) {
      renderChat();
    }
  });

  els.chatEnsureBtn?.addEventListener("click", () => {
    ensureChatReady();
  });

  els.chatInput?.addEventListener("input", () => {
    resizeChatInput();
    renderChat();
  });

  els.chatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  });

  els.chatSendBtn?.addEventListener("click", () => {
    sendChatMessage();
  });
  
  els.modelSearchInput.addEventListener("input", debounce(e => { appState.modelSearch = e.target.value; renderModels(); }, 300));
  els.keySearchInput.addEventListener("input", debounce(e => { appState.keyFilter.search = e.target.value; renderKeys(); }, 300));
  els.keysResetBtn.addEventListener("click", () => { els.keySearchInput.value = ""; appState.keyFilter.search = ""; renderKeys(); });

  els.logSearchInput.addEventListener("input", debounce(e => { appState.logSearch = e.target.value; loadLogs(true); }, 500));
  els.loadMoreLogsBtn.addEventListener("click", () => { appState.logPage++; loadLogs(false); });

  els.createKeyBtn.addEventListener("click", async () => {
    const payload = { name: els.newKeyName.value, group: els.newKeyGroup.value, remain_quota: Number(els.newKeyQuota.value) };
    if (!payload.name) return toast("请输入名称", "error");
    try {
      els.createKeyBtn.disabled = true;
      await api("/miniapi/keys", { method: "POST", body: payload });
      toast("Key 已创建");
      els.newKeyName.value = "";
      els.newKeyGroup.value = "";
      els.newKeyQuota.value = "";
      await loadData();
    } catch (error) {
      toast("创建失败: " + (error.message || "网络错误"), "error");
    } finally {
      els.createKeyBtn.disabled = false;
    }
  });

  els.keysList.addEventListener("click", async e => {
    const item = e.target.closest(".item-card"); if (!item) return; const id = item.dataset.keyId;
    if (e.target.closest(".key-copy")) {
      const keyValue = e.target.closest(".key-copy").dataset.key || "";
      if (!keyValue) {
        return toast("该 Key 未返回明文，请先点编辑查看", "error");
      }
      await navigator.clipboard.writeText(keyValue);
      toast("已复制");
    }
    else if (e.target.closest(".key-view")) {
      try {
        const r = await api(`/miniapi/keys/${id}`); const d = r.data || {};
        appState.editingKeyId = id; els.keyEditorMeta.textContent = `ID: ${id}`;
        els.editorName.value = d.name || ""; els.editorGroup.value = d.group || "";
        els.editorQuota.value = d.remain_quota || 0;
        if (els.editorExpire) els.editorExpire.value = d.expired_time || -1;
        els.editorStatus.checked = Number(d.status) === 1;
        els.editorUnlimited.checked = Boolean(d.unlimited_quota);
        els.editorAllowIps.value = String(d.allow_ips || "").replace(/,/g, "\n");
        els.editorModelLimitToggle.checked = Boolean(d.model_limits_enabled);
        els.editorModelLimitBox.hidden = !d.model_limits_enabled;
        els.editorModelLimits.value = String(d.model_limits || "").replace(/,/g, "\n");
        els.editorKeyValue.value = d.key || "";
        els.keyEditorModal.hidden = false;
      } catch (error) {
        toast("加载 Key 详情失败: " + (error.message || "网络错误"), "error");
      }
    }
    else if (e.target.closest(".key-delete")) {
      const confirmed = window.confirm("确定删除这个 API Key 吗？");
      if (!confirmed) return;
      try {
        await api(`/miniapi/keys/${id}`, { method: "DELETE" });
        clearPersistedChatSelection(id);
        if (String(appState.selectedChatKeyId) === String(id)) {
          appState.selectedChatKeyId = null;
          appState.selectedChatModel = "";
          appState.chatMessages = [];
          persistChatSelection();
        }
        toast("Key 已删除");
        await loadData();
        if (appState.chatInitialized) {
          await loadChatBootstrap(true);
        }
      } catch (error) {
        toast("删除失败: " + (error.message || "网络错误"), "error");
      }
    }
  });

  els.editorModelLimitToggle.addEventListener("change", e => {
    els.editorModelLimitBox.hidden = !e.target.checked;
  });

  els.amountOptions.addEventListener("click", e => { const chip = e.target.closest(".amount-chip"); if (chip) { appState.selectedPayAmount = Number(chip.dataset.amount); els.payAmountInput.value = appState.selectedPayAmount; renderFinance(); } });
  els.methodOptions.addEventListener("click", e => { const chip = e.target.closest(".method-chip"); if (chip) { appState.selectedPayMethod = chip.dataset.method; renderFinance(); } });

  els.payBtn.addEventListener("click", async () => {
    try {
      els.payBtn.disabled = true;
      const r = await api("/miniapi/pay", { method: "POST", body: { amount: Number(els.payAmountInput.value), payment_method: appState.selectedPayMethod } });
      if (r.pay_url) {
        openPayLink(r.pay_url);
      } else {
        toast("未返回支付链接", "error");
      }
    } catch (error) {
      toast("充值下单失败: " + (error.message || "网络错误"), "error");
    } finally {
      els.payBtn.disabled = false;
    }
  });

  els.plansList.addEventListener("click", async e => {
    const btn = e.target.closest(".plan-buy");
    if (!btn) return;
    const planId = btn.dataset.planId;
    const method = btn.dataset.method;
    if (!planId || !method) return;
    const meta = getPaymentMeta(method);
    try {
      btn.disabled = true;
      btn.textContent = "处理中...";
      const r = await api("/miniapi/subscription/buy", { method: "POST", body: { plan_id: Number(planId), payment_method: method } });
      if (r.pay_url) {
        openPayLink(r.pay_url);
      } else {
        toast("未返回支付链接", "error");
      }
    } catch (err) {
      toast("购买失败: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${renderPaymentIcon(method, { compact: true })}<span>${meta.label}</span>`;
    }
  });
  
  els.redeemBtn.addEventListener("click", async () => {
    const code = els.redeemInput.value.trim();
    if(!code) return toast("请输入兑换码", "error");
    try {
      els.redeemBtn.disabled = true;
      await api("/miniapi/redeem", { method: "POST", body: { code } });
      toast("兑换成功", "success");
      els.redeemInput.value = "";
      await loadData();
    } catch (error) {
      toast("兑换失败: " + (error.message || "网络错误"), "error");
    } finally {
      els.redeemBtn.disabled = false;
    }
  });

  els.usageRangeButtons?.addEventListener("click", e => { const btn = e.target.closest(".seg-btn"); if (btn) { appState.usageDays = Number(btn.dataset.days); renderUsageChart(); } });
  
  els.keyEditorCloseBtn.addEventListener("click", () => els.keyEditorModal.hidden = true);
  els.editorCopyKeyBtn.addEventListener("click", () => { navigator.clipboard.writeText(els.editorKeyValue.value); toast("已复制"); });
  
  els.editorSaveBtn.addEventListener("click", async () => {
    const payload = {
      name: els.editorName.value, group: els.editorGroup.value,
      remain_quota: Number(els.editorQuota.value),
      expired_time: els.editorExpire ? (Number(els.editorExpire.value) || -1) : -1,
      status: els.editorStatus.checked ? 1 : 2,
      unlimited_quota: els.editorUnlimited.checked,
      allow_ips: normalizeDelimitedText(els.editorAllowIps.value),
      model_limits_enabled: els.editorModelLimitToggle.checked,
      model_limits: els.editorModelLimitToggle.checked ? normalizeDelimitedText(els.editorModelLimits.value) : ""
    };
    try {
      els.editorSaveBtn.disabled = true;
      await api(`/miniapi/keys/${appState.editingKeyId}`, { method: "PUT", body: payload });
      toast("配置已保存");
      els.keyEditorModal.hidden = true;
      await loadData();
    } catch (error) {
      toast("保存失败: " + (error.message || "网络错误"), "error");
    } finally {
      els.editorSaveBtn.disabled = false;
    }
  });

  els.inviteBtn.addEventListener("click", () => els.affiliateModal.hidden = false);
  els.affCloseBtn.addEventListener("click", () => els.affiliateModal.hidden = true);
  els.affCopyBtn.addEventListener("click", () => { navigator.clipboard.writeText(els.affLinkInput.value); toast("已复制邀请链接"); });
  
  els.affiliateModal.addEventListener("click", e => { if (e.target.closest(".modal-mask")) els.affiliateModal.hidden = true; });
  els.keyEditorModal.addEventListener("click", e => { if (e.target.closest(".modal-mask")) els.keyEditorModal.hidden = true; });
}

function init() {
  tg?.ready(); tg?.expand(); applyTheme();
  if (els.payAmountInput && !els.payAmountInput.value) {
    els.payAmountInput.value = String(appState.selectedPayAmount);
  }
  bindEvents();
  renderChat();
  loadData();
}

init();
