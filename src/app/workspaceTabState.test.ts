import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeWorkspaceTab,
  sanitizeSidebarCollapsed,
  toggleSidebarCollapsed,
  resolveWorkspaceTabForView,
  studioSubViewForTab,
} from "./workspaceTabState.ts";

test("sanitizeWorkspaceTab accepts valid tabs and falls back to reader", () => {
  assert.equal(sanitizeWorkspaceTab("reader"), "reader");
  assert.equal(sanitizeWorkspaceTab("editorial"), "editorial");
  assert.equal(sanitizeWorkspaceTab("visual_flow"), "visual_flow");
  assert.equal(sanitizeWorkspaceTab("graph"), "graph");
  assert.equal(sanitizeWorkspaceTab("unknown"), "reader");
  assert.equal(sanitizeWorkspaceTab(null), "reader");
});

test("sanitizeSidebarCollapsed and toggleSidebarCollapsed manage sidebar rail state", () => {
  assert.equal(sanitizeSidebarCollapsed(true), true);
  assert.equal(sanitizeSidebarCollapsed("true"), true);
  assert.equal(sanitizeSidebarCollapsed(false), false);
  assert.equal(sanitizeSidebarCollapsed("false"), false);
  assert.equal(sanitizeSidebarCollapsed(undefined), false);

  assert.equal(toggleSidebarCollapsed(false), true);
  assert.equal(toggleSidebarCollapsed(true), false);
});

test("resolveWorkspaceTabForView maps sidebar views to exclusive workspace tabs", () => {
  assert.equal(resolveWorkspaceTabForView("all"), "reader");
  assert.equal(resolveWorkspaceTabForView("unread"), "reader");
  assert.equal(resolveWorkspaceTabForView("international"), "reader");
  assert.equal(resolveWorkspaceTabForView("graph"), "graph");
  assert.equal(resolveWorkspaceTabForView("studio"), "editorial");
  assert.equal(resolveWorkspaceTabForView("visual-flow"), "visual_flow");
  assert.equal(resolveWorkspaceTabForView("visual_flow"), "visual_flow");
});

test("studioSubViewForTab maps workspace tabs to DesktopStudio initial views", () => {
  assert.equal(studioSubViewForTab("editorial"), "workspace");
  assert.equal(studioSubViewForTab("visual_flow"), "visual_flow");
  assert.equal(studioSubViewForTab("reader"), null);
  assert.equal(studioSubViewForTab("graph"), null);
});
