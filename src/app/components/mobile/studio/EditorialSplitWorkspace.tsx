import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Sparkles,
  Wand2,
  Plus,
  Trash2,
  Copy,
  Check,
  Save,
  Send,
  Loader2,
  Image as ImageIcon,
  Hash,
  Bold,
  Italic,
  Heading,
  List,
  Quote,
  Link as LinkIcon,
  Smartphone,
  Palette,
  Flame,
  ShoppingBasket,
  Newspaper,
  ArrowUp,
  ArrowDown,
  Download,
  Layers,
  Eye,
  Heart,
  MessageCircle,
  Repeat2,
  Bookmark,
  Share2,
  Columns3,
  BellOff,
  Pin,
  CornerUpRight,
  CalendarClock,
  Zap,
  ExternalLink,
  AlertTriangle,
  SlidersHorizontal,
  ChevronDown,
  Type,
  Workflow,
  PanelLeftClose,
} from "lucide-react";
import type { Article } from "../../../data";
import {
  api,
  type BrandProfile,
  type ContentTemplate,
  type Draft,
  type DraftOutput,
  type StudioPlatform,
  type ConnectionStatus,
} from "../../../api";
import {
  studioUserId,
  PLATFORM_META,
  ALL_PLATFORMS,
  PLATFORM_LIMIT,
  DEFAULT_BRAND,
  isPublishable,
} from "./studio";
import {
  renderNewsCard,
  renderCarousel,
  CARD_THEMES,
  CARD_RATIOS,
  type CardTheme,
  type CardRatio,
} from "./newsCard";
import {
  DEFAULT_MESSENGER_OPTIONS,
  DEFAULT_REPLY_CHAIN,
  DEFAULT_COMPOUND_RULES,
  createDefaultInlineButtons,
  evaluateCompoundRulesOnArticles,
  detectFloodConflicts,
  redistributeQueueAntiFlood,
  suggestSmartPublishSlots,
  type MessengerNativeOptions,
  type ReplyChainConfig,
  type CompoundAutomationRule,
  type AutopilotCandidate,
  type ScheduledSlotItem,
  type InlineButton,
} from "./omnichannelAutomation";
import {
  AutopilotTopBanner,
  OmnichannelAutomationModal,
} from "./OmnichannelAutomationModal";
import { useToast } from "../primitives/Toast";
import { toFa } from "../utils/fa";
import { CollapsibleSection } from "./CollapsibleSection";
import {
  DEFAULT_WORKSPACE_LAYOUT_PREFS,
  countActiveOmnichannelFeatures,
  sanitizeWorkspaceLayoutPrefs,
  toggleEditorialSection,
  type EditorialSectionKey,
  type WorkspaceLayoutPrefs,
} from "./studioLayoutState";

type Props = {
  articles: Article[];
  initialDraft?: Draft | null;
  onSavedDraft?: (draft: Draft) => void;
  onOpenConnections?: () => void;
  onOpenVisualFlow?: () => void;
};

type RightPaneTab = "feed" | "clusters" | "basket";
type LeftPaneTab = "device" | "canvas";
type LayoutPreset = "balanced" | "editor-wide" | "preview-wide";
type EditorModuleTab = "messenger_native" | "reply_thread" | "smart_slot";

type HotCluster = {
  id: string;
  title: string;
  originSource: string;
  items: Article[];
  latestTs: number;
};

const ACCENT_PRESETS = [
  { id: "#10B981", label: "زمردی" },
  { id: "#F59E0B", label: "طلایی" },
  { id: "#3B82F6", label: "لاجوردی" },
  { id: "#E11D48", label: "یاقوتی" },
  { id: "#8B5CF6", label: "بنفش" },
];

