import type { Article } from "../../../data";
import type { StudioPlatform } from "../../../api";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Messenger Native Features (Telegram / Bale / Eitaa / Rubika)
// ─────────────────────────────────────────────────────────────────────────────

export type InlineButtonKind = "url" | "reaction" | "callback";

export interface InlineButton {
  id: string;
  label: string;
  kind: InlineButtonKind;
  url?: string;
  reactionEmoji?: string;
  count?: number;
}

export interface MessengerNativeOptions {
  /** ارسال بی‌صدا (disable_notification) */
  silent: boolean;
  /** پین کردن خودکار خبر فوری در بالای کانال */
  autoPin: boolean;
  /** نمایش پیش‌نمایش لینک سفارشی */
  showLinkPreview: boolean;
  /** محل قرارگیری پیش‌نمایش لینک (بالا یا پایین متن) */
  linkPreviewPosition: "top" | "bottom";
  /** عنوان سفارشی پیش‌نمایش لینک */
  customLinkTitle: string;
  /** دامنه یا زیرعنوان پیش‌نمایش لینک */
  customLinkDomain: string;
  /** دکمه‌های شیشه‌ای تعاملی زیر پست (Inline Keyboard) */
  inlineButtons: InlineButton[];
}

export interface ReplyChainConfig {
  /** فعال بودن اتصال به پست قبلی (Reply / Quote / Thread) */
  enabled: boolean;
  /** شناسهٔ پست یا پیش‌نویس قبلی */
  parentId: string;
  /** تیتر پست قبلی در کانال */
  parentTitle: string;
  /** خلاصهٔ کوتاه پست قبلی برای نمایش در باکس Reply */
  parentSnippet: string;
  /** پلتفرم پست مرجع */
  parentPlatform: StudioPlatform;
  /** شناسهٔ پیام در کانال (مثلاً #4812) */
  channelMessageId: string;
  /** ادامهٔ زنجیره (پست‌های مکمل در رشته/Thread) */
  threadContinuations: string[];
}

export function createDefaultInlineButtons(sourceLink?: string): InlineButton[] {
  return [
    {
      id: "btn-full-story",
      label: "📖 متن کامل خبر",
      kind: "url",
      url: sourceLink || "https://kian.media/news",
    },
    {
      id: "btn-react-like",
      label: "👍",
      kind: "reaction",
      reactionEmoji: "👍",
      count: 42,
    },
    {
      id: "btn-react-dislike",
      label: "👎",
      kind: "reaction",
      reactionEmoji: "👎",
      count: 5,
    },
    {
      id: "btn-react-fire",
      label: "🔥",
      kind: "reaction",
      reactionEmoji: "🔥",
      count: 89,
    },
  ];
}

export const DEFAULT_MESSENGER_OPTIONS: MessengerNativeOptions = {
  silent: false,
  autoPin: false,
  showLinkPreview: true,
  linkPreviewPosition: "bottom",
  customLinkTitle: "",
  customLinkDomain: "kian.media · تحریریه رسمی",
  inlineButtons: createDefaultInlineButtons(),
};

export const DEFAULT_REPLY_CHAIN: ReplyChainConfig = {
  enabled: false,
  parentId: "",
  parentTitle: "",
  parentSnippet: "",
  parentPlatform: "telegram",
  channelMessageId: "4829",
  threadContinuations: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Visual Trigger-Condition-Action Builder & Sentiment / Cluster Evaluator
// ─────────────────────────────────────────────────────────────────────────────

export type CompoundTriggerType = "breaking_cluster" | "keyword_burst" | "schedule";
export type SentimentCondition = "any" | "negative_or_critical" | "positive" | "neutral";
export type CardActionStyle = "breaking_red" | "dark_editorial" | "brand_signature";
export type QueuePriority = "urgent" | "high" | "normal";

export interface CompoundAutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  /** تریگر آغازگر */
  triggerType: CompoundTriggerType;
  /** حداقل تعداد خبرگزاری/منبع مستقل در خوشه */
  minSources: number;
  /** حداکثر بازهٔ زمانی انتشار هم‌زمان (دقیقه) */
  withinMinutes: number;
  /** کلیدواژه‌های اختیاری */
  keywords: string[];
  /** شرط احساسات خبر */
  sentimentCondition: SentimentCondition;
  /** اقدام: استایل کارت گرافیکی */
  actionCardStyle: CardActionStyle;
  /** اقدام: اولویت در صف انتشار */
  actionPriority: QueuePriority;
  /** حالت خلبان خودکار: با تایید انسان یا کاملاً خودکار */
  autopilotMode: "human_in_loop" | "full_auto";
  /** پلتفرم‌های هدف */
  platforms: StudioPlatform[];
  /** حداقل فاصلهٔ ضد ازدحام (دقیقه) */
  antiFloodMinGapMinutes: number;
}

