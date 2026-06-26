const storeKeys = {
  configs: "ai-image-tool.configs.v1",
  activeConfigId: "ai-image-tool.activeConfigId.v1",
  history: "ai-image-tool.history.v1",
  presets: "ai-image-tool.presets.v1"
};

const providerDefaults = {
  "openai-compatible": {
    name: "OpenAI兼容",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-1"
  },
  bailian: {
    name: "阿里百炼",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1",
    model: "wan2.6-t2i"
  },
  custom: {
    name: "自定义",
    baseUrl: "",
    model: ""
  }
};

const ratioSizeOptions = {
  "1:1": ["512x512", "768x768", "1024x1024", "1536x1536", "2048x2048"],
  "3:4": ["768x1024", "960x1280", "1152x1536", "1536x2048"],
  "4:3": ["1024x768", "1280x960", "1536x1152", "2048x1536"],
  "9:16": ["576x1024", "720x1280", "1080x1920", "1440x2560"],
  "16:9": ["1024x576", "1280x720", "1600x900", "1920x1080", "2560x1440"]
};

const bailianV2SizeOptions = {
  "1:1": ["1280x1280", "1440x1440"],
  "3:4": ["1104x1472", "1200x1600"],
  "4:3": ["1472x1104", "1600x1200"],
  "9:16": ["960x1696", "1080x1920"],
  "16:9": ["1696x960", "1920x1080"]
};

const MAX_REFERENCE_IMAGES = 12;
const MAX_REFERENCE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 96 * 1024 * 1024;

const state = {
  configs: [],
  activeConfigId: "",
  editingConfigId: "",
  presets: [],
  history: [],
  latestResults: [],
  lastTask: null,
  taskTimeline: [],
  taskStage: null,
  lastTaskConfig: null,
  lastTaskPayload: null,
  currentController: null,
  currentTaskId: "",
  currentStatusPoller: null,
  lastServerStageKey: "",
  referenceImages: [],
  selectedGalleryIds: new Set()
};

const el = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  const loadInfo = await loadState();
  await ensureStarterConfig();
  renderAll();
  if (loadInfo?.migrated) {
    toast("已将旧版浏览器配置迁移到本机配置文件。", "success");
  }
});

function bindElements() {
  [
    "statusLine", "activeConfigSelect", "testConfigBtn", "openSettingsBtn",
    "promptInput", "negativeInput", "referenceInput", "uploadRefsBtn", "referenceGrid",
    "referenceHint", "referenceStatus", "clearRefsBtn", "styleSelect",
    "ratioSelect", "sizeSelect", "customSizeFields", "customWidthInput",
    "customHeightInput", "sizeHint", "countInput", "qualitySelect", "seedInput",
    "guidanceInput", "stepsInput", "savePresetBtn", "generateBtn", "clearBtn",
    "cancelBtn", "taskSummary", "retryBtn", "exportBtn", "taskStageBadge",
    "taskTimeline", "taskList", "resultGrid",
    "gallerySearch", "galleryFilter", "clearHistoryBtn", "deleteSelectedBtn", "galleryGrid",
    "settingsDialog", "newConfigBtn", "configList", "configNameInput",
    "providerTypeInput", "apiKeyInput", "baseUrlInput",
    "modelInput", "priorityInput", "timeoutInput", "autoFallbackInput",
    "enabledInput", "deleteConfigBtn", "saveConfigBtn", "taskTemplate",
    "imageTemplate"
  ].forEach(id => {
    el[id] = document.getElementById(id);
  });
}

function bindEvents() {
  enforceReferenceActionLayout();
  el.openSettingsBtn.addEventListener("click", () => {
    state.editingConfigId = state.activeConfigId || state.configs[0]?.id || "";
    renderConfigEditor();
    el.settingsDialog.showModal();
  });
  el.newConfigBtn.addEventListener("click", createDraftConfig);
  el.saveConfigBtn.addEventListener("click", saveEditingConfig);
  el.deleteConfigBtn.addEventListener("click", deleteEditingConfig);
  el.providerTypeInput.addEventListener("change", applyProviderDefaultsToEditor);
  el.activeConfigSelect.addEventListener("change", async () => {
    state.activeConfigId = el.activeConfigSelect.value;
    await persistConfigs({ quiet: true });
    renderAll();
  });
  el.ratioSelect.addEventListener("change", () => renderSizeOptions());
  el.sizeSelect.addEventListener("change", syncCustomSizeFields);
  el.uploadRefsBtn?.addEventListener("click", () => el.referenceInput?.click());
  el.referenceInput.addEventListener("change", handleReferenceFilesSafe);
  el.clearRefsBtn.addEventListener("click", clearReferenceImages);
  el.savePresetBtn.addEventListener("click", savePromptPreset);
  el.generateBtn.addEventListener("click", () => generateWithFallback());
  el.cancelBtn.addEventListener("click", cancelCurrentTask);
  el.retryBtn.addEventListener("click", retryLastTask);
  el.clearBtn.addEventListener("click", clearInputs);
  el.testConfigBtn.addEventListener("click", testActiveConfig);
  el.exportBtn.addEventListener("click", exportHistory);
  el.clearHistoryBtn.addEventListener("click", clearHistory);
  el.deleteSelectedBtn.addEventListener("click", deleteSelectedImages);
  el.gallerySearch.addEventListener("input", renderGallery);
  el.galleryFilter.addEventListener("change", renderGallery);
}

function enforceReferenceActionLayout() {
  const title = document.querySelector(".reference-title");
  const actions = document.querySelector(".reference-actions");
  if (!title || !actions) return;

  Object.assign(title.style, {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "nowrap"
  });

  Object.assign(actions.style, {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    flexWrap: "nowrap",
    whiteSpace: "nowrap",
    width: "auto",
    marginLeft: "16px"
  });

  Array.from(actions.children).forEach(node => {
    Object.assign(node.style, {
      width: "auto",
      minWidth: "max-content",
      flex: "0 0 auto"
    });
  });
}

function readLegacyState() {
  return {
    configs: loadJson(storeKeys.configs, []),
    activeConfigId: loadJson(storeKeys.activeConfigId, ""),
    history: loadJson(storeKeys.history, []),
    presets: loadJson(storeKeys.presets, [])
  };
}

