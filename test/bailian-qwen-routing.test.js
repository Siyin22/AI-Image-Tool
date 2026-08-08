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

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
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

test("routes Qwen Image 2.0 and 3.0 models through the synchronous multimodal endpoint", { timeout: 20_000 }, async t => {
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    const body = await readJson(req);
    upstreamRequests.push({
      headers: req.headers,
      method: req.method,
      path: req.url,
      body
    });

    if (req.url !== "/api/v1/services/aigc/multimodal-generation/generation") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "unexpected endpoint" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      output: {
        choices: [
          {
            message: {
              content: [
                { image: "https://example.test/qwen-image.png" }
              ]
            }
          }
        ]
      }
    }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

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

  const rootBaseUrl = `http://127.0.0.1:${upstreamPort}/api/v1`;
  const models = [
    { model: "qwen-image-2.0-pro-2026-06-22", baseUrl: rootBaseUrl },
    { model: "qwen-image-3.0-pro", baseUrl: rootBaseUrl },
    {
      model: "qwen-image-3.0",
      baseUrl: `${rootBaseUrl}/services/aigc/text2image/image-synthesis`
    }
  ];
  for (const { model, baseUrl } of models) {
    const response = await fetch(`${appUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          apiKey: "test-key",
          baseUrl,
          model,
          name: "Qwen test",
          providerType: "bailian",
          timeoutSeconds: 15
        },
        task: {
          count: 1,
          id: `task-${model}`,
          prompt: "A bright paper lantern",
          size: "1024x1024"
        }
      })
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].model, model);
  }

  assert.equal(upstreamRequests.length, models.length);
  for (const request of upstreamRequests) {
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/api/v1/services/aigc/multimodal-generation/generation");
    assert.equal(request.headers["x-dashscope-async"], undefined);
    assert.equal(request.body.input.messages[0].content[0].text, "A bright paper lantern");
  }
});

test("keeps Wan v2 and legacy Bai Lian models on their asynchronous request paths", { timeout: 20_000 }, async t => {
  const creationRequests = [];
  let taskCount = 0;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "POST") {
      const body = await readJson(req);
      const taskId = `remote-${++taskCount}`;
      creationRequests.push({
        headers: req.headers,
        path: req.url,
        body,
        taskId
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ output: { task_id: taskId } }));
      return;
    }

    if (req.method === "GET" && /^\/api\/v1\/tasks\/remote-\d+$/.test(req.url)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        output: {
          results: [{ url: "https://example.test/wan-image.png" }],
          task_status: "SUCCEEDED"
        }
      }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "unexpected endpoint" }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

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
  const baseUrl = `http://127.0.0.1:${upstreamPort}/api/v1`;
  await waitForApp(appUrl, app);

  for (const model of ["wan2.6-t2i", "wanx2.1-t2i-turbo"]) {
    const response = await fetch(`${appUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          apiKey: "test-key",
          baseUrl,
          model,
          name: "Wan test",
          providerType: "bailian",
          timeoutSeconds: 15
        },
        task: {
          count: 1,
          id: `task-${model}`,
          prompt: "A ceramic vase",
          size: "1024x1024"
        }
      })
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].model, model);
  }

  assert.equal(creationRequests.length, 2);
  const wanV2 = creationRequests.find(request => request.body.model === "wan2.6-t2i");
  const legacy = creationRequests.find(request => request.body.model === "wanx2.1-t2i-turbo");

  assert.equal(wanV2.path, "/api/v1/services/aigc/image-generation/generation");
  assert.equal(wanV2.headers["x-dashscope-async"], "enable");
  assert.equal(wanV2.body.input.messages[0].content[0].text, "A ceramic vase");

  assert.equal(legacy.path, "/api/v1/services/aigc/text2image/image-synthesis");
  assert.equal(legacy.headers["x-dashscope-async"], "enable");
  assert.equal(legacy.body.input.prompt, "A ceramic vase");
});
