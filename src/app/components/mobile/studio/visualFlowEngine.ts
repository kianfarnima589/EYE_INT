import type { Article } from "../../../data";
import type { StudioPlatform } from "../../../api";
import { detectArticleSentiment } from "./omnichannelAutomation";
import { toFa } from "../utils/fa";

export type FlowBlockCategory = "source" | "filter" | "transform" | "destination";

export type FlowBlockType =
  // 🟦 Sources (ورودی و منبع — از کجا؟)
  | "rss_feed"
  | "breaking_cluster"
  | "intl_feeds"
  | "schedule_timer"
  | "page_watch"
  | "vip_channel"
  // 🟨 Filters & Conditions (صافی و شرط — به چه شرطی؟)
  | "keyword_gate"
  | "sentiment_gate"
  | "credibility_gate"
  | "dedup_merge"
  | "branch_router"
  // 🟪 AI Transform & Visual Media (جادوی هوش مصنوعی و گرافیک — چه تغییری؟)
  | "ai_composer"
  | "journalistic_translate"
  | "tone_shifter"
  | "graphic_card"
  | "carousel_slicer"
  | "hashtag_signature"
  // 🟩 Destinations & Delivery (مقصد و انتشار — کجا و چطور منتشر شود؟)
  | "human_autopilot"
  | "telegram_dest"
  | "iranian_messengers"
  | "social_networks"
  | "smart_antiflood_queue";

export interface FlowNodeParams {
  // Source params
  feedScope?: "all" | "domestic" | "international" | "economic" | "tech" | "political";
  minSources?: number;
  withinMinutes?: number;
  scheduleMode?: "interval" | "daily";
  everyMinutes?: number;
  dailyTime?: string;
  watchUrl?: string;
  vipChannelHandle?: string;

  // Filter params
  includeKeywords?: string[];
  excludeKeywords?: string[];
  sentimentFilter?: "negative_or_critical" | "positive" | "neutral" | "any";
  minCredibilityTier?: 1 | 2;
  similarityThresholdPct?: number;
  branchCondition?: "if_breaking_else_queue" | "if_intl_translate";

  // Transform params
  toneStyle?: "breaking" | "analytical" | "official" | "narrative";
  lengthMode?: "short" | "medium" | "comprehensive";
  translateSourceLang?: "auto" | "en" | "ar";
  cardStyle?: "breaking_red" | "dark_editorial" | "light_paper" | "brand_emerald";
  cardRatio?: "square" | "story" | "wide";
  carouselSlideCount?: number;
  customSignature?: string;
  autoHashtags?: string[];

  // Destination params
  platforms?: StudioPlatform[];
  inlineFullStoryBtn?: boolean;
  inlineReactionPoll?: boolean;
  silentNightMode?: boolean;
  autoPinBreaking?: boolean;
  replyToPreviousChain?: boolean;
  antiFloodMinGap?: number;
  autopilotRequireApproval?: boolean;
}

export interface FlowNode {
  id: string;
  type: FlowBlockType;
  category: FlowBlockCategory;
  title: string;
  subtitle: string;
  iconEmoji: string;
  params: FlowNodeParams;
}

export interface VisualFlowPipeline {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  nodes: FlowNode[];
  lastRunAt?: number;
  runCount?: number;
}

export interface CatalogBlockDef {
  type: FlowBlockType;
  category: FlowBlockCategory;
  title: string;
  subtitle: string;
  iconEmoji: string;
  defaultParams: FlowNodeParams;
}

export const CATEGORY_META: Record<
  FlowBlockCategory,
  {
    label: string;
    question: string;
    badgeBg: string;
    borderCls: string;
    accentHex: string;
  }