function configHasRecoverableKey(config) {
  return Boolean(String(config?.apiKey || config?.encryptedApiKey || "").trim());
}

function configHasServerKey(config) {
  return Boolean(configHasRecoverableKey(config) || config?.hasApiKey);
}

function isDefaultStarterConfig(config) {
  const providerType = config?.providerType === "agnes"
    ? "openai-compatible"
    : (config?.providerType || "openai-compatible");
  const name = String(config?.name || "").trim();
  const baseUrl = String(config?.baseUrl || "").trim();
  const model = String(config?.model || "").trim();
  return (
    providerType === "openai-compatible" &&
    !configHasRecoverableKey(config) &&
    (!name || name === "OpenAI兼容配置" || name === "OpenAI兼容") &&
    (!baseUrl || baseUrl === "https://api.openai.com/v1") &&
    (!model || model === "gpt-image-1")
  );
}

function hasUsefulConfigSnapshot(snapshot, options = {}) {
  const configs = Array.isArray(snapshot?.configs) ? snapshot.configs : [];
  const presets = Array.isArray(snapshot?.presets) ? snapshot.presets : [];
  const hasKey = options.serverBacked
    ? configs.some(configHasServerKey)
    : configs.some(configHasRecoverableKey);
  if (presets.length || hasKey || configs.length > 1) return true;
  return configs.length === 1 && !isDefaultStarterConfig(configs[0]);
}

function hasHistorySnapshot(snapshot) {
  return Array.isArray(snapshot?.history) && snapshot.history.length > 0;
}

function sanitizeConfigForBackup(config) {
  if (!config) return config;
  return {
    ...config,
    apiKey: "",
    encryptedApiKey: "",
    salt: "",
    iv: ""
  };
}

function writeLegacyBackupState() {
  saveJson(storeKeys.configs, state.configs.map(sanitizeConfigForBackup));
  saveJson(storeKeys.activeConfigId, state.activeConfigId);
  saveJson(storeKeys.history, state.history);
  saveJson(storeKeys.presets, state.presets);
}

function applyLoadedState(snapshot) {
  state.configs = Array.isArray(snapshot?.configs)
    ? snapshot.configs.map(normalizeLegacyConfig)
    : [];
  state.activeConfigId = typeof snapshot?.activeConfigId === "string"
    ? snapshot.activeConfigId
    : "";
  state.history = Array.isArray(snapshot?.history) ? snapshot.history : [];
  state.presets = Array.isArray(snapshot?.presets) ? snapshot.presets : [];
}

function applyLoadedConfigState(snapshot) {
  state.configs = Array.isArray(snapshot?.configs)
    ? snapshot.configs.map(normalizeLegacyConfig)
    : state.configs;
  state.activeConfigId = typeof snapshot?.activeConfigId === "string"
    ? snapshot.activeConfigId
    : state.activeConfigId;
  state.presets = Array.isArray(snapshot?.presets)
    ? snapshot.presets
    : state.presets;
}

function applyLoadedHistoryState(snapshot) {
  state.history = Array.isArray(snapshot?.history) ? snapshot.history : state.history;
}

async function recoverLegacyStateToServer(legacyState, serverState) {
  let recovered = false;
  let latestState = serverState;
  const legacyHasUsefulConfig = hasUsefulConfigSnapshot(legacyState);
  const serverHasUsefulConfig = hasUsefulConfigSnapshot(serverState, { serverBacked: true });

  if (legacyHasUsefulConfig && !serverHasUsefulConfig) {
    latestState = await postJson("/api/save-config-state", {
      configs: legacyState.configs,
      activeConfigId: legacyState.activeConfigId,
      presets: legacyState.presets
    });
    recovered = true;
  }

  if (hasHistorySnapshot(legacyState) && !hasHistorySnapshot(serverState)) {
    const historyState = await postJson("/api/save-history-state", {
      history: legacyState.history
    });
    latestState = {
      ...latestState,
      history: historyState.history
    };
    recovered = true;
  }

  return recovered ? latestState : null;
}

async function loadState() {
  const legacyState = readLegacyState();
  if (location.protocol === "file:") {
    applyLoadedState(legacyState);
    return { source: "browser" };
  }
  try {
    const json = await loadServerState(legacyState);
    const recoveredState = await recoverLegacyStateToServer(legacyState, json);
    applyLoadedState(recoveredState || json);
    writeLegacyBackupState();
    return {
      source: "server",
      migrated: Boolean(json.migrated || recoveredState),
      recovered: Boolean(recoveredState)
    };
  } catch {
    applyLoadedState(legacyState);
    return { source: "browser" };
  }
}

