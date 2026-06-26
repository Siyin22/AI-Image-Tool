const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const dns = require("dns");
const { execFileSync } = require("child_process");
const { URL } = require("url");

const host = "127.0.0.1";
const preferredPort = Number(process.env.PORT || 17860);
const root = __dirname;
const activeTasks = new Map();
const referenceFiles = new Map();
const referenceDir = path.join(os.tmpdir(), "ai-image-tool-references");
const taskStatusStore = new Map();
const warmedHosts = new Set();
const storageDir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "AIImageTool");
const configStateFile = path.join(storageDir, "settings.json");
const historyStateFile = path.join(storageDir, "history.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

fs.mkdirSync(referenceDir, { recursive: true });
fs.mkdirSync(storageDir, { recursive: true });
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Older Node versions may not support this call.
}

let configStateCache = loadConfigState();
let historyStateCache = loadHistoryState();

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultConfigState() {
  return {
    version: 2,
    configs: [],
    activeConfigId: "",
    presets: []
  };
}

function defaultHistoryState() {
  return {
    version: 2,
    history: []
  };
}

function normalizeProviderType(value) {
  if (value === "bailian" || value === "custom") return value;
  return "openai-compatible";
}

function runPowerShell(script, payload) {
  return execFileSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    encoding: "utf8",
    input: JSON.stringify(payload || {}),
    stdio: ["pipe", "pipe", "pipe"]
  }).trim();
}

function protectTextForCurrentUser(text) {
  if (!text) return "";
  if (process.platform !== "win32") return Buffer.from(String(text), "utf8").toString("base64");
  const output = runPowerShell(`
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $secure = ConvertTo-SecureString -String ([string]$payload.value) -AsPlainText -Force
    ConvertFrom-SecureString -SecureString $secure
  `, { value: String(text) });
  return String(output || "").replace(/\r?\n/g, "");
}

function unprotectTextForCurrentUser(protectedText) {
  if (!protectedText) return "";
  if (process.platform !== "win32") return Buffer.from(String(protectedText), "base64").toString("utf8");
  return runPowerShell(`
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $secure = ConvertTo-SecureString -String ([string]$payload.value)
    $credential = New-Object System.Management.Automation.PSCredential ('ignored', $secure)
    $credential.GetNetworkCredential().Password
  `, { value: String(protectedText) });
}

function normalizeStoredConfig(config, index, existingConfig) {
  const previous = existingConfig || {};
  const rawApiKey = String(config?.apiKey || "").trim();
  const keepProtectedApiKey = String(config?.protectedApiKey || previous.protectedApiKey || "");
  const protectedApiKey = rawApiKey
    ? protectTextForCurrentUser(rawApiKey)
    : keepProtectedApiKey;
  const keepLegacyEncrypted = rawApiKey ? "" : String(config?.encryptedApiKey || previous.encryptedApiKey || "");
  const keepLegacySalt = rawApiKey ? "" : String(config?.salt || previous.salt || "");
  const keepLegacyIv = rawApiKey ? "" : String(config?.iv || previous.iv || "");

  return {
    id: String(config?.id || previous.id || crypto.randomUUID()),
    name: String(config?.name || previous.name || "未命名配置"),
    providerType: normalizeProviderType(config?.providerType || previous.providerType),
    baseUrl: String(config?.baseUrl || previous.baseUrl || ""),
    model: String(config?.model || previous.model || ""),
    priority: Math.max(1, Number(config?.priority ?? previous.priority ?? (index + 1)) || (index + 1)),
    timeoutSeconds: Math.max(15, Number(config?.timeoutSeconds ?? previous.timeoutSeconds ?? 120) || 120),
    autoFallback: config?.autoFallback !== false,
    enabled: config?.enabled !== false,
    workspace: String(config?.workspace || previous.workspace || ""),
    protectedApiKey,
    encryptedApiKey: keepLegacyEncrypted,
    salt: keepLegacySalt,
    iv: keepLegacyIv
  };
}

function normalizeConfigState(rawState, existingState) {
  const base = defaultConfigState();
  const current = existingState || base;
  const input = rawState && typeof rawState === "object" ? rawState : {};
  const existingConfigs = new Map((current.configs || []).map(config => [config.id, config]));
  const configs = Array.isArray(input.configs)
    ? input.configs.map((config, index) => normalizeStoredConfig(config, index, existingConfigs.get(config?.id)))
    : [];
  const activeConfigId = String(input.activeConfigId || "");
  return {
    version: 2,
    configs,
    activeConfigId: configs.some(config => config.id === activeConfigId)
      ? activeConfigId
      : (configs[0]?.id || ""),
    presets: Array.isArray(input.presets) ? cloneJson(input.presets).slice(0, 30) : []
  };
}

