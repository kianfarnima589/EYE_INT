import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCascadeTree,
  computeAdvancedCentrality,
  detectCoordinatedSyndication,
  analyzeCoverageBlindspots,
  computeLocalNarrativeDivergence,
  computeTemporalLifecycle,
} from "./graphAnalytics";

test("buildCascadeTree identifies Patient-Zero, first-5-minute wave, and headline mutations", () => {
  const baseTs = 1770000000000;
  const cluster = {
    id: "c1",
    items: [
      {
        id: "a1",
        source: "ایرنا",
        category: "داخلی · خبرگزاری",
        title: "افتتاح نیروگاه خورشیدی ۵۰۰ مگاواتی در استان اصفهان",
        ts: baseTs,
      },
      {
        id: "a2",
        source: "ایسنا",
        category: "داخلی · خبرگزاری",
        title: "افتتاح نیروگاه خورشیدی ۵۰۰ مگاواتی در استان اصفهان امروز",
        ts: baseTs + 3 * 60 * 1000, // +3 min (first5m, faithful headline)
      },
      {
        id: "a3",
        source: "تابناک",
        category: "داخلی · پایگاه خبری",
        title: "چالش ناترازی برق و وعده جدید دولت برای توسعه انرژی پاک در مرکز کشور",
        ts: baseTs + 18 * 60 * 1000, // +18 min (early30m, mutated headline)
      },
    ],
  };

  const tree = buildCascadeTree(cluster);
  assert.ok(tree);
  assert.equal(tree.patientZero.source, "ایرنا");
  assert.equal(tree.patientZero.wave, "origin");
  assert.equal(tree.first5mCount, 1);
  assert.equal(tree.early30mCount, 1);
  assert.equal(tree.mutatedCount, 1);

  const isnaNode = tree.nodes.find((n) => n.source === "ایسنا")!;
  assert.equal(isnaNode.wave, "first5m");
  assert.equal(isnaNode.mutatedHeadline, false);
  assert.equal(isnaNode.mutationType, "تیتر وفادار");

  const tabnakNode = tree.nodes.find((n) => n.source === "تابناک")!;
  assert.equal(tabnakNode.wave, "early30m");
  assert.equal(tabnakNode.mutatedHeadline, true);
  assert.ok(tabnakNode.addedKeywords.length > 0);
});

test("computeAdvancedCentrality computes Betweenness Centrality bridges and Lead-Lag scores", () => {
  const t0 = 1770000000000;
  const nodes = [
    { id: "ایرنا", name: "ایرنا", icon: "📰", category: "داخلی · رسمی", pagerank: 0.8, firstCount: 2 },
    { id: "شفقنا", name: "شفقنا", icon: "🌐", category: "داخلی · بین‌الملل", pagerank: 0.6, firstCount: 0 },
    { id: "BBC News", name: "BBC News", icon: "🇬🇧", category: "بین‌الملل · بریتانیا", pagerank: 0.7, firstCount: 0 },
  ];
  const edges = [
    { source: "ایرنا", target: "شفقنا", weight: 5 },
    { source: "شفقنا", target: "BBC News", weight: 5 },
  ];
  const clusters = [
    {
      id: "c1",
      origin: { source: "ایرنا", ts: t0 },
      items: [
        { source: "ایرنا", ts: t0 },
        { source: "شفقنا", ts: t0 + 10 * 60 * 1000 },
        { source: "BBC News", ts: t0 + 25 * 60 * 1000 },
      ],
    },
  ];

  const metrics = computeAdvancedCentrality(nodes, edges, clusters);
  const irna = metrics.find((m) => m.id === "ایرنا")!;
  const shafaqna = metrics.find((m) => m.id === "شفقنا")!;
  const bbc = metrics.find((m) => m.id === "BBC News")!;

  // شفقنا sits on the shortest path between ایرنا and BBC News and bridges domestic & international
  assert.ok(shafaqna.betweenness > irna.betweenness);
  // ایرنا published 10 min before median -> negative leadLagMin (leader)
  assert.ok(irna.leadLagMin < 0);
  assert.equal(irna.role, "پیشتاز خبرساز");
  // BBC News published 15 min after median -> positive leadLagMin (follower)
  assert.ok(bbc.leadLagMin > 0);
});