async function loadServerState(legacyState) {
  const retryDelays = [0, 120, 240, 480, 800, 1200];
  let lastError = null;
  for (const delayMs of retryDelays) {
    if (delayMs) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    try {
      return await postJson("/api/load-state", { legacyState });
    } catch (error) {
      lastError = error;
      if (!isTransientLoadStateError(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

function isTransientLoadStateError(error) {
  if (!error) return false;
  if (error.name === "TypeError") return true;
  const message = String(error.message || "");
  return /Failed to fetch|NetworkError|fetch/i.test(message);
}

function normalizeLegacyConfig(config) {
  if (!config) return config;
  const normalized = { ...config };
  if (normalized.providerType === "agnes") {
    normalized.providerType = "openai-compatible";
  }
  if (normalized.hasApiKey === undefined) {
    normalized.hasApiKey = Boolean(normalized.apiKey || normalized.encryptedApiKey);
  }
  return normalized;
}

async function ensureStarterConfig() {
  if (state.configs.length) {
    if (!state.configs.some(config => config.id === state.activeConfigId)) {
      state.activeConfigId = state.configs[0].id;
      await persistConfigs({ quiet: true });
    }
    return;
  }
  const starter = newConfig("OpenAI兼容配置", "openai-compatible");
  state.configs.push(starter);
  state.activeConfigId = starter.id;
  await persistConfigs({ quiet: true });
}

function newConfig(name, providerType) {
  const defaults = providerDefaults[providerType] || providerDefaults["openai-compatible"];
  return {
    id: crypto.randomUUID(),
    name,
    providerType,
    baseUrl: defaults.baseUrl,
    model: defaults.model,
    apiKey: "",
    hasApiKey: false,
    encryptedApiKey: "",
    salt: "",
    iv: "",
    priority: state.configs.length + 1,
    timeoutSeconds: 120,
    autoFallback: true,
    enabled: true
  };
}

function loadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function persistConfigs(options = {}) {
  if (location.protocol === "file:") {
    writeLegacyBackupState();
    return null;
  }
  try {
    const json = await postJson("/api/save-config-state", {
      configs: state.configs,
      activeConfigId: state.activeConfigId,
      presets: state.presets
    });
    applyLoadedConfigState(json);
    writeLegacyBackupState();
    return json;
  } catch (error) {
    if (options.quiet) return null;
    throw error;
  }
}

async function persistHistory(options = {}) {
  if (location.protocol === "file:") {
    writeLegacyBackupState();
    return null;
  }
  try {
    const json = await postJson("/api/save-history-state", {
      history: state.history
    });
    applyLoadedHistoryState(json);
    writeLegacyBackupState();
    return json;
  } catch (error) {
    if (options.quiet) return null;
    throw error;
  }
}

function renderAll() {
  renderSizeOptions();
  renderActiveConfigSelect();
  renderConfigList();
  renderConfigEditor();
  renderReferenceImages();
  renderTaskProgress();
  renderTaskList();
  renderResults(state.latestResults);
  renderGallery();
  updateCapabilityHints();
  updateStatus();
}

function renderActiveConfigSelect() {
  el.activeConfigSelect.innerHTML = "";
  state.configs
    .slice()
    .sort((a, b) => Number(a.priority) - Number(b.priority))
    .forEach(config => {
      const option = document.createElement("option");
      option.value = config.id;
      option.textContent = `${config.name} · ${providerLabel(config.providerType)}`;
      el.activeConfigSelect.append(option);
    });
  el.activeConfigSelect.value = state.activeConfigId;
}

function renderSizeOptions(keepValue) {
  const previous = keepValue || el.sizeSelect.value;
  const options = getSizeOptionsForCurrentConfig();
  el.sizeSelect.innerHTML = "";
  options.forEach(size => {
    const option = document.createElement("option");
    option.value = size;
    option.textContent = size.replace("x", " × ");
    el.sizeSelect.append(option);
  });
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "自定义尺寸";
  el.sizeSelect.append(custom);

  el.sizeSelect.value = options.includes(previous) ? previous : options[0];
  syncCustomSizeFields();
  updateCapabilityHints();
}

function getSizeOptionsForCurrentConfig() {
  const active = getActiveConfig();
  if (active?.providerType === "bailian" && /^wan2\.(6|7|8)/i.test(active.model || "")) {
    return bailianV2SizeOptions[el.ratioSelect.value] || bailianV2SizeOptions["1:1"];
  }
  return ratioSizeOptions[el.ratioSelect.value] || ratioSizeOptions["1:1"];
}

function syncCustomSizeFields() {
  const custom = el.sizeSelect.value === "custom";
  el.customSizeFields.classList.toggle("hidden", !custom);
  if (!custom) return;
  const [width, height] = (getSizeOptionsForCurrentConfig()[0] || "1024x1024").split("x");
  if (!el.customWidthInput.value) el.customWidthInput.value = width;
  if (!el.customHeightInput.value) el.customHeightInput.value = height;
}

function updateCapabilityHints() {
  const active = getActiveConfig();
  if (!active) return;
  const provider = active.providerType;
  const model = active.model || "";
  const bailianRefReady = provider === "bailian" && /^wan2\.(6|7|8)/i.test(model);

  if (provider === "bailian" && bailianRefReady) {
    el.sizeHint.textContent = "百炼新图像模型：总像素建议在 1280×1280 到 1440×1440 之间，宽高比需在 1:4 到 4:1 之间；当前列表优先展示官方推荐尺寸。";
  } else if (provider === "bailian") {
    el.sizeHint.textContent = "百炼旧通义万相模型：尺寸限制随模型变化，建议优先使用列表内尺寸；报参数错误时请换用平台推荐尺寸。";
  } else if (provider === "openai-compatible") {
    el.sizeHint.textContent = "OpenAI 官方图像接口通常使用固定尺寸；严格 16:9 等尺寸更多依赖中转站扩展能力，失败时请切回 1024×1024 或平台支持尺寸。";
  } else {
    el.sizeHint.textContent = "当前平台尺寸范围无法自动确认，请以平台文档为准；列表为常用比例推荐，也可使用自定义尺寸。";
  }

  const hasRefs = state.referenceImages.length > 0;
  const refSupported = provider === "openai-compatible" || provider === "custom" || bailianRefReady;
  if (hasRefs && !refSupported) {
    el.referenceHint.textContent = "当前平台暂未接入参考图请求。请切换到 OpenAI 兼容、自定义，或百炼 wan2.6+ 模型。";
  } else if (bailianRefReady) {
    el.referenceHint.textContent = "百炼 wan2.6+ 已开放参考图实验支持；如果平台返回字段错误，请先切回纯文生图或 OpenAI 兼容接口。";
  } else {
    el.referenceHint.textContent = `上传参考图后，OpenAI 兼容/自定义接口会走图像编辑请求；百炼需使用 wan2.6+。当前最多 ${MAX_REFERENCE_IMAGES} 张，单张建议不超过 ${Math.round(MAX_REFERENCE_FILE_BYTES / 1024 / 1024)}MB。`;
  }
}

function setReferenceStatus(text = "", kind = "") {
  if (!text) {
    el.referenceStatus.textContent = "";
    el.referenceStatus.className = "upload-status hidden";
    return;
  }
  el.referenceStatus.textContent = text;
  el.referenceStatus.className = `upload-status ${kind}`.trim();
}

function renderConfigList() {
  el.configList.innerHTML = "";
  state.configs
    .slice()
    .sort((a, b) => Number(a.priority) - Number(b.priority))
    .forEach(config => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `config-item${config.id === state.editingConfigId ? " active" : ""}`;
      button.innerHTML = `<strong>${escapeHtml(config.name)}</strong><small>${providerLabel(config.providerType)} · ${config.enabled ? "已启用" : "已停用"}</small>`;
      button.addEventListener("click", () => {
        state.editingConfigId = config.id;
        renderConfigList();
        renderConfigEditor();
      });
      el.configList.append(button);
    });
}

function renderConfigEditor() {
  const config = getEditingConfig();
  if (!config) return;
  el.configNameInput.value = config.name || "";
  el.providerTypeInput.value = config.providerType || "openai-compatible";
  el.apiKeyInput.value = "";
  el.apiKeyInput.placeholder = config.apiKey || config.encryptedApiKey || config.hasApiKey
    ? "已保存 API Key，留空则不修改"
    : "未保存 API Key";
  el.baseUrlInput.value = config.baseUrl || "";
  el.modelInput.value = config.model || "";
  el.priorityInput.value = config.priority || 1;
  el.timeoutInput.value = config.timeoutSeconds || 120;
  el.autoFallbackInput.checked = Boolean(config.autoFallback);
  el.enabledInput.checked = config.enabled !== false;
}

function renderTaskList() {
  el.taskList.innerHTML = "";
  if (!state.lastTask) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "生成任务会显示在这里。";
    el.taskList.append(empty);
    return;
  }
  el.taskList.append(createTaskNode(state.lastTask));
}

function renderTaskProgress() {
  renderTaskStageBadge();
  el.taskTimeline.innerHTML = "";
  if (!state.taskTimeline.length) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.textContent = "这里会展示本次生成的阶段细节，例如请求提交、平台排队、切换备用配置和结果返回。";
    el.taskTimeline.append(empty);
    return;
  }
  state.taskTimeline.forEach(entry => {
    const node = document.createElement("article");
    node.className = "timeline-item";

    const time = document.createElement("div");
    time.className = "timeline-time";
    time.textContent = formatClockTime(entry.at);

    const body = document.createElement("div");
    body.className = "timeline-body";

    const title = document.createElement("div");
    title.className = "timeline-title";
    title.textContent = entry.title;

    const meta = document.createElement("div");
    meta.className = "timeline-meta";
    meta.textContent = entry.meta || "";

    body.append(title, meta);
    node.append(time, body);
    el.taskTimeline.append(node);
  });
}

function renderTaskStageBadge() {
  const stage = state.taskStage;
  if (!stage?.text) {
    el.taskStageBadge.textContent = "";
    el.taskStageBadge.className = "task-stage-badge hidden";
    return;
  }
  el.taskStageBadge.textContent = stage.text;
  el.taskStageBadge.className = `task-stage-badge ${stage.kind || ""}`.trim();
}

function setTaskStage(text = "", kind = "") {
  state.taskStage = text ? { text, kind } : null;
  renderTaskStageBadge();
}

function resetTaskProgress() {
  state.taskTimeline = [];
  state.taskStage = null;
  el.taskSummary.textContent = "等待生成任务。";
}

function pushTaskEvent(title, meta = "") {
  state.taskTimeline = [
    ...state.taskTimeline,
    {
      id: crypto.randomUUID(),
      title,
      meta,
      at: new Date().toISOString()
    }
  ].slice(-18);
  renderTaskProgress();
}

function createTaskNode(task) {
  const node = el.taskTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".task-title").textContent = task.title;
  node.querySelector(".task-meta").textContent = task.meta;
  const stateNode = node.querySelector(".task-state");
  stateNode.textContent = task.stateText;
  if (task.kind) stateNode.classList.add(task.kind);
  return node;
}

function renderResults(images) {
  el.resultGrid.innerHTML = "";
  if (!images.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "生成完成后，图片会出现在这里。";
    el.resultGrid.append(empty);
    return;
  }
  images.forEach(item => el.resultGrid.append(createImageTile(item, true)));
}

function renderGallery() {
  const query = el.gallerySearch.value.trim().toLowerCase();
  const provider = el.galleryFilter.value;
  el.galleryGrid.innerHTML = "";
  const items = state.history.filter(item => {
    const matchQuery = !query || `${item.prompt} ${item.model}`.toLowerCase().includes(query);
    const matchProvider = provider === "all" || item.provider === provider;
    return matchQuery && matchProvider;
  });
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "图库暂时为空。";
    el.galleryGrid.append(empty);
    state.selectedGalleryIds.clear();
    updateSelectedDeleteButton();
    return;
  }
  items.forEach(item => el.galleryGrid.append(createImageTile(item, false)));
  updateSelectedDeleteButton();
}

