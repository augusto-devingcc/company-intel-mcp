# company-intel-mcp

An MCP server that gives a Claude (or any MCP client) the ability to research a company from a domain name. It scrapes the public website, classifies the company, pulls heuristic enrichment data, and drafts a personalized cold outbound email.

## Why this exists

Sales research is a high-volume, low-creativity workflow that maps cleanly onto an agent loop. Most teams paste a domain into a tab, skim the homepage, guess the industry, then hand-write a cold email. This server packages each of those steps as a tool an LLM can call directly, so the model does the loop instead of the human. It is also a reference implementation of a TypeScript MCP server using the official SDK, `cheerio`, `undici`, and the Anthropic SDK.

## Install

### Requirements

- Node.js 20 or newer
- An Anthropic API key with access to `claude-haiku-4-5` and `claude-sonnet-4-6`

### Claude Desktop

Open `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS (or the equivalent path on Windows / Linux) and add:

```json
{
  "mcpServers": {
    "company-intel": {
      "command": "npx",
      "args": ["-y", "github:augusto-devingcc/company-intel-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Restart Claude Desktop. The four tools will appear in the tools picker.

### Cursor

Open Cursor settings, go to `MCP`, and add a new server:

```json
{
  "company-intel": {
    "command": "npx",
    "args": ["-y", "github:augusto-devingcc/company-intel-mcp"],
    "env": {
      "ANTHROPIC_API_KEY": "sk-ant-..."
    }
  }
}
```

### Any MCP client

The server speaks stdio. Run it directly:

```bash
ANTHROPIC_API_KEY=sk-ant-... npx -y github:augusto-devingcc/company-intel-mcp
```

Once published to npm the install path becomes `npx -y @augusto-devingcc/company-intel-mcp` with the same arguments.

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | yes | Used by `classify_company` and `generate_outbound_email`. The other tools work without it. |

## Tools

### `web_scrape`

Fetches a URL and returns cleaned text.

Input:

```json
{ "url": "linear.app" }
```

Output:

```json
{
  "url": "https://linear.app",
  "title": "Linear, the new standard for software development",
  "description": "Linear is a purpose-built tool for ...",
  "text": "Linear is the system for modern software development ...",
  "subpages": [
    { "label": "Pricing", "href": "https://linear.app/pricing" },
    { "label": "Customers", "href": "https://linear.app/customers" }
  ],
  "truncated": true
}
```

The cleaner strips `script`, `style`, `nav`, `header`, `footer`, `aside`, `form`, `iframe`, and common cookie banner selectors. Text is capped at 8000 characters. Navigation links are deduplicated and capped at 20, same-host only.

### `classify_company`

Sends scraped text to Claude Haiku and parses a structured response.

Input:

```json
{ "text": "Linear is the system for modern software development ...", "domain": "linear.app" }
```

Output:

```json
{
  "industry": "Project management SaaS",
  "size_estimate": "201-1000",
  "tech_stack": ["React", "Next.js", "GraphQL"],
  "description": "Linear builds a streamlined issue tracker for software teams.",
  "pain_points": [
    "Onboarding new engineering hires to issue tracking conventions",
    "Reporting velocity to non-technical stakeholders"
  ]
}
```

`size_estimate` is constrained to `1-10`, `11-50`, `51-200`, `201-1000`, `1000+`, or `unknown`. If the first response fails to parse as JSON, the server retries once with a stricter system prompt.

### `lookup_company_extras`

Heuristic enrichment from the homepage only. No third-party APIs.

Input:

```json
{ "domain": "linear.app" }
```

Output:

```json
{
  "domain": "linear.app",
  "founded_year": 2019,
  "location": "San Francisco, CA, US",
  "social_links": {
    "twitter": "https://twitter.com/linear",
    "linkedin": "https://www.linkedin.com/company/linear",
    "github": "https://github.com/linear"
  }
}
```

The lookup prefers `Organization` JSON-LD if present, then falls back to regex patterns like `founded in (\d{4})`, `since (\d{4})`, `established in (\d{4})`.

### `generate_outbound_email`

Drafts a 100 to 150 word cold email using Claude Sonnet.

Input:

```json
{
  "company": {
    "domain": "linear.app",
    "industry": "Project management SaaS",
    "description": "Linear builds a streamlined issue tracker for software teams.",
    "pain_points": [
      "Onboarding new engineering hires to issue tracking conventions",
      "Reporting velocity to non-technical stakeholders"
    ]
  },
  "sender_context": "Augusto García, AI Automation Engineer."
}
```

Output:

```json
{
  "subject": "Onboarding new engineers into Linear in under a day",
  "body": "Hi Linear team, ...",
  "reasoning": "Anchored on the onboarding pain point because it is the most actionable for an automation engineer."
}
```

`sender_context` defaults to a short bio for Augusto García. The model is instructed to avoid em-dashes, exclamation marks, and generic openers.

## Local development

```bash
git clone https://github.com/augusto-devingcc/company-intel-mcp.git
cd company-intel-mcp
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

`npm run build` compiles to `dist/`. `npm start` runs the compiled server. The server speaks MCP over stdio, so the easiest manual test is to pipe a JSON-RPC `initialize` request into it:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.0"}}}' \
  | ANTHROPIC_API_KEY=sk-ant-... node dist/index.js
```

You should see an `initializeResult` JSON-RPC response on stdout.

## Example conversation

> User: Look up `linear.app` and draft me a cold email.

> Claude: (calls `web_scrape` on `linear.app`)
> Claude: (calls `classify_company` with the scraped text)
> Claude: (calls `lookup_company_extras` for the founded year and social links)
> Claude: (calls `generate_outbound_email` with the classification)
> Claude: Here is what I found and a draft email targeting their issue tracking workflow ...

The agent decides the order. The four tools are designed to compose cleanly without the model needing to glue them together with custom logic.

## Project layout

```
src/
  index.ts                          MCP server, tool registry, stdio transport
  lib/
    anthropic.ts                    Lazy Anthropic client + model IDs
    http.ts                         undici fetch with timeout and UA
  tools/
    web-scrape.ts                   HTML fetch + cheerio cleaning
    classify-company.ts             Claude Haiku structured classification
    lookup-company-extras.ts        JSON-LD + regex enrichment
    generate-outbound-email.ts      Claude Sonnet email drafting
```

## Caveats

- The scraper does not execute JavaScript. Sites that render content entirely client-side will return mostly empty text. This is intentional, so the server stays cheap and deployable anywhere Node 20 runs.
- `lookup_company_extras` is heuristic. Treat its output as a starting point, not ground truth.
- The Anthropic SDK is called with default retry behavior. Rate limit errors surface back to the MCP client as tool errors.

## License

MIT

Built by Augusto García · github.com/augusto-devingcc
