import * as cheerio from "cheerio";
import { z } from "zod";
import { fetchHtml, normalizeUrl } from "../lib/http.js";

export const webScrapeInputSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "The full URL or bare domain to scrape (e.g. 'linear.app' or 'https://linear.app').",
    },
  },
  required: ["url"],
  additionalProperties: false,
} as const;

export const WebScrapeInput = z.object({
  url: z.string().min(1),
});

export interface WebScrapeResult {
  url: string;
  title: string;
  description: string;
  text: string;
  subpages: Array<{ label: string; href: string }>;
  truncated: boolean;
}

const MAX_TEXT_LENGTH = 8000;
const MAX_SUBPAGES = 20;

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "svg",
  "iframe",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  ".cookie",
  ".cookies",
  "#cookie",
  "#cookies",
];

export async function webScrape(rawInput: unknown): Promise<WebScrapeResult> {
  const input = WebScrapeInput.parse(rawInput);
  const url = normalizeUrl(input.url);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title = ($("title").first().text() || $("meta[property='og:title']").attr("content") || "").trim();
  const description = (
    $("meta[name='description']").attr("content") ||
    $("meta[property='og:description']").attr("content") ||
    ""
  ).trim();

  const subpages = extractNavLinks($, url);

  for (const selector of NOISE_SELECTORS) {
    $(selector).remove();
  }

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const truncated = bodyText.length > MAX_TEXT_LENGTH;
  const text = truncated ? bodyText.slice(0, MAX_TEXT_LENGTH) : bodyText;

  return {
    url,
    title,
    description,
    text,
    subpages,
    truncated,
  };
}

function extractNavLinks($: cheerio.CheerioAPI, baseUrl: string): Array<{ label: string; href: string }> {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const results: Array<{ label: string; href: string }> = [];

  const candidateContainers = [
    "nav a",
    "header a",
    "[role='navigation'] a",
    ".nav a",
    ".navbar a",
    ".menu a",
  ];

  for (const selector of candidateContainers) {
    $(selector).each((_, el) => {
      if (results.length >= MAX_SUBPAGES) return false;
      const href = $(el).attr("href");
      const label = $(el).text().replace(/\s+/g, " ").trim();
      if (!href || !label) return;
      const resolved = resolveHref(href, base);
      if (!resolved) return;
      if (resolved.hostname !== base.hostname) return;
      const key = resolved.pathname + resolved.search;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ label, href: resolved.toString() });
      return;
    });
    if (results.length >= MAX_SUBPAGES) break;
  }

  return results;
}

function resolveHref(href: string, base: URL): URL | null {
  try {
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      return null;
    }
    return new URL(href, base);
  } catch {
    return null;
  }
}
