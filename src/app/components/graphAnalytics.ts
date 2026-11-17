// Persian-aware graph analytics: NER, Entity Linking, Knowledge Graph,
// Narrative Mining, Event Chains, Influence Scoring, Echo-Chamber Detection.
// Fully client-side, heuristic — no external API calls.

export type EntityType = "person" | "org" | "place" | "event";

export type Entity = {
  key: string;         // normalized canonical form
  name: string;        // display form
  type: EntityType;
  count: number;
  sources: Set<string>;
  clusters: Set<string>;
  firstTs: number;
  wikiUrl: string;
};

export type EntityEdge = {
  a: string; b: string; weight: number;
  coClusters: Set<string>;
};

export type Narrative = {
  id: string;
  clusterId: string;
  label: string;         // distinctive phrase
  terms: string[];
  sources: string[];     // sources that adopt this framing
  items: { id: string; source: string; title: string }[];
};

export type EventLink = {
  fromClusterId: string;
  toClusterId: string;
  sharedEntities: string[];
  gapHours: number;
};

export type EchoGroup = {
  id: string;
  members: string[];        // source ids
  cohesion: number;         // 0..1
  internalWeight: number;
  externalWeight: number;
};

// --------- Gazetteers / lexicons ---------

const PERSON_PREFIXES = [
  "آیت‌الله","آیت الله","حجت‌الاسلام","حجت الاسلام","دکتر","مهندس","آقای","خانم","سردار",
  "سرلشکر","سرتیپ","ژنرال","استاد","پروفسور","رئیس‌جمهور","رئیس جمهور","رهبر","وزیر","نمایندهٔ","نماینده",
  "شیخ","سید","علامه","مولانا","پادشاه","ملکه","پرزیدنت","رئیس",
];

const ORG_MARKERS = [
  "وزارت","سازمان","شرکت","بانک","مؤسسه","موسسه","دانشگاه","مجلس","دولت","کمیسیون","فدراسیون",
  "باشگاه","نیروی","ستاد","شورای","شورا","دادگاه","دادستانی","قوه","هیئت","هیات","کانون",
  "بنیاد","انجمن","حزب","جبهه","گروه","جنبش","کمیتهٔ","کمیته","اتحادیه","سندیکا","کنگره","سنا","پارلمان",
];

const PLACE_GAZETTEER = new Set([
  // Iran
  "ایران","تهران","مشهد","اصفهان","شیراز","تبریز","کرج","اهواز","قم","کرمانشاه","یزد","رشت","زاهدان","کرمان","اردبیل","همدان","بندرعباس","ساری","قزوین","اراک","خرم‌آباد","بوشهر","گرگان","بیرجند","ایلام","سنندج","ارومیه","شهرکرد","یاسوج","خوزستان","گیلان","مازندران","کردستان","لرستان","خراسان","فارس","آذربایجان",
  // Region
  "عراق","سوریه","لبنان","فلسطین","اسرائیل","غزه","کرانه باختری","یمن","بحرین","عربستان","امارات","قطر","کویت","عمان","ترکیه","افغانستان","پاکستان","تاجیکستان","آذربایجان",
  // World
  "آمریکا","ایالات متحده","روسیه","چین","انگلیس","بریتانیا","فرانسه","آلمان","ایتالیا","اسپانیا","ژاپن","کره","کرهٔ شمالی","کرهٔ جنوبی","هند","اوکراین","کانادا","استرالیا","مصر","اردن","سودان","لیبی","الجزایر","مراکش",
  // Cities
  "نیویورک","واشنگتن","لندن","پاریس","مسکو","پکن","استانبول","آنکارا","بغداد","دمشق","بیروت","قدس","اورشلیم","تل‌آویو","دوحه","ریاض","دبی","ابوظبی","کابل","اسلام‌آباد","دهلی","توکیو","سئول","کی‌یف",
]);

const EVENT_MARKERS = [
  "انتخابات","انفجار","حمله","تحریم","توافق","قرارداد","همایش","جلسه","نشست","کنفرانس","اجلاس",
  "بحران","جنگ","آتش‌بس","آتش بس","مذاکرات","مذاکره","تظاهرات","اعتصاب","راهپیمایی","زلزله","سیل","آتش‌سوزی","تصادف","ترور","ربوده","هواپیمایی","سقوط","سانحه",
];

// --------- Text utilities (Persian normalization) ---------

const DIACRITICS = /[\u064B-\u0652\u0670]/g;
const FA_STOP = new Set([
  "و","در","به","از","که","این","آن","را","با","بر","تا","است","هست","هستند","بود","شد","شده",
  "می","نمی","یک","های","ها","برای","یا","اگر","اما","هم","نیز","اش","ای","کرد","کند","خواهد","باید","آنها","ما","شما","او","من","نه","هر","چه","چرا","کجا","کی","چند","چون","بی","پس","پیش","نزد","کنار","بالا","پایین","درون","بیرون","حتی","فقط","همچنین","همواره","هرگز","گاه","گاهی",
]);

