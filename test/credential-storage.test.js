const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function findAvailablePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

function startApp(port, appData) {
  return spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      APPDATA: appData,
      PORT: String(port)
    },
    stdio: ["ignore", "ignore", "ignore"]
  });
}

function createLegacyProtectedText(text) {
  try {
    return execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
        Add-Type -AssemblyName System.Security
        $bytes = [System.Text.Encoding]::Unicode.GetBytes([string]$payload.value)
        $protected = [System.Security.Cryptography.ProtectedData]::Protect(
          $bytes,
          $null,
          [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        [BitConverter]::ToString($protected).Replace("-", "")
      `
    ], {
      encoding: "utf8",
      input: JSON.stringify({ value: String(text) }),
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch {
    return "";
  }
}

async function waitForApp(url, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`AI Image Tool exited before becoming ready (${child.exitCode}).`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for AI Image Tool to start.");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return { response, body: await response.json() };
}

test("persists API keys with DPAPI and restores them after a server restart", { timeout: 30_000 }, async t => {
  if (process.platform !== "win32") {
    t.skip("Windows DPAPI is only available on Windows.");
    return;
  }

  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "ai-image-tool-key-test-"));
  const initialPort = await findAvailablePort();
  let app = startApp(initialPort, appData);
  t.after(async () => {
    await stopChild(app);
    fs.rmSync(appData, { force: true, recursive: true });
  });

  let appUrl = `http://127.0.0.1:${initialPort}`;
  await waitForApp(appUrl, app);

  const configId = "bailian-dpapi-test";
  const apiKey = "dpapi-test-key";
  const save = await postJson(`${appUrl}/api/save-config-state`, {
    activeConfigId: configId,
    configs: [
      {
        apiKey,
        baseUrl: "https://dashscope.aliyuncs.com/api/v1",
        enabled: true,
        id: configId,
        model: "qwen-image-3.0",
        name: "DPAPI test",
        providerType: "bailian"
      }
    ],
    presets: []
  });

  assert.equal(save.response.status, 200);
  const settingsPath = path.join(appData, "AIImageTool", "settings.json");
  const stored = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.match(stored.configs[0].protectedApiKey, /^dpapi:/);
  assert.equal(fs.readFileSync(settingsPath, "utf8").includes(apiKey), false);

  await stopChild(app);
  const restartPort = await findAvailablePort();
  app = startApp(restartPort, appData);
  appUrl = `http://127.0.0.1:${restartPort}`;
  await waitForApp(appUrl, app);

  const loaded = await postJson(`${appUrl}/api/load-state`, {});
  assert.equal(loaded.response.status, 200);
  assert.equal(loaded.body.configs[0].hasApiKey, true);

  const configTest = await postJson(`${appUrl}/api/test-config`, {
    config: { id: configId, providerType: "bailian" }
  });
  assert.equal(configTest.response.status, 200);
  assert.equal(configTest.body.ok, true);
});

test("restores legacy SecureString API keys when the legacy decoder is available", { timeout: 30_000 }, async t => {
  if (process.platform !== "win32") {
    t.skip("Windows DPAPI is only available on Windows.");
    return;
  }

  const apiKey = "legacy-compatible-test-key";
  const protectedApiKey = createLegacyProtectedText(apiKey);
  if (!protectedApiKey) {
    t.skip("Windows DPAPI is unavailable on this installation.");
    return;
  }

  const configId = "legacy-secure-string-test";
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "ai-image-tool-legacy-key-test-"));
  t.after(() => fs.rmSync(appData, { force: true, recursive: true }));

  const settingsDir = path.join(appData, "AIImageTool");
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(path.join(settingsDir, "settings.json"), JSON.stringify({
    activeConfigId: configId,
    configs: [
      {
        baseUrl: "https://dashscope.aliyuncs.com/api/v1",
        enabled: true,
        id: configId,
        model: "qwen-image-3.0",
        name: "Legacy SecureString test",
        protectedApiKey,
        providerType: "bailian"
      }
    ],
    presets: [],
    version: 2
  }, null, 2), "utf8");

  const appPort = await findAvailablePort();
  const app = startApp(appPort, appData);
  t.after(() => stopChild(app));

  const appUrl = `http://127.0.0.1:${appPort}`;
  await waitForApp(appUrl, app);

  const loaded = await postJson(`${appUrl}/api/load-state`, {});
  assert.equal(loaded.response.status, 200);
  assert.equal(loaded.body.configs[0].hasApiKey, true);

  const configTest = await postJson(`${appUrl}/api/test-config`, {
    config: { id: configId, providerType: "bailian" }
  });
  assert.equal(configTest.response.status, 200);
  assert.equal(configTest.body.ok, true);
});