function renderReferenceImages() {
  el.referenceGrid.innerHTML = "";
  el.referenceGrid.classList.toggle("is-empty", !state.referenceImages.length);
  if (!state.referenceImages.length) {
    const empty = document.createElement("div");
    empty.className = "reference-empty";
    empty.textContent = "未上传参考图。";
    el.referenceGrid.append(empty);
    updateCapabilityHints();
    return;
  }
  state.referenceImages.forEach(item => {
    const node = document.createElement("div");
    node.className = "reference-item";
    const image = document.createElement("img");
    image.src = item.previewUrl;
    image.alt = item.name;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "×";
    button.title = "移除参考图";
    button.addEventListener("click", () => removeReferenceImage(item.id));
    node.append(image, button);
    el.referenceGrid.append(node);
  });
  updateCapabilityHints();
}

function createImageTile(item, isFresh) {
  const node = el.imageTemplate.content.firstElementChild.cloneNode(true);
  const wrap = node.querySelector(".image-wrap");
  const image = document.createElement("img");
  image.alt = item.prompt || "生成图片";
  image.loading = "lazy";
  image.src = item.url || `data:image/png;base64,${item.b64}`;
  wrap.append(image);
  node.querySelector("strong").textContent = item.prompt || "未命名图片";
  const refInfo = item.referenceCount ? ` · 参考图 ${item.referenceCount} 张` : "";
  node.querySelector("p").textContent = `${providerLabel(item.provider)} · ${item.model || "默认模型"}${refInfo} · ${formatTime(item.createdAt)}`;
  const checkbox = node.querySelector(".select-image-checkbox");
  const selectLabel = node.querySelector(".tile-select");
  if (isFresh) {
    selectLabel.classList.add("hidden");
  } else {
    checkbox.checked = state.selectedGalleryIds.has(item.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedGalleryIds.add(item.id);
      else state.selectedGalleryIds.delete(item.id);
      updateSelectedDeleteButton();
    });
  }
  node.querySelector(".download-btn").addEventListener("click", () => downloadImage(item));
  node.querySelector(".reuse-btn").addEventListener("click", () => reuseImage(item));
  node.querySelector(".delete-image-btn").addEventListener("click", () => deleteImage(item.id));
  if (isFresh) node.classList.add("fresh");
  return node;
}

