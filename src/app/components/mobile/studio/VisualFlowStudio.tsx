import React, { useEffect, useMemo, useState } from "react";
import {
  Play,
  Plus,
  Trash2,
  CheckCircle2,
  Sparkles,
  Sliders,
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Send,
  Save,
  Layers,
  Eye,
  Pin,
  BellOff,
  CornerUpRight,
  ExternalLink,
  Zap,
  RotateCcw,
  ChevronDown,
  PanelRight,
  PanelBottom,
  Check,
  Workflow,
} from "lucide-react";
import type { Article } from "../../../data";
import type { StudioPlatform } from "../../../api";
import { PLATFORM_META, ALL_PLATFORMS } from "./studio";
import {
  FLOW_BLOCK_CATALOG,
  CATEGORY_META,
  PRESET_FLOW_PIPELINES,
  createNodeFromCatalog,
  getNodeVisualBadges,
  simulateVisualFlow,
  type FlowBlockCategory,
  type FlowBlockType,
  type FlowNode,
  type FlowNodeParams,
  type VisualFlowPipeline,
  type FlowSimulationResult,
} from "./visualFlowEngine";
import { renderNewsCard } from "./newsCard";
import { useToast } from "../primitives/Toast";
import { toFa } from "../utils/fa";
import { CollapsibleSection } from "./CollapsibleSection";
import type { FlowPanelTab } from "./studioLayoutState";

interface Props {
  articles: Article[];
  onApplySimulationToWorkspace?: (sim: FlowSimulationResult) => void;
}

const STORAGE_KEY = "kian.studio.visualFlows.v1";