test("detectCoordinatedSyndication detects near-identical articles published within 2 minutes", () => {
  const t0 = 1770000000000;
  const items = [
    {
      id: "1",
      source: "سایت الف",
      title: "بانک مرکزی دستورالعمل جدید تسهیلات مسکن را به بانک‌های عامل ابلاغ کرد",
      preview: "جزئیات کامل سقف جدید وام مسکن برای زوج‌های جوان اعلام شد.",
      ts: t0,
    },
    {
      id: "2",
      source: "سایت ب",
      title: "بانک مرکزی دستورالعمل جدید تسهیلات مسکن را به بانک‌های عامل ابلاغ کرد",
      preview: "جزئیات کامل سقف جدید وام مسکن برای زوج‌های جوان اعلام شد.",
      ts: t0 + 45 * 1000, // 45 seconds later
    },
    {
      id: "3",
      source: "سایت ج",
      title: "گزارش هواشناسی از بارش باران در استان‌های شمالی کشور",
      preview: "دمای هوا کاهش می‌یابد.",
      ts: t0 + 60 * 1000,
    },
  ];

  const groups = detectCoordinatedSyndication(items, 2, 0.85);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].strictMatch, true);
  assert.equal(groups[0].avgDeltaSec, 45);
  assert.ok(groups[0].maxSimilarity >= 0.95);
  assert.ok(groups[0].sources.includes("سایت الف") && groups[0].sources.includes("سایت ب"));
});

test("analyzeCoverageBlindspots and computeLocalNarrativeDivergence separate domestic vs international poles", () => {
  const t0 = 1770000000000;
  const clusters = [
    {
      id: "c_dom",
      origin: { source: "ایرنا", title: "افتتاح طرح آبرسانی استانی", ts: t0 },
      items: [
        { id: "1", source: "ایرنا", category: "داخلی · رسمی", title: "افتتاح طرح آبرسانی استانی", ts: t0 },
        { id: "2", source: "ایسنا", category: "داخلی · رسمی", title: "بهره‌برداری از طرح آبرسانی استانی", ts: t0 + 60000 },
      ],
    },
    {
      id: "c_cross",
      origin: { source: "مهر", title: "دور جدید گفتگوهای منطقه‌ای و دیپلماتیک در ژنو", ts: t0 },
      items: [
        { id: "3", source: "مهر", category: "داخلی · رسمی", title: "تاکید هیئت مذاکره‌کننده بر لغو تحریم‌ها در گفتگوهای ژنو", ts: t0 },
        { id: "4", source: "Euronews", category: "بین‌الملل · اروپا", title: "Geneva diplomatic talks resume amid regional tensions", ts: t0 + 120000 },
      ],
    },
  ];

  const report = analyzeCoverageBlindspots(clusters);
  assert.equal(report.domesticOnlyCount, 1);
  assert.equal(report.crossCoveredCount, 1);

  const div = computeLocalNarrativeDivergence(clusters[1]);
  assert.ok(div.agreedFacts.length >= 2);
  assert.ok(div.framingDifferences.length >= 2);
  assert.ok(div.loadedVocabulary.length >= 1);
});

test("computeTemporalLifecycle models cluster growth, peaking, and decay across 24 hours", () => {
  const nowTs = 1770000000000;
  const h = 3600000;
  const startTs = nowTs - 24 * h;

  // Cluster 1: formed at hour 2..3 (so by hour 24 it is decaying)
  // Cluster 2: formed at hour 22.5..23.5 with 3 sources (so by hour 24 it is peaking)
  // Cluster 3: formed at hour 23.2..23.8 with 2 sources (so by hour 24 it is growing)
  const c1Items = [
    { source: "ایرنا", ts: startTs + 2 * h },
    { source: "ایسنا", ts: startTs + 2.5 * h },
  ];
  const c2Items = [
    { source: "مهر", ts: startTs + 22.5 * h },
    { source: "تسنیم", ts: startTs + 23.0 * h },
    { source: "فارس", ts: startTs + 23.5 * h },
  ];
  const c3Items = [
    { source: "تابناک", ts: startTs + 23.2 * h },
    { source: "انتخاب", ts: startTs + 23.8 * h },
  ];

  const allItems = [...c1Items, ...c2Items, ...c3Items];
  const allClusters = [
    { id: "c1", items: c1Items },
    { id: "c2", items: c2Items },
    { id: "c3", items: c3Items },
  ];

  // At cursorHour = 3: c1 is growing, c2 and c3 haven't formed yet
  const atHour3 = computeTemporalLifecycle(allItems, allClusters, nowTs, 24, 3);
  assert.equal(atHour3.buckets.length, 24);
  assert.equal(atHour3.clusters.length, 1);
  assert.equal(atHour3.clusters[0].id, "c1");
  assert.equal(atHour3.clusters[0].phase, "growing");

  // At cursorHour = 24 (live): c1 has decayed, c2 is peaking, c3 is growing
  const atHour24 = computeTemporalLifecycle(allItems, allClusters, nowTs, 24, 24);
  assert.equal(atHour24.clusters.length, 3);
  assert.equal(atHour24.decayingCount, 1);
  assert.equal(atHour24.peakingCount, 1);
  assert.equal(atHour24.growingCount, 1);
  assert.equal(atHour24.nodeMultipliers["مهر"].phase, "peaking");
  assert.equal(atHour24.nodeMultipliers["ایرنا"].phase, "decaying");
});