function norm(s: string): string {
  return (s || "")
    .replace(DIACRITICS, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normKey(s: string): string {
  return norm(s).toLowerCase();
}

function cleanTokens(s: string): string[] {
  return norm(s)
    .replace(/[.,،:;!?؟«»"'()\[\]{}…\-—–\/\\]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2 && !FA_STOP.has(t));
}

// --------- NER ---------

function extractPersons(text: string): string[] {
  const out = new Set<string>();
  const t = norm(text);
  for (const pref of PERSON_PREFIXES) {
    const re = new RegExp(`${pref}\\s+([\u0600-\u06FF\\s\u200c]{2,40}?)(?=[،.,:;!?؟«»()\\n]|\\s(?:در|به|از|که|را|با|بر|تا|است|شد|کرد|گفت|اعلام|اظهار)|$)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const cand = m[1].trim();
      const words = cand.split(/\s+/).filter(Boolean).slice(0, 4);
      if (words.length === 0) continue;
      const name = words.join(" ");
      if (name.length >= 3 && name.length <= 40) out.add(name);
    }
  }
  return Array.from(out);
}

function extractOrgs(text: string): string[] {
  const out = new Set<string>();
  const t = norm(text);
  for (const marker of ORG_MARKERS) {
    const re = new RegExp(`(${marker}(?:\\s+[\u0600-\u06FF\u200c]+){1,4})`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const span = m[1].trim();
      const words = span.split(/\s+/).slice(0, 5);
      if (words.length >= 2) out.add(words.join(" "));
    }
  }
  return Array.from(out);
}

function extractPlaces(text: string): string[] {
  const out = new Set<string>();
  const tokens = cleanTokens(text);
  for (const tk of tokens) {
    if (PLACE_GAZETTEER.has(tk)) out.add(tk);
  }
  // multi-word places
  const n = tokens.length;
  for (let i = 0; i < n - 1; i++) {
    const bi = `${tokens[i]} ${tokens[i + 1]}`;
    if (PLACE_GAZETTEER.has(bi)) out.add(bi);
  }
  return Array.from(out);
}

function extractEvents(text: string): string[] {
  const out = new Set<string>();
  const t = norm(text);
  for (const m of EVENT_MARKERS) {
    const re = new RegExp(`${m}(?:\\s+[\u0600-\u06FF\u200c]+){0,3}`, "g");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(t)) !== null) {
      const span = mm[0].trim();
      const words = span.split(/\s+/).slice(0, 4);
      if (words.length >= 1) out.add(words.join(" "));
    }
  }
  return Array.from(out);
}

export function extractEntities(title: string, preview: string): { name: string; type: EntityType }[] {
  const text = `${title || ""} ${preview || ""}`;
  const seen = new Map<string, EntityType>();
  const add = (name: string, type: EntityType) => {
    const k = normKey(name);
    if (!k || k.length < 3) return;
    if (!seen.has(k)) seen.set(k, type);
  };
  for (const p of extractPersons(text)) add(p, "person");
  for (const o of extractOrgs(text)) add(o, "org");
  for (const p of extractPlaces(text)) add(p, "place");
  for (const e of extractEvents(text)) add(e, "event");
  return Array.from(seen.entries()).map(([key, type]) => ({ name: key, type }));
}

// --------- Entity aggregation + knowledge graph ---------

export type ClusterLike = {
  id: string;
  items: { id: string; source: string; title: string; ts: number }[];
  origin: { ts: number };
};

export type ArticleLike = {
  id: string; source: string; title: string; preview?: string; ts: number;
};

function wikiUrlFor(name: string): string {
  const q = encodeURIComponent(name.replace(/\s+/g, "_"));
  return `https://fa.wikipedia.org/wiki/${q}`;
}

export function buildEntityIndex(articles: ArticleLike[], clusterOf: Map<string, string>) {
  const entities = new Map<string, Entity>();
  const articleEntities = new Map<string, string[]>(); // articleId → entityKey[]
  for (const a of articles) {
    const raw = extractEntities(a.title, a.preview || "");
    const keys: string[] = [];
    for (const { name, type } of raw) {
      const key = normKey(name);
      keys.push(key);
      const ex = entities.get(key);
      if (ex) {
        ex.count++;
        ex.sources.add(a.source);
        const cid = clusterOf.get(a.id);
        if (cid) ex.clusters.add(cid);
        if (a.ts < ex.firstTs) ex.firstTs = a.ts;
      } else {
        const cid = clusterOf.get(a.id);
        entities.set(key, {
          key, name, type, count: 1,
          sources: new Set([a.source]),
          clusters: new Set(cid ? [cid] : []),
          firstTs: a.ts, wikiUrl: wikiUrlFor(name),
        });
      }
    }
    articleEntities.set(a.id, keys);
  }
  return { entities, articleEntities };
}

export function buildKnowledgeGraph(
  entities: Map<string, Entity>,
  articleEntities: Map<string, string[]>,
  articles: ArticleLike[],
  clusterOf: Map<string, string>,
): EntityEdge[] {
  const edgeMap = new Map<string, EntityEdge>();
  for (const a of articles) {
    const keys = articleEntities.get(a.id) || [];
    const cid = clusterOf.get(a.id);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const x = keys[i]; const y = keys[j];
        if (x === y) continue;
        const [a1, b1] = x < y ? [x, y] : [y, x];
        const k = `${a1}|${b1}`;
        const e = edgeMap.get(k) || { a: a1, b: b1, weight: 0, coClusters: new Set<string>() };
        e.weight++;
        if (cid) e.coClusters.add(cid);
        edgeMap.set(k, e);
      }
    }
  }
  // prune weakest co-occurrences to keep graph legible
  const all = Array.from(edgeMap.values());
  return all.filter(e => e.weight >= 2).sort((a, b) => b.weight - a.weight);
}

// --------- Narrative Mining ---------
// For each cluster, compute distinctive phrases per source and group
// sources with similar framings via Jaccard on content tokens.

export function mineNarratives(
  clusters: ClusterLike[],
  articles: ArticleLike[],
): Narrative[] {
  const byId = new Map(articles.map(a => [a.id, a]));
  const result: Narrative[] = [];

  for (const c of clusters) {
    if (c.items.length < 2) continue;

    // global term frequency inside cluster
    const clusterTf = new Map<string, number>();
    const perItemTokens = new Map<string, Set<string>>();
    for (const it of c.items) {
      const a = byId.get(it.id);
      const toks = cleanTokens(`${a?.title || it.title} ${a?.preview || ""}`);
      const uniq = new Set(toks);
      perItemTokens.set(it.id, uniq);
      for (const t of uniq) clusterTf.set(t, (clusterTf.get(t) || 0) + 1);
    }

    // group items whose token overlap is high (Jaccard >= 0.35)
    const groups: { itemIds: string[]; tokens: Set<string> }[] = [];
    for (const it of c.items) {
      const mine = perItemTokens.get(it.id)!;
      let best = -1; let bestScore = 0.35;
      for (let g = 0; g < groups.length; g++) {
        const theirs = groups[g].tokens;
        let inter = 0;
        for (const t of mine) if (theirs.has(t)) inter++;
        const union = mine.size + theirs.size - inter;
        const s = union > 0 ? inter / union : 0;
        if (s > bestScore) { bestScore = s; best = g; }
      }
      if (best === -1) {
        groups.push({ itemIds: [it.id], tokens: new Set(mine) });
      } else {
        groups[best].itemIds.push(it.id);
        for (const t of mine) groups[best].tokens.add(t);
      }
    }

    // keep only groups of 2+ items OR groups with a distinctive label
    groups.forEach((g, idx) => {
      // pick top distinctive terms (frequent in group, rare in rest of cluster)
      const inGroup = new Map<string, number>();
      for (const id of g.itemIds) {
        const toks = perItemTokens.get(id)!;
        for (const t of toks) inGroup.set(t, (inGroup.get(t) || 0) + 1);
      }
      const scored: { term: string; score: number }[] = [];
      for (const [t, tfG] of inGroup) {
        const tfAll = clusterTf.get(t) || 1;
        const outside = tfAll - tfG;
        const score = tfG - outside * 0.5;
        if (score > 0 && t.length >= 3) scored.push({ term: t, score });
      }
      scored.sort((a, b) => b.score - a.score);
      const terms = scored.slice(0, 5).map(x => x.term);
      if (terms.length === 0) return;
      const items = g.itemIds
        .map(id => {
          const it = c.items.find(x => x.id === id)!;
          return { id: it.id, source: it.source, title: it.title };
        });
      const sources = Array.from(new Set(items.map(i => i.source)));
      result.push({
        id: `${c.id}-n${idx}`,
        clusterId: c.id,
        label: terms.slice(0, 3).join(" · "),
        terms, sources, items,
      });
    });
  }

  // sort: most framings with most sources first
  return result.sort((a, b) => b.sources.length - a.sources.length || b.items.length - a.items.length);
}

// --------- Event Chains ---------
// Link clusters temporally if they share entities and occur within 72h.

export function buildEventChains(
  clusters: ClusterLike[],
  articleEntities: Map<string, string[]>,
  maxGapHours = 72,
  minSharedEntities = 2,
): EventLink[] {
  // entities per cluster
  const clusterEnts = new Map<string, Set<string>>();
  const clusterTs = new Map<string, number>();
  for (const c of clusters) {
    const s = new Set<string>();
    for (const it of c.items) {
      const keys = articleEntities.get(it.id) || [];
      for (const k of keys) s.add(k);
    }
    clusterEnts.set(c.id, s);
    clusterTs.set(c.id, c.origin.ts);
  }

  const sorted = [...clusters].sort((a, b) => a.origin.ts - b.origin.ts);
  const links: EventLink[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const A = sorted[i]; const B = sorted[j];
      const gapH = (B.origin.ts - A.origin.ts) / 3600000;
      if (gapH > maxGapHours) break;
      if (gapH < 0.05) continue;
      const ea = clusterEnts.get(A.id)!;
      const eb = clusterEnts.get(B.id)!;
      const shared: string[] = [];
      for (const x of ea) if (eb.has(x)) shared.push(x);
      if (shared.length >= minSharedEntities) {
        links.push({ fromClusterId: A.id, toClusterId: B.id, sharedEntities: shared, gapHours: gapH });
      }
    }
  }
  return links.sort((a, b) => b.sharedEntities.length - a.sharedEntities.length);
}

// --------- Source Influence (agenda-setting) ---------

export type InfluenceRow = {
  id: string;
  name: string;
  icon: string;
  agenda: number;       // 0..1, how often this source's framing is adopted
  originCount: number;
  downstreamWeight: number;
  pagerank: number;
  composite: number;
};

export function computeInfluence(
  nodes: { id: string; name: string; icon: string; pagerank: number; firstCount: number }[],
  edges: { source: string; target: string; weight: number }[],
): InfluenceRow[] {
  const outWeight = new Map<string, number>();
  for (const e of edges) {
    outWeight.set(e.source, (outWeight.get(e.source) || 0) + e.weight);
  }
  const maxFirst = Math.max(1, ...nodes.map(n => n.firstCount));
  const maxDown = Math.max(1, ...Array.from(outWeight.values()));
  const rows: InfluenceRow[] = nodes.map(n => {
    const dw = outWeight.get(n.id) || 0;
    const agenda = (n.firstCount / maxFirst) * 0.6 + (dw / maxDown) * 0.4;
    return {
      id: n.id, name: n.name, icon: n.icon,
      originCount: n.firstCount,
      downstreamWeight: dw,
      pagerank: n.pagerank,
      agenda,
      composite: agenda * 0.6 + n.pagerank * 0.4,
    };
  });
  return rows.filter(r => r.originCount > 0 || r.pagerank > 0).sort((a, b) => b.composite - a.composite);
}

// --------- Echo-chamber Detection ---------
// Merge sources whose neighbor sets overlap heavily and have strong mutual edges.

export function detectEchoChambers(
  nodes: { id: string; name: string }[],
  edges: { source: string; target: string; weight: number }[],
  minJaccard = 0.45,
  minMutualWeight = 2,
): EchoGroup[] {
  // build neighbor map (undirected)
  const neighbors = new Map<string, Map<string, number>>();
  for (const n of nodes) neighbors.set(n.id, new Map());
  for (const e of edges) {
    const a = neighbors.get(e.source); const b = neighbors.get(e.target);
    if (a) a.set(e.target, (a.get(e.target) || 0) + e.weight);
    if (b) b.set(e.source, (b.get(e.source) || 0) + e.weight);
  }

  // union-find for merging
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();
  for (const n of nodes) { parent.set(n.id, n.id); rank.set(n.id, 0); }
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p); parent.set(x, r); return r;
  };
  const union = (x: string, y: string) => {
    const a = find(x); const b = find(y); if (a === b) return;
    const ra = rank.get(a)!, rb = rank.get(b)!;
    if (ra < rb) parent.set(a, b);
    else if (ra > rb) parent.set(b, a);
    else { parent.set(b, a); rank.set(a, ra + 1); }
  };

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const A = nodes[i].id, B = nodes[j].id;
      const na = neighbors.get(A)!; const nb = neighbors.get(B)!;
      if (na.size === 0 || nb.size === 0) continue;
      let inter = 0;
      for (const x of na.keys()) if (nb.has(x)) inter++;
      const un = na.size + nb.size - inter;
      const jac = un > 0 ? inter / un : 0;
      const mutual = (na.get(B) || 0) + (nb.get(A) || 0);
      if (jac >= minJaccard && mutual >= minMutualWeight) union(A, B);
    }
  }

  // group members by root
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const r = find(n.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(n.id);
  }

  const out: EchoGroup[] = [];
  for (const [root, members] of groups) {
    if (members.length < 3) continue;
    const memSet = new Set(members);
    let internal = 0, external = 0;
    for (const e of edges) {
      const a = memSet.has(e.source); const b = memSet.has(e.target);
      if (a && b) internal += e.weight;
      else if (a || b) external += e.weight;
    }
    const cohesion = (internal + external) > 0 ? internal / (internal + external) : 0;
    if (cohesion < 0.55) continue;
    out.push({
      id: `echo-${root}`,
      members,
      cohesion,
      internalWeight: internal,
      externalWeight: external,
    });
  }
  return out.sort((a, b) => b.cohesion - a.cohesion || b.members.length - a.members.length);
}