export function VisualFlowStudio({ articles, onApplySimulationToWorkspace }: Props) {
  const toast = useToast();

  // Load saved visual pipelines or fall back to preset recipes
  const [pipelines, setPipelines] = useState<VisualFlowPipeline[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return PRESET_FLOW_PIPELINES;
  });

  const [activePipelineId, setActivePipelineId] = useState<string>(
    () => pipelines[0]?.id || PRESET_FLOW_PIPELINES[0].id,
  );

  const activePipeline = useMemo(
    () => pipelines.find(p => p.id === activePipelineId) || pipelines[0],
    [pipelines, activePipelineId],
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    () => activePipeline?.nodes[0]?.id || "",
  );
  const [paletteCategory, setPaletteCategory] = useState<FlowBlockCategory | "all">("all");
  const [insertAtIdx, setInsertAtIdx] = useState<number | null>(null);
  const [kwInput, setKwInput] = useState("");
  const [previewCardUrl, setPreviewCardUrl] = useState<string>("");
  const [simRunning, setSimRunning] = useState(false);

  // Progressive disclosure controls (minimal canvas by default; open panels on demand)
  const [recipeMenuOpen, setRecipeMenuOpen] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<FlowPanelTab>("inspector");
  const [destPlatformsOpen, setDestPlatformsOpen] = useState(false);

  useEffect(() => {
    if (!recipeMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setRecipeMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recipeMenuOpen]);

  // Sync selectedNodeId when switching pipelines
  useEffect(() => {
    if (activePipeline && !activePipeline.nodes.some(n => n.id === selectedNodeId)) {
      setSelectedNodeId(activePipeline.nodes[0]?.id || "");
    }
  }, [activePipeline, selectedNodeId]);

  // Persist pipelines to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pipelines));
    } catch {
      // ignore
    }
  }, [pipelines]);

  // Live simulation result computed dynamically whenever nodes or articles change
  const simResult = useMemo<FlowSimulationResult>(
    () => simulateVisualFlow(activePipeline, articles),
    [activePipeline, articles],
  );

  // Render live graphic card preview from simulation cardConfig
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const url = await renderNewsCard({
          title: simResult.generatedHeadline,
          brandName: "کیان مدیا (Flow)",
          tagline: simResult.cardConfig.isBreakingRed
            ? "🚨 رادار اتوماسیون خبر فوری"
            : "تحریریه هوشمند خبری",
          source: simResult.matchedArticles[0]?.source || "اتوماسیون تحریریه",
          accent: simResult.cardConfig.accent,
          theme: simResult.cardConfig.theme,
          ratio: simResult.cardConfig.ratio,
        });
        if (!cancelled) setPreviewCardUrl(url);
      } catch {
        // ignore canvas errors in headless environments
      }
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [simResult]);

  const selectedNode = useMemo(
    () => activePipeline.nodes.find(n => n.id === selectedNodeId) || activePipeline.nodes[0],
    [activePipeline, selectedNodeId],
  );

  const updateActivePipeline = (updater: (p: VisualFlowPipeline) => VisualFlowPipeline) => {
    setPipelines(prev =>
      prev.map(p => (p.id === activePipeline.id ? updater(p) : p)),
    );
  };

  const updateNodeParams = (nodeId: string, patch: Partial<FlowNodeParams>) => {
    updateActivePipeline(p => ({
      ...p,
      nodes: p.nodes.map(n =>
        n.id === nodeId ? { ...n, params: { ...n.params, ...patch } } : n,
      ),
    }));
  };

  const handleAddBlockToCanvas = (type: FlowBlockType) => {
    const newNode = createNodeFromCatalog(type);
    updateActivePipeline(p => {
      const nextNodes = [...p.nodes];
      if (insertAtIdx !== null && insertAtIdx >= 0 && insertAtIdx <= nextNodes.length) {
        nextNodes.splice(insertAtIdx, 0, newNode);
      } else {
        // Smart ordering: if adding a source put at start, if destination put at end, otherwise before destination
        if (newNode.category === "source") {
          nextNodes.unshift(newNode);
        } else if (newNode.category === "destination") {
          nextNodes.push(newNode);
        } else {
          const firstDestIdx = nextNodes.findIndex(n => n.category === "destination");
          if (firstDestIdx >= 0) nextNodes.splice(firstDestIdx, 0, newNode);
          else nextNodes.push(newNode);
        }
      }
      return { ...p, nodes: nextNodes };
    });
    setSelectedNodeId(newNode.id);
    setInsertAtIdx(null);
    toast({
      kind: "success",
      message: `نماد «${newNode.title}» به زنجیرهٔ بوم متصل شد`,
    });
  };

  const handleRemoveNode = (nodeId: string) => {
    if (activePipeline.nodes.length <= 1) {
      toast({ kind: "warn", message: "حداقل یک نماد باید در بوم باقی بماند" });
      return;
    }
    updateActivePipeline(p => ({
      ...p,
      nodes: p.nodes.filter(n => n.id !== nodeId),
    }));
    toast({ kind: "success", message: "نماد از زنجیره حذف شد" });
  };

  const handleMoveNode = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= activePipeline.nodes.length) return;
    updateActivePipeline(p => {
      const next = [...p.nodes];
      const tmp = next[idx];
      next[idx] = next[target];
      next[target] = tmp;
      return { ...p, nodes: next };
    });
  };

  const handleCreateBlankFlow = () => {
    const newPipe: VisualFlowPipeline = {
      id: `flow-custom-${Date.now()}`,
      name: `چرخهٔ سفارشی تحریریه (${toFa(pipelines.length + 1)})`,
      description: "چرخهٔ اختصاصی ساخته‌شده با کنار هم چیدن نمادها روی بوم بصری",
      enabled: true,
      nodes: [
        createNodeFromCatalog("rss_feed"),
        createNodeFromCatalog("ai_composer"),
        createNodeFromCatalog("telegram_dest"),
      ],
    };
    setPipelines(prev => [newPipe, ...prev]);
    setActivePipelineId(newPipe.id);
    setSelectedNodeId(newPipe.nodes[0].id);
    toast({ kind: "success", message: "بوم جدید ایجاد شد — نمادها را از ستون راست اضافه کنید" });
  };

  const handleRunLiveSimulation = () => {
    setSimRunning(true);
    setTimeout(() => {
      setSimRunning(false);
      updateActivePipeline(p => ({
        ...p,
        lastRunAt: Date.now(),
        runCount: (p.runCount || 0) + 1,
      }));
      toast({
        kind: "success",
        message: `شبیه‌سازی زنجیره روی ${toFa(articles.length || 24)} خبر زنده با موفقیت اجرا شد`,
      });
    }, 350);
  };

  const filteredCatalog = useMemo(
    () =>
      FLOW_BLOCK_CATALOG.filter(
        b => paletteCategory === "all" || b.category === paletteCategory,
      ),
    [paletteCategory],
  );

  const catDotClass = (cat: FlowBlockCategory) => {
    if (cat === "source") return "bg-sky-500";
    if (cat === "filter") return "bg-amber-500";
    if (cat === "transform") return "bg-violet-500";
    return "bg-[var(--brand-500)]";
  };

  return (
    <div
      dir="rtl"
      data-testid="visual-flow-studio"
      className="h-full flex flex-col bg-[var(--background)] text-[var(--foreground)] overflow-hidden"
    >
      {/* ═══════════════════════════════════════════════════════════════════
          MINIMAL TOP COMMAND BAR: PIPELINE DROPDOWN & PANEL TOGGLES
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--background)] flex items-center justify-between gap-3 flex-wrap shrink-0">
        {/* Left/Start: Pipeline Dropdown Switcher + Active Status */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative">
            <button
              type="button"
              aria-expanded={recipeMenuOpen}
              aria-haspopup="menu"
              data-testid="flow-pipeline-menu-btn"
              onClick={() => setRecipeMenuOpen(v => !v)}
              className="h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--background-muted)] text-xs font-semibold inline-flex items-center gap-2 transition cursor-pointer max-w-[260px]"
            >
              <span
                className={`size-2 rounded-full shrink-0 ${
                  activePipeline.enabled ? "bg-[var(--brand-500)]" : "bg-[var(--foreground-subtle)]"
                }`}
              />
              <span className="truncate">{activePipeline.name}</span>
              <ChevronDown className={`size-3.5 text-[var(--foreground-subtle)] shrink-0 transition-transform ${recipeMenuOpen ? "rotate-180" : ""}`} />
            </button>

            {recipeMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setRecipeMenuOpen(false)}
                />
                <div
                  role="menu"
                  aria-label="الگوهای آماده و چرخه‌های ذخیره شده"
                  className="absolute right-0 top-full mt-1.5 z-30 w-80 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--popover)] shadow-[var(--shadow-md)] p-1.5 space-y-1"
                >
                  <div className="px-2 py-1 text-[10.5px] font-semibold text-[var(--foreground-subtle)] flex items-center justify-between">
                    <span>الگوها و چرخه‌ها ({toFa(pipelines.length)})</span>
                    <button
                      type="button"
                      onClick={() => {
                        handleCreateBlankFlow();
                        setRecipeMenuOpen(false);
                      }}
                      className="text-[var(--brand-600)] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="size-3" />
                      <span>چرخهٔ جدید</span>
                    </button>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-0.5">
                    {pipelines.map(pipe => {
                      const active = pipe.id === activePipeline.id;
                      return (
                        <button
                          key={pipe.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          onClick={() => {
                            setActivePipelineId(pipe.id);
                            setRecipeMenuOpen(false);
                          }}
                          className={`w-full px-2.5 py-2 rounded-[var(--radius-sm)] text-right text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                            active
                              ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold"
                              : "text-[var(--foreground)] hover:bg-[var(--background-muted)]"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`size-2 rounded-full shrink-0 ${
                                pipe.enabled ? "bg-[var(--brand-500)]" : "bg-[var(--foreground-subtle)]"
                              }`}
                            />
                            <span className="truncate">{pipe.name}</span>
                          </div>
                          <span className="text-[10px] text-[var(--foreground-subtle)] shrink-0 tabular-nums">
                            {toFa(pipe.nodes.length)} گام
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            aria-pressed={activePipeline.enabled}
            onClick={() =>
              updateActivePipeline(p => ({ ...p, enabled: !p.enabled }))
            }
            className={`h-8 px-2.5 rounded-[var(--radius-md)] border text-[11.5px] font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
              activePipeline.enabled
                ? "bg-[var(--accent)] border-[var(--brand-300)] text-[var(--accent-foreground)]"
                : "bg-[var(--background-subtle)] border-[var(--border-subtle)] text-[var(--foreground-muted)]"
            }`}
          >
            <CheckCircle2 className="size-3.5" />
            <span>{activePipeline.enabled ? "فعال" : "متوقف"}</span>
          </button>
        </div>

        {/* Right/End: Panel Toggles & Primary Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            aria-expanded={toolboxOpen}
            onClick={() => setToolboxOpen(v => !v)}
            className={`h-8 px-2.5 rounded-[var(--radius-md)] border text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
              toolboxOpen
                ? "bg-[var(--accent)] border-[var(--brand-300)] text-[var(--accent-foreground)]"
                : "bg-[var(--card)] border-[var(--border-subtle)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            }`}
          >
            <PanelRight className="size-3.5" />
            <span className="hidden sm:inline">جعبه ابزار</span>
          </button>

          <button
            type="button"
            aria-expanded={inspectorOpen}
            onClick={() => setInspectorOpen(v => !v)}
            className={`h-8 px-2.5 rounded-[var(--radius-md)] border text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
              inspectorOpen
                ? "bg-[var(--accent)] border-[var(--brand-300)] text-[var(--accent-foreground)]"
                : "bg-[var(--card)] border-[var(--border-subtle)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            }`}
          >
            <PanelBottom className="size-3.5" />
            <span className="hidden sm:inline">تنظیمات و خروجی</span>
          </button>

          <button
            type="button"
            data-testid="run-visual-flow-sim-btn"
            onClick={() => {
              handleRunLiveSimulation();
              setInspectorOpen(true);
              setInspectorTab("preview");
            }}
            className="h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--card)] hover:bg-[var(--accent)] text-[var(--foreground)] text-xs font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer"
          >
            <Play className="size-3.5 text-[var(--brand-600)]" />
            <span>{simRunning ? "در حال اجرا..." : "شبیه‌سازی زنده"}</span>
          </button>

          {onApplySimulationToWorkspace && (
            <button
              type="button"
              data-testid="apply-flow-to-editor-btn"
              onClick={() => onApplySimulationToWorkspace(simResult)}
              className="h-8 px-3 rounded-[var(--radius-md)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--primary-foreground)] text-xs font-semibold inline-flex items-center gap-1.5 shadow-[var(--shadow-xs)] transition whitespace-nowrap cursor-pointer"
            >
              <Send className="size-3.5 -scale-x-100" />
              <span>ارسال به میز کار</span>
            </button>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          MAIN WORKSPACE: COLLAPSIBLE TOOLBOX + SPACIOUS CANVAS & DRAWER
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* ─────────────────────────────────────────────────────────────────
            COLLAPSIBLE RIGHT TOOLBOX: VISUAL ICON PALETTE
        ───────────────────────────────────────────────────────────────── */}
        {toolboxOpen && (
          <aside
            aria-label="جعبه ابزار نمادهای اتوماسیون"
            className="w-full lg:w-[272px] max-h-[220px] lg:max-h-none shrink-0 flex flex-col border-b lg:border-b-0 lg:border-l border-[var(--border-subtle)] bg-[var(--background-subtle)] overflow-hidden"
          >
            <div className="p-2.5 border-b border-[var(--border-subtle)] bg-[var(--background)] space-y-2 shrink-0">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--foreground)]">
                  افزودن نماد به بوم
                </span>
                {insertAtIdx !== null ? (
                  <button
                    type="button"
                    onClick={() => setInsertAtIdx(null)}
                    className="text-[10.5px] text-[var(--danger-600)] hover:underline cursor-pointer"
                  >
                    لغو درج در گام {toFa(insertAtIdx + 1)}
                  </button>
                ) : (
                  <span className="text-[10.5px] text-[var(--foreground-subtle)] tabular-nums">
                    {toFa(filteredCatalog.length)} بلوک
                  </span>
                )}
              </div>

              {/* Clean Category Filter Strip */}
              <div
                role="tablist"
                aria-label="فیلتر دسته نمادها"
                className="flex items-center gap-1 overflow-x-auto scrollbar-none text-[11px]"
              >
                {[
                  { id: "all" as const, label: "همه" },
                  { id: "source" as const, label: "مبدأ" },
                  { id: "filter" as const, label: "صافی" },
                  { id: "transform" as const, label: "پردازش" },
                  { id: "destination" as const, label: "مقصد" },
                ].map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={paletteCategory === tab.id}
                    onClick={() => setPaletteCategory(tab.id)}
                    className={`px-2 py-1 rounded-[var(--radius-sm)] font-medium transition whitespace-nowrap shrink-0 cursor-pointer ${
                      paletteCategory === tab.id
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "bg-[var(--background-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Clean Block Cards */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              {filteredCatalog.map(item => (
                <button
                  key={item.type}
                  type="button"
                  data-testid={`palette-block-${item.type}`}
                  onClick={() => handleAddBlockToCanvas(item.type)}
                  className="w-full p-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--card)] hover:border-[var(--brand-400)] hover:bg-[var(--brand-50)]/40 dark:hover:bg-[var(--brand-900)]/20 text-right transition flex items-center gap-2.5 group cursor-pointer"
                >
                  <span className="size-8 rounded-[var(--radius-sm)] bg-[var(--background-muted)] grid place-items-center text-base shrink-0">
                    {item.iconEmoji}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`size-1.5 rounded-full shrink-0 ${catDotClass(item.category)}`} />
                      <span className="text-xs font-medium text-[var(--foreground)] truncate">
                        {item.title}
                      </span>
                    </div>
                    <p className="text-[10.5px] text-[var(--foreground-subtle)] truncate mt-0.5">
                      {item.subtitle}
                    </p>
                  </div>
                  <Plus className="size-3.5 text-[var(--foreground-subtle)] group-hover:text-[var(--brand-600)] shrink-0" />
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* ─────────────────────────────────────────────────────────────────
            CENTER CANVAS + COLLAPSIBLE TABBED INSPECTOR/PREVIEW DRAWER
        ───────────────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 h-full overflow-hidden">
          {/* Editable Pipeline Title Strip */}
          <div className="px-4 py-2 bg-[var(--background)] border-b border-[var(--border-subtle)] flex items-center justify-between gap-3 shrink-0">
            <div className="flex-1 min-w-0">
              <input
                value={activePipeline.name}
                aria-label="نام چرخه اتوماسیون"
                onChange={e =>
                  updateActivePipeline(p => ({ ...p, name: e.target.value }))
                }
                className="w-full text-[13px] font-semibold bg-transparent outline-none focus:underline"
              />
              <p className="text-[11px] text-[var(--foreground-subtle)] truncate">
                {activePipeline.description}
              </p>
            </div>
            <span className="text-[11px] text-[var(--foreground-subtle)] tabular-nums shrink-0">
              {toFa(activePipeline.nodes.length)} گام در زنجیره
            </span>
          </div>

          {/* Spacious Dotted Flow Canvas */}
          <div
            data-testid="visual-flow-canvas"
            className="flex-1 min-h-[220px] p-6 bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-[var(--background-subtle)] [background-size:20px_20px] overflow-auto flex items-center"
          >
            <div className="flex items-center gap-2 min-w-max mx-auto py-2">
              {activePipeline.nodes.map((node, idx) => {
                const isSelected = node.id === selectedNode?.id;
                const catMeta = CATEGORY_META[node.category];
                const badges = getNodeVisualBadges(node).slice(0, 2);
                const trace = simResult.stepTraces.find(t => t.nodeId === node.id);

                return (
                  <React.Fragment key={node.id}>
                    {/* Accessible Visual Node Card */}
                    <div
                      data-testid={`canvas-node-${node.type}`}
                      className={`w-[224px] rounded-[var(--radius-xl)] bg-[var(--card)] border transition shadow-[var(--shadow-xs)] flex flex-col ${
                        isSelected
                          ? "border-[var(--brand-500)] ring-2 ring-[var(--brand-500)]/25 shadow-[var(--shadow-sm)]"
                          : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      {/* Top Header: Step Label + Reorder/Delete */}
                      <div className="px-3 pt-2.5 pb-1.5 flex items-center justify-between gap-1 border-b border-[var(--border-subtle)]/60">
                        <span className="text-[10.5px] font-medium text-[var(--foreground-subtle)] flex items-center gap-1.5">
                          <span className={`size-2 rounded-full ${catDotClass(node.category)}`} />
                          <span>گام {toFa(idx + 1)} · {catMeta.label.split(".")[1]?.trim() || catMeta.label}</span>
                        </span>

                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleMoveNode(idx, -1)}
                            disabled={idx === 0}
                            aria-label={`جابه‌جایی ${node.title} به راست`}
                            title="جابه‌جایی به راست"
                            className="p-1 rounded hover:bg-[var(--background-muted)] disabled:opacity-25 cursor-pointer"
                          >
                            <ChevronRight className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveNode(idx, 1)}
                            disabled={idx === activePipeline.nodes.length - 1}
                            aria-label={`جابه‌جایی ${node.title} به چپ`}
                            title="جابه‌جایی به چپ"
                            className="p-1 rounded hover:bg-[var(--background-muted)] disabled:opacity-25 cursor-pointer"
                          >
                            <ChevronLeft className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveNode(node.id)}
                            aria-label={`حذف نماد ${node.title}`}
                            title="حذف نماد"
                            className="p-1 rounded text-[var(--danger-500)] hover:bg-[var(--danger-50)] cursor-pointer"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Accessible Node Selector Button Body */}
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={`انتخاب و تنظیم نماد ${node.title}`}
                        onClick={() => {
                          setSelectedNodeId(node.id);
                          setInspectorOpen(true);
                          setInspectorTab("inspector");
                        }}
                        className="p-3 text-right flex flex-col gap-2 rounded-b-[var(--radius-xl)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="size-9 rounded-[var(--radius-md)] bg-[var(--background-muted)] grid place-items-center text-lg shrink-0">
                            {node.iconEmoji}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-[var(--foreground)] leading-snug truncate">
                              {node.title}
                            </div>
                            <div className="text-[10.5px] text-[var(--foreground-subtle)] truncate mt-0.5">
                              {node.subtitle}
                            </div>
                          </div>
                        </div>

                        {badges.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {badges.map((b, bIdx) => (
                              <span
                                key={bIdx}
                                className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--background-muted)] text-[10px] font-medium text-[var(--foreground-muted)] truncate max-w-full"
                              >
                                {b}
                              </span>
                            ))}
                          </div>
                        )}

                        {trace && (
                          <div className="px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-foreground)] text-[10px] font-medium flex items-center justify-between">
                            <span className="truncate">{trace.summaryText}</span>
                            <span className="font-mono tabular-nums shrink-0 mr-1">
                              {toFa(trace.outputCount)}
                            </span>
                          </div>
                        )}
                      </button>
                    </div>

                    {/* Flow Connector + Inline '+' Insert */}
                    {idx < activePipeline.nodes.length - 1 && (
                      <div className="flex items-center px-0.5 shrink-0">
                        <div className="w-4 h-px bg-[var(--border-strong)]" />
                        <button
                          type="button"
                          onClick={() => {
                            setInsertAtIdx(idx + 1);
                            setToolboxOpen(true);
                            toast({
                              kind: "info",
                              message: `از جعبه ابزار یک نماد انتخاب کنید تا بین گام ${toFa(idx + 1)} و ${toFa(idx + 2)} قرار گیرد`,
                            });
                          }}
                          aria-label={`افزودن نماد بین گام ${toFa(idx + 1)} و ${toFa(idx + 2)}`}
                          title="افزودن نماد در این نقطه"
                          className={`size-6 rounded-full border grid place-items-center text-xs transition cursor-pointer ${
                            insertAtIdx === idx + 1
                              ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)] scale-110"
                              : "bg-[var(--card)] border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--brand-500)] hover:text-[var(--brand-600)]"
                          }`}
                        >
                          <Plus className="size-3" />
                        </button>
                        <div className="w-3 h-px bg-[var(--border-strong)]" />
                        <ArrowLeft className="size-3.5 text-[var(--foreground-subtle)] -mr-1" />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              COLLAPSIBLE BOTTOM DRAWER: TABBED INSPECTOR | LIVE PREVIEW
          ═══════════════════════════════════════════════════════════════ */}
          <div className="border-t border-[var(--border-subtle)] bg-[var(--background)] shrink-0">
            {/* Drawer Header Bar */}
            <div className="px-4 py-2 flex items-center justify-between gap-3 bg-[var(--background-subtle)] border-b border-[var(--border-subtle)]">
              <div
                role="tablist"
                aria-label="بخش تنظیمات و خروجی بوم"
                className="inline-flex items-center gap-1 p-0.5 rounded-[var(--radius-md)] bg-[var(--background-muted)] border border-[var(--border-subtle)] text-xs"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === "inspector"}
                  data-testid="flow-tab-inspector"
                  onClick={() => {
                    setInspectorTab("inspector");
                    setInspectorOpen(true);
                  }}
                  className={`h-7 px-3 rounded-[var(--radius-sm)] font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
                    inspectorTab === "inspector"
                      ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                      : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <Sliders className="size-3.5 text-[var(--brand-600)]" />
                  <span>تنظیمات نماد{selectedNode ? `: ${selectedNode.title}` : ""}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === "preview"}
                  data-testid="flow-tab-preview"
                  onClick={() => {
                    setInspectorTab("preview");
                    setInspectorOpen(true);
                  }}
                  className={`h-7 px-3 rounded-[var(--radius-sm)] font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
                    inspectorTab === "preview"
                      ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                      : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <Eye className="size-3.5 text-[var(--brand-600)]" />
                  <span>پیش‌نمایش زنده خروجی</span>
                </button>
              </div>

              <button
                type="button"
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen(v => !v)}
                className="h-7 px-2.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--card)] hover:bg-[var(--background-muted)] text-[11px] text-[var(--foreground-muted)] inline-flex items-center gap-1 transition cursor-pointer"
              >
                <span>{inspectorOpen ? "جمع کردن" : "گسترش"}</span>
                <ChevronDown className={`size-3.5 transition-transform ${inspectorOpen ? "rotate-180" : ""}`} />
              </button>
            </div>

            {inspectorOpen && (
              <div className="max-h-[280px] overflow-y-auto p-4">
                {inspectorTab === "inspector" && selectedNode && (
                  <div className="max-w-3xl space-y-3 text-xs">
                    <div className="flex items-center gap-2.5 pb-2 border-b border-[var(--border-subtle)]">
                      <span className="size-8 rounded-[var(--radius-md)] bg-[var(--background-muted)] grid place-items-center text-lg">
                        {selectedNode.iconEmoji}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--foreground)]">
                          {selectedNode.title}
                        </div>
                        <div className="text-[11px] text-[var(--foreground-subtle)]">
                          {CATEGORY_META[selectedNode.category].question} — {selectedNode.subtitle}
                        </div>
                      </div>
                    </div>

                    {selectedNode.type === "breaking_cluster" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="font-medium text-[var(--foreground-muted)] block">
                            حداقل خبرگزاری هم‌زمان:
                          </label>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {[2, 3, 4, 5, 6].map(n => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => updateNodeParams(selectedNode.id, { minSources: n })}
                                className={`px-2.5 py-1 rounded-[var(--radius-md)] border font-medium transition cursor-pointer ${
                                  (selectedNode.params.minSources || 3) === n
                                    ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)]"
                                    : "bg-[var(--background-subtle)] border-[var(--border-subtle)] text-[var(--foreground-muted)]"
                                }`}
                              >
                                {toFa(n)} منبع
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="font-medium text-[var(--foreground-muted)] block">
                            بازهٔ زمانی هم‌زمانی:
                          </label>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {[10, 15, 20, 30, 45, 60].map(m => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => updateNodeParams(selectedNode.id, { withinMinutes: m })}
                                className={`px-2.5 py-1 rounded-[var(--radius-md)] border font-medium transition cursor-pointer ${
                                  (selectedNode.params.withinMinutes || 20) === m
                                    ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)]"
                                    : "bg-[var(--background-subtle)] border-[var(--border-subtle)] text-[var(--foreground-muted)]"
                                }`}
                              >
                                {toFa(m)} دقیقه
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {(selectedNode.type === "rss_feed" || selectedNode.type === "intl_feeds") && (
                      <div className="space-y-1.5">
                        <label className="font-medium text-[var(--foreground-muted)] block">
                          حوزه و دستهٔ خوراک‌های ورودی:
                        </label>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[
                            { id: "all", label: "همهٔ دسته‌ها" },
                            { id: "political", label: "سیاسی و دیپلماسی" },
                            { id: "economic", label: "اقتصادی و بازار" },
                            { id: "international", label: "بین‌الملل" },
                            { id: "tech", label: "فناوری و هوش مصنوعی" },
                          ].map(sc => (
                            <button
                              key={sc.id}
                              type="button"
                              onClick={() =>
                                updateNodeParams(selectedNode.id, { feedScope: sc.id as any })
                              }
                              className={`px-3 py-1.5 rounded-[var(--radius-md)] border font-medium transition cursor-pointer ${
                                (selectedNode.params.feedScope || "all") === sc.id
                                  ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)]"
                                  : "bg-[var(--background-subtle)] border-[var(--border-subtle)] text-[var(--foreground-muted)]"
                              }`}
                            >
                              {sc.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedNode.type === "schedule_timer" && (
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-1.5">
                          {[
                            { id: "daily", label: "بولتن روزانه در ساعت مشخص" },
                            { id: "interval", label: "اجرای دوره‌ای" },
                          ].map(md => (
                            <button
                              key={md.id}
                              type="button"
                              onClick={() =>
                                updateNodeParams(selectedNode.id, { scheduleMode: md.id as any })
                              }
                              className={`px-3 py-1.5 rounded-[var(--radius-md)] border font-medium transition cursor-pointer ${
                                (selectedNode.params.scheduleMode || "daily") === md.id
                                  ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)]"
                                  : "bg-[var(--background-subtle)] border-[var(--border-subtle)] text-[var(--foreground-muted)]"
                              }`}
                            >
                              {md.label}
                            </button>
                          ))}
                        </div>
                        {selectedNode.params.scheduleMode === "interval" ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {[15, 30, 60, 120].map(em => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => updateNodeParams(selectedNode.id, { everyMinutes: em })}
                                className={`px-3 py-1 rounded-[var(--radius-md)] border font-medium cursor-pointer ${
                                  (selectedNode.params.everyMinutes || 60) === em
                                    ? "bg-[var(--accent)] border-[var(--brand-400)] text-[var(--accent-foreground)]"
                                    : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                                }`}
                              >
                                هر {toFa(em)} دقیقه
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {["08:00", "08:30", "13:00", "18:00", "21:00"].map(tm => (
                              <button
                                key={tm}
                                type="button"
                                onClick={() => updateNodeParams(selectedNode.id, { dailyTime: tm })}
                                className={`px-3 py-1 rounded-[var(--radius-md)] border font-medium cursor-pointer ${
                                  (selectedNode.params.dailyTime || "08:30") === tm
                                    ? "bg-[var(--accent)] border-[var(--brand-400)] text-[var(--accent-foreground)]"
                                    : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                                }`}
                              >
                                ساعت {toFa(tm)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {selectedNode.type === "sentiment_gate" && (
                      <div className="space-y-1.5">
                        <label className="font-medium text-[var(--foreground-muted)] block">
                          طیف احساسی عبوری:
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          {[
                            { id: "negative_or_critical", label: "فقط منفی / بحرانی" },
                            { id: "positive", label: "فقط مثبت" },
                            { id: "neutral", label: "خنثی و گزارشی" },
                            { id: "any", label: "همهٔ احساسات" },
                          ].map(sf => (
                            <button
                              key={sf.id}
                              type="button"
                              onClick={() =>
                                updateNodeParams(selectedNode.id, { sentimentFilter: sf.id as any })
                              }
                              className={`p-2 rounded-[var(--radius-md)] border text-right font-medium transition cursor-pointer ${
                                (selectedNode.params.sentimentFilter || "negative_or_critical") === sf.id
                                  ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)]"
                                  : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                              }`}
                            >
                              {sf.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedNode.type === "keyword_gate" && (
                      <div className="space-y-2">
                        <label className="font-medium text-[var(--foreground-muted)] block">
                          کلیدواژه‌های صافی:
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            value={kwInput}
                            onChange={e => setKwInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter" && kwInput.trim()) {
                                e.preventDefault();
                                const cur = selectedNode.params.includeKeywords || [];
                                updateNodeParams(selectedNode.id, {
                                  includeKeywords: [...cur, kwInput.trim()],
                                });
                                setKwInput("");
                              }
                            }}
                            placeholder="مثلاً: انرژی، بانک مرکزی، مذاکرات..."
                            className="flex-1 h-8 px-2.5 rounded-[var(--radius-md)] bg-[var(--background-subtle)] border border-[var(--border-subtle)] outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!kwInput.trim()) return;
                              const cur = selectedNode.params.includeKeywords || [];
                              updateNodeParams(selectedNode.id, {
                                includeKeywords: [...cur, kwInput.trim()],
                              });
                              setKwInput("");
                            }}
                            className="h-8 px-3 rounded-[var(--radius-md)] bg-[var(--primary)] text-[var(--primary-foreground)] font-medium cursor-pointer"
                          >
                            + افزودن
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(selectedNode.params.includeKeywords || []).map(kw => (
                            <span
                              key={kw}
                              className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-foreground)] font-medium inline-flex items-center gap-1"
                            >
                              {kw}
                              <button
                                type="button"
                                aria-label={`حذف کلیدواژه ${kw}`}
                                onClick={() =>
                                  updateNodeParams(selectedNode.id, {
                                    includeKeywords: (selectedNode.params.includeKeywords || []).filter(k => k !== kw),
                                  })
                                }
                                className="cursor-pointer"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {(selectedNode.type === "ai_composer" ||
                      selectedNode.type === "tone_shifter") && (
                      <div className="space-y-1.5">
                        <label className="font-medium text-[var(--foreground-muted)] block">
                          لحن نگارش هوش مصنوعی:
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          {[
                            { id: "breaking", label: "فوری و قلاب‌دار" },
                            { id: "analytical", label: "تحلیلی و عمیق" },
                            { id: "official", label: "رسمی و خبرگزاری" },
                            { id: "narrative", label: "روایی و داستانی" },
                          ].map(tn => (
                            <button
                              key={tn.id}
                              type="button"
                              onClick={() =>
                                updateNodeParams(selectedNode.id, { toneStyle: tn.id as any })
                              }
                              className={`p-2 rounded-[var(--radius-md)] border text-right font-medium transition cursor-pointer ${
                                (selectedNode.params.toneStyle || "breaking") === tn.id
                                  ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)]"
                                  : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                              }`}
                            >
                              {tn.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedNode.type === "graphic_card" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="font-medium text-[var(--foreground-muted)] block">
                            قالب کارت گرافیکی:
                          </label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {[
                              { id: "breaking_red", label: "قرمز خبر فوری" },
                              { id: "dark_editorial", label: "تیره تحریریه" },
                              { id: "light_paper", label: "روشن روزنامه‌ای" },
                              { id: "brand_emerald", label: "زمردی برند" },
                            ].map(cs => (
                              <button
                                key={cs.id}
                                type="button"
                                onClick={() =>
                                  updateNodeParams(selectedNode.id, { cardStyle: cs.id as any })
                                }
                                className={`p-2 rounded-[var(--radius-md)] border text-right font-medium transition cursor-pointer ${
                                  (selectedNode.params.cardStyle || "breaking_red") === cs.id
                                    ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)]"
                                    : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                                }`}
                              >
                                {cs.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="font-medium text-[var(--foreground-muted)] block">
                            نسبت ابعاد:
                          </label>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {[
                              { id: "square", label: "۱:۱ مربعی" },
                              { id: "story", label: "۹:۱۶ استوری" },
                              { id: "wide", label: "۱۶:۹ افقی" },
                            ].map(rt => (
                              <button
                                key={rt.id}
                                type="button"
                                onClick={() =>
                                  updateNodeParams(selectedNode.id, { cardRatio: rt.id as any })
                                }
                                className={`px-3 py-1.5 rounded-[var(--radius-md)] border font-medium transition cursor-pointer ${
                                  (selectedNode.params.cardRatio || "square") === rt.id
                                    ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)]"
                                    : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                                }`}
                              >
                                {rt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {(selectedNode.type === "telegram_dest" ||
                      selectedNode.type === "iranian_messengers") && (
                      <div className="space-y-2">
                        <label className="font-medium text-[var(--foreground-muted)] block">
                          قابلیت‌های پیام‌رسان:
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          <button
                            type="button"
                            aria-pressed={selectedNode.params.inlineFullStoryBtn !== false}
                            onClick={() =>
                              updateNodeParams(selectedNode.id, {
                                inlineFullStoryBtn: !selectedNode.params.inlineFullStoryBtn,
                              })
                            }
                            className={`p-2 rounded-[var(--radius-md)] border text-right font-medium flex items-center justify-between cursor-pointer ${
                              selectedNode.params.inlineFullStoryBtn !== false
                                ? "bg-[var(--accent)] border-[var(--brand-400)] text-[var(--accent-foreground)]"
                                : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                            }`}
                          >
                            <span>دکمه متن کامل</span>
                            <span>{selectedNode.params.inlineFullStoryBtn !== false ? "✓" : ""}</span>
                          </button>

                          <button
                            type="button"
                            aria-pressed={selectedNode.params.inlineReactionPoll !== false}
                            onClick={() =>
                              updateNodeParams(selectedNode.id, {
                                inlineReactionPoll: !selectedNode.params.inlineReactionPoll,
                              })
                            }
                            className={`p-2 rounded-[var(--radius-md)] border text-right font-medium flex items-center justify-between cursor-pointer ${
                              selectedNode.params.inlineReactionPoll !== false
                                ? "bg-[var(--accent)] border-[var(--brand-400)] text-[var(--accent-foreground)]"
                                : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                            }`}
                          >
                            <span>واکنش (👍/👎/🔥)</span>
                            <span>{selectedNode.params.inlineReactionPoll !== false ? "✓" : ""}</span>
                          </button>

                          <button
                            type="button"
                            aria-pressed={!!selectedNode.params.autoPinBreaking}
                            onClick={() =>
                              updateNodeParams(selectedNode.id, {
                                autoPinBreaking: !selectedNode.params.autoPinBreaking,
                              })
                            }
                            className={`p-2 rounded-[var(--radius-md)] border text-right font-medium flex items-center justify-between cursor-pointer ${
                              selectedNode.params.autoPinBreaking
                                ? "bg-[var(--danger-50)] border-[var(--danger-500)]/40 text-[var(--danger-600)]"
                                : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                            }`}
                          >
                            <span>پین خودکار</span>
                            <span>{selectedNode.params.autoPinBreaking ? "✓" : ""}</span>
                          </button>

                          <button
                            type="button"
                            aria-pressed={!!selectedNode.params.replyToPreviousChain}
                            onClick={() =>
                              updateNodeParams(selectedNode.id, {
                                replyToPreviousChain: !selectedNode.params.replyToPreviousChain,
                              })
                            }
                            className={`p-2 rounded-[var(--radius-md)] border text-right font-medium flex items-center justify-between cursor-pointer ${
                              selectedNode.params.replyToPreviousChain
                                ? "bg-[var(--accent)] border-[var(--brand-400)] text-[var(--accent-foreground)]"
                                : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                            }`}
                          >
                            <span>اتصال به پست قبلی</span>
                            <span>{selectedNode.params.replyToPreviousChain ? "✓" : ""}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedNode.type === "smart_antiflood_queue" && (
                      <div className="space-y-1.5">
                        <label className="font-medium text-[var(--foreground-muted)] block">
                          حداقل فاصلهٔ ضد ازدحام بین پست‌ها:
                        </label>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[15, 20, 30, 45, 60].map(gap => (
                            <button
                              key={gap}
                              type="button"
                              onClick={() =>
                                updateNodeParams(selectedNode.id, { antiFloodMinGap: gap })
                              }
                              className={`px-3 py-1.5 rounded-[var(--radius-md)] border font-medium transition cursor-pointer ${
                                (selectedNode.params.antiFloodMinGap || 20) === gap
                                  ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)]"
                                  : "bg-[var(--background-subtle)] border-[var(--border-subtle)]"
                              }`}
                            >
                              {toFa(gap)} دقیقه
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedNode.category === "destination" && (
                      <CollapsibleSection
                        title="انتخاب کانال‌ها و شبکه‌های مقصد"
                        badge={`${toFa((selectedNode.params.platforms || ["telegram"]).length)} مقصد`}
                        open={destPlatformsOpen}
                        onToggle={() => setDestPlatformsOpen(v => !v)}
                        testId="toggle-flow-dest-platforms"
                      >
                        <div className="flex flex-wrap gap-1.5">
                          {ALL_PLATFORMS.map(pl => {
                            const cur = selectedNode.params.platforms || ["telegram"];
                            const isOn = cur.includes(pl);
                            return (
                              <button
                                key={pl}
                                type="button"
                                onClick={() => {
                                  const next = isOn
                                    ? cur.filter(x => x !== pl)
                                    : [...cur, pl];
                                  updateNodeParams(selectedNode.id, {
                                    platforms: next.length ? next : ["telegram"],
                                  });
                                }}
                                className={`px-2.5 py-1 rounded-[var(--radius-sm)] border text-[11px] flex items-center gap-1 transition cursor-pointer ${
                                  isOn
                                    ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)] font-medium"
                                    : "bg-[var(--background-subtle)] border-[var(--border-subtle)] text-[var(--foreground-muted)]"
                                }`}
                              >
                                <span>{PLATFORM_META[pl].emoji}</span>
                                <span>{PLATFORM_META[pl].label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </CollapsibleSection>
                    )}
                  </div>
                )}

                {inspectorTab === "preview" && (
                  <div className="max-w-3xl space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[var(--foreground)] flex items-center gap-1.5">
                        <Sparkles className="size-4 text-[var(--brand-600)]" />
                        خروجی شبیه‌سازی‌شده روی اخبار واقعی
                      </span>
                      <span className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-foreground)] text-[10.5px] font-medium">
                        {simResult.deliveryMode === "human_autopilot"
                          ? "خلبان خودکار با تأیید سردبیر"
                          : simResult.deliveryMode === "smart_queue"
                            ? `صف هوشمند (فاصله ${toFa(simResult.antiFloodGapMinutes)} دقیقه)`
                            : "انتشار مستقیم"}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[140px_minmax(0,1fr)] gap-3 items-start">
                      <div className="rounded-[var(--radius-lg)] overflow-hidden border border-[var(--border-subtle)] bg-[var(--ink-800)] flex flex-col items-center">
                        {previewCardUrl ? (
                          <img
                            src={previewCardUrl}
                            alt={simResult.generatedHeadline}
                            className="w-full h-32 object-cover"
                          />
                        ) : (
                          <div className="h-32 w-full grid place-items-center text-[11px] text-[var(--ink-300)]">
                            کارت گرافیکی خودکار
                          </div>
                        )}
                        <div className="w-full px-2 py-1 text-center text-[10px] font-medium text-white bg-[var(--ink-900)]">
                          {simResult.cardConfig.isBreakingRed
                            ? "کارت قرمز فوری"
                            : "کارت گرافیکی تحریریه"}
                        </div>
                      </div>

                      <div className="rounded-[var(--radius-lg)] bg-[#182533] text-white p-3 space-y-2 border border-white/10 text-xs">
                        {simResult.messengerConfig.autoPin && (
                          <div className="px-2 py-1 rounded bg-rose-500/20 text-rose-300 text-[10px] font-semibold flex items-center gap-1">
                            <Pin className="size-3" />
                            <span>پین خودکار فعال است</span>
                          </div>
                        )}

                        {simResult.messengerConfig.replyToPrev && (
                          <div className="px-2 py-1 rounded bg-[#131E2A] border-r-2 border-sky-400 text-[10px] text-sky-300 flex items-center gap-1">
                            <CornerUpRight className="size-3" />
                            <span>متصل به پست قبلی زنجیره</span>
                          </div>
                        )}

                        <div className="text-[11.5px] leading-relaxed whitespace-pre-wrap line-clamp-4">
                          {simResult.generatedOutputs.telegram.text}
                        </div>

                        <div className="space-y-1 pt-1">
                          {simResult.messengerConfig.inlineFullStory && (
                            <div className="w-full py-1 px-2 rounded-lg bg-white/10 text-center text-[10.5px] font-medium flex items-center justify-center gap-1">
                              <span>متن کامل خبر</span>
                              <ExternalLink className="size-3 text-sky-300" />
                            </div>
                          )}
                          {simResult.messengerConfig.inlineReactions && (
                            <div className="grid grid-cols-3 gap-1 text-[10.5px]">
                              <span className="py-1 rounded-lg bg-white/10 text-center">👍 ۴۲</span>
                              <span className="py-1 rounded-lg bg-white/10 text-center">👎 ۵</span>
                              <span className="py-1 rounded-lg bg-white/10 text-center">🔥 ۸۹</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
