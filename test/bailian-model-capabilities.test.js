const assert = require("node:assert/strict");
const { test } = require("node:test");

const { getBailianModelCapabilities } = require("../bailian-models");

test("recognizes dated Qwen Image 2.0 and Qwen Image 3.0 models as synchronous multimodal models", () => {
  for (const model of [
    "qwen-image-2.0-pro-2026-06-22",
    "qwen-image-3.0-pro",
    "qwen-image-3.0"
  ]) {
    assert.deepEqual(getBailianModelCapabilities(model), {
      createPath: "/services/aigc/multimodal-generation/generation",
      family: "qwen-image",
      requestMode: "sync",
      supportsReferenceImages: true
    });
  }
});

test("keeps text-only Qwen Image models separate from image-edit capable Qwen models", () => {
  assert.equal(getBailianModelCapabilities("qwen-image").supportsReferenceImages, false);
  assert.equal(getBailianModelCapabilities("qwen-image-plus").supportsReferenceImages, false);
  assert.equal(getBailianModelCapabilities("qwen-image-edit").supportsReferenceImages, true);
});

test("preserves the existing Wan and legacy Bai Lian protocol choices", () => {
  assert.deepEqual(getBailianModelCapabilities("wan2.6-t2i"), {
    createPath: "/services/aigc/image-generation/generation",
    family: "wan-v2",
    requestMode: "async",
    supportsReferenceImages: true
  });
  assert.deepEqual(getBailianModelCapabilities("wanx2.1-t2i-turbo"), {
    createPath: "/services/aigc/text2image/image-synthesis",
    family: "legacy",
    requestMode: "async",
    supportsReferenceImages: false
  });
});