// ============================================================================
// UPGRADE 1: Patient-Zero & Cascade Tree (ردیاب منشأ و شجره‌نامهٔ انتشار خبر)
// ============================================================================

export type CascadeWave = "origin" | "first5m" | "early30m" | "later";

export type CascadeNode = {
  id: string;
  source: string;
  icon?: string;
  category?: string;
  title: string;
  link?: string;
  ts: number;
  delayMin: number;          // minutes after Patient-Zero
  wave: CascadeWave;
  parentId: string | null;   // ID of the upstream item it most likely propagated from
  parentSource: string | null;
  depth: number;             // 0 for Patient-Zero, 1+ for downstream branches
  headlineSimilarity: number; // 0..1 Jaccard similarity vs. Patient-Zero headline
  mutatedHeadline: boolean;  // true when headline was significantly altered (< 0.65)
  mutationType: "منشأ اولیه" | "تیتر وفادار" | "تغییر زاویه تیتر" | "بازنویسی کامل تیتر";
  addedKeywords: string[];   // new terms introduced in this headline vs. Patient-Zero
};

export type CascadeTreeSummary = {
  clusterId: string;
  patientZero: CascadeNode;
  nodes: CascadeNode[];
  first5mCount: number;
  early30mCount: number;
  laterCount: number;
  mutatedCount: number;
  maxDepth: number;
};

