import fs from "node:fs";
import path from "node:path";
import * as kv from "./kv_store.tsx";

export const DEFAULT_AI_BASE = "https://api.artbloom.tech/v1";
export const DEFAULT_AI_MODEL = "gpt-6.1-sol";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type ResolvedAiConfig = {
  key: string;
  base: string;
  displayBase: string;
  model: string;
  source: "user" | "default";
};

export type PublicAiStatus = {
  hasKey: boolean;
  hasCustomKey: boolean;
  source: "user" | "default";
  baseUrl: string;
  model: string;
  updatedAt: number;
  defaultBase: string;
  defaultModel: string;
};

const aiConfigKey = (u: string) => `ai:config:${u}`;

export function parseDotEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

let cachedDotEnv: Record<string, string> | null = null;

export function resetDotEnvCacheForTests(): void {
  cachedDotEnv = null;
}

export function loadDotEnvFiles(cwd = process.cwd()): Record<string, string> {
  if (cachedDotEnv) return cachedDotEnv;
  const merged: Record<string, string> = {};
  for (const filename of [".env", ".env.local"]) {
    try {
      const fullPath = path.resolve(cwd, filename);
      if (fs.existsSync(fullPath)) {
        const parsed = parseDotEnv(fs.readFileSync(fullPath, "utf8"));
        Object.assign(merged, parsed);
      }
    } catch {
      // Ignore file read errors in restricted serverless runtimes
    }
  }
  cachedDotEnv = merged;
  return merged;
}

export function getServerEnv(name: string, envMap?: Record<string, string | undefined>): string {
  if (envMap) {
    const mockVal = envMap[name];
    return typeof mockVal === "string" ? mockVal.trim() : "";
  }
  const fileEnv = loadDotEnvFiles();
  const fileVal = fileEnv[name];
  if (typeof fileVal === "string" && fileVal.trim()) return fileVal.trim();
  const runtimeVal = process.env[name];
  return typeof runtimeVal === "string" ? runtimeVal.trim() : "";
}

export function normalizeAiBase(raw?: string, fallbackBase = DEFAULT_AI_BASE): string {
  const b = String(raw || fallbackBase).trim().replace(/\/+$/, "");
  if (!b) return fallbackBase;
  if (/\/v\d+$/i.test(b)) return b;
  return `${b}/v1`;
}

export function toDisplayBase(raw?: string): string {
  return normalizeAiBase(raw).replace(/\/v\d+\/?$/, "");
}

export function getDefaultAiSettings(envMap?: Record<string, string | undefined>): {
  key: string;
  base: string;
  displayBase: string;
  model: string;
} {
  const key =
    getServerEnv("AI_API_KEY", envMap) ||
    getServerEnv("AINATIVE_API_KEY", envMap) ||
    "";
  const base = normalizeAiBase(getServerEnv("AI_BASE_URL", envMap) || DEFAULT_AI_BASE);
  const displayBase = toDisplayBase(base);
  const model = getServerEnv("AI_MODEL", envMap) || DEFAULT_AI_MODEL;
  return { key, base, displayBase, model };
}

export async function getAiConfig(
  userId?: string,
  kvGetFn: (key: string) => Promise<any> = kv.get,
  envMap?: Record<string, string | undefined>,
): Promise<ResolvedAiConfig> {
  const defaults = getDefaultAiSettings(envMap);
  if (userId) {
    try {
      const cfg: any = await kvGetFn(aiConfigKey(userId));
      if (cfg?.apiKey && String(cfg.apiKey).trim()) {
        const base = normalizeAiBase(cfg.baseUrl, defaults.base);
        return {
          key: String(cfg.apiKey).trim(),
          base,
          displayBase: toDisplayBase(base),
          model: String(cfg.model || defaults.model).trim() || defaults.model,
          source: "user",
        };
      }
    } catch (e) {
      console.log("getAiConfig error:", String(e));
    }
  }
  return {
    key: defaults.key,
    base: defaults.base,
    displayBase: defaults.displayBase,
    model: defaults.model,
    source: "default",
  };
}

export async function getPublicAiStatus(
  userId?: string,
  kvGetFn: (key: string) => Promise<any> = kv.get,
  envMap?: Record<string, string | undefined>,
): Promise<PublicAiStatus> {
  const defaults = getDefaultAiSettings(envMap);
  let cfg: any = null;
  if (userId) {
    try {
      cfg = (await kvGetFn(aiConfigKey(userId))) || null;
    } catch {
      cfg = null;
    }
  }
  const hasCustomKey = !!(cfg?.apiKey && String(cfg.apiKey).trim());
  const effectiveBase = hasCustomKey ? toDisplayBase(cfg?.baseUrl || defaults.base) : defaults.displayBase;
  const effectiveModel = hasCustomKey
    ? String(cfg?.model || defaults.model).trim() || defaults.model
    : defaults.model;

  return {
    hasKey: hasCustomKey || !!defaults.key,
    hasCustomKey,
    source: hasCustomKey ? "user" : "default",
    baseUrl: effectiveBase,
    model: effectiveModel,
    updatedAt: Number(cfg?.updatedAt) || Date.now(),
    defaultBase: defaults.displayBase,
    defaultModel: defaults.model,
  };
}

