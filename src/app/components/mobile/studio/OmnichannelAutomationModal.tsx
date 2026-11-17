import React, { useState } from "react";
import {
  Zap,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Sparkles,
  Plus,
  Trash2,
  Play,
  Send,
  X,
  AlertTriangle,
  CalendarClock,
  Sliders,
  ArrowLeft,
  Flame,
  Edit3,
  ChevronDown,
} from "lucide-react";
import type { StudioPlatform } from "../../../api";
import { PLATFORM_META, ALL_PLATFORMS } from "./studio";
import {
  type CompoundAutomationRule,
  type AutopilotCandidate,
  type ScheduledSlotItem,
  type SmartSlotRecommendation,
  detectFloodConflicts,
  redistributeQueueAntiFlood,
} from "./omnichannelAutomation";
import { toFa } from "../utils/fa";

interface AutopilotBannerProps {
  candidates: AutopilotCandidate[];
  onApproveAndPublish: (candidate: AutopilotCandidate) => void;
  onInspectInEditor: (candidate: AutopilotCandidate) => void;
  onDismiss: (candidateId: string) => void;
  onOpenAutomationBuilder: () => void;
}

/**
 * Top bar for "Human-in-the-Loop Autopilot" (حالت خلبان خودکار با تایید انسان).
 * Shows auto-prepared breaking news packages with red card indicator and
 * one-click "تایید و انتشار فوری" button.
 */
export function AutopilotTopBanner({
  candidates,
  onApproveAndPublish,
  onInspectInEditor,
  onDismiss,
  onOpenAutomationBuilder,
}: AutopilotBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const pending = candidates.filter(c => c.status === "pending_approval");
  const top = pending[0];

  if (!top) {
    return (
      <div
        data-testid="autopilot-status-strip"
        className="px-4 py-1.5 bg-[var(--background-subtle)] text-[var(--foreground-muted)] border-b border-[var(--border-subtle)] flex items-center justify-between gap-3 text-xs shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="size-2 rounded-full bg-[var(--brand-500)] shrink-0" />
          <span className="font-medium text-[var(--foreground)]">خلبان خودکار آماده است</span>
          <span className="hidden sm:inline text-[var(--foreground-subtle)] truncate">
            · رصد زندهٔ خوشه‌های فوری فعال است
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenAutomationBuilder}
          className="px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--accent)] text-[var(--foreground)] text-[11px] font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer"
        >
          <Zap className="size-3.5 text-[var(--brand-600)]" />
          <span>قوانین و صف ضد ازدحام</span>
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="human-in-loop-autopilot-banner"
      className="bg-[var(--background-subtle)] border-b border-[var(--border-subtle)] shrink-0"
    >
      {/* Compact single-line summary bar */}
      <div className="px-4 py-1.5 flex items-center justify-between gap-3 text-xs">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-right rounded-[var(--radius-sm)] py-0.5 hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] cursor-pointer"
        >
          <span className="size-2 rounded-full bg-[var(--danger-500)] shrink-0" />
          <span className="font-semibold text-[var(--foreground)] shrink-0">
            پیشنهاد خلبان خودکار ({toFa(pending.length)})
          </span>
          <span className="text-[var(--foreground-muted)] truncate">
            {top.headline}
          </span>
          <span className="hidden md:inline text-[11px] text-[var(--foreground-subtle)] shrink-0 tabular-nums">
            · {toFa(top.sourceCount)} منبع در {toFa(top.spanMinutes)} دقیقه
          </span>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="autopilot-approve-publish-btn"
            onClick={() => onApproveAndPublish(top)}
            className="h-7 px-2.5 rounded-[var(--radius-sm)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--primary-foreground)] text-[11px] font-medium inline-flex items-center gap-1 transition whitespace-nowrap cursor-pointer"
          >
            <CheckCircle2 className="size-3.5" />
            <span>تأیید و انتشار</span>
          </button>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "بستن جزئیات خلبان خودکار" : "گسترش جزئیات خلبان خودکار"}
            onClick={() => setExpanded(v => !v)}
            className="h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] text-[11px] inline-flex items-center gap-1 transition cursor-pointer"
          >
            <span>{expanded ? "بستن" : "جزئیات"}</span>
            <ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Expanded details drawer (only when user expands) */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 flex items-center justify-between gap-3 flex-wrap border-t border-[var(--border-subtle)] bg-[var(--card)]">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="size-9 rounded-[var(--radius-md)] bg-[var(--danger-50)] border border-[var(--danger-500)]/20 text-[var(--danger-600)] shrink-0 grid place-items-center">
              <Flame className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--danger-50)] text-[var(--danger-600)] font-semibold inline-flex items-center gap-1">
                  <ShieldAlert className="size-3" />
                  خوشهٔ فوری
                </span>
                <span className="text-[var(--foreground-subtle)] tabular-nums">
                  {toFa(top.sourceCount)} خبرگزاری در {toFa(top.spanMinutes)} دقیقه · احساسات:{" "}
                  {top.sentiment === "critical" ? "بحرانی" : "منفی"}
                </span>
              </div>
              <div className="text-xs font-semibold text-[var(--foreground)] truncate mt-0.5">
                {top.headline}
              </div>
              <div className="text-[11px] text-[var(--foreground-subtle)] truncate">
                منابع: {top.sources.slice(0, 4).join("، ")} · مقصد:{" "}
                {top.platforms.map(p => PLATFORM_META[p]?.label).join("، ")}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="autopilot-inspect-btn"
              onClick={() => onInspectInEditor(top)}
              className="h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--background)] hover:bg-[var(--accent)] text-[var(--foreground)] text-xs font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer"
            >
              <Edit3 className="size-3.5" />
              <span>بازبینی در ویرایشگر</span>
            </button>
            <button
              type="button"
              onClick={onOpenAutomationBuilder}
              className="h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--background)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] text-xs font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer"
            >
              <Sliders className="size-3.5" />
              <span>قوانین شرطی</span>
            </button>
            <button
              type="button"
              onClick={() => onDismiss(top.id)}
              aria-label="رد کردن پیشنهاد خلبان خودکار"
              title="رد کردن این پیشنهاد"
              className="size-8 grid place-items-center rounded-[var(--radius-md)] text-[var(--foreground-subtle)] hover:text-[var(--foreground)] hover:bg-[var(--background-muted)] cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  rules: CompoundAutomationRule[];
  onSaveRules: (rules: CompoundAutomationRule[]) => void;
  onSimulateRuleNow: () => void;
  queueItems: ScheduledSlotItem[];
  onUpdateQueueItems: (items: ScheduledSlotItem[]) => void;
  minGapMinutes: number;
  onChangeMinGapMinutes: (gap: number) => void;
  smartSlots: SmartSlotRecommendation[];
  onPickSmartSlot: (slotTs: number) => void;
}

