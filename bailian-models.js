(function exposeBailianModels(root, createApi) {
  const api = createApi();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BailianModels = api;
})(typeof globalThis === "object" ? globalThis : this, function createBailianModels() {
  const qwenImageModel = /^qwen-image(?:$|[-._])/i;
  const qwenReferenceModel = /^qwen-image-(?:edit(?:$|[-._])|2\.0(?:$|[-._])|3\.0(?:$|[-._]))/i;
  const wanV2Model = /^wan2\.(6|7|8)/i;

  function getBailianModelCapabilities(model) {
    const name = String(model || "").trim();
    if (qwenImageModel.test(name)) {
      return {
        createPath: "/services/aigc/multimodal-generation/generation",
        family: "qwen-image",
        requestMode: "sync",
        supportsReferenceImages: qwenReferenceModel.test(name)
      };
    }
    if (wanV2Model.test(name)) {
      return {
        createPath: "/services/aigc/image-generation/generation",
        family: "wan-v2",
        requestMode: "async",
        supportsReferenceImages: true
      };
    }
    return {
      createPath: "/services/aigc/text2image/image-synthesis",
      family: "legacy",
      requestMode: "async",
      supportsReferenceImages: false
    };
  }

  return { getBailianModelCapabilities };
});
