import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml } from "node-html-parser";
import { createClient } from "@supabase/supabase-js";
import * as kv from "./kv_store.tsx";
import { gdelt } from "./gdelt.tsx";
import { social, runSocialScan } from "./social.tsx";
import { newspack, runNewspackScheduled } from "./newspack.tsx";
import { watch, runWatchScan } from "./watch.tsx";
import {
  parseFeedXml,
  stripHtml,
  getText,
  extractImage,
  normalizeFa,
  detectLang,
  contentSig,
  safeDateMs,
  buildGoogleNewsFallbackUrls,
} from "./feedParser";
import {
  aiChat,
  type ChatMsg,
  getDefaultAiSettings,
  getPublicAiStatus,
  verifyAiCredentials,
} from "./aiClient.ts";

const app = new Hono();

// Supabase service client (server-side only) for Storage (branded news cards).
const supabase = createClient(
  process.env.SUPABASE_URL || "https://example.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "anon",
);
const CARD_BUCKET = "make-a2e7e82a-cards";
let cardBucketReady = false;
async function ensureCardBucket() {
  if (cardBucketReady) return;
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b) => b.name === CARD_BUCKET)) {
      await supabase.storage.createBucket(CARD_BUCKET, { public: false });
    }
    cardBucketReady = true;
  } catch (e) {
    console.log("ensureCardBucket error:", String(e));
  }
}

app.use("*", logger(console.log));
app.onError((err, c) => {
  console.log("server onError:", err);
  const path = c.req.path || "";
  if (path.includes("/gdelt/")) {
    return c.json({ articles: [], error: String(err?.message || err) }, 200);
  }
  return c.json({ error: String(err?.message || err) }, 500);
});
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

const BASE = "/make-server-a2e7e82a";
const FEEDS_KEY = "feeds:list";
const READ_KEY = "state:read";
const STARRED_KEY = "state:starred";
const TAGS_KEY = "state:tags";
const FEED_STATUS_KEY = "feeds:status";
const RULES_KEY = "state:rules";

type TagRule = {
  id: string;
  name: string;
  tag: string;
  keywords: string[];
  fields?: ("title" | "preview" | "content" | "source")[];
  enabled: boolean;
};

function applyRules(item: any, rules: TagRule[]): string[] {
  const hits = new Set<string>();
  for (const r of rules) {
    if (!r.enabled || !r.keywords?.length) continue;
    const fields = r.fields?.length ? r.fields : ["title", "preview", "content"];
    const haystack = fields.map(f => String(item[f] || "")).join(" ").toLowerCase();
    if (r.keywords.some(k => k && haystack.includes(k.toLowerCase()))) hits.add(r.tag);
  }
  return Array.from(hits);
}

app.get(`${BASE}/health`, (c) => c.json({ status: "ok" }));

app.route(`${BASE}/gdelt`, gdelt);
app.route(`${BASE}/social`, social);
app.route(`${BASE}/newspack`, newspack);
app.route(`${BASE}/watch`, watch);

// ───────────────────────────── AI (LLM) ─────────────────────────────
// Proxies AI requests to an OpenAI-compatible endpoint via ./aiClient.ts.
// Keys live only on the server (.env or per-user KV ai:config:{u}) and never
// reach the frontend.
const aiConfigKey = (u: string) => `ai:config:${u}`;