function normalizeHistoryState(rawState) {
  const input = rawState && typeof rawState === "object" ? rawState : {};
  return {
    version: 2,
    history: Array.isArray(input.history) ? cloneJson(input.history).slice(0, 200) : []
  };
}

function readJsonFile(filePath, fallbackFactory) {
  try {
    if (!fs.existsSync(filePath)) return fallbackFactory();
    const raw = fs.readFileSync(filePath, "utf8");
    return raw ? JSON.parse(raw) : fallbackFactory();
  } catch {
    return fallbackFactory();
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function loadConfigState() {
  return normalizeConfigState(readJsonFile(configStateFile, defaultConfigState));
}

function loadHistoryState() {
  return normalizeHistoryState(readJsonFile(historyStateFile, defaultHistoryState));
}

function saveConfigState(rawState) {
  const nextState = normalizeConfigState(rawState, configStateCache);
  writeJsonFile(configStateFile, nextState);
  configStateCache = nextState;
  return nextState;
}

function saveHistoryState(rawState) {
  const nextState = normalizeHistoryState(rawState);
  writeJsonFile(historyStateFile, nextState);
  historyStateCache = nextState;
  return nextState;
}

function sanitizeConfigForClient(config) {
  return {
    id: config.id,
    name: config.name,
    providerType: config.providerType,
    baseUrl: config.baseUrl,
    model: config.model,
    priority: config.priority,
    timeoutSeconds: config.timeoutSeconds,
    autoFallback: config.autoFallback !== false,
    enabled: config.enabled !== false,
    workspace: config.workspace || "",
    encryptedApiKey: config.encryptedApiKey || "",
    salt: config.salt || "",
    iv: config.iv || "",
    hasApiKey: Boolean(config.protectedApiKey || config.encryptedApiKey)
  };
}

function getClientState() {
  return {
    configs: configStateCache.configs.map(sanitizeConfigForClient),
    activeConfigId: configStateCache.activeConfigId || "",
    presets: cloneJson(configStateCache.presets || []),
    history: cloneJson(historyStateCache.history || [])
  };
}

function findStoredConfig(configId) {
  if (!configId) return null;
  return configStateCache.configs.find(config => config.id === configId) || null;
}

function hasStoredConfigState() {
  return Boolean(
    configStateCache.configs.length ||
    configStateCache.presets.length ||
    configStateCache.activeConfigId
  );
}

function configHasSecret(config) {
  return Boolean(String(config?.apiKey || config?.protectedApiKey || config?.encryptedApiKey || "").trim());
}

function isDefaultStarterConfig(config) {
  const providerType = normalizeProviderType(config?.providerType);
  const name = String(config?.name || "").trim();
  const baseUrl = String(config?.baseUrl || "").trim();
  const model = String(config?.model || "").trim();
  return (
    providerType === "openai-compatible" &&
    !configHasSecret(config) &&
    (!name || name === "OpenAI兼容配置" || name === "OpenAI兼容") &&
    (!baseUrl || baseUrl === "https://api.openai.com/v1") &&
    (!model || model === "gpt-image-1")
  );
}

function hasUsefulConfigState(state = configStateCache) {
  const configs = Array.isArray(state?.configs) ? state.configs : [];
  const presets = Array.isArray(state?.presets) ? state.presets : [];
  if (presets.length) return true;
  if (configs.some(configHasSecret)) return true;
  if (configs.length > 1) return true;
  return configs.length === 1 && !isDefaultStarterConfig(configs[0]);
}

function hasUsefulLegacyConfigState(legacyState) {
  const configs = Array.isArray(legacyState?.configs) ? legacyState.configs : [];
  const presets = Array.isArray(legacyState?.presets) ? legacyState.presets : [];
  const activeConfigId = String(legacyState?.activeConfigId || "");
  if (presets.length) return true;
  if (configs.some(configHasSecret)) return true;
  if (configs.length > 1) return true;
  if (configs.length === 1 && !isDefaultStarterConfig(configs[0])) return true;
  return Boolean(activeConfigId && configs.some(config => String(config?.id || "") === activeConfigId));
}

function hasStoredHistoryState() {
  return Boolean(historyStateCache.history.length);
}

function resolveStoredApiKey(config) {
  if (config?.apiKey) return String(config.apiKey);
  const storedConfig = findStoredConfig(config?.id);
  if (storedConfig?.protectedApiKey) {
    try {
      return unprotectTextForCurrentUser(storedConfig.protectedApiKey);
    } catch {
      throw userError("无法读取本机保存的 API Key，请重新填写后保存。", "local_key_error");
    }
  }
  if (storedConfig?.encryptedApiKey) {
    throw userError("这是旧版加密配置，请在配置中心重新输入 API Key 后保存一次。", "legacy_key");
  }
  throw userError("当前配置缺少 API Key。", "missing_key");
}

function hydrateRequestConfig(config) {
  const storedConfig = findStoredConfig(config?.id);
  const merged = {
    ...(storedConfig || {}),
    ...(config || {})
  };
  merged.apiKey = resolveStoredApiKey(config || storedConfig || {});
  return merged;
}

function migrateLegacyStateIfNeeded(legacyState) {
  if (!legacyState || typeof legacyState !== "object") return false;
  let migrated = false;

  const legacyConfigs = Array.isArray(legacyState.configs) ? legacyState.configs : [];
  const legacyPresets = Array.isArray(legacyState.presets) ? legacyState.presets : [];
  const legacyActiveConfigId = String(legacyState.activeConfigId || "");
  const hasLegacyConfigPayload = Boolean(legacyConfigs.length || legacyPresets.length || legacyActiveConfigId);
  if (hasLegacyConfigPayload && (!hasStoredConfigState() || (!hasUsefulConfigState() && hasUsefulLegacyConfigState(legacyState)))) {
    saveConfigState({
      configs: legacyConfigs,
      activeConfigId: legacyActiveConfigId,
      presets: legacyPresets
    });
    migrated = true;
  }

  const legacyHistory = Array.isArray(legacyState.history) ? legacyState.history : [];
  if (!hasStoredHistoryState() && legacyHistory.length) {
    saveHistoryState({
      history: legacyHistory
    });
    migrated = true;
  }

  return migrated;
}

function buildClientStateResponse(extra = {}) {
  return {
    ok: true,
    ...getClientState(),
    ...extra
  };
}

async function warmupHost(targetUrl) {
  try {
    const hostname = new URL(targetUrl).hostname;
    if (!hostname || warmedHosts.has(hostname)) return;
    await dns.promises.lookup(hostname);
    warmedHosts.add(hostname);
  } catch (error) {
    const code = error?.code || "";
    if (code === "ENOTFOUND") {
      throw userError("无法解析服务地址，请检查网关地址或当前网络。", "dns_error", code);
    }
    throw error;
  }
}

function setTaskStatus(taskId, patch) {
  if (!taskId) return;
  const current = taskStatusStore.get(taskId) || {};
  taskStatusStore.set(taskId, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  });
}

function clearTaskStatus(taskId) {
  if (!taskId) return;
  taskStatusStore.delete(taskId);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 32 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON 格式无效"));
      }
    });
    req.on("error", reject);
  });
}

function readBinaryBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(userError("上传文件过大。", "payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function cleanBaseUrl(value, fallback) {
  return String(value || fallback || "").replace(/\/+$/, "");
}

function timeoutSignal(seconds, parentSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(15, seconds || 120) * 1000);
  const relayAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) relayAbort();
    else parentSignal.addEventListener("abort", relayAbort, { once: true });
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener("abort", relayAbort);
    }
  };
}

async function fetchJson(url, options, timeoutSeconds, parentSignal) {
  if (typeof fetch !== "function") {
    throw userError("当前 Node.js 版本不支持 fetch，请安装 Node.js 18 或更高版本。", "runtime");
  }
  await warmupHost(url);
  const timeout = timeoutSignal(timeoutSeconds, parentSignal);
  try {
    const response = await fetch(url, { ...options, signal: timeout.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!response.ok) {
      throw normalizeHttpError(response.status, body);
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      throw userError(parentSignal?.aborted ? "任务已中止。" : "请求超时，请稍后重试或切换备用配置。", parentSignal?.aborted ? "cancelled" : "timeout");
    }
    if (error instanceof TypeError) {
      const code = error.cause?.code || "";
      const detail = [
        code || null,
        error.cause?.syscall || null,
        error.cause?.address || null
      ].filter(Boolean).join(" · ");

      if (/ENOTFOUND|EAI_AGAIN/.test(code)) {
        throw userError("无法连接到外部生图服务，请检查网络、DNS 或网关地址。", "network_error", detail || error.message);
      }
      if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET/.test(code)) {
        throw userError("连接外部生图服务失败，通常是网络握手不稳定。请稍后重试。", "network_error", detail || error.message);
      }
      throw userError("连接外部生图服务失败，请稍后重试。", "network_error", detail || error.message);
    }
    throw error;
  } finally {
    timeout.done();
  }
}