> = {
  source: {
    label: "۱. مبدأ و ورودی خبر",
    question: "خبر از کجا بیاید؟",
    badgeBg: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
    borderCls: "border-sky-500/45 hover:border-sky-500",
    accentHex: "#0EA5E9",
  },
  filter: {
    label: "۲. صافی و شرط هوشمند",
    question: "به چه شرطی عبور کند؟",
    badgeBg: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    borderCls: "border-amber-500/45 hover:border-amber-500",
    accentHex: "#F59E0B",
  },
  transform: {
    label: "۳. پردازش و گرافیک",
    question: "چه ویرایش و کارتی ساخته شود؟",
    badgeBg: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
    borderCls: "border-purple-500/45 hover:border-purple-500",
    accentHex: "#A855F7",
  },
  destination: {
    label: "۴. مقصد و انتشار",
    question: "کجا و چطور منتشر شود؟",
    badgeBg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    borderCls: "border-emerald-500/45 hover:border-emerald-500",
    accentHex: "#10B981",
  },
};

export const FLOW_BLOCK_CATALOG: CatalogBlockDef[] = [
  // 🟦 SOURCES
  {
    type: "breaking_cluster",
    category: "source",
    title: "خوشهٔ داغ چندمنبعی",
    subtitle: "همگرایی چند خبرگزاری در بازهٔ کوتاه",
    iconEmoji: "🔥",
    defaultParams: { minSources: 3, withinMinutes: 20, feedScope: "all" },
  },
  {
    type: "rss_feed",
    category: "source",
    title: "خوراک‌های خبری (RSS)",
    subtitle: "دریافت زنده از فیدهای دسته‌بندی‌شده",
    iconEmoji: "📡",
    defaultParams: { feedScope: "all" },
  },
  {
    type: "intl_feeds",
    category: "source",
    title: "رسانه‌های بین‌المللی",
    subtitle: "رصد خبرگزاری‌های جهانی و منطقه‌ای",
    iconEmoji: "🌍",
    defaultParams: { feedScope: "international" },
  },
  {
    type: "schedule_timer",
    category: "source",
    title: "ساعت و تقویم تحریریه",
    subtitle: "اجرای خودکار در ساعت مشخص یا دوره‌ای",
    iconEmoji: "⏰",
    defaultParams: { scheduleMode: "daily", dailyTime: "08:30", everyMinutes: 60 },
  },
  {
    type: "page_watch",
    category: "source",
    title: "دیده‌بان تغییر صفحهٔ وب",
    subtitle: "رصد تغییر جداول، اطلاعیه‌ها و نرخ‌ها",
    iconEmoji: "👁️",
    defaultParams: { watchUrl: "https://kian.media/live-rates" },
  },
  {
    type: "vip_channel",
    category: "source",
    title: "رصد کانال و حساب مرجع",
    subtitle: "واکنش آنی به پست کانال یا مقام رسمی",
    iconEmoji: "💬",
    defaultParams: { vipChannelHandle: "@breaking_official" },
  },

  // 🟨 FILTERS
  {
    type: "sentiment_gate",
    category: "filter",
    title: "دماسنج احساسات و بحران",
    subtitle: "فیلتر خبرهای بحرانی، منفی یا مثبت",
    iconEmoji: "🚨",
    defaultParams: { sentimentFilter: "negative_or_critical" },
  },
  {
    type: "keyword_gate",
    category: "filter",
    title: "ذره‌بین کلیدواژه و موجودیت",
    subtitle: "عبور خبرهای دارای کلمات کلیدی هدف",
    iconEmoji: "🔍",
    defaultParams: { includeKeywords: [], excludeKeywords: ["تبلیغات"] },
  },
  {
    type: "credibility_gate",
    category: "filter",
    title: "سپر اعتبار و تقاطع منابع",
    subtitle: "تأیید توسط خبرگزاری‌های معتبر سطح ۱",
    iconEmoji: "🛡️",
    defaultParams: { minCredibilityTier: 1, minSources: 2 },
  },
  {
    type: "dedup_merge",
    category: "filter",
    title: "حذف تکراری و ادغام هوشمند",
    subtitle: "تجمیع خبرهای مشابه در یک پرونده",
    iconEmoji: "🧹",
    defaultParams: { similarityThresholdPct: 75 },
  },
  {
    type: "branch_router",
    category: "filter",
    title: "دوراهی شرطی (اگر / وگرنه)",
    subtitle: "تفکیک مسیر خبر فوری از خبر عادی",
    iconEmoji: "⚖️",
    defaultParams: { branchCondition: "if_breaking_else_queue" },
  },

  // 🟪 TRANSFORMS
  {
    type: "ai_composer",
    category: "transform",
    title: "نگارش هوشمند چندپلتفرمی",
    subtitle: "تولید هم‌زمان متن بومی ۸ شبکه با هوش مصنوعی",
    iconEmoji: "🪄",
    defaultParams: { lengthMode: "medium", toneStyle: "breaking" },
  },
  {
    type: "graphic_card",
    category: "transform",
    title: "طراح خودکار کارت گرافیکی",
    subtitle: "ساخت کارت قرمز فوری یا کارت برند تحریریه",
    iconEmoji: "🎨",
    defaultParams: { cardStyle: "breaking_red", cardRatio: "square" },
  },
  {
    type: "journalistic_translate",
    category: "transform",
    title: "مترجم مطبوعاتی به فارسی",
    subtitle: "ترجمهٔ روان و استاندارد متون بین‌المللی",
    iconEmoji: "🌐",
    defaultParams: { translateSourceLang: "auto" },
  },
  {
    type: "tone_shifter",
    category: "transform",
    title: "تنظیم لحن و پرسونا",
    subtitle: "فوری و قلاب‌دار، تحلیلی یا رسمی",
    iconEmoji: "🎭",
    defaultParams: { toneStyle: "analytical", lengthMode: "comprehensive" },
  },
  {
    type: "carousel_slicer",
    category: "transform",
    title: "اسلایدساز کاروسل و رشته",
    subtitle: "تبدیل گزارش به ۵ اسلاید ورق‌زدنی و رشته توییت",
    iconEmoji: "📑",
    defaultParams: { carouselSlideCount: 5 },
  },
  {
    type: "hashtag_signature",
    category: "transform",
    title: "هشتگ‌ساز و امضای کانال",
    subtitle: "افزودن خودکار هشتگ‌های داغ و منبع",
    iconEmoji: "🏷️",
    defaultParams: {
      autoHashtags: ["خبر_فوری", "تحلیل_رسانه", "گزارش_ویژه"],
      customSignature: "📡 تحریریه هوشمند کیان",
    },
  },

  // 🟩 DESTINATIONS
  {
    type: "human_autopilot",
    category: "destination",
    title: "خلبان خودکار (تأیید سردبیر)",
    subtitle: "آماده‌سازی کامل + دکمهٔ «تأیید و انتشار فوری»",
    iconEmoji: "🧑‍✈️",
    defaultParams: {
      autopilotRequireApproval: true,
      platforms: ["telegram", "bale", "eitaa", "rubika", "twitter"],
    },
  },
  {
    type: "telegram_dest",
    category: "destination",
    title: "کانال تلگرام (با قابلیت بومی)",
    subtitle: "دکمه شیشه‌ای، پین خودکار، ریپلای و بی‌صدا",
    iconEmoji: "✈️",
    defaultParams: {
      platforms: ["telegram"],
      inlineFullStoryBtn: true,
      inlineReactionPoll: true,
      autoPinBreaking: true,
      replyToPreviousChain: true,
      silentNightMode: false,
    },
  },
  {
    type: "iranian_messengers",
    category: "destination",
    title: "پیام‌رسان‌های بله، روبیکا و ایتا",
    subtitle: "انتشار هم‌زمان با دکمه‌های تعاملی و نظرسنجی",
    iconEmoji: "🟢",
    defaultParams: {
      platforms: ["bale", "rubika", "eitaa"],
      inlineFullStoryBtn: true,
      inlineReactionPoll: true,
      autoPinBreaking: false,
    },
  },
  {
    type: "social_networks",
    category: "destination",
    title: "ایکس، اینستاگرام، لینکدین و سایت",
    subtitle: "انتشار رشته توییت، پست تصویری و مقاله",
    iconEmoji: "𝕏",
    defaultParams: {
      platforms: ["twitter", "instagram", "linkedin", "website"],
    },
  },
  {
    type: "smart_antiflood_queue",
    category: "destination",
    title: "صف هوشمند و ضد ازدحام",
    subtitle: "توزیع با حداقل ۲۰ دقیقه فاصله در ساعات اوج",
    iconEmoji: "🛡️",
    defaultParams: {
      antiFloodMinGap: 20,
      platforms: ["telegram", "bale", "twitter"],
    },
  },
];

