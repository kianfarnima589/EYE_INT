import { Search, Rss, FileText, Star, Circle, Settings, Plus, TrendingUp, Bookmark, Tag, FileUp, ChevronDown, ChevronLeft, RefreshCw, AlertTriangle, Trash2, Network, Globe2, BarChart3, Sunrise, Command, Sparkles, Filter, Brain, NotebookPen, Clock, Pin, X, Wand2, Radar, Package, MonitorDot, Crosshair, Workflow, Columns3, PanelRightClose, PanelRightOpen, HelpCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Languages, CopyMinus } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { type Topic, topicColorClasses } from "../topics";
import { useAutoTranslateTitles, getAutoTranslate, setAutoTranslate, useDedupeArticles, getDedupe, setDedupe } from "../translationCache";

export type SidebarFeed = { id: string; name: string; count: number; icon: string; category: string };
export type PinnedTopic = { topic: Topic; count: number; active: boolean };

type Props = {
  activeView: string;
  setActiveView: (v: string) => void;
  selectedFeed: string | null;
  setSelectedFeed: (id: string | null) => void;
  selectedCategory: string | null;
  setSelectedCategory: (c: string | null) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  feeds: SidebarFeed[];
  onAddFeed: () => void;
  onRefresh: () => void;
  loading: boolean;
  totals: { all: number; unread: number; starred: number; saved: number };
  search: string;
  setSearch: (s: string) => void;
  lastRefresh: Date | null;
  feedStatus?: Record<string, { ok: boolean; error?: string }>;
  onOpenOpml?: () => void;
  onRemoveFeed?: (id: string) => void;
  onPruneFeeds?: () => void;
  pruning?: boolean;
  onOpenStats?: () => void;
  onOpenDigest?: () => void;
  onOpenPalette?: () => void;
  onOpenSourceHub?: () => void;
  onOpenSavedSearches?: () => void;
  onOpenKnowledge?: () => void;
  onOpenNotes?: () => void;
  onOpenTimeline?: () => void;
  onOpenStudio?: () => void;
  onOpenVisualFlow?: () => void;
  pinnedTopics?: PinnedTopic[];
  onToggleTopic?: (id: string) => void;
  onClearTopics?: () => void;
  onAddTopic?: () => void;
  socialUnread?: number;
  watchUnread?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  activeWorkspaceTab?: "reader" | "editorial" | "visual_flow" | "graph";
};

