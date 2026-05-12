import { z } from "zod";
import { getAnthropicClient, MODEL_HAIKU } from "../lib/anthropic.js";

export const classifyCompanyInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description: "Raw text content scraped from a company website. Should ideally be the homepage or about page.",
    },
    domain: {
      type: "string",
      description: "Optional domain name for additional context.",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const;

export const ClassifyCompanyInput = z.object({
  text: z.string().min(1),
  domain: z.string().optional(),
});

const SIZE_BUCKETS = ["1-10", "11-50", "51-200", "201-1000", "1000+", "unknown"] as const;

export const Classification = z.object({
  industry: z.string(),
  size_estimate: z.enum(SIZE_BUCKETS),
  tech_stack: z.array(z.string()),
  description: z.string(),
  pain_points: z.array(z.string()),
});

export type ClassificationResult = z.infer<typeof Classification>;

const SYSTEM_PROMPT = `You are a B2B sales research analyst. Classify a company from raw website text and return ONLY a valid JSON object inside a \`\`\`json code block.

Schema:
{
  "industry": string,              // concise industry label (e.g. "Project management SaaS")
  "size_estimate": "1-10" | "11-50" | "51-200" | "201-1000" | "1000+" | "unknown",
  "tech_stack": string[],          // observable technologies, frameworks, integrations. Empty array if none visible.
  "description": string,           // one or two factual sentences describing what the company does
  "pain_points": string[]          // 2-4 plausible pain points a vendor could help with, grounded in what the text reveals
}

Rules:
- Be conservative. If size is unclear, use "unknown".
- Do not invent integrations or technologies that are not implied by the text.
- Output the JSON code block and nothing else.`;

export async function classifyCompany(rawInput: unknown): Promise<ClassificationResult> {
  const input = ClassifyCompanyInput.parse(rawInput);
  const userContent = buildUserMessage(input.text, input.domain);

  try {
    return await runClassification(userContent);
  } catch (err) {
    if (err instanceof ClassificationParseError) {
      return await runClassification(userContent, true);
    }
    throw err;
  }
}

class ClassificationParseError extends Error {}

async function runClassification(userContent: string, retry = false): Promise<ClassificationResult> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 1024,
    system: retry
      ? `${SYSTEM_PROMPT}\n\nPrevious response failed to parse. Output ONLY the JSON code block, no prose.`
      : SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((b) => b.text)
    .join("\n");

  const json = extractJson(text);
  if (!json) {
    throw new ClassificationParseError("No JSON block found in model response.");
  }

  const parsed = Classification.safeParse(json);
  if (!parsed.success) {
    throw new ClassificationParseError(`Schema mismatch: ${parsed.error.message}`);
  }
  return parsed.data;
}

function buildUserMessage(text: string, domain?: string): string {
  const header = domain ? `Domain: ${domain}\n\n` : "";
  return `${header}Website text:\n"""\n${text}\n"""`;
}

function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  if (!candidate) return null;
  const trimmed = candidate.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

import type Anthropic from "@anthropic-ai/sdk";