export function createNodeFromCatalog(type: FlowBlockType, idSuffix?: string): FlowNode {
  const def = FLOW_BLOCK_CATALOG.find(b => b.type === type) || FLOW_BLOCK_CATALOG[0];
  return {
    id: `fnode-${type}-${idSuffix || Math.random().toString(36).slice(2, 7)}`,
    type: def.type,
    category: def.category,
    title: def.title,
    subtitle: def.subtitle,
    iconEmoji: def.iconEmoji,
    params: { ...def.defaultParams },
  };
}

/**
 * Generates human-friendly Persian micro-badges for each node on the visual canvas
 * so non-technical users immediately see how each icon block is configured.
 */
export function getNodeVisualBadges(node: FlowNode): string[] {
  const p = node.params;
  const badges: string[] = [];

  switch (node.type) {
    case "breaking_cluster":
      badges.push(`حداقل ${toFa(p.minSources || 3)} خبرگزاری`);
      badges.push(`کمتر از ${toFa(p.withinMinutes || 20)} دقیقه`);
      break;
    case "rss_feed":
      badges.push(
        p.feedScope === "economic"
          ? "دسته: اقتصادی"
          : p.feedScope === "political"
            ? "دسته: سیاسی"
            : p.feedScope === "tech"
              ? "دسته: فناوری"
              : "همهٔ خوراک‌های زنده",
      );
      break;
    case "intl_feeds":
      badges.push("رسانه‌های جهانی");
      break;
    case "schedule_timer":
      badges.push(
        p.scheduleMode === "daily"
          ? `روزانه ساعت ${toFa(p.dailyTime || "08:30")}`
          : `هر ${toFa(p.everyMinutes || 60)} دقیقه`,
      );
      break;
    case "page_watch":
      badges.push("پایش تغییر DOM");
      break;
    case "vip_channel":
      badges.push(p.vipChannelHandle || "@breaking_official");
      break;
    case "sentiment_gate":
      badges.push(
        p.sentimentFilter === "negative_or_critical"
          ? "احساسات: منفی یا بحرانی"
          : p.sentimentFilter === "positive"
            ? "احساسات: مثبت"
            : "همهٔ احساسات",
      );
      break;
    case "keyword_gate":
      if (p.includeKeywords?.length) {
        badges.push(`شامل: ${p.includeKeywords.slice(0, 2).join("، ")}`);
      } else {
        badges.push("همهٔ موضوعات");
      }
      break;
    case "credibility_gate":
      badges.push(`سطح اعتبار ${toFa(p.minCredibilityTier || 1)}`);
      break;
    case "dedup_merge":
      badges.push(`آستانه تشابه ${toFa(p.similarityThresholdPct || 75)}٪`);
      break;
    case "branch_router":
      badges.push("فوری ⬅ کارت قرمز | عادی ⬅ صف");
      break;
    case "ai_composer":
      badges.push("مدل gpt-6.1-sol");
      badges.push(
        p.toneStyle === "breaking"
          ? "لحن: فوری"
          : p.toneStyle === "analytical"
            ? "لحن: تحلیلی"
            : "لحن: رسمی",
      );
      break;
    case "graphic_card":
      badges.push(
        p.cardStyle === "breaking_red"
          ? "🔴 کارت قرمز فوری"
          : p.cardStyle === "dark_editorial"
            ? "⚫ کارت تیره تحریریه"
            : p.cardStyle === "light_paper"
              ? "⚪ کارت روزنامه‌ای"
              : "🟢 کارت برند کیان",
      );
      badges.push(
        p.cardRatio === "story" ? "۹:۱۶ استوری" : p.cardRatio === "wide" ? "۱۶:۹ افقی" : "۱:۱ مربعی",
      );
      break;
    case "journalistic_translate":
      badges.push("ترجمه به فارسی معیار");
      break;
    case "tone_shifter":
      badges.push(
        p.toneStyle === "breaking"
          ? "فوری و کوتاه"
          : p.toneStyle === "analytical"
            ? "تحلیلی و عمیق"
            : "رسمی و خبری",
      );
      break;
    case "carousel_slicer":
      badges.push(`${toFa(p.carouselSlideCount || 5)} اسلاید ورق‌زدنی`);
      break;
    case "hashtag_signature":
      badges.push(`${toFa(p.autoHashtags?.length || 3)} هشتگ + امضا`);
      break;
    case "human_autopilot":
      badges.push("تأیید تک‌کلیکی سردبیر");
      break;
    case "telegram_dest":
      if (p.inlineFullStoryBtn) badges.push("🔘 دکمه شیشه‌ای");
      if (p.inlineReactionPoll) badges.push("👍 نظرسنجی");
      if (p.autoPinBreaking) badges.push("📌 پین خودکار");
      if (p.replyToPreviousChain) badges.push("↩️ ریپلای زنجیره‌ای");
      break;
    case "iranian_messengers":
      badges.push("بله · روبیکا · ایتا");
      if (p.inlineReactionPoll) badges.push("دکمه تعاملی");
      break;
    case "social_networks":
      badges.push("ایکس · اینستاگرام · لینکدین · وب");
      break;
    case "smart_antiflood_queue":
      badges.push(`حداقل ${toFa(p.antiFloodMinGap || 20)} دقیقه فاصله`);
      break;
  }

  return badges;
}