function userError(message, code, detail) {
  const error = new Error(message);
  error.userMessage = message;
  error.code = code || "unknown";
  error.detail = detail;
  return error;
}

function contentTypeExtension(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  return "bin";
}

function ensureReferenceFile(fileId) {
  const meta = referenceFiles.get(fileId);
  if (!meta) throw userError("参考图已失效，请重新上传。", "missing_reference");
  return meta;
}

function removeReferenceFile(fileId) {
  const meta = referenceFiles.get(fileId);
  if (!meta) return;
  referenceFiles.delete(fileId);
  fs.unlink(meta.path, () => {});
}

function normalizeHttpError(status, body) {
  const rawMessage = body?.error?.message || body?.message || body?.code || body?.raw || `HTTP ${status}`;
  if (status === 401 || status === 403) return userError("认证失败，请检查 API Key 或账号权限。", "auth", rawMessage);
  if (status === 404) return userError("接口地址或模型不存在，请检查网关地址和模型名。", "not_found", rawMessage);
  if (status === 429) return userError("请求过快或额度受限，请稍后重试。", "rate_limited", rawMessage);
  if (status >= 500) return userError("服务暂时不可用，请稍后重试或切换备用配置。", "server", rawMessage);
  return userError(String(rawMessage).slice(0, 300), "bad_request", rawMessage);
}

function stylePrompt(prompt, style) {
  const presets = {
    photo: "写实摄影，真实材质，自然光线，细节清晰",
    product: "商业产品海报，主体突出，棚拍柔光，干净背景，适合广告展示",
    illustration: "精致插画风格，色彩协调，线条清晰，画面完整",
    ecommerce: "电商主图，主体居中，高清，干净背景，无水印",
    cover: "社媒封面构图，视觉中心明确，留有标题空间，画面有冲击力"
  };
  const suffix = presets[style];
  return suffix ? `${prompt}，${suffix}` : prompt;
}

function buildOpenAiBody(task) {
  const body = {
    model: task.model,
    prompt: stylePrompt(task.prompt, task.stylePreset),
    n: task.count || 1,
    size: task.size || "1024x1024"
  };
  if (task.quality && task.quality !== "auto") body.quality = task.quality;
  if (task.negativePrompt) body.negative_prompt = task.negativePrompt;
  if (task.seed !== null && task.seed !== undefined && task.seed !== "") body.seed = Number(task.seed);
  return body;
}

function buildGenerationUrl(config) {
  const baseUrl = cleanBaseUrl(config.baseUrl, "https://api.openai.com/v1");
  return /\/images\/generations\/?$/i.test(baseUrl) ? baseUrl : `${baseUrl}/images/generations`;
}

function buildEditUrl(config) {
  const baseUrl = cleanBaseUrl(config.baseUrl, "https://api.openai.com/v1");
  if (/\/images\/edits\/?$/i.test(baseUrl)) return baseUrl;
  if (/\/images\/generations\/?$/i.test(baseUrl)) return baseUrl.replace(/\/images\/generations\/?$/i, "/images/edits");
  return `${baseUrl}/images/edits`;
}

function referenceFileToBlob(item) {
  const meta = ensureReferenceFile(item.fileId);
  const buffer = fs.readFileSync(meta.path);
  return new Blob([buffer], { type: meta.type || item.type || "image/png" });
}

function buildOpenAiEditForm(config, task, imageFieldName = "image") {
  const form = new FormData();
  form.append("model", config.model || task.model);
  form.append("prompt", stylePrompt(task.prompt, task.stylePreset));
  form.append("n", String(task.count || 1));
  form.append("size", task.size || "1024x1024");
  if (task.quality && task.quality !== "auto") form.append("quality", task.quality);
  const images = task.referenceImages || [];
  images.forEach((item, index) => {
    const meta = ensureReferenceFile(item.fileId);
    const extension = contentTypeExtension(meta.type || item.type || "image/png");
    const filename = `reference-${index + 1}.${extension}`;
    form.append(imageFieldName, referenceFileToBlob(item), filename);
  });
  return form;
}

