import test from "node:test";
import assert from "node:assert/strict";
import {
  FLOW_BLOCK_CATALOG,
  PRESET_FLOW_PIPELINES,
  createNodeFromCatalog,
  getNodeVisualBadges,
  simulateVisualFlow,
} from "./visualFlowEngine";
import type { Article } from "../../../data";

test("FLOW_BLOCK_CATALOG covers all 4 block families (source, filter, transform, destination)", () => {
  const categories = new Set(FLOW_BLOCK_CATALOG.map(b => b.category));
  assert.deepEqual(
    Array.from(categories).sort(),
    ["destination", "filter", "source", "transform"],
  );
  assert.ok(FLOW_BLOCK_CATALOG.length >= 20, "Catalog should have at least 20 visual blocks");
});

test("createNodeFromCatalog and getNodeVisualBadges produce readable Persian micro-badges", () => {
  const clusterNode = createNodeFromCatalog("breaking_cluster", "test1");
  const badges = getNodeVisualBadges(clusterNode);
  assert.ok(badges.some(b => b.includes("خبرگزاری")));
  assert.ok(badges.some(b => b.includes("دقیقه")));

  const tgNode = createNodeFromCatalog("telegram_dest", "test2");
  const tgBadges = getNodeVisualBadges(tgNode);
  assert.ok(tgBadges.some(b => b.includes("دکمه شیشه‌ای")));
  assert.ok(tgBadges.some(b => b.includes("پین خودکار")));
});

test("simulateVisualFlow executes pipeline nodes in sequence and produces multi-platform outputs + card config", () => {
  const articles: Article[] = [
    {
      id: "art-1",
      title: "فوری: هشدار بحران انرژی و نشست اضطراری در اروپا",
      source: "ایرنا",
      date: new Date().toISOString(),
      preview: "گزارش فوری از بروز بحران شدید",
      content: "متن کامل گزارش",
      category: "بین‌الملل",
      readTime: "۲ دقیقه",
      image: "",
      unread: true,
      starred: false,
    },
    {
      id: "art-2",
      title: "تداوم بحران و افزایش قیمت گاز در بازارهای جهانی",
      source: "ایسنا",
      date: new Date().toISOString(),
      preview: "پیامدهای اقتصادی",
      content: "",
      category: "اقتصاد",
      readTime: "۳ دقیقه",
      image: "",
      unread: true,
      starred: false,
    },
  ];

  const breakingPipeline = PRESET_FLOW_PIPELINES[0];
  const sim = simulateVisualFlow(breakingPipeline, articles);

  assert.equal(sim.stepTraces.length, breakingPipeline.nodes.length);
  assert.equal(sim.cardConfig.isBreakingRed, true);
  assert.equal(sim.cardConfig.accent, "#E11D48");
  assert.ok(sim.generatedHeadline.includes("فوری"));
  assert.ok(sim.generatedOutputs.telegram.text.length > 20);
  assert.equal(sim.messengerConfig.autoPin, true);
});
