import * as cheerio from "cheerio";
import { z } from "zod";
import { fetchHtml, normalizeUrl } from "../lib/http.js";

export const lookupCompanyExtrasInputSchema = {
  type: "object",
  properties: {
    domain: {
      type: "string",
      description: "Domain to enrich (e.g. 'linear.app').",
    },
  },
  required: ["domain"],
  additionalProperties: false,
} as const;

export const LookupCompanyExtrasInput = z.object({
  domain: z.string().min(1),
});

export interface CompanyExtras {
  domain: string;
  founded_year: number | null;
  location: string | null;
  social_links: {
    twitter?: string;
    linkedin?: string;
    github?: string;
  };
}

export async function lookupCompanyExtras(rawInput: unknown): Promise<CompanyExtras> {
  const input = LookupCompanyExtrasInput.parse(rawInput);
  const url = normalizeUrl(input.domain);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const fromJsonLd = extractFromJsonLd($);
  const founded = fromJsonLd.founded_year ?? extractFoundedYearFromText($);
  const location = fromJsonLd.location ?? extractLocationFromText($);
  const social = extractSocialLinks($);

  return {
    domain: new URL(url).hostname.replace(/^www\./, ""),
    founded_year: founded,
    location,
    social_links: social,
  };
}

function extractFromJsonLd($: cheerio.CheerioAPI): { founded_year: number | null; location: string | null } {
  let founded_year: number | null = null;
  let location: string | null = null;

  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const nodes = collectOrganizationNodes(parsed);
    for (const node of nodes) {
      if (founded_year === null) {
        const candidate = node["foundingDate"] ?? node["foundedDate"];
        if (typeof candidate === "string") {
          const year = parseInt(candidate.slice(0, 4), 10);
          if (!Number.isNaN(year) && year > 1800 && year <= new Date().getFullYear()) {
            founded_year = year;
          }
        }
      }
      if (location === null) {
        const addr = node["address"];
        if (typeof addr === "string") {
          location = addr;
        } else if (addr && typeof addr === "object") {
          const a = addr as Record<string, unknown>;
          const parts = [a["addressLocality"], a["addressRegion"], a["addressCountry"]].filter(
            (v): v is string => typeof v === "string" && v.length > 0
          );
          if (parts.length > 0) location = parts.join(", ");
        }
      }
    }
  });

  return { founded_year, location };
}

function collectOrganizationNodes(value: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && /organization|corporation|localbusiness/i.test(t))) {
      out.push(obj);
    }
    if (Array.isArray(obj["@graph"])) {
      visit(obj["@graph"]);
    }
  };
  visit(value);
  return out;
}

const FOUNDED_PATTERNS: RegExp[] = [
  /founded\s+in\s+(\d{4})/i,
  /established\s+in\s+(\d{4})/i,
  /since\s+(\d{4})/i,
  /est\.?\s+(\d{4})/i,
  /\(c\)\s*(\d{4})/i,
];

function extractFoundedYearFromText($: cheerio.CheerioAPI): number | null {
  const text = $("body").text();
  const currentYear = new Date().getFullYear();
  for (const re of FOUNDED_PATTERNS) {
    const m = text.match(re);
    if (m && m[1]) {
      const year = parseInt(m[1], 10);
      if (year > 1800 && year <= currentYear) return year;
    }
  }
  return null;
}

function extractLocationFromText($: cheerio.CheerioAPI): string | null {
  const candidates = [
    $("[itemprop='address']").first().text(),
    $("address").first().text(),
  ];
  for (const c of candidates) {
    const cleaned = c?.replace(/\s+/g, " ").trim();
    if (cleaned && cleaned.length > 2 && cleaned.length < 200) return cleaned;
  }
  return null;
}

function extractSocialLinks($: cheerio.CheerioAPI): CompanyExtras["social_links"] {
  const out: CompanyExtras["social_links"] = {};
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (!out.twitter && /(?:twitter\.com|x\.com)\/[^/?#]+/i.test(href)) {
      out.twitter = href;
    } else if (!out.linkedin && /linkedin\.com\/(?:company|in)\/[^/?#]+/i.test(href)) {
      out.linkedin = href;
    } else if (!out.github && /github\.com\/[^/?#]+/i.test(href)) {
      out.github = href;
    }
  });
  return out;
}
