const { chromium } = require("../.cache/ui-check/node_modules/playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
let snapshot = {
  configs: [
    {
      id: "demo",
      name: "创作配置",
      providerType: "openai-compatible",
      model: "gpt-image-1",
      baseUrl: "https://example.test/v1",
      hasApiKey: true,
      enabled: true,
      priority: 1,
    },
  ],
  activeConfigId: "demo",
  presets: [],
  history: [],
};
let mode = "success";
const server = http.createServer((req, res) => {
  const file = path.join(
    root,
    new URL(req.url, "http://localhost").pathname === "/"
      ? "index.html"
      : new URL(req.url, "http://localhost").pathname,
  );
  fs.readFile(file, (err, data) => {
    res.writeHead(err ? 404 : 200, {
      "Content-Type":
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
          path.extname(file)
        ] || "application/octet-stream",
    });
    res.end(err ? "Not found" : data);
  });
});
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.route("**/api/**", async (route) => {
      const req = route.request();
      const endpoint = new URL(req.url()).pathname;
      const body = req.headers()["content-type"]?.includes("application/json")
        ? req.postDataJSON() || {}
        : {};
      let json = { ok: true };
      let status = 200;
      if (endpoint === "/api/load-state") json = snapshot;
      else if (endpoint === "/api/save-config-state") {
        snapshot = { ...snapshot, ...body };
        json = snapshot;
      } else if (endpoint === "/api/save-history-state") {
        snapshot.history = body.history;
        json = { history: snapshot.history };
      } else if (endpoint === "/api/generate") {
        await new Promise((r) => setTimeout(r, 250));
        if (mode === "error") {
          status = 400;
          json = { ok: false, message: "测试：平台暂时不可用" };
        } else json = { images: [{ b64: pixel }] };
      } else if (endpoint === "/api/upload-reference")
        json = {
          fileId: "ref-demo",
          previewUrl: `data:image/png;base64,${pixel}`,
        };
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator(".canvas-empty").waitFor();
    assert.equal(
      await page.locator("#activeConfigSelect").inputValue(),
      "demo",
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    async function assertAligned() {
      const left = await page.locator(".left-panel").boundingBox();
      const right = await page.locator(".result-panel").boundingBox();
      assert(Math.abs(left.y - right.y) < 1, "panels share top edge");
      assert(
        Math.abs(left.height - right.height) < 1,
        "panels share bottom edge",
      );
      assert(right.x > left.x + left.width, "canvas sits beside parameters");
      assert(left.width > 450, "creation form has enough width");
      assert(
        await page
          .locator(".parameter-content")
          .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
        "form does not require inner scrolling",
      );
      assert(
        !(await page.locator("#galleryPage").isVisible()),
        "gallery is a separate view",
      );
    }
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1536, height: 703 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await assertAligned();
      await page.locator("#taskDetails").evaluate((node) => (node.open = true));
      await assertAligned();
      await page
        .locator("#taskDetails")
        .evaluate((node) => (node.open = false));
    }
    const action = await page.locator("#generateBtn").boundingBox();
    assert(
      action.y + action.height <= 900,
      "basic creation form fits the desktop viewport",
    );
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1536, height: 780 },
    ]) {
      await page.setViewportSize(viewport);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
        `default creation page fits ${viewport.width}x${viewport.height}`,
      );
      const top = await page.locator(".topbar").boundingBox();
      const work = await page.locator("#workspace").boundingBox();
      assert(
        work.y - top.y - top.height <= 16,
        "workspace follows navigation without a hero banner",
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const fonts = await page.evaluate(() => ({
      stack: getComputedStyle(document.body).fontFamily,
    }));
    assert(
      fonts.stack.indexOf("LXGW WenKai") <
        fonts.stack.indexOf("Microsoft YaHei"),
    );
    console.log("Font configuration:", fonts);
    await page.screenshot({ path: ".cache/ui-desktop.png", fullPage: true });
    for (const width of [1440, 1024, 800, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `horizontal overflow at ${width}`,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: ".cache/ui-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('[data-style="product"]').click();
    assert.match(await page.locator("#promptInput").inputValue(), /咖啡杯/);
    await page.locator("#savePresetBtn").click();
    await page.waitForFunction(
      () => document.querySelector("#presetSelect").options.length === 2,
    );
    await page.locator("#clearBtn").click();
    await page.locator("#presetSelect").selectOption({ index: 1 });
    assert.match(await page.locator("#promptInput").inputValue(), /咖啡杯/);
    await page.locator("#openSettingsBtn").click();
    assert(await page.locator("#settingsDialog").isVisible());
    await page.locator("#baseUrlInput").fill("invalid");
    await page
      .getByRole("button", { name: "关闭配置中心", exact: true })
      .click();
    assert(!(await page.locator("#settingsDialog").isVisible()));
    await page.locator("#generateBtn").click();
    await page.locator('[data-page="gallery"]').click();
    await page.locator("#galleryGrid .image-tile").waitFor();
    await page.locator('[data-page="create"]').click();
    await page.locator("#resultGrid .image-tile").waitFor();
    assert.equal(await page.locator("#galleryGrid .image-tile").count(), 1);
    await assertAligned();
    await page.locator("#resultGrid .image-wrap").click();
    assert(await page.locator("#previewDialog").isVisible());
    await page.keyboard.press("Escape");
    assert(!(await page.locator("#previewDialog").isVisible()));
    const draft = await page.locator("#promptInput").inputValue();
    await page.locator('[data-page="gallery"]').click();
    await page.locator("#galleryPage").waitFor();
    assert(!(await page.locator("#workspace").isVisible()));
    assert.equal(
      await page.locator('[data-page="gallery"]').getAttribute("aria-current"),
      "page",
    );
    assert.equal(await page.evaluate(() => scrollY), 0);
    for (const width of [1440, 1024, 800, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `gallery overflow at ${width}`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: ".cache/ui-gallery.png", fullPage: true });
    await page.goBack();
    await page.locator("#workspace").waitFor();
    assert.equal(await page.locator("#promptInput").inputValue(), draft);
    await page.goForward();
    await page.locator("#galleryPage").waitFor();
    await page.reload();
    await page.locator("#galleryGrid .image-tile").waitFor();
    assert(await page.locator("#galleryPage").isVisible());
    await page.locator("#galleryGrid .reuse-btn").click();
    await page.locator("#workspace").waitFor();
    assert.equal(await page.locator("#promptInput").inputValue(), draft);
    await page.locator('[data-page="gallery"]').click();
    await page.locator("#galleryPage").waitFor();
    await page.locator("#gallerySearch").fill("unmatched-query");
    assert.match(await page.locator("#galleryGrid").innerText(), /没有找到/);
    await page.locator("#gallerySearch").fill("");
    await page.locator(".select-image-checkbox:visible").check();
    assert(!(await page.locator("#deleteSelectedBtn").isDisabled()));
    await page.locator("#deleteSelectedBtn").click();
    await page.waitForFunction(
      () => document.querySelector("#galleryCount").textContent === "0",
    );
    await page.locator('[data-page="create"]').click();
    await page.locator("#workspace").waitFor();
    mode = "error";
    await page.locator("#promptInput").focus();
    await page.keyboard.press("Control+Enter");
    await page.waitForFunction(() =>
      document.querySelector("#taskStageBadge").classList.contains("error"),
    );
    assert(!(await page.locator("#generateBtn").isDisabled()));
    assert(!(await page.locator("#retryBtn").isDisabled()));
    await page.locator("#referenceSection > summary").click();
    await page.locator("#referenceInput").setInputFiles({
      name: "example.png",
      mimeType: "image/png",
      buffer: Buffer.from(pixel, "base64"),
    });
    await page.locator(".reference-item").waitFor();
    await page.locator("#clearRefsBtn").click();
    assert.equal(await page.locator(".reference-item").count(), 0);
    await page.locator("#uploadRefsBtn").evaluate((node) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["text"], "bad.txt", { type: "text/plain" }));
      node.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
      );
    });
    await page.waitForFunction(() =>
      document.querySelector("#referenceStatus").classList.contains("error"),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: separate gallery routing, refresh, back/forward, draft retention, reuse navigation, no inner form scrolling; six viewport widths; presets; modal close with invalid URL; generation; preview; search; selection/deletion; failure/retry; keyboard; reference upload/removal; invalid drop. No page errors.",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