export function Sidebar({
  activeView, setActiveView, selectedFeed, setSelectedFeed,
  selectedCategory = null, setSelectedCategory = () => {},
  theme, onToggleTheme, feeds, onAddFeed, onRefresh, loading,
  totals = { all: 0, unread: 0, starred: 0, saved: 0 },
  search = "", setSearch = () => {}, lastRefresh = null,
  feedStatus = {}, onOpenOpml = () => {}, onRemoveFeed, onPruneFeeds, pruning = false, onOpenHelp, onOpenRules,
  onOpenStats, onOpenDigest, onOpenPalette, onOpenSourceHub, onOpenSavedSearches, onOpenKnowledge, onOpenNotes, onOpenTimeline, onOpenStudio, onOpenVisualFlow,
  pinnedTopics = [], onToggleTopic, onClearTopics, onAddTopic, socialUnread = 0, watchUnread = 0,
  collapsed: controlledCollapsed, onToggleCollapse, activeWorkspaceTab,
}: Props & { onOpenHelp?: () => void; onOpenRules?: () => void }) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = controlledCollapsed ?? internalCollapsed;
  const handleToggleCollapse = () => {
    if (onToggleCollapse) onToggleCollapse();
    else setInternalCollapsed(v => !v);
  };
  const [feedsOpen, setFeedsOpen] = useState(true);
  const [catsOpen, setCatsOpen] = useState(true);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const autoTranslate = useAutoTranslateTitles();
  const dedupe = useDedupeArticles();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const navGroups = [
    {
      id: 'reading',
      label: 'خواندن',
      icon: FileText,
      items: [
        { id: 'all', label: 'همه مقالات', icon: FileText, count: totals.all },
        { id: 'unread', label: 'خوانده نشده', icon: Circle, count: totals.unread },
        { id: 'starred', label: 'نشان شده‌ها', icon: Star, count: totals.starred },
        { id: 'saved', label: 'ذخیره شده‌ها', icon: Bookmark, count: totals.saved },
      ],
    },
    {
      id: 'discover',
      label: 'کشف و رصد',
      icon: Radar,
      items: [
        { id: 'trending', label: 'پرطرفدارها', icon: TrendingUp, count: null },
        { id: 'tags', label: 'برچسب‌ها', icon: Tag, count: null },
        { id: 'international', label: 'اخبار بین‌الملل', icon: Globe2, count: null },
        { id: 'graph', label: 'نقشهٔ رسانه‌ای', icon: Network, count: null },
        { id: 'room', label: 'اتاق رصد رسانه‌ای', icon: MonitorDot, count: null },
        { id: 'social', label: 'رصد اجتماعی', icon: Radar, count: null, badge: socialUnread || null },
        { id: 'watch', label: 'رصد تغییرات صفحه', icon: Crosshair, count: null, badge: watchUnread || null },
      ],
    },
    {
      id: 'tools',
      label: 'ابزارها',
      icon: Wand2,
      items: [
        { id: 'visual-flow', label: 'بوم بصری اتوماسیون', icon: Workflow, count: null, action: onOpenVisualFlow || onOpenStudio },
        { id: 'studio', label: 'استودیوی محتوا (۳ستونه)', icon: Columns3, count: null, action: onOpenStudio },
        { id: 'newspack', label: 'بسته‌های خبری سفارشی', icon: Package, count: null },
        { id: 'digest', label: 'گزارش روزانه', icon: Sunrise, count: null, action: onOpenDigest },
        { id: 'stats', label: 'داشبورد آمار', icon: BarChart3, count: null, action: onOpenStats },
        { id: 'source-hub', label: 'منبع‌یاب چندپلتفرمی', icon: Sparkles, count: null, action: onOpenSourceHub },
        { id: 'saved-searches', label: 'فیلترهای ذخیره‌شده', icon: Filter, count: null, action: onOpenSavedSearches },
        { id: 'knowledge', label: 'موتور دانش', icon: Brain, count: null, action: onOpenKnowledge },
        { id: 'notes', label: 'یادداشت‌ها', icon: NotebookPen, count: null, action: onOpenNotes },
        { id: 'timeline', label: 'خط زمانی موضوع', icon: Clock, count: null, action: onOpenTimeline },
      ],
    },
  ];

  const grouped = useMemo(() => {
    const m = new Map<string, SidebarFeed[]>();
    for (const f of feeds) {
      const k = f.category || 'سایر';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [feeds]);

  const catColor = (name: string) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `hsl(${hue} 70% 50%)`;
  };

  const toggleCat = (name: string) => {
    const next = new Set(expandedCats);
    next.has(name) ? next.delete(name) : next.add(name);
    setExpandedCats(next);
  };

  return (
    <aside
      data-testid="app-sidebar"
      data-collapsed={isCollapsed ? "true" : "false"}
      className={`${
        isCollapsed ? "w-[68px]" : "w-72 max-w-[85vw]"
      } shrink-0 bg-[var(--background-subtle)] border-l border-[var(--border-subtle)] flex flex-col h-full transition-all duration-200 overflow-x-hidden`}
    >
      <div className={`${isCollapsed ? "p-2.5 space-y-2.5 flex flex-col items-center" : "p-4"} border-b border-[var(--border-subtle)]`}>
        {isCollapsed ? (
          <>
            <button
              type="button"
              onClick={handleToggleCollapse}
              data-testid="sidebar-collapse-toggle"
              aria-expanded={false}
              aria-label="باز کردن نوار کناری"
              title="باز کردن نوار کناری"
              className="size-9 grid place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
            <div
              title="FLOW — کاربر نمونه"
              className="size-9 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white text-sm font-bold"
            >
              ک
            </div>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button
              type="button"
              onClick={() => handleToggleCollapse()}
              aria-label="جستجو در مقالات"
              title="جستجو در مقالات (باز کردن نوار کناری)"
              className="size-9 grid place-items-center rounded-[var(--radius-md)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
            >
              <Search className="w-4 h-4" />
            </button>
            {onOpenPalette && (
              <button
                type="button"
                onClick={onOpenPalette}
                aria-label="پنل دستورات"
                title="پنل دستورات (Ctrl K)"
                className="size-9 grid place-items-center rounded-[var(--radius-md)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
              >
                <Command className="w-4 h-4" />
              </button>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[20px] font-black tracking-tight text-[var(--foreground)]">FLOW</span>
              <button
                type="button"
                onClick={handleToggleCollapse}
                data-testid="sidebar-collapse-toggle"
                aria-expanded={true}
                aria-label="جمع کردن نوار کناری"
                title="جمع کردن نوار کناری"
                className="hidden md:grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shrink-0">ک</div>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium text-sm">کاربر نمونه</div>
                <div className="text-[var(--foreground-subtle)] text-xs truncate">user@example.com</div>
              </div>
              <ThemeToggle theme={theme} onToggle={onToggleTheme} />
              <div className="relative">
            <button
              onClick={() => setSettingsOpen(o => !o)}
              aria-label="تنظیمات"
              title="تنظیمات"
              className={`p-1 rounded ${settingsOpen ? "bg-slate-200 dark:bg-slate-800" : "hover:bg-slate-200 dark:hover:bg-slate-800"}`}
            >
              <Settings className="w-4 h-4 text-slate-500" />
            </button>
            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} />
                <div className="absolute left-0 top-full mt-2 z-50 w-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3" dir="rtl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">تنظیمات</span>
                    <button onClick={() => setSettingsOpen(false)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  </div>
                  <div className="text-[11px] font-medium text-slate-400 mb-1.5 px-0.5">زبان و ترجمه</div>
                  <button
                    onClick={() => setAutoTranslate(!getAutoTranslate())}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-right"
                  >
                    <span className="shrink-0 w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950 grid place-items-center">
                      <Languages className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-slate-900 dark:text-white">ترجمهٔ خودکار تیترها</span>
                      <span className="block text-[11px] text-slate-500 leading-tight">نمایش خودکار همهٔ تیترهای غیرفارسی به فارسی</span>
                    </span>
                    <span className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${autoTranslate ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"}`}>
                      <span className={`absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoTranslate ? "-translate-x-4" : ""}`} />
                    </span>
                  </button>
                  <button
                    onClick={() => setDedupe(!getDedupe())}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-right"
                  >
                    <span className="shrink-0 w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950 grid place-items-center">
                      <CopyMinus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-slate-900 dark:text-white">حذف خودکار اخبار تکراری</span>
                      <span className="block text-[11px] text-slate-500 leading-tight">ادغام تیترهای مشابه از منابع مختلف در یک مورد</span>
                    </span>
                    <span className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${dedupe ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"}`}>
                      <span className={`absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-white transition-transform ${dedupe ? "-translate-x-4" : ""}`} />
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            type="text"
            data-search-input
            placeholder="جستجو در مقالات... ( / )"
            className="w-full bg-[var(--card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] py-2 pr-9 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        {onOpenPalette && (
          <button onClick={onOpenPalette}
            className="mt-2 w-full flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] hover:border-emerald-400 dark:hover:border-emerald-700 text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition">
            <Command className="w-3.5 h-3.5" />
            <span className="flex-1 text-right">پنل دستورات</span>
            <kbd className="text-[10px] bg-[var(--background-muted)] rounded px-1.5 py-0.5">Ctrl K</kbd>
          </button>
        )}
          </>
        )}
      </div>

      <div className={`flex-1 overflow-y-auto overflow-x-hidden ${isCollapsed ? "p-2 space-y-2" : "p-2"}`}>
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-1.5 pb-2 border-b border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => onOpenStudio?.()}
              data-testid="sidebar-open-studio-workspace"
              aria-label="میز کار تحریریه"
              title="میز کار تحریریه (ویرایشگر متمرکز ۸ پلتفرم)"
              className={`size-10 grid place-items-center rounded-[var(--radius-md)] transition-colors cursor-pointer ${
                activeWorkspaceTab === "editorial"
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-xs)]"
                  : "bg-[var(--card)] border border-[var(--border-subtle)] text-[var(--foreground)] hover:bg-[var(--background-muted)]"
              }`}
            >
              <Columns3 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => (onOpenVisualFlow ? onOpenVisualFlow() : onOpenStudio?.())}
              data-testid="sidebar-open-visual-flow"
              aria-label="بوم بصری اتوماسیون"
              title="بوم بصری اتوماسیون"
              className={`size-10 grid place-items-center rounded-[var(--radius-md)] transition-colors cursor-pointer ${
                activeWorkspaceTab === "visual_flow"
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] border border-[var(--brand-400)]"
                  : "bg-[var(--card)] border border-[var(--border-subtle)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-muted)]"
              }`}
            >
              <Workflow className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="mb-3 p-2 rounded-[var(--radius-lg)] bg-[var(--card)] border border-[var(--border-subtle)] space-y-1.5">
            <div className="text-[11px] font-semibold text-[var(--foreground-muted)] px-1 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[var(--brand-600)]" /> استودیوی تحریریه و اتوماسیون
            </div>
            <button
              type="button"
              onClick={() => onOpenStudio?.()}
              data-testid="sidebar-open-studio-workspace"
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--radius-md)] text-right transition-colors cursor-pointer ${
                activeWorkspaceTab === "editorial"
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] ring-2 ring-[var(--brand-500)]/30"
                  : "bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--primary-foreground)]"
              }`}
            >
              <Columns3 className="w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold leading-tight">میز کار تحریریه</div>
                <div className="text-[10px] opacity-80 truncate">ویرایشگر متمرکز ۸ پلتفرم + موبایل</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => (onOpenVisualFlow ? onOpenVisualFlow() : onOpenStudio?.())}
              data-testid="sidebar-open-visual-flow"
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--radius-md)] border text-right transition-colors cursor-pointer ${
                activeWorkspaceTab === "visual_flow"
                  ? "bg-[var(--brand-200)]/70 border-[var(--brand-500)] text-[var(--accent-foreground)]"
                  : "bg-[var(--accent)] hover:bg-[var(--brand-200)] text-[var(--accent-foreground)] border-[var(--brand-300)]/60"
              }`}
            >
              <Workflow className="w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold leading-tight">بوم بصری اتوماسیون</div>
                <div className="text-[10px] opacity-80 truncate">طراحی چرخه با نمادها و آیکون‌ها</div>
              </div>
            </button>
          </div>
        )}

        <nav className={isCollapsed ? "flex flex-col items-center gap-1" : "mb-4 space-y-3"}>
          {navGroups.map((group, gIdx) => {
            const GroupIcon = group.icon;
            const collapsed = collapsedGroups.has(group.id);
            const groupBadge = group.items.reduce((s, it) => s + (Number((it as any).badge) || 0), 0);

            if (isCollapsed) {
              return (
                <div
                  key={group.id}
                  className={`w-full flex flex-col items-center gap-1 ${
                    gIdx > 0 ? "pt-2 mt-1 border-t border-[var(--border-subtle)]" : ""
                  }`}
                >
                  {group.items.map(item => {
                    const Icon = item.icon;
                    const active =
                      (item.id === "studio" && activeWorkspaceTab === "editorial") ||
                      (item.id === "visual-flow" && activeWorkspaceTab === "visual_flow") ||
                      (item.id === "graph" && activeWorkspaceTab === "graph") ||
                      ((!activeWorkspaceTab || activeWorkspaceTab === "reader") && activeView === item.id);
                    const badge = (item as any).badge;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        title={item.count !== null && item.count !== undefined ? `${item.label} (${item.count})` : item.label}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          if ((item as any).action) { (item as any).action(); return; }
                          setActiveView(item.id); setSelectedFeed(null); setSelectedCategory(null);
                        }}
                        className={`relative size-10 grid place-items-center rounded-[var(--radius-md)] transition-colors cursor-pointer ${
                          active
                            ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                            : "text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-muted)]"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {badge ? (
                          <span className="absolute top-1.5 left-1.5 size-2 rounded-full bg-rose-500" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            }

            return (
              <div key={group.id}>
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition"
                >
                  {collapsed ? <ChevronLeft className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  <GroupIcon className="w-3.5 h-3.5" />
                  <span className="flex-1 text-right text-xs font-semibold tracking-wide">{group.label}</span>
                  {collapsed && groupBadge > 0 && (
                    <span className="text-[11px] font-semibold bg-rose-500 text-white px-1.5 min-w-[18px] text-center py-0.5 rounded-full">
                      {groupBadge.toLocaleString("fa-IR")}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">{group.items.length}</span>
                </button>
                {!collapsed && (
                  <div className="space-y-0.5 mt-1">
                    {group.items.map(item => {
                      const Icon = item.icon;
                      const active =
                        (item.id === "studio" && activeWorkspaceTab === "editorial") ||
                        (item.id === "visual-flow" && activeWorkspaceTab === "visual_flow") ||
                        (item.id === "graph" && activeWorkspaceTab === "graph") ||
                        ((!activeWorkspaceTab || activeWorkspaceTab === "reader") && activeView === item.id);
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            if ((item as any).action) { (item as any).action(); return; }
                            setActiveView(item.id); setSelectedFeed(null); setSelectedCategory(null);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-right transition ${active ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="flex-1 text-sm">{item.label}</span>
                          {item.count !== null && item.count !== undefined && (
                            <span className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded-full">{item.count}</span>
                          )}
                          {(item as any).badge ? (
                            <span className="text-[11px] font-semibold bg-rose-500 text-white px-1.5 min-w-[18px] text-center py-0.5 rounded-full">
                              {(item as any).badge.toLocaleString("fa-IR")}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {!isCollapsed && pinnedTopics.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-1 px-3 py-1.5 text-slate-500 text-sm">
              <Pin className="w-3 h-3" />
              <span className="flex-1 text-right">موضوعات سنجاق‌شده</span>
              {pinnedTopics.some(p => p.active) && onClearTopics && (
                <button onClick={onClearTopics} title="پاک کردن همه" className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded">
                  <X className="w-3 h-3" />
                </button>
              )}
              {onAddTopic && (
                <button onClick={onAddTopic} title="موضوع سفارشی" className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded">
                  <Plus className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="space-y-0.5 mt-1">
              {pinnedTopics.map(({ topic, count, active }) => {
                const cls = topicColorClasses(topic.color);
                return (
                  <button
                    key={topic.id}
                    onClick={() => onToggleTopic?.(topic.id)}
                    disabled={count === 0 && !active}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-right text-sm transition ${
                      active
                        ? `${cls.chip} ring-1 ${cls.ring}`
                        : count === 0
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span>{topic.icon}</span>
                    <span className="flex-1 truncate">{topic.name}</span>
                    <span className={`text-xs tabular-nums px-1.5 py-0.5 rounded-full ${active ? "bg-white/40 dark:bg-black/30" : "bg-slate-200 dark:bg-slate-700"}`}>
                      {count.toLocaleString("fa-IR")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isCollapsed ? (
          <div className="pt-2 mt-2 border-t border-[var(--border-subtle)] flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={handleToggleCollapse}
              title={`همه خوراک‌ها (${feeds.length})`}
              aria-label="نمایش دسته‌بندی‌ها و خوراک‌ها"
              className="size-10 grid place-items-center rounded-[var(--radius-md)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-muted)] transition-colors cursor-pointer"
            >
              <Rss className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onRefresh}
              title="بروزرسانی خوراک‌ها"
              aria-label="بروزرسانی خوراک‌ها"
              className="size-10 grid place-items-center rounded-[var(--radius-md)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-muted)] transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onAddFeed}
              title="افزودن خوراک"
              aria-label="افزودن خوراک"
              className="size-10 grid place-items-center rounded-[var(--radius-md)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-muted)] transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <div className="flex items-center gap-1">
                <button onClick={() => setCatsOpen(!catsOpen)} className="flex-1 flex items-center gap-2 px-3 py-1.5 text-slate-500 text-sm hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg">
                  {catsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
                  <span className="flex-1 text-right">دسته‌بندی‌ها</span>
                  <span className="text-xs text-slate-400">{grouped.length}</span>
                </button>
              </div>
              {catsOpen && (
                <div className="space-y-0.5 mt-1">
                  {grouped.map(([cat, list]) => {
                    const unread = list.reduce((s, f) => s + f.count, 0);
                    const expanded = expandedCats.has(cat);
                    const catActive = selectedCategory === cat && activeView === 'category';
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-1">
                          <button onClick={() => toggleCat(cat)} className="p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded">
                            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
                          </button>
                          <button
                            onClick={() => { setActiveView('category'); setSelectedCategory(cat); setSelectedFeed(null); }}
                            className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-right text-sm ${catActive ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                          >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: catColor(cat) }}></span>
                            <span className="flex-1 truncate">{cat}</span>
                            <span className="text-xs text-slate-500">{list.length}</span>
                            {unread > 0 && <span className="text-xs bg-emerald-500 text-white px-1.5 rounded-full">{unread}</span>}
                          </button>
                        </div>
                        {expanded && (
                          <div className="mr-6 space-y-0.5 mt-0.5">
                            {list.map(feed => {
                              const st = feedStatus[feed.id];
                              const broken = st && st.ok === false;
                              return (
                                <div key={feed.id} className="group flex items-center gap-1">
                                  <button
                                    onClick={() => { setSelectedFeed(feed.id); setActiveView('feed'); setSelectedCategory(null); }}
                                    className={`flex-1 flex items-center gap-2 px-2 py-1 rounded text-right text-xs ${selectedFeed === feed.id ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                                  >
                                    <span>{feed.icon}</span>
                                    <span className={`flex-1 truncate ${broken ? 'text-red-500' : ''}`}>{feed.name}</span>
                                    {broken && <AlertTriangle className="w-3 h-3 text-red-500" title={st.error || 'خطا در دریافت'} />}
                                    {feed.count > 0 && <span className="text-slate-500">{feed.count}</span>}
                                  </button>
                                  {onRemoveFeed && (
                                    <button onClick={() => onRemoveFeed(feed.id)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mb-4">
              <div className="flex items-center gap-1">
                <button onClick={() => setFeedsOpen(!feedsOpen)} className="flex-1 flex items-center gap-2 px-3 py-1.5 text-slate-500 text-sm hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg">
                  {feedsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
                  <Rss className="w-3 h-3" />
                  <span className="flex-1 text-right">همه خوراک‌ها</span>
                  <span className="text-xs text-slate-400">{feeds.length}</span>
                </button>
                <button onClick={onRefresh} className="p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg" title="بروزرسانی">
                  <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                </button>
                {onPruneFeeds && (
                  <button onClick={onPruneFeeds} disabled={pruning}
                    className="p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50"
                    title="بررسی سلامت و حذف خوراک‌های خراب">
                    <Wand2 className={`w-3 h-3 ${pruning ? 'animate-pulse text-emerald-500' : ''}`} />
                  </button>
                )}
                <button onClick={onAddFeed} className="p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg" title="افزودن خوراک">
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              {feedsOpen && (
                <div className="space-y-0.5 mt-1 max-h-64 overflow-y-auto">
                  {feeds.length === 0 && (
                    <div className="px-3 py-2 text-xs text-slate-500">هنوز خوراکی اضافه نشده</div>
                  )}
                  {feeds.slice(0, 100).map(feed => {
                    const st = feedStatus[feed.id];
                    const broken = st && st.ok === false;
                    return (
                      <div key={feed.id} className="group flex items-center gap-1">
                        <button
                          onClick={() => { setSelectedFeed(feed.id); setActiveView('feed'); setSelectedCategory(null); }}
                          className={`flex-1 flex items-center gap-3 px-3 py-1.5 rounded-lg text-right text-sm ${selectedFeed === feed.id ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                        >
                          <span>{feed.icon}</span>
                          <span className={`flex-1 truncate ${broken ? 'text-red-500' : ''}`}>{feed.name}{feed.category ? ` — ${feed.category}` : ''}</span>
                          {broken && <AlertTriangle className="w-3.5 h-3.5 text-red-500" title={st.error || 'خطا'} />}
                          {feed.count > 0 && <span className="text-xs text-slate-500">{feed.count}</span>}
                        </button>
                        {onRemoveFeed && (
                          <button onClick={() => onRemoveFeed(feed.id)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {feeds.length > 100 && <div className="px-3 py-1 text-xs text-slate-500">و {feeds.length - 100} مورد دیگر...</div>}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className={`${isCollapsed ? "p-2 flex flex-col items-center gap-1" : "p-3"} border-t border-[var(--border-subtle)]`}>
        {isCollapsed ? (
          <>
            <button
              type="button"
              onClick={onOpenOpml}
              title="ورود و خروج OPML"
              aria-label="OPML"
              className="size-9 grid place-items-center rounded-[var(--radius-md)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-muted)] transition-colors cursor-pointer"
            >
              <FileUp className="w-4 h-4" />
            </button>
            {onOpenRules && (
              <button
                type="button"
                onClick={onOpenRules}
                title="قوانین برچسب خودکار"
                aria-label="قوانین"
                className="size-9 grid place-items-center rounded-[var(--radius-md)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-muted)] transition-colors cursor-pointer"
              >
                <Tag className="w-4 h-4" />
              </button>
            )}
            {onOpenHelp && (
              <button
                type="button"
                onClick={onOpenHelp}
                title="میان‌برها (?)"
                aria-label="میان‌برها"
                className="size-9 grid place-items-center rounded-[var(--radius-md)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--background-muted)] transition-colors cursor-pointer"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            )}
          </>
        ) : (
          <>
            {lastRefresh && (
              <div className="text-xs text-slate-500 text-center mb-2">
                آخرین بروزرسانی: {lastRefresh.toLocaleTimeString('fa-IR')}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={onOpenOpml} className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700">
                <FileUp className="w-3 h-3" /> OPML
              </button>
              {onOpenRules && (
                <button onClick={onOpenRules} className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700" title="قوانین برچسب خودکار">
                  <Tag className="w-3 h-3" /> قوانین
                </button>
              )}
              {onOpenHelp && (
                <button onClick={onOpenHelp} className="px-3 text-xs py-2 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700" title="میان‌برها (?)">
                  ؟
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