function shouldRetryOpenAiEditWithLegacyImages(error, task) {
  return (task.referenceImages || []).length > 1
    && ["bad_request", "not_found", "server", "network_error"].includes(error?.code);
}

function extractOpenAiCompatibleImages(json, config, task) {
  const data = Array.isArray(json?.data)
    ? json.data
    : (Array.isArray(json?.images) ? json.images : []);
  return data.map((item, index) => ({
    id: `img_${Date.now()}_${index}`,
    url: item.url || item.image_url || item.output_url || item.image || null,
    b64: item.b64_json || item.base64 || item.image_base64 || null,
    revisedPrompt: item.revised_prompt || null,
    provider: config.providerType,
    model: config.model || task.model,
    width: Number((task.size || "").split("x")[0]) || null,
    height: Number((task.size || "").split("x")[1]) || null
  })).filter(item => item.url || item.b64);
}

async function generateOpenAiCompatible(config, task, signal) {
  setTaskStatus(task.id, {
    stage: "submitting",
    text: "正在提交到图像接口",
    detail: Array.isArray(task.referenceImages) && task.referenceImages.length
      ? "本次请求携带参考图，正在调用图像编辑接口。"
      : "本次请求为纯文生图，正在调用图像生成接口。"
  });
  const hasReferenceImages = Array.isArray(task.referenceImages) && task.referenceImages.length > 0;
  const url = hasReferenceImages ? buildEditUrl(config) : buildGenerationUrl(config);
  if (hasReferenceImages) {
    const requestTask = { ...task, model: config.model || task.model };
    let json;
    try {
      const form = buildOpenAiEditForm(config, requestTask, "image");
      json = await fetchJson(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiKey}`
        },
        body: form
      }, config.timeoutSeconds, signal);
    } catch (error) {
      if (!shouldRetryOpenAiEditWithLegacyImages(error, task)) throw error;
      setTaskStatus(task.id, {
        stage: "retrying",
        text: "正在改用兼容格式重试",
        detail: "外部接口没有接受多参考图的标准 image 字段，正在尝试 image[] 字段格式。"
      });
      const legacyForm = buildOpenAiEditForm(config, requestTask, "image[]");
      try {
        json = await fetchJson(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`
          },
          body: legacyForm
        }, config.timeoutSeconds, signal);
      } catch (retryError) {
        retryError.detail = [
          retryError.detail || retryError.message,
          `首次请求失败：${error.detail || error.message}`
        ].filter(Boolean).join("；");
        throw retryError;
      }
    }

    setTaskStatus(task.id, {
      stage: "finalizing",
      text: "接口已返回，正在整理图片结果",
      detail: "正在读取平台返回的图片地址与元信息。"
    });
    const images = extractOpenAiCompatibleImages(json, config, task);

    if (!images.length) {
      throw userError("接口已返回，但没有找到图片数据。", "empty_result", json);
    }
    return { images };
  }

  const body = buildOpenAiBody({ ...task, model: config.model || task.model });
  const json = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  }, config.timeoutSeconds, signal);

  setTaskStatus(task.id, {
    stage: "finalizing",
    text: "接口已返回，正在整理图片结果",
    detail: "正在读取平台返回的图片地址与元信息。"
  });
  const images = extractOpenAiCompatibleImages(json, config, { ...task, model: body.model, size: body.size });

  if (!images.length) {
    throw userError("接口已返回，但没有找到图片数据。", "empty_result", json);
  }
  return { images };
}

function buildBailianBody(config, task) {
  const parameters = {
    size: task.size || "1024*1024",
    n: task.count || 1
  };
  if (task.size && task.size.includes("x")) parameters.size = task.size.replace("x", "*");
  if (task.seed !== null && task.seed !== undefined && task.seed !== "") parameters.seed = Number(task.seed);
  if (task.steps) parameters.steps = Number(task.steps);
  if (task.guidance) parameters.scale = Number(task.guidance);
  if (task.stylePreset && task.stylePreset !== "none") parameters.style = task.stylePreset;

  return {
    model: config.model || task.model || "wanx2.1-t2i-turbo",
    input: {
      prompt: stylePrompt(task.prompt, task.stylePreset),
      negative_prompt: task.negativePrompt || undefined
    },
    parameters
  };
}

