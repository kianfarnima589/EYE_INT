export type MainWorkspaceTab = "reader" | "editorial" | "visual_flow" | "graph";

export const VALID_WORKSPACE_TABS: readonly MainWorkspaceTab[] = [
  "reader",
  "editorial",
  "visual_flow",
  "graph",
] as const;

export function sanitizeWorkspaceTab(value: unknown): MainWorkspaceTab {
  if (typeof value === "string" && (VALID_WORKSPACE_TABS as readonly string[]).includes(value)) {
    return value as MainWorkspaceTab;
  }
  return "reader";
}

export function sanitizeSidebarCollapsed(value: unknown): boolean {
  return value === true || value === "true";
}

export function toggleSidebarCollapsed(current: boolean): boolean {
  return !current;
}

/**
 * Resolves which main workspace tab should become active when a user selects
 * a view or tool from the sidebar or command palette.
 */
export function resolveWorkspaceTabForView(viewId: string): MainWorkspaceTab {
  if (viewId === "graph") return "graph";
  if (viewId === "studio") return "editorial";
  if (viewId === "visual-flow" || viewId === "visual_flow") return "visual_flow";
  return "reader";
}

export function studioSubViewForTab(
  tab: MainWorkspaceTab,
): "workspace" | "visual_flow" | null {
  if (tab === "editorial") return "workspace";
  if (tab === "visual_flow") return "visual_flow";
  return null;
}