function tokenSetFromHeadline(title: string): Set<string> {
  return new Set(cleanTokens(title));
}

function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export function buildCascadeTree(cluster: {
  id: string;
  items: { id: string; source: string; icon?: string; category?: string; title: string; preview?: string; link?: string; ts: number }[];
}): CascadeTreeSummary | null {
  if (!cluster || !Array.isArray(cluster.items) || cluster.items.length === 0) return null;

  const sorted = [...cluster.items].sort((a, b) => a.ts - b.ts);
  const originItem = sorted[0];
  const originTokens = tokenSetFromHeadline(originItem.title);
  const itemTokens = sorted.map(it => tokenSetFromHeadline(`${it.title} ${it.preview || ""}`));
  const headlineTokens = sorted.map(it => tokenSetFromHeadline(it.title));

  const nodes: CascadeNode[] = [];
  let first5mCount = 0;
  let early30mCount = 0;
  let laterCount = 0;
  let mutatedCount = 0;
  let maxDepth = 0;

  for (let i = 0; i < sorted.length; i++) {
    const it = sorted[i];
    const delayMin = Math.max(0, (it.ts - originItem.ts) / 60000);

    if (i === 0) {
      nodes.push({
        id: it.id,
        source: it.source,
        icon: it.icon,
        category: it.category,
        title: it.title,
        link: it.link,
        ts: it.ts,
        delayMin: 0,
        wave: "origin",
        parentId: null,
        parentSource: null,
        depth: 0,
        headlineSimilarity: 1,
        mutatedHeadline: false,
        mutationType: "منشأ اولیه",
        addedKeywords: [],
      });
      continue;
    }

    const wave: CascadeWave =
      delayMin <= 5 ? "first5m" : delayMin <= 30 ? "early30m" : "later";
    if (wave === "first5m") first5mCount++;
    else if (wave === "early30m") early30mCount++;
    else laterCount++;

    // Find best upstream parent (earliest or most similar preceding item from a different source)
    let bestParentIdx = 0;
    let bestParentSim = -1;
    for (let j = 0; j < i; j++) {
      if (sorted[j].source === it.source) continue;
      const sim = jaccardSets(itemTokens[i], itemTokens[j]);
      // Slight preference for higher similarity and closer timestamp
      const timeFactor = Math.max(0.7, 1 - (it.ts - sorted[j].ts) / (3600000 * 6));
      const score = sim * timeFactor;
      if (score > bestParentSim) {
        bestParentSim = score;
        bestParentIdx = j;
      }
    }

    const parentNode = nodes[bestParentIdx] || nodes[0];
    const depth = Math.min(6, parentNode.depth + 1);
    if (depth > maxDepth) maxDepth = depth;

    const hSim = jaccardSets(headlineTokens[i], originTokens);
    const mutatedHeadline = hSim < 0.65;
    if (mutatedHeadline) mutatedCount++;

    const mutationType: CascadeNode["mutationType"] =
      hSim >= 0.65
        ? "تیتر وفادار"
        : hSim >= 0.32
          ? "تغییر زاویه تیتر"
          : "بازنویسی کامل تیتر";

    const addedKeywords: string[] = [];
    for (const tk of headlineTokens[i]) {
      if (!originTokens.has(tk) && tk.length >= 3) {
        addedKeywords.push(tk);
        if (addedKeywords.length >= 4) break;
      }
    }

    nodes.push({
      id: it.id,
      source: it.source,
      icon: it.icon,
      category: it.category,
      title: it.title,
      link: it.link,
      ts: it.ts,
      delayMin,
      wave,
      parentId: parentNode.id,
      parentSource: parentNode.source,
      depth,
      headlineSimilarity: hSim,
      mutatedHeadline,
      mutationType,
      addedKeywords,
    });
  }

  return {
    clusterId: cluster.id,
    patientZero: nodes[0],
    nodes,
    first5mCount,
    early30mCount,
    laterCount,
    mutatedCount,
    maxDepth,
  };
}

// ============================================================================
// UPGRADE 2: Advanced Centrality Metrics (Betweenness & Lead-Lag Score)
// ============================================================================

export type CentralityNodeMetric = {
  id: string;
  name: string;
  icon: string;
  category: string;
  pagerank: number;
  betweenness: number;      // 0..1 normalized bridge score (Brandes + cross-pole bridging)
  leadLagMin: number;       // negative = ahead of median (leader), positive = behind median (follower)
  avgDelayFromOriginMin: number;
  first5mCount: number;     // number of clusters where this source published within 5 min of Patient-Zero
  clusterCount: number;
  pole: "domestic" | "international";
  role: "پیشتاز خبرساز" | "پل ارتباطی" | "تثبیت‌کننده جریان" | "بازنشرکننده";
};

export function classifyPole(category?: string, sourceName?: string, title?: string): "domestic" | "international" {
  const cat = String(category || "");
  if (cat.includes("بین‌الملل")) return "international";
  if (cat.includes("داخلی")) return "domestic";
  const s = `${sourceName || ""} ${title || ""}`;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const persian = (s.match(/[\u0600-\u06FF]/g) || []).length;
  return latin > persian ? "international" : "domestic";
}