export function extractAssistantContent(rawText: string): string {
  const raw = String(rawText || "").trim();
  if (!raw) throw new Error("AI upstream returned empty body");

  // Support SSE streamed responses ("data: {...}") if an upstream streams chunks.
  if (raw.startsWith("data:") || raw.includes("\ndata:")) {
    let assembled = "";
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content;
        if (typeof delta === "string") assembled += delta;
      } catch {
        // Ignore malformed partial SSE frames
      }
    }
    if (assembled.trim()) return assembled.trim();
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`AI upstream returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const msgContent = data?.choices?.[0]?.message?.content;
  if (typeof msgContent === "string" && msgContent.trim()) {
    return msgContent.trim();
  }
  if (Array.isArray(msgContent)) {
    const joined = msgContent
      .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
      .join("")
      .trim();
    if (joined) return joined;
  }
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  throw new Error(`AI upstream returned empty content: ${raw.slice(0, 200)}`);
}

export function buildChatPayload(
  model: string,
  messages: ChatMsg[],
  opts: { maxTokens?: number; temperature?: number; useMaxCompletionTokens?: boolean } = {},
): Record<string, any> {
  const body: Record<string, any> = {
    model,
    messages,
  };
  const limit = opts.maxTokens ?? 1024;
  if (opts.useMaxCompletionTokens) {
    body.max_completion_tokens = limit;
  } else {
    body.max_tokens = limit;
    if (typeof opts.temperature === "number") {
      body.temperature = opts.temperature;
    } else {
      body.temperature = 0.3;
    }
  }
  return body;
}

export async function aiChat(
  messages: ChatMsg[],
  opts: { model?: string; maxTokens?: number; temperature?: number; userId?: string; timeoutMs?: number } = {},
): Promise<string> {
  const cfg = await getAiConfig(opts.userId);
  if (!cfg.key) {
    throw new Error("کلید هوش مصنوعی تنظیم نشده است (نه کلید کاربر، نه کلید پیش‌فرض سرور)");
  }

  const targetModel = String(opts.model || cfg.model).trim() || cfg.model;
  const timeoutMs = opts.timeoutMs ?? 45000;

  const sendRequest = async (useMaxCompletionTokens: boolean) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.key}`,
        },
        body: JSON.stringify(
          buildChatPayload(targetModel, messages, {
            maxTokens: opts.maxTokens,
            temperature: opts.temperature,
            useMaxCompletionTokens,
          }),
        ),
        signal: ctrl.signal,
      });
      const raw = await res.text();
      return { res, raw };
    } finally {
      clearTimeout(timer);
    }
  };

  let { res, raw } = await sendRequest(false);

  // Automatic parameter compatibility fallback for newer GPT-style endpoints that
  // reject `max_tokens` or custom `temperature` with HTTP 400.
  if (
    res.status === 400 &&
    /max_completion_tokens|unsupported.*parameter|temperature/i.test(raw)
  ) {
    ({ res, raw } = await sendRequest(true));
  }

  if (!res.ok) {
    throw new Error(`AI upstream error ${res.status}: ${raw.slice(0, 400)}`);
  }

  return extractAssistantContent(raw);
}

export async function verifyAiCredentials(params: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}): Promise<{ ok: boolean; detail?: string; base: string; displayBase: string; model: string }> {
  const defaults = getDefaultAiSettings();
  const base = normalizeAiBase(params.baseUrl, defaults.base);
  const displayBase = toDisplayBase(base);
  const model = String(params.model || defaults.model).trim() || defaults.model;
  const key = String(params.apiKey || "").trim();

  let detail = "";
  try {
    const r = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) {
      return { ok: true, base, displayBase, model };
    }
    if (r.status === 401 || r.status === 403) {
      const body = await r.text().catch(() => "");
      return { ok: false, detail: `${r.status}: ${body.slice(0, 200)}`, base, displayBase, model };
    }
    detail = `models ${r.status}`;
  } catch (e) {
    detail = String(e);
  }

  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(20000),
    });
    const raw = await r.text();
    if (r.ok) return { ok: true, base, displayBase, model };
    detail = `${r.status}: ${raw.slice(0, 200)}`;
  } catch (e) {
    detail = String(e);
  }

  return { ok: false, detail, base, displayBase, model };
}
