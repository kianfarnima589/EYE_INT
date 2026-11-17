import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFeedXml,
  extractLink,
  extractImage,
  safeDateMs,
  normalizeDateIso,
  normalizeFa,
  detectLang,
  contentSig,
  buildGoogleNewsFallbackUrls,
} from "./feedParser";

test("parseFeedXml parses standard RSS 2.0 feed with media:content and HTML entities", () => {
  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel>
        <title>همشهری آنلاین</title>
        <item>
          <title><![CDATA[گزارش ویژه از <b>بازار</b> فناوری ایران]]></title>
          <link>https://www.hamshahrionline.ir/news/1001</link>
          <pubDate>Mon, 20 Apr 2026 08:30:00 GMT</pubDate>
          <dc:creator>تحریریه فناوری</dc:creator>
          <description><![CDATA[<p>جزئیات کامل از رشد استارتاپ‌ها در سال جدید.</p>]]></description>
          <media:content url="https://www.hamshahrionline.ir/img/1001.jpg" medium="image" />
        </item>
      </channel>
    </rss>`;

  const items = parseFeedXml(rssXml, "https://www.hamshahrionline.ir/rss", "feed_hamshahri");
  assert.equal(items.length, 1);
  assert.equal(items[0].feedId, "feed_hamshahri");
  assert.equal(items[0].title, "گزارش ویژه از بازار فناوری ایران");
  assert.equal(items[0].link, "https://www.hamshahrionline.ir/news/1001");
  assert.equal(items[0].source, "همشهری آنلاین");
  assert.equal(items[0].author, "تحریریه فناوری");
  assert.equal(items[0].image, "https://www.hamshahrionline.ir/img/1001.jpg");
  assert.equal(items[0].lang, "fa");
  assert.ok(items[0].preview.includes("جزئیات کامل از رشد استارتاپ‌ها"));
});

test("parseFeedXml parses Atom 1.0 feed with multiple <link> elements", () => {
  const atomXml = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Tech Monitor</title>
      <entry>
        <title>New Semiconductor Breakthrough Announced</title>
        <link rel="self" href="https://example.com/atom/entry/1" />
        <link rel="alternate" type="text/html" href="https://example.com/articles/semiconductor-2026" />
        <published>2026-04-20T09:15:00Z</published>
        <author><name>Jane Doe</name></author>
        <summary type="html">&lt;img src="https://example.com/chip.png" /&gt; A major leap in chip design.</summary>
      </entry>
    </feed>`;

  const items = parseFeedXml(atomXml, "https://example.com/feed.atom", "feed_atom");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "New Semiconductor Breakthrough Announced");
  assert.equal(items[0].link, "https://example.com/articles/semiconductor-2026");
  assert.equal(items[0].author, "Jane Doe");
  assert.equal(items[0].image, "https://example.com/chip.png");
  assert.equal(items[0].lang, "other");
});

test("parseFeedXml parses RDF / RSS 1.0 feed (e.g. Deutsche Welle / IRNA style)", () => {
  const rdfXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel rdf:about="https://rss.dw.com/rdf/rss-en-all">
        <title>Deutsche Welle</title>
      </channel>
      <item rdf:about="https://www.dw.com/en/article-1">
        <title>European markets open higher on Monday</title>
        <link>https://www.dw.com/en/article-1</link>
        <dc:date>2026-04-20T07:00:00Z</dc:date>
        <description>Stocks across Europe rallied early Monday morning.</description>
      </item>
    </rdf:RDF>`;

  const items = parseFeedXml(rdfXml, "https://rss.dw.com/rdf/rss-en-all", "feed_dw");
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "Deutsche Welle");
  assert.equal(items[0].title, "European markets open higher on Monday");
  assert.equal(items[0].link, "https://www.dw.com/en/article-1");
  assert.equal(items[0].date, "2026-04-20T07:00:00.000Z");
});

test("parseFeedXml throws on non-feed HTML or empty input", () => {
  assert.throws(() => parseFeedXml("<html><body>404 Not Found</body></html>", "https://bad.local", "f1"), /invalid feed format/);
  assert.throws(() => parseFeedXml("", "https://bad.local", "f1"), /empty feed response/);
});

test("safeDateMs and normalizeDateIso handle Persian digits and invalid dates safely", () => {
  const ms = safeDateMs("۲۰۲۶-۰۴-۲۰T10:00:00Z", 0);
  assert.ok(ms > 1700000000000);
  assert.equal(safeDateMs("not-a-valid-date", 12345), 12345);
  const iso = normalizeDateIso("not-a-valid-date");
  assert.ok(!Number.isNaN(Date.parse(iso)));
});

test("normalizeFa and contentSig deduplicate equivalent Persian headlines and URLs", () => {
  assert.equal(normalizeFa("كلمهٔ كتاب و يادگيري ۱۲۳"), "کلمه کتاب و یادگیری 123");
  assert.equal(
    contentSig("تیتر اول", "https://www.Example.com/news/42/?utm=1#top"),
    contentSig("تیتر متفاوت", "http://example.com/news/42/")
  );
  assert.equal(detectLang("گزارش کامل از وضعیت بورس تهران"), "fa");
  assert.equal(detectLang("تقرير إخباري عن الأسواق المالية العالمية"), "ar");
  assert.equal(detectLang("Global Economy Outlook for 2026"), "other");
});

test("buildGoogleNewsFallbackUrls builds locale-aware fallback URLs and parseFeedXml cleans Google News titles", () => {
  const frUrls = buildGoogleNewsFallbackUrls("https://www.france24.com/en/rss");
  assert.equal(frUrls.length, 2);
  assert.ok(frUrls[0].includes("site:france24.com") && frUrls[0].includes("hl=en-US"));

  const irUrls = buildGoogleNewsFallbackUrls("https://www.tasnimnews.com/fa/rss/feed/0/8/0/top");
  assert.equal(irUrls.length, 2);
  assert.ok(irUrls[0].includes("site:tasnimnews.com") && irUrls[0].includes("hl=fa&gl=IR"));

  const gnewsXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>"site:france24.com" - Google News</title>
        <item>
          <title>European Summit Reaches Historic Climate Deal - France 24</title>
          <link>https://news.google.com/rss/articles/CBMi123</link>
          <pubDate>Tue, 21 Apr 2026 11:00:00 GMT</pubDate>
          <description>European leaders agreed on a new framework in Brussels.</description>
          <source url="https://www.france24.com">France 24</source>
        </item>
      </channel>
    </rss>`;

  const parsed = parseFeedXml(gnewsXml, "https://www.france24.com/en/rss", "feed_f24");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, "European Summit Reaches Historic Climate Deal");
  assert.equal(parsed[0].source, "France 24");
});