export interface AutopilotCandidate {
  id: string;
  ruleId: string;
  ruleName: string;
  clusterTitle: string;
  sources: string[];
  sourceCount: number;
  spanMinutes: number;
  sentiment: "critical" | "negative" | "neutral" | "positive";
  sentimentScore: number;
  cardStyle: CardActionStyle;
  priority: QueuePriority;
  platforms: StudioPlatform[];
  headline: string;
  summaryText: string;
  sourceLink: string;
  articleIds: string[];
  createdAt: number;
  status: "pending_approval" | "approved" | "dismissed";
}

export const DEFAULT_COMPOUND_RULES: CompoundAutomationRule[] = [
  {
    id: "crule-breaking-critical",
    name: "تشخیص خوشهٔ فوری و بحرانی (Breaking Cluster)",
    enabled: true,
    triggerType: "breaking_cluster",
    minSources: 3,
    withinMinutes: 20,
    keywords: [],
    sentimentCondition: "negative_or_critical",
    actionCardStyle: "breaking_red",
    actionPriority: "high",
    autopilotMode: "human_in_loop",
    platforms: ["telegram", "bale", "eitaa", "rubika", "twitter"],
    antiFloodMinGapMinutes: 20,
  },
  {
    id: "crule-multi-source-digest",
    name: "موج خبری چندمنبعی (پوشش هم‌زمان ۴+ رسانه)",
    enabled: true,
    triggerType: "breaking_cluster",
    minSources: 4,
    withinMinutes: 45,
    keywords: [],
    sentimentCondition: "any",
    actionCardStyle: "dark_editorial",
    actionPriority: "normal",
    autopilotMode: "human_in_loop",
    platforms: ["telegram", "twitter", "instagram", "linkedin"],
    antiFloodMinGapMinutes: 20,
  },
];

const CRITICAL_TERMS = [
  "فوری", "بحران", "انفجار", "حمله", "سقوط", "تحریم", "زلزله", "آتش‌سوزی", "هشدار",
  "تنش", "جنگ", "اضطراری", "کشته", "مجروح", "حادثه", "انسداد", "تعطیلی", "تورم",
  "crisis", "attack", "breaking", "emergency", "sanctions", "crash", "conflict", "strike", "war",
];

const NEGATIVE_TERMS = [
  "کاهش", "افت", "ریزش", "گرانی", "توقف", "اعتراض", "انتقاد", "شکست", "رکود",
  "کسری", "آلودگی", "نگرانی", "محدودیت", "اختلال", "فشار", "تهدید", "اتهام",
  "drop", "decline", "protest", "warning", "deficit", "threat", "disruption", "risk",
];

const POSITIVE_TERMS = [
  "رشد", "افزایش", "توافق", "افتتاح", "موفقیت", "پیروزی", "پیشرفت", "بهبود",
  "صادرات", "رکورد", "همکاری", "آغاز", "گشایش", "صلح", "ارزآوری", "نوآوری",
  "growth", "agreement", "success", "breakthrough", "peace", "record", "recovery",
];