function isBailianV2Model(model) {
  return /^wan2\.(6|7|8)/i.test(String(model || ""));
}

function bailianRootUrl(config) {
  const baseUrl = cleanBaseUrl(config.baseUrl, "https://dashscope.aliyuncs.com/api/v1");
  const apiIndex = baseUrl.indexOf("/api/v1");
  if (apiIndex >= 0) return baseUrl.slice(0, apiIndex + "/api/v1".length);
  return baseUrl;
}

function bailianCreateUrl(config, protocol) {
  const baseUrl = cleanBaseUrl(config.baseUrl, "https://dashscope.aliyuncs.com/api/v1");
  if (/\/services\/aigc\//i.test(baseUrl)) return baseUrl;
  const path = protocol === "v2"
    ? "/services/aigc/image-generation/generation"
    : "/services/aigc/text2image/image-synthesis";
  return `${baseUrl}${path}`;
}

function buildBailianV2Body(config, task) {
  const parameters = {
    prompt_extend: true,
    watermark: false,
    n: task.count || 1,
    size: (task.size || "1280x1280").replace("x", "*")
  };
  if (task.negativePrompt) parameters.negative_prompt = task.negativePrompt;
  if (task.seed !== null && task.seed !== undefined && task.seed !== "") parameters.seed = Number(task.seed);

  return {
    model: config.model || task.model || "wan2.6-t2i",
    input: {
      messages: [
        {
          role: "user",
          content: [
            {
              text: stylePrompt(task.prompt, task.stylePreset)
            }
          ]
        }
      ]
    },
    parameters
  };
}

function buildBailianReferenceItems(task) {
  return (task.referenceImages || []).map(item => {
    const meta = ensureReferenceFile(item.fileId);
    const buffer = fs.readFileSync(meta.path);
    return {
      mimeType: meta.type || item.type || "image/png",
      data: buffer.toString("base64")
    };
  });
}

function buildBailianV2ReferenceBody(config, task) {
  const imageItems = buildBailianReferenceItems(task);
  const userContent = [
    {
      text: stylePrompt(task.prompt, task.stylePreset)
    },
    ...imageItems.map(item => ({
      image: `data:${item.mimeType};base64,${item.data}`
    }))
  ];

  const parameters = {
    prompt_extend: true,
    watermark: false,
    n: task.count || 1,
    size: (task.size || "1280x1280").replace("x", "*")
  };
  if (task.negativePrompt) parameters.negative_prompt = task.negativePrompt;
  if (task.seed !== null && task.seed !== undefined && task.seed !== "") parameters.seed = Number(task.seed);

  return {
    model: config.model || task.model || "wan2.6-t2i",
    input: {
      messages: [
        {
          role: "user",
          content: userContent
        }
      ]
    },
    parameters
  };
}

function extractBailianImages(output, provider, model, task) {
  const results = output?.results || output?.task_results || [];
  const fromResults = results.map((item, index) => ({
    id: `img_${Date.now()}_${index}`,
    url: item.url || item.image_url || item.output_url || null,
    b64: null,
    revisedPrompt: null,
    provider,
    model,
    width: Number((task.size || "").split("x")[0]) || null,
    height: Number((task.size || "").split("x")[1]) || null
  })).filter(item => item.url);

  const choices = output?.choices || [];
  const fromChoices = [];
  choices.forEach((choice, choiceIndex) => {
    const content = choice?.message?.content || [];
    content.forEach((item, contentIndex) => {
      if (!item?.image) return;
      fromChoices.push({
        id: `img_${Date.now()}_${choiceIndex}_${contentIndex}`,
        url: item.image,
        b64: null,
        revisedPrompt: null,
        provider,
        model,
        width: Number((task.size || "").split("x")[0]) || null,
        height: Number((task.size || "").split("x")[1]) || null
      });
    });
  });

  return [...fromResults, ...fromChoices];
}

async function generateBailian(config, task, signal) {
  const model = config.model || task.model || "wan2.6-t2i";
  const protocol = isBailianV2Model(model) ? "v2" : "v1";
  if (task.referenceImages?.length && protocol !== "v2") {
    throw userError("当前百炼模型暂不支持参考图，请切换到 wan2.6 或更新模型。", "unsupported_reference");
  }
  const createUrl = bailianCreateUrl(config, protocol);
  const rootUrl = bailianRootUrl(config);
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.apiKey}`,
    "X-DashScope-Async": "enable"
  };
  if (config.workspace) headers["X-DashScope-WorkSpace"] = config.workspace;

  const createBody = protocol === "v2"
    ? (task.referenceImages?.length ? buildBailianV2ReferenceBody(config, task) : buildBailianV2Body(config, task))
    : buildBailianBody(config, task);
  setTaskStatus(task.id, {
    stage: "submitting",
    text: "正在提交到百炼",
    detail: protocol === "v2"
      ? "百炼新图像接口已准备提交。"
      : "百炼旧通义万相接口已准备提交。"
  });
  const created = await fetchJson(createUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(createBody)
  }, config.timeoutSeconds, signal);

  const taskId = created?.output?.task_id || created?.task_id;
  if (!taskId) {
    throw userError("任务已提交，但没有返回 task_id。", "empty_task", created);
  }
  setTaskStatus(task.id, {
    stage: "queued",
    text: "百炼任务已创建",
    detail: `任务编号 ${taskId}，正在等待平台处理。`
  });

  const startedAt = Date.now();
  const maxMs = Math.max(30, config.timeoutSeconds || 120) * 1000;
  let last = null;
  while (Date.now() - startedAt < maxMs) {
    if (signal?.aborted) throw userError("任务已中止。", "cancelled");
    await new Promise(resolve => setTimeout(resolve, 2200));
    setTaskStatus(task.id, {
      stage: "polling",
      text: "正在轮询百炼任务",
      detail: `已等待 ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))} 秒，正在获取平台最新状态。`
    });
    last = await fetchJson(`${rootUrl}/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`
      }
    }, config.timeoutSeconds, signal);
    const status = last?.output?.task_status || last?.task_status || "";
    if (status) {
      setTaskStatus(task.id, {
        stage: "provider_status",
        text: `平台状态：${status}`,
        detail: "本状态由百炼任务查询接口返回。"
      });
    }
    if (/SUCCEEDED|SUCCESS/i.test(status)) {
      setTaskStatus(task.id, {
        stage: "finalizing",
        text: "百炼已完成，正在整理结果",
        detail: "正在提取图片地址与任务返回信息。"
      });
      const images = extractBailianImages(last?.output || last, "bailian", createBody.model, task);
      if (!images.length) throw userError("任务成功，但没有找到图片地址。", "empty_result", last);
      return { images, remoteTaskId: taskId };
    }
    if (/FAILED|CANCELED|UNKNOWN/i.test(status)) {
      throw userError(last?.output?.message || "百炼任务生成失败。", "provider_failed", last);
    }
  }

  throw userError("任务仍在生成中，请稍后重试或提高超时时间。", "timeout", last);
}

async function testConfig(config) {
  if (!config?.apiKey) throw userError("请先填写 API Key。", "missing_key");
  if (config.providerType === "bailian") {
    return {
      ok: true,
      message: "本地校验通过。百炼会在生成时提交异步任务。",
      provider: "bailian"
    };
  }
  if (/\/images\/generations\/?$/i.test(config.baseUrl || "")) {
    return {
      ok: true,
      message: "本地校验通过。该平台将在生成时调用图像生成接口。",
      provider: config.providerType || "custom"
    };
  }

  const baseUrl = cleanBaseUrl(config.baseUrl, "https://api.openai.com/v1");
  const json = await fetchJson(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`
    }
  }, Math.min(config.timeoutSeconds || 30, 30));

  return {
    ok: true,
    message: "连接成功。",
    provider: config.providerType,
    models: Array.isArray(json?.data) ? json.data.slice(0, 20).map(item => item.id).filter(Boolean) : []
  };
}

