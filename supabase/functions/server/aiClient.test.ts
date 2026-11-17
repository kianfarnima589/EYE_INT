import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatPayload,
  DEFAULT_AI_BASE,
  DEFAULT_AI_MODEL,
  extractAssistantContent,
  getAiConfig,
  getDefaultAiSettings,
  getPublicAiStatus,
  loadDotEnvFiles,
  normalizeAiBase,
  parseDotEnv,
  resetDotEnvCacheForTests,
  toDisplayBase,
} from "./aiClient";

test("parseDotEnv parses key/value pairs, comments, and quoted values", () => {
  const parsed = parseDotEnv(`
    # AI Settings
    AI_API_KEY="sk-test-123"
    AI_BASE_URL='https://api.artbloom.tech/v1'
    export AI_MODEL=gpt-6.1-sol
  `);
  assert.equal(parsed.AI_API_KEY, "sk-test-123");
  assert.equal(parsed.AI_BASE_URL, "https://api.artbloom.tech/v1");
  assert.equal(parsed.AI_MODEL, "gpt-6.1-sol");
});

test("normalizeAiBase and toDisplayBase normalize /v1 consistently", () => {
  assert.equal(normalizeAiBase("https://api.artbloom.tech"), "https://api.artbloom.tech/v1");
  assert.equal(normalizeAiBase("https://api.artbloom.tech/"), "https://api.artbloom.tech/v1");
  assert.equal(normalizeAiBase("https://api.artbloom.tech/v1/"), "https://api.artbloom.tech/v1");
  assert.equal(normalizeAiBase(undefined), DEFAULT_AI_BASE);
  assert.equal(toDisplayBase("https://api.artbloom.tech/v1"), "https://api.artbloom.tech");
});

test("getDefaultAiSettings uses Artbloom + gpt-6.1-sol defaults and env map overrides", () => {
  const d = getDefaultAiSettings({ AI_API_KEY: "sk-env-xyz" });
  assert.equal(d.key, "sk-env-xyz");
  assert.equal(d.base, "https://api.artbloom.tech/v1");
  assert.equal(d.displayBase, "https://api.artbloom.tech");
  assert.equal(d.model, DEFAULT_AI_MODEL);
  assert.equal(d.model, "gpt-6.1-sol");
});

test("loadDotEnvFiles reads workspace .env configuration accurately and overrides stale process.env", () => {
  const prevBase = process.env.AI_BASE_URL;
  const prevModel = process.env.AI_MODEL;
  process.env.AI_BASE_URL = "https://stale.invalid/v1";
  process.env.AI_MODEL = "stale-model";
  try {
    resetDotEnvCacheForTests();
    const loaded = loadDotEnvFiles(process.cwd());
    assert.equal(loaded.AI_BASE_URL, "https://api.artbloom.tech/v1");
    assert.equal(loaded.AI_MODEL, "gpt-6.1-sol");
    assert.ok(loaded.AI_API_KEY && loaded.AI_API_KEY.startsWith("sk-ab-"));
    const resolved = getDefaultAiSettings();
    assert.equal(resolved.base, "https://api.artbloom.tech/v1");
    assert.equal(resolved.model, "gpt-6.1-sol");
    assert.equal(resolved.displayBase, "https://api.artbloom.tech");
  } finally {
    if (prevBase === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = prevBase;
    if (prevModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = prevModel;
  }
});

test("getAiConfig prefers user KV override when present, otherwise falls back cleanly to default", async () => {
  const envMap = {
    AI_API_KEY: "sk-server-default",
    AI_BASE_URL: "https://api.artbloom.tech/v1",
    AI_MODEL: "gpt-6.1-sol",
  };
  const kvStore = new Map<string, any>();
  kvStore.set("ai:config:user-custom", {
    apiKey: "sk-user-override",
    baseUrl: "https://custom.example.com",
    model: "custom-model",
    updatedAt: 12345,
  });

  const defCfg = await getAiConfig("user-default", async (k) => kvStore.get(k), envMap);
  assert.equal(defCfg.source, "default");
  assert.equal(defCfg.key, "sk-server-default");
  assert.equal(defCfg.base, "https://api.artbloom.tech/v1");
  assert.equal(defCfg.model, "gpt-6.1-sol");

  const usrCfg = await getAiConfig("user-custom", async (k) => kvStore.get(k), envMap);
  assert.equal(usrCfg.source, "user");
  assert.equal(usrCfg.key, "sk-user-override");
  assert.equal(usrCfg.base, "https://custom.example.com/v1");
  assert.equal(usrCfg.model, "custom-model");
});

test("getPublicAiStatus never leaks secret keys and accurately distinguishes custom vs default", async () => {
  const envMap = {
    AI_API_KEY: "sk-secret-never-leak",
    AI_BASE_URL: "https://api.artbloom.tech/v1",
    AI_MODEL: "gpt-6.1-sol",
  };
  const status = await getPublicAiStatus("anon", async () => null, envMap);
  assert.equal(status.hasKey, true);
  assert.equal(status.hasCustomKey, false);
  assert.equal(status.source, "default");
  assert.equal(status.model, "gpt-6.1-sol");
  assert.equal(status.baseUrl, "https://api.artbloom.tech");
  assert.equal(JSON.stringify(status).includes("sk-secret"), false);
});

test("extractAssistantContent parses standard OpenAI JSON and SSE chunk streams", () => {
  const jsonReply = extractAssistantContent(
    JSON.stringify({ choices: [{ message: { content: "  سلام دنیا  " } }] }),
  );
  assert.equal(jsonReply, "سلام دنیا");

  const sseReply = extractAssistantContent(
    [
      'data: {"choices":[{"delta":{"content":"پاسخ "}}]}',
      'data: {"choices":[{"delta":{"content":"آزمایشی"}}]}',
      "data: [DONE]",
    ].join("\n"),
  );
  assert.equal(sseReply, "پاسخ آزمایشی");

  assert.throws(() => extractAssistantContent("{}"), /empty content/);
});

test("buildChatPayload switches cleanly between max_tokens and max_completion_tokens", () => {
  const standard = buildChatPayload("gpt-6.1-sol", [{ role: "user", content: "hi" }], {
    maxTokens: 512,
    temperature: 0.4,
  });
  assert.equal(standard.model, "gpt-6.1-sol");
  assert.equal(standard.max_tokens, 512);
  assert.equal(standard.temperature, 0.4);

  const compat = buildChatPayload("gpt-6.1-sol", [{ role: "user", content: "hi" }], {
    maxTokens: 512,
    useMaxCompletionTokens: true,
  });
  assert.equal(compat.max_completion_tokens, 512);
  assert.equal("max_tokens" in compat, false);
});
