import React from "react";
import { Play, Pause, RotateCcw, ChevronRight, ChevronLeft, Clock } from "lucide-react";
import type { TemporalLifecycleSummary } from "./graphAnalytics";

const toFa = (n: number | string) =>
  String(n).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

export type TimeTravelScrubberProps = {
  windowHours: number;
  cursorHour: number;
  playing: boolean;
  speed: 1 | 2 | 5;
  lifecycle: TemporalLifecycleSummary;
  nodeCount: number;
  clusterCount: number;
  onTogglePlay: () => void;
  onResetLive: () => void;
  onChangeSpeed: (speed: 1 | 2 | 5) => void;
  onChangeWindowHours: (hours: number) => void;
  onScrubHour: (hour: number) => void;
};

export function TimeTravelScrubber({
  windowHours,
  cursorHour,
  playing,
  speed,
  lifecycle,
  nodeCount,
  clusterCount,
  onTogglePlay,
  onResetLive,
  onChangeSpeed,
  onChangeWindowHours,
  onScrubHour,
}: TimeTravelScrubberProps) {
  const hoursAgo = Math.max(0, Math.round(windowHours - cursorHour));
  const isLive = hoursAgo === 0;
  const cursorDateStr = new Date(lifecycle.cursorTs).toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Downsample buckets to at most 28 bars for crisp display
  const rawBuckets = lifecycle.buckets;
  const maxBars = 28;
  const step = Math.max(1, Math.ceil(rawBuckets.length / maxBars));
  const bars: {
    index: number;
    endHour: number;
    articles: number;
    growing: number;
    peaking: number;
    decaying: number;
  }[] = [];

  for (let i = 0; i < rawBuckets.length; i += step) {
    const slice = rawBuckets.slice(i, i + step);
    const articles = slice.reduce((acc, b) => acc + b.articleCount, 0);
    const last = slice[slice.length - 1];
    bars.push({
      index: i,
      endHour: last.hourIndex + 1,
      articles,
      growing: last.growingCount,
      peaking: last.peakingCount,
      decaying: last.decayingCount,
    });
  }

  const maxArticles = Math.max(1, ...bars.map(b => b.articles));

  return (
    <div
      dir="rtl"
      data-testid="time-travel-scrubber"
      className="absolute bottom-3 left-3 right-3 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 shadow-sm flex flex-col gap-2"
    >
      {/* Top Row: Lifecycle Metrics + Timestamp */}
      <div className="flex items-center justify-between gap-3 flex-wrap text-[11px]">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">
            سفر در زمان و چرخهٔ عمر خوشه‌ها
          </span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
            {isLive
              ? `اکنون (زنده — ساعت ${cursorDateStr})`
              : `${toFa(hoursAgo)} ساعت پیش (ساعت ${cursorDateStr})`}
          </span>
        </div>

        {/* Growth / Peak / Decay counters */}
        <div className="flex items-center gap-3 text-[11px] tabular-nums">
          <span className="text-emerald-700 dark:text-emerald-400 font-medium whitespace-nowrap">
            رشد: {toFa(lifecycle.growingCount)} خوشه
          </span>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span className="text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap">
            اوج: {toFa(lifecycle.peakingCount)} خوشه
          </span>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">
            فروکش: {toFa(lifecycle.decayingCount)} خوشه
          </span>
          <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">·</span>
          <span className="text-slate-600 dark:text-slate-300 hidden sm:inline whitespace-nowrap">
            {toFa(nodeCount)} منبع فعال · {toFa(clusterCount)} خوشهٔ کل
          </span>
        </div>
      </div>

      {/* Bottom Row: Playback Controls + 24h Histogram Scrubber */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Play/Pause + Step Back/Forward + Reset */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onTogglePlay}
            title={playing ? "توقف پخش زمان (Pause)" : "پخش تکامل شبکه (Play)"}
            aria-label={playing ? "توقف پخش زمان" : "پخش تکامل شبکه"}
            className="w-8 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center transition shadow-xs"
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          </button>
          <button
            type="button"
            onClick={() => onScrubHour(Math.max(1, Math.round(cursorHour - 1)))}
            title="۱ ساعت به عقب"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onScrubHour(Math.min(windowHours, Math.round(cursorHour + 1)))}
            title="۱ ساعت به جلو"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onResetLive}
            title="بازگشت به لحظهٔ فعلی (Live)"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Speed Selector (1x / 2x / 5x) */}
        <div
          className="flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px] shrink-0"
          role="group"
          aria-label="سرعت پخش"
        >
          {([1, 2, 5] as const).map(spd => (
            <button
              key={spd}
              type="button"
              onClick={() => onChangeSpeed(spd)}
              className={`px-2 py-0.5 rounded-md tabular-nums transition whitespace-nowrap ${
                speed === spd
                  ? "bg-emerald-600 text-white font-semibold shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              {spd}x
            </button>
          ))}
        </div>

        {/* Window Quick-Toggle (24h / 7d) */}
        <div className="flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px] shrink-0">
          <button
            type="button"
            onClick={() => onChangeWindowHours(24)}
            className={`px-2 py-0.5 rounded-md transition whitespace-nowrap ${
              windowHours <= 24
                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium shadow-2xs"
                : "text-slate-500"
            }`}
          >
            ۲۴ ساعت
          </button>
          <button
            type="button"
            onClick={() => onChangeWindowHours(168)}
            className={`px-2 py-0.5 rounded-md transition whitespace-nowrap ${
              windowHours === 168
                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium shadow-2xs"
                : "text-slate-500"
            }`}
          >
            ۷ روز
          </button>
        </div>

        {/* Interactive Timeline Bars + Range Scrubber */}
        <div className="flex-1 min-w-[200px] flex flex-col gap-1">
          <div className="h-5 flex items-end gap-[2px] px-1">
            {bars.map(b => {
              const reached = b.endHour <= Math.ceil(cursorHour);
              const hPct = Math.max(18, Math.round((b.articles / maxArticles) * 100));
              const barColor = !reached
                ? "bg-slate-200 dark:bg-slate-800"
                : b.peaking > 0
                  ? "bg-amber-500/85 dark:bg-amber-400/80"
                  : b.growing > 0
                    ? "bg-emerald-500/85 dark:bg-emerald-400/80"
                    : "bg-slate-400/70 dark:bg-slate-600";
              return (
                <button
                  key={b.index}
                  type="button"
                  onClick={() => onScrubHour(b.endHour)}
                  title={`${toFa(Math.max(0, windowHours - b.endHour))} ساعت پیش · ${toFa(b.articles)} خبر · رشد:${toFa(b.growing)} اوج:${toFa(b.peaking)} فروکش:${toFa(b.decaying)}`}
                  style={{ height: `${hPct}%` }}
                  className={`flex-1 rounded-t-xs transition-all cursor-pointer hover:opacity-100 ${barColor}`}
                />
              );
            })}
          </div>
          <input
            type="range"
            aria-label="نوار زمان گراف"
            min={1}
            max={windowHours}
            step={0.25}
            value={cursorHour}
            onChange={e => onScrubHour(Number(e.target.value))}
            className="w-full accent-emerald-600 h-1.5 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
