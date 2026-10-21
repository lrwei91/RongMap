const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');
const publicConfig = require('./public-config');

// 整个小程序只在这里初始化一次；Auth / Database / Storage / LLM 共用这一个客户端。
// endpoint 与 publishableKey 都来自 publicConfig，不要改成其他来源。
const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
  wx: createDiagnosticWx(wx)
});

module.exports = { cloud, publicConfig };