export function computeAdvancedCentrality(
  nodes: { id: string; name: string; icon: string; category: string; pagerank: number; firstCount: number }[],
  edges: { source: string; target: string; weight: number }[],
  clusters: { id: string; origin: { source: string; ts: number }; items: { source: string; ts: number }[] }[],
): CentralityNodeMetric[] {
  const n = nodes.length;
  if (n === 0) return [];

  const poleOf = new Map<string, "domestic" | "international">();
  for (const nd of nodes) {
    poleOf.set(nd.id, classifyPole(nd.category, nd.name));
  }

  // 1) Unweighted Brandes shortest-path betweenness centrality on undirected adjacency
  const adj = new Map<string, Set<string>>();
  const crossPoleWeight = new Map<string, number>();
  for (const nd of nodes) {
    adj.set(nd.id, new Set());
    crossPoleWeight.set(nd.id, 0);
  }
  for (const e of edges) {
    const u = typeof e.source === "object" ? (e.source as any).id : e.source;
    const v = typeof e.target === "object" ? (e.target as any).id : e.target;
    if (!adj.has(u) || !adj.has(v) || u === v) continue;
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
    if (poleOf.get(u) !== poleOf.get(v)) {
      crossPoleWeight.set(u, (crossPoleWeight.get(u) || 0) + e.weight);
      crossPoleWeight.set(v, (crossPoleWeight.get(v) || 0) + e.weight);
    }
  }

  const cb = new Map<string, number>();
  for (const nd of nodes) cb.set(nd.id, 0);

  for (const sNode of nodes) {
    const s = sNode.id;
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();
    for (const nd of nodes) {
      pred.set(nd.id, []);
      sigma.set(nd.id, 0);
      dist.set(nd.id, -1);
    }
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue: string[] = [s];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      const dv = dist.get(v)!;
      for (const w of adj.get(v) || []) {
        if (dist.get(w)! < 0) {
          queue.push(w);
          dist.set(w, dv + 1);
        }
        if (dist.get(w) === dv + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }

    const delta = new Map<string, number>();
    for (const nd of nodes) delta.set(nd.id, 0);
    while (stack.length > 0) {
      const w = stack.pop()!;
      const sw = sigma.get(w) || 1;
      for (const v of pred.get(w) || []) {
        const c = (sigma.get(v)! / sw) * (1 + delta.get(w)!);
        delta.set(v, delta.get(v)! + c);
      }
      if (w !== s) {
        cb.set(w, cb.get(w)! + delta.get(w)!);
      }
    }
  }

  const maxCb = Math.max(1e-6, ...Array.from(cb.values()));
  const maxCross = Math.max(1, ...Array.from(crossPoleWeight.values()));

  // 2) Lead-Lag score (minutes relative to cluster median timestamp)
  const leadDeltas = new Map<string, number[]>();
  const originDelays = new Map<string, number[]>();
  const first5mCounts = new Map<string, number>();
  for (const nd of nodes) {
    leadDeltas.set(nd.id, []);
    originDelays.set(nd.id, []);
    first5mCounts.set(nd.id, 0);
  }

  for (const c of clusters) {
    if (!c.items || c.items.length < 2) continue;
    // Earliest timestamp per source in this cluster
    const earliestBySource = new Map<string, number>();
    for (const it of c.items) {
      const prev = earliestBySource.get(it.source);
      if (prev === undefined || it.ts < prev) earliestBySource.set(it.source, it.ts);
    }
    const tsValues = Array.from(earliestBySource.values()).sort((a, b) => a - b);
    const midIdx = Math.floor(tsValues.length / 2);
    const medianTs =
      tsValues.length % 2 === 1
        ? tsValues[midIdx]
        : (tsValues[midIdx - 1] + tsValues[midIdx]) / 2;

    for (const [src, ts] of earliestBySource.entries()) {
      if (!leadDeltas.has(src)) continue;
      const deltaMedianMin = (ts - medianTs) / 60000;
      const delayOriginMin = Math.max(0, (ts - c.origin.ts) / 60000);
      leadDeltas.get(src)!.push(deltaMedianMin);
      originDelays.get(src)!.push(delayOriginMin);
      if (delayOriginMin <= 5) {
        first5mCounts.set(src, (first5mCounts.get(src) || 0) + 1);
      }
    }
  }

  return nodes.map(nd => {
    const rawBetweenness = (cb.get(nd.id) || 0) / maxCb;
    const crossBridge = (crossPoleWeight.get(nd.id) || 0) / maxCross;
    const betweenness = Math.min(1, rawBetweenness * 0.65 + crossBridge * 0.35);

    const deltas = leadDeltas.get(nd.id) || [];
    const oDelays = originDelays.get(nd.id) || [];
    const leadLagMin =
      deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const avgDelayFromOriginMin =
      oDelays.length > 0 ? oDelays.reduce((a, b) => a + b, 0) / oDelays.length : 0;
    const first5mCount = first5mCounts.get(nd.id) || 0;

    let role: CentralityNodeMetric["role"] = "بازنشرکننده";
    if (leadLagMin < -2 || nd.firstCount >= 2) role = "پیشتاز خبرساز";
    else if (betweenness >= 0.45) role = "پل ارتباطی";
    else if (nd.pagerank >= 0.4) role = "تثبیت‌کننده جریان";

    return {
      id: nd.id,
      name: nd.name,
      icon: nd.icon,
      category: nd.category,
      pagerank: nd.pagerank,
      betweenness,
      leadLagMin,
      avgDelayFromOriginMin,
      first5mCount,
      clusterCount: deltas.length,
      pole: poleOf.get(nd.id) || "domestic",
      role,
    };
  });
}

// ============================================================================
// UPGRADE 3: Coordinated Inauthentic Behavior / Syndication Detector
// ============================================================================

export type SyndicationPair = {
  sourceA: string;
  sourceB: string;
  titleA: string;
  titleB: string;
  deltaSec: number;
  similarity: number; // 0..1
  ts: number;
};

export type SyndicationGroup = {
  id: string;
  sources: string[];
  pairCount: number;
  avgDeltaSec: number;
  maxSimilarity: number;
  strictMatch: boolean; // true if <= 2 min and >= 0.85 similarity
  sampleTitle: string;
  pairs: SyndicationPair[];
};

function charShingles(s: string, k = 4): Set<string> {
  const clean = normKey(s).replace(/\s+/g, " ");
  const out = new Set<string>();
  for (let i = 0; i <= clean.length - k; i++) {
    out.add(clean.slice(i, i + k));
  }
  if (out.size === 0 && clean) out.add(clean);
  return out;
}

export function computeTextSimilarity(aTitle: string, aPreview: string, bTitle: string, bPreview: string): number {
  const tokA = tokenSetFromHeadline(`${aTitle} ${aPreview || ""}`);
  const tokB = tokenSetFromHeadline(`${bTitle} ${bPreview || ""}`);
  const titleTokA = tokenSetFromHeadline(aTitle);
  const titleTokB = tokenSetFromHeadline(bTitle);
  const charA = charShingles(aTitle, 4);
  const charB = charShingles(bTitle, 4);

  const s1 = jaccardSets(titleTokA, titleTokB);
  const s2 = jaccardSets(tokA, tokB);
  const s3 = jaccardSets(charA, charB);
  return Math.max(s1, s2, s3);
}

export function detectCoordinatedSyndication(
  items: { id: string; source: string; title: string; preview?: string; ts: number }[],
  maxWindowMin = 2,
  minSimilarity = 0.85,
): SyndicationGroup[] {
  if (!Array.isArray(items) || items.length < 2) return [];

  const sorted = [...items].sort((a, b) => a.ts - b.ts);
  const maxWindowMs = maxWindowMin * 60 * 1000;

  const findPairs = (winMs: number, simThresh: number): SyndicationPair[] => {
    const found: SyndicationPair[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const A = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const B = sorted[j];
        const diffMs = B.ts - A.ts;
        if (diffMs > winMs) break;
        if (A.source === B.source) continue;
        const sim = computeTextSimilarity(A.title, A.preview || "", B.title, B.preview || "");
        if (sim >= simThresh) {
          found.push({
            sourceA: A.source,
            sourceB: B.source,
            titleA: A.title,
            titleB: B.title,
            deltaSec: Math.round(diffMs / 1000),
            similarity: sim,
            ts: A.ts,
          });
        }
      }
    }
    return found;
  };

  let pairs = findPairs(maxWindowMs, minSimilarity);
  let strictMatch = true;

  // If no ultra-strict (<=2m & >=85%) match in current live window, also surface near-synchronous syndication (<=10m & >=55%)
  if (pairs.length === 0) {
    pairs = findPairs(Math.max(maxWindowMs, 10 * 60 * 1000), Math.min(minSimilarity, 0.55));
    strictMatch = false;
  }

  if (pairs.length === 0) return [];

  // Group connected sources via Union-Find
  const parent = new Map<string, string>();
  const ensure = (s: string) => {
    if (!parent.has(s)) parent.set(s, s);
  };
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const unite = (a: string, b: string) => {
    ensure(a);
    ensure(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const p of pairs) unite(p.sourceA, p.sourceB);

  const groupedPairs = new Map<string, SyndicationPair[]>();
  for (const p of pairs) {
    const root = find(p.sourceA);
    if (!groupedPairs.has(root)) groupedPairs.set(root, []);
    groupedPairs.get(root)!.push(p);
  }

  const groups: SyndicationGroup[] = [];
  let idx = 0;
  for (const [, gPairs] of groupedPairs.entries()) {
    const srcSet = new Set<string>();
    let sumDelta = 0;
    let maxSim = 0;
    for (const p of gPairs) {
      srcSet.add(p.sourceA);
      srcSet.add(p.sourceB);
      sumDelta += p.deltaSec;
      if (p.similarity > maxSim) maxSim = p.similarity;
    }
    groups.push({
      id: `syn-${idx++}`,
      sources: Array.from(srcSet),
      pairCount: gPairs.length,
      avgDeltaSec: Math.round(sumDelta / gPairs.length),
      maxSimilarity: maxSim,
      strictMatch: strictMatch && maxSim >= minSimilarity,
      sampleTitle: gPairs[0].titleA,
      pairs: gPairs.sort((a, b) => b.similarity - a.similarity).slice(0, 8),
    });
  }

  return groups.sort((a, b) => b.maxSimilarity - a.maxSimilarity || a.avgDeltaSec - b.avgDeltaSec);
}

// ============================================================================
// UPGRADE 4: Coverage Blindspot & Asymmetry Analyzer
// ============================================================================

export type BlindspotEntry = {
  clusterId: string;
  title: string;
  originSource: string;
  domesticCount: number;
  intlCount: number;
  totalCount: number;
  domesticShare: number;   // 0..1
  intlShare: number;       // 0..1
  asymmetryScore: number;  // -1 (100% domestic) to +1 (100% international)
  blindspotType: "blindspot_intl" | "blindspot_domestic" | "cross_covered";
  blindspotLabel: string;
  domesticSources: string[];
  intlSources: string[];
};

export type BlindspotReport = {
  entries: BlindspotEntry[];
  domesticOnlyCount: number;
  intlOnlyCount: number;
  crossCoveredCount: number;
  totalDomesticArticles: number;
  totalIntlArticles: number;
};

export function analyzeCoverageBlindspots(
  clusters: {
    id: string;
    origin: { source: string; title: string; ts: number };
    items: { id: string; source: string; category?: string; title: string; ts: number }[];
  }[],
): BlindspotReport {
  let totalDomesticArticles = 0;
  let totalIntlArticles = 0;
  let domesticOnlyCount = 0;
  let intlOnlyCount = 0;
  let crossCoveredCount = 0;

  const entries: BlindspotEntry[] = [];

  for (const c of clusters) {
    const domSources = new Set<string>();
    const intlSources = new Set<string>();
    let domCount = 0;
    let intlCount = 0;

    for (const it of c.items) {
      const pole = classifyPole(it.category, it.source, it.title);
      if (pole === "international") {
        intlCount++;
        totalIntlArticles++;
        intlSources.add(it.source);
      } else {
        domCount++;
        totalDomesticArticles++;
        domSources.add(it.source);
      }
    }

    const total = Math.max(1, domCount + intlCount);
    const domesticShare = domCount / total;
    const intlShare = intlCount / total;
    const asymmetryScore = (intlCount - domCount) / total;

    let blindspotType: BlindspotEntry["blindspotType"] = "cross_covered";
    let blindspotLabel = "پوشش مشترک دو قطب";
    if (domesticShare >= 0.8) {
      blindspotType = "blindspot_intl";
      blindspotLabel = "نقطهٔ کور رسانه‌های بین‌المللی";
      domesticOnlyCount++;
    } else if (intlShare >= 0.8) {
      blindspotType = "blindspot_domestic";
      blindspotLabel = "نقطهٔ کور رسانه‌های داخلی";
      intlOnlyCount++;
    } else {
      crossCoveredCount++;
    }

    entries.push({
      clusterId: c.id,
      title: c.origin.title,
      originSource: c.origin.source,
      domesticCount: domCount,
      intlCount,
      totalCount: total,
      domesticShare,
      intlShare,
      asymmetryScore,
      blindspotType,
      blindspotLabel,
      domesticSources: Array.from(domSources),
      intlSources: Array.from(intlSources),
    });
  }

  entries.sort((a, b) => b.totalCount - a.totalCount);

  return {
    entries,
    domesticOnlyCount,
    intlOnlyCount,
    crossCoveredCount,
    totalDomesticArticles,
    totalIntlArticles,
  };
}

// ============================================================================
// UPGRADE 5: Local Deterministic Narrative Divergence Preview / Fallback
// ============================================================================

export type NarrativeDivergenceResult = {
  summary: string;
  agreedFacts: string[];
  framingDifferences: { side: string; sources: string[]; framing: string; tone: string }[];
  loadedVocabulary: { term: string; usedBy: string; connotation: string }[];
};

export function computeLocalNarrativeDivergence(cluster: {
  id: string;
  origin: { title: string; source: string };
  items: { id: string; source: string; category?: string; title: string; preview?: string }[];
}): NarrativeDivergenceResult {
  const domItems = cluster.items.filter(it => classifyPole(it.category, it.source, it.title) === "domestic");
  const intlItems = cluster.items.filter(it => classifyPole(it.category, it.source, it.title) === "international");

  // Extract shared tokens across items as agreed facts
  const docFreq = new Map<string, number>();
  for (const it of cluster.items) {
    const uniq = new Set(cleanTokens(`${it.title} ${it.preview || ""}`));
    for (const tk of uniq) docFreq.set(tk, (docFreq.get(tk) || 0) + 1);
  }
  const sharedTerms = Array.from(docFreq.entries())
    .filter(([, c]) => c >= Math.max(2, Math.ceil(cluster.items.length * 0.4)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t]) => t);

  const agreedFacts = [
    `محور اصلی خبر: «${cluster.origin.title}» که نخستین بار توسط «${cluster.origin.source}» منتشر شد.`,
    `پوشش هم‌زمان توسط ${cluster.items.length} رسانه (${domItems.length} منبع داخلی و ${intlItems.length} منبع بین‌المللی).`,
    sharedTerms.length > 0
      ? `کلیدواژه‌ها و فکت‌های مشترک در تمامی گزارش‌ها: ${sharedTerms.join("، ")}.`
      : "اشتراک در گزارش اصل وقوع رویداد و زمان‌بندی اولیه خبر.",
  ];

  const framingDifferences: NarrativeDivergenceResult["framingDifferences"] = [];
  if (domItems.length > 0) {
    framingDifferences.push({
      side: "رسانه‌های داخلی",
      sources: Array.from(new Set(domItems.map(i => i.source))).slice(0, 5),
      framing: domItems[0].title,
      tone: "تمرکز بر ابعاد اجرایی، مواضع رسمی و بازتاب داخلی رویداد",
    });
  }
  if (intlItems.length > 0) {
    framingDifferences.push({
      side: "رسانه‌های بین‌المللی",
      sources: Array.from(new Set(intlItems.map(i => i.source))).slice(0, 5),
      framing: intlItems[0].title,
      tone: "تمرکز بر پیامدهای ژئوپولیتیک، واکنش‌های دیپلماتیک و زمینهٔ منطقه‌ای",
    });
  }
  if (framingDifferences.length < 2 && cluster.items.length >= 2) {
    framingDifferences.push({
      side: `روایت بازنشرکنندگان (${cluster.items[cluster.items.length - 1].source})`,
      sources: Array.from(new Set(cluster.items.slice(1).map(i => i.source))).slice(0, 5),
      framing: cluster.items[cluster.items.length - 1].title,
      tone: "بازنمایی ثانویه با برجسته‌سازی بخش خاصی از تیتر اولیه",
    });
  }

  // Distinctive terms per side
  const domFreq = new Map<string, number>();
  const intlFreq = new Map<string, number>();
  for (const it of domItems) {
    for (const tk of cleanTokens(it.title)) if (tk.length >= 3) domFreq.set(tk, (domFreq.get(tk) || 0) + 1);
  }
  for (const it of intlItems) {
    for (const tk of cleanTokens(it.title)) if (tk.length >= 3) intlFreq.set(tk, (intlFreq.get(tk) || 0) + 1);
  }

  const loadedVocabulary: NarrativeDivergenceResult["loadedVocabulary"] = [];
  for (const [tk, cnt] of Array.from(domFreq.entries()).sort((a, b) => b[1] - a[1])) {
    if (!intlFreq.has(tk) && loadedVocabulary.length < 3) {
      loadedVocabulary.push({
        term: tk,
        usedBy: "رسانه‌های داخلی",
        connotation: `تکرار در ${cnt} تیتر داخلی برای برجسته‌سازی زاویهٔ بومی`,
      });
    }
  }
  for (const [tk, cnt] of Array.from(intlFreq.entries()).sort((a, b) => b[1] - a[1])) {
    if (!domFreq.has(tk) && loadedVocabulary.length < 6) {
      loadedVocabulary.push({
        term: tk,
        usedBy: "رسانه‌های بین‌المللی",
        connotation: `تکرار در ${cnt} تیتر بین‌المللی برای قاب‌بندی خارجی خبر`,
      });
    }
  }
  if (loadedVocabulary.length === 0) {
    for (const tk of sharedTerms.slice(0, 3)) {
      loadedVocabulary.push({
        term: tk,
        usedBy: "مشترک در خوشه",
        connotation: "واژهٔ کانونی در تیترهای منتشرشده",
      });
    }
  }

  return {
    summary:
      domItems.length > 0 && intlItems.length > 0
        ? `این رویداد هم در رسانه‌های داخلی (${domItems.length} گزارش) و هم در رسانه‌های بین‌المللی (${intlItems.length} گزارش) بازتاب یافته و در نحوهٔ تیترزنی و زاویهٔ دید تفاوت قاب‌بندی مشاهده می‌شود.`
        : `این خوشهٔ خبری توسط ${cluster.items.length} منبع پوشش داده شده و مقایسهٔ تیترها نشان‌دهندهٔ تفاوت در انتخاب کلیدواژه‌های کانونی است.`,
    agreedFacts,
    framingDifferences,
    loadedVocabulary,
  };
}

