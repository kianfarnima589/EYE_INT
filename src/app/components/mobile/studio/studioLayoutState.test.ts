import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORKSPACE_LAYOUT_PREFS,
  toggleEditorialSection,
  setEditorialSection,
  countActiveOmnichannelFeatures,
  sanitizeWorkspaceLayoutPrefs,
} from "./studioLayoutState";

test("default workspace prefs keep secondary sections collapsed for a minimal canvas", () => {
  assert.equal(DEFAULT_WORKSPACE_LAYOUT_PREFS.editorialSections.formattingAndTags, false);
  assert.equal(DEFAULT_WORKSPACE_LAYOUT_PREFS.editorialSections.omnichannelModules, false);
  assert.equal(DEFAULT_WORKSPACE_LAYOUT_PREFS.editorialSections.basketOptions, false);
  assert.equal(DEFAULT_WORKSPACE_LAYOUT_PREFS.editorialSections.cardDesigner, false);
  assert.equal(DEFAULT_WORKSPACE_LAYOUT_PREFS.editorialSections.feedFilters, false);
});

test("toggleEditorialSection flips only the targeted section", () => {
  const next = toggleEditorialSection(DEFAULT_WORKSPACE_LAYOUT_PREFS, "omnichannelModules");
  assert.equal(next.editorialSections.omnichannelModules, true);
  assert.equal(next.editorialSections.formattingAndTags, false);
  const back = toggleEditorialSection(next, "omnichannelModules");
  assert.equal(back.editorialSections.omnichannelModules, false);
});

test("setEditorialSection sets explicit open state idempotently", () => {
  const same = setEditorialSection(DEFAULT_WORKSPACE_LAYOUT_PREFS, "cardDesigner", false);
  assert.equal(same, DEFAULT_WORKSPACE_LAYOUT_PREFS);
  const opened = setEditorialSection(DEFAULT_WORKSPACE_LAYOUT_PREFS, "cardDesigner", true);
  assert.equal(opened.editorialSections.cardDesigner, true);
});

test("countActiveOmnichannelFeatures summarizes enabled features accurately", () => {
  assert.equal(
    countActiveOmnichannelFeatures({
      inlineButtonsCount: 0,
      silent: false,
      autoPin: false,
      replyEnabled: false,
      threadCount: 0,
      scheduledSlotTs: null,
    }),
    0,
  );
  assert.equal(
    countActiveOmnichannelFeatures({
      inlineButtonsCount: 3,
      silent: true,
      autoPin: false,
      replyEnabled: true,
      threadCount: 2,
      scheduledSlotTs: 1700000000000,
    }),
    5,
  );
});

test("sanitizeWorkspaceLayoutPrefs safely handles corrupted storage data", () => {
  assert.deepEqual(sanitizeWorkspaceLayoutPrefs(null), DEFAULT_WORKSPACE_LAYOUT_PREFS);
  assert.deepEqual(sanitizeWorkspaceLayoutPrefs("bad"), DEFAULT_WORKSPACE_LAYOUT_PREFS);
  const partial = sanitizeWorkspaceLayoutPrefs({
    railCollapsed: true,
    flowInspectorTab: "preview",
    editorialSections: { omnichannelModules: true },
  });
  assert.equal(partial.railCollapsed, true);
  assert.equal(partial.flowInspectorTab, "preview");
  assert.equal(partial.editorialSections.omnichannelModules, true);
  assert.equal(partial.editorialSections.formattingAndTags, false);
});
