import { request, interceptors, Agent } from "undici";

const dispatcher = new Agent({ connect: { timeout: 10_000 } }).compose(
  interceptors.redirect({ maxRedirections: 5 })
);

const DEFAULT_HEADERS = {
  "user-agent":
    "company-intel-mcp/0.1 (+https://github.com/augusto-devingcc/company-intel-mcp)",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

export async function fetchHtml(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { statusCode, body, headers } = await request(url, {
      method: "GET",
      headers: DEFAULT_HEADERS,
      dispatcher,
      signal: controller.signal,
    });
    if (statusCode >= 400) {
      throw new Error(`HTTP ${statusCode} fetching ${url}`);
    }
    const contentType = String(headers["content-type"] ?? "");
    if (contentType && !contentType.includes("html") && !contentType.includes("xml") && !contentType.includes("text")) {
      throw new Error(`Unsupported content-type for ${url}: ${contentType}`);
    }
    return await body.text();
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