/**
 * Interactive modal for:
 * 1. Visual Trigger-Condition-Action Builder (موتور اتوماسیون شرطی پیشرفته)
 * 2. Smart Slot & Anti-Flood Limiter (پیشنهاددهندهٔ بهترین زمان انتشار و جلوگیری از ازدحام)
 */
export function OmnichannelAutomationModal({
  open,
  onClose,
  rules,
  onSaveRules,
  onSimulateRuleNow,
  queueItems,
  onUpdateQueueItems,
  minGapMinutes,
  onChangeMinGapMinutes,
  smartSlots,
  onPickSmartSlot,
}: ModalProps) {
  const [activeTab, setActiveTab] = useState<"builder" | "antiflood">("builder");

  // New rule draft state in Visual Trigger-Condition-Action format
  const [name, setName] = useState(
    "خوشهٔ بحرانی: ۳+ خبرگزاری در <۲۰ دقیقه + احساسات منفی ⬅ کارت قرمز",
  );
  const [minSources, setMinSources] = useState(3);
  const [withinMinutes, setWithinMinutes] = useState(20);
  const [sentimentCondition, setSentimentCondition] =
    useState<CompoundAutomationRule["sentimentCondition"]>("negative_or_critical");
  const [actionCardStyle, setActionCardStyle] =
    useState<CompoundAutomationRule["actionCardStyle"]>("breaking_red");
  const [actionPriority, setActionPriority] =
    useState<CompoundAutomationRule["actionPriority"]>("high");
  const [autopilotMode, setAutopilotMode] =
    useState<CompoundAutomationRule["autopilotMode"]>("human_in_loop");
  const [selectedPlatforms, setSelectedPlatforms] = useState<StudioPlatform[]>([
    "telegram",
    "bale",
    "eitaa",
    "rubika",
    "twitter",
  ]);

  if (!open) return null;

  const conflicts = detectFloodConflicts(queueItems, minGapMinutes);

  const togglePlat = (p: StudioPlatform) => {
    setSelectedPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p],
    );
  };

  const handleAddCompoundRule = () => {
    if (!name.trim()) return;
    const newRule: CompoundAutomationRule = {
      id: `crule-${Date.now()}`,
      name: name.trim(),
      enabled: true,
      triggerType: "breaking_cluster",
      minSources,
      withinMinutes,
      keywords: [],
      sentimentCondition,
      actionCardStyle,
      actionPriority,
      autopilotMode,
      platforms: selectedPlatforms.length ? selectedPlatforms : ["telegram"],
      antiFloodMinGapMinutes: minGapMinutes,
    };
    onSaveRules([newRule, ...rules]);
  };

  const handleToggleRule = (id: string) => {
    onSaveRules(
      rules.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  };

  const handleDeleteRule = (id: string) => {
    onSaveRules(rules.filter(r => r.id !== id));
  };

  const handleAutoSpaceQueue = () => {
    const spaced = redistributeQueueAntiFlood(queueItems, minGapMinutes, Date.now());
    onUpdateQueueItems(spaced);
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[80] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        data-testid="omnichannel-automation-modal"
        className="w-full max-w-4xl max-h-[88vh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-emerald-600 text-white grid place-items-center">
              <Zap className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-sm font-bold">
                موتور اتوماسیون شرطی پیشرفته و صف هوشمند ضد ازدحام
              </h3>
              <p className="text-[11px] text-slate-500">
                طراحی قوانین ترکیبی (Trigger ➔ Condition ➔ Action)، خلبان خودکار با تأیید انسان و مدیریت فاصلهٔ انتشار
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-5 pt-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setActiveTab("builder")}
            className={`px-4 py-2 border-b-2 text-xs font-semibold flex items-center gap-1.5 transition ${
              activeTab === "builder"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>سازندهٔ بصری قوانین شرطی (Trigger-Condition-Action)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("antiflood")}
            className={`px-4 py-2 border-b-2 text-xs font-semibold flex items-center gap-1.5 transition ${
              activeTab === "antiflood"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <CalendarClock className="w-4 h-4" />
            <span>پیشنهاد زمان هوشمند و ضد ازدحام (Anti-Flood)</span>
            {conflicts.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px]">
                {toFa(conflicts.length)} تداخل
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {activeTab === "builder" ? (
            <>
              {/* Visual 3-Step Pipeline Card (IF Trigger -> AND Condition -> THEN Action) */}
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    طراحی بصری قانون ترکیبی جدید
                  </span>
                  <button
                    type="button"
                    onClick={onSimulateRuleNow}
                    className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>تست و شبیه‌سازی فوری روی اخبار فعلی</span>
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">عنوان قانون اتوماسیون:</label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full h-9 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium outline-none focus:border-emerald-500"
                  />
                </div>

                {/* 3 Visual Blocks: Trigger -> Condition -> Action */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
                  {/* Block 1: TRIGGER */}
                  <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border-2 border-sky-500/30 space-y-2.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-600 dark:text-sky-400 text-[10.5px] font-bold whitespace-nowrap">
                        ۱. اگر (Trigger)
                      </span>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">خوشهٔ خبر فوری</span>
                    </div>
                    <div className="text-xs font-semibold">
                      همگرایی چند خبرگزاری در بازهٔ کوتاه
                    </div>
                    <div className="space-y-2 text-xs">
                      <label className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">حداقل تعداد خبرگزاری:</span>
                        <select
                          value={minSources}
                          onChange={e => setMinSources(Number(e.target.value))}
                          className="h-7 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 font-semibold"
                        >
                          <option value={2}>۲ خبرگزاری</option>
                          <option value={3}>۳ خبرگزاری معتبر</option>
                          <option value={4}>۴ خبرگزاری معتبر</option>
                          <option value={5}>۵+ خبرگزاری معتبر</option>
                        </select>
                      </label>
                      <label className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">در بازهٔ زمانی کمتر از:</span>
                        <select
                          value={withinMinutes}
                          onChange={e => setWithinMinutes(Number(e.target.value))}
                          className="h-7 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 font-semibold"
                        >
                          <option value={10}>۱۰ دقیقه</option>
                          <option value={20}>۲۰ دقیقه</option>
                          <option value={30}>۳۰ دقیقه</option>
                          <option value={60}>۶۰ دقیقه</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  {/* Block 2: CONDITION */}
                  <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border-2 border-amber-500/30 space-y-2.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10.5px] font-bold whitespace-nowrap">
                        ۲. و شرط (Condition)
                      </span>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">تحلیل احساسات</span>
                    </div>
                    <div className="text-xs font-semibold">
                      ارزیابی بار احساسی و اهمیت خبر
                    </div>
                    <div className="space-y-2 text-xs">
                      <label className="block text-slate-500 text-[11px]">امتیاز احساسات رویداد:</label>
                      <select
                        value={sentimentCondition}
                        onChange={e => setSentimentCondition(e.target.value as any)}
                        className="w-full h-8 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 font-medium"
                      >
                        <option value="negative_or_critical">منفی یا بحرانی (هشدار / تنش)</option>
                        <option value="any">همهٔ احساسات (بدون محدودیت)</option>
                        <option value="positive">مثبت و دستاوردی</option>
                        <option value="neutral">خنثی و گزارشی</option>
                      </select>
                    </div>
                  </div>

                  {/* Block 3: ACTION */}
                  <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border-2 border-rose-500/40 space-y-2.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[10.5px] font-bold whitespace-nowrap">
                        ۳. آنگاه اقدام (Action)
                      </span>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">تولید و صف اولویت</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <label className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">قالب کارت گرافیکی:</span>
                        <select
                          value={actionCardStyle}
                          onChange={e => setActionCardStyle(e.target.value as any)}
                          className="h-7 px-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-semibold"
                        >
                          <option value="breaking_red">کارت قرمز خبر فوری</option>
                          <option value="dark_editorial">کارت تیره تحلیلی</option>
                          <option value="brand_signature">کارت برند اختصاصی</option>
                        </select>
                      </label>
                      <label className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">اولویت صف انتشار:</span>
                        <select
                          value={actionPriority}
                          onChange={e => setActionPriority(e.target.value as any)}
                          className="h-7 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 font-semibold"
                        >
                          <option value="high">اولویت بالا (صدر صف)</option>
                          <option value="urgent">فوری (عبور از ضد ازدحام)</option>
                          <option value="normal">عادی (با فاصلهٔ ۲۰ دقیقه)</option>
                        </select>
                      </label>
                      <label className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">نحوهٔ انتشار:</span>
                        <select
                          value={autopilotMode}
                          onChange={e => setAutopilotMode(e.target.value as any)}
                          className="h-7 px-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold"
                        >
                          <option value="human_in_loop">خلبان خودکار با تأیید انسان</option>
                          <option value="full_auto">انتشار کاملاً خودکار</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Target Platforms + Save Rule */}
                <div className="pt-2 flex items-center justify-between gap-3 flex-wrap border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-slate-500 ml-1">کانال‌های هدف:</span>
                    {ALL_PLATFORMS.map(p => {
                      const active = selectedPlatforms.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => togglePlat(p)}
                          className={`px-2 py-1 rounded-lg text-[11px] flex items-center gap-1 border transition ${
                            active
                              ? "bg-emerald-600 border-emerald-600 text-white font-medium"
                              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500"
                          }`}
                        >
                          <span>{PLATFORM_META[p].emoji}</span>
                          <span>{PLATFORM_META[p].label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={handleAddCompoundRule}
                    className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>ثبت قانون ترکیبی</span>
                  </button>
                </div>
              </div>

              {/* Active Compound Rules List */}
              <div className="space-y-2.5">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  قوانین شرطی فعال ({toFa(rules.length)})
                </div>
                {rules.map(rule => (
                  <div
                    key={rule.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold">{rule.name}</span>
                        <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[10px] font-semibold">
                          {rule.actionCardStyle === "breaking_red" ? "کارت قرمز فوری" : "کارت تحریریه"}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold">
                          {rule.autopilotMode === "human_in_loop"
                            ? "خلبان خودکار با تأیید انسان"
                            : "انتشار خودکار"}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                        <span>
                          اگر ≥ {toFa(rule.minSources)} خبرگزاری در &lt; {toFa(rule.withinMinutes)} دقیقه
                        </span>
                        <ArrowLeft className="w-3 h-3" />
                        <span>
                          احساسات:{" "}
                          {rule.sentimentCondition === "negative_or_critical"
                            ? "منفی / بحرانی"
                            : "همه"}
                        </span>
                        <ArrowLeft className="w-3 h-3" />
                        <span>
                          اولویت: {rule.actionPriority === "high" ? "بالا" : "فوری"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(rule.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                          rule.enabled
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-200 dark:bg-slate-800 text-slate-500"
                        }`}
                      >
                        {rule.enabled ? "فعال" : "غیرفعال"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* TAB 2: SMART SLOT & ANTI-FLOOD LIMITER */
            <div className="space-y-5">
              {/* Anti-Flood Limiter Configuration */}
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex items-center justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-emerald-600" />
                    محدودکنندهٔ ضد ازدحام و بمباران خبری (Anti-Flood Limiter)
                  </div>
                  <p className="text-[11px] text-slate-500">
                    حداقل فاصلهٔ زمانی استاندارد بین دو پست عادی در صف زمان‌بندی برای جلوگیری از ریزش مخاطب:
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {[15, 20, 30, 45].map(gap => (
                    <button
                      key={gap}
                      type="button"
                      onClick={() => onChangeMinGapMinutes(gap)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                        minGapMinutes === gap
                          ? "bg-emerald-600 border-emerald-600 text-white"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {toFa(gap)} دقیقه فاصله
                    </button>
                  ))}
                </div>
              </div>

              {/* Flood Warning & Auto-Redistribute Action */}
              {conflicts.length > 0 ? (
                <div className="p-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold text-amber-800 dark:text-amber-300">
                        هشدار ازدحام صف: {toFa(conflicts.length)} تداخل زمانی کمتر از {toFa(minGapMinutes)} دقیقه شناسایی شد!
                      </div>
                      <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                        پست‌های «{conflicts[0].itemATitle.slice(0, 35)}» و «{conflicts[0].itemBTitle.slice(0, 35)}» تنها{" "}
                        {toFa(conflicts[0].gapMinutes)} دقیقه فاصله دارند.
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="anti-flood-redistribute-btn"
                    onClick={handleAutoSpaceQueue}
                    className="h-9 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs whitespace-nowrap"
                  >
                    <CalendarClock className="w-4 h-4" />
                    <span>توزیع خودکار با فاصلهٔ {toFa(minGapMinutes)} دقیقه</span>
                  </button>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    صف انتشار کاملاً متوازن است — تمام پست‌ها حداقل {toFa(minGapMinutes)} دقیقه با یکدیگر فاصله دارند.
                  </span>
                </div>
              )}

              {/* Smart Slot Recommendations */}
              <div className="space-y-2.5">
                <div className="text-xs font-bold">
                  پیشنهاددهندهٔ بهترین زمان انتشار (Smart Slots — بدون تداخل با صف)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {smartSlots.map(slot => (
                    <div
                      key={slot.ts}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            {slot.label}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold">
                            امتیاز تعامل: {toFa(slot.engagementScore)}٪
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{slot.reason}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onPickSmartSlot(slot.ts);
                          onClose();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap"
                      >
                        انتخاب اسلات
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Current Queue Timeline Preview */}
              <div className="space-y-2">
                <div className="text-xs font-bold">
                  پست‌های موجود در صف زمان‌بندی ({toFa(queueItems.length)})
                </div>
                <div className="space-y-2">
                  {queueItems.map((item, idx) => {
                    const prev = idx > 0 ? queueItems[idx - 1] : null;
                    const gapMin = prev
                      ? Math.round((item.scheduledAt - prev.scheduledAt) / 60000)
                      : null;
                    const isCrowded = gapMin !== null && gapMin < minGapMinutes && item.priority !== "urgent";
                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                          isCrowded
                            ? "border-amber-500/60 bg-amber-50/40 dark:bg-amber-950/20"
                            : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate">{item.title}</div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>
                              موعد:{" "}
                              {new Date(item.scheduledAt).toLocaleTimeString("fa-IR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            {gapMin !== null && (
                              <span
                                className={
                                  isCrowded
                                    ? "text-amber-600 font-bold"
                                    : "text-emerald-600 dark:text-emerald-400"
                                }
                              >
                                · فاصله از پست قبلی: {toFa(gapMin)} دقیقه
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10.5px] font-medium ${
                            item.priority === "high" || item.priority === "urgent"
                              ? "bg-rose-500/15 text-rose-600"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                          }`}
                        >
                          {item.priority === "urgent"
                            ? "فوری"
                            : item.priority === "high"
                              ? "اولویت بالا"
                              : "عادی"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