export function detectArticleSentiment(
  title: string,
  preview?: string,
): { label: "critical" | "negative" | "neutral" | "positive"; score: number } {
  const text = `${title || ""} ${preview || ""}`.toLowerCase();
  let critHits = 0;
  let negHits = 0;
  let posHits = 0;

  for (const w of CRITICAL_TERMS) if (text.includes(w)) critHits++;
  for (const w of NEGATIVE_TERMS) if (text.includes(w)) negHits++;
  for (const w of POSITIVE_TERMS) if (text.includes(w)) posHits++;

  if (critHits >= 1) {
    return { label: "critical", score: -Math.min(1, 0.65 + critHits * 0.15) };
  }
  if (negHits > posHits) {
    return { label: "negative", score: -Math.min(0.85, 0.35 + negHits * 0.15) };
  }
  if (posHits > negHits) {
    return { label: "positive", score: Math.min(0.9, 0.35 + posHits * 0.15) };
  }
  return { label: "neutral", score: 0 };
}

const STOP_WORDS = new Set([
  "در", "به", "از", "که", "این", "آن", "را", "با", "بر", "تا", "است", "بود", "شد", "برای", "هم",
  "یک", "دو", "سه", "یا", "اما", "اگر", "بر", "طی", "پس", "هر", "وی", "او", "ما", "شما",
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "after",
]);

function tokenizeHeadline(text: string): Set<string> {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[.,،:;!?؟«»"'()\[\]{}…\-—–\/\\|]/g, " ")
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length >= 3 && !STOP_WORDS.has(t)),
  );
}

/**
 * Evaluates compound Trigger-Condition-Action rules against a pool of articles
 * and returns Human-in-the-Loop Autopilot candidates.
 */