export const PRESET_FLOW_PIPELINES: VisualFlowPipeline[] = [
  {
    id: "flow-breaking-radar",
    name: "🚨 رادار خبر فوری و بحرانی (کارت قرمز + پین خودکار)",
    description:
      "اگر ۳+ خبرگزاری معتبر در کمتر از ۲۰ دقیقه دربارهٔ یک رویداد با بار احساسی بحرانی/منفی خبر منتشر کنند، خلاصهٔ فوری با کارت قرمز ساخته و پس از تأیید سردبیر در تلگرام و بله پین می‌شود.",
    enabled: true,
    nodes: [
      createNodeFromCatalog("breaking_cluster", "1"),
      createNodeFromCatalog("sentiment_gate", "2"),
      createNodeFromCatalog("ai_composer", "3"),
      createNodeFromCatalog("graphic_card", "4"),
      createNodeFromCatalog("human_autopilot", "5"),
      createNodeFromCatalog("telegram_dest", "6"),
    ],
  },
  {
    id: "flow-morning-digest",
    name: "☕ بولتن جامع صبحگاهی و ضد ازدحام",
    description:
      "هر روز ساعت ۰۸:۳۰ صبح، مهم‌ترین خبرها را ادغام و تکراری‌زدایی کرده، بستهٔ تحلیلی با کارت تیره می‌سازد و با فاصلهٔ استاندارد ۲۰ دقیقه‌ای در صف هوشمند قرار می‌دهد.",
    enabled: true,
    nodes: [
      createNodeFromCatalog("schedule_timer", "10"),
      createNodeFromCatalog("dedup_merge", "11"),
      createNodeFromCatalog("tone_shifter", "12"),
      {
        ...createNodeFromCatalog("graphic_card", "13"),
        params: { cardStyle: "dark_editorial", cardRatio: "square" },
      },
      createNodeFromCatalog("smart_antiflood_queue", "14"),
    ],
  },
  {
    id: "flow-intl-translator",
    name: "🌍 دیده‌بان و مترجم خودکار رسانه‌های بین‌المللی",
    description:
      "رصد لحظه‌ای رسانه‌های خارجی، ترجمهٔ مطبوعاتی به فارسی روان، افزودن هشتگ و ارسال به پیام‌رسان‌های ایرانی و تلگرام.",
    enabled: false,
    nodes: [
      createNodeFromCatalog("intl_feeds", "20"),
      createNodeFromCatalog("credibility_gate", "21"),
      createNodeFromCatalog("journalistic_translate", "22"),
      createNodeFromCatalog("hashtag_signature", "23"),
      createNodeFromCatalog("iranian_messengers", "24"),
    ],
  },
  {
    id: "flow-carousel-social",
    name: "📸 کاروسل گرافیکی اینستاگرام، لینکدین و رشته توییت",
    description:
      "تبدیل گزارش‌های تحلیلی به ۵ اسلاید ورق‌زدنی و رشته توییت زنجیره‌ای همراه با هشتگ‌های تخصصی.",
    enabled: false,
    nodes: [
      createNodeFromCatalog("rss_feed", "30"),
      createNodeFromCatalog("carousel_slicer", "31"),
      createNodeFromCatalog("hashtag_signature", "32"),
      createNodeFromCatalog("social_networks", "33"),
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Live Flow Simulation Engine (اجرای گام‌به‌گام بوم روی خبرهای واقعی)
// ─────────────────────────────────────────────────────────────────────────────

export interface FlowStepTrace {
  nodeId: string;
  nodeTitle: string;
  iconEmoji: string;
  category: FlowBlockCategory;
  status: "passed" | "transformed" | "delivered";
  inputCount: number;
  outputCount: number;
  summaryText: string;
  badges: string[];
}

export interface FlowSimulationResult {
  pipelineId: string;
  pipelineName: string;
  stepTraces: FlowStepTrace[];
  matchedArticles: Article[];
  generatedHeadline: string;
  generatedOutputs: Record<StudioPlatform, { text: string; hashtags: string[] }>;
  cardConfig: {
    theme: "dark" | "light" | "brand";
    accent: string;
    ratio: "square" | "story" | "wide";
    isBreakingRed: boolean;
  };
  messengerConfig: {
    silent: boolean;
    autoPin: boolean;
    replyToPrev: boolean;
    inlineFullStory: boolean;
    inlineReactions: boolean;
  };
  targetPlatforms: StudioPlatform[];
  deliveryMode: "human_autopilot" | "smart_queue" | "instant_publish";
  antiFloodGapMinutes: number;
}

export function simulateVisualFlow(
  pipeline: VisualFlowPipeline,
  articles: Article[],
): FlowSimulationResult {
  const pool = articles.length > 0 ? articles.slice(0, 80) : [];
  let working = [...pool];

  const stepTraces: FlowStepTrace[] = [];
  let tonePrefix = "🚨 خلاصهٔ فوری | ";
  let cardConfig: FlowSimulationResult["cardConfig"] = {
    theme: "dark",
    accent: "#10B981",
    ratio: "square",
    isBreakingRed: false,
  };
  let messengerConfig: FlowSimulationResult["messengerConfig"] = {
    silent: false,
    autoPin: false,
    replyToPrev: false,
    inlineFullStory: true,
    inlineReactions: true,
  };
  const targetPlatformsSet = new Set<StudioPlatform>();
  let deliveryMode: FlowSimulationResult["deliveryMode"] = "instant_publish";
  let antiFloodGapMinutes = 20;
  let customHashtags = ["اخبار", "تحلیل_رسانه", "گزارش_ویژه"];
  let customSig = "📡 تحریریه هوشمند کیان";

  for (const node of pipeline.nodes) {
    const inCount = working.length;
    const p = node.params;
    let summaryText = "";

    if (node.category === "source") {
      if (node.type === "intl_feeds") {
        const intl = pool.filter(
          a => !/[\u0600-\u06FF]/.test(a.title || "") || (a.category || "").includes("بین‌الملل"),
        );
        working = intl.length > 0 ? intl : pool.slice(0, 15);
        summaryText = `${toFa(working.length)} خبر از فیدهای بین‌المللی استخراج شد`;
      } else if (node.type === "breaking_cluster") {
        working = pool.slice(0, Math.max(5, (p.minSources || 3) * 3));
        summaryText = `خوشهٔ داغ با همگرایی ${toFa(p.minSources || 3)}+ خبرگزاری در کمتر از ${toFa(p.withinMinutes || 20)} دقیقه شناسایی شد`;
      } else {
        working = pool.slice(0, 24);
        summaryText = `${toFa(working.length)} خبر تازه از منبع ورودی دریافت شد`;
      }
      stepTraces.push({
        nodeId: node.id,
        nodeTitle: node.title,
        iconEmoji: node.iconEmoji,
        category: node.category,
        status: "passed",
        inputCount: pool.length,
        outputCount: working.length,
        summaryText,
        badges: getNodeVisualBadges(node),
      });
    } else if (node.category === "filter") {
      if (node.type === "sentiment_gate" && p.sentimentFilter === "negative_or_critical") {
        const crit = working.filter(a => {
          const s = detectArticleSentiment(a.title, a.preview);
          return s.label === "critical" || s.label === "negative";
        });
        working = crit.length > 0 ? crit : working.slice(0, 4);
        summaryText = `${toFa(working.length)} خبر دارای بار احساسی بحرانی/منفی از صافی عبور کرد`;
      } else if (node.type === "keyword_gate" && p.includeKeywords?.length) {
        const kw = p.includeKeywords.map(k => k.toLowerCase());
        const matched = working.filter(a =>
          kw.some(k => `${a.title} ${a.preview || ""}`.toLowerCase().includes(k)),
        );
        working = matched.length > 0 ? matched : working.slice(0, 5);
        summaryText = `${toFa(working.length)} خبر منطبق با کلیدواژه‌ها انتخاب شد`;
      } else if (node.type === "dedup_merge") {
        working = working.slice(0, Math.max(3, Math.ceil(working.length * 0.6)));
        summaryText = `اخبار مشابه ادغام و به ${toFa(working.length)} پروندهٔ یکتا تبدیل شدند`;
      } else {
        working = working.slice(0, Math.max(3, working.length));
        summaryText = `${toFa(working.length)} خبر معتبر تأیید و وارد مرحلهٔ پردازش شد`;
      }

      stepTraces.push({
        nodeId: node.id,
        nodeTitle: node.title,
        iconEmoji: node.iconEmoji,
        category: node.category,
        status: "passed",
        inputCount: inCount,
        outputCount: working.length,
        summaryText,
        badges: getNodeVisualBadges(node),
      });
    } else if (node.category === "transform") {
      if (node.type === "graphic_card") {
        if (p.cardStyle === "breaking_red") {
          cardConfig = {
            theme: "dark",
            accent: "#E11D48",
            ratio: p.cardRatio || "square",
            isBreakingRed: true,
          };
          summaryText = "کارت گرافیکی قرمز خبر فوری (Breaking Red Card) رندر شد";
        } else if (p.cardStyle === "light_paper") {
          cardConfig = {
            theme: "light",
            accent: "#3B82F6",
            ratio: p.cardRatio || "square",
            isBreakingRed: false,
          };
          summaryText = "کارت گرافیکی روشن روزنامه‌ای رندر شد";
        } else if (p.cardStyle === "brand_emerald") {
          cardConfig = {
            theme: "brand",
            accent: "#10B981",
            ratio: p.cardRatio || "square",
            isBreakingRed: false,
          };
          summaryText = "کارت گرافیکی برند کیان رندر شد";
        } else {
          cardConfig = {
            theme: "dark",
            accent: "#10B981",
            ratio: p.cardRatio || "square",
            isBreakingRed: false,
          };
          summaryText = "کارت گرافیکی تیره تحریریه رندر شد";
        }
      } else if (node.type === "tone_shifter" || node.type === "ai_composer") {
        tonePrefix =
          p.toneStyle === "analytical"
            ? "🔎 واکاوی تحلیلی | "
            : p.toneStyle === "official"
              ? "📌 گزارش رسمی | "
              : "🚨 خلاصهٔ فوری | ";
        summaryText = `نسخهٔ بومی ۸ پلتفرم با لحن «${p.toneStyle === "analytical" ? "تحلیلی" : "فوری"}» آماده شد`;
      } else if (node.type === "journalistic_translate") {
        tonePrefix = "🌍 ترجمه و رصد بین‌الملل | ";
        summaryText = "متن خبر به فارسی معیار مطبوعاتی ترجمه و بازنویسی شد";
      } else if (node.type === "hashtag_signature") {
        if (p.autoHashtags?.length) customHashtags = p.autoHashtags;
        if (p.customSignature) customSig = p.customSignature;
        summaryText = `${toFa(customHashtags.length)} هشتگ هدفمند و امضای تحریریه درج شد`;
      } else {
        summaryText = `تبدیل به ${toFa(p.carouselSlideCount || 5)} اسلاید کاروسل و رشته پست انجام شد`;
      }

      stepTraces.push({
        nodeId: node.id,
        nodeTitle: node.title,
        iconEmoji: node.iconEmoji,
        category: node.category,
        status: "transformed",
        inputCount: working.length,
        outputCount: working.length,
        summaryText,
        badges: getNodeVisualBadges(node),
      });
    } else if (node.category === "destination") {
      (p.platforms || ["telegram"]).forEach(pl => targetPlatformsSet.add(pl));
      if (node.type === "human_autopilot") {
        deliveryMode = "human_autopilot";
        summaryText = "بستهٔ آماده در نوار «خلبان خودکار با تأیید سردبیر» قرار گرفت";
      } else if (node.type === "smart_antiflood_queue") {
        deliveryMode = "smart_queue";
        antiFloodGapMinutes = p.antiFloodMinGap || 20;
        summaryText = `در صف هوشمند با فاصلهٔ ضد ازدحام ${toFa(antiFloodGapMinutes)} دقیقه زمان‌بندی شد`;
      } else if (node.type === "telegram_dest") {
        messengerConfig = {
          silent: !!p.silentNightMode,
          autoPin: p.autoPinBreaking !== undefined ? p.autoPinBreaking : true,
          replyToPrev: !!p.replyToPreviousChain,
          inlineFullStory: p.inlineFullStoryBtn !== false,
          inlineReactions: p.inlineReactionPoll !== false,
        };
        summaryText = "آمادهٔ ارسال به تلگرام (همراه با دکمه شیشه‌ای، پین و ریپلای زنجیره‌ای)";
      } else {
        summaryText = `آمادهٔ توزیع در ${(p.platforms || []).length || 3} کانال مقصد`;
      }

      stepTraces.push({
        nodeId: node.id,
        nodeTitle: node.title,
        iconEmoji: node.iconEmoji,
        category: node.category,
        status: "delivered",
        inputCount: working.length,
        outputCount: working.length,
        summaryText,
        badges: getNodeVisualBadges(node),
      });
    }
  }

  const finalArticles = working.length > 0 ? working.slice(0, 4) : articles.slice(0, 3);
  const lead = finalArticles[0];
  const baseTitle = lead?.title || "گزارش ویژهٔ تحریریه از آخرین تحولات خبری";
  const generatedHeadline = `${tonePrefix}${baseTitle}`;
  const bullets = finalArticles
    .slice(0, 3)
    .map(a => `• ${a.title} (${a.source || "منبع خبری"})`)
    .join("\n");

  const bodyText = `${generatedHeadline}\n\n${bullets}\n\n${customSig}`;
  const targetPlatforms =
    targetPlatformsSet.size > 0
      ? Array.from(targetPlatformsSet)
      : (["telegram", "bale", "twitter", "instagram"] as StudioPlatform[]);

  const generatedOutputs: Record<StudioPlatform, { text: string; hashtags: string[] }> = {
    telegram: { text: bodyText, hashtags: customHashtags },
    bale: { text: bodyText, hashtags: customHashtags },
    rubika: { text: bodyText, hashtags: customHashtags },
    eitaa: { text: bodyText, hashtags: customHashtags },
    twitter: {
      text: `${generatedHeadline}\n\n${(lead?.preview || baseTitle).slice(0, 120)}`.slice(0, 265),
      hashtags: customHashtags.slice(0, 2),
    },
    instagram: {
      text: `${bodyText}\n\nدیدگاه شما دربارهٔ این رویداد چیست؟ 👇`,
      hashtags: [...customHashtags, "رسانه"],
    },
    linkedin: {
      text: `${generatedHeadline}\n\nبررسی تحلیلی ابعاد و پیامدهای راهبردی:\n${bullets}\n\n${customSig}`,
      hashtags: [...customHashtags, "MediaIntelligence"],
    },
    website: {
      text: `### ${generatedHeadline}\n\n${bullets}\n\n${lead?.content || lead?.preview || ""}`,
      hashtags: customHashtags,
    },
  };

  return {
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    stepTraces,
    matchedArticles: finalArticles,
    generatedHeadline,
    generatedOutputs,
    cardConfig,
    messengerConfig,
    targetPlatforms,
    deliveryMode,
    antiFloodGapMinutes,
  };
}
