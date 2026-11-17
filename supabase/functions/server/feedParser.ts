import { XMLParser } from "fast-xml-parser";
import { franc } from "franc";

export type ParsedFeedItem = {
  id: string;
  feedId: string;
  title: string;
  link: string;
  source: string;
  author: string;
  date: string;
  preview: string;
  content: string;
  image?: string;
  lang: "fa" | "ar" | "other";
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  htmlEntities: true,
});

export function stripHtml(html: string): string {
  if (!html) return "";
  return String(html)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&zwnj;/gi, "‌")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function getText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const t = getText(item);
      if (t) return t;
    }
    return "";
  }
  if (typeof v === "object") {
    return String(v["#text"] ?? v["__cdata"] ?? v["@_href"] ?? v["@_url"] ?? "").trim();
  }
  return String(v).trim();
}

export function extractLink(linkVal: any, guidVal?: any): string {
  if (typeof linkVal === "string" && linkVal.trim()) {
    return linkVal.trim();
  }
  if (Array.isArray(linkVal)) {
    const alt = linkVal.find(
      (l: any) =>
        l &&
        typeof l === "object" &&
        (!l["@_rel"] || l["@_rel"] === "alternate") &&
        (l["@_href"] || l["#text"]),
    );
    if (alt) return String(alt["@_href"] || alt["#text"]).trim();
    for (const l of linkVal) {
      const href = typeof l === "string" ? l : l?.["@_href"] || l?.["#text"];
      if (href && String(href).trim()) return String(href).trim();
    }
  } else if (linkVal && typeof linkVal === "object") {
    const href = linkVal["@_href"] || linkVal["#text"] || linkVal.href || linkVal.url;
    if (href && String(href).trim()) return String(href).trim();
  }
  const guid = getText(guidVal);
  if (/^https?:\/\//i.test(guid)) return guid;
  return "";
}

export function extractImage(item: any): string | undefined {
  if (!item || typeof item !== "object") return undefined;

  const pickUrl = (node: any): string | undefined => {
    if (!node) return undefined;
    if (typeof node === "string" && /^https?:\/\//i.test(node)) return node;
    if (Array.isArray(node)) {
      for (const n of node) {
        const u = pickUrl(n);
        if (u) return u;
      }
      return undefined;
    }
    if (typeof node === "object") {
      const u = node["@_url"] || node["@_href"] || node.url || node["#text"];
      if (typeof u === "string" && /^https?:\/\//i.test(u.trim())) return u.trim();
    }
    return undefined;
  };

  const mediaContent = pickUrl(item["media:content"]);
  if (mediaContent) return mediaContent;

  const mediaThumb = pickUrl(item["media:thumbnail"]);
  if (mediaThumb) return mediaThumb;

  const mediaGroup = item["media:group"];
  if (mediaGroup) {
    const gUrl = pickUrl(mediaGroup["media:content"]) || pickUrl(mediaGroup["media:thumbnail"]);
    if (gUrl) return gUrl;
  }

  const enclosure = pickUrl(item.enclosure);
  if (enclosure) return enclosure;

  const itunesImg = pickUrl(item["itunes:image"]) || pickUrl(item.image);
  if (itunesImg) return itunesImg;

  const html =
    getText(item["content:encoded"]) ||
    getText(item.content) ||
    getText(item.description) ||
    getText(item.summary) ||
    "";
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match?.[1] && /^https?:\/\//i.test(match[1].trim())) {
    return match[1].trim();
  }
  return undefined;
}

export function safeDateMs(dateStr: any, fallback = 0): number {
  if (!dateStr) return fallback;
  if (typeof dateStr === "number") return Number.isFinite(dateStr) ? dateStr : fallback;
  const s = String(dateStr)
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .trim();
  if (!s) return fallback;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : fallback;
}

export function normalizeDateIso(dateStr: any): string {
  const s = getText(dateStr);
  if (!s) return new Date().toISOString();
  const ms = safeDateMs(s, 0);
  if (ms > 0) return new Date(ms).toISOString();
  return new Date().toISOString();
}

export function normalizeFa(s: string): string {
  return String(s || "")
    .replace(/[ً-ْٰٕٖٜٓ-ٟۖ-ۜ۟-ۤۧۨ-ۭ]/g, "")
    .replace(/‌/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ۀ/g, "ه")
    .replace(/ة/g, "ه")
    .replace(/[أإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ی")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
}

export function detectLang(s: string): "fa" | "ar" | "other" {
  const t = String(s || "");
  if (!t.trim()) return "fa";
  const persianSpecific = /[پچژگکی]/;
  const arabicScript = (t.match(/[؀-ۿ]/g) || []).length;
  const latin = (t.match(/[A-Za-zЀ-ӿͰ-Ͽ]/g) || []).length;
  if (arabicScript >= latin && arabicScript > 0) {
    return persianSpecific.test(t) ? "fa" : "ar";
  }
  if (latin === 0) return "fa";
  try {
    const code = franc(t, { minLength: 10 });
    if (code === "pes" || code === "fas") return "fa";
    if (code === "arb") return "ar";
  } catch {
    // ignore franc errors
  }
  return "other";
}

export function contentSig(title: string, link: string): string {
  const canonLink = String(link || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (canonLink) return "l:" + canonLink;
  const t = normalizeFa(String(title || "").toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return "t:" + t.slice(0, 90);
}

const HOST_TO_DOMAIN: Record<string, string> = {
  "feeds.content.dowjones.io": "wsj.com",
  "feeds.bbci.co.uk": "bbc.com",
  "moxie.foxnews.com": "foxnews.com",
  "feeds.skynews.com": "news.sky.com",
  "feeds.abcnews.com": "abcnews.go.com",
  "feeds.nbcnews.com": "nbcnews.com",
  "feeds.npr.org": "npr.org",
  "feeds.washingtonpost.com": "washingtonpost.com",
  "rss.nytimes.com": "nytimes.com",
  "rss.politico.com": "politico.com",
  "rss.upi.com": "upi.com",
  "rss.cnn.com": "cnn.com",
  "rss.dw.com": "dw.com",
};

const PERSIAN_BRANDS = new Set([
  "tasnimnews",
  "mehrnews",
  "khabaronline",
  "asriran",
  "entekhab",
  "fararu",
  "tabnak",
  "hamshahrionline",
  "mashreghnews",
  "eghtesadonline",
  "donya-e-eqtesad",
  "varzesh3",
  "zoomit",
  "digiato",
  "radiofarda",
  "shafaqna",
  "hawzahnews",
  "salamatnews",
  "tarafdari",
  "khabarvarzeshi",
  "ensafnews",
  "rouydad24",
  "arzdigital",
  "energypress",
  "jamaran",
  "poollnews",
  "noandish",
  "mizanonline",
  "qudsonline",
]);

export function buildGoogleNewsFallbackUrls(feedUrl: string): string[] {
  try {
    const u = new URL(feedUrl);
    const host = u.hostname.toLowerCase();
    if (!host || host.includes("news.google.com")) return [];
    const domain =
      HOST_TO_DOMAIN[host] ||
      host.replace(/^(www|feeds|rss|m|en|fa|ar|parsi|api|syndication|xml)\./i, "");
    const brand = domain.split(".")[0] || domain;
    const isPersian =
      domain.endsWith(".ir") ||
      /persian|farsi|parsi|\/fa(\/|$)/i.test(feedUrl) ||
      PERSIAN_BRANDS.has(brand);
    const locale = isPersian ? "hl=fa&gl=IR&ceid=IR:fa" : "hl=en-US&gl=US&ceid=US:en";
    return [
      `https://news.google.com/rss/search?q=site:${encodeURIComponent(domain)}&${locale}`,
      `https://news.google.com/rss/search?q=${encodeURIComponent(brand)}&${locale}`,
    ];
  } catch {
    return [];
  }
}

export function parseFeedXml(xml: string, fallbackUrl: string, feedId: string): ParsedFeedItem[] {
  const trimmed = String(xml || "").trim();
  if (!trimmed) throw new Error("empty feed response");

  const parsed = xmlParser.parse(trimmed);
  const rssChannel = parsed?.rss?.channel;
  const atomFeed = parsed?.feed;
  const rdfRoot = parsed?.["rdf:RDF"] || parsed?.RDF;

  const channel = rssChannel || atomFeed || rdfRoot?.channel || rdfRoot;
  if (!channel) {
    throw new Error("invalid feed format");
  }

  const rawFeedTitle = stripHtml(getText(channel.title || rdfRoot?.channel?.title));
  const isGoogleNewsChannel = /google news|^"site:/i.test(rawFeedTitle);
  const feedTitle = (!isGoogleNewsChannel && rawFeedTitle) || fallbackUrl;
  const rawItems =
    rssChannel?.item ||
    atomFeed?.entry ||
    rdfRoot?.item ||
    channel?.item ||
    channel?.entry ||
    [];
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return items
    .slice(0, 30)
    .map((it: any, i: number) => {
      const rawTitle = getText(it?.title);
      const itemSource = stripHtml(getText(it?.source));
      let cleanTitle = stripHtml(rawTitle);
      if (itemSource && cleanTitle.endsWith(` - ${itemSource}`)) {
        cleanTitle = cleanTitle.slice(0, -(` - ${itemSource}`).length).trim();
      }
      const link = extractLink(it?.link, it?.guid || it?.id);
      const rawDate =
        it?.pubDate ||
        it?.published ||
        it?.updated ||
        it?.["dc:date"] ||
        it?.date ||
        it?.["a10:updated"];
      const date = normalizeDateIso(rawDate);
      const description = getText(it?.description || it?.summary || it?.content);
      const content = getText(
        it?.["content:encoded"] || it?.content || it?.description || it?.summary,
      );
      const id = `${feedId}-${link || cleanTitle.slice(0, 40) || i}`;
      const authorRaw =
        typeof it?.author === "object" && it?.author?.name
          ? getText(it.author.name)
          : getText(it?.author || it?.["dc:creator"]);
      const cleanDesc = stripHtml(description);
      const cleanContent = stripHtml(content) || cleanDesc;
      const effectiveSource = itemSource || feedTitle;

      return {
        id,
        feedId,
        title: cleanTitle || cleanDesc.slice(0, 90) || "بدون عنوان",
        link,
        source: effectiveSource,
        author: stripHtml(authorRaw) || effectiveSource,
        date,
        preview: cleanDesc.slice(0, 280),
        content: cleanContent,
        image: extractImage(it),
        lang: detectLang(cleanTitle || cleanDesc),
      };
    })
    .filter((item) => Boolean(item.title && item.title !== "بدون عنوان"));
}