export function evaluateCompoundRulesOnArticles(
  articles: Article[],
  rules: CompoundAutomationRule[],
  nowMs: number = Date.now(),
): AutopilotCandidate[] {
  const enabledRules = rules.filter(r => r.enabled);
  if (enabledRules.length === 0 || articles.length === 0) return [];

  const pool = articles.slice(0, 180);
  const tokens = pool.map(a => tokenizeHeadline(a.title));
  const used = new Set<number>();

  interface RawCluster {
    items: Article[];
    sources: string[];
    spanMinutes: number;
    sentiment: { label: "critical" | "negative" | "neutral" | "positive"; score: number };
  }

  const clusters: RawCluster[] = [];

  for (let i = 0; i < pool.length; i++) {
    if (used.has(i)) continue;
    const A = tokens[i];
    if (A.size < 2) continue;

    const group: Article[] = [pool[i]];
    used.add(i);

    for (let j = i + 1; j < pool.length; j++) {
      if (used.has(j)) continue;
      const B = tokens[j];
      if (B.size < 2) continue;
      let common = 0;
      for (const w of A) if (B.has(w)) common++;
      const jaccard = common / (A.size + B.size - common);
      if (jaccard >= 0.22 || common >= 2) {
        group.push(pool[j]);
        used.add(j);
      }
    }

    const uniqueSources = Array.from(new Set(group.map(g => g.source || "منبع خبری")));
    const timestamps = group
      .map(g => new Date(g.date || nowMs).getTime())
      .filter(ts => Number.isFinite(ts))
      .sort((a, b) => a - b);

    const rawSpan =
      timestamps.length >= 2
        ? Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 60000)
        : 8;
    // Clamp span for realistic live RSS feeds that might have slightly wider timestamps
    const spanMinutes = Math.max(2, Math.min(rawSpan, 180));

    const combinedTitle = group.map(g => g.title).join(" ");
    const combinedPreview = group.map(g => g.preview || "").join(" ");
    const sentiment = detectArticleSentiment(combinedTitle, combinedPreview);

    clusters.push({
      items: group,
      sources: uniqueSources,
      spanMinutes,
      sentiment,
    });
  }

  const candidates: AutopilotCandidate[] = [];

  for (const rule of enabledRules) {
    for (const cl of clusters) {
      const sourceCount = cl.sources.length;
      if (sourceCount < rule.minSources) continue;
      if (cl.spanMinutes > rule.withinMinutes) continue;

      if (rule.keywords.length > 0) {
        const blob = cl.items.map(i => `${i.title} ${i.preview || ""}`).join(" ").toLowerCase();
        const kwMatch = rule.keywords.some(k => blob.includes(k.toLowerCase()));
        if (!kwMatch) continue;
      }

      if (rule.sentimentCondition === "negative_or_critical") {
        if (cl.sentiment.label !== "critical" && cl.sentiment.label !== "negative") {
          continue;
        }
      } else if (rule.sentimentCondition === "positive") {
        if (cl.sentiment.label !== "positive") continue;
      } else if (rule.sentimentCondition === "neutral") {
        if (cl.sentiment.label !== "neutral") continue;
      }

      const lead = cl.items[0];
      const bulletPoints = cl.items
        .slice(0, 4)
        .map(it => `• ${it.title} (${it.source || "منبع"})`)
        .join("\n");

      const prefix =
        rule.actionCardStyle === "breaking_red" ? "🚨 خلاصهٔ فوری | " : "📌 گزارش چندمنبعی | ";

      candidates.push({
        id: `auto-${rule.id}-${lead.id}`,
        ruleId: rule.id,
        ruleName: rule.name,
        clusterTitle: lead.title,
        sources: cl.sources,
        sourceCount,
        spanMinutes: cl.spanMinutes,
        sentiment: cl.sentiment.label,
        sentimentScore: cl.sentiment.score,
        cardStyle: rule.actionCardStyle,
        priority: rule.actionPriority,
        platforms: rule.platforms,
        headline: `${prefix}${lead.title}`,
        summaryText: `${prefix}${lead.title}\n\nپوشش هم‌زمان در ${sourceCount} رسانه طی ${cl.spanMinutes} دقیقه:\n${bulletPoints}\n\n📡 منشأ اولیه: ${cl.sources[0] || "تحریریه"}`,
        sourceLink: lead.link || "",
        articleIds: cl.items.map(i => i.id),
        createdAt: nowMs,
        status: "pending_approval",
      });
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Smart Slot Recommender & Anti-Flood Limiter
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduledSlotItem {
  id: string;
  title: string;
  scheduledAt: number;
  priority?: QueuePriority;
  platforms?: StudioPlatform[];
}

export interface FloodConflict {
  itemAId: string;
  itemBId: string;
  itemATitle: string;
  itemBTitle: string;
  gapMinutes: number;
  requiredGapMinutes: number;
}

export interface SmartSlotRecommendation {
  ts: number;
  label: string;
  reason: string;
  engagementScore: number;
  gapFromNearestMin: number;
}

/**
 * Detects pairs of consecutively scheduled posts whose time gap is strictly
 * less than `minGapMinutes` (Anti-Flood violation).
 */
export function detectFloodConflicts(
  items: ScheduledSlotItem[],
  minGapMinutes: number = 20,
): FloodConflict[] {
  if (items.length < 2 || minGapMinutes <= 0) return [];
  const sorted = [...items].sort((a, b) => a.scheduledAt - b.scheduledAt);
  const conflicts: FloodConflict[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    // Urgent breaking posts are allowed to bypass standard spacing if explicitly marked urgent
    if (cur.priority === "urgent" || next.priority === "urgent") continue;

    const gapMin = Math.round((next.scheduledAt - cur.scheduledAt) / 60000);
    if (gapMin < minGapMinutes) {
      conflicts.push({
        itemAId: cur.id,
        itemBId: next.id,
        itemATitle: cur.title,
        itemBTitle: next.title,
        gapMinutes: Math.max(0, gapMin),
        requiredGapMinutes: minGapMinutes,
      });
    }
  }
  return conflicts;
}

/**
 * Redistributes scheduled queue items so that every consecutive non-urgent post
 * has at least `minGapMinutes` spacing (e.g. 20 minutes), preventing channel flooding.
 */
export function redistributeQueueAntiFlood(
  items: ScheduledSlotItem[],
  minGapMinutes: number = 20,
  nowMs: number = Date.now(),
): ScheduledSlotItem[] {
  if (items.length <= 1) return [...items];
  const minGapMs = Math.max(1, minGapMinutes) * 60000;

  const priorityRank: Record<QueuePriority, number> = {
    urgent: 0,
    high: 1,
    normal: 2,
  };

  const sorted = [...items].sort((a, b) => {
    const timeDiff = a.scheduledAt - b.scheduledAt;
    if (Math.abs(timeDiff) <= 5 * 60000) {
      const pA = priorityRank[a.priority || "normal"];
      const pB = priorityRank[b.priority || "normal"];
      if (pA !== pB) return pA - pB;
    }
    return timeDiff;
  });

  const result: ScheduledSlotItem[] = [];
  let lastNonUrgentTs = 0;

  for (const item of sorted) {
    const baseStart = Math.max(item.scheduledAt, nowMs + 5 * 60000);
    if (item.priority === "urgent") {
      result.push({ ...item, scheduledAt: baseStart });
      continue;
    }

    if (lastNonUrgentTs === 0) {
      result.push({ ...item, scheduledAt: baseStart });
      lastNonUrgentTs = baseStart;
    } else {
      const earliestAllowed = lastNonUrgentTs + minGapMs;
      const nextTs = Math.max(baseStart, earliestAllowed);
      result.push({ ...item, scheduledAt: nextTs });
      lastNonUrgentTs = nextTs;
    }
  }

  return result;
}

/**
 * Recommends optimal conflict-free publication time slots over the next 12 hours,
 * factoring in audience engagement windows and `minGapMinutes` anti-flood spacing.
 */
export function suggestSmartPublishSlots(
  existingScheduledTimestamps: number[],
  nowMs: number = Date.now(),
  minGapMinutes: number = 20,
  count: number = 4,
): SmartSlotRecommendation[] {
  const minGapMs = Math.max(5, minGapMinutes) * 60000;
  const stepMs = 15 * 60000; // evaluate every 15 minutes
  const firstCandidate = Math.ceil((nowMs + 10 * 60000) / stepMs) * stepMs;

  const candidates: SmartSlotRecommendation[] = [];

  for (let i = 0; i < 36; i++) {
    const candidateTs = firstCandidate + i * stepMs;

    // Check distance to nearest scheduled post
    let nearestDiffMs = Infinity;
    for (const existingTs of existingScheduledTimestamps) {
      const diff = Math.abs(candidateTs - existingTs);
      if (diff < nearestDiffMs) nearestDiffMs = diff;
    }

    if (nearestDiffMs < minGapMs) continue;

    const d = new Date(candidateTs);
    const hour = d.getHours();
    let score = 72;
    let reason = "فاصلهٔ ایمن از سایر پست‌ها (ضد ازدحام)";

    if (hour >= 8 && hour <= 10) {
      score = 96;
      reason = "اوج مطالعهٔ صبحگاهی مخاطبان + بدون تداخل";
    } else if (hour >= 12 && hour <= 14) {
      score = 91;
      reason = "پنجرهٔ اوج نیمروزی + فاصلهٔ استاندارد";
    } else if (hour >= 19 && hour <= 22) {
      score = 98;
      reason = "پرایم‌تایم شبانه شبکه‌های اجتماعی + بالاترین نرخ تعامل";
    } else if (hour >= 15 && hour <= 18) {
      score = 85;
      reason = "ترافیک عصرگاهی پایدار + کانال خلوت";
    }

    const gapFromNearestMin = Number.isFinite(nearestDiffMs)
      ? Math.round(nearestDiffMs / 60000)
      : 999;

    const timeStr = d.toLocaleTimeString("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    candidates.push({
      ts: candidateTs,
      label: `ساعت ${timeStr}`,
      reason,
      engagementScore: score,
      gapFromNearestMin,
    });
  }

  // Pick a diverse set: the earliest safe slot + highest engagement slots spaced apart
  const selected: SmartSlotRecommendation[] = [];
  for (const c of candidates) {
    if (selected.length === 0) {
      selected.push(c);
      continue;
    }
    const farEnoughFromSelected = selected.every(
      s => Math.abs(c.ts - s.ts) >= Math.max(minGapMs, 45 * 60000),
    );
    if (farEnoughFromSelected) {
      selected.push(c);
    }
    if (selected.length >= count) break;
  }

  return selected;
}
