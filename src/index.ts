#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  classifyCompany,
  classifyCompanyInputSchema,
} from "./tools/classify-company.js";
import {
  generateOutboundEmail,
  generateOutboundEmailInputSchema,
} from "./tools/generate-outbound-email.js";
import {
  lookupCompanyExtras,
  lookupCompanyExtrasInputSchema,
} from "./tools/lookup-company-extras.js";
import { webScrape, webScrapeInputSchema } from "./tools/web-scrape.js";

const SERVER_NAME = "company-intel-mcp";
const SERVER_VERSION = "0.1.0";

const TOOLS = [
  {
    name: "web_scrape",
    description:
      "Fetch a company URL and return cleaned text (max 8000 chars), title, meta description, and a list of subpages from the navigation (max 20).",
    inputSchema: webScrapeInputSchema,
    handler: webScrape,
  },
  {
    name: "classify_company",
    description:
      "Classify a company from raw website text using Claude Haiku. Returns industry, size estimate, tech stack, description, and plausible pain points.",
    inputSchema: classifyCompanyInputSchema,
    handler: classifyCompany,
  },
  {
    name: "lookup_company_extras",
    description:
      "Heuristic enrichment for a domain. Parses JSON-LD Organization schema when present and falls back to regex extraction for founded year and location, plus social profile links.",
    inputSchema: lookupCompanyExtrasInputSchema,
    handler: lookupCompanyExtras,
  },
  {
    name: "generate_outbound_email",
    description:
      "Draft a 100-150 word cold outbound email using Claude Sonnet. Returns subject, body, and a short reasoning trace.",
    inputSchema: generateOutboundEmailInputSchema,
    handler: generateOutboundEmail,
  },
] as const;

type ToolName = (typeof TOOLS)[number]["name"];

const toolMap = new Map<ToolName, (typeof TOOLS)[number]>(
  TOOLS.map((t) => [t.name, t])
);

async function main(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = toolMap.get(name as ToolName);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }
    try {
      const result = await tool.handler(args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `Tool ${name} failed: ${message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[${SERVER_NAME}] fatal: ${message}\n`);
  process.exit(1);
});