// ─────────────── 6. TIME-TRAVEL CLUSTER GROWTH & DECAY LIFECYCLE ───────────────
export type ClusterPhase = "growing" | "peaking" | "decaying";

export type TemporalHourBucket = {
  hourIndex: number;
  tsStart: number;
  tsEnd: number;
  articleCount: number;
  growingCount: number;
  peakingCount: number;
  decayingCount: number;
};

export type ClusterLifecycleEntry = {
  id: string;
  phase: ClusterPhase;
  phaseLabel: string;
  /** 0.25 (faded/decayed) .. 1.35 (actively peaking) */
  intensity: number;
  /** Number of items published up to cursorTs */
  visibleCount: number;
  /** Number of items published within the active 3h momentum window before cursorTs */
  recentCount: number;
  ageHours: number;
  idleHours: number;
};

export type TemporalLifecycleSummary = {
  cursorTs: number;
  windowHours: number;
  buckets: TemporalHourBucket[];
  clusters: ClusterLifecycleEntry[];
  growingCount: number;
  peakingCount: number;
  decayingCount: number;
  nodeMultipliers: Record<string, { phase: ClusterPhase; scale: number; alpha: number }>;
};

export function computeTemporalLifecycle(
  allItems: { id?: string; source: string; ts: number }[],
  allClusters: { id: string; items: { source: string; ts: number }[] }[],
  nowTs: number,
  windowHours = 24,
  cursorHour = windowHours,
): TemporalLifecycleSummary {
  const safeWindow = Math.max(1, Math.min(168, Math.round(windowHours)));
  const clampedHour = Math.max(0, Math.min(safeWindow, cursorHour));
  const startTs = nowTs - safeWindow * 3600000;
  const cursorTs = startTs + clampedHour * 3600000;
  const ACTIVE_WINDOW_MS = 3 * 3600000; // 3 hours momentum window

  const evaluateClusterAt = (
    c: { id: string; items: { source: string; ts: number }[] },
    atTs: number,
  ): ClusterLifecycleEntry | null => {
    const visible = c.items.filter(it => it.ts >= startTs && it.ts <= atTs);
    if (visible.length < 2) return null;
    const sorted = [...visible].sort((a, b) => a.ts - b.ts);
    const firstTs = sorted[0].ts;
    const lastTs = sorted[sorted.length - 1].ts;
    const ageHours = Math.max(0, (atTs - firstTs) / 3600000);
    const idleHours = Math.max(0, (atTs - lastTs) / 3600000);
    const recentCount = visible.filter(it => atTs - it.ts <= ACTIVE_WINDOW_MS).length;

    let phase: ClusterPhase = "growing";
    let phaseLabel = "در حال شکل‌گیری";
    let intensity = 1.0;

    if (idleHours > 3 && recentCount === 0) {
      phase = "decaying";
      phaseLabel = "در حال فروکش";
      // Smooth exponential-like decay from 0.85 down to 0.3
      intensity = Math.max(0.3, Number((0.9 - Math.min(0.6, (idleHours - 3) * 0.05)).toFixed(2)));
    } else if (recentCount >= 3 || (visible.length >= 3 && idleHours <= 1.5)) {
      phase = "peaking";
      phaseLabel = "در اوج انتشار";
      intensity = Math.min(1.35, Number((1.05 + recentCount * 0.06).toFixed(2)));
    } else {
      phase = "growing";
      phaseLabel = "در حال رشد";
      intensity = Math.min(1.2, Number((0.9 + recentCount * 0.08).toFixed(2)));
    }

    return {
      id: c.id,
      phase,
      phaseLabel,
      intensity,
      visibleCount: visible.length,
      recentCount,
      ageHours: Number(ageHours.toFixed(1)),
      idleHours: Number(idleHours.toFixed(1)),
    };
  };

  // Build hourly buckets across the window
  const buckets: TemporalHourBucket[] = [];
  for (let h = 0; h < safeWindow; h++) {
    const bStart = startTs + h * 3600000;
    const bEnd = bStart + 3600000;
    let articleCount = 0;
    for (const it of allItems) {
      if (it.ts >= bStart && it.ts < bEnd) articleCount++;
    }
    let growingCount = 0;
    let peakingCount = 0;
    let decayingCount = 0;
    for (const c of allClusters) {
      const st = evaluateClusterAt(c, bEnd);
      if (!st) continue;
      if (st.phase === "growing") growingCount++;
      else if (st.phase === "peaking") peakingCount++;
      else decayingCount++;
    }
    buckets.push({
      hourIndex: h,
      tsStart: bStart,
      tsEnd: bEnd,
      articleCount,
      growingCount,
      peakingCount,
      decayingCount,
    });
  }

  // Evaluate clusters at cursorTs
  const clusters: ClusterLifecycleEntry[] = [];
  let growingCount = 0;
  let peakingCount = 0;
  let decayingCount = 0;

  const nodeBestPhase = new Map<string, { phase: ClusterPhase; scale: number; alpha: number }>();
  const phaseRank: Record<ClusterPhase, number> = { peaking: 3, growing: 2, decaying: 1 };

  for (const c of allClusters) {
    const st = evaluateClusterAt(c, cursorTs);
    if (!st) continue;
    clusters.push(st);
    if (st.phase === "growing") growingCount++;
    else if (st.phase === "peaking") peakingCount++;
    else decayingCount++;

    for (const it of c.items) {
      if (it.ts < startTs || it.ts > cursorTs) continue;
      const prev = nodeBestPhase.get(it.source);
      const scale = st.phase === "peaking" ? 1.22 : st.phase === "growing" ? 1.08 : 0.78;
      const alpha = st.phase === "decaying" ? Math.max(0.4, st.intensity) : 1;
      if (!prev || phaseRank[st.phase] > phaseRank[prev.phase]) {
        nodeBestPhase.set(it.source, { phase: st.phase, scale, alpha });
      }
    }
  }

  const nodeMultipliers: Record<string, { phase: ClusterPhase; scale: number; alpha: number }> = {};
  for (const [src, val] of nodeBestPhase.entries()) {
    nodeMultipliers[src] = val;
  }

  return {
    cursorTs,
    windowHours: safeWindow,
    buckets,
    clusters,
    growingCount,
    peakingCount,
    decayingCount,
    nodeMultipliers,
  };
}


