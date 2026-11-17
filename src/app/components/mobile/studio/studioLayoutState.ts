export type EditorialSectionKey =
  | "formattingAndTags"
  | "omnichannelModules"
  | "basketOptions"
  | "cardDesigner"
  | "feedFilters";

export type FlowPanelTab = "inspector" | "preview";

export type WorkspaceLayoutPrefs = {
  railCollapsed: boolean;
  flowToolboxOpen: boolean;
  flowInspectorOpen: boolean;
  flowInspectorTab: FlowPanelTab;
  editorialSections: Record<EditorialSectionKey, boolean>;
};

export const DEFAULT_WORKSPACE_LAYOUT_PREFS: WorkspaceLayoutPrefs = {
  railCollapsed: false,
  flowToolboxOpen: true,
  flowInspectorOpen: true,
  flowInspectorTab: "inspector",
  editorialSections: {
    formattingAndTags: false,
    omnichannelModules: false,
    basketOptions: false,
    cardDesigner: false,
    feedFilters: false,
  },
};

export function toggleEditorialSection(
  prefs: WorkspaceLayoutPrefs,
  key: EditorialSectionKey,
): WorkspaceLayoutPrefs {
  return {
    ...prefs,
    editorialSections: {
      ...prefs.editorialSections,
      [key]: !prefs.editorialSections[key],
    },
  };
}

export function setEditorialSection(
  prefs: WorkspaceLayoutPrefs,
  key: EditorialSectionKey,
  open: boolean,
): WorkspaceLayoutPrefs {
  if (prefs.editorialSections[key] === open) return prefs;
  return {
    ...prefs,
    editorialSections: {
      ...prefs.editorialSections,
      [key]: open,
    },
  };
}

export function countActiveOmnichannelFeatures(opts: {
  inlineButtonsCount: number;
  silent: boolean;
  autoPin: boolean;
  replyEnabled: boolean;
  threadCount: number;
  scheduledSlotTs: number | null;
}): number {
  let count = 0;
  if (opts.inlineButtonsCount > 0) count++;
  if (opts.silent) count++;
  if (opts.autoPin) count++;
  if (opts.replyEnabled) count++;
  if (opts.threadCount > 0) count++;
  if (opts.scheduledSlotTs) count++;
  return count;
}

export function sanitizeWorkspaceLayoutPrefs(raw: unknown): WorkspaceLayoutPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_WORKSPACE_LAYOUT_PREFS;
  const obj = raw as Record<string, unknown>;
  const sec =
    obj.editorialSections && typeof obj.editorialSections === "object"
      ? (obj.editorialSections as Record<string, unknown>)
      : {};
  return {
    railCollapsed: typeof obj.railCollapsed === "boolean" ? obj.railCollapsed : false,
    flowToolboxOpen: typeof obj.flowToolboxOpen === "boolean" ? obj.flowToolboxOpen : true,
    flowInspectorOpen: typeof obj.flowInspectorOpen === "boolean" ? obj.flowInspectorOpen : true,
    flowInspectorTab:
      obj.flowInspectorTab === "preview" || obj.flowInspectorTab === "inspector"
        ? obj.flowInspectorTab
        : "inspector",
    editorialSections: {
      formattingAndTags: Boolean(sec.formattingAndTags),
      omnichannelModules: Boolean(sec.omnichannelModules),
      basketOptions: Boolean(sec.basketOptions),
      cardDesigner: Boolean(sec.cardDesigner),
      feedFilters: Boolean(sec.feedFilters),
    },
  };
}