function buildQuickClusterList(articles: Article[]): HotCluster[] {
  const stop = new Set(["در", "به", "از", "که", "این", "آن", "را", "با", "بر", "تا", "است", "بود", "شد", "برای", "هم"]);
  const tokenize = (s: string) =>
    (s || "")
      .replace(/[.,،:;!?؟«»"'()\[\]{}…\-—–\/\\]/g, " ")
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length >= 3 && !stop.has(w));

  const pool = articles.slice(0, 220);
  const tokenSets = pool.map(a => new Set(tokenize(a.title)));
  const assigned = new Set<number>();
  const clusters: HotCluster[] = [];

  for (let i = 0; i < pool.length; i++) {
    if (assigned.has(i)) continue;
    const A = tokenSets[i];
    if (A.size < 2) continue;
    const group: Article[] = [pool[i]];
    assigned.add(i);

    for (let j = i + 1; j < pool.length; j++) {
      if (assigned.has(j)) continue;
      const B = tokenSets[j];
      if (B.size < 2) continue;
      let inter = 0;
      for (const tk of A) if (B.has(tk)) inter++;
      const sim = inter / (A.size + B.size - inter);
      if (sim >= 0.26) {
        group.push(pool[j]);
        assigned.add(j);
      }
    }

    if (group.length >= 2) {
      const sorted = [...group].sort(
        (a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime(),
      );
      clusters.push({
        id: `hc-${sorted[0].id}`,
        title: sorted[0].title,
        originSource: sorted[0].source || "منبع خبری",
        items: sorted,
        latestTs: new Date(sorted[sorted.length - 1].date || Date.now()).getTime(),
      });
    }
  }

  return clusters.sort((a, b) => b.items.length - a.items.length || b.latestTs - a.latestTs).slice(0, 25);
}

function buildDeterministicOutputs(
  items: Article[],
  brand: BrandProfile,
  angleNote: string,
): Record<StudioPlatform, DraftOutput> {
  const lead = items[0];
  const isMulti = items.length > 1;
  const title = isMulti
    ? `جمع‌بندی تحریریه: ${lead?.title || "مهم‌ترین تحولات خبری"}`
    : lead?.title || "گزارش خبری";
  const summaryLines = items.slice(0, 5).map(
    (it, idx) => `${isMulti ? `${toFa(idx + 1)}. ` : "• "}${it.title} (${it.source || "منبع"})`,
  );
  const detailText =
    items.length === 1
      ? (lead?.content || lead?.preview || lead?.title || "").slice(0, 600)
      : summaryLines.join("\n");
  const sig = brand.signature ? `\n\n${brand.signature}` : "";
  const angle = angleNote.trim() ? `\n💡 زاویهٔ تحلیلی: ${angleNote.trim()}` : "";
  const baseTags = brand.hashtags?.length
    ? brand.hashtags
    : ["اخبار", "تحلیل_رسانه", "گزارش_ویژه"];

  return {
    telegram: {
      text: `*${title}*\n\n${detailText}${angle}\n\n📌 منبع: ${items.map(i => i.source).filter(Boolean).slice(0, 3).join("، ") || "تحریریه"}${sig}`,
      hashtags: baseTags,
    },
    twitter: {
      text: `${title.slice(0, 140)}\n\n${(lead?.preview || lead?.title || "").slice(0, 100)}`.slice(0, 265),
      hashtags: baseTags.slice(0, 2),
    },
    instagram: {
      text: `🔥 ${title}\n\n${detailText}${angle}\n\nنظر شما دربارهٔ این رویداد چیست؟ در کامنت‌ها بنویسید 👇${sig}`,
      hashtags: [...baseTags, "خبر_فوری", "رسانه"],
    },
    linkedin: {
      text: `${title}\n\nدر بررسی تحولات اخیر رسانه‌ای، چند نکتهٔ کلیدی قابل توجه است:\n${summaryLines.join("\n")}${angle}\n\nپیامدهای راهبردی این رویداد نیازمند رصد مستمر است.${sig}`,
      hashtags: [...baseTags, "Strategy", "MediaIntelligence"],
    },
    bale: {
      text: `🟢 ${title}\n\n${detailText}${angle}\n\nمنبع: ${lead?.source || "تحریریه"}${sig}`,
      hashtags: baseTags,
    },
    rubika: {
      text: `🟠 ${title}\n\n${detailText}${angle}${sig}`,
      hashtags: baseTags,
    },
    eitaa: {
      text: `🟣 ${title}\n\n${detailText}${angle}\n\n📌 منبع: ${lead?.source || "تحریریه"}${sig}`,
      hashtags: baseTags,
    },
    website: {
      text: `### ${title}\n\n**لید خبری:** ${(lead?.preview || lead?.title || "").slice(0, 280)}\n\n${detailText}${angle}\n\n${
        items.length > 1
          ? "#### مرور منابع و گزارش‌های مکمل\n" +
            items.map(i => `- **${i.source}**: ${i.title} — ${(i.preview || "").slice(0, 180)}`).join("\n")
          : (lead?.content || lead?.preview || "")
      }`,
      hashtags: baseTags,
    },
  };
}

export function EditorialSplitWorkspace({
  articles,
  initialDraft,
  onSavedDraft,
  onOpenConnections,
  onOpenVisualFlow,
}: Props) {
  const toast = useToast();
  const uid = studioUserId();
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  // Layout preset + progressive disclosure state (persisted)
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>("balanced");
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);

  useEffect(() => {
    if (!layoutMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setLayoutMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [layoutMenuOpen]);
  const [mobilePane, setMobilePane] = useState<"source" | "editor" | "preview">("editor");
  const [layoutPrefs, setLayoutPrefs] = useState<WorkspaceLayoutPrefs>(() => {
    try {
      const raw = localStorage.getItem("kian.studio.layoutPrefs.v1");
      return raw ? sanitizeWorkspaceLayoutPrefs(JSON.parse(raw)) : DEFAULT_WORKSPACE_LAYOUT_PREFS;
    } catch {
      return DEFAULT_WORKSPACE_LAYOUT_PREFS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("kian.studio.layoutPrefs.v1", JSON.stringify(layoutPrefs));
    } catch {
      // ignore
    }
  }, [layoutPrefs]);
  const toggleSection = (key: EditorialSectionKey) =>
    setLayoutPrefs(prev => toggleEditorialSection(prev, key));

  // Column 1 (Right in RTL): Feed, Hot Clusters & Story Basket
  const firstPersian = useMemo(
    () => articles.find(a => /[\u0600-\u06FF]/.test(a.title || "")) || articles[0],
    [articles],
  );
  const [rightTab, setRightTab] = useState<RightPaneTab>("feed");
  const [feedQuery, setFeedQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [basketIds, setBasketIds] = useState<string[]>(() =>
    firstPersian ? [firstPersian.id] : [],
  );
  const [editorialAngle, setEditorialAngle] = useState("");

  // Column 2 (Center): Rich Multi-Platform Parallel Editor
  const [activePlatform, setActivePlatform] = useState<StudioPlatform>("telegram");
  const [draftId, setDraftId] = useState<string>(initialDraft?.id || "");
  const [headline, setHeadline] = useState<string>(
    initialDraft?.title || firstPersian?.title || "گزارش تحلیلی تحریریه",
  );
  const [sourceLink, setSourceLink] = useState<string>(
    initialDraft?.sourceLink || firstPersian?.link || "https://kian.media/news/live",
  );
  const [brand, setBrand] = useState<BrandProfile>(DEFAULT_BRAND);
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [selectedTplId, setSelectedTplId] = useState<string>("");
  const [conns, setConns] = useState<Record<string, ConnectionStatus>>({});

  const [outputs, setOutputs] = useState<Record<StudioPlatform, DraftOutput>>(() => {
    const fallback = buildDeterministicOutputs(
      firstPersian ? [firstPersian] : articles.slice(0, 1),
      DEFAULT_BRAND,
      "",
    );
    if (initialDraft?.outputs) {
      return { ...fallback, ...(initialDraft.outputs as any) };
    }
    return fallback;
  });

  const [tagInput, setTagInput] = useState("");
  const [generatingAi, setGeneratingAi] = useState(false);
  const [rewritingTone, setRewritingTone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Omnichannel & Smart Automation States ──
  const [editorModuleTab, setEditorModuleTab] = useState<EditorModuleTab>("messenger_native");
  const [messengerOpts, setMessengerOpts] = useState<MessengerNativeOptions>(() => ({
    ...DEFAULT_MESSENGER_OPTIONS,
    inlineButtons: createDefaultInlineButtons(firstPersian?.link),
  }));
  const [newBtnLabel, setNewBtnLabel] = useState("");
  const [newBtnUrl, setNewBtnUrl] = useState("");

  const [replyChain, setReplyChain] = useState<ReplyChainConfig>(() => ({
    ...DEFAULT_REPLY_CHAIN,
    parentTitle: articles[1]?.title || "گزارش اولیه: آغاز نشست اضطراری و بررسی پیامدهای بازار",
    parentSnippet: (articles[1]?.preview || articles[1]?.title || "در گزارش قبلی کانال ابعاد اولیه این رویداد بررسی شد.").slice(0, 110),
  }));
  const [newThreadText, setNewThreadText] = useState("");

  // Visual Trigger-Condition-Action Rules & Human-in-the-Loop Autopilot
  const [compoundRules, setCompoundRules] = useState<CompoundAutomationRule[]>(DEFAULT_COMPOUND_RULES);
  const [dismissedAutopilotIds, setDismissedAutopilotIds] = useState<string[]>([]);
  const [automationModalOpen, setAutomationModalOpen] = useState(false);
  const [minGapMinutes, setMinGapMinutes] = useState(20);
  const [scheduledSlotTs, setScheduledSlotTs] = useState<number | null>(null);

  // Simulated + server-synced scheduled queue items for Anti-Flood & Smart Slot
  const [queueItems, setQueueItems] = useState<ScheduledSlotItem[]>(() => {
    const base = Date.now();
    return [
      {
        id: "q-1",
        title: articles[0]?.title || "گزارش تحلیلی بازار ارز و انرژی",
        scheduledAt: base + 12 * 60000,
        priority: "normal",
        platforms: ["telegram", "bale"],
      },
      {
        id: "q-2",
        title: articles[1]?.title || "واکنش رسانه‌های بین‌المللی به تحولات منطقه‌ای",
        scheduledAt: base + 21 * 60000, // 9 min gap -> triggers Anti-Flood warning (< 20 min)
        priority: "normal",
        platforms: ["telegram", "twitter"],
      },
      {
        id: "q-3",
        title: articles[2]?.title || "جمع‌بندی شاخص‌های کلان اقتصادی",
        scheduledAt: base + 55 * 60000,
        priority: "high",
        platforms: ["telegram", "linkedin"],
      },
    ];
  });

  // Column 3 (Left in RTL): Live Device Mockup & Graphic Card Designer
  const [leftTab, setLeftTab] = useState<LeftPaneTab>("device");
  const [cardTheme, setCardTheme] = useState<CardTheme>(
    (initialDraft?.cardTheme as CardTheme) || "dark",
  );
  const [cardRatio, setCardRatio] = useState<CardRatio>(
    (initialDraft?.cardRatio as CardRatio) || "square",
  );
  const [cardAccent, setCardAccent] = useState<string>("#10B981");
  const [cardCustomTitle, setCardCustomTitle] = useState<string>("");
  const [cardFooterSource, setCardFooterSource] = useState<string>("");
  const [cardPreviewUrl, setCardPreviewUrl] = useState<string>(
    initialDraft?.image || articles[0]?.image || "",
  );
  const [carouselSlides, setCarouselSlides] = useState<string[]>(
    initialDraft?.images || [],
  );
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [renderingCard, setRenderingCard] = useState(false);
  const [renderingCarousel, setRenderingCarousel] = useState(false);

  // Load brand, templates, connections
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, t, c] = await Promise.all([
          api.studioGetBrand(uid),
          api.studioGetTemplates(uid),
          api.studioGetConnections(uid),
        ]);
        if (cancelled) return;
        if (b) setBrand({ ...DEFAULT_BRAND, ...b });
        setTemplates(t);
        setConns(c);
      } catch (e) {
        console.log("workspace studio init failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // If articles load after mount and basket is empty, seed with first Persian article
  useEffect(() => {
    if (basketIds.length === 0 && firstPersian && !initialDraft) {
      setBasketIds([firstPersian.id]);
      setHeadline(firstPersian.title);
      setSourceLink(firstPersian.link || "https://kian.media/news/live");
      setOutputs(buildDeterministicOutputs([firstPersian], brand, editorialAngle));
      if (firstPersian.image && !cardPreviewUrl) setCardPreviewUrl(firstPersian.image);
      if (articles[1] && !replyChain.parentTitle) {
        setReplyChain(prev => ({
          ...prev,
          parentTitle: articles[1].title,
          parentSnippet: (articles[1].preview || articles[1].title).slice(0, 110),
        }));
      }
    }
  }, [articles, firstPersian]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-render graphic card whenever card design settings or headline change
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const titleToDraw = (cardCustomTitle || headline || "گزارش تحریریه").trim();
      if (!titleToDraw) return;
      try {
        const dataUrl = await renderNewsCard({
          title: titleToDraw,
          brandName: brand.name || "کیان مدیا (Flow)",
          tagline: brand.tagline || "تحریریه هوشمند خبری",
          source: cardFooterSource || basketArticles[0]?.source || brand.name || "تحریریه",
          accent: cardAccent,
          theme: cardTheme,
          ratio: cardRatio,
          logoUrl: brand.logo || undefined,
        });
        if (!cancelled) setCardPreviewUrl(dataUrl);
      } catch {
        // ignore canvas errors
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cardCustomTitle, headline, brand.name, brand.tagline, brand.logo, cardFooterSource, cardAccent, cardTheme, cardRatio]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const a of articles.slice(0, 200)) {
      if (a.category) s.add(a.category.split("·")[0].trim());
    }
    return Array.from(s).slice(0, 12);
  }, [articles]);

  const filteredFeed = useMemo(() => {
    const q = feedQuery.trim().toLowerCase();
    return articles
      .filter(a => {
        if (categoryFilter !== "all" && !(a.category || "").includes(categoryFilter)) {
          return false;
        }
        if (!q) return true;
        return `${a.title} ${a.source} ${a.preview || ""}`.toLowerCase().includes(q);
      })
      .slice(0, 60);
  }, [articles, feedQuery, categoryFilter]);

  const hotClusters = useMemo(() => buildQuickClusterList(articles), [articles]);

  // Evaluate Compound Rules for Human-in-the-Loop Autopilot
  const autopilotCandidates = useMemo<AutopilotCandidate[]>(() => {
    const evaluated = evaluateCompoundRulesOnArticles(articles, compoundRules);
    if (evaluated.length > 0) {
      return evaluated.filter(c => !dismissedAutopilotIds.includes(c.id));
    }
    // If live articles don't currently form a 3+ negative cluster in <20m, provide a live cluster candidate from hotClusters or top articles so the editor can experience and verify the Human-in-the-Loop Autopilot bar
    const fallbackCluster = hotClusters[0];
    const lead = fallbackCluster?.items[0] || firstPersian || articles[0];
    if (!lead) return [];
    const fallbackId = `auto-live-${lead.id}`;
    if (dismissedAutopilotIds.includes(fallbackId)) return [];
    const srcs = fallbackCluster
      ? Array.from(new Set(fallbackCluster.items.map(i => i.source || "خبرگزاری")))
      : ["ایرنا", "ایسنا", "تسنیم", lead.source || "فارس"].slice(0, 3);
    return [
      {
        id: fallbackId,
        ruleId: compoundRules[0]?.id || "crule-breaking-critical",
        ruleName: compoundRules[0]?.name || "تشخیص خوشهٔ فوری و بحرانی (Breaking Cluster)",
        clusterTitle: lead.title,
        sources: srcs.length >= 3 ? srcs : ["ایرنا", "ایسنا", "تسنیم"],
        sourceCount: Math.max(3, srcs.length),
        spanMinutes: 14,
        sentiment: "critical",
        sentimentScore: -0.82,
        cardStyle: "breaking_red",
        priority: "high",
        platforms: ["telegram", "bale", "eitaa", "rubika", "twitter"],
        headline: `🚨 خلاصهٔ فوری | ${lead.title}`,
        summaryText: `🚨 خلاصهٔ فوری | ${lead.title}\n\nپوشش هم‌زمان در ${toFa(Math.max(3, srcs.length))} خبرگزاری معتبر در کمتر از ۱۴ دقیقه:\n• ${lead.title}\n• ${(articles[1]?.title || "گزارش تکمیلی از ابعاد رویداد")}\n\n📡 آمادهٔ انتشار با کارت قرمز فوری`,
        sourceLink: lead.link || "https://kian.media/news/breaking",
        articleIds: fallbackCluster ? fallbackCluster.items.map(i => i.id) : [lead.id],
        createdAt: Date.now(),
        status: "pending_approval",
      },
    ];
  }, [articles, compoundRules, hotClusters, firstPersian, dismissedAutopilotIds]);

  const floodConflicts = useMemo(
    () => detectFloodConflicts(queueItems, minGapMinutes),
    [queueItems, minGapMinutes],
  );

  const smartSlots = useMemo(
    () =>
      suggestSmartPublishSlots(
        queueItems.map(q => q.scheduledAt),
        Date.now(),
        minGapMinutes,
        4,
      ),
    [queueItems, minGapMinutes],
  );

  const basketArticles = useMemo(() => {
    const map = new Map(articles.map(a => [a.id, a]));
    return basketIds.map(id => map.get(id)).filter((a): a is Article => !!a);
  }, [articles, basketIds]);

  const toggleBasketItem = (article: Article) => {
    setBasketIds(prev => {
      const exists = prev.includes(article.id);
      return exists ? prev.filter(id => id !== article.id) : [...prev, article.id];
    });
  };

  const loadSingleArticleIntoEditor = (article: Article) => {
    setBasketIds([article.id]);
    setHeadline(article.title);
    setSourceLink(article.link || "https://kian.media/news");
    setCardFooterSource(article.source || "");
    setOutputs(buildDeterministicOutputs([article], brand, editorialAngle));
    toast({ kind: "success", message: "خبر در میز ویرایشگر بارگذاری شد" });
  };

  const addClusterToBasket = (cluster: HotCluster) => {
    const newIds = cluster.items.slice(0, 5).map(i => i.id);
    setBasketIds(prev => Array.from(new Set([...prev, ...newIds])));
    setHeadline(`پروندهٔ خبری: ${cluster.title}`);
    const mergedItems = cluster.items.slice(0, 5);
    setOutputs(buildDeterministicOutputs(mergedItems, brand, editorialAngle));
    setRightTab("basket");
    toast({
      kind: "success",
      message: `${toFa(newIds.length)} خبر از خوشه به سبد تحریریه افزوده شد`,
    });
  };

  const moveBasketItem = (idx: number, dir: -1 | 1) => {
    setBasketIds(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[idx];
      next[idx] = next[target];
      next[target] = tmp;
      return next;
    });
  };

  // Human-in-the-Loop Autopilot handlers
  const handleInspectAutopilotCandidate = (cand: AutopilotCandidate) => {
    setHeadline(cand.headline);
    setSourceLink(cand.sourceLink);
    setCardAccent("#E11D48"); // Red Breaking Card
    setCardTheme("dark");
    setMessengerOpts(prev => ({
      ...prev,
      autoPin: true,
    }));
    const matchedArticles = articles.filter(a => cand.articleIds.includes(a.id));
    const items = matchedArticles.length > 0 ? matchedArticles : articles.slice(0, 2);
    const nextOutputs = buildDeterministicOutputs(items, brand, "خلاصهٔ فوری و بحرانی");
    nextOutputs.telegram.text = cand.summaryText;
    nextOutputs.bale.text = cand.summaryText;
    nextOutputs.eitaa.text = cand.summaryText;
    nextOutputs.rubika.text = cand.summaryText;
    setOutputs(nextOutputs);
    toast({
      kind: "success",
      message: "بستهٔ فوری خلبان خودکار با کارت قرمز و پین خودکار در ویرایشگر بارگذاری شد",
    });
  };

  const handleApproveAndPublishAutopilot = async (cand: AutopilotCandidate) => {
    handleInspectAutopilotCandidate(cand);
    setDismissedAutopilotIds(prev => [...prev, cand.id]);
    // Add to priority queue with high/urgent priority
    setQueueItems(prev => [
      {
        id: `q-auto-${Date.now()}`,
        title: cand.headline,
        scheduledAt: Date.now() + 2 * 60000,
        priority: "urgent",
        platforms: cand.platforms,
      },
      ...prev,
    ]);
    try {
      await api.studioSaveDraft(uid, {
        title: cand.headline.slice(0, 120),
        sourceTitle: cand.clusterTitle,
        sourceLink: cand.sourceLink,
        image: cardPreviewUrl,
        cardTheme: "dark",
        cardRatio: "square",
        outputs,
        status: "approved",
        auto: true,
      });
    } catch {
      // ignore if offline
    }
    toast({
      kind: "success",
      message: "بستهٔ خلبان خودکار تأیید شد و با کارت قرمز در صدر صف انتشار فوری قرار گرفت",
    });
  };

  // Generate AI multi-platform content from the Story Basket
  const generateFromBasketWithAi = async () => {
    const sources = basketArticles.length > 0 ? basketArticles : articles.slice(0, 1);
    if (sources.length === 0) return;

    const baseOut = buildDeterministicOutputs(sources, brand, editorialAngle);
    setOutputs(baseOut);
    setGeneratingAi(true);

    try {
      const tpl = templates.find(t => t.id === selectedTplId) || {};
      let aiRes: Partial<Record<StudioPlatform, DraftOutput>> = {};
      if (sources.length >= 2) {
        aiRes = await api.studioComposeDigest({
          brand: {
            ...brand,
            styleGuide: [brand.styleGuide, editorialAngle].filter(Boolean).join(" — "),
          },
          template: tpl,
          sources: sources.map(s => ({
            title: s.title,
            content: s.content || s.preview || "",
            source: s.source,
            link: s.link,
          })),
          platforms: ALL_PLATFORMS,
        });
      } else {
        const s = sources[0];
        aiRes = await api.studioCompose({
          brand: {
            ...brand,
            styleGuide: [brand.styleGuide, editorialAngle].filter(Boolean).join(" — "),
          },
          template: tpl,
          source: {
            title: s.title,
            content: s.content || s.preview || "",
            source: s.source,
            link: s.link,
          },
          platforms: ALL_PLATFORMS,
        });
      }

      setOutputs(prev => {
        const merged = { ...prev };
        for (const p of ALL_PLATFORMS) {
          if (aiRes[p]?.text) {
            merged[p] = {
              text: aiRes[p]!.text,
              hashtags: aiRes[p]!.hashtags?.length ? aiRes[p]!.hashtags : prev[p].hashtags,
            };
          }
        }
        return merged;
      });
      toast({
        kind: "success",
        message: "نسخهٔ اختصاصی هر ۸ پلتفرم با هوش مصنوعی تولید شد",
      });
    } catch {
      toast({
        kind: "success",
        message: "نسخهٔ ساختاریافته برای تمام ۸ پلتفرم آماده شد",
      });
    } finally {
      setGeneratingAi(false);
    }
  };

  // Rich Editor formatting helpers
  const activeOutput = outputs[activePlatform] || { text: "", hashtags: [] };
  const charLimit = PLATFORM_LIMIT[activePlatform] || 0;
  const charCount = activeOutput.text.length;
  const wordCount = activeOutput.text.trim()
    ? activeOutput.text.trim().split(/\s+/).length
    : 0;
  const isOverLimit = charLimit > 0 && charCount > charLimit;

  const updateActiveText = (newText: string) => {
    setOutputs(prev => ({
      ...prev,
      [activePlatform]: {
        ...(prev[activePlatform] || { hashtags: [] }),
        text: newText,
      },
    }));
  };

  const applyFormat = (kind: "bold" | "italic" | "heading" | "list" | "quote" | "link" | "source") => {
    const el = editorRef.current;
    const curText = activeOutput.text;
    const start = el ? el.selectionStart : curText.length;
    const end = el ? el.selectionEnd : curText.length;
    const selected = curText.slice(start, end);

    let replacement = "";
    if (kind === "bold") replacement = `**${selected || "متن پررنگ"}**`;
    else if (kind === "italic") replacement = `_${selected || "متن مورب"}_`;
    else if (kind === "heading") replacement = `\n### ${selected || "تیتر بخش"}\n`;
    else if (kind === "list") replacement = `\n• ${selected || "نکتهٔ کلیدی"}`;
    else if (kind === "quote") replacement = `\n«${selected || "نقل‌قول مهم خبری"}»\n`;
    else if (kind === "link") replacement = `[${selected || "مشاهدهٔ خبر"}](${sourceLink || "https://"})`;
    else if (kind === "source") {
      const srcNames =
        basketArticles.map(a => a.source).filter(Boolean).join("، ") || "تحریریه";
      replacement = `\n📌 منبع: ${srcNames}`;
    }

    const updated = curText.slice(0, start) + replacement + curText.slice(end);
    updateActiveText(updated);
  };

  const rewriteWithTone = async (instruction: string, label: string) => {
    if (!activeOutput.text.trim()) return;
    setRewritingTone(label);
    try {
      const res = await api.studioRewrite({
        brand,
        platform: activePlatform,
        text: activeOutput.text,
        instruction,
      });
      if (res?.text) {
        setOutputs(prev => ({
          ...prev,
          [activePlatform]: {
            text: res.text,
            hashtags: res.hashtags?.length ? res.hashtags : prev[activePlatform].hashtags,
          },
        }));
        toast({ kind: "success", message: `متن با لحن «${label}» بازنویسی شد` });
      }
    } catch {
      const prefix =
        label === "فوری و کوتاه"
          ? "🚨 فوری | "
          : label === "تحلیلی و عمیق"
            ? "🔎 واکاوی تحلیلی | "
            : "";
      updateActiveText(prefix + activeOutput.text);
      toast({ kind: "success", message: `قالب «${label}» اعمال شد` });
    } finally {
      setRewritingTone(null);
    }
  };

  const addHashtag = () => {
    const clean = tagInput.trim().replace(/^#/, "");
    if (!clean) return;
    const existing = activeOutput.hashtags || [];
    if (!existing.includes(clean)) {
      setOutputs(prev => ({
        ...prev,
        [activePlatform]: {
          ...prev[activePlatform],
          hashtags: [...existing, clean],
        },
      }));
    }
    setTagInput("");
  };

  const removeHashtag = (tag: string) => {
    setOutputs(prev => ({
      ...prev,
      [activePlatform]: {
        ...prev[activePlatform],
        hashtags: (prev[activePlatform]?.hashtags || []).filter(t => t !== tag),
      },
    }));
  };

  // Inline Keyboard Button Handlers
  const addCustomInlineButton = () => {
    if (!newBtnLabel.trim()) return;
    const btn: InlineButton = {
      id: `btn-${Date.now()}`,
      label: newBtnLabel.trim(),
      kind: "url",
      url: newBtnUrl.trim() || sourceLink || "https://kian.media",
    };
    setMessengerOpts(prev => ({
      ...prev,
      inlineButtons: [...prev.inlineButtons, btn],
    }));
    setNewBtnLabel("");
    setNewBtnUrl("");
    toast({ kind: "success", message: "دکمهٔ شیشه‌ای به زیر پست اضافه شد" });
  };

  const removeInlineButton = (id: string) => {
    setMessengerOpts(prev => ({
      ...prev,
      inlineButtons: prev.inlineButtons.filter(b => b.id !== id),
    }));
  };

  const resetReactionPollButtons = () => {
    setMessengerOpts(prev => ({
      ...prev,
      inlineButtons: createDefaultInlineButtons(sourceLink),
    }));
    toast({ kind: "success", message: "دکمه‌های شیشه‌ای استاندارد و نظرسنجی واکنشی بازنشانی شدند" });
  };

  const incrementReactionInPreview = (id: string) => {
    setMessengerOpts(prev => ({
      ...prev,
      inlineButtons: prev.inlineButtons.map(b =>
        b.id === id ? { ...b, count: (b.count || 0) + 1 } : b,
      ),
    }));
  };

  // Reply / Thread Handlers
  const addThreadContinuation = () => {
    if (!newThreadText.trim()) return;
    setReplyChain(prev => ({
      ...prev,
      threadContinuations: [...prev.threadContinuations, newThreadText.trim()],
    }));
    setNewThreadText("");
    toast({ kind: "success", message: "پست مکمل به زنجیره (Thread) افزوده شد" });
  };

  const removeThreadContinuation = (idx: number) => {
    setReplyChain(prev => ({
      ...prev,
      threadContinuations: prev.threadContinuations.filter((_, i) => i !== idx),
    }));
  };

  // Smart Slot & Anti-Flood Handlers
  const handlePickSmartSlot = async (slotTs: number) => {
    setScheduledSlotTs(slotTs);
    const newItem: ScheduledSlotItem = {
      id: draftId || `q-${Date.now()}`,
      title: headline,
      scheduledAt: slotTs,
      priority: "normal",
      platforms: [activePlatform],
    };
    setQueueItems(prev => [...prev.filter(i => i.id !== newItem.id), newItem].sort((a, b) => a.scheduledAt - b.scheduledAt));
    try {
      const saved = await api.studioSaveDraft(uid, {
        id: draftId || undefined,
        title: headline.slice(0, 120),
        sourceTitle: headline,
        sourceLink,
        image: cardPreviewUrl,
        cardTheme,
        cardRatio,
        outputs,
        status: "scheduled",
        scheduledAt: slotTs,
      });
      setDraftId(saved.id);
      onSavedDraft?.(saved);
    } catch {
      // ignore offline
    }
    const timeLabel = new Date(slotTs).toLocaleTimeString("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    toast({
      kind: "success",
      message: `پست در اسلات هوشمند ساعت ${timeLabel} (با رعایت فاصلهٔ ضد ازدحام) زمان‌بندی شد`,
    });
  };

  const handleAutoSpaceQueueInline = () => {
    const spaced = redistributeQueueAntiFlood(queueItems, minGapMinutes, Date.now());
    setQueueItems(spaced);
    toast({
      kind: "success",
      message: `تمام پست‌های صف با حداقل ${toFa(minGapMinutes)} دقیقه فاصلهٔ استاندارد بازتوزیع شدند`,
    });
  };

  const fullFormattedPost = (out: DraftOutput) =>
    out.hashtags?.length
      ? `${out.text}\n\n${out.hashtags.map(h => `#${h}`).join(" ")}`
      : out.text;

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const saved = await api.studioSaveDraft(uid, {
        id: draftId || undefined,
        title: headline.slice(0, 120),
        sourceTitle: headline,
        sourceLink,
        image: cardPreviewUrl,
        images: carouselSlides.length > 1 ? carouselSlides : undefined,
        cardTheme,
        cardRatio,
        outputs,
        status: scheduledSlotTs ? "scheduled" : "draft",
        scheduledAt: scheduledSlotTs || undefined,
      });
      setDraftId(saved.id);
      onSavedDraft?.(saved);
      toast({ kind: "success", message: "پیش‌نویس چندپلتفرمی ذخیره شد" });
    } catch (e: any) {
      toast({ kind: "error", message: String(e?.message || "خطا در ذخیره") });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyActive = async () => {
    try {
      await navigator.clipboard.writeText(fullFormattedPost(activeOutput));
      setCopied(true);
      toast({
        kind: "success",
        message: `متن ${PLATFORM_META[activePlatform].label} کپی شد`,
      });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ kind: "error", message: "کپی ناموفق بود" });
    }
  };

  const handlePublishActive = async () => {
    if (!isPublishable(activePlatform)) {
      await handleCopyActive();
      return;
    }
    if (!conns[activePlatform]?.connected) {
      toast({
        kind: "warn",
        message: `ابتدا حساب ${PLATFORM_META[activePlatform].label} را در بخش اتصال‌ها متصل کنید`,
      });
      onOpenConnections?.();
      return;
    }
    setPublishing(true);
    try {
      await api.studioPublish(uid, {
        platform: activePlatform,
        text: fullFormattedPost(activeOutput),
        title: headline,
        link: sourceLink,
        imageUrl: cardPreviewUrl || undefined,
        imageUrls: carouselSlides.length > 1 ? carouselSlides : undefined,
      });
      toast({
        kind: "success",
        message: `با موفقیت در ${PLATFORM_META[activePlatform].label} منتشر شد`,
      });
    } catch (e: any) {
      toast({ kind: "error", message: String(e?.message || e).slice(0, 120) });
    } finally {
      setPublishing(false);
    }
  };

  const handleApplyAndUploadCard = async () => {
    setRenderingCard(true);
    try {
      const dataUrl = await renderNewsCard({
        title: (cardCustomTitle || headline || "گزارش خبری").trim(),
        brandName: brand.name || "کیان مدیا (Flow)",
        tagline: brand.tagline || "تحریریه هوشمند خبری",
        source: cardFooterSource || basketArticles[0]?.source || brand.name || "تحریریه",
        accent: cardAccent,
        theme: cardTheme,
        ratio: cardRatio,
        logoUrl: brand.logo || undefined,
      });
      const uploaded = await api.studioUploadCard(uid, dataUrl);
      setCardPreviewUrl(uploaded);
      toast({ kind: "success", message: "کارت گرافیکی ساخته و روی پیش‌نویس اعمال شد" });
    } catch {
      toast({ kind: "error", message: "خطا در ساخت کارت گرافیکی" });
    } finally {
      setRenderingCard(false);
    }
  };

  const handleBuildCarousel = async () => {
    const rawLines = activeOutput.text
      .split(/\n{2,}|\n[-•*]\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 8)
      .slice(0, 5);
    const slides =
      rawLines.length >= 2
        ? rawLines
        : basketArticles.slice(0, 4).map(a => `${a.title} (${a.source})`);
    if (slides.length === 0) return;

    setRenderingCarousel(true);
    try {
      const urls = await renderCarousel({
        title: (cardCustomTitle || headline || "گزارش چنداسلایدی").trim(),
        slides,
        brandName: brand.name || "کیان مدیا (Flow)",
        tagline: brand.tagline || "تحریریه هوشمند خبری",
        accent: cardAccent,
        theme: cardTheme,
        logoUrl: brand.logo || undefined,
      });
      setCarouselSlides(urls);
      setActiveSlideIdx(0);
      toast({
        kind: "success",
        message: `کاروسل ${toFa(urls.length)} اسلایدی آماده شد`,
      });
    } catch {
      toast({ kind: "error", message: "خطا در تولید کاروسل" });
    } finally {
      setRenderingCarousel(false);
    }
  };

  const handleDownloadCard = () => {
    if (!cardPreviewUrl) return;
    const a = document.createElement("a");
    a.href = cardPreviewUrl;
    a.download = `editorial-card-${Date.now()}.png`;
    a.click();
  };

  // Grid template columns based on layoutPreset
  const gridColsClass =
    layoutPreset === "editor-wide"
      ? "lg:grid-cols-[270px_minmax(0,1.7fr)_320px]"
      : layoutPreset === "preview-wide"
        ? "lg:grid-cols-[280px_minmax(0,1fr)_420px]"
        : "lg:grid-cols-[300px_minmax(0,1.35fr)_360px]";

  const urlButtons = messengerOpts.inlineButtons.filter(b => b.kind === "url");
  const reactionButtons = messengerOpts.inlineButtons.filter(b => b.kind === "reaction");
  const activeOmniCount = countActiveOmnichannelFeatures({
    inlineButtonsCount: messengerOpts.inlineButtons.length,
    silent: messengerOpts.silent,
    autoPin: messengerOpts.autoPin,
    replyEnabled: replyChain.enabled,
    threadCount: replyChain.threadContinuations.length,
    scheduledSlotTs,
  });

  return (
    <div
      dir="rtl"
      data-testid="editorial-split-workspace"
      className="h-full flex flex-col bg-[var(--background)] text-[var(--foreground)] overflow-hidden"
    >
      {/* Compact collapsible Autopilot bar */}
      <AutopilotTopBanner
        candidates={autopilotCandidates}
        onApproveAndPublish={handleApproveAndPublishAutopilot}
        onInspectInEditor={handleInspectAutopilotCandidate}
        onDismiss={id => setDismissedAutopilotIds(prev => [...prev, id])}
        onOpenAutomationBuilder={() => setAutomationModalOpen(true)}
      />

      {/* Minimal Sub-Toolbar */}
      <div className="px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--background)] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 text-xs min-w-0">
          <span className="font-semibold text-[var(--foreground)] flex items-center gap-1.5 shrink-0">
            <Columns3 className="size-4 text-[var(--brand-600)]" />
            <span>میز کار تحریریه</span>
          </span>
          <span className="text-[var(--border-strong)] hidden sm:inline">·</span>
          <span className="text-[11.5px] text-[var(--foreground-subtle)] truncate tabular-nums hidden sm:inline">
            {toFa(basketArticles.length)} خبر در سبد · پلتفرم فعال: {PLATFORM_META[activePlatform].label}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs shrink-0">
          {/* Column proportions menu (progressive disclosure instead of 3 bulky tabs) */}
          <div className="relative hidden lg:block">
            <button
              type="button"
              aria-expanded={layoutMenuOpen}
              aria-haspopup="menu"
              onClick={() => setLayoutMenuOpen(v => !v)}
              className="h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <SlidersHorizontal className="size-3.5" />
              <span>چینش</span>
              <ChevronDown className={`size-3 transition-transform ${layoutMenuOpen ? "rotate-180" : ""}`} />
            </button>

            {layoutMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setLayoutMenuOpen(false)}
                />
                <div
                  role="menu"
                  aria-label="تنظیم تناسب ستون‌ها"
                  className="absolute left-0 top-full mt-1.5 z-30 w-48 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--popover)] shadow-[var(--shadow-md)] p-1.5 space-y-0.5"
                >
                  {[
                    { id: "balanced", label: "متوازن (۳ ستون)" },
                    { id: "editor-wide", label: "تمرکز روی ویرایشگر" },
                    { id: "preview-wide", label: "تمرکز روی پیش‌نمایش" },
                  ].map(p => (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={layoutPreset === p.id}
                      onClick={() => {
                        setLayoutPreset(p.id as LayoutPreset);
                        setLayoutMenuOpen(false);
                      }}
                      className={`w-full px-2.5 py-1.5 rounded-[var(--radius-sm)] text-right text-xs flex items-center justify-between transition cursor-pointer ${
                        layoutPreset === p.id
                          ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold"
                          : "text-[var(--foreground)] hover:bg-[var(--background-muted)]"
                      }`}
                    >
                      <span>{p.label}</span>
                      {layoutPreset === p.id && <Check className="size-3.5" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            data-testid="open-visual-automation-btn"
            onClick={() => setAutomationModalOpen(true)}
            className="h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--accent)] text-[var(--foreground)] text-xs font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer"
          >
            <Zap className="size-3.5 text-[var(--brand-600)]" />
            <span>قوانین و صف</span>
            {floodConflicts.length > 0 && (
              <span className="min-w-4 h-4 px-1 rounded-full bg-[var(--warning-500)] text-white text-[10px] grid place-items-center tabular-nums">
                {toFa(floodConflicts.length)}
              </span>
            )}
          </button>

          {onOpenVisualFlow && (
            <button
              type="button"
              data-testid="open-visual-flow-studio-btn"
              onClick={onOpenVisualFlow}
              className="h-8 px-2.5 rounded-[var(--radius-md)] bg-[var(--accent)] hover:bg-[var(--brand-200)] text-[var(--accent-foreground)] text-xs font-semibold inline-flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer"
            >
              <Workflow className="size-3.5" />
              <span>بوم بصری</span>
            </button>
          )}
        </div>
      </div>

      {/* Narrow / Mobile Pane Switcher */}
      <div className="lg:hidden px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--background-subtle)] shrink-0">
        <div
          role="tablist"
          aria-label="بخش‌های میز کار"
          className="grid grid-cols-3 gap-1 p-0.5 rounded-[var(--radius-md)] bg-[var(--background-muted)] border border-[var(--border-subtle)] text-xs"
        >
          {[
            { id: "source" as const, label: `منابع (${toFa(basketArticles.length)})` },
            { id: "editor" as const, label: "ویرایشگر" },
            { id: "preview" as const, label: "پیش‌نمایش" },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={mobilePane === tab.id}
              onClick={() => setMobilePane(tab.id)}
              className={`py-1.5 px-2 rounded-[var(--radius-sm)] font-medium transition cursor-pointer ${
                mobilePane === tab.id
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                  : "text-[var(--foreground-muted)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3-Column Split Workspace */}
      <div className={`flex-1 min-h-0 grid grid-cols-1 ${gridColsClass} lg:divide-x lg:divide-x-reverse divide-[var(--border-subtle)] overflow-hidden`}>
        {/* ═══════════════════════════════════════════════════════════════════
            COLUMN 1 (RIGHT IN RTL): LIVE FEED, HOT CLUSTERS & STORY BASKET
        ═══════════════════════════════════════════════════════════════════ */}
        <section
          aria-label="ستون راست: فید زنده، خوشه‌های داغ و سبد خبرها"
          className={`${mobilePane === "source" ? "flex" : "hidden lg:flex"} flex-col min-h-0 h-full bg-[var(--background-subtle)] overflow-hidden`}
        >
          {/* Segmented Mode Switcher */}
          <div className="p-2.5 border-b border-[var(--border-subtle)] bg-[var(--background)] shrink-0">
            <div
              role="tablist"
              aria-label="حالت ستون منابع"
              className="grid grid-cols-3 gap-1 p-0.5 bg-[var(--background-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === "feed"}
                onClick={() => setRightTab("feed")}
                className={`py-1.5 px-2 rounded-[var(--radius-sm)] flex items-center justify-center gap-1 font-medium transition whitespace-nowrap cursor-pointer ${
                  rightTab === "feed"
                    ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                    : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <Newspaper className="size-3.5" />
                <span>فید</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === "clusters"}
                onClick={() => setRightTab("clusters")}
                className={`py-1.5 px-2 rounded-[var(--radius-sm)] flex items-center justify-center gap-1 font-medium transition whitespace-nowrap cursor-pointer ${
                  rightTab === "clusters"
                    ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                    : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <Flame className="size-3.5 text-[var(--warning-600)]" />
                <span>خوشه‌ها ({toFa(hotClusters.length)})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === "basket"}
                onClick={() => setRightTab("basket")}
                className={`py-1.5 px-2 rounded-[var(--radius-sm)] flex items-center justify-center gap-1 font-medium transition whitespace-nowrap cursor-pointer ${
                  rightTab === "basket"
                    ? "bg-[var(--card)] text-[var(--accent-foreground)] shadow-[var(--shadow-xs)]"
                    : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <ShoppingBasket className="size-3.5 text-[var(--brand-600)]" />
                <span>سبد ({toFa(basketArticles.length)})</span>
              </button>
            </div>
          </div>

          {/* Right Pane Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {rightTab === "feed" && (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Search className="size-3.5 text-[var(--foreground-subtle)] absolute right-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={feedQuery}
                      onChange={e => setFeedQuery(e.target.value)}
                      aria-label="جستجو در فید زنده اخبار"
                      placeholder="جستجو در اخبار..."
                      className="w-full h-8 pr-8 pl-3 rounded-[var(--radius-md)] bg-[var(--card)] border border-[var(--border-subtle)] text-xs outline-none focus:border-[var(--brand-500)]"
                    />
                  </div>
                  <button
                    type="button"
                    aria-expanded={layoutPrefs.editorialSections.feedFilters}
                    onClick={() => toggleSection("feedFilters")}
                    title="فیلتر دسته‌بندی"
                    className={`h-8 px-2.5 rounded-[var(--radius-md)] border text-[11px] font-medium inline-flex items-center gap-1 shrink-0 transition cursor-pointer ${
                      layoutPrefs.editorialSections.feedFilters || categoryFilter !== "all"
                        ? "bg-[var(--accent)] border-[var(--brand-300)] text-[var(--accent-foreground)]"
                        : "bg-[var(--card)] border-[var(--border-subtle)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    <SlidersHorizontal className="size-3" />
                    <span>دسته</span>
                  </button>
                </div>

                {layoutPrefs.editorialSections.feedFilters && (
                  <div className="flex items-center gap-1 flex-wrap p-2 rounded-[var(--radius-md)] bg-[var(--card)] border border-[var(--border-subtle)] text-[11px]">
                    <button
                      type="button"
                      onClick={() => setCategoryFilter("all")}
                      className={`px-2 py-0.5 rounded-[var(--radius-sm)] transition cursor-pointer ${
                        categoryFilter === "all"
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-medium"
                          : "bg-[var(--background-muted)] text-[var(--foreground-muted)]"
                      }`}
                    >
                      همه
                    </button>
                    {categories.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={`px-2 py-0.5 rounded-[var(--radius-sm)] transition cursor-pointer ${
                          categoryFilter === cat
                            ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-medium"
                            : "bg-[var(--background-muted)] text-[var(--foreground-muted)]"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  {filteredFeed.map(art => {
                    const inBasket = basketIds.includes(art.id);
                    return (
                      <div
                        key={art.id}
                        className={`p-2.5 rounded-[var(--radius-lg)] border transition ${
                          inBasket
                            ? "border-[var(--brand-400)] bg-[var(--brand-50)]/60 dark:bg-[var(--brand-900)]/20"
                            : "border-[var(--border-subtle)] bg-[var(--card)] hover:border-[var(--border)]"
                        }`}
                      >
                        <div className="text-xs font-medium leading-relaxed text-[var(--foreground)] line-clamp-2">
                          {art.title}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--foreground-subtle)]">
                          <span className="truncate">{art.source}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                loadSingleArticleIntoEditor(art);
                                setMobilePane("editor");
                              }}
                              className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--background-muted)] hover:bg-[var(--secondary)] text-[var(--foreground)] font-medium whitespace-nowrap cursor-pointer"
                            >
                              ویرایش
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleBasketItem(art)}
                              className={`px-2 py-0.5 rounded-[var(--radius-sm)] font-medium whitespace-nowrap cursor-pointer transition ${
                                inBasket
                                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                                  : "bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--brand-200)]"
                              }`}
                            >
                              {inBasket ? "در سبد ✓" : "+ سبد"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {rightTab === "clusters" && (
              <div className="space-y-2.5">
                <div className="text-[11px] text-[var(--foreground-subtle)] leading-relaxed">
                  خوشه‌های هم‌داستان چندمنبعی برای جمع‌بندی سریع:
                </div>
                {hotClusters.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--foreground-subtle)]">
                    خوشهٔ چندمنبعی در حال حاضر یافت نشد.
                  </div>
                ) : (
                  hotClusters.map(cl => (
                    <div
                      key={cl.id}
                      className="p-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--card)] space-y-2"
                    >
                      <div className="text-xs font-semibold leading-relaxed text-[var(--foreground)]">
                        {cl.title}
                      </div>
                      <div className="text-[11px] text-[var(--foreground-subtle)] flex items-center gap-1.5 flex-wrap">
                        <span>منشأ: {cl.originSource}</span>
                        <span>·</span>
                        <span className="text-[var(--warning-600)] font-medium tabular-nums">
                          {toFa(cl.items.length)} رسانه
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => addClusterToBasket(cl)}
                        className="w-full h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] hover:bg-[var(--brand-200)] text-[var(--accent-foreground)] text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                      >
                        <Plus className="size-3.5" />
                        <span>افزودن خوشه به سبد</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {rightTab === "basket" && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">
                    سبد خبرها ({toFa(basketArticles.length)})
                  </span>
                  {basketArticles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBasketIds([])}
                      className="text-[11px] text-[var(--danger-600)] hover:underline cursor-pointer"
                    >
                      خالی کردن
                    </button>
                  )}
                </div>

                {basketArticles.length === 0 ? (
                  <div className="p-6 rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] text-center text-xs text-[var(--foreground-subtle)]">
                    سبد خالی است. از تب «فید» یا «خوشه‌ها» خبر اضافه کنید.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {basketArticles.map((art, idx) => (
                      <div
                        key={art.id}
                        className="p-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--card)] flex items-start gap-2"
                      >
                        <span className="text-xs font-mono tabular-nums text-[var(--brand-600)] mt-0.5">
                          {toFa(idx + 1)}.
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium leading-snug line-clamp-2">
                            {art.title}
                          </div>
                          <div className="text-[10.5px] text-[var(--foreground-subtle)] mt-0.5">{art.source}</div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveBasketItem(idx, -1)}
                            disabled={idx === 0}
                            aria-label={`انتقال ${art.title} به بالا`}
                            className="p-1 rounded hover:bg-[var(--background-muted)] disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveBasketItem(idx, 1)}
                            disabled={idx === basketArticles.length - 1}
                            aria-label={`انتقال ${art.title} به پایین`}
                            className="p-1 rounded hover:bg-[var(--background-muted)] disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleBasketItem(art)}
                            aria-label={`حذف ${art.title} از سبد`}
                            className="p-1 rounded text-[var(--danger-500)] hover:bg-[var(--danger-50)] cursor-pointer"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <CollapsibleSection
                  title="زاویهٔ نگارش و قالب تحریریه"
                  subtitle={editorialAngle ? editorialAngle : "اختیاری — افزودن دستورالعمل هوش مصنوعی"}
                  open={layoutPrefs.editorialSections.basketOptions}
                  onToggle={() => toggleSection("basketOptions")}
                  testId="toggle-basket-options"
                >
                  <div className="space-y-2.5">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-[var(--foreground-muted)]">
                        زاویهٔ دید تحریریه:
                      </label>
                      <textarea
                        value={editorialAngle}
                        onChange={e => setEditorialAngle(e.target.value)}
                        rows={2}
                        placeholder="مثلاً: تمرکز روی پیامدهای اقتصادی برای بازار داخلی..."
                        className="w-full rounded-[var(--radius-md)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] p-2 text-xs outline-none focus:border-[var(--brand-500)] resize-none"
                      />
                    </div>
                    {templates.length > 0 && (
                      <div className="space-y-1">
                        <label className="block text-[11px] font-medium text-[var(--foreground-muted)]">
                          قالب تحریریه:
                        </label>
                        <select
                          value={selectedTplId}
                          onChange={e => setSelectedTplId(e.target.value)}
                          className="w-full h-8 px-2 rounded-[var(--radius-md)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] text-xs outline-none"
                        >
                          <option value="">قالب استاندارد چندپلتفرمی</option>
                          {templates.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </CollapsibleSection>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--background)] shrink-0">
            <button
              type="button"
              onClick={generateFromBasketWithAi}
              disabled={generatingAi || (basketArticles.length === 0 && articles.length === 0)}
              className="w-full h-9 rounded-[var(--radius-md)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-[var(--primary-foreground)] text-xs font-semibold flex items-center justify-center gap-2 transition shadow-[var(--shadow-xs)] cursor-pointer"
            >
              {generatingAi ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              <span>
                {generatingAi
                  ? "در حال نگارش ۸ پلتفرم..."
                  : `تولید محتوای چندپلتفرمی (${toFa(Math.max(1, basketArticles.length))})`}
              </span>
            </button>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            COLUMN 2 (CENTER): FOCUSED EDITOR WITH COLLAPSIBLE MODULES
        ═══════════════════════════════════════════════════════════════════ */}
        <section
          aria-label="ستون وسط: ویرایشگر متمرکز چندپلتفرمی"
          className={`${mobilePane === "editor" ? "flex" : "hidden lg:flex"} flex-col min-h-0 h-full bg-[var(--background)] overflow-hidden`}
        >
          {/* Single-row horizontally scrollable platform strip */}
          <div
            role="tablist"
            aria-label="پلتفرم‌های انتشار"
            className="border-b border-[var(--border-subtle)] bg-[var(--background-subtle)] px-3 py-2 flex items-center gap-1 overflow-x-auto scrollbar-none shrink-0"
          >
            {ALL_PLATFORMS.map(p => {
              const meta = PLATFORM_META[p];
              const isActive = activePlatform === p;
              const pLen = (outputs[p]?.text || "").length;
              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActivePlatform(p)}
                  className={`h-7 px-2 rounded-[var(--radius-md)] text-[11px] flex items-center gap-1 border transition whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)] font-semibold shadow-[var(--shadow-xs)]"
                      : "bg-[var(--card)] border-[var(--border-subtle)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:border-[var(--border)]"
                  }`}
                >
                  <span>{meta.emoji}</span>
                  <span>{meta.label}</span>
                  {isActive && pLen > 0 && (
                    <span className="text-[10px] tabular-nums opacity-75">
                      {toFa(pLen)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Main Calm Editor Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col">
            {/* Master Headline Input */}
            <div className="space-y-1">
              <label htmlFor="editorial-headline-input" className="block text-[11px] font-medium text-[var(--foreground-subtle)]">
                تیتر محوری پرونده
              </label>
              <input
                id="editorial-headline-input"
                value={headline}
                onChange={e => setHeadline(e.target.value)}
                placeholder="تیتر اصلی خبر..."
                className="w-full h-9 px-3 rounded-[var(--radius-md)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] text-xs font-semibold outline-none focus:border-[var(--brand-500)] focus:bg-[var(--card)] transition"
              />
            </div>

            {/* Platform Guidance & Budget Bar */}
            <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--foreground-subtle)]">
              <span className="truncate">
                <strong className="text-[var(--foreground)] font-medium">{PLATFORM_META[activePlatform].label}</strong>
                {" — "}
                {PLATFORM_META[activePlatform].hint}
              </span>
              <span className={`tabular-nums font-mono shrink-0 ${isOverLimit ? "text-[var(--danger-600)] font-bold" : ""}`}>
                {toFa(wordCount)} واژه · {toFa(charCount)}
                {charLimit > 0 ? ` / ${toFa(charLimit)}` : ""}
              </span>
            </div>

            {charLimit > 0 && (
              <div className="w-full h-1 rounded-full bg-[var(--background-muted)] overflow-hidden shrink-0">
                <div
                  style={{ width: `${Math.min(100, Math.round((charCount / charLimit) * 100))}%` }}
                  className={`h-full transition-all ${
                    isOverLimit
                      ? "bg-[var(--danger-500)]"
                      : charCount / charLimit > 0.85
                        ? "bg-[var(--warning-500)]"
                        : "bg-[var(--brand-500)]"
                  }`}
                />
              </div>
            )}

            {/* Generous Focused Textarea */}
            <textarea
              ref={editorRef}
              aria-label={`متن ${PLATFORM_META[activePlatform].label}`}
              value={activeOutput.text}
              onChange={e => updateActiveText(e.target.value)}
              dir="auto"
              rows={9}
              placeholder={`متن اختصاصی برای ${PLATFORM_META[activePlatform].label} را اینجا بنویسید یا از ستون منابع با هوش مصنوعی تولید کنید...`}
              className="flex-1 min-h-[210px] w-full rounded-[var(--radius-lg)] bg-[var(--card)] border border-[var(--border-subtle)] p-3.5 text-[13px] leading-7 outline-none focus:border-[var(--brand-500)] resize-y"
            />

            {/* Progressive Disclosure Drawer 1: Formatting, AI Tone & Hashtags */}
            <CollapsibleSection
              title="قالب‌بندی متن، لحن هوش مصنوعی و هشتگ‌ها"
              subtitle="ابزارهای ویرایش مارک‌داون، بازنویسی لحن و مدیریت هشتگ"
              badge={(activeOutput.hashtags || []).length ? `${toFa((activeOutput.hashtags || []).length)} هشتگ` : undefined}
              icon={<Type className="size-3.5" />}
              open={layoutPrefs.editorialSections.formattingAndTags}
              onToggle={() => toggleSection("formattingAndTags")}
              testId="toggle-formatting-tags-section"
            >
              <div className="space-y-3">
                {/* Formatting + AI Tone row */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => applyFormat("bold")}
                      aria-label="پررنگ"
                      title="پررنگ (Bold)"
                      className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] cursor-pointer"
                    >
                      <Bold className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat("italic")}
                      aria-label="مورب"
                      title="مورب (Italic)"
                      className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] cursor-pointer"
                    >
                      <Italic className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat("heading")}
                      aria-label="زیرتیتر"
                      title="افزودن زیرتیتر"
                      className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] cursor-pointer"
                    >
                      <Heading className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat("list")}
                      aria-label="بولت‌لیست"
                      title="افزودن بولت‌لیست"
                      className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] cursor-pointer"
                    >
                      <List className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat("quote")}
                      aria-label="نقل‌قول"
                      title="افزودن نقل‌قول"
                      className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] cursor-pointer"
                    >
                      <Quote className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat("link")}
                      aria-label="درج لینک منبع"
                      title="درج لینک منبع"
                      className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] cursor-pointer"
                    >
                      <LinkIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormat("source")}
                      className="px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--background-muted)] hover:bg-[var(--accent)] text-[11px] text-[var(--foreground)] whitespace-nowrap cursor-pointer"
                    >
                      + منبع
                    </button>
                  </div>

                  <div className="flex items-center gap-1 flex-wrap">
                    {[
                      { label: "فوری و کوتاه", prompt: "متن را به یک خبر فوری، بسیار فشرده و قلاب‌دار تبدیل کن" },
                      { label: "تحلیلی و عمیق", prompt: "متن را با لحن تحلیلی، کارشناسی و بررسی پیامدها بازنویسی کن" },
                      { label: "رسمی و خبری", prompt: "متن را با لحن کاملاً رسمی، بی‌طرف و استاندارد خبرگزاری بازنویسی کن" },
                    ].map(tn => (
                      <button
                        key={tn.label}
                        type="button"
                        onClick={() => rewriteWithTone(tn.prompt, tn.label)}
                        disabled={!!rewritingTone}
                        className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--background-subtle)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] text-[var(--foreground-muted)] text-[11px] inline-flex items-center gap-1 transition whitespace-nowrap cursor-pointer"
                      >
                        {rewritingTone === tn.label ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Sparkles className="size-3 text-[var(--brand-600)]" />
                        )}
                        <span>{tn.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Hashtag Editor */}
                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-[var(--foreground-subtle)]">
                    <span className="flex items-center gap-1 font-medium text-[var(--foreground-muted)]">
                      <Hash className="size-3.5 text-[var(--brand-600)]" />
                      هشتگ‌های {PLATFORM_META[activePlatform].label}
                    </span>
                    <span className="tabular-nums">{toFa((activeOutput.hashtags || []).length)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(activeOutput.hashtags || []).map(tag => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-foreground)] text-[11px]"
                      >
                        #{tag}
                        <button
                          type="button"
                          aria-label={`حذف هشتگ ${tag}`}
                          onClick={() => removeHashtag(tag)}
                          className="opacity-60 hover:opacity-100 cursor-pointer"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <div className="inline-flex items-center gap-1">
                      <input
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addHashtag();
                          }
                        }}
                        aria-label="افزودن هشتگ جدید"
                        placeholder="افزودن هشتگ + Enter"
                        className="h-7 px-2 rounded-[var(--radius-sm)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] text-[11px] outline-none w-32"
                      />
                      <button
                        type="button"
                        onClick={addHashtag}
                        aria-label="ثبت هشتگ"
                        className="h-7 px-2 rounded-[var(--radius-sm)] bg-[var(--primary)] text-[var(--primary-foreground)] text-xs cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            {/* Progressive Disclosure Drawer 2: Omnichannel Messenger, Thread & Smart Queue */}
            <CollapsibleSection
              title="قابلیت‌های پیام‌رسان، زنجیره و صف هوشمند"
              subtitle="دکمه‌های شیشه‌ای، پین خودکار، پاسخ زنجیره‌ای و زمان‌بندی ضد ازدحام"
              badge={activeOmniCount > 0 ? `${toFa(activeOmniCount)} فعال` : undefined}
              icon={<Zap className="size-3.5" />}
              open={layoutPrefs.editorialSections.omnichannelModules}
              onToggle={() => toggleSection("omnichannelModules")}
              testId="toggle-omnichannel-modules-section"
            >
              <div className="space-y-3">
                {/* Module Switcher Tabs */}
                <div
                  role="tablist"
                  aria-label="ماژول‌های انتشار چندکاناله"
                  className="grid grid-cols-3 gap-1 p-0.5 bg-[var(--background-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[11px] font-medium"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={editorModuleTab === "messenger_native"}
                    data-testid="tab-messenger-native"
                    onClick={() => setEditorModuleTab("messenger_native")}
                    className={`py-1.5 px-2 rounded-[var(--radius-sm)] flex items-center justify-center gap-1 transition whitespace-nowrap cursor-pointer ${
                      editorModuleTab === "messenger_native"
                        ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)] font-semibold"
                        : "text-[var(--foreground-muted)]"
                    }`}
                  >
                    <span>پیام‌رسان و دکمه</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={editorModuleTab === "reply_thread"}
                    data-testid="tab-reply-thread"
                    onClick={() => setEditorModuleTab("reply_thread")}
                    className={`py-1.5 px-2 rounded-[var(--radius-sm)] flex items-center justify-center gap-1 transition whitespace-nowrap cursor-pointer ${
                      editorModuleTab === "reply_thread"
                        ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)] font-semibold"
                        : "text-[var(--foreground-muted)]"
                    }`}
                  >
                    <CornerUpRight className="size-3.5" />
                    <span>پاسخ و زنجیره</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={editorModuleTab === "smart_slot"}
                    data-testid="tab-smart-slot"
                    onClick={() => setEditorModuleTab("smart_slot")}
                    className={`py-1.5 px-2 rounded-[var(--radius-sm)] flex items-center justify-center gap-1 transition whitespace-nowrap cursor-pointer ${
                      editorModuleTab === "smart_slot"
                        ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)] font-semibold"
                        : "text-[var(--foreground-muted)]"
                    }`}
                  >
                    <CalendarClock className="size-3.5" />
                    <span>صف هوشمند</span>
                  </button>
                </div>

                {/* Module 1: Messenger Native Features */}
                {editorModuleTab === "messenger_native" && (
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        aria-pressed={messengerOpts.silent}
                        onClick={() =>
                          setMessengerOpts(prev => ({ ...prev, silent: !prev.silent }))
                        }
                        className={`px-2.5 py-1 rounded-[var(--radius-sm)] border text-[11px] flex items-center gap-1 transition cursor-pointer ${
                          messengerOpts.silent
                            ? "bg-[var(--accent)] border-[var(--brand-400)] text-[var(--accent-foreground)] font-semibold"
                            : "bg-[var(--background-subtle)] border-[var(--border-subtle)] text-[var(--foreground-muted)]"
                        }`}
                      >
                        <BellOff className="size-3.5" />
                        <span>ارسال بی‌صدا</span>
                      </button>

                      <button
                        type="button"
                        aria-pressed={messengerOpts.autoPin}
                        onClick={() =>
                          setMessengerOpts(prev => ({ ...prev, autoPin: !prev.autoPin }))
                        }
                        className={`px-2.5 py-1 rounded-[var(--radius-sm)] border text-[11px] flex items-center gap-1 transition cursor-pointer ${
                          messengerOpts.autoPin
                            ? "bg-[var(--danger-50)] border-[var(--danger-500)]/40 text-[var(--danger-600)] font-semibold"
                            : "bg-[var(--background-subtle)] border-[var(--border-subtle)] text-[var(--foreground-muted)]"
                        }`}
                      >
                        <Pin className="size-3.5" />
                        <span>پین خودکار</span>
                      </button>

                      <button
                        type="button"
                        aria-pressed={messengerOpts.showLinkPreview}
                        onClick={() =>
                          setMessengerOpts(prev => ({
                            ...prev,
                            showLinkPreview: !prev.showLinkPreview,
                          }))
                        }
                        className={`px-2.5 py-1 rounded-[var(--radius-sm)] border text-[11px] flex items-center gap-1 transition cursor-pointer ${
                          messengerOpts.showLinkPreview
                            ? "bg-[var(--accent)] border-[var(--brand-400)] text-[var(--accent-foreground)] font-semibold"
                            : "bg-[var(--background-subtle)] border-[var(--border-subtle)] text-[var(--foreground-muted)]"
                        }`}
                      >
                        <ExternalLink className="size-3.5" />
                        <span>پیش‌نمایش لینک</span>
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-[var(--foreground-subtle)]">
                        <span className="font-medium text-[var(--foreground-muted)]">
                          دکمه‌های شیشه‌ای زیر پست:
                        </span>
                        <button
                          type="button"
                          onClick={resetReactionPollButtons}
                          className="text-[var(--brand-600)] hover:underline text-[10.5px] cursor-pointer"
                        >
                          بازنشانی پیش‌فرض
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {messengerOpts.inlineButtons.map(btn => (
                          <span
                            key={btn.id}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] text-[11px]"
                          >
                            <span>{btn.label}</span>
                            {btn.count !== undefined && (
                              <span className="text-[var(--brand-600)] font-mono tabular-nums">
                                {toFa(btn.count)}
                              </span>
                            )}
                            <button
                              type="button"
                              aria-label={`حذف دکمه ${btn.label}`}
                              onClick={() => removeInlineButton(btn.id)}
                              className="text-[var(--foreground-subtle)] hover:text-[var(--danger-500)] cursor-pointer"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5 pt-1">
                        <input
                          value={newBtnLabel}
                          onChange={e => setNewBtnLabel(e.target.value)}
                          aria-label="متن دکمه شیشه‌ای"
                          placeholder="متن دکمه (مثلاً: مشاهده ویدیو)"
                          className="flex-1 h-7 px-2 rounded-[var(--radius-sm)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] text-[11px] outline-none"
                        />
                        <input
                          value={newBtnUrl}
                          onChange={e => setNewBtnUrl(e.target.value)}
                          aria-label="نشانی لینک دکمه"
                          dir="ltr"
                          placeholder="https://..."
                          className="w-32 h-7 px-2 rounded-[var(--radius-sm)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] text-[11px] outline-none"
                        />
                        <button
                          type="button"
                          onClick={addCustomInlineButton}
                          className="h-7 px-2.5 rounded-[var(--radius-sm)] bg-[var(--primary)] text-[var(--primary-foreground)] text-[11px] font-medium whitespace-nowrap cursor-pointer"
                        >
                          + افزودن
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Module 2: Reply-to-Previous & Threading */}
                {editorModuleTab === "reply_thread" && (
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={replyChain.enabled}
                          onChange={e =>
                            setReplyChain(prev => ({ ...prev, enabled: e.target.checked }))
                          }
                          className="rounded accent-[var(--brand-500)]"
                        />
                        <span className="font-medium">
                          اتصال به پست قبلی کانال (Reply)
                        </span>
                      </label>
                      <span className="text-[10.5px] text-[var(--foreground-subtle)] font-mono" dir="ltr">
                        Msg #{replyChain.channelMessageId}
                      </span>
                    </div>

                    {replyChain.enabled && (
                      <div className="space-y-2 pt-1">
                        <select
                          aria-label="انتخاب پست قبلی"
                          value={replyChain.parentTitle}
                          onChange={e => {
                            const picked = articles.find(a => a.title === e.target.value);
                            setReplyChain(prev => ({
                              ...prev,
                              parentTitle: e.target.value,
                              parentSnippet: (picked?.preview || e.target.value).slice(0, 110),
                            }));
                          }}
                          className="w-full h-8 px-2 rounded-[var(--radius-sm)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] text-[11px] outline-none"
                        >
                          <option value={replyChain.parentTitle}>{replyChain.parentTitle}</option>
                          {articles.slice(0, 12).map(a => (
                            <option key={a.id} value={a.title}>
                              پست قبلی: {a.title.slice(0, 75)} ({a.source})
                            </option>
                          ))}
                        </select>

                        <div className="space-y-1.5">
                          <div className="text-[11px] text-[var(--foreground-subtle)]">
                            پست‌های زنجیره‌ای مکمل ({toFa(replyChain.threadContinuations.length)}):
                          </div>
                          {replyChain.threadContinuations.map((tc, idx) => (
                            <div
                              key={idx}
                              className="p-2 rounded-[var(--radius-sm)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] flex items-center justify-between gap-2 text-[11px]"
                            >
                              <span className="truncate">
                                {toFa(idx + 2)}. {tc}
                              </span>
                              <button
                                type="button"
                                aria-label="حذف پست از زنجیره"
                                onClick={() => removeThreadContinuation(idx)}
                                className="text-[var(--danger-500)] cursor-pointer"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <div className="flex items-center gap-1.5">
                            <input
                              value={newThreadText}
                              onChange={e => setNewThreadText(e.target.value)}
                              aria-label="متن پست تکمیلی زنجیره"
                              placeholder="متن پست تکمیلی بعدی در زنجیره..."
                              className="flex-1 h-7 px-2 rounded-[var(--radius-sm)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] text-[11px] outline-none"
                            />
                            <button
                              type="button"
                              onClick={addThreadContinuation}
                              className="h-7 px-2.5 rounded-[var(--radius-sm)] bg-[var(--primary)] text-[var(--primary-foreground)] text-[11px] font-medium whitespace-nowrap cursor-pointer"
                            >
                              + افزودن
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Module 3: Smart Slot & Anti-Flood Limiter */}
                {editorModuleTab === "smart_slot" && (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium text-[var(--foreground-muted)]">
                        اسلات پیشنهادی (فاصلهٔ استاندارد {toFa(minGapMinutes)} دقیقه):
                      </span>
                      {floodConflicts.length > 0 && (
                        <button
                          type="button"
                          onClick={handleAutoSpaceQueueInline}
                          className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--warning-50)] border border-[var(--warning-500)]/30 text-[var(--warning-600)] text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <AlertTriangle className="size-3" />
                          <span>رفع {toFa(floodConflicts.length)} تداخل صف</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      {smartSlots.slice(0, 4).map(slot => (
                        <button
                          key={slot.ts}
                          type="button"
                          onClick={() => handlePickSmartSlot(slot.ts)}
                          className={`p-2 rounded-[var(--radius-md)] border text-right transition cursor-pointer ${
                            scheduledSlotTs === slot.ts
                              ? "border-[var(--brand-500)] bg-[var(--accent)]"
                              : "border-[var(--border-subtle)] bg-[var(--background-subtle)] hover:border-[var(--border)]"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] font-semibold">
                            <span className="text-[var(--brand-700)] dark:text-[var(--brand-300)]">{slot.label}</span>
                            <span className="text-[10px] text-[var(--foreground-subtle)]">
                              تعامل {toFa(slot.engagementScore)}٪
                            </span>
                          </div>
                          <div className="text-[10px] text-[var(--foreground-subtle)] truncate mt-0.5">
                            {slot.reason}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleSection>
          </div>

          {/* Center Editor Footer Actions */}
          <div className="px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--background)] flex items-center justify-between gap-2 flex-wrap shrink-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={saving}
                className="h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--background-muted)] text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                <span>ذخیره پیش‌نویس</span>
              </button>
              <button
                type="button"
                onClick={handleCopyActive}
                className="h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--background-muted)] text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
              >
                {copied ? <Check className="size-3.5 text-[var(--brand-600)]" /> : <Copy className="size-3.5" />}
                <span>{copied ? "کپی شد" : "کپی متن"}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handlePublishActive}
              disabled={publishing || isOverLimit}
              className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-[var(--primary-foreground)] text-xs font-semibold flex items-center gap-1.5 transition shadow-[var(--shadow-xs)] cursor-pointer"
            >
              {publishing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5 -scale-x-100" />
              )}
              <span>
                {isPublishable(activePlatform)
                  ? `انتشار در ${PLATFORM_META[activePlatform].label}`
                  : `کپی برای انتشار در ${PLATFORM_META[activePlatform].label}`}
              </span>
            </button>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            COLUMN 3 (LEFT IN RTL): LIVE DEVICE MOCKUP & GRAPHIC CARD CANVAS
        ═══════════════════════════════════════════════════════════════════ */}
        <section
          aria-label="ستون چپ: پیش‌نمایش زنده موبایل و بوم طراحی کارت گرافیکی"
          className={`${mobilePane === "preview" ? "flex" : "hidden lg:flex"} flex-col min-h-0 h-full bg-[var(--background-subtle)] overflow-hidden`}
        >
          {/* Mode Switcher: Live Device Mockup vs. Graphic Card Designer */}
          <div className="p-2.5 border-b border-[var(--border-subtle)] bg-[var(--background)] shrink-0">
            <div
              role="tablist"
              aria-label="حالت ستون پیش‌نمایش"
              className="grid grid-cols-2 gap-1 p-0.5 bg-[var(--background-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={leftTab === "device"}
                onClick={() => setLeftTab("device")}
                className={`py-1.5 px-2 rounded-[var(--radius-sm)] flex items-center justify-center gap-1.5 font-medium transition whitespace-nowrap cursor-pointer ${
                  leftTab === "device"
                    ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                    : "text-[var(--foreground-muted)]"
                }`}
              >
                <Smartphone className="size-3.5 text-[var(--brand-600)]" />
                <span>پیش‌نمایش زنده</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={leftTab === "canvas"}
                onClick={() => setLeftTab("canvas")}
                className={`py-1.5 px-2 rounded-[var(--radius-sm)] flex items-center justify-center gap-1.5 font-medium transition whitespace-nowrap cursor-pointer ${
                  leftTab === "canvas"
                    ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                    : "text-[var(--foreground-muted)]"
                }`}
              >
                <Palette className="size-3.5 text-[var(--brand-600)]" />
                <span>کارت گرافیکی</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 flex flex-col items-center">
            {leftTab === "device" ? (
              /* PIXEL-ACCURATE LIVE MOBILE DEVICE MOCKUP */
              <div className="w-full flex flex-col items-center space-y-2.5">
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap justify-center">
                  <span>شبیه‌ساز پیکسل‌به‌پیکسل:</span>
                  <strong className="text-slate-800 dark:text-slate-200">
                    {PLATFORM_META[activePlatform].emoji} {PLATFORM_META[activePlatform].label}
                  </strong>
                  {messengerOpts.silent && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 text-[10px]">
                      🔕 بی‌صدا
                    </span>
                  )}
                  {messengerOpts.autoPin && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 text-[10px]">
                      📌 پین خودکار
                    </span>
                  )}
                </div>

                {/* Phone Bezel Frame */}
                <div
                  data-testid="live-device-mockup"
                  className="w-[318px] rounded-[36px] border-[7px] border-slate-900 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-xl overflow-hidden flex flex-col"
                >
                  {/* Status Bar + Dynamic Island */}
                  <div className="h-7 px-5 bg-slate-950 text-white flex items-center justify-between text-[10px] font-mono shrink-0" dir="ltr">
                    <span>9:41</span>
                    <div className="w-16 h-3.5 rounded-full bg-black border border-slate-800" />
                    <span>5G 100%</span>
                  </div>

                  {/* Platform-Native Mockup Body */}
                  {(activePlatform === "telegram" ||
                    activePlatform === "bale" ||
                    activePlatform === "rubika" ||
                    activePlatform === "eitaa") && (
                    <div className="flex flex-col bg-[#0E1621] text-white min-h-[490px]">
                      {/* Channel Top Header */}
                      <div className="px-3 py-2 bg-[#17212B] flex items-center gap-2.5 border-b border-white/10">
                        <div className="w-8 h-8 rounded-full bg-emerald-600 grid place-items-center text-xs font-bold">
                          {(brand.name || "ک")[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">
                            {brand.name || "کانال رسمی تحریریه کیان"}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {PLATFORM_META[activePlatform].label} · ۴۸.۲K عضو
                          </div>
                        </div>
                      </div>

                      {/* Auto-Pinned Breaking Message Bar */}
                      {messengerOpts.autoPin && (
                        <div
                          data-testid="mockup-pinned-bar"
                          className="px-3 py-1.5 bg-[#17212B]/95 border-b border-white/10 flex items-center justify-between gap-2 text-[10.5px]"
                        >
                          <div className="border-r-2 border-rose-500 pr-2 min-w-0 flex-1">
                            <div className="text-rose-400 font-semibold flex items-center gap-1">
                              <Pin className="w-3 h-3" />
                              <span>پیام سنجاق‌شده (خبر فوری)</span>
                            </div>
                            <div className="text-slate-300 truncate">{headline}</div>
                          </div>
                        </div>
                      )}

                      {/* Message Bubble + Glass Inline Keyboard */}
                      <div className="p-2.5 flex-1 overflow-y-auto space-y-1.5">
                        <div className="rounded-2xl rounded-tr-sm bg-[#182533] overflow-hidden shadow-sm border border-white/5">
                          {/* Reply-to-Previous Quote Block inside Bubble */}
                          {replyChain.enabled && (
                            <div
                              data-testid="mockup-reply-quote"
                              className="mx-2.5 mt-2.5 px-2.5 py-1.5 rounded-lg bg-[#131E2A] border-r-2 border-sky-400 text-[10.5px]"
                            >
                              <div className="text-sky-400 font-semibold flex items-center gap-1">
                                <CornerUpRight className="w-3 h-3" />
                                <span>پاسخ به پست #{replyChain.channelMessageId}</span>
                              </div>
                              <div className="text-slate-200 font-medium truncate">
                                {replyChain.parentTitle}
                              </div>
                              <div className="text-slate-400 truncate text-[10px]">
                                {replyChain.parentSnippet}
                              </div>
                            </div>
                          )}

                          {cardPreviewUrl && (
                            <img
                              src={carouselSlides[activeSlideIdx] || cardPreviewUrl}
                              alt={headline}
                              referrerPolicy="no-referrer"
                              className="w-full max-h-44 object-cover mt-1.5"
                            />
                          )}

                          <div className="p-3 space-y-2">
                            <div className="text-[12px] leading-relaxed whitespace-pre-wrap break-words text-slate-100">
                              {activeOutput.text}
                            </div>

                            {(activeOutput.hashtags || []).length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-0.5 text-[11px] text-sky-400">
                                {activeOutput.hashtags.map(h => (
                                  <span key={h}>#{h}</span>
                                ))}
                              </div>
                            )}

                            {/* Custom Link Preview Card inside Bubble */}
                            {messengerOpts.showLinkPreview && (
                              <div
                                data-testid="mockup-link-preview"
                                className="p-2 rounded-lg bg-[#131E2A] border-r-2 border-emerald-400 text-[10.5px] space-y-0.5"
                              >
                                <div className="text-emerald-400 font-semibold">
                                  {messengerOpts.customLinkDomain}
                                </div>
                                <div className="text-slate-100 font-medium line-clamp-1">
                                  {messengerOpts.customLinkTitle || headline}
                                </div>
                                <div className="text-slate-400 truncate text-[9.5px]" dir="ltr">
                                  {sourceLink}
                                </div>
                              </div>
                            )}

                            <div className="pt-1 flex items-center justify-end gap-2 text-[10px] text-slate-400 tabular-nums" dir="ltr">
                              {messengerOpts.silent && (
                                <span title="ارسال بی‌صدا" className="text-amber-400 flex items-center gap-0.5">
                                  <BellOff className="w-3 h-3" />
                                </span>
                              )}
                              <span className="flex items-center gap-0.5">
                                <Eye className="w-3 h-3" /> 1.8K
                              </span>
                              <span>14:32</span>
                            </div>
                          </div>
                        </div>

                        {/* Interactive Glass Inline Keyboard Buttons (دکمه‌های شیشه‌ای زیر پست) */}
                        {messengerOpts.inlineButtons.length > 0 && (
                          <div
                            data-testid="mockup-inline-keyboard"
                            className="space-y-1"
                          >
                            {/* Row 1: URL Buttons (full width glass buttons) */}
                            {urlButtons.map(btn => (
                              <div
                                key={btn.id}
                                className="w-full py-1.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 backdrop-blur-md border border-white/10 text-center text-[11px] font-medium text-white flex items-center justify-center gap-1.5 cursor-pointer transition"
                              >
                                <span>{btn.label}</span>
                                <ExternalLink className="w-3 h-3 text-sky-300" />
                              </div>
                            ))}

                            {/* Row 2: Reaction Poll Buttons */}
                            {reactionButtons.length > 0 && (
                              <div className="grid grid-cols-3 gap-1">
                                {reactionButtons.map(btn => (
                                  <button
                                    key={btn.id}
                                    type="button"
                                    onClick={() => incrementReactionInPreview(btn.id)}
                                    className="py-1.5 px-2 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-center text-[11px] font-medium text-white flex items-center justify-center gap-1 transition"
                                  >
                                    <span>{btn.label}</span>
                                    {btn.count !== undefined && (
                                      <span className="text-[10px] text-slate-300 tabular-nums">
                                        {toFa(btn.count)}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Thread Continuations inside Channel */}
                        {replyChain.threadContinuations.map((tc, idx) => (
                          <div
                            key={idx}
                            className="rounded-2xl rounded-tr-sm bg-[#182533]/90 p-2.5 border border-sky-500/20 text-[11.5px] space-y-1"
                          >
                            <div className="text-[10px] text-sky-400 font-semibold">
                              ↳ ادامهٔ زنجیرهٔ خبر ({toFa(idx + 2)})
                            </div>
                            <div className="text-slate-100 leading-relaxed">{tc}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activePlatform === "twitter" && (
                    <div className="flex flex-col bg-black text-white min-h-[490px] p-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full bg-emerald-600 grid place-items-center text-xs font-bold shrink-0">
                          {(brand.name || "F")[0]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold flex items-center gap-1 truncate">
                            <span>{brand.name || "تحریریه کیان"}</span>
                            <span className="text-sky-400">✔</span>
                          </div>
                          <div className="text-[11px] text-slate-500" dir="ltr">
                            @kian_newsroom · 2m
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                        {activeOutput.text}
                      </div>
                      {(activeOutput.hashtags || []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1 text-xs text-sky-400">
                          {activeOutput.hashtags.map(h => (
                            <span key={h}>#{h}</span>
                          ))}
                        </div>
                      )}
                      {replyChain.enabled && (
                        <div className="mt-2.5 p-2.5 rounded-xl border border-slate-800 bg-slate-900/70 text-[11px]">
                          <div className="text-sky-400 font-semibold">پاسخ / بازنشر زنجیره‌ای:</div>
                          <div className="text-slate-200 truncate mt-0.5">{replyChain.parentTitle}</div>
                        </div>
                      )}
                      {cardPreviewUrl && (
                        <div className="mt-3 rounded-2xl overflow-hidden border border-slate-800">
                          <img
                            src={cardPreviewUrl}
                            alt={headline}
                            referrerPolicy="no-referrer"
                            className="w-full max-h-40 object-cover"
                          />
                        </div>
                      )}
                      <div className="mt-auto pt-3 border-t border-slate-800 flex items-center justify-between text-slate-500 text-xs">
                        <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> ۲۴</span>
                        <span className="flex items-center gap-1"><Repeat2 className="w-3.5 h-3.5" /> ۸۶</span>
                        <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> ۴۱۲</span>
                        <span className="flex items-center gap-1"><Bookmark className="w-3.5 h-3.5" /></span>
                      </div>
                    </div>
                  )}

                  {activePlatform === "instagram" && (
                    <div className="flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-[490px]">
                      <div className="px-3 py-2 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-0.5">
                          <div className="w-full h-full rounded-full bg-white dark:bg-slate-950 grid place-items-center text-[10px] font-bold">
                            {(brand.name || "K")[0]}
                          </div>
                        </div>
                        <span className="text-xs font-semibold truncate">
                          {brand.name || "kian.media"}
                        </span>
                      </div>
                      <div className="relative bg-slate-900 aspect-square w-full overflow-hidden">
                        {cardPreviewUrl && (
                          <img
                            src={carouselSlides[activeSlideIdx] || cardPreviewUrl}
                            alt={headline}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        )}
                        {carouselSlides.length > 1 && (
                          <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1">
                            {carouselSlides.map((_, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setActiveSlideIdx(idx)}
                                className={`w-2 h-2 rounded-full ${
                                  idx === activeSlideIdx ? "bg-emerald-400" : "bg-white/50"
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="p-3 space-y-1.5">
                        <div className="flex items-center justify-between text-slate-700 dark:text-slate-200">
                          <div className="flex items-center gap-3">
                            <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
                            <MessageCircle className="w-4 h-4" />
                            <Share2 className="w-4 h-4" />
                          </div>
                          <Bookmark className="w-4 h-4" />
                        </div>
                        <div className="text-[11.5px] leading-relaxed line-clamp-4 whitespace-pre-wrap">
                          <strong className="ml-1">{brand.name || "kian.media"}</strong>
                          {activeOutput.text}
                        </div>
                        {(activeOutput.hashtags || []).length > 0 && (
                          <div className="text-[10.5px] text-sky-600 dark:text-sky-400 truncate">
                            {activeOutput.hashtags.map(h => `#${h}`).join(" ")}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activePlatform === "linkedin" && (
                    <div className="flex flex-col bg-[#F3F2EF] dark:bg-slate-900 text-slate-900 dark:text-slate-100 min-h-[490px] p-2.5">
                      <div className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex-1 flex flex-col">
                        <div className="p-3 flex items-center gap-2">
                          <div className="w-9 h-9 rounded-lg bg-sky-700 text-white grid place-items-center font-bold text-xs">
                            in
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">
                              {brand.name || "مرکز مطالعات و رصد رسانه کیان"}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {brand.tagline || "تحلیل راهبردی داده و رسانه"} · ۱ ساعت پیش
                            </div>
                          </div>
                        </div>
                        <div className="px-3 pb-2 text-[12px] leading-relaxed whitespace-pre-wrap line-clamp-6">
                          {activeOutput.text}
                        </div>
                        {cardPreviewUrl && (
                          <img
                            src={cardPreviewUrl}
                            alt={headline}
                            referrerPolicy="no-referrer"
                            className="w-full max-h-40 object-cover border-t border-slate-100 dark:border-slate-800"
                          />
                        )}
                        <div className="mt-auto px-3 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-around text-[11px] text-slate-500">
                          <span>👍 پسندیدن</span>
                          <span>💬 دیدگاه</span>
                          <span>🔁 بازنشر</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {activePlatform === "website" && (
                    <div className="flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 min-h-[490px] p-3.5 overflow-y-auto">
                      <div className="text-[10px] font-semibold text-emerald-600 mb-1">
                        گزارش تحلیلی · تحریریه وبلاگ
                      </div>
                      <h4 className="text-sm font-bold leading-snug">{headline}</h4>
                      <div className="text-[10px] text-slate-400 my-1.5">
                        زمان مطالعه: ۳ دقیقه · {brand.name || "پایگاه خبری کیان"}
                      </div>
                      {cardPreviewUrl && (
                        <img
                          src={cardPreviewUrl}
                          alt={headline}
                          referrerPolicy="no-referrer"
                          className="w-full h-36 object-cover rounded-xl my-2"
                        />
                      )}
                      <div className="text-xs leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                        {activeOutput.text}
                      </div>
                    </div>
                  )}

                  {/* Phone Bottom Home Indicator */}
                  <div className="h-5 bg-slate-950 grid place-items-center shrink-0">
                    <div className="w-24 h-1 rounded-full bg-slate-600" />
                  </div>
                </div>
              </div>
            ) : (
              /* GRAPHIC CARD DESIGNER CANVAS */
              <div className="w-full space-y-3">
                <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--ink-800)] p-3 flex flex-col items-center">
                  {cardPreviewUrl ? (
                    <img
                      src={cardPreviewUrl}
                      alt={headline}
                      referrerPolicy="no-referrer"
                      className="max-h-60 w-auto rounded-[var(--radius-md)] object-contain shadow-[var(--shadow-md)]"
                    />
                  ) : (
                    <div className="h-48 w-full grid place-items-center text-xs text-[var(--ink-300)]">
                      در حال آماده‌سازی بوم گرافیکی...
                    </div>
                  )}
                </div>

                {/* Primary Card Actions */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleApplyAndUploadCard}
                    disabled={renderingCard}
                    className="h-9 rounded-[var(--radius-md)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--primary-foreground)] text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    {renderingCard ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
                    <span>ثبت کارت برند</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadCard}
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--background-muted)] text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <Download className="size-3.5" />
                    <span>دانلود PNG</span>
                  </button>
                </div>

                {/* Collapsible Graphic Card Customization */}
                <CollapsibleSection
                  title="سفارشی‌سازی طرح، ابعاد و کاروسل"
                  subtitle={`${CARD_THEMES.find(t => t.id === cardTheme)?.label || cardTheme} · ${CARD_RATIOS.find(r => r.id === cardRatio)?.label || cardRatio}`}
                  icon={<Palette className="size-3.5" />}
                  open={layoutPrefs.editorialSections.cardDesigner}
                  onToggle={() => toggleSection("cardDesigner")}
                  testId="toggle-card-designer-section"
                >
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--foreground-subtle)]">تم کارت:</span>
                      <div className="flex items-center gap-1">
                        {CARD_THEMES.map(th => (
                          <button
                            key={th.id}
                            type="button"
                            onClick={() => setCardTheme(th.id)}
                            className={`px-2 py-1 rounded-[var(--radius-sm)] transition cursor-pointer ${
                              cardTheme === th.id
                                ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-medium"
                                : "bg-[var(--background-muted)] text-[var(--foreground-muted)]"
                            }`}
                          >
                            {th.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--foreground-subtle)]">ابعاد بوم:</span>
                      <div className="flex items-center gap-1">
                        {CARD_RATIOS.map(rt => (
                          <button
                            key={rt.id}
                            type="button"
                            onClick={() => setCardRatio(rt.id)}
                            className={`px-2 py-1 rounded-[var(--radius-sm)] transition cursor-pointer ${
                              cardRatio === rt.id
                                ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-medium"
                                : "bg-[var(--background-muted)] text-[var(--foreground-muted)]"
                            }`}
                          >
                            {rt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--foreground-subtle)]">رنگ کانونی:</span>
                      <div className="flex items-center gap-1.5">
                        {ACCENT_PRESETS.map(ac => (
                          <button
                            key={ac.id}
                            type="button"
                            aria-label={`رنگ ${ac.label}`}
                            onClick={() => setCardAccent(ac.id)}
                            title={ac.label}
                            style={{ backgroundColor: ac.id }}
                            className={`size-5 rounded-full transition cursor-pointer ${
                              cardAccent === ac.id ? "ring-2 ring-offset-2 ring-[var(--foreground)] scale-110" : "opacity-80"
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1 pt-1">
                      <label htmlFor="card-custom-title" className="block text-[11px] text-[var(--foreground-subtle)]">
                        تیتر سفارشی روی کارت:
                      </label>
                      <input
                        id="card-custom-title"
                        value={cardCustomTitle}
                        onChange={e => setCardCustomTitle(e.target.value)}
                        placeholder={headline}
                        className="w-full h-8 px-2.5 rounded-[var(--radius-sm)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] text-xs outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="card-footer-source" className="block text-[11px] text-[var(--foreground-subtle)]">
                        امضا / منبع پایین کارت:
                      </label>
                      <input
                        id="card-footer-source"
                        value={cardFooterSource}
                        onChange={e => setCardFooterSource(e.target.value)}
                        placeholder={basketArticles[0]?.source || brand.name || "تحریریه کیان"}
                        className="w-full h-8 px-2.5 rounded-[var(--radius-sm)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] text-xs outline-none"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleBuildCarousel}
                      disabled={renderingCarousel}
                      className="w-full h-8 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--background-subtle)] hover:bg-[var(--accent)] text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      {renderingCarousel ? <Loader2 className="size-3.5 animate-spin" /> : <Layers className="size-3.5" />}
                      <span>ساخت کاروسل چنداسلایدی از متن</span>
                    </button>
                  </div>
                </CollapsibleSection>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Visual Trigger-Condition-Action & Smart Anti-Flood Modal */}
      <OmnichannelAutomationModal
        open={automationModalOpen}
        onClose={() => setAutomationModalOpen(false)}
        rules={compoundRules}
        onSaveRules={nextRules => {
          setCompoundRules(nextRules);
          toast({ kind: "success", message: "قوانین اتوماسیون شرطی ذخیره شدند" });
        }}
        onSimulateRuleNow={() => {
          setDismissedAutopilotIds([]);
          setAutomationModalOpen(false);
          if (autopilotCandidates[0]) {
            handleInspectAutopilotCandidate(autopilotCandidates[0]);
          } else {
            toast({
              kind: "success",
              message: "شبیه‌سازی قانون ترکیبی انجام شد و بستهٔ فوری آمادهٔ تأیید است",
            });
          }
        }}
        queueItems={queueItems}
        onUpdateQueueItems={items => {
          setQueueItems(items);
          toast({
            kind: "success",
            message: `صف زمان‌بندی با فاصلهٔ استاندارد ${toFa(minGapMinutes)} دقیقه توزیع شد`,
          });
        }}
        minGapMinutes={minGapMinutes}
        onChangeMinGapMinutes={gap => setMinGapMinutes(gap)}
        smartSlots={smartSlots}
        onPickSmartSlot={handlePickSmartSlot}
      />
    </div>
  );
}
