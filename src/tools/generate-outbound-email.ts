import { z } from "zod";
import { getAnthropicClient, MODEL_SONNET } from "../lib/anthropic.js";

export const generateOutboundEmailInputSchema = {
  type: "object",
  properties: {
    company: {
      type: "object",
      properties: {
        domain: { type: "string" },
        industry: { type: "string" },
        description: { type: "string" },
        pain_points: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["domain", "industry", "description", "pain_points"],
      additionalProperties: false,
    },
    sender_context: {
      type: "string",
      description: "Optional sender bio. Defaults to Augusto García's AI automation engineer pitch.",
    },
  },
  required: ["company"],
  additionalProperties: false,
} as const;

export const GenerateOutboundEmailInput = z.object({
  company: z.object({
    domain: z.string().min(1),
    industry: z.string(),
    description: z.string(),
    pain_points: z.array(z.string()),
  }),
  sender_context: z.string().optional(),
});

export interface GeneratedEmail {
  subject: string;
  body: string;
  reasoning: string;
}

const DEFAULT_SENDER =
  "Augusto García, AI Automation Engineer who builds Claude agents, MCP servers, and lead enrichment pipelines for SaaS companies.";

const SYSTEM_PROMPT = `You write short B2B cold outbound emails. Output strictly a JSON code block with this shape:

{
  "subject": string,           // under 60 chars, specific, not clickbait
  "body": string,              // 100-150 words, plain text, no markdown, line breaks allowed
  "reasoning": string          // 1-2 sentences explaining why this angle fits the company
}

Rules for the email body:
- Open with a specific observation about the company (not a generic compliment).
- Tie the sender's offer to one of the pain points listed.
- Include one concrete deliverable or example.
- End with a low-friction ask (a question or a 15 minute call).
- No em-dashes. No exclamation marks. No filler phrases like "I hope this email finds you well".
- Do not invent product details, customer names, or metrics about the prospect.`;

export async function generateOutboundEmail(rawInput: unknown): Promise<GeneratedEmail> {
  const input = GenerateOutboundEmailInput.parse(rawInput);
  const sender = input.sender_context?.trim() || DEFAULT_SENDER;
  const userMessage = buildUserMessage(input.company, sender);

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = parseEmail(text);
  if (!parsed) {
    throw new Error("Model returned an unparseable email payload.");
  }
  return parsed;
}

function buildUserMessage(
  company: z.infer<typeof GenerateOutboundEmailInput>["company"],
  sender: string
): string {
  return [
    `Sender: ${sender}`,
    "",
    "Prospect:",
    `- Domain: ${company.domain}`,
    `- Industry: ${company.industry}`,
    `- Description: ${company.description}`,
    `- Pain points:`,
    ...company.pain_points.map((p) => `  - ${p}`),
    "",
    "Draft the email now. Output only the JSON code block.",
  ].join("\n");
}

function parseEmail(text: string): GeneratedEmail | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text)?.trim();
  if (!candidate) return null;

  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    try {
      json = JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  if (
    typeof obj.subject !== "string" ||
    typeof obj.body !== "string" ||
    typeof obj.reasoning !== "string"
  ) {
    return null;
  }
  return { subject: obj.subject, body: obj.body, reasoning: obj.reasoning };
}

import type Anthropic from "@anthropic-ai/sdk";
