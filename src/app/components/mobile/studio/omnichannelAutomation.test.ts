import test from "node:test";
import assert from "node:assert/strict";
import {
  detectArticleSentiment,
  evaluateCompoundRulesOnArticles,
  detectFloodConflicts,
  redistributeQueueAntiFlood,
  suggestSmartPublishSlots,
  DEFAULT_COMPOUND_RULES,
  type ScheduledSlotItem,
} from "./omnichannelAutomation";
import type { Article } from "../../../data";

test("detectArticleSentiment classifies critical, negative, positive, and neutral headlines", () => {
  const crit = detectArticleSentiment("فوری: هشدار بحران و انفجار در خط لوله انرژی");
  assert.equal(crit.label, "critical");
  assert.ok(crit.score < -0.5);

  const neg = detectArticleSentiment("ریزش شاخص و نگرانی از رکود بازار");
  assert.equal(neg.label, "negative");

  const pos = detectArticleSentiment("رشد صادرات و ثبت رکورد همکاری اقتصادی");
  assert.equal(pos.label, "positive");
});

test("evaluateCompoundRulesOnArticles triggers Breaking Cluster with 3+ sources in <20m and critical sentiment", () => {
  const now = Date.UTC(2026, 10, 16, 12, 0, 0);
  const articles: Article[] = [
    {
      id: "a1",
      title: "فوری: بحران شدید و اختلال گسترده در شبکه انرژی اروپا",
      source: "ایرنا",
      date: new Date(now - 12 * 60000).toISOString(),
      preview: "گزارش فوری از بروز بحران انرژی",
      content: "",
      category: "جهان",
      readTime: "۲ دقیقه",
      image: "",
      unread: true,
      starred: false,
    },
    {
      id: "a2",
      title: "هشدار بحران شدید و اختلال گسترده در شبکه انرژی کشورهای اروپا",
      source: "ایسنا",
      date: new Date(now - 8 * 60000).toISOString(),
      preview: "بحران در تامین برق",
      content: "",
      category: "جهان",
      readTime: "۲ دقیقه",
      image: "",
      unread: true,
      starred: false,
    },
    {
      id: "a3",
      title: "گزارش فوری از بحران شدید و اختلال در شبکه انرژی اروپا",
      source: "تسنیم",
      date: new Date(now - 3 * 60000).toISOString(),
      preview: "پیامدهای بحران انرژی",
      content: "",
      category: "جهان",
      readTime: "۲ دقیقه",
      image: "",
      unread: true,
      starred: false,
    },
  ];

  const candidates = evaluateCompoundRulesOnArticles(articles, DEFAULT_COMPOUND_RULES, now);
  assert.ok(candidates.length >= 1, "Expected at least 1 autopilot candidate");
  const top = candidates[0];
  assert.equal(top.sourceCount, 3);
  assert.ok(top.spanMinutes <= 20);
  assert.equal(top.cardStyle, "breaking_red");
  assert.equal(top.priority, "high");
  assert.equal(top.status, "pending_approval");
});

test("detectFloodConflicts and redistributeQueueAntiFlood enforce minimum 20m spacing", () => {
  const now = Date.UTC(2026, 10, 16, 12, 0, 0);
  const crowded: ScheduledSlotItem[] = [
    { id: "p1", title: "پست اول", scheduledAt: now + 10 * 60000, priority: "normal" },
    { id: "p2", title: "پست دوم", scheduledAt: now + 15 * 60000, priority: "normal" },
    { id: "p3", title: "پست سوم", scheduledAt: now + 22 * 60000, priority: "high" },
  ];

  const conflictsBefore = detectFloodConflicts(crowded, 20);
  assert.equal(conflictsBefore.length, 2, "Should detect 2 anti-flood violations");

  const spaced = redistributeQueueAntiFlood(crowded, 20, now);
  const conflictsAfter = detectFloodConflicts(spaced, 20);
  assert.equal(conflictsAfter.length, 0, "Should have 0 conflicts after redistribution");

  const gap12 = (spaced[1].scheduledAt - spaced[0].scheduledAt) / 60000;
  const gap23 = (spaced[2].scheduledAt - spaced[1].scheduledAt) / 60000;
  assert.ok(gap12 >= 20, `Expected gap12 >= 20, got ${gap12}`);
  assert.ok(gap23 >= 20, `Expected gap23 >= 20, got ${gap23}`);
});

test("suggestSmartPublishSlots returns conflict-free optimal time slots", () => {
  const now = Date.UTC(2026, 10, 16, 12, 0, 0);
  const existing = [now + 15 * 60000, now + 30 * 60000];
  const slots = suggestSmartPublishSlots(existing, now, 20, 4);

  assert.equal(slots.length, 4);
  for (const s of slots) {
    assert.ok(s.ts > now);
    assert.ok(s.gapFromNearestMin >= 20, `Expected slot gap >= 20m, got ${s.gapFromNearestMin}`);
  }
});