function updateStatus(message) {
  const active = getActiveConfig();
  el.statusLine.textContent = message || (active
    ? `当前配置：${active.name} · ${providerLabel(active.providerType)}`
    : "请先新增 API 配置。");
}

function providerLabel(providerType) {
  return providerDefaults[providerType]?.name || "自定义";
}

function getActiveConfig() {
  return state.configs.find(config => config.id === state.activeConfigId) || null;
}

function getEditingConfig() {
  if (!state.editingConfigId) state.editingConfigId = state.activeConfigId || state.configs[0]?.id || "";
  return state.configs.find(config => config.id === state.editingConfigId) || state.configs[0] || null;
}

async function createDraftConfig() {
  const draft = newConfig("新配置", "openai-compatible");
  state.configs.push(draft);
  state.editingConfigId = draft.id;
  state.activeConfigId = draft.id;
  try {
    await persistConfigs();
  } catch (error) {
    toast(error.message || "保存新配置失败。", "error");
  }
  renderAll();
}

function applyProviderDefaultsToEditor() {
  const defaults = providerDefaults[el.providerTypeInput.value] || providerDefaults["openai-compatible"];
  if (!el.configNameInput.value || el.configNameInput.value === "新配置") {
    el.configNameInput.value = `${defaults.name}配置`;
  }
  el.baseUrlInput.value = defaults.baseUrl;
  el.modelInput.value = defaults.model;
}

async function saveEditingConfig() {
  const config = getEditingConfig();
  if (!config) return;
  const name = el.configNameInput.value.trim();
  if (!name) return toast("请填写配置名称。", "warn");
  const apiKey = el.apiKeyInput.value.trim();
  Object.assign(config, {
    name,
    providerType: el.providerTypeInput.value,
    baseUrl: el.baseUrlInput.value.trim(),
    model: el.modelInput.value.trim(),
    priority: Number(el.priorityInput.value) || 1,
    timeoutSeconds: Number(el.timeoutInput.value) || 120,
    autoFallback: el.autoFallbackInput.checked,
    enabled: el.enabledInput.checked
  });
  if (apiKey) {
    config.apiKey = apiKey;
    config.hasApiKey = true;
    config.encryptedApiKey = "";
    config.salt = "";
    config.iv = "";
  }
  state.activeConfigId = config.id;
  try {
    await persistConfigs();
    renderAll();
    toast("配置已保存到本机。", "success");
  } catch (error) {
    toast(error.message || "保存配置失败。", "error");
  }
}

async function deleteEditingConfig() {
  const config = getEditingConfig();
  if (!config) return;
  if (!confirm(`删除配置“${config.name}”？`)) return;
  state.configs = state.configs.filter(item => item.id !== config.id);
  if (!state.configs.length) {
    state.configs.push(newConfig("OpenAI兼容配置", "openai-compatible"));
  }
  state.activeConfigId = state.configs[0].id;
  state.editingConfigId = state.activeConfigId;
  try {
    await persistConfigs();
    renderAll();
    toast("配置已删除。", "success");
  } catch (error) {
    toast(error.message || "删除配置失败。", "error");
  }
}

async function getConfigForRequest(config) {
  if (!config) throw new Error("请先选择配置。");
  if (!config.enabled) throw new Error("当前配置未启用。");
  const apiKey = await resolveConfigApiKey(config);
  return apiKey ? { ...config, apiKey } : { ...config };
}

async function resolveConfigApiKey(config) {
  if (config.apiKey) return config.apiKey;
  if (config.hasApiKey && !config.encryptedApiKey) return "";
  if (!config.encryptedApiKey) throw new Error("当前配置还没有保存 API Key。");

  const entered = prompt("这是旧版加密配置，请输入当时设置的本机密码。解锁成功后会自动迁移，以后不再需要输入。");
  if (!entered) throw new Error("未输入旧版本机密码。");
  const apiKey = await decryptText(config, entered);
  config.apiKey = apiKey;
  config.hasApiKey = true;
  config.encryptedApiKey = "";
  config.salt = "";
  config.iv = "";
  await persistConfigs();
  toast("旧版 API Key 已迁移，以后不再需要本机密码。", "success");
  return apiKey;
}

async function testActiveConfig() {
  const active = getActiveConfig();
  try {
    updateStatus("正在测试连接...");
    const config = await getConfigForRequest(active);
    const result = await postJson("/api/test-config", { config });
    const extra = result.models?.length ? `可用模型示例：${result.models.slice(0, 4).join("、")}` : result.message;
    toast(extra || "连接成功。", "success");
    updateStatus("连接测试通过。");
  } catch (error) {
    toast(error.message, "error");
    updateStatus("连接测试失败。");
  }
}

function collectTask() {
  const prompt = el.promptInput.value.trim();
  if (!prompt) throw new Error("请先输入提示词。");
  const size = getSelectedSize();
  return {
    id: crypto.randomUUID(),
    prompt,
    negativePrompt: el.negativeInput.value.trim(),
    referenceImages: state.referenceImages.map(item => ({
      fileId: item.fileId,
      name: item.name,
      type: item.type,
      size: item.size
    })),
    stylePreset: el.styleSelect.value,
    size,
    count: Number(el.countInput.value) || 1,
    quality: el.qualitySelect.value,
    seed: el.seedInput.value ? Number(el.seedInput.value) : null,
    guidance: el.guidanceInput.value ? Number(el.guidanceInput.value) : null,
    steps: el.stepsInput.value ? Number(el.stepsInput.value) : null,
    createdAt: new Date().toISOString()
  };
}

function getSelectedSize() {
  if (el.sizeSelect.value !== "custom") return el.sizeSelect.value;
  const width = Number(el.customWidthInput.value);
  const height = Number(el.customHeightInput.value);
  if (!width || !height) throw new Error("请填写自定义宽度和高度。");
  if (width < 64 || height < 64) throw new Error("自定义尺寸不能小于 64。");
  return `${Math.round(width)}x${Math.round(height)}`;
}