async function handleApi(req, res, route) {
  try {
    if (route === "/api/task-status") {
      const payload = await readBody(req);
      const taskId = payload.taskId;
      sendJson(res, 200, { ok: true, status: taskId ? taskStatusStore.get(taskId) || null : null });
      return;
    }
    if (route === "/api/upload-reference") {
      const contentType = String(req.headers["content-type"] || "");
      if (!/image\/(png|jpeg|jpg|webp)/i.test(contentType)) {
        throw userError("只支持 PNG、JPEG 或 WebP 参考图。", "unsupported_type");
      }
      const fileNameHeader = String(req.headers["x-file-name"] || "reference");
      const fileSize = Number(req.headers["x-file-size"] || 0);
      const buffer = await readBinaryBody(req, 16 * 1024 * 1024);
      const fileId = crypto.randomUUID();
      const ext = contentTypeExtension(contentType);
      const filePath = path.join(referenceDir, `${fileId}.${ext}`);
      fs.writeFileSync(filePath, buffer);
      referenceFiles.set(fileId, {
        id: fileId,
        name: fileNameHeader,
        type: contentType,
        size: fileSize || buffer.length,
        path: filePath,
        createdAt: Date.now()
      });
      sendJson(res, 200, {
        ok: true,
        fileId,
        name: fileNameHeader,
        type: contentType,
        size: fileSize || buffer.length
      });
      return;
    }

    const payload = await readBody(req);
    if (route === "/api/load-state") {
      const migrated = migrateLegacyStateIfNeeded(payload.legacyState);
      sendJson(res, 200, buildClientStateResponse({ migrated }));
      return;
    }
    if (route === "/api/save-config-state") {
      saveConfigState({
        configs: payload.configs,
        activeConfigId: payload.activeConfigId,
        presets: payload.presets
      });
      sendJson(res, 200, buildClientStateResponse());
      return;
    }
    if (route === "/api/save-history-state") {
      saveHistoryState({
        history: payload.history
      });
      sendJson(res, 200, { ok: true, history: cloneJson(historyStateCache.history) });
      return;
    }
    if (route === "/api/delete-reference") {
      if (payload.fileId) removeReferenceFile(payload.fileId);
      sendJson(res, 200, { ok: true, message: "参考图已删除。" });
      return;
    }
    if (route === "/api/cancel") {
      const taskId = payload.taskId;
      const controller = taskId ? activeTasks.get(taskId) : null;
      if (controller) {
        controller.abort();
        activeTasks.delete(taskId);
      }
      setTaskStatus(taskId, {
        stage: "cancelled",
        text: "任务已取消",
        detail: "已向本地服务发送取消信号。"
      });
      sendJson(res, 200, { ok: true, message: "已发送中止信号。" });
      return;
    }
    if (route === "/api/test-config") {
      const config = hydrateRequestConfig(payload.config);
      const result = await testConfig(config);
      sendJson(res, 200, result);
      return;
    }
    if (route === "/api/generate") {
      const task = payload.task;
      const config = hydrateRequestConfig(payload.config);
      if (!config?.apiKey) throw userError("当前配置缺少 API Key。", "missing_key");
      if (!task?.prompt) throw userError("请先输入提示词。", "missing_prompt");
      const provider = config.providerType || "openai-compatible";
      const controller = new AbortController();
      if (task.id) activeTasks.set(task.id, controller);
      setTaskStatus(task.id, {
        stage: "accepted",
        text: "本地服务已接收任务",
        detail: `${config.name || "当前配置"} · ${provider}`
      });
      try {
        const result = provider === "bailian"
          ? await generateBailian(config, task, controller.signal)
          : await generateOpenAiCompatible(config, task, controller.signal);
        setTaskStatus(task.id, {
          stage: "completed",
          text: "任务已完成",
          detail: `已返回 ${(result.images || []).length} 张图片。`
        });
        sendJson(res, 200, { ok: true, ...result });
      } finally {
        if (task.id) activeTasks.delete(task.id);
        if (task.id) {
          setTimeout(() => clearTaskStatus(task.id), 5 * 60 * 1000);
        }
      }
      return;
    }
    sendJson(res, 404, { ok: false, message: "接口不存在。" });
  } catch (error) {
    const message = error.userMessage || error.message || "未知错误";
    sendJson(res, 400, {
      ok: false,
      code: error.code || "unknown",
      message,
      detail: typeof error.detail === "string" ? error.detail.slice(0, 500) : undefined
    });
  }
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(root, decodeURIComponent(safePath)));
  if (!filePath.startsWith(root)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0"
    });
    res.end(data);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const parsed = new URL(req.url, `http://${host}`);
    if (req.method === "POST" && parsed.pathname.startsWith("/api/")) {
      handleApi(req, res, parsed.pathname);
      return;
    }
    if (req.method !== "GET") {
      sendText(res, 405, "Method not allowed");
      return;
    }
    serveStatic(req, res, parsed.pathname);
  });
}

function start(port) {
  const server = createServer();
  server.on("error", error => {
    if (error.code === "EADDRINUSE") {
      console.error(`端口 ${port} 已被占用。请关闭已有的 AI生图小工具窗口，或直接访问 http://${host}:${port}`);
      process.exit(1);
      return;
    }
    console.error(error.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`AI生图小工具已启动：http://${host}:${port}`);
  });
}

start(preferredPort);