// Extract a JSON object from a model reply that may be fenced or padded.
function extractJson(text: string): any {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function clampText(s: string, max = 6000): string {
  return s.length <= max ? s : s.slice(0, max);
}

// ── Per-user AI key (BYO) ──
app.get(`${BASE}/ai/config`, async (c) => {
  const u = studioUser(c);
  const config = await getPublicAiStatus(u, kv.get);
  return c.json({ config });
});

app.post(`${BASE}/ai/config`, async (c) => {
  try {
    const u = studioUser(c);
    const { apiKey, baseUrl, model } = await c.req.json();
    if (!apiKey || !String(apiKey).trim()) return c.json({ error: "کلید API لازم است" }, 400);

    const check = await verifyAiCredentials({ apiKey, baseUrl, model });
    if (!check.ok) return c.json({ error: `بررسی کلید ناموفق بود: ${check.detail || "نامعتبر"}` }, 400);

    await kv.set(aiConfigKey(u), {
      apiKey: String(apiKey).trim(),
      baseUrl: check.displayBase,
      model: check.model,
      updatedAt: Date.now(),
    });
    const config = await getPublicAiStatus(u, kv.get);
    return c.json({ ok: true, config });
  } catch (e) {
    console.log("ai/config save error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

app.delete(`${BASE}/ai/config`, async (c) => {
  const u = studioUser(c);
  await kv.del(aiConfigKey(u));
  const defaults = getDefaultAiSettings();
  return c.json({ ok: true, defaultBase: defaults.displayBase, defaultModel: defaults.model });
});

app.post(`${BASE}/ai/summarize`, async (c) => {
  try {
    const { title = "", content = "" } = await c.req.json();
    const body = clampText(String(content || ""));
    if (!body && !title) return c.json({ error: "title or content required" }, 400);

    const words = body.split(/\s+/).filter(Boolean).length;
    const readingMinutes = Math.max(1, Math.round(words / 220));

    const buildFallbackSummary = () => {
      const clean = (body || String(title)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const sentences = clean.split(/(?<=[.!?؟۔\n])\s+/).map((s) => s.trim()).filter((s) => s.length > 15);
      const tldr = sentences[0] || String(title).trim();
      const bullets = sentences.slice(0, 4).length > 0 ? sentences.slice(0, 4) : [String(title).trim()];
      return {
        tldr,
        bullets,
        long: sentences.slice(0, 3).join(" ") || clean.slice(0, 360) || String(title).trim(),
        entities: [],
        readingMinutes,
      };
    };

    const sys =
      "تو دستیار خلاصه‌سازی خبر هستی. خروجی را فقط و فقط به صورت یک شیء JSON معتبر بده، بدون هیچ توضیح اضافه. " +
      "ساختار دقیق: {\"tldr\": string, \"bullets\": string[], \"long\": string, \"entities\": string[]}. " +
      "tldr یک جملهٔ کوتاه؛ bullets سه تا پنج نکتهٔ کلیدی؛ long یک پاراگراف؛ entities نام افراد/سازمان‌ها/مکان‌های مهم. " +
      "همهٔ متن‌ها باید به زبان متن ورودی (معمولاً فارسی) باشد.";
    const user = `عنوان: ${title}\n\nمتن:\n${body}`;

    let parsed: any = null;
    try {
      const reply = await aiChat(
        [{ role: "system", content: sys }, { role: "user", content: user }],
        { maxTokens: 900, temperature: 0.3, userId: studioUser(c) },
      );
      parsed = extractJson(reply);
    } catch (e) {
      console.log("ai/summarize fallback used:", String(e));
      return c.json({ summary: buildFallbackSummary(), fallback: true });
    }

    const summary = {
      tldr: String(parsed?.tldr || "").trim() || buildFallbackSummary().tldr,
      bullets: Array.isArray(parsed?.bullets) && parsed.bullets.length > 0
        ? parsed.bullets.map((b: any) => String(b).trim()).filter(Boolean).slice(0, 6)
        : buildFallbackSummary().bullets,
      long: String(parsed?.long || "").trim() || buildFallbackSummary().long,
      entities: Array.isArray(parsed?.entities) ? parsed.entities.map((e: any) => String(e).trim()).filter(Boolean).slice(0, 8) : [],
      readingMinutes,
    };
    return c.json({ summary });
  } catch (e) {
    console.log("ai/summarize error:", String(e));
    return c.json({
      summary: {
        tldr: "خلاصهٔ خودکار خبر آماده است.",
        bullets: ["متن کامل خبر در بخش مطالعه در دسترس است."],
        long: "خلاصهٔ خبر بر اساس محتوای دریافتی استخراج شد.",
        entities: [],
        readingMinutes: 1,
      },
      fallback: true,
    });
  }
});

app.post(`${BASE}/ai/ask`, async (c) => {
  try {
    const { title = "", content = "", question = "", history = [] } = await c.req.json();
    if (!String(question).trim()) return c.json({ error: "question required" }, 400);
    const body = clampText(String(content || ""));

    const sys =
      "تو دستیار پرسش‌وپاسخ دربارهٔ یک مقالهٔ خبری هستی. فقط بر اساس متن مقاله پاسخ بده. " +
      "اگر پاسخ در متن نیست، صادقانه بگو که در مقاله نیامده. پاسخ‌ها کوتاه، دقیق و به زبان پرسش (معمولاً فارسی) باشند.";
    const articleCtx = `عنوان مقاله: ${title}\n\nمتن مقاله:\n${body}`;

    const msgs: ChatMsg[] = [
      { role: "system", content: sys },
      { role: "system", content: articleCtx },
    ];
    if (Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        const role = h?.role === "ai" || h?.role === "assistant" ? "assistant" : "user";
        if (h?.text) msgs.push({ role, content: String(h.text) });
      }
    }
    msgs.push({ role: "user", content: String(question) });

    const answer = await aiChat(msgs, { maxTokens: 700, temperature: 0.4, userId: studioUser(c) });
    return c.json({ answer });
  } catch (e) {
    console.log("ai/ask error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// Daily digest — «امروز چه گذشت»: big picture → 3 key points → 1 action.
app.post(`${BASE}/ai/digest`, async (c) => {
  try {
    const { headlines = [], stats = {}, period = 1 } = await c.req.json();
    const items = (Array.isArray(headlines) ? headlines : [])
      .map((h: any) => `- [${String(h.source || "").slice(0, 40)}${h.sentiment ? ` | ${h.sentiment}` : ""}] ${String(h.title || "").slice(0, 200)}`)
      .slice(0, 60)
      .join("\n");
    if (!items.trim()) return c.json({ error: "headlines required" }, 400);

    const statLine = [
      stats.volume != null ? `حجم پوشش: ${stats.volume}` : "",
      stats.sources != null ? `منابع فعال: ${stats.sources}` : "",
      stats.netSentiment != null ? `احساسات خالص: ${stats.netSentiment}` : "",
      stats.topTopics ? `موضوعات داغ: ${stats.topTopics}` : "",
    ].filter(Boolean).join(" • ");

    const sys =
      "تو تحلیلگر ارشد رصد رسانه‌ای هستی. بر پایهٔ فهرست تیترها و آمار دوره، یک خلاصهٔ روزانهٔ مدیریتی بساز. " +
      "فقط یک شیء JSON معتبر بده، بدون توضیح اضافه. ساختار دقیق: " +
      "{\"bigPicture\": string, \"keyPoints\": string[], \"action\": string, \"mood\": \"positive\"|\"negative\"|\"neutral\"}. " +
      "bigPicture یک پاراگراف کوتاه دربارهٔ تصویر کلی؛ keyPoints دقیقاً سه نکتهٔ مهم؛ action یک توصیهٔ عملی برای مدیر؛ " +
      "mood فضای کلی احساسات. همه به فارسی روان و حرفه‌ای.";
    const user = `بازهٔ زمانی: ${period} روز اخیر\nآمار: ${statLine || "—"}\n\nتیترها:\n${clampText(items, 5000)}`;

    const reply = await aiChat(
      [{ role: "system", content: sys }, { role: "user", content: user }],
      { maxTokens: 900, temperature: 0.4, userId: studioUser(c) },
    );

    let parsed: any;
    try { parsed = extractJson(reply); }
    catch (e) {
      console.log("ai/digest JSON parse failed:", String(e), "reply:", reply.slice(0, 200));
      return c.json({ error: "AI returned malformed JSON", raw: reply.slice(0, 300) }, 502);
    }
    const digest = {
      bigPicture: String(parsed.bigPicture || "").trim(),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map((b: any) => String(b).trim()).filter(Boolean).slice(0, 5) : [],
      action: String(parsed.action || "").trim(),
      mood: ["positive", "negative", "neutral"].includes(parsed.mood) ? parsed.mood : "neutral",
      generatedAt: Date.now(),
    };
    return c.json({ digest });
  } catch (e) {
    console.log("ai/digest error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// AI Narrative Divergence Inspector — compares domestic vs. international or multi-outlet framings
app.post(`${BASE}/ai/graph-divergence`, async (c) => {
  try {
    const { clusterTitle = "", items = [] } = await c.req.json();
    const list = (Array.isArray(items) ? items : []).slice(0, 20);
    if (list.length === 0) return c.json({ error: "items required" }, 400);

    const formatted = list
      .map(
        (it: any, idx: number) =>
          `${idx + 1}. [${String(it.source || "").slice(0, 40)} | ${String(it.category || "عمومی").slice(0, 40)}] تیتر: ${String(it.title || "").slice(0, 220)}${it.preview ? ` — خلاصه: ${String(it.preview).slice(0, 180)}` : ""}`,
      )
      .join("\n");

    const sys =
      "تو تحلیلگر ارشد رسانه و زبان‌شناس سیاسی هستی. یک خوشهٔ خبری که توسط چند رسانه (داخلی و/یا بین‌المللی) پوشش داده شده به تو داده می‌شود. " +
      "وظیفهٔ تو کالبدشکافی دقیق اختلاف روایت در ۳ بخش است. فقط و فقط یک شیء JSON معتبر برگردان با ساختار دقیق زیر:\n" +
      "{\n" +
      '  "summary": "جمع‌بندی دو جمله‌ای از چگونگی بازتاب این رویداد",\n' +
      '  "agreedFacts": ["فکت مورد توافق ۱", "فکت مورد توافق ۲", "فکت مورد توافق ۳"],\n' +
      '  "framingDifferences": [\n' +
      '    {"side": "نام قطب یا گروه رسانه‌ای (مثلاً رسانه‌های داخلی / رسانه‌های بین‌المللی)", "sources": ["نام منبع ۱", "نام منبع ۲"], "framing": "چگونگی برجسته‌سازی و زاویه دید", "tone": "لحن غالب"}\n' +
      "  ],\n" +
      '  "loadedVocabulary": [\n' +
      '    {"term": "واژه یا ترکیب کلیدی باردار", "usedBy": "نام رسانه یا قطب استفاده‌کننده", "connotation": "بار معنایی و هدف اقناعی آن"}\n' +
      "  ]\n" +
      "}\n" +
      "تمامی توضیحات را به فارسی روان، دقیق و بی‌طرفانه بنویس.";

    const user = `عنوان خوشه: ${String(clusterTitle).slice(0, 250)}\n\nگزارش‌های رسانه‌ها:\n${clampText(formatted, 5500)}`;

    const reply = await aiChat(
      [{ role: "system", content: sys }, { role: "user", content: user }],
      { maxTokens: 2200, temperature: 0.3, userId: studioUser(c) },
    );

    const parsed = extractJson(reply);
    return c.json({
      divergence: {
        summary: String(parsed.summary || "").trim(),
        agreedFacts: Array.isArray(parsed.agreedFacts)
          ? parsed.agreedFacts.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 6)
          : [],
        framingDifferences: Array.isArray(parsed.framingDifferences)
          ? parsed.framingDifferences.slice(0, 4).map((f: any) => ({
              side: String(f?.side || "قطب رسانه‌ای").trim(),
              sources: Array.isArray(f?.sources) ? f.sources.map((s: any) => String(s)).slice(0, 6) : [],
              framing: String(f?.framing || "").trim(),
              tone: String(f?.tone || "").trim(),
            }))
          : [],
        loadedVocabulary: Array.isArray(parsed.loadedVocabulary)
          ? parsed.loadedVocabulary.slice(0, 8).map((v: any) => ({
              term: String(v?.term || "").trim(),
              usedBy: String(v?.usedBy || "").trim(),
              connotation: String(v?.connotation || "").trim(),
            }))
          : [],
      },
    });
  } catch (e) {
    return c.json({ fallback: true, error: String(e) }, 200);
  }
});

// One-Click Graph Situation Brief — executive one-page summary of the current media graph
app.post(`${BASE}/ai/graph-brief`, async (c) => {
  try {
    const body = await c.req.json();
    const {
      stats = {},
      topClusters = [],
      topBridges = [],
      topLeaders = [],
      syndicationCount = 0,
      blindspotSummary = "",
      emergingSignals = [],
    } = body || {};

    const clustersText = (Array.isArray(topClusters) ? topClusters : [])
      .slice(0, 6)
      .map(
        (cl: any, i: number) =>
          `${i + 1}. «${String(cl.title || "").slice(0, 180)}» (منشأ: ${cl.origin || "—"} | تعداد منابع: ${cl.size || 0} | سرعت: ${cl.velocity || "—"})`,
      )
      .join("\n");

    const bridgesText = (Array.isArray(topBridges) ? topBridges : [])
      .slice(0, 5)
      .map((b: any) => `${b.name} (امتیاز پل ارتباطی: ${b.score})`)
      .join("، ");

    const leadersText = (Array.isArray(topLeaders) ? topLeaders : [])
      .slice(0, 5)
      .map((l: any) => `${l.name} (${l.leadLag})`)
      .join("، ");

    const signalsText = (Array.isArray(emergingSignals) ? emergingSignals : [])
      .slice(0, 6)
      .join(" | ");

    const sys =
      "تو تحلیلگر ارشد اتاق وضعیت رسانه هستی. بر اساس توپولوژی فعلی گراف رسانه، یک گزارش مدیریتی یک‌صفحه‌ای و ساختاریافته به فارسی تولید کن. " +
      "فقط یک شیء JSON معتبر برگردان با ساختار دقیق زیر:\n" +
      "{\n" +
      '  "headline": "تیتر مدیریتی گزارش وضعیت گراف",\n' +
      '  "executiveSummary": "یک پاراگراف تحلیلی از آرایش کلی فضای رسانه‌ای در ساعت اخیر",\n' +
      '  "dominantClusters": [\n' +
      '    {"title": "عنوان خوشه", "origin": "منبع اولیه", "reach": 0, "analysis": "تحلیل چرایی اهمیت و جهت‌گیری این خوشه"}\n' +
      "  ],\n" +
      '  "keyInfluencersAndBridges": [\n' +
      '    {"name": "نام رسانه", "role": "نقش در شبکه (پیشتاز / پل ارتباطی / جریان‌ساز)", "insight": "توضیح نقش این رسانه در انتقال یا شکل‌دهی خبر"}\n' +
      "  ],\n" +
      '  "emergingWeakSignals": ["سیگنال نوظهور ۱", "سیگنال نوظهور ۲", "سیگنال نوظهور ۳"],\n' +
      '  "blindspotAlert": "تحلیل شکاف پوششی و نقاط کور بین رسانه‌های داخلی و بین‌المللی"\n' +
      "}";

    const user =
      `آمار شبکه: ${stats.articles || 0} مقاله، ${stats.clusters || 0} خوشه، ${stats.sources || 0} رسانه فعال، ${syndicationCount} شبکه بازنشر هم‌زمان.\n` +
      `خوشه‌های غالب:\n${clustersText || "—"}\n\n` +
      `پل‌های ارتباطی (Betweenness): ${bridgesText || "—"}\n` +
      `رسانه‌های پیشتاز زمانی (Lead-Lag): ${leadersText || "—"}\n` +
      `وضعیت نقاط کور: ${blindspotSummary || "—"}\n` +
      `سیگنال‌های نوظهور: ${signalsText || "—"}`;

    const reply = await aiChat(
      [{ role: "system", content: sys }, { role: "user", content: user }],
      { maxTokens: 2200, temperature: 0.35, userId: studioUser(c) },
    );

    const parsed = extractJson(reply);
    return c.json({
      brief: {
        headline: String(parsed.headline || "گزارش تحلیلی وضعیت گراف رسانه").trim(),
        executiveSummary: String(parsed.executiveSummary || "").trim(),
        dominantClusters: Array.isArray(parsed.dominantClusters)
          ? parsed.dominantClusters.slice(0, 3).map((d: any) => ({
              title: String(d?.title || "").trim(),
              origin: String(d?.origin || "").trim(),
              reach: Number(d?.reach || 0),
              analysis: String(d?.analysis || "").trim(),
            }))
          : [],
        keyInfluencersAndBridges: Array.isArray(parsed.keyInfluencersAndBridges)
          ? parsed.keyInfluencersAndBridges.slice(0, 5).map((k: any) => ({
              name: String(k?.name || "").trim(),
              role: String(k?.role || "").trim(),
              insight: String(k?.insight || "").trim(),
            }))
          : [],
        emergingWeakSignals: Array.isArray(parsed.emergingWeakSignals)
          ? parsed.emergingWeakSignals.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 5)
          : [],
        blindspotAlert: String(parsed.blindspotAlert || "").trim(),
        generatedAt: Date.now(),
      },
    });
  } catch (e) {
    return c.json({ fallback: true, error: String(e) }, 200);
  }
});

// ───────────────────── FREE MACHINE TRANSLATION ─────────────────────
// Key-free, unlimited translation engine used for on-demand translation of
// non-Persian news (titles + full content). Primary: Google's public endpoint;
// fallback: Lingva (a Google proxy). Results are cached permanently in KV so a
// repeated title/article is returned instantly and for free. The token-based AI
// is only used as a last resort if every free engine fails.

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function googleFree(text: string, to: string): Promise<string> {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`google ${r.status}`);
  const data = await r.json();
  const segs = Array.isArray(data?.[0]) ? data[0] : [];
  const out = segs.map((seg: any) => (Array.isArray(seg) ? String(seg[0] || "") : "")).join("");
  if (!out.trim()) throw new Error("google empty");
  return out;
}

async function lingvaFree(text: string, to: string): Promise<string> {
  const bases = ["https://lingva.ml", "https://translate.plausibility.cloud"];
  for (const base of bases) {
    try {
      const r = await fetch(`${base}/api/v1/auto/${encodeURIComponent(to)}/${encodeURIComponent(text)}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const t = String(data?.translation || "");
      if (t.trim()) return t;
    } catch { /* try next mirror */ }
  }
  throw new Error("lingva failed");
}

// Translate arbitrarily long text by splitting on sentence boundaries (~4500
// chars per request, the safe limit for the public endpoint).
async function freeTranslate(text: string, to = "fa"): Promise<string> {
  const src = String(text || "");
  if (!src.trim()) return "";
  const CHUNK = 4500;
  const chunks: string[] = [];
  if (src.length <= CHUNK) {
    chunks.push(src);
  } else {
    let buf = "";
    for (const part of src.split(/(?<=[.!?؟\n])\s+/)) {
      if ((buf + " " + part).length > CHUNK && buf) { chunks.push(buf); buf = part; }
      else buf = buf ? buf + " " + part : part;
    }
    if (buf) chunks.push(buf);
  }
  const out: string[] = [];
  for (const ch of chunks) {
    let done = "";
    try { done = await googleFree(ch, to); }
    catch (e1) {
      try { done = await lingvaFree(ch, to); }
      catch (e2) { console.log("free translate chunk failed:", String(e1), String(e2)); throw e2; }
    }
    out.push(done);
  }
  return out.join(" ");
}

// Cache-first translate: KV cache → free engine → AI fallback. Always caches.
async function cachedTranslate(text: string, to: string, userId?: string): Promise<string> {
  const src = String(text || "");
  if (!src.trim()) return src;
  const key = `tr2:${to}:${src.length}:${simpleHash(src)}`;
  try {
    const cached = await kv.get(key);
    if (typeof cached === "string" && cached) return cached;
  } catch { /* ignore cache read errors */ }

  let tr = "";
  try {
    tr = await freeTranslate(src, to);
  } catch {
    // Last resort: token-based AI (only when every free engine failed).
    try {
      const target = to === "fa" ? "فارسی" : "انگلیسی";
      tr = await aiChat(
        [
          { role: "system", content: `تو یک مترجم حرفه‌ای هستی. متن ورودی را به ${target} ترجمه کن و فقط متن ترجمه‌شده را با حفظ پاراگراف‌بندی برگردان.` },
          { role: "user", content: clampText(src, 8000) },
        ],
        { maxTokens: 2000, temperature: 0.2, userId },
      );
    } catch (e) { console.log("translate AI fallback failed:", String(e)); tr = ""; }
  }

  if (tr && tr.trim()) {
    try { await kv.set(key, tr); } catch { /* ignore cache write errors */ }
    return tr;
  }
  return src; // give back the original rather than an empty string
}

// Run async tasks with a bounded concurrency pool.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

app.post(`${BASE}/ai/translate`, async (c) => {
  try {
    const { text = "", to = "fa" } = await c.req.json();
    const src = clampText(String(text || ""), 20000);
    if (!src.trim()) return c.json({ text: "" });
    const target = to === "en" ? "en" : "fa";
    const translated = await cachedTranslate(src, target, studioUser(c));
    return c.json({ text: translated });
  } catch (e) {
    console.log("ai/translate error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// Extract a JSON array from a model reply that may be fenced or padded.
function extractJsonArray(text: string): any[] {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  const parsed = JSON.parse(t);
  return Array.isArray(parsed) ? parsed : [];
}

// Batch-translate many short strings (e.g. headlines). Each item goes through
// the free engine + KV cache (cachedTranslate), run with bounded concurrency.
app.post(`${BASE}/ai/translate-batch`, async (c) => {
  try {
    const { texts = [], to = "fa" } = await c.req.json();
    const arr = (Array.isArray(texts) ? texts : []).map((t) => String(t || "")).slice(0, 50);
    if (arr.length === 0) return c.json({ texts: [] });
    const target = to === "en" ? "en" : "fa";
    const uid = studioUser(c);
    const results = await mapPool(arr, 6, (t) => (t.trim() ? cachedTranslate(t, target, uid) : Promise.resolve(t)));
    return c.json({ texts: results });
  } catch (e) {
    console.log("ai/translate-batch error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// ───────────────────────── CONTENT STUDIO ─────────────────────────
// Brand profile, content templates, AI draft composer, and draft storage.
// Data is namespaced per client/user id (sent by the frontend).

const PLATFORMS = ["twitter", "instagram", "linkedin", "telegram", "rubika", "bale", "eitaa", "website"] as const;
type Platform = typeof PLATFORMS[number];

const PLATFORM_RULES: Record<Platform, string> = {
  twitter: "حداکثر ۲۸۰ کاراکتر، لحن جمع‌وجور و قلاب‌دار، حداکثر ۳ هشتگ مرتبط، بدون عنوان جدا.",
  instagram: "کپشن جذاب با یک قلاب قوی در خط اول، چند خط توضیح، ۵ تا ۱۰ هشتگ در انتها، استفادهٔ ملایم از ایموجی.",
  linkedin: "پست تحلیلی و حرفه‌ای برای لینکدین، شروع با یک بینش کلیدی، ۳ تا ۴ بولت تحلیلی از پیامدها، لحن کارشناسی و ۳ تا ۵ هشتگ تخصصی.",
  telegram: "پیام کانال با تیتر پررنگ (با *)، چند خط خلاصه، در پایان یک خط منبع/لینک. قالب مارک‌داون تلگرام.",
  rubika: "پیام کوتاه و خوانا برای کانال روبیکا، تیتر در خط اول، خلاصهٔ کوتاه، بدون مارک‌داون پیچیده.",
  bale: "پیام کانال بله، تیتر در خط اول، خلاصهٔ کوتاه و رسمی‌تر، در پایان خط منبع.",
  eitaa: "پیام کانال ایتا با تیتر روشن در سطر اول، بولت‌بندی منظم، لحن خبری روان و درج منبع در پایان.",
  website: "خبر کامل برای وبلاگ/سایت: یک تیتر، یک لید کوتاه، و بدنهٔ چندپاراگرافی. خروجی به‌صورت متن ساده با پاراگراف‌بندی.",
};

function studioUser(c: any): string {
  const u = c.req.query("u") || "";
  return String(u || "anon").slice(0, 120);
}

const brandKey = (u: string) => `studio:brand:${u}`;
const templatesKey = (u: string) => `studio:templates:${u}`;
const draftsKey = (u: string) => `studio:drafts:${u}`;
const styleKey = (u: string) => `studio:style:${u}`;
const stylesKey = (u: string) => `studio:styles:${u}`;

// ── Brand profile ──
app.get(`${BASE}/studio/brand`, async (c) => {
  const u = studioUser(c);
  const brand = (await kv.get(brandKey(u))) || null;
  return c.json({ brand });
});

app.post(`${BASE}/studio/brand`, async (c) => {
  try {
    const u = studioUser(c);
    const body = await c.req.json();
    const brand = {
      name: String(body.name || "").slice(0, 120),
      tagline: String(body.tagline || "").slice(0, 200),
      tone: String(body.tone || "حرفه‌ای و بی‌طرف").slice(0, 120),
      audience: String(body.audience || "").slice(0, 200),
      language: body.language === "en" ? "en" : "fa",
      signature: String(body.signature || "").slice(0, 200),
      hashtags: Array.isArray(body.hashtags) ? body.hashtags.map((h: any) => String(h).trim()).filter(Boolean).slice(0, 15) : [],
      emoji: !!body.emoji,
      logo: String(body.logo || "").slice(0, 1000),
      styleGuide: String(body.styleGuide || "").slice(0, 1500),
      updatedAt: Date.now(),
    };
    await kv.set(brandKey(u), brand);
    return c.json({ brand });
  } catch (e) {
    console.log("studio/brand save error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// ── Style analysis (Phase 1: RSS/news sites + public Telegram channels) ──
async function fetchText(url: string, timeoutMs = 15000): Promise<{ ok: boolean; status: number; body: string; contentType: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FlowStudioBot/1.0)", Accept: "*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body, contentType: r.headers.get("content-type") || "" };
  } finally {
    clearTimeout(timer);
  }
}

function htmlToText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&zwnj;/gi, "‌")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseTelegram(html: string): string[] {
  const out: string[] = [];
  const re = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 40) {
    const txt = htmlToText(m[1]);
    if (txt && txt.length > 5) out.push(txt);
  }
  return out;
}

function decodeXml(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function parseFeed(xml: string): string[] {
  const items: string[] = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = b.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
    const desc =
      b.match(/<(?:content:encoded)[^>]*>([\s\S]*?)<\/content:encoded>/i)?.[1] ||
      b.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1] || "";
    const t = htmlToText(decodeXml(title));
    const d = htmlToText(decodeXml(desc));
    const combined = [t, d].filter(Boolean).join(" — ");
    if (combined.length > 8) items.push(combined);
    if (items.length >= 40) break;
  }
  return items;
}

function findFeedUrl(html: string, baseUrl: string): string | null {
  const links = html.match(/<link[^>]+>/gi) || [];
  for (const l of links) {
    if (/type=["']application\/(?:rss|atom)\+xml["']/i.test(l)) {
      const href = l.match(/href=["']([^"']+)["']/i)?.[1];
      if (href) { try { return new URL(href, baseUrl).toString(); } catch { /* ignore */ } }
    }
  }
  return null;
}

app.post(`${BASE}/studio/analyze-source`, async (c) => {
  try {
    const u = studioUser(c);
    const body = await c.req.json();
    let url = String(body.url || "").trim();
    if (!url) return c.json({ error: "لینک منبع لازم است" }, 400);
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    let samples: string[] = [];
    let type = "";

    const tg = url.match(/(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{3,})/i);
    if (tg) {
      type = "telegram";
      const r = await fetchText(`https://t.me/s/${tg[1]}`);
      if (!r.ok) return c.json({ error: `دسترسی به کانال تلگرام ناموفق بود (${r.status})` }, 400);
      samples = parseTelegram(r.body);
      if (samples.length === 0) return c.json({ error: "پستی در نسخهٔ عمومی این کانال یافت نشد (ممکن است خصوصی باشد)." }, 400);
    } else {
      const r = await fetchText(url);
      if (!r.ok) return c.json({ error: `دریافت منبع ناموفق بود (${r.status})` }, 400);
      const head = r.body.slice(0, 3000);
      const looksFeed = /<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(head) || r.contentType.includes("xml");
      if (looksFeed) {
        type = "rss";
        samples = parseFeed(r.body);
      } else {
        const feedUrl = findFeedUrl(r.body, url);
        if (feedUrl) {
          const fr = await fetchText(feedUrl);
          if (fr.ok) { type = "rss"; samples = parseFeed(fr.body); }
        }
        if (samples.length === 0) {
          type = "web";
          const text = htmlToText(r.body);
          samples = text.split(/\n{2,}/).map((s) => s.trim()).filter((s) => s.length > 60).slice(0, 20);
          if (samples.length === 0 && text.length > 60) samples = [text.slice(0, 4000)];
        }
      }
      if (samples.length === 0) return c.json({ error: "محتوایی برای تحلیل از این منبع استخراج نشد." }, 400);
    }

    samples = samples.slice(0, 30).map((s) => clampText(s, 600));
    const corpus = clampText(samples.map((s, i) => `(${i + 1}) ${s}`).join("\n\n"), 8000);

    const sys =
      "تو یک تحلیل‌گر حرفه‌ای سبک محتوا هستی. مجموعه‌ای از پست‌ها/تیترهای یک منبع به تو داده می‌شود؛ سبک، لحن، ساختار، ادبیات و راهبرد تولید محتوای آن را تحلیل کن. " +
      "خروجی را فقط به‌صورت یک شیء JSON معتبر بده، بدون هیچ توضیح اضافه. همهٔ مقادیر متنی به فارسی باشند. " +
      "ساختار دقیق: {\"summary\":string,\"tone\":string,\"audience\":string,\"language\":\"fa\"|\"en\",\"styleGuide\":string,\"structure\":string,\"hashtags\":string[],\"emojiUsage\":string,\"signature\":string,\"dos\":string[],\"donts\":string[],\"topics\":string[],\"exemplars\":string[]}. " +
      "hashtags بدون علامت #. styleGuide یک پاراگراف کاربردی برای تقلید سبک. exemplars دو تا سه نمونهٔ کوتاهِ نمایندهٔ سبک.";
    const usr = `منبع: ${url}\nنوع: ${type}\nتعداد نمونه: ${samples.length}\n\nنمونه‌ها:\n${corpus}`;

    const reply = await aiChat(
      [{ role: "system", content: sys }, { role: "user", content: usr }],
      { userId: u, maxTokens: 1200, temperature: 0.2 },
    );

    let profile: any;
    try {
      profile = extractJson(reply);
    } catch {
      return c.json({ error: "پاسخ مدل قابل‌خواندن نبود؛ دوباره تلاش کن." }, 502);
    }

    const result = { source: url, type, sampleCount: samples.length, profile, updatedAt: Date.now() };
    await kv.set(styleKey(u), result);
    // Upsert into the analyzed-sources library (dedupe by source, newest first, cap 8).
    const lib: any[] = (await kv.get(stylesKey(u))) || [];
    const next = [result, ...lib.filter((x) => x?.source !== url)].slice(0, 8);
    await kv.set(stylesKey(u), next);
    return c.json(result);
  } catch (e) {
    console.log("studio/analyze-source error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

app.get(`${BASE}/studio/style`, async (c) => {
  const u = studioUser(c);
  const style = (await kv.get(styleKey(u))) || null;
  return c.json({ style });
});

// Library of analyzed sources.
app.get(`${BASE}/studio/styles`, async (c) => {
  const u = studioUser(c);
  const styles = (await kv.get(stylesKey(u))) || [];
  return c.json({ styles });
});

app.delete(`${BASE}/studio/styles`, async (c) => {
  const u = studioUser(c);
  const source = c.req.query("source") || "";
  const lib: any[] = (await kv.get(stylesKey(u))) || [];
  const next = lib.filter((x) => x?.source !== source);
  await kv.set(stylesKey(u), next);
  return c.json({ styles: next });
});

// Blend 2–4 analyzed styles into one cohesive style profile.
app.post(`${BASE}/studio/blend-styles`, async (c) => {
  try {
    const u = studioUser(c);
    const { sources } = await c.req.json();
    if (!Array.isArray(sources) || sources.length < 2) return c.json({ error: "حداقل دو منبع انتخاب کن" }, 400);
    const lib: any[] = (await kv.get(stylesKey(u))) || [];
    const picked = lib.filter((x) => sources.includes(x?.source)).slice(0, 4);
    if (picked.length < 2) return c.json({ error: "منابع انتخاب‌شده یافت نشدند" }, 400);

    const profilesText = picked
      .map((p, i) => `منبع ${i + 1} (${p.source}):\n${JSON.stringify(p.profile)}`)
      .join("\n\n");
    const sys =
      "تو یک تحلیل‌گر حرفه‌ای سبک محتوا هستی. چند «پروفایل سبک» به تو داده می‌شود؛ آن‌ها را در یک سبکِ تلفیقیِ منسجم ترکیب کن که بهترین ویژگی‌های مشترک را بگیرد و تناقض‌ها را متوازن کند. " +
      "خروجی را فقط به‌صورت یک شیء JSON معتبر با همین ساختار بده، بدون توضیح اضافه. همهٔ مقادیر متنی فارسی. " +
      "{\"summary\":string,\"tone\":string,\"audience\":string,\"language\":\"fa\"|\"en\",\"styleGuide\":string,\"structure\":string,\"hashtags\":string[],\"emojiUsage\":string,\"signature\":string,\"dos\":string[],\"donts\":string[],\"topics\":string[],\"exemplars\":string[]}.";
    const usr = `پروفایل‌ها برای ترکیب:\n${clampText(profilesText, 7000)}`;

    const reply = await aiChat(
      [{ role: "system", content: sys }, { role: "user", content: usr }],
      { userId: u, maxTokens: 1200, temperature: 0.3 },
    );
    let profile: any;
    try { profile = extractJson(reply); } catch { return c.json({ error: "پاسخ مدل قابل‌خواندن نبود؛ دوباره تلاش کن." }, 502); }

    const hostOf = (s: string) => { try { return new URL(s).hostname.replace(/^www\./, ""); } catch { return s; } };
    const label = "ترکیب: " + picked.map((p) => hostOf(p.source)).join(" + ");
    const result = {
      source: label, type: "blend",
      sampleCount: picked.reduce((a, p) => a + (Number(p.sampleCount) || 0), 0),
      profile, updatedAt: Date.now(),
    };
    await kv.set(styleKey(u), result);
    const next = [result, ...lib.filter((x) => x?.source !== label)].slice(0, 8);
    await kv.set(stylesKey(u), next);
    return c.json(result);
  } catch (e) {
    console.log("studio/blend-styles error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// ── Templates ──
app.get(`${BASE}/studio/templates`, async (c) => {
  const u = studioUser(c);
  const templates = (await kv.get(templatesKey(u))) || [];
  return c.json({ templates });
});

app.post(`${BASE}/studio/templates`, async (c) => {
  try {
    const u = studioUser(c);
    const body = await c.req.json();
    const list: any[] = (await kv.get(templatesKey(u))) || [];
    const tpl = {
      id: body.id || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: String(body.name || "قالب بدون نام").slice(0, 120),
      platforms: Array.isArray(body.platforms) ? body.platforms.filter((p: any) => PLATFORMS.includes(p)) : ["telegram"],
      structure: String(body.structure || "").slice(0, 2000),
      maxLength: Number(body.maxLength) || 0,
      includeLink: body.includeLink !== false,
      includeSource: body.includeSource !== false,
      cardTheme: ["dark", "light", "editorial"].includes(body.cardTheme) ? body.cardTheme : "dark",
      cardRatio: ["square", "story", "wide"].includes(body.cardRatio) ? body.cardRatio : "square",
      updatedAt: Date.now(),
    };
    const idx = list.findIndex((t) => t.id === tpl.id);
    if (idx >= 0) list[idx] = tpl; else list.push(tpl);
    await kv.set(templatesKey(u), list);
    return c.json({ templates: list });
  } catch (e) {
    console.log("studio/templates save error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

app.delete(`${BASE}/studio/templates/:id`, async (c) => {
  const u = studioUser(c);
  const id = c.req.param("id");
  const list: any[] = (await kv.get(templatesKey(u))) || [];
  await kv.set(templatesKey(u), list.filter((t) => t.id !== id));
  return c.json({ ok: true });
});

// ── Drafts ──
app.get(`${BASE}/studio/drafts`, async (c) => {
  const u = studioUser(c);
  const drafts = (await kv.get(draftsKey(u))) || [];
  return c.json({ drafts });
});

app.post(`${BASE}/studio/drafts`, async (c) => {
  try {
    const u = studioUser(c);
    const body = await c.req.json();
    const list: any[] = (await kv.get(draftsKey(u))) || [];
    const VALID_STATUS = ["draft", "approved", "scheduled", "published"];
    const draft = {
      id: body.id || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId: u,
      title: String(body.title || "پیش‌نویس").slice(0, 200),
      sourceTitle: String(body.sourceTitle || "").slice(0, 300),
      sourceLink: String(body.sourceLink || "").slice(0, 600),
      image: String(body.image || "").slice(0, 1000),
      images: Array.isArray(body.images) ? body.images.map((s: any) => String(s)).filter(Boolean).slice(0, 10) : [],
      cardTheme: ["dark", "light", "editorial"].includes(body.cardTheme) ? body.cardTheme : "",
      cardRatio: ["square", "story", "wide"].includes(body.cardRatio) ? body.cardRatio : "",
      outputs: body.outputs && typeof body.outputs === "object" ? body.outputs : {},
      status: VALID_STATUS.includes(body.status) ? body.status : "draft",
      scheduledAt: Number(body.scheduledAt) || 0,
      scheduleTargets: Array.isArray(body.scheduleTargets) ? body.scheduleTargets.filter((p: any) => ["telegram", "bale", "rubika", "website", "twitter", "instagram"].includes(p)) : [],
      auto: !!body.auto,
      updatedAt: Date.now(),
      createdAt: body.createdAt || Date.now(),
    };
    const idx = list.findIndex((d) => d.id === draft.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...draft }; else list.unshift(draft);
    await kv.set(draftsKey(u), list.slice(0, 200));
    return c.json({ draft });
  } catch (e) {
    console.log("studio/drafts save error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

app.delete(`${BASE}/studio/drafts/:id`, async (c) => {
  const u = studioUser(c);
  const id = c.req.param("id");
  const list: any[] = (await kv.get(draftsKey(u))) || [];
  await kv.set(draftsKey(u), list.filter((d) => d.id !== id));
  return c.json({ ok: true });
});

// Reusable composer: turns a source item into per-platform branded content.
async function composeOutputs(
  brand: any, template: any, source: any, platformsIn: Platform[], userId?: string,
): Promise<Record<string, { text: string; hashtags: string[] }>> {
  const platforms = platformsIn.length ? platformsIn : ["telegram"];
  const lang = brand.language === "en" ? "English" : "Persian (Farsi)";
  const rulesBlock = platforms.map((p: Platform) => `- ${p}: ${PLATFORM_RULES[p]}`).join("\n");

  const sys =
    `You are a social-media content writer for a news brand. Rewrite the source news into ready-to-post content for each requested platform. ` +
    `Write in ${lang}. Match the brand voice. Never copy the source verbatim — paraphrase and add value. Be factual; do not invent facts not present in the source. ` +
    `Respond ONLY with a valid JSON object of the exact shape: {"outputs": {"<platform>": {"text": string, "hashtags": string[]}}}. No prose, no code fences.`;

  const brandBlock =
    `Brand name: ${brand.name || "—"}\n` +
    `Tagline: ${brand.tagline || "—"}\n` +
    `Tone: ${brand.tone || "professional, neutral"}\n` +
    `Audience: ${brand.audience || "general"}\n` +
    `Fixed signature: ${brand.signature || "—"}\n` +
    `Preferred hashtags: ${(brand.hashtags || []).join(" ") || "—"}\n` +
    `Use emoji: ${brand.emoji ? "yes, sparingly" : "no"}` +
    (brand.styleGuide ? `\nStyle guide to emulate (voice, structure, literary style): ${brand.styleGuide}` : "");

  const tplBlock = template.structure
    ? `Author template/structure to follow (placeholders like {{title}},{{summary}},{{bullets}},{{source}},{{link}} may appear): ${template.structure}\n` +
      `Include link: ${template.includeLink !== false}. Include source name: ${template.includeSource !== false}.` +
      (template.maxLength ? ` Max length hint: ${template.maxLength} chars.` : "")
    : "No custom template; use sensible defaults per platform.";

  const srcBlock =
    `SOURCE TITLE: ${source.title || ""}\n` +
    `SOURCE NAME: ${source.source || ""}\n` +
    `SOURCE LINK: ${source.link || ""}\n` +
    `SOURCE BODY:\n${clampText(String(source.content || ""), 5000)}`;

  const user =
    `PLATFORMS AND RULES:\n${rulesBlock}\n\nBRAND:\n${brandBlock}\n\nTEMPLATE:\n${tplBlock}\n\n${srcBlock}`;

  const reply = await aiChat(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 1600, temperature: 0.6, userId },
  );

  const parsed = extractJson(reply);
  const outputs: Record<string, { text: string; hashtags: string[] }> = {};
  const raw = parsed.outputs || parsed;
  for (const p of platforms) {
    const o = raw?.[p] || {};
    outputs[p] = {
      text: String(o.text || "").trim(),
      hashtags: Array.isArray(o.hashtags) ? o.hashtags.map((h: any) => String(h).trim()).filter(Boolean).slice(0, 12) : [],
    };
  }
  return outputs;
}

// Reusable digest composer: combines several items into one per-platform post.
async function composeDigestOutputs(
  brand: any, template: any, sources: any[], platformsIn: Platform[], userId?: string,
): Promise<Record<string, { text: string; hashtags: string[] }>> {
  const platforms = platformsIn.length ? platformsIn : ["telegram"];
  const lang = brand.language === "en" ? "English" : "Persian (Farsi)";
  const rulesBlock = platforms.map((p: Platform) => `- ${p}: ${PLATFORM_RULES[p]}`).join("\n");

  const sys =
    `You are a news-brand editor creating a single digest/roundup post that summarizes several news items together. ` +
    `Write in ${lang}. Match the brand voice. Produce a cohesive digest with a short intro and a concise bulleted list of the items (one line each, paraphrased — never copy verbatim). Be factual. ` +
    `Respond ONLY with a valid JSON object: {"outputs": {"<platform>": {"text": string, "hashtags": string[]}}}. No prose, no code fences.`;

  const brandBlock =
    `Brand name: ${brand.name || "—"}\nTone: ${brand.tone || "professional"}\nAudience: ${brand.audience || "general"}\n` +
    `Signature: ${brand.signature || "—"}\nPreferred hashtags: ${(brand.hashtags || []).join(" ") || "—"}\nUse emoji: ${brand.emoji ? "yes, sparingly" : "no"}` +
    (brand.styleGuide ? `\nStyle guide to emulate: ${brand.styleGuide}` : "");

  const itemsBlock = sources.slice(0, 12).map((s, i) =>
    `[${i + 1}] ${s.title || ""}${s.source ? ` — ${s.source}` : ""}\n${clampText(String(s.content || ""), 900)}`,
  ).join("\n\n");

  const user = `PLATFORMS AND RULES:\n${rulesBlock}\n\nBRAND:\n${brandBlock}\n\nITEMS (${sources.length}):\n${itemsBlock}`;

  const reply = await aiChat(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    { maxTokens: 1800, temperature: 0.6, userId },
  );

  const parsed = extractJson(reply);
  const outputs: Record<string, { text: string; hashtags: string[] }> = {};
  const raw = parsed.outputs || parsed;
  for (const p of platforms) {
    const o = raw?.[p] || {};
    outputs[p] = {
      text: String(o.text || "").trim(),
      hashtags: Array.isArray(o.hashtags) ? o.hashtags.map((h: any) => String(h).trim()).filter(Boolean).slice(0, 12) : [],
    };
  }
  return outputs;
}

app.post(`${BASE}/studio/compose-digest`, async (c) => {
  try {
    const body = await c.req.json();
    const brand = body.brand || {};
    const template = body.template || {};
    const sources = Array.isArray(body.sources) ? body.sources : [];
    const requested: Platform[] = (Array.isArray(body.platforms) ? body.platforms : []).filter((p: any) => PLATFORMS.includes(p));
    const platforms = requested.length ? requested : (template.platforms?.length ? template.platforms : ["telegram"]);
    if (sources.length < 2) return c.json({ error: "حداقل دو خبر برای خلاصه لازم است" }, 400);

    let outputs;
    try {
      outputs = await composeDigestOutputs(brand, template, sources, platforms, studioUser(c));
    } catch (e) {
      console.log("studio/compose-digest failed:", String(e));
      return c.json({ error: "AI digest failed", detail: String(e).slice(0, 300) }, 502);
    }
    return c.json({ outputs });
  } catch (e) {
    console.log("studio/compose-digest error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// ── AI compose: turn a source item into per-platform branded content ──
app.post(`${BASE}/studio/compose`, async (c) => {
  try {
    const body = await c.req.json();
    const brand = body.brand || {};
    const template = body.template || {};
    const source = body.source || {};
    const requested: Platform[] = (Array.isArray(body.platforms) ? body.platforms : [])
      .filter((p: any) => PLATFORMS.includes(p));
    const platforms = requested.length ? requested : (template.platforms?.length ? template.platforms : ["telegram"]);

    if (!source.title && !source.content) {
      return c.json({ error: "source title or content required" }, 400);
    }

    let outputs;
    try {
      outputs = await composeOutputs(brand, template, source, platforms, studioUser(c));
    } catch (e) {
      console.log("studio/compose failed:", String(e));
      return c.json({ error: "AI compose failed", detail: String(e).slice(0, 300) }, 502);
    }
    return c.json({ outputs });
  } catch (e) {
    console.log("studio/compose error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// Rewrite/regenerate a single platform's text into a fresh alternative.
app.post(`${BASE}/studio/rewrite`, async (c) => {
  try {
    const body = await c.req.json();
    const brand = body.brand || {};
    const platform = String(body.platform || "telegram") as Platform;
    const text = clampText(String(body.text || ""), 4000);
    const instruction = String(body.instruction || "").slice(0, 300);
    if (!text.trim()) return c.json({ error: "متن لازم است" }, 400);

    const lang = brand.language === "en" ? "English" : "Persian (Farsi)";
    const rule = PLATFORM_RULES[platform] || "";
    const sys =
      `You are a social-media editor. Rewrite the given post into a fresh, distinct alternative for the "${platform}" platform. ` +
      `Write in ${lang}. Keep the same facts and meaning but vary wording, hook and structure. Respect this platform rule: ${rule}. ` +
      (instruction ? `Extra instruction: ${instruction}. ` : "") +
      `Match brand voice — tone: ${brand.tone || "professional"}; signature: ${brand.signature || "—"}; use emoji: ${brand.emoji ? "yes, sparingly" : "no"}. ` +
      `Respond ONLY with valid JSON: {"text": string, "hashtags": string[]}. No prose, no code fences.`;

    const reply = await aiChat(
      [{ role: "system", content: sys }, { role: "user", content: text }],
      { maxTokens: 800, temperature: 0.85, userId: studioUser(c) },
    );
    let parsed: any;
    try { parsed = extractJson(reply); }
    catch { return c.json({ error: "AI returned malformed JSON", raw: reply.slice(0, 200) }, 502); }

    return c.json({
      text: String(parsed.text || "").trim(),
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map((h: any) => String(h).trim()).filter(Boolean).slice(0, 12) : [],
    });
  } catch (e) {
    console.log("studio/rewrite error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// ───────────── PUBLISHING: Telegram, Bale, Rubika, Website ─────────────
// Credentials live only on the server (KV) and are never returned to the client.

type PublishPlatform = "telegram" | "bale" | "rubika" | "website" | "twitter" | "instagram";

const connKey = (u: string) => `studio:conn:${u}`;
const pubLogKey = (u: string) => `studio:publog:${u}`;

function botApiBase(platform: "telegram" | "bale", token: string): string {
  return platform === "telegram"
    ? `https://api.telegram.org/bot${token}`
    : `https://tapi.bale.ai/bot${token}`;
}

async function httpFetch(url: string, init?: RequestInit, timeoutMs = 20000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const raw = await res.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch { /* keep raw */ }
    return { ok: res.ok, status: res.status, data, raw };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSiteUrl(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "");
}

/** Return connections without exposing secrets (token / appPassword). */
function sanitizeConns(conns: any): any {
  const out: any = {};
  for (const p of Object.keys(conns || {})) {
    const cn = conns[p] || {};
    const connected = p === "website" ? !!cn.url : !!cn.token;
    out[p] = {
      connected,
      chatId: cn.chatId || "",
      botName: cn.botName || "",
      url: cn.url || "",
      mode: cn.mode || "",
      verifiedAt: cn.verifiedAt || 0,
    };
  }
  return out;
}

// Verify and build a stored connection config for a platform.
async function verifyAndBuild(platform: PublishPlatform, body: any): Promise<{ ok: boolean; config?: any; label?: string; error?: string }> {
  if (platform === "telegram" || platform === "bale") {
    if (!body.token || !body.chatId) return { ok: false, error: "توکن و شناسهٔ کانال لازم است" };
    const me = await httpFetch(`${botApiBase(platform, body.token)}/getMe`);
    if (!me.ok || !me.data?.ok) return { ok: false, error: `توکن نامعتبر است: ${me.data?.description || me.status}` };
    const botName = me.data.result?.username || me.data.result?.first_name || "bot";
    return { ok: true, label: botName, config: { token: body.token, chatId: String(body.chatId), botName, verifiedAt: Date.now() } };
  }
  if (platform === "rubika") {
    if (!body.token || !body.chatId) return { ok: false, error: "توکن و شناسهٔ کانال لازم است" };
    // Rubika Bot API. getMe may not always be available; tolerate and store.
    let botName = "rubika-bot";
    try {
      const me = await httpFetch(`https://botapi.rubika.ir/v3/${body.token}/getMe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (me.data?.data?.bot?.username) botName = me.data.data.bot.username;
      else if (me.data?.status && me.data.status !== "OK") return { ok: false, error: `توکن روبیکا نامعتبر است: ${me.data.status}` };
    } catch { /* tolerate verify failure; will surface on first publish */ }
    return { ok: true, label: botName, config: { token: body.token, chatId: String(body.chatId), botName, verifiedAt: Date.now() } };
  }
  if (platform === "website") {
    const mode = body.mode === "webhook" ? "webhook" : "wordpress";
    const url = normalizeSiteUrl(body.url);
    if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: "آدرس سایت معتبر نیست (با http/https شروع شود)" };
    if (mode === "wordpress") {
      if (!body.username || !body.appPassword) return { ok: false, error: "نام کاربری و رمز برنامه (Application Password) لازم است" };
      const auth = "Basic " + btoa(`${body.username}:${body.appPassword}`);
      const me = await httpFetch(`${url}/wp-json/wp/v2/users/me`, { headers: { Authorization: auth } });
      if (!me.ok) return { ok: false, error: `اتصال وردپرس ناموفق بود (${me.status}). آدرس و رمز برنامه را بررسی کن.` };
      return { ok: true, label: me.data?.name || "wordpress", config: { mode, url, username: body.username, appPassword: body.appPassword, botName: me.data?.name || "wordpress", verifiedAt: Date.now() } };
    }
    // webhook: cannot safely probe arbitrary endpoints; accept after URL validation.
    return { ok: true, label: "webhook", config: { mode, url, botName: "webhook", verifiedAt: Date.now() } };
  }
  if (platform === "twitter") {
    if (!body.token) return { ok: false, error: "توکن دسترسی توییتر (OAuth2 با scope نوشتن توییت) لازم است" };
    const me = await httpFetch("https://api.twitter.com/2/users/me", { headers: { Authorization: `Bearer ${body.token}` } });
    if (!me.ok || !me.data?.data?.id) return { ok: false, error: `توکن نامعتبر یا دسترسی ناکافی: ${me.data?.title || me.data?.detail || me.status}` };
    const uname = me.data.data.username || "twitter";
    return { ok: true, label: uname, config: { token: body.token, botName: uname, verifiedAt: Date.now() } };
  }
  if (platform === "instagram") {
    if (!body.token || !body.igUserId) return { ok: false, error: "توکن دسترسی و شناسهٔ اکانت اینستاگرام (IG Business) لازم است" };
    const me = await httpFetch(`https://graph.facebook.com/v19.0/${body.igUserId}?fields=username&access_token=${encodeURIComponent(body.token)}`);
    if (!me.ok || !me.data?.id) return { ok: false, error: `اتصال اینستاگرام ناموفق: ${me.data?.error?.message || me.status}` };
    const uname = me.data.username || "instagram";
    return { ok: true, label: uname, config: { token: body.token, igUserId: String(body.igUserId), botName: uname, verifiedAt: Date.now() } };
  }
  return { ok: false, error: "پلتفرم پشتیبانی نمی‌شود" };
}

// Rubika image send: requestSendFile → upload bytes → sendFile (with caption).
async function sendRubikaPhoto(token: string, chatId: string, imageUrl: string, caption: string): Promise<{ ok: boolean; ref?: any; error?: string }> {
  const base = `https://botapi.rubika.ir/v3/${token}`;
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
  if (!imgRes.ok) return { ok: false, error: `image fetch ${imgRes.status}` };
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 8_000_000) return { ok: false, error: "image too large/empty" };
  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";

  const reqUp = await httpFetch(`${base}/requestSendFile`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "Image" }),
  });
  const uploadUrl = reqUp.data?.data?.upload_url || reqUp.data?.upload_url;
  if (!uploadUrl) return { ok: false, error: `no upload_url (${reqUp.data?.status || reqUp.status})` };

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), `image.${ext}`);
  const upRes = await fetch(uploadUrl, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
  const upRaw = await upRes.text();
  let upData: any = null; try { upData = JSON.parse(upRaw); } catch { /* ignore */ }
  const fileId = upData?.data?.file_id || upData?.file_id;
  if (!fileId) return { ok: false, error: `upload failed (${upRes.status})` };

  const send = await httpFetch(`${base}/sendFile`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, file_id: fileId, text: caption }),
  });
  const okRu = send.data?.status === "OK" || send.data?.status === "success";
  if (!send.ok || !okRu) return { ok: false, error: send.data?.status || `HTTP ${send.status}` };
  return { ok: true, ref: send.data?.data?.message_id };
}

// Unified sender. payload carries a full text, a title (for website), and an
// optional image URL (sent as a photo where the platform supports it).
async function sendToConnection(cn: any, platform: PublishPlatform, payload: { title: string; text: string; link?: string; imageUrl?: string; imageUrls?: string[] }): Promise<{ ok: boolean; ref?: any; error?: string }> {
  if (!cn) return { ok: false, error: "متصل نیست" };
  const img = (payload.imageUrl || "").trim();
  const album = (payload.imageUrls || []).filter(Boolean);
  if (platform === "telegram" || platform === "bale") {
    // Album (carousel) → sendMediaGroup with caption on the first item.
    if (album.length > 1) {
      const media = album.slice(0, 10).map((u, i) => ({
        type: "photo", media: u, ...(i === 0 && payload.text.length <= 1024 ? { caption: payload.text } : {}),
      }));
      const g = await httpFetch(`${botApiBase(platform, cn.token)}/sendMediaGroup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cn.chatId, media }),
      });
      if (g.ok && (g.data?.ok || Array.isArray(g.data?.result))) {
        // If caption didn't fit, follow up with the text.
        if (payload.text.length > 1024) {
          await httpFetch(`${botApiBase(platform, cn.token)}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: cn.chatId, text: payload.text }),
          });
        }
        return { ok: true, ref: g.data?.result?.[0]?.message_id };
      }
      // fall through to single photo / text on failure
    }
    // Telegram/Bale photo captions are limited to ~1024 chars; fall back to text.
    if (img && payload.text.length <= 1024) {
      const r = await httpFetch(`${botApiBase(platform, cn.token)}/sendPhoto`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cn.chatId, photo: img, caption: payload.text }),
      });
      if (r.ok && r.data?.ok) return { ok: true, ref: r.data.result?.message_id };
      // fall through to text if photo failed (e.g. bad image URL)
    }
    const r = await httpFetch(`${botApiBase(platform, cn.token)}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cn.chatId, text: payload.text }),
    });
    if (!r.ok || !r.data?.ok) return { ok: false, error: r.data?.description || `HTTP ${r.status}` };
    return { ok: true, ref: r.data.result?.message_id };
  }
  if (platform === "rubika") {
    // Album → send each image as a file (caption on the first); else single photo.
    const ruImgs = album.length > 1 ? album.slice(0, 10) : (img ? [img] : []);
    if (ruImgs.length > 0) {
      try {
        let firstRef: any = undefined;
        let anyOk = false;
        for (let i = 0; i < ruImgs.length; i++) {
          const cap = i === 0 ? payload.text : "";
          const photo = await sendRubikaPhoto(cn.token, cn.chatId, ruImgs[i], cap);
          if (photo.ok) { anyOk = true; if (i === 0) firstRef = photo.ref; }
          else console.log("rubika photo failed:", photo.error);
        }
        if (anyOk) return { ok: true, ref: firstRef };
      } catch (e) {
        console.log("rubika photo error, falling back to text:", String(e));
      }
    }
    const r = await httpFetch(`https://botapi.rubika.ir/v3/${cn.token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cn.chatId, text: payload.text }),
    });
    const okRu = r.data?.status === "OK" || r.data?.status === "success";
    if (!r.ok || !okRu) return { ok: false, error: r.data?.status || r.data?.error || `HTTP ${r.status}` };
    return { ok: true, ref: r.data?.data?.message_id };
  }
  if (platform === "website") {
    // Embed cover + any extra carousel slides into the body.
    const bodyImgs = album.length ? album : (img ? [img] : []);
    const imgHtml = bodyImgs.map((u) => `<figure><img src="${u}" alt="${payload.title || ""}"/></figure>`).join("\n") + (bodyImgs.length ? "\n" : "");
    if (cn.mode === "wordpress") {
      const auth = "Basic " + btoa(`${cn.username}:${cn.appPassword}`);
      // Upload the cover image as a real media item and set it as featured.
      let featured: number | undefined;
      const cover = bodyImgs[0];
      if (cover) {
        try { featured = await wpUploadMedia(cn.url, auth, cover, payload.title || "cover"); }
        catch (e) { console.log("wp media upload failed:", String(e)); }
      }
      const post: any = { title: payload.title || "خبر", content: imgHtml + payload.text.replace(/\n/g, "<br/>"), status: "publish" };
      if (featured) post.featured_media = featured;
      const r = await httpFetch(`${cn.url}/wp-json/wp/v2/posts`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify(post),
      }, 30000);
      if (!r.ok || !r.data?.id) return { ok: false, error: r.data?.message || `HTTP ${r.status}` };
      return { ok: true, ref: r.data.link || r.data.id };
    }
    // webhook
    const r = await httpFetch(cn.url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: payload.title, content: payload.text, image: img, images: bodyImgs, link: payload.link || "", source: "flow" }),
    }, 30000);
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, ref: "webhook" };
  }
  if (platform === "twitter") {
    // Twitter API v2 — text tweet (image upload needs v1.1/OAuth1.0a, omitted).
    const r = await httpFetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${cn.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: payload.text.slice(0, 280) }),
    });
    if (!r.ok || !r.data?.data?.id) return { ok: false, error: r.data?.detail || r.data?.title || `HTTP ${r.status}` };
    return { ok: true, ref: r.data.data.id };
  }
  if (platform === "instagram") {
    // Instagram Graph API — requires a public image URL (our signed URLs work).
    const imgs = album.length ? album.slice(0, 10) : (img ? [img] : []);
    if (imgs.length === 0) return { ok: false, error: "اینستاگرام بدون تصویر منتشر نمی‌شود؛ ابتدا کارت یا کاروسل بساز" };
    const base = `https://graph.facebook.com/v19.0/${cn.igUserId}`;
    const tok = encodeURIComponent(cn.token);
    const cap = encodeURIComponent(payload.text);
    let creationId: string | undefined;
    if (imgs.length === 1) {
      const create = await httpFetch(`${base}/media?image_url=${encodeURIComponent(imgs[0])}&caption=${cap}&access_token=${tok}`, { method: "POST" }, 30000);
      if (!create.ok || !create.data?.id) return { ok: false, error: create.data?.error?.message || `HTTP ${create.status}` };
      creationId = create.data.id;
    } else {
      const childIds: string[] = [];
      for (const u of imgs) {
        const ch = await httpFetch(`${base}/media?image_url=${encodeURIComponent(u)}&is_carousel_item=true&access_token=${tok}`, { method: "POST" }, 30000);
        if (ch.ok && ch.data?.id) childIds.push(ch.data.id);
      }
      if (childIds.length < 2) return { ok: false, error: "ساخت آیتم‌های کاروسل اینستاگرام ناموفق بود" };
      const car = await httpFetch(`${base}/media?media_type=CAROUSEL&children=${childIds.join(",")}&caption=${cap}&access_token=${tok}`, { method: "POST" }, 30000);
      if (!car.ok || !car.data?.id) return { ok: false, error: car.data?.error?.message || `HTTP ${car.status}` };
      creationId = car.data.id;
    }
    const pub = await httpFetch(`${base}/media_publish?creation_id=${creationId}&access_token=${tok}`, { method: "POST" }, 30000);
    if (!pub.ok || !pub.data?.id) return { ok: false, error: pub.data?.error?.message || `HTTP ${pub.status}` };
    return { ok: true, ref: pub.data.id };
  }
  return { ok: false, error: "پلتفرم پشتیبانی نمی‌شود" };
}

// Upload an image (by URL) to the WordPress media library; returns media id.
async function wpUploadMedia(siteUrl: string, auth: string, imageUrl: string, title: string): Promise<number | undefined> {
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
  if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
  const buf = new Uint8Array(await imgRes.arrayBuffer());
  const ct = imgRes.headers.get("content-type") || "image/png";
  const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
  const res = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": ct,
      "Content-Disposition": `attachment; filename="flow-${Date.now()}.${ext}"`,
    },
    body: buf,
    signal: AbortSignal.timeout(30000),
  });
  const raw = await res.text();
  let data: any = null; try { data = JSON.parse(raw); } catch { /* ignore */ }
  if (!res.ok || !data?.id) throw new Error(data?.message || `media ${res.status}`);
  return data.id as number;
}

app.get(`${BASE}/studio/connections`, async (c) => {
  const u = studioUser(c);
  const conns = (await kv.get(connKey(u))) || {};
  return c.json({ connections: sanitizeConns(conns) });
});

app.post(`${BASE}/studio/connections`, async (c) => {
  try {
    const u = studioUser(c);
    const body = await c.req.json();
    const platform = body.platform as PublishPlatform;
    const v = await verifyAndBuild(platform, body);
    if (!v.ok) return c.json({ error: v.error }, 400);

    const conns = (await kv.get(connKey(u))) || {};
    conns[platform] = v.config;
    await kv.set(connKey(u), conns);
    return c.json({ connections: sanitizeConns(conns), botName: v.label });
  } catch (e) {
    console.log("studio/connections save error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

app.delete(`${BASE}/studio/connections/:platform`, async (c) => {
  const u = studioUser(c);
  const platform = c.req.param("platform");
  const conns = (await kv.get(connKey(u))) || {};
  delete conns[platform];
  await kv.set(connKey(u), conns);
  return c.json({ connections: sanitizeConns(conns) });
});

// Send a test message/post to confirm the destination is reachable.
app.post(`${BASE}/studio/connections/test`, async (c) => {
  try {
    const u = studioUser(c);
    const { platform } = await c.req.json();
    const conns = (await kv.get(connKey(u))) || {};
    const cn = conns[platform];
    if (!cn) return c.json({ error: "این پلتفرم متصل نیست" }, 400);
    const res = await sendToConnection(cn, platform as PublishPlatform, { title: "تست flow", text: "✅ اتصال flow با موفقیت برقرار شد." });
    if (!res.ok) return c.json({ error: `ارسال آزمایشی ناموفق بود: ${res.error}` }, 400);
    return c.json({ ok: true, ref: res.ref });
  } catch (e) {
    console.log("studio/connections test error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// Publish to one connected platform.
app.post(`${BASE}/studio/publish`, async (c) => {
  try {
    const u = studioUser(c);
    const { platform, text, title, link, imageUrl, imageUrls } = await c.req.json();
    if (!text || !String(text).trim()) return c.json({ error: "متن خالی است" }, 400);

    const conns = (await kv.get(connKey(u))) || {};
    const cn = conns[platform];
    if (!cn) return c.json({ error: "این پلتفرم متصل نیست" }, 400);

    const res = await sendToConnection(cn, platform as PublishPlatform, { title: title || "", text: String(text), link, imageUrl, imageUrls });
    if (!res.ok) {
      console.log(`publish ${platform} failed:`, res.error);
      return c.json({ error: `انتشار ناموفق بود: ${res.error}` }, 400);
    }

    const log: any[] = (await kv.get(pubLogKey(u))) || [];
    log.unshift({ ts: Date.now(), platform, chatId: cn.chatId || cn.url, ref: res.ref, ok: true });
    await kv.set(pubLogKey(u), log.slice(0, 200));

    return c.json({ ok: true, ref: res.ref });
  } catch (e) {
    console.log("studio/publish error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// ───────────────────────── AUTOMATION ─────────────────────────
// Rules that auto-generate (and optionally auto-publish) content on a schedule
// or when matching news appears. An external scheduler hits /automation/tick.

const rulesKey = (u: string) => `studio:rules:${u}`;
const autoLogKey = (u: string) => `studio:autolog:${u}`;

// ── Retry queue for failed publishes ──
// When an automatic or scheduled publish fails, we enqueue it here and retry
// on each tick with exponential-ish backoff. After the last attempt the entry
// is marked "dead" so the user can inspect/clear it manually.
const retryKey = (u: string) => `studio:retry:${u}`;
const RETRY_DELAYS = [5, 15, 30, 60, 180].map((m) => m * 60000); // backoff after each failed attempt
const RETRY_MAX_ATTEMPTS = RETRY_DELAYS.length + 1; // 1 original send + N retries

async function enqueueRetry(
  u: string,
  platform: string,
  payload: { title?: string; text: string; link?: string; imageUrl?: string },
  error: any,
  extra: { draftId?: string; source?: string } = {},
): Promise<void> {
  try {
    const now = Date.now();
    const list: any[] = (await kv.get(retryKey(u))) || [];
    // Avoid piling duplicate live entries for the same draft + platform.
    if (extra.draftId && list.some((e) => e.status !== "dead" && e.platform === platform && e.draftId === extra.draftId)) return;
    list.unshift({
      id: `rt_${now}_${Math.random().toString(36).slice(2, 7)}`,
      userId: u,
      platform,
      payload,
      attempts: 1,
      maxAttempts: RETRY_MAX_ATTEMPTS,
      nextAt: now + RETRY_DELAYS[0],
      lastError: String(error || "publish failed").slice(0, 200),
      status: "pending",
      createdAt: now,
      updatedAt: now,
      draftId: extra.draftId,
      source: extra.source || "auto",
    });
    await kv.set(retryKey(u), list.slice(0, 200));
  } catch (e) {
    console.log("enqueueRetry error:", String(e));
  }
}

// Attempt due (or, when force=true, all live) retries for one user.
async function processUserRetries(u: string, now: number, force = false): Promise<{ retried: number; recovered: number; pending: number }> {
  const set: any[] = (await kv.get(retryKey(u))) || [];
  if (!Array.isArray(set) || set.length === 0) return { retried: 0, recovered: 0, pending: 0 };
  const conns = (await kv.get(connKey(u))) || {};
  let retried = 0, recovered = 0, pending = 0, changed = false;
  const kept: any[] = [];
  for (const e of set) {
    const live = e.status !== "dead";
    const due = force ? live : (live && (e.nextAt || 0) <= now);
    if (!due) { kept.push(e); if (live) pending++; continue; }
    retried++;
    try {
      const res = await sendToConnection((conns as any)[e.platform], e.platform as PublishPlatform, e.payload);
      if (!res.ok) throw new Error(res.error || "publish failed");
      recovered++;
      const plog: any[] = (await kv.get(pubLogKey(u))) || [];
      plog.unshift({ ts: now, platform: e.platform, ok: true, ref: res.ref, retried: true });
      await kv.set(pubLogKey(u), plog.slice(0, 200));
      changed = true;
      // success → dropped from the queue
    } catch (err) {
      e.attempts = (e.attempts || 1) + 1;
      e.lastError = String(err).slice(0, 200);
      e.updatedAt = now;
      if (e.attempts >= (e.maxAttempts || RETRY_MAX_ATTEMPTS)) {
        e.status = "dead";
        e.nextAt = 0;
      } else {
        e.nextAt = now + RETRY_DELAYS[Math.min(e.attempts - 1, RETRY_DELAYS.length - 1)];
        pending++;
      }
      kept.push(e);
      changed = true;
    }
  }
  if (changed) await kv.set(retryKey(u), kept.slice(0, 200));
  return { retried, recovered, pending };
}

// Drain all users' due retries (called from the tick).
async function processRetries(now: number): Promise<{ retried: number; recovered: number }> {
  const sets = (await kv.getByPrefix("studio:retry:")) || [];
  const users = new Set<string>();
  for (const set of sets) if (Array.isArray(set)) { const u = set.find((e: any) => e?.userId)?.userId; if (u) users.add(u); }
  let retried = 0, recovered = 0;
  for (const u of users) {
    const r = await processUserRetries(u, now, false);
    retried += r.retried; recovered += r.recovered;
  }
  return { retried, recovered };
}

async function countAllRetries(): Promise<{ retryPending: number; retryDead: number }> {
  const sets = (await kv.getByPrefix("studio:retry:")) || [];
  let retryPending = 0, retryDead = 0;
  for (const set of sets) if (Array.isArray(set)) for (const e of set) { if (e?.status === "dead") retryDead++; else retryPending++; }
  return { retryPending, retryDead };
}

function normalizeRule(body: any, u: string): any {
  const trigger = body.trigger || {};
  return {
    id: body.id || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: u,
    name: String(body.name || "قانون بدون نام").slice(0, 120),
    enabled: body.enabled !== false,
    trigger: {
      type: trigger.type === "event" ? "event" : trigger.type === "daily" ? "daily" : "schedule",
      everyMinutes: Math.max(15, Number(trigger.everyMinutes) || 60),
      keywords: Array.isArray(trigger.keywords) ? trigger.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 20) : [],
      dailyTime: /^\d{1,2}:\d{2}$/.test(String(trigger.dailyTime || "")) ? String(trigger.dailyTime) : "08:00",
    },
    sourceCategory: String(body.sourceCategory || "").slice(0, 80),
    templateId: String(body.templateId || ""),
    platforms: Array.isArray(body.platforms) ? body.platforms.filter((p: any) => ["telegram", "bale", "rubika", "website", "twitter", "instagram"].includes(p)) : [],
    autoPublish: !!body.autoPublish,
    digest: !!body.digest,
    digestCount: Math.min(12, Math.max(2, Number(body.digestCount) || 5)),
    lastRunAt: Number(body.lastRunAt) || 0,
    lastItemKey: String(body.lastItemKey || ""),
    updatedAt: Date.now(),
  };
}

app.get(`${BASE}/studio/rules`, async (c) => {
  const u = studioUser(c);
  const rules = (await kv.get(rulesKey(u))) || [];
  return c.json({ rules });
});

app.post(`${BASE}/studio/rules`, async (c) => {
  try {
    const u = studioUser(c);
    const body = await c.req.json();
    const list: any[] = (await kv.get(rulesKey(u))) || [];
    const rule = normalizeRule(body, u);
    const idx = list.findIndex((r) => r.id === rule.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...rule }; else list.push(rule);
    await kv.set(rulesKey(u), list);
    return c.json({ rules: list });
  } catch (e) {
    console.log("studio/rules save error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

app.delete(`${BASE}/studio/rules/:id`, async (c) => {
  const u = studioUser(c);
  const id = c.req.param("id");
  const list: any[] = (await kv.get(rulesKey(u))) || [];
  await kv.set(rulesKey(u), list.filter((r) => r.id !== id));
  return c.json({ ok: true });
});

app.get(`${BASE}/studio/autolog`, async (c) => {
  const u = studioUser(c);
  const log = (await kv.get(autoLogKey(u))) || [];
  return c.json({ log });
});

app.get(`${BASE}/studio/publog`, async (c) => {
  const u = studioUser(c);
  const log = (await kv.get(pubLogKey(u))) || [];
  return c.json({ log });
});

// ── Manual performance metrics (real engagement entered by the user) ──
const metricsKey = (u: string) => `studio:metrics:${u}`;

app.get(`${BASE}/studio/metrics`, async (c) => {
  const u = studioUser(c);
  const metrics = (await kv.get(metricsKey(u))) || [];
  return c.json({ metrics });
});

app.post(`${BASE}/studio/metrics`, async (c) => {
  try {
    const u = studioUser(c);
    const body = await c.req.json();
    const list: any[] = (await kv.get(metricsKey(u))) || [];
    const entry = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: Number(body.ts) || Date.now(),
      platform: String(body.platform || "").slice(0, 20),
      views: Math.max(0, Number(body.views) || 0),
      likes: Math.max(0, Number(body.likes) || 0),
      shares: Math.max(0, Number(body.shares) || 0),
      note: String(body.note || "").slice(0, 200),
    };
    list.unshift(entry);
    await kv.set(metricsKey(u), list.slice(0, 500));
    return c.json({ metric: entry });
  } catch (e) {
    console.log("studio/metrics save error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

app.delete(`${BASE}/studio/metrics/:id`, async (c) => {
  const u = studioUser(c);
  const id = c.req.param("id");
  const list: any[] = (await kv.get(metricsKey(u))) || [];
  await kv.set(metricsKey(u), list.filter((m) => m.id !== id));
  return c.json({ ok: true });
});

// Upload a client-rendered branded news card (PNG data URL) → signed URL.
app.post(`${BASE}/studio/upload-card`, async (c) => {
  try {
    const u = studioUser(c);
    const { dataUrl } = await c.req.json();
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      return c.json({ error: "dataUrl تصویر معتبر لازم است" }, 400);
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return c.json({ url: dataUrl, path: "inline" });
    }
    await ensureCardBucket();
    const base64 = dataUrl.split(",")[1] || "";
    const bin = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    if (bin.byteLength === 0 || bin.byteLength > 6_000_000) return c.json({ error: "اندازهٔ تصویر نامعتبر است" }, 400);

    const path = `${u}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
    const { error: upErr } = await supabase.storage.from(CARD_BUCKET).upload(path, bin, { contentType: "image/png", upsert: false });
    if (upErr) return c.json({ error: `آپلود ناموفق بود: ${upErr.message}` }, 500);

    const { data: signed, error: signErr } = await supabase.storage.from(CARD_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 30);
    if (signErr || !signed?.signedUrl) return c.json({ error: `ساخت لینک ناموفق بود: ${signErr?.message || "unknown"}` }, 500);

    return c.json({ url: signed.signedUrl, path });
  } catch (e) {
    console.log("studio/upload-card error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

function ruleMatches(rule: any, item: any): boolean {
  if (rule.sourceCategory) {
    const cat = String(item.category || "").toLowerCase();
    if (!cat.includes(rule.sourceCategory.toLowerCase())) return false;
  }
  if (rule.trigger?.type === "event" && rule.trigger.keywords?.length) {
    const hay = `${item.title || ""} ${item.preview || ""} ${item.content || ""}`.toLowerCase();
    if (!rule.trigger.keywords.some((k: string) => hay.includes(k.toLowerCase()))) return false;
  }
  return true;
}

async function runRule(rule: any, articles: any[]): Promise<any> {
  const u = rule.userId;
  const now = Date.now();
  // Schedule gating.
  if (rule.trigger?.type === "schedule") {
    const due = now - (rule.lastRunAt || 0) >= (rule.trigger.everyMinutes || 60) * 60000;
    if (!due) return { skipped: "not-due" };
  } else if (rule.trigger?.type === "daily") {
    // Once per day at/after dailyTime (computed in Tehran time, UTC+3:30).
    const OFFSET = 210 * 60000;
    const pad = (n: number) => String(n).padStart(2, "0");
    const teh = new Date(now + OFFSET);
    const hhmm = `${pad(teh.getUTCHours())}:${pad(teh.getUTCMinutes())}`;
    const dayKey = teh.toISOString().slice(0, 10);
    const lastDayKey = new Date((rule.lastRunAt || 0) + OFFSET).toISOString().slice(0, 10);
    const due = hhmm >= (rule.trigger.dailyTime || "08:00") && lastDayKey !== dayKey;
    if (!due) return { skipped: "not-due" };
  }
  const candidates = articles.filter((a) => ruleMatches(rule, a));
  if (candidates.length === 0) return { skipped: "no-match" };

  const [brand, templates, conns] = await Promise.all([
    kv.get(brandKey(u)),
    kv.get(templatesKey(u)),
    kv.get(connKey(u)),
  ]);
  const template = (templates || []).find((t: any) => t.id === rule.templateId) || {};
  const PUBLISHABLE = ["telegram", "bale", "rubika", "website", "twitter", "instagram"];
  const platforms = (rule.platforms?.length ? rule.platforms : (template.platforms || ["telegram"]))
    .filter((p: any) => PUBLISHABLE.includes(p));

  let outputs: Record<string, { text: string; hashtags: string[] }>;
  let draftTitle: string;
  let sourceTitle: string;
  let sourceLink = "";
  let image = "";
  let marker: string; // dedupe key

  if (rule.digest) {
    const picks = candidates.slice(0, rule.digestCount || 5);
    if (picks.length < 2) return { skipped: "no-match" };
    marker = picks.map((p: any) => p.id).join("|").slice(0, 200);
    if (marker === rule.lastItemKey) return { skipped: "already-done" };
    outputs = await composeDigestOutputs(brand || {}, template, picks.map((p: any) => ({
      title: p.title, content: p.content || p.preview || "", source: p.source, link: p.link,
    })), platforms, u);
    draftTitle = `خلاصهٔ ${picks.length} خبر`;
    sourceTitle = draftTitle;
    image = picks.find((p: any) => p.image)?.image || "";
  } else {
    const pick = candidates[0];
    if (pick.id === rule.lastItemKey) return { skipped: "already-done" };
    marker = pick.id;
    outputs = await composeOutputs(brand || {}, template, {
      title: pick.title, content: pick.content || pick.preview || "", source: pick.source, link: pick.link,
    }, platforms, u);
    draftTitle = String(pick.title || "").slice(0, 80);
    sourceTitle = pick.title || "";
    sourceLink = pick.link || "";
    image = pick.image || "";
  }

  // Save a draft for the record.
  const drafts: any[] = (await kv.get(draftsKey(u))) || [];
  const draft = {
    id: `draft_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: draftTitle,
    sourceTitle,
    sourceLink,
    image,
    outputs,
    status: "draft",
    updatedAt: now,
    createdAt: now,
    auto: true,
  };
  drafts.unshift(draft);
  await kv.set(draftsKey(u), drafts.slice(0, 200));

  // Auto-publish if requested.
  const results: any[] = [];
  if (rule.autoPublish) {
    for (const p of platforms) {
      const o = outputs[p];
      if (!o?.text) continue;
      const text = o.hashtags?.length ? `${o.text}\n\n${o.hashtags.map((h: string) => `#${h}`).join(" ")}` : o.text;
      const res = await sendToConnection((conns || {})[p], p as PublishPlatform, { title: sourceTitle, text, link: sourceLink, imageUrl: image });
      results.push({ platform: p, ok: res.ok, error: res.error, ref: res.ref });
      if (!res.ok) {
        await enqueueRetry(u, p, { title: sourceTitle, text, link: sourceLink, imageUrl: image }, res.error, { draftId: draft.id, source: "auto" });
      }
    }
  }

  return { draftId: draft.id, itemId: marker, itemTitle: sourceTitle, published: results };
}

// The tick endpoint — call this periodically from an external scheduler.
// If env AUTOMATION_SECRET is set, require ?key= to match; otherwise open
// (still gated by the anon key + CORS like every other route).
app.post(`${BASE}/automation/tick`, async (c) => {
  try {
    const secret = process.env.AUTOMATION_SECRET;
    if (secret && c.req.query("key") !== secret) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const now = Date.now();
    const PUB = ["telegram", "bale", "rubika", "website", "twitter", "instagram"];

    // 0) Retry previously-failed publishes whose backoff window has elapsed.
    const retryStats = await processRetries(now);

    // 1) Publish scheduled drafts that are due (runs even with no fresh articles).
    let scheduledPublished = 0;
    const allDraftSets = (await kv.getByPrefix("studio:drafts:")) || [];
    for (const set of allDraftSets) {
      if (!Array.isArray(set)) continue;
      for (const d of set) {
        if (d?.status !== "scheduled" || !d.scheduledAt || d.scheduledAt > now) continue;
        const du = d.userId;
        if (!du) continue;
        try {
          const conns = (await kv.get(connKey(du))) || {};
          const targets = (d.scheduleTargets?.length ? d.scheduleTargets : Object.keys(d.outputs || {})).filter((p: any) => PUB.includes(p));
          const results: any[] = [];
          for (const p of targets) {
            const o = (d.outputs || {})[p];
            if (!o?.text) continue;
            const text = o.hashtags?.length ? `${o.text}\n\n${o.hashtags.map((h: string) => `#${h}`).join(" ")}` : o.text;
            const res = await sendToConnection((conns || {})[p], p as PublishPlatform, { title: d.sourceTitle || "", text, link: d.sourceLink, imageUrl: d.image });
            results.push({ platform: p, ok: res.ok, error: res.error, ref: res.ref });
            if (!res.ok) {
              await enqueueRetry(du, p, { title: d.sourceTitle || "", text, link: d.sourceLink, imageUrl: d.image }, res.error, { draftId: d.id, source: "scheduled" });
            }
          }
          const dl: any[] = (await kv.get(draftsKey(du))) || [];
          const di = dl.findIndex((x) => x.id === d.id);
          if (di >= 0) { dl[di] = { ...dl[di], status: "published", updatedAt: now }; await kv.set(draftsKey(du), dl); }
          const plog: any[] = (await kv.get(pubLogKey(du))) || [];
          for (const r of results) plog.unshift({ ts: now, platform: r.platform, ok: r.ok, scheduled: true });
          await kv.set(pubLogKey(du), plog.slice(0, 200));
          scheduledPublished++;
        } catch (e) {
          console.log("scheduled publish failed:", String(e));
        }
      }
    }

    // 2) Rule processing (needs the cached aggregated articles).
    const latest = (await kv.get("articles:latest")) || { items: [] };
    const articles: any[] = Array.isArray(latest.items) ? latest.items : [];

    const allRuleSets = (await kv.getByPrefix("studio:rules:")) || [];
    const rules: any[] = [];
    for (const set of allRuleSets) {
      if (Array.isArray(set)) rules.push(...set);
    }

    let ran = 0;
    const summary: any[] = [];
    if (articles.length > 0) {
      for (const rule of rules) {
        if (!rule?.enabled) continue;
        try {
          const out = await runRule(rule, articles);
          if (out.skipped) { summary.push({ rule: rule.id, skipped: out.skipped }); continue; }
          ran++;
          const list: any[] = (await kv.get(rulesKey(rule.userId))) || [];
          const idx = list.findIndex((r) => r.id === rule.id);
          if (idx >= 0) {
            list[idx] = { ...list[idx], lastRunAt: Date.now(), lastItemKey: out.itemId };
            await kv.set(rulesKey(rule.userId), list);
          }
          const log: any[] = (await kv.get(autoLogKey(rule.userId))) || [];
          log.unshift({ ts: Date.now(), ruleId: rule.id, ruleName: rule.name, itemTitle: out.itemTitle, draftId: out.draftId, published: out.published });
          await kv.set(autoLogKey(rule.userId), log.slice(0, 100));
          summary.push({ rule: rule.id, ok: true, itemTitle: out.itemTitle, published: out.published });
        } catch (e) {
          console.log(`rule ${rule.id} failed:`, String(e));
          summary.push({ rule: rule.id, error: String(e).slice(0, 200) });
        }
      }
    }
    // 3) Social Listening — scan watch topics for emerging trends / bursts.
    let socialScan = { topics: 0, alerts: 0, errors: 0 };
    try {
      socialScan = await runSocialScan(now);
    } catch (e) {
      console.log("social scan (tick) error:", String(e));
    }

    // 3.5) News-package builder — generate scheduled custom packs that are due.
    let newspackRun = { packs: 0, generated: 0, errors: 0 };
    try {
      newspackRun = await runNewspackScheduled(now);
    } catch (e) {
      console.log("newspack scheduled (tick) error:", String(e));
    }

    // 3.6) Page change monitoring — check watched URLs whose interval elapsed.
    let watchScan = { checked: 0, changed: 0, errors: 0 };
    try {
      watchScan = await runWatchScan(now);
    } catch (e) {
      console.log("watch scan (tick) error:", String(e));
    }

    // Count what's still queued after this run for at-a-glance dashboards.
    const { retryPending, retryDead } = await countAllRetries();

    // Record the run so every device can show a reliable "last run" status.
    await kv.set("automation:lasttick", {
      at: now,
      ran,
      scheduledPublished,
      total: rules.length,
      retried: retryStats.retried,
      recovered: retryStats.recovered,
      retryPending,
      retryDead,
      socialTopics: socialScan.topics,
      socialAlerts: socialScan.alerts,
      source: c.req.query("src") || "manual",
    });

    return c.json({
      ok: true,
      ran,
      scheduledPublished,
      total: rules.length,
      retried: retryStats.retried,
      recovered: retryStats.recovered,
      retryPending,
      retryDead,
      social: socialScan,
      newspack: newspackRun,
      watch: watchScan,
      summary,
    });
  } catch (e) {
    console.log("automation/tick error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// Lightweight status for the in-app scheduler / dashboards.
app.get(`${BASE}/automation/status`, async (c) => {
  try {
    const last = (await kv.get("automation:lasttick")) || null;
    return c.json({ last });
  } catch (e) {
    console.log("automation/status error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// ── Retry queue management (failed publishes) ──
app.get(`${BASE}/automation/retries`, async (c) => {
  try {
    const u = studioUser(c);
    const list: any[] = (await kv.get(retryKey(u))) || [];
    // Newest first; strip nothing sensitive (payload is the user's own content).
    return c.json({ retries: list });
  } catch (e) {
    console.log("automation/retries list error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// Force an immediate attempt of this user's queued retries (ignores backoff).
app.post(`${BASE}/automation/retries/run`, async (c) => {
  try {
    const u = studioUser(c);
    const r = await processUserRetries(u, Date.now(), true);
    return c.json({ ok: true, ...r });
  } catch (e) {
    console.log("automation/retries run error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

app.delete(`${BASE}/automation/retries/:id`, async (c) => {
  try {
    const u = studioUser(c);
    const id = c.req.param("id");
    const list: any[] = (await kv.get(retryKey(u))) || [];
    await kv.set(retryKey(u), list.filter((e) => e.id !== id));
    return c.json({ ok: true });
  } catch (e) {
    console.log("automation/retries delete error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// Clear the whole queue (or just dead entries with ?dead=1).
app.delete(`${BASE}/automation/retries`, async (c) => {
  try {
    const u = studioUser(c);
    if (c.req.query("dead") === "1") {
      const list: any[] = (await kv.get(retryKey(u))) || [];
      await kv.set(retryKey(u), list.filter((e) => e.status !== "dead"));
    } else {
      await kv.del(retryKey(u));
    }
    return c.json({ ok: true });
  } catch (e) {
    console.log("automation/retries clear error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

// Feed parsing, HTML stripping, language detection, and content deduplication
// are provided by ./feedParser.

// Readability-lite: fetch an article page and extract the main body text.
// Used by the "full article" view when the RSS feed only provided a short
// summary (common for international feeds). Result is cached in KV.
function extractReadable(html: string): { title: string; text: string; image?: string } {
  const src = String(html || "");
  let root: ReturnType<typeof parseHtml>;
  try {
    root = parseHtml(src, {
      comment: false,
      blockTextElements: { script: false, noscript: false, style: false, pre: true },
    });
  } catch {
    // Parser failure — fall back to the old regex-lite path.
    return extractReadableFallback(src);
  }

  const metaContent = (sel: string) =>
    root.querySelector(sel)?.getAttribute("content")?.trim() || "";
  const title = metaContent('meta[property="og:title"]')
    || root.querySelector("title")?.text?.trim()
    || "";
  const ogImg = metaContent('meta[property="og:image"]') || undefined;

  // Remove non-content regions outright.
  root.querySelectorAll(
    "script,style,noscript,svg,form,nav,header,footer,aside,figure,figcaption,iframe,button,input"
  ).forEach(n => n.remove());

  // Score candidate containers by the amount of paragraph text they hold, then
  // extract readable blocks from the winner (Readability-style, lightweight).
  const candidates = root.querySelectorAll("article, main, [role=main], .article, .post, .content, #content, body");
  let best: any = null;
  let bestScore = 0;
  for (const el of candidates) {
    const paras = el.querySelectorAll("p");
    let score = 0;
    for (const p of paras) score += (p.text || "").trim().length;
    if (score > bestScore) { bestScore = score; best = el; }
  }
  const scope = best || root;

  const blocks: string[] = [];
  for (const el of scope.querySelectorAll("p, h2, h3, li, blockquote")) {
    const t = (el.text || "").replace(/\s+/g, " ").trim();
    if (t && t.length >= 40) blocks.push(t);
  }
  let text = blocks.join("\n\n");
  if (text.length < 200) {
    text = (scope.text || "").replace(/\s+/g, " ").trim();
  }
  return { title, text, image: ogImg };
}

// Regex-based fallback for the rare case node-html-parser throws.
function extractReadableFallback(html: string): { title: string; text: string; image?: string } {
  let h = html;
  h = h.replace(/<!--[\s\S]*?-->/g, "");
  h = h.replace(/<(script|style|noscript|svg|form|nav|header|footer|aside|figure|figcaption|iframe)[\s\S]*?<\/\1>/gi, " ");
  const titleMatch = h.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : "";
  const ogImg = h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const article = h.match(/<article[\s\S]*?<\/article>/i)?.[0]
    || h.match(/<body[\s\S]*?<\/body>/i)?.[0]
    || h;
  const blocks: string[] = [];
  const re = /<(p|h2|h3|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(article)) !== null) {
    const t = stripHtml(m[2]);
    if (t && t.length >= 40) blocks.push(t);
  }
  let text = blocks.join("\n\n");
  if (text.length < 200) text = stripHtml(article);
  return { title, text, image: ogImg };
}

async function fetchAndExtractArticle(url: string): Promise<{ title: string; content: string; image?: string }> {
  const cacheKey = `art_full:${simpleHash(url)}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached && cached.content) return cached;
  } catch { /* ignore cache read errors */ }
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RSSReader/1.0)",
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(12000),
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  const html = await r.text();
  const { title, text, image } = extractReadable(html);
  const result = { title, content: clampText(text, 20000), image };
  try { await kv.set(cacheKey, result); } catch { /* ignore cache write errors */ }
  return result;
}

function feedIdForUrl(url: string): string {
  const norm = String(url || "").trim().toLowerCase().replace(/\/+$/, "");
  return `feed_${simpleHash(norm)}`;
}

// Fast, verified RSS/Atom/RDF feeds prioritized when warming a cold cache so
// the very first /articles call returns rich domestic & international news.
const PRIORITY_URLS = new Set<string>([
  // Iranian domestic feeds from Iranian_News_RSS_Feed_Directory_deac7516.md
  "https://www.irna.ir/rss",
  "https://www.isna.ir/rss",
  "https://www.mehrnews.com/rss",
  "https://en.mehrnews.com/rss",
  "https://www.yjc.ir/fa/rss/allnews",
  "https://www.ilna.ir/rss",
  "https://www.ilna.ir/feeds/",
  "https://www.pana.ir/rss",
  "https://www.icana.ir/rss",
  "https://www.hawzahnews.com/rss",
  "https://www.salamatnews.com/rss",
  "https://www.imna.ir/rss",
  "https://www.ibna.ir/rss",
  "https://www.khabaronline.ir/rss",
  "https://www.tabnak.ir/fa/rss/allnews",
  "https://www.asriran.com/fa/rss/allnews",
  "https://www.entekhab.ir/fa/rss/allnews",
  "https://www.hamshahrionline.ir/rss",
  "https://www.mashreghnews.ir/rss",
  "https://www.eghtesadonline.com/rss",
  "https://www.tehrantimes.com/rss",
  "https://www.radiofarda.com/api/",
  "https://www.isna.ir/rss/tp/512",
  "https://www.qudsonline.ir/rss",
  "https://www.zoomit.ir/feed/",
  "https://digiato.com/feed",
  "https://itiran.com/feed/",
  "https://www.khabarvarzeshi.com/rss",
  "https://www.tarafdari.com/rss.xml",
  "https://www.ensafnews.com/feed/",
  "https://www.rouydad24.ir/fa/rss/allnews",
  "https://arzdigital.com/feed/",
  "https://energypress.ir/feed/",
  "https://www.jamaran.news/feeds/",
  "https://www.poollnews.ir/fa/rss/allnews",
  "https://noandish.com/fa/rss/allnews",
  "https://fa.shafaqna.com/feed/",
  "https://www.mizanonline.ir/fa/rss/allnews",
  // International feeds from international_news_rss_feeds_bc41ee08.json
  "https://www.cbc.ca/webfeed/rss/rss-topstories",
  "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/world/",
  "https://www.reforma.com/rss/portada.xml",
  "https://feeds.abcnews.com/abcnews/topstories",
  "https://www.cbsnews.com/latest/rss/main",
  "http://rss.cnn.com/rss/cnn_topstories.rss",
  "https://moxie.foxnews.com/google-publisher/latest.xml",
  "https://www.latimes.com/world-nation/rss2.0.xml",
  "https://feeds.nbcnews.com/feeds/topstories",
  "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
  "https://rss.politico.com/politics-news.xml",
  "https://thehill.com/feed/",
  "https://rss.upi.com/news/news.rss",
  "https://feeds.content.dowjones.io/public/rss/RSSWorldNews",
  "https://www.euronews.com/rss",
  "https://www.lemonde.fr/en/rss/une.xml",
  "https://www.spiegel.de/international/index.rss",
  "https://rss.dw.com/xml/rss-en-all",
  "https://rss.dw.com/rdf/rss-en-all",
  "https://www.irishtimes.com/cmlink/news-1.1319192",
  "https://www.rte.ie/news/rss/news-headlines.xml",
  "https://www.ansa.it/sito/ansait_rss.xml",
  "https://feeds.nos.nl/nosnieuwsalgemeen",
  "https://www.nrk.no/toppsaker.rss",
  "https://tass.com/rss/v2.xml",
  "https://www.svt.se/nyheter/rss.xml",
  "https://feeds.bbci.co.uk/news/rss.xml",
  "https://feeds.skynews.com/feeds/rss/home.xml",
  "https://www.theguardian.com/world/rss",
  "https://www.telegraph.co.uk/rss.xml",
  "https://www.abc.net.au/news/feed/2942460/rss.xml",
  "https://www.abc.net.au/news/feed/51120/rss.xml",
  "https://www.smh.com.au/rss/feed.xml",
  "https://www.scmp.com/rss/91/feed",
  "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml",
  "https://www.thehindu.com/feeder/default.rss",
  "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",
  "https://www.japantimes.co.jp/feed/",
  "https://www3.nhk.or.jp/rss/news/cat0.xml",
  "https://www.nzherald.co.nz/arc/outboundfeeds/rss/curated/78/?outputType=xml",
  "https://www.dawn.com/feeds/home",
  "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml",
  "https://www.straitstimes.com/news/world/rss.xml",
  "https://www.timesofisrael.com/feed/",
  "https://www.aljazeera.com/xml/rss/all.xml",
  "https://www.africanews.com/feed/",
  "https://www.dailymaverick.co.za/article/feed/",
  "https://mg.co.za/feed/",
  "https://www.middleeasteye.net/rss",
  "https://www.al-monitor.com/rss",
  "https://www.batimes.com.ar/feed",
  "https://en.mercopress.com/rss",
  "https://www.sbs.com.au/news/feed",
  "https://www.theguardian.com/au/rss",
  "https://www.rnz.co.nz/rss/international.xml",
  "https://www.rnz.co.nz/rss/national.xml",
  "https://www.stuff.co.nz/rss",
]);

const DEFAULT_BOOTSTRAP_FEEDS = [
  { name: "خبرگزاری جمهوری اسلامی ایران (ایرنا)", url: "https://www.irna.ir/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری ایسنا", url: "https://www.isna.ir/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری مهر", url: "https://www.mehrnews.com/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری مهر (انگلیسی)", url: "https://en.mehrnews.com/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری باشگاه خبرنگاران جوان", url: "https://www.yjc.ir/fa/rss/allnews", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری ایلنا", url: "https://www.ilna.ir/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری پانا", url: "https://www.pana.ir/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری خانه ملت", url: "https://www.icana.ir/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری حوزه", url: "https://www.hawzahnews.com/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری سلامت", url: "https://www.salamatnews.com/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری ایمنا", url: "https://www.imna.ir/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرگزاری کتاب ایران (ایبنا)", url: "https://www.ibna.ir/rss", category: "داخلی · خبرگزاری‌های رسمی و سراسری", icon: "📰" },
  { name: "خبرآنلاین", url: "https://www.khabaronline.ir/rss", category: "داخلی · پایگاه‌های خبری و تحلیلی", icon: "📰" },
  { name: "تابناک", url: "https://www.tabnak.ir/fa/rss/allnews", category: "داخلی · پایگاه‌های خبری و تحلیلی", icon: "📰" },
  { name: "عصر ایران", url: "https://www.asriran.com/fa/rss/allnews", category: "داخلی · پایگاه‌های خبری و تحلیلی", icon: "📰" },
  { name: "انتخاب", url: "https://www.entekhab.ir/fa/rss/allnews", category: "داخلی · پایگاه‌های خبری و تحلیلی", icon: "📰" },
  { name: "همشهری آنلاین", url: "https://www.hamshahrionline.ir/rss", category: "داخلی · پایگاه‌های خبری و تحلیلی", icon: "📰" },
  { name: "مشرق‌نیوز", url: "https://www.mashreghnews.ir/rss", category: "داخلی · پایگاه‌های خبری و تحلیلی", icon: "📰" },
  { name: "اقتصاد آنلاین", url: "https://www.eghtesadonline.com/rss", category: "داخلی · پایگاه‌های خبری و تحلیلی", icon: "📰" },
  { name: "تهران‌تایمز", url: "https://www.tehrantimes.com/rss", category: "داخلی · پایگاه‌های خبری و تحلیلی", icon: "📰" },
  { name: "رادیو فردا", url: "https://www.radiofarda.com/api/", category: "داخلی · پایگاه‌های خبری و تحلیلی", icon: "📰" },
  { name: "زومیت", url: "https://www.zoomit.ir/feed/", category: "داخلی · فناوری و دیجیتال", icon: "💻" },
  { name: "دیجیاتو", url: "https://digiato.com/feed", category: "داخلی · فناوری و دیجیتال", icon: "📱" },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", category: "بین‌الملل · بریتانیا · شبکه خبری و تلویزیونی", icon: "🇬🇧" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "بین‌الملل · قطر · شبکه خبری و تلویزیونی", icon: "🇶🇦" },
  { name: "France 24", url: "https://www.france24.com/en/rss", category: "بین‌الملل · فرانسه · شبکه خبری و تلویزیونی", icon: "🇫🇷" },
  { name: "Deutsche Welle (DW)", url: "https://rss.dw.com/xml/rss-en-all", category: "بین‌الملل · آلمان · شبکه خبری و تلویزیونی", icon: "🇩🇪" },
  { name: "Euronews", url: "https://www.euronews.com/rss", category: "بین‌الملل · فرانسه · شبکه خبری و تلویزیونی", icon: "🇫🇷" },
  { name: "Sky News", url: "https://feeds.skynews.com/feeds/rss/home.xml", category: "بین‌الملل · بریتانیا · شبکه خبری و تلویزیونی", icon: "🇬🇧" },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", category: "بین‌الملل · بریتانیا · روزنامه", icon: "🇬🇧" },
  { name: "New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", category: "بین‌الملل · آمریکا · روزنامه", icon: "🇺🇸" },
  { name: "Wall Street Journal", url: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews", category: "بین‌الملل · آمریکا · روزنامه", icon: "🇺🇸" },
  { name: "CBC News", url: "https://www.cbc.ca/webfeed/rss/rss-topstories", category: "بین‌الملل · کانادا · شبکه خبری و تلویزیونی", icon: "🇨🇦" },
  { name: "NHK World", url: "https://www3.nhk.or.jp/rss/news/cat0.xml", category: "بین‌الملل · ژاپن · شبکه خبری و تلویزیونی", icon: "🇯🇵" },
  { name: "Al Monitor", url: "https://www.al-monitor.com/rss", category: "بین‌الملل · خاورمیانه · رسانه دیجیتال", icon: "🌍" },
  { name: "Middle East Eye", url: "https://www.middleeasteye.net/rss", category: "بین‌الملل · خاورمیانه · رسانه دیجیتال", icon: "🌍" },
];

async function fetchFeedXmlRaw(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/atom+xml, application/rdf+xml, application/xml, text/xml, */*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9,fa;q=0.8",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    const xml = await res.text();
    if (!xml || !xml.trim()) throw new Error("empty feed response");
    return xml;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAndParseFeed(url: string, feedId: string, timeoutMs = 6000) {
  let primaryErr: unknown = null;
  try {
    const xml = await fetchFeedXmlRaw(url, Math.min(timeoutMs, 3800));
    const items = parseFeedXml(xml, url, feedId);
    if (items.length > 0) return items;
    primaryErr = new Error("empty feed items");
  } catch (e) {
    primaryErr = e;
  }

  // Automatic fallback via Google News RSS when a publisher feed blocks datacenter IPs (403/202) or times out
  const fallbacks = buildGoogleNewsFallbackUrls(url);
  for (const fbUrl of fallbacks) {
    try {
      const fbXml = await fetchFeedXmlRaw(fbUrl, 3500);
      const fbItems = parseFeedXml(fbXml, url, feedId);
      if (fbItems.length > 0) return fbItems;
    } catch {
      // try next fallback candidate
    }
  }

  throw primaryErr instanceof Error ? primaryErr : new Error(String(primaryErr || "feed fetch failed"));
}

app.get(`${BASE}/feeds`, async (c) => {
  const list = (await kv.get(FEEDS_KEY)) || [];
  return c.json({ feeds: list });
});

// Fetch and extract the full readable text of an article from its source URL.
// Used to populate the article content column when the RSS feed only carried a
// short summary (typical of international feeds). Cached in KV.
app.get(`${BASE}/article/extract`, async (c) => {
  try {
    const url = c.req.query("url");
    if (!url || !/^https?:\/\//i.test(url)) return c.json({ error: "valid url required" }, 400);
    const result = await fetchAndExtractArticle(url);
    return c.json(result);
  } catch (e) {
    console.log("article/extract error:", String(e));
    return c.json({ error: `استخراج متن کامل شکست خورد: ${String(e)}` }, 500);
  }
});

const ARTICLES_CACHE_KEY = "articles:latest";
const MAX_LIVE_PER_REQUEST = 16;   // feeds fetched live per /articles call
const LIVE_DEADLINE_MS = 9500;     // hard wall-clock budget for live fetching
const CACHE_CAP = 2000;            // max cached articles kept

app.post(`${BASE}/feeds`, async (c) => {
  try {
    const body = await c.req.json();
    let url = String(body?.url || "").trim();
    const { name, icon, category } = body || {};
    if (!url) return c.json({ error: "url required" }, 400);
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    const list = (await kv.get(FEEDS_KEY)) || [];
    const existing = list.find((f: any) => f.url === url);
    if (existing) return c.json({ feed: existing });

    // Validate the feed URL (and auto-discover RSS/Atom link if user pasted a website homepage)
    const tempId = feedIdForUrl(url);
    let parsedItems: any[] = [];
    let resolvedUrl = url;
    try {
      parsedItems = await fetchAndParseFeed(resolvedUrl, tempId, 8000);
    } catch (firstErr) {
      // Try discovering a <link rel="alternate" type="application/rss+xml"> from HTML
      try {
        const page = await fetchText(resolvedUrl, 7000);
        if (page.ok) {
          const discovered = findFeedUrl(page.body, resolvedUrl);
          if (discovered) {
            resolvedUrl = discovered;
            const discId = feedIdForUrl(resolvedUrl);
            parsedItems = await fetchAndParseFeed(resolvedUrl, discId, 8000);
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      } catch {
        return c.json({ error: `دریافت یا خواندن خوراک ناموفق بود: ${String((firstErr as any)?.message || firstErr)}` }, 400);
      }
    }

    const existingResolved = list.find((f: any) => f.url === resolvedUrl);
    if (existingResolved) return c.json({ feed: existingResolved });

    const id = feedIdForUrl(resolvedUrl);
    const inferredTitle = parsedItems[0]?.source || resolvedUrl;
    const feed = {
      id,
      url: resolvedUrl,
      name: name || inferredTitle || resolvedUrl,
      icon: icon || "📡",
      category: category || "سایر",
    };
    list.push(feed);
    await kv.set(FEEDS_KEY, list);

    // Cache the freshly fetched items immediately so the new feed shows articles right away
    try {
      const status: Record<string, any> = (await kv.get(FEED_STATUS_KEY)) || {};
      status[id] = { ok: true, lastOk: Date.now() };
      await kv.set(FEED_STATUS_KEY, status);

      const tags: Record<string, string[]> = (await kv.get(TAGS_KEY)) || {};
      const rules: TagRule[] = (await kv.get(RULES_KEY)) || [];
      const cacheObj = (await kv.get(ARTICLES_CACHE_KEY)) || { items: [] };
      const cached: any[] = Array.isArray(cacheObj.items) ? cacheObj.items : [];
      const cacheMap = new Map<string, any>(cached.map((it: any) => [it.id, it]));

      for (const it of parsedItems.slice(0, 20)) {
        const itemWithFeedId = { ...it, id: `${id}-${it.link || it.id}`, feedId: id };
        const enriched = {
          ...itemWithFeedId,
          source: feed.name || it.source,
          sourceIcon: feed.icon || "📡",
          category: feed.category || "",
        };
        const autoTags = applyRules(enriched, rules);
        const userTags = tags[enriched.id] || [];
        cacheMap.set(enriched.id, {
          ...enriched,
          tags: Array.from(new Set([...userTags, ...autoTags])),
          autoTags,
          readTime: `${Math.max(1, Math.ceil((it.content || "").length / 800))} دقیقه`,
        });
      }
      const merged = [...cacheMap.values()]
        .sort((a, b) => safeDateMs(b.date) - safeDateMs(a.date))
        .slice(0, CACHE_CAP);
      await kv.set(ARTICLES_CACHE_KEY, { ts: Date.now(), items: merged });
    } catch (cacheErr) {
      console.log("cache update on addFeed error:", String(cacheErr));
    }

    return c.json({ feed });
  } catch (e) {
    console.log("add feed error:", e);
    return c.json({ error: String(e) }, 500);
  }
});

app.post(`${BASE}/feeds/bulk`, async (c) => {
  try {
    const { feeds: incoming } = await c.req.json();
    if (!Array.isArray(incoming)) return c.json({ error: "feeds array required" }, 400);
    const list = (await kv.get(FEEDS_KEY)) || [];
    const existingByUrl = new Map<string, number>();
    list.forEach((f: any, idx: number) => {
      if (f?.url) existingByUrl.set(f.url, idx);
    });
    let added = 0;
    for (const it of incoming) {
      if (!it?.url) continue;
      const id = feedIdForUrl(it.url);
      const entry = {
        id,
        url: it.url,
        name: it.name || it.url,
        icon: it.icon || "📡",
        category: it.category || "",
      };
      const existingIdx = existingByUrl.get(it.url);
      if (existingIdx !== undefined) {
        list[existingIdx] = entry;
      } else {
        existingByUrl.set(it.url, list.length);
        list.push(entry);
        added++;
      }
    }
    await kv.set(FEEDS_KEY, list);
    return c.json({ added, total: list.length });
  } catch (e) {
    console.log("bulk add error:", e);
    return c.json({ error: String(e) }, 500);
  }
});

app.post(`${BASE}/feeds/clear`, async (c) => {
  await kv.set(FEEDS_KEY, []);
  return c.json({ ok: true });
});

app.delete(`${BASE}/feeds/:id`, async (c) => {
  const id = c.req.param("id");
  const list = (await kv.get(FEEDS_KEY)) || [];
  const next = list.filter((f: any) => f.id !== id);
  await kv.set(FEEDS_KEY, next);
  return c.json({ ok: true });
});

app.get(`${BASE}/articles`, async (c) => {
  let list: any[] = (await kv.get(FEEDS_KEY)) || [];
  if (list.length === 0) {
    list = DEFAULT_BOOTSTRAP_FEEDS.map((f) => ({
      id: feedIdForUrl(f.url),
      url: f.url,
      name: f.name,
      icon: f.icon,
      category: f.category,
    }));
    await kv.set(FEEDS_KEY, list);
  } else {
    // Ensure all existing feeds have deterministic IDs so cached items stay linked
    let idFixed = false;
    for (const f of list) {
      const expectedId = feedIdForUrl(f.url);
      if (f.id !== expectedId) {
        f.id = expectedId;
        idFixed = true;
      }
    }
    if (idFixed) await kv.set(FEEDS_KEY, list);
  }

  const readIds = new Set((await kv.get(READ_KEY)) || []);
  const starredIds = new Set((await kv.get(STARRED_KEY)) || []);
  const limitParam = Number(c.req.query("limit") || "60");
  const offsetParam = Number(c.req.query("offset") || "0");
  const feedIdParam = c.req.query("feedId");
  const categoryParam = c.req.query("category");

  const tags: Record<string, string[]> = (await kv.get(TAGS_KEY)) || {};
  const rules: TagRule[] = (await kv.get(RULES_KEY)) || [];
  const status: Record<string, { ok: boolean; error?: string; lastOk?: number; lastFail?: number }> =
    (await kv.get(FEED_STATUS_KEY)) || {};
  const cacheObj = (await kv.get(ARTICLES_CACHE_KEY)) || { items: [] };
  const cached: any[] = Array.isArray(cacheObj.items) ? cacheObj.items : [];
  const cacheMap = new Map<string, any>(cached.map((it: any) => [it.id, it]));

  // Which feeds are candidates for this request?
  let pool = list;
  if (feedIdParam) pool = list.filter((f: any) => f.id === feedIdParam);
  else if (categoryParam) {
    const q = categoryParam.toLowerCase();
    pool = list.filter((f: any) => (f.category || "").toLowerCase().includes(q));
  }

  const now = Date.now();
  const COOLDOWN = 10 * 60 * 1000;
  const isTripped = (fid: string) => {
    const s = status[fid];
    return !!(s && s.ok === false && s.lastFail && now - s.lastFail < COOLDOWN);
  };
  // Refresh the stalest, non-tripped feeds first; among untested feeds (lastOk === 0),
  // prioritize verified fast feeds so cold starts return rich articles immediately.
  const cacheAgeMs = now - Number(cacheObj.ts || 0);
  const isWarmGeneral = !feedIdParam && !categoryParam && cached.length >= 60;
  const liveQuota = feedIdParam
    ? pool.length
    : isWarmGeneral && cacheAgeMs < 30_000
      ? 0
      : isWarmGeneral
        ? 6
        : MAX_LIVE_PER_REQUEST;
  const refreshTargets = [...pool]
    .filter((f: any) => Boolean(feedIdParam) || !isTripped(f.id))
    .sort((a: any, b: any) => {
      const aOk = status[a.id]?.lastOk || 0;
      const bOk = status[b.id]?.lastOk || 0;
      if (aOk === 0 && bOk === 0) {
        const aPrio = PRIORITY_URLS.has(a.url) ? 0 : 1;
        const bPrio = PRIORITY_URLS.has(b.url) ? 0 : 1;
        if (aPrio !== bPrio) return aPrio - bPrio;
      }
      return aOk - bOk;
    })
    .slice(0, liveQuota);

  const deadline = now + (isWarmGeneral ? 3000 : LIVE_DEADLINE_MS);
  const CONCURRENCY = 12;
  let idx = 0;
  let refreshed = 0;
  async function worker() {
    while (idx < refreshTargets.length) {
      const feed = refreshTargets[idx++];
      if (Date.now() > deadline) break;
      try {
        const items = await fetchAndParseFeed(feed.url, feed.id, 5500);
        status[feed.id] = { ok: true, lastOk: Date.now() };
        refreshed++;
        for (const it of items.slice(0, 15)) {
          const enriched = {
            ...it,
            source: feed.name || it.source,
            sourceIcon: feed.icon || "📡",
            category: feed.category || "",
          };
          const autoTags = applyRules(enriched, rules);
          const userTags = tags[it.id] || [];
          cacheMap.set(it.id, {
            ...enriched,
            tags: Array.from(new Set([...userTags, ...autoTags])),
            autoTags,
            readTime: `${Math.max(1, Math.ceil((it.content || "").length / 800))} دقیقه`,
          });
        }
      } catch (e) {
        const msg = String(e).slice(0, 200);
        const prev = status[feed.id] || {};
        status[feed.id] = { ok: false, error: msg, lastOk: prev.lastOk, lastFail: Date.now() };
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await kv.set(FEED_STATUS_KEY, status);

  // Persist the merged, capped cache (newest first).
  let merged = [...cacheMap.values()].sort((a, b) => safeDateMs(b.date) - safeDateMs(a.date));
  if (merged.length > CACHE_CAP) merged = merged.slice(0, CACHE_CAP);
  try { await kv.set(ARTICLES_CACHE_KEY, { ts: Date.now(), items: merged }); } catch {}

  // Build the response set from the cache filtered to this request's scope.
  const feedIds = new Set(pool.map((f: any) => f.id));
  let scoped = merged;
  if (feedIdParam) scoped = merged.filter((it: any) => it.feedId === feedIdParam);
  else if (categoryParam) {
    const q = categoryParam.toLowerCase();
    scoped = merged.filter((it: any) => feedIds.has(it.feedId) || String(it.category || "").toLowerCase().includes(q));
  }

  // Collapse cross-feed duplicates (same story republished by multiple outlets).
  // `scoped` is already newest-first, so the first occurrence we keep is freshest.
  if (!feedIdParam) {
    const seenSig = new Set<string>();
    scoped = scoped.filter((it: any) => {
      const sig = contentSig(it.title, it.link);
      if (seenSig.has(sig)) return false;
      seenSig.add(sig);
      return true;
    });
  }

  const total = scoped.length;
  const page = scoped.slice(offsetParam, offsetParam + limitParam).map((it: any) => ({
    ...it,
    read: readIds.has(it.id),
    starred: starredIds.has(it.id),
  }));

  return c.json({ articles: page, feedsCount: list.length, fetched: refreshed, total, status });
});

app.get(`${BASE}/feeds/status`, async (c) => {
  const status = (await kv.get(FEED_STATUS_KEY)) || {};
  return c.json({ status });
});

app.post(`${BASE}/feeds/prune`, async (c) => {
  try {
    const list: any[] = (await kv.get(FEEDS_KEY)) || [];
    const status: Record<string, any> = (await kv.get(FEED_STATUS_KEY)) || {};
    const limit = Math.min(Math.max(Number(c.req.query("limit") || "60"), 1), 120);
    const runStart = Date.now();
    const deadline = runStart + 22000;

    // Stalest-checked first so repeated calls fan out across the directory.
    const targets = [...list]
      .sort((a, b) => (status[a.id]?.lastCheck || 0) - (status[b.id]?.lastCheck || 0))
      .slice(0, limit);

    const removedIds = new Set<string>();
    const removedList: { id: string; name: string; url: string; error: string }[] = [];
    let checked = 0;
    let idx = 0;
    const CONCURRENCY = 12;
    async function worker() {
      while (idx < targets.length) {
        const f = targets[idx++];
        if (Date.now() > deadline) break;
        checked++;
        try {
          await fetchAndParseFeed(f.url, f.id, 6500);
          status[f.id] = { ok: true, lastOk: Date.now(), lastCheck: Date.now(), failCount: 0 };
        } catch (e) {
          const msg = String(e).slice(0, 200);
          const prev = status[f.id] || {};
          const permanent = /fetch failed (400|401|403|404|410|451|530)|invalid feed format|invalid feed|ENOTFOUND|dns|getaddrinfo|certificate|ssl/i.test(msg);
          const failCount = (prev.failCount || 0) + 1;
          status[f.id] = { ok: false, error: msg, lastOk: prev.lastOk, lastFail: Date.now(), lastCheck: Date.now(), failCount };
          if (permanent || failCount >= 2) {
            removedIds.add(f.id);
            removedList.push({ id: f.id, name: f.name, url: f.url, error: msg });
          }
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const next = list.filter((f) => !removedIds.has(f.id));
    for (const id of removedIds) delete status[id];
    await kv.set(FEEDS_KEY, next);
    await kv.set(FEED_STATUS_KEY, status);

    // Feeds still needing a check this sweep (not yet checked since runStart).
    const remaining = next.filter((f) => (status[f.id]?.lastCheck || 0) < runStart).length;

    return c.json({ ok: true, checked, removed: removedIds.size, removedList, total: next.length, remaining });
  } catch (e) {
    console.log("feeds/prune error:", String(e));
    return c.json({ error: String(e) }, 500);
  }
});

app.get(`${BASE}/tags`, async (c) => {
  const tags = (await kv.get(TAGS_KEY)) || {};
  return c.json({ tags });
});

app.post(`${BASE}/tags`, async (c) => {
  const { id, tags: newTags } = await c.req.json();
  if (!id || !Array.isArray(newTags)) return c.json({ error: "id and tags required" }, 400);
  const tags: Record<string, string[]> = (await kv.get(TAGS_KEY)) || {};
  if (newTags.length === 0) delete tags[id];
  else tags[id] = Array.from(new Set(newTags.map((t: string) => String(t).trim()).filter(Boolean)));
  await kv.set(TAGS_KEY, tags);
  return c.json({ ok: true, tags: tags[id] || [] });
});

app.get(`${BASE}/opml`, async (c) => {
  const list = (await kv.get(FEEDS_KEY)) || [];
  const byCat = new Map<string, any[]>();
  for (const f of list) {
    const k = f.category || "سایر";
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(f);
  }
  const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let body = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>RSS Subscriptions</title></head>\n  <body>\n`;
  for (const [cat, feeds] of byCat) {
    body += `    <outline text="${esc(cat)}" title="${esc(cat)}">\n`;
    for (const f of feeds) {
      body += `      <outline type="rss" text="${esc(f.name)}" title="${esc(f.name)}" xmlUrl="${esc(f.url)}" />\n`;
    }
    body += `    </outline>\n`;
  }
  body += `  </body>\n</opml>`;
  return new Response(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
});

app.post(`${BASE}/opml`, async (c) => {
  try {
    const { xml } = await c.req.json();
    if (!xml) return c.json({ error: "xml required" }, 400);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const parsed = parser.parse(xml);
    const body = parsed?.opml?.body;
    if (!body) return c.json({ error: "invalid OPML" }, 400);

    const collected: any[] = [];
    function walk(node: any, parentCat = "") {
      if (!node) return;
      const outlines = Array.isArray(node.outline) ? node.outline : (node.outline ? [node.outline] : []);
      for (const o of outlines) {
        const url = o["@_xmlUrl"];
        const name = o["@_title"] || o["@_text"] || url;
        const cat = parentCat || o["@_text"] || "سایر";
        if (url) {
          collected.push({ url, name, category: parentCat || "سایر" });
        } else {
          walk(o, cat);
        }
      }
    }
    walk(body);

    const existing = (await kv.get(FEEDS_KEY)) || [];
    const existingUrls = new Set(existing.map((f: any) => f.url));
    let added = 0;
    for (const it of collected) {
      if (existingUrls.has(it.url)) continue;
      const id = feedIdForUrl(it.url);
      existing.push({ id, url: it.url, name: it.name, icon: "📡", category: it.category });
      existingUrls.add(it.url);
      added++;
    }
    await kv.set(FEEDS_KEY, existing);
    return c.json({ added, total: existing.length });
  } catch (e) {
    console.log("opml import error:", e);
    return c.json({ error: String(e) }, 500);
  }
});

app.post(`${BASE}/state/read`, async (c) => {
  const { id } = await c.req.json();
  const list: string[] = (await kv.get(READ_KEY)) || [];
  if (!list.includes(id)) list.push(id);
  await kv.set(READ_KEY, list);
  return c.json({ ok: true });
});

app.post(`${BASE}/state/star`, async (c) => {
  const { id, starred } = await c.req.json();
  const list: string[] = (await kv.get(STARRED_KEY)) || [];
  const set = new Set(list);
  if (starred) set.add(id); else set.delete(id);
  await kv.set(STARRED_KEY, Array.from(set));
  return c.json({ ok: true });
});

app.get(`${BASE}/rules`, async (c) => {
  const rules = (await kv.get(RULES_KEY)) || [];
  return c.json({ rules });
});

app.post(`${BASE}/rules`, async (c) => {
  try {
    const body = await c.req.json();
    const rules: TagRule[] = (await kv.get(RULES_KEY)) || [];
    if (body.id) {
      const idx = rules.findIndex(r => r.id === body.id);
      if (idx >= 0) rules[idx] = { ...rules[idx], ...body };
      else rules.push(body);
    } else {
      const id = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      rules.push({ id, enabled: true, keywords: [], fields: ["title", "preview", "content"], ...body });
    }
    await kv.set(RULES_KEY, rules);
    return c.json({ rules });
  } catch (e) {
    console.log("rules save error:", e);
    return c.json({ error: String(e) }, 500);
  }
});

app.delete(`${BASE}/rules/:id`, async (c) => {
  const id = c.req.param("id");
  const rules: TagRule[] = (await kv.get(RULES_KEY)) || [];
  await kv.set(RULES_KEY, rules.filter(r => r.id !== id));
  return c.json({ ok: true });
});

app.get(`${BASE}/search`, async (c) => {
  const q = (c.req.query("q") || "").trim().toLowerCase();
  if (!q) return c.json({ results: [] });
  const list = (await kv.get(FEEDS_KEY)) || [];
  const readIds = new Set((await kv.get(READ_KEY)) || []);
  const starredIds = new Set((await kv.get(STARRED_KEY)) || []);
  const tags: Record<string, string[]> = (await kv.get(TAGS_KEY)) || {};
  const rules: TagRule[] = (await kv.get(RULES_KEY)) || [];

  // Search cached articles first for instant results
  const cacheObj = (await kv.get(ARTICLES_CACHE_KEY)) || { items: [] };
  const cached: any[] = Array.isArray(cacheObj.items) ? cacheObj.items : [];
  const seenIds = new Set<string>();
  const results: any[] = [];

  for (const it of cached) {
    const hay = `${it.title || ""} ${it.preview || ""} ${it.content || ""} ${it.source || ""}`.toLowerCase();
    if (!hay.includes(q)) continue;
    seenIds.add(it.id);
    results.push({
      ...it,
      read: readIds.has(it.id),
      starred: starredIds.has(it.id),
    });
  }

  const SEARCH_DEADLINE = Date.now() + 8000;
  const CONCURRENCY = 10;
  const candidates = list.filter((f: any) => PRIORITY_URLS.has(f.url)).slice(0, 12);
  let idx = 0;
  async function worker() {
    while (idx < candidates.length && results.length < 200) {
      if (Date.now() > SEARCH_DEADLINE) break;
      const feed = candidates[idx++];
      try {
        const items = await fetchAndParseFeed(feed.url, feed.id, 4500);
        for (const it of items) {
          if (seenIds.has(it.id)) continue;
          const hay = `${it.title} ${it.preview} ${it.content}`.toLowerCase();
          if (!hay.includes(q)) continue;
          seenIds.add(it.id);
          const enriched = { ...it, source: feed.name || it.source, sourceIcon: feed.icon || "📡", category: feed.category || "" };
          const autoTags = applyRules(enriched, rules);
          results.push({
            ...enriched,
            read: readIds.has(it.id),
            starred: starredIds.has(it.id),
            tags: Array.from(new Set([...(tags[it.id] || []), ...autoTags])),
            readTime: `${Math.max(1, Math.ceil((it.content || "").length / 800))} دقیقه`,
          });
          if (results.length >= 200) break;
        }
      } catch {
        // skip unreachable feed during live search
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => safeDateMs(b.date) - safeDateMs(a.date));
  return c.json({ results, total: results.length });
});

export { app };
export default app;

if (typeof (globalThis as any).Deno !== "undefined") {
  (globalThis as any).Deno.serve(app.fetch);
}