async function generateWithFallback(retryTask, retryConfig) {
  let task;
  try {
    task = retryTask || collectTask();
  } catch (error) {
    toast(error.message, "warn");
    return;
  }

  let configs = buildConfigQueue(retryConfig || getActiveConfig());
  if (task.referenceImages?.length) {
    configs = configs.filter(supportsReferenceImages);
  }
  if (!configs.length) {
    toast(task.referenceImages?.length
      ? "当前没有支持参考图的启用配置，请切换 OpenAI 兼容、自定义，或百炼 wan2.6+ 模型。"
      : "没有可用配置，请先在配置中心启用 API。", "warn");
    return;
  }

  resetTaskProgress();
  state.lastTask = {
    title: trimText(task.prompt, 46),
    meta: "准备提交任务",
    stateText: "等待中",
    kind: ""
  };
  setTaskStage("准备中", "");
  el.taskSummary.textContent = "正在整理本次生成参数。";
  pushTaskEvent(
    "已创建生成任务",
    `${providerLabel(configs[0].providerType)} · ${task.size} · ${task.count} 张${task.referenceImages?.length ? ` · 参考图 ${task.referenceImages.length} 张` : ""}`
  );
  state.lastTaskConfig = configs[0];
  state.lastTaskPayload = task;
  state.currentTaskId = task.id;
  state.currentController = new AbortController();
  state.lastServerStageKey = "";
  renderTaskProgress();
  renderTaskList();
  setLatestResults([]);
  setGenerating(true);
  startTaskStatusPolling(task.id);

  let lastError = null;
  for (const configShell of configs) {
    try {
      pushTaskEvent(
        "开始尝试当前配置",
        `${configShell.name} · ${providerLabel(configShell.providerType)} · 模型 ${configShell.model || "默认"}`
      );
      state.lastTask = {
        title: trimText(task.prompt, 46),
        meta: `${configShell.name} · ${providerLabel(configShell.providerType)}`,
        stateText: "生成中",
        kind: "warn"
      };
      setTaskStage("生成中", "warn");
      el.taskSummary.textContent = `${configShell.name} 正在处理请求。`;
      renderTaskList();
      updateStatus(`正在使用 ${configShell.name} 生成...`);
      if (task.referenceImages?.length) {
        pushTaskEvent(
          "已附带参考图",
          `本次请求包含 ${task.referenceImages.length} 张参考图，将由本地服务整理后转发。`
        );
      }
      const config = await getConfigForRequest(configShell);
      pushTaskEvent(
        "已提交到平台",
        config.providerType === "bailian"
          ? "平台已接收任务，接下来会进入异步排队与轮询阶段。"
          : "平台正在生成图片，等待返回结果。"
      );
      const result = await postJson("/api/generate", { config, task }, state.currentController.signal);
      const images = normalizeImages(result.images || [], task, configShell);
      if (!images.length) throw new Error("没有返回图片。");
      pushTaskEvent(
        "平台已返回结果",
        `${configShell.name} 已返回 ${images.length} 张图片。`
      );
      state.lastTask = {
        title: trimText(task.prompt, 46),
        meta: `${configShell.name} · 共 ${images.length} 张`,
        stateText: "成功",
        kind: "success"
      };
      setTaskStage("已完成", "success");
      state.lastTaskConfig = configShell;
      state.lastTaskPayload = task;
      await prependHistory(images);
      renderTaskList();
      setLatestResults(images);
      renderGallery();
      el.taskSummary.textContent = `本次生成已完成，共返回 ${images.length} 张图片。`;
      updateStatus("生成完成。");
      toast("生成完成。", "success");
      setGenerating(false);
      stopTaskStatusPolling();
      state.currentController = null;
      state.currentTaskId = "";
      return;
    } catch (error) {
      lastError = error;
      if (error.name === "AbortError") {
        pushTaskEvent("任务已中止", "已向本地服务发送取消信号。");
        state.lastTask = {
          title: trimText(task.prompt, 46),
          meta: "用户已中止本次生成",
          stateText: "已中止",
          kind: "warn"
        };
        setTaskStage("已中止", "warn");
        el.taskSummary.textContent = "本次生成已被中止。";
        renderTaskList();
        updateStatus("生成已中止。");
        toast("已中止本次生成。", "warn");
        setGenerating(false);
        stopTaskStatusPolling();
        state.currentController = null;
        state.currentTaskId = "";
        return;
      }
      const shouldContinue = configShell.autoFallback && isFallbackable(error);
      pushTaskEvent(
        shouldContinue ? "当前配置失败，准备切换" : "当前配置失败",
        `${configShell.name}：${error.message || "未知错误"}`
      );
      if (!shouldContinue) break;
      state.lastTask = {
        title: trimText(task.prompt, 46),
        meta: `${configShell.name} 失败，正在切换备用配置`,
        stateText: "切换中",
        kind: "warn"
      };
      setTaskStage("切换配置", "warn");
      el.taskSummary.textContent = `${configShell.name} 失败，正在尝试备用配置。`;
      renderTaskList();
    }
  }

  state.lastTask = {
    title: trimText(task.prompt, 46),
    meta: lastError?.message || "生成失败",
    stateText: "失败",
    kind: "error"
  };
  setTaskStage("失败", "error");
  el.taskSummary.textContent = lastError?.message || "生成失败。";
  state.lastTaskPayload = task;
  renderTaskList();
  updateStatus("生成失败。");
  toast(lastError?.message || "生成失败。", "error");
  setGenerating(false);
  stopTaskStatusPolling();
  el.retryBtn.disabled = false;
  state.currentController = null;
  state.currentTaskId = "";
}

function setGenerating(isGenerating) {
  el.generateBtn.disabled = isGenerating;
  el.cancelBtn.disabled = !isGenerating;
  el.retryBtn.disabled = isGenerating || !state.lastTaskPayload;
}

