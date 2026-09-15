const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
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

async function waitForApp(url, child) {
  const deadline = Date.now() + 10_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`AI Image Tool exited before becoming ready (${child.exitCode}).`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw lastError || new Error("Timed out waiting for AI Image Tool to start.");
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function startApp(t) {
  const appPort = await findAvailablePort();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "ai-image-tool-test-"));
  const app = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      APPDATA: appData,
      PORT: String(appPort)
    },
    stdio: ["ignore", "ignore", "ignore"]
  });
  t.after(async () => {
    await stopChild(app);
    fs.rmSync(appData, { force: true, recursive: true });
  });
  const appUrl = `http://127.0.0.1:${appPort}`;
  await waitForApp(appUrl, app);
  return appUrl;
}

async function uploadReference(appUrl, name, size) {
  const response = await fetch(`${appUrl}/api/upload-reference`, {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-File-Name": encodeURIComponent(name),
      "X-File-Size": String(size)
    },
    body: "x"
  });
  return { status: response.status, json: await response.json() };
}

test("rejects Bai Lian tasks that exceed reference image limits", { timeout: 20_000 }, async t => {
  const upstreamRequests = [];
  const upstream = http.createServer((req, res) => {
    upstreamRequests.push(req.url);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      output: {
        choices: [
          { message: { content: [{ image: "https://example.test/out.png" }] } }
        ]
      }
    }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const appUrl = await startApp(t);

  const fileIds = [];
  for (let index = 0; index < 4; index += 1) {
    const { status, json } = await uploadReference(appUrl, `ref-${index}.png`, 1);
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    fileIds.push(json.fileId);
  }
  const { status: oversizedStatus, json: oversizedJson } = await uploadReference(
    appUrl,
    "ref-oversized.png",
    11 * 1024 * 1024
  );
  assert.equal(oversizedStatus, 200);
  assert.equal(oversizedJson.ok, true);

  const config = {
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${upstreamPort}/api/v1`,
    model: "qwen-image-edit",
    name: "Bailian reference test",
    providerType: "bailian",
    timeoutSeconds: 15
  };

  const tooMany = await fetch(`${appUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config,
      task: {
        count: 1,
        id: "task-ref-count",
        prompt: "Merge the references",
        size: "1024x1024",
        referenceImages: fileIds.map(fileId => ({
          fileId,
          name: "ref.png",
          type: "image/png",
          size: 1
        }))
      }
    })
  });
  const tooManyResult = await tooMany.json();
  assert.equal(tooMany.status, 400);
  assert.equal(tooManyResult.code, "too_many_references");
  assert.match(tooManyResult.message, /最多支持 3 张/);

  const tooLarge = await fetch(`${appUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config,
      task: {
        count: 1,
        id: "task-ref-size",
        prompt: "Merge the references",
        size: "1024x1024",
        referenceImages: [
          { fileId: oversizedJson.fileId, name: "ref.png", type: "image/png", size: 11 * 1024 * 1024 }
        ]
      }
    })
  });
  const tooLargeResult = await tooLarge.json();
  assert.equal(tooLarge.status, 400);
  assert.equal(tooLargeResult.code, "reference_too_large");
  assert.match(tooLargeResult.message, /单张参考图不能超过 10MB/);

  assert.equal(upstreamRequests.length, 0);
});

test("rejects reference uploads above the per-file cap", { timeout: 20_000 }, async t => {
  const appUrl = await startApp(t);

  const rejected = await uploadReference(appUrl, "huge.png", 60 * 1024 * 1024);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.json.code, "payload_too_large");
  assert.match(rejected.json.message, /50MB/);

  const accepted = await uploadReference(appUrl, "small.png", 1024);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.ok, true);
  assert.ok(accepted.json.fileId);
});

test("removes stale reference files on startup", { timeout: 20_000 }, async t => {
  const referenceDir = path.join(os.tmpdir(), "ai-image-tool-references");
  fs.mkdirSync(referenceDir, { recursive: true });
  const stalePath = path.join(referenceDir, `stale-${process.pid}-${Date.now()}.png`);
  fs.writeFileSync(stalePath, "stale");
  const staleTime = new Date(Date.now() - 26 * 60 * 60 * 1000);
  fs.utimesSync(stalePath, staleTime, staleTime);
  const freshPath = path.join(referenceDir, `fresh-${process.pid}-${Date.now()}.png`);
  fs.writeFileSync(freshPath, "fresh");
  t.after(() => {
    fs.rmSync(stalePath, { force: true });
    fs.rmSync(freshPath, { force: true });
  });

  await startApp(t);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && fs.existsSync(stalePath)) {
    await delay(100);
  }
  assert.equal(fs.existsSync(stalePath), false);
  assert.equal(fs.existsSync(freshPath), true);
});