async function cancelCurrentTask() {
  if (!state.currentTaskId) return;
  const taskId = state.currentTaskId;
  state.currentController?.abort();
  try {
    await postJson("/api/cancel", { taskId });
  } catch {
    // Best effort.
  }
  pushTaskEvent("手动中止任务", "当前页面已停止等待平台返回结果。");
  state.lastTask = {
    title: state.lastTask?.title || "当前任务",
    meta: "用户已中止本次生成",
    stateText: "已中止",
    kind: "warn"
  };
  setTaskStage("已中止", "warn");
  el.taskSummary.textContent = "本次生成已被中止。";
  renderTaskList();
  updateStatus("生成已中止。");
  setGenerating(false);
  stopTaskStatusPolling();
  state.currentTaskId = "";
  state.currentController = null;
}

function startTaskStatusPolling(taskId) {
  stopTaskStatusPolling();
  if (!taskId) return;
  const tick = async () => {
    if (!state.currentTaskId || state.currentTaskId !== taskId) return;
    try {
      const json = await postJson("/api/task-status", { taskId });
      applyServerTaskStatus(json.status);
    } catch {
      // Silent best effort.
    }
  };
  tick();
  state.currentStatusPoller = setInterval(tick, 1600);
}

function stopTaskStatusPolling() {
  if (state.currentStatusPoller) {
    clearInterval(state.currentStatusPoller);
    state.currentStatusPoller = null;
  }
}

function applyServerTaskStatus(status) {
  if (!status?.text) return;
  const key = `${status.stage || ""}|${status.text}`;
  if (key === state.lastServerStageKey) return;
  state.lastServerStageKey = key;

  const badgeKind = mapServerStageKind(status.stage);
  if (status.stage === "completed") {
    setTaskStage("已完成", "success");
  } else if (status.stage === "cancelled") {
    setTaskStage("已中止", "warn");
  } else if (status.stage && !/accepted/.test(status.stage)) {
    setTaskStage("进行中", badgeKind);
  }

  pushTaskEvent(status.text, status.detail || "");
}

function mapServerStageKind(stage) {
  if (!stage) return "";
  if (/completed/.test(stage)) return "success";
  if (/cancelled|failed|error/.test(stage)) return "error";
  if (/queued|polling|provider_status|submitting|finalizing/.test(stage)) return "warn";
  return "";
}

function buildConfigQueue(active) {
  if (!active) return [];
  const enabled = state.configs
    .filter(config => config.enabled)
    .sort((a, b) => Number(a.priority) - Number(b.priority));
  return [active, ...enabled.filter(config => config.id !== active.id)];
}

function isFallbackable(error) {
  const message = String(error?.message || "");
  return !/认证失败|API Key|内容|提示词|模型不存在|参数/.test(message);
}

function supportsReferenceImages(config) {
  if (config?.providerType === "openai-compatible" || config?.providerType === "custom") return true;
  return config?.providerType === "bailian" && /^wan2\.(6|7|8)/i.test(config.model || "");
}

function normalizeImages(images, task, config) {
  return images.map((image, index) => ({
    id: image.id || crypto.randomUUID(),
    url: image.url || "",
    b64: image.b64 || "",
    prompt: image.revisedPrompt || task.prompt,
    originalPrompt: task.prompt,
    negativePrompt: task.negativePrompt,
    referenceCount: task.referenceImages?.length || 0,
    provider: config.providerType,
    configName: config.name,
    model: image.model || config.model,
    width: image.width,
    height: image.height,
    size: task.size,
    stylePreset: task.stylePreset,
    quality: task.quality,
    index,
    createdAt: new Date().toISOString()
  }));
}

async function prependHistory(images) {
  state.history = [...images, ...state.history].slice(0, 200);
  await persistHistory({ quiet: true });
}

function setLatestResults(images) {
  state.latestResults = Array.isArray(images) ? [...images] : [];
  renderResults(state.latestResults);
}

function retryLastTask() {
  if (!state.lastTaskPayload) {
    toast("没有可重试的任务。", "warn");
    return;
  }
  generateWithFallback(state.lastTaskPayload, state.lastTaskConfig || getActiveConfig());
}

function reuseImage(item) {
  el.promptInput.value = item.originalPrompt || item.prompt || "";
  el.negativeInput.value = item.negativePrompt || "";
  const size = item.size || "1024x1024";
  el.ratioSelect.value = inferRatio(size);
  renderSizeOptions(size);
  if (el.sizeSelect.value !== size) {
    const [width, height] = size.split("x");
    el.sizeSelect.value = "custom";
    el.customWidthInput.value = width || "";
    el.customHeightInput.value = height || "";
    syncCustomSizeFields();
  }
  el.styleSelect.value = item.stylePreset || "none";
  el.qualitySelect.value = item.quality || "standard";
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("参数已复用。", "success");
}

function inferRatio(size) {
  const [width, height] = String(size).split("x").map(Number);
  if (!width || !height) return "1:1";
  const ratio = width / height;
  const candidates = Object.keys(ratioSizeOptions).map(label => {
    const [w, h] = label.split(":").map(Number);
    return { label, diff: Math.abs(ratio - w / h) };
  });
  candidates.sort((a, b) => a.diff - b.diff);
  return candidates[0]?.label || "1:1";
}

async function downloadImage(item) {
  try {
    const link = document.createElement("a");
    const name = `ai-image-${formatFileTime(item.createdAt)}-${item.index || 0}.png`;
    link.download = name;
    if (item.b64) {
      link.href = `data:image/png;base64,${item.b64}`;
    } else {
      const response = await fetch(item.url);
      const blob = await response.blob();
      link.href = URL.createObjectURL(blob);
      setTimeout(() => URL.revokeObjectURL(link.href), 3000);
    }
    document.body.append(link);
    link.click();
    link.remove();
  } catch {
    window.open(item.url, "_blank", "noopener,noreferrer");
  }
}

function clearInputs() {
  el.promptInput.value = "";
  el.negativeInput.value = "";
  el.seedInput.value = "";
  el.guidanceInput.value = "";
  el.stepsInput.value = "";
}

async function handleReferenceFilesSafe(event) {
  try {
    setReferenceStatus("正在上传参考图...", "pending");
    updateStatus("正在上传参考图...");
    await handleReferenceFiles(event);
    setReferenceStatus("参考图上传成功。", "success");
    updateStatus("参考图已上传。");
  } catch (error) {
    setReferenceStatus("参考图上传失败。", "error");
    updateStatus("参考图上传失败。");
    if (location.protocol === "file:") {
      toast("参考图上传需要通过 start-tool.cmd 启动本地服务，直接打开 index.html 无法上传。", "error");
      return;
    }
    if (error instanceof TypeError) {
      toast("无法连接本地上传服务。请确认已经重新启动 start-tool.cmd。", "error");
      return;
    }
    toast(error.message || "参考图上传失败。", "error");
  }
}

async function handleReferenceFiles(event) {
  const files = [...event.target.files || []];
  event.target.value = "";
  if (!files.length) return;
  const available = Math.max(0, MAX_REFERENCE_IMAGES - state.referenceImages.length);
  if (!available) {
    throw new Error(`最多上传 ${MAX_REFERENCE_IMAGES} 张参考图。`);
  }
  const accepted = files.slice(0, available);
  const oversized = accepted.find(file => file.size > MAX_REFERENCE_FILE_BYTES);
  if (oversized) {
    throw new Error(`单张参考图不能超过 ${Math.round(MAX_REFERENCE_FILE_BYTES / 1024 / 1024)}MB。`);
  }
  const currentTotalBytes = state.referenceImages.reduce((sum, item) => sum + (item.size || 0), 0);
  const nextTotalBytes = currentTotalBytes + accepted.reduce((sum, file) => sum + file.size, 0);
  if (nextTotalBytes > MAX_REFERENCE_TOTAL_BYTES) {
    throw new Error(`参考图总大小不能超过 ${Math.round(MAX_REFERENCE_TOTAL_BYTES / 1024 / 1024)}MB，请压缩后再试。`);
  }
  const images = await Promise.all(accepted.map(uploadReferenceFile));
  state.referenceImages = [...state.referenceImages, ...images];
  renderReferenceImages();
  toast(`已添加 ${images.length} 张参考图。`, "success");
}

async function uploadReferenceFile(file) {
  const response = await fetch("/api/upload-reference", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "image/png",
      "X-File-Name": encodeURIComponent(file.name),
      "X-File-Size": String(file.size)
    },
    body: file
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.message || "上传参考图失败。");
  }
  return {
    id: crypto.randomUUID(),
    fileId: json.fileId,
    name: file.name,
    type: file.type || "image/png",
    size: file.size,
    previewUrl: URL.createObjectURL(file)
  };
}

function clearReferenceImages() {
  state.referenceImages.forEach(item => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    deleteReferenceFile(item.fileId);
  });
  state.referenceImages = [];
  renderReferenceImages();
  setReferenceStatus();
}

function removeReferenceImage(id) {
  const item = state.referenceImages.find(ref => ref.id === id);
  if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  if (item?.fileId) deleteReferenceFile(item.fileId);
  state.referenceImages = state.referenceImages.filter(ref => ref.id !== id);
  renderReferenceImages();
  if (!state.referenceImages.length) setReferenceStatus();
}

function deleteReferenceFile(fileId) {
  if (!fileId) return;
  postJson("/api/delete-reference", { fileId }).catch(() => {});
}

async function savePromptPreset() {
  const prompt = el.promptInput.value.trim();
  if (!prompt) {
    toast("请先输入提示词。", "warn");
    return;
  }
  state.presets.unshift({
    id: crypto.randomUUID(),
    prompt,
    negativePrompt: el.negativeInput.value.trim(),
    stylePreset: el.styleSelect.value,
    createdAt: new Date().toISOString()
  });
  state.presets = state.presets.slice(0, 30);
  try {
    await persistConfigs({ quiet: true });
    toast("预设已保存到本机。", "success");
  } catch (error) {
    toast(error.message || "保存预设失败。", "error");
  }
}

function exportHistory() {
  const blob = new Blob([JSON.stringify(state.history, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ai-image-history-${formatFileTime(new Date().toISOString())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 3000);
}

async function clearHistory() {
  if (!state.history.length) return;
  if (!confirm("清理全部图库历史？")) return;
  state.history = [];
  state.latestResults = [];
  state.selectedGalleryIds.clear();
  await persistHistory({ quiet: true });
  renderResults(state.latestResults);
  renderGallery();
  toast("图库历史已清理。", "success");
}

async function deleteImage(imageId) {
  state.history = state.history.filter(item => item.id !== imageId);
  state.latestResults = state.latestResults.filter(item => item.id !== imageId);
  state.selectedGalleryIds.delete(imageId);
  await persistHistory({ quiet: true });
  renderResults(state.latestResults);
  renderGallery();
  toast("图片已删除。", "success");
}

async function deleteSelectedImages() {
  const ids = [...state.selectedGalleryIds];
  if (!ids.length) return;
  if (!confirm(`删除选中的 ${ids.length} 张图片？`)) return;
  const idSet = new Set(ids);
  state.history = state.history.filter(item => !idSet.has(item.id));
  state.latestResults = state.latestResults.filter(item => !idSet.has(item.id));
  state.selectedGalleryIds.clear();
  await persistHistory({ quiet: true });
  renderResults(state.latestResults);
  renderGallery();
  toast("选中图片已删除。", "success");
}

function updateSelectedDeleteButton() {
  const count = state.selectedGalleryIds.size;
  el.deleteSelectedBtn.disabled = count === 0;
  el.deleteSelectedBtn.textContent = count ? `删除选中(${count})` : "删除选中";
}

async function postJson(url, payload, signal) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    const message = json.message || "请求失败。";
    const detail = typeof json.detail === "string" ? json.detail.trim() : "";
    const error = new Error(detail && detail !== message ? `${message}（详情：${detail}）` : message);
    error.code = json.code || "";
    error.detail = detail;
    throw error;
  }
  return json;
}

async function deriveKey(password, saltBytes) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 120000,
      hash: "SHA-256"
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function decryptText(config, password) {
  try {
    const key = await deriveKey(password, base64ToBytes(config.salt));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(config.iv) },
      key,
      base64ToBytes(config.encryptedApiKey)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error("本机密码不正确，无法解锁 API Key。");
  }
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function trimText(value, length) {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatClockTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatFileTime(value) {
  return new Date(value).toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message, kind = "") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 3600);
}
