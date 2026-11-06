/**
 * intelligence/ai-draft.ts
 *
 * Intent drafting: raw proposal text -> structured Intent schema (a), with
 * source spans and UNRESOLVED flags.
 *
 * Primary path: Groq (OpenAI-compatible chat completions) with strict JSON
 * output. Fallback path: a deterministic, dependency-free extractor so the
 * demo never depends on network latency or an API key.
 *
 * The LLM is advisory only: every action must be grounded in a verbatim quote
 * from the proposal, and every missing/ambiguous detail becomes an UNRESOLVED
 * item for a human reviewer to resolve before hashing.
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

export type ActionKindName =
  | "ERC20_TRANSFER"
  | "ERC20_APPROVE"
  | "PARAM_SET"
  | "UPGRADE"
  | "OWNERSHIP_TRANSFER"
  | "MULTICALL";

export interface IntentSource {
  docHash: string;
  page: number;
  section: string;
  span: [number, number];
}

export interface IntentAction {
  kind: ActionKindName;
  target: string;
  selector: string;
  counterparty: string;
  maxAmount: string;
  codeHash: string | null;
  children: IntentAction[];
  source: IntentSource;
  confidence: number;
}

export interface UnresolvedItem {
  question: string;
  source: IntentSource | Record<string, never>;
}

export interface Assumption {
  name: string;
  value: string;
  source: IntentSource | Record<string, never>;
}

/** Schema (a) — the frozen Intent specification. */
export interface IntentSpec {
  proposalId: string;
  version: number;
  title: string;
  actions: IntentAction[];
  unresolved: UnresolvedItem[];
  assumptions: Assumption[];
}

export interface ExtractOptions {
  proposalId?: string;
  version?: number;
  docHash?: string;
  page?: number;
  section?: string;
  /** Contract name -> address, used to resolve named mentions. */
  knownAddresses?: Record<string, string>;
  /** Force the deterministic extractor even when GROQ_API_KEY is set. */
  offline?: boolean;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface ExtractionResult {
  intent: IntentSpec;
  mode: "groq" | "heuristic";
  model?: string;
  latencyMs: number;
  warnings: string[];
}

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

interface LlmAction {
  kind?: string;
  target?: string;
  selector?: string;
  counterparty?: string;
  maxAmount?: string | number;
  codeHash?: string | null;
  children?: LlmAction[];
  quote?: string;
  confidence?: number;
}

interface LlmResult {
  title?: string;
  actions?: LlmAction[];
  unresolved?: { question?: string; quote?: string }[];
  assumptions?: { name?: string; value?: string; quote?: string }[];
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

const ACTION_KINDS: ActionKindName[] = [
  "ERC20_TRANSFER",
  "ERC20_APPROVE",
  "PARAM_SET",
  "UPGRADE",
  "OWNERSHIP_TRANSFER",
  "MULTICALL",
];

const SELECTORS: Record<string, string> = {
  transfer: "0xa9059cbb",
  approve: "0x095ea7b3",
  upgradeTo: "0x3659cfe6",
  upgradeToAndCall: "0x4f1ef286",
  transferOwnership: "0xf2fde38b",
  multicall: "0xac9650d8",
  setFee: "0x69fe0e2d",
  withdrawERC20: "0x44004cc1",
};

const KIND_SELECTORS: Partial<Record<ActionKindName, string>> = {
  ERC20_TRANSFER: SELECTORS.transfer,
  ERC20_APPROVE: SELECTORS.approve,
  UPGRADE: SELECTORS.upgradeTo,
  OWNERSHIP_TRANSFER: SELECTORS.transferOwnership,
  MULTICALL: SELECTORS.multicall,
};

export const SAMPLE_PROPOSAL = `Proposal: Q3 Developer Grant and Fee Tuning

Transfer 5,000 USDC from the DAO treasury to the development wallet 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955 for the Q3 audit engagement.
Set the fee module parameter to 35 bps to keep the protocol competitive.
The team may adjust the recipient at its discretion if the developer changes.
The grant is expected to recur monthly through the end of the year.`;

/**
 * Extract the Intent schema. Uses Groq when an API key is available unless
 * `offline` is set; otherwise (or on any failure) falls back deterministically.
 */
export async function extractIntent(
  rawText: string,
  options: ExtractOptions = {}
): Promise<IntentSpec> {
  return (await extractIntentDetailed(rawText, options)).intent;
}

export async function extractIntentDetailed(
  rawText: string,
  options: ExtractOptions = {}
): Promise<ExtractionResult> {
  const started = Date.now();
  const warnings: string[] = [];
  const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;

  if (apiKey && !options.offline) {
    const model = options.model ?? process.env.GROQ_MODEL ?? DEFAULT_MODEL;
    try {
      const content = await callGroq(rawText, options, apiKey, model);
      const parsed: unknown = JSON.parse(content);
      const intent = normalizeLlmResult(parsed, rawText, options);
      return {
        intent,
        mode: "groq",
        model,
        latencyMs: Date.now() - started,
        warnings,
      };
    } catch (error) {
      warnings.push(
        `Groq extraction failed (${errorMessage(error)}); using deterministic fallback.`
      );
    }
  }

  return {
    intent: extractIntentHeuristic(rawText, options),
    mode: "heuristic",
    latencyMs: Date.now() - started,
    warnings,
  };
}

/**
 * Deterministic extraction: keyword/amount/address parsing with source spans.
 * Not an LLM; it intentionally marks anything ambiguous as UNRESOLVED.
 */
export function extractIntentHeuristic(
  rawText: string,
  options: ExtractOptions = {}
): IntentSpec {
  const ctx = buildContext(rawText, options);
  const known = normalizeKnown(options.knownAddresses);
  const sentences = splitSentences(rawText);

  const actions: IntentAction[] = [];
  const unresolved: UnresolvedItem[] = [];
  const assumptions: Assumption[] = [];
  const tokensSeen = new Set<string>();
  let sawBps = false;

  for (let index = 0; index < sentences.length; index++) {
    const sentence = sentences[index];
    if (index === 0 && looksLikeTitle(sentence.text)) continue;

    const kind = detectActionKind(sentence.text);
    if (!kind) continue;

    const source = sourceAt(ctx, [sentence.start, sentence.end]);
    const addresses = extractAddresses(sentence.text);
    const knownMentions = findKnownMentions(sentence.text, known);

    if (kind === "ERC20_TRANSFER" || kind === "ERC20_APPROVE") {
      const amount = parseTokenAmount(sentence.text);
      if (!amount) {
        unresolved.push({
          question:
            kind === "ERC20_APPROVE"
              ? "What exact amount should be approved?"
              : "What exact amount should be transferred?",
          source,
        });
        continue;
      }

      const target = resolveTokenAddress(amount.asset, known);
      const counterparty =
        addresses.find((address) => !sameAddress(address, target)) ??
        knownMentions.find((mention) => !sameAddress(mention.address, target))?.address ??
        "";

      if (!target) {
        unresolved.push({
          question: `Which ${amount.asset} token contract should be used?`,
          source,
        });
      }
      if (!counterparty) {
        unresolved.push({
          question:
            kind === "ERC20_APPROVE"
              ? "Who is the spender that should be approved?"
              : "Who is the recipient of the transfer?",
          source,
        });
      }

      tokensSeen.add(amount.asset);
      actions.push({
        kind,
        target,
        selector: kind === "ERC20_TRANSFER" ? SELECTORS.transfer : SELECTORS.approve,
        counterparty,
        maxAmount: amount.baseUnits,
        codeHash: null,
        children: [],
        source,
        confidence: scoreAction(Boolean(target), Boolean(counterparty), true, false),
      });
      continue;
    }

    if (kind === "PARAM_SET") {
      const value = parseParameterValue(sentence.text);
      const selector = detectSelector(sentence.text);
      const target = knownMentions[0]?.address ?? addresses[0] ?? "";

      if (!value) {
        unresolved.push({
          question: "What exact value should the parameter be set to?",
          source,
        });
        continue;
      }
      if (!target) {
        unresolved.push({
          question: "Which contract holds the parameter being changed?",
          source,
        });
      }
      if (!selector) {
        unresolved.push({
          question:
            "Which function selector should be committed for this parameter change?",
          source,
        });
      }

      if (value.unit === "bps" || value.unit === "%") sawBps = true;
      actions.push({
        kind: "PARAM_SET",
        target,
        selector,
        counterparty: "",
        maxAmount: value.value,
        codeHash: null,
        children: [],
        source,
        confidence: scoreAction(Boolean(target), true, true, !selector),
      });
      continue;
    }

    if (kind === "UPGRADE") {
      const target =
        knownMentions.find((mention) => !addresses.some((a) => sameAddress(a, mention.address)))
          ?.address ??
        knownMentions[0]?.address ??
        addresses[0] ??
        "";
      const implementation =
        addresses.find((address) => !sameAddress(address, target)) ?? "";
      const codeHash = extractHash32(sentence.text);

      if (!target) {
        unresolved.push({ question: "Which proxy should be upgraded?", source });
      }
      if (!implementation) {
        unresolved.push({
          question: "Which implementation address should the proxy upgrade to?",
          source,
        });
      }

      actions.push({
        kind: "UPGRADE",
        target,
        selector: SELECTORS.upgradeTo,
        counterparty: implementation,
        maxAmount: "0",
        codeHash,
        children: [],
        source,
        confidence: scoreAction(
          Boolean(target),
          Boolean(implementation),
          true,
          !implementation
        ),
      });
      continue;
    }

    if (kind === "OWNERSHIP_TRANSFER") {
      const target = knownMentions[0]?.address ?? addresses[0] ?? "";
      const newOwner =
        addresses.find((address) => !sameAddress(address, target)) ??
        knownMentions.find((mention) => !sameAddress(mention.address, target))?.address ??
        "";

      if (!target) {
        unresolved.push({
          question: "Which contract's ownership is being transferred?",
          source,
        });
      }
      if (!newOwner) {
        unresolved.push({ question: "Who is the new owner?", source });
      }

      actions.push({
        kind: "OWNERSHIP_TRANSFER",
        target,
        selector: SELECTORS.transferOwnership,
        counterparty: newOwner,
        maxAmount: "0",
        codeHash: null,
        children: [],
        source,
        confidence: scoreAction(Boolean(target), Boolean(newOwner), true, !newOwner),
      });
      continue;
    }

    // MULTICALL: the deterministic path cannot safely split inner calls.
    const target = knownMentions[0]?.address ?? addresses[0] ?? "";
    if (!target) {
      unresolved.push({
        question: "Which contract should the multicall target?",
        source,
      });
    }
    unresolved.push({
      question: "What are the exact inner calls in the multicall?",
      source,
    });
    actions.push({
      kind: "MULTICALL",
      target,
      selector: SELECTORS.multicall,
      counterparty: "",
      maxAmount: "0",
      codeHash: null,
      children: [],
      source,
      confidence: scoreAction(Boolean(target), false, false, true),
    });
  }

  for (const sentence of sentences) {
    const source = sourceAt(ctx, [sentence.start, sentence.end]);
    if (/\b(recurring|monthly|quarterly|annually|annual|per year|ongoing|each month)\b/i.test(sentence.text)) {
      unresolved.push({
        question:
          "Is this a one-time action or a recurring commitment? The current ActionKind model encodes one-time actions only.",
        source,
      });
    }
    if (/\b(discretion|as needed|reasonable|may adjust|at the team'?s discretion|at its discretion)\b/i.test(sentence.text)) {
      unresolved.push({
        question:
          "The proposal delegates discretion. What exact recipient and value should be committed before voting?",
        source,
      });
    }
    if (/\b(some|several|various)\s+(funds|amounts?|payments?)\b/i.test(sentence.text)) {
      unresolved.push({
        question: "The amount is unspecified. What exact amount should be committed?",
        source,
      });
    }
  }

  for (const asset of tokensSeen) {
    const decimals = asset === "ETH" || asset === "WETH" ? 18 : 6;
    assumptions.push({
      name: `${asset}_decimals`,
      value: `${asset} amounts are expressed in base units with ${decimals} decimals.`,
      source: {},
    });
  }
  if (sawBps) {
    assumptions.push({
      name: "fee_unit",
      value: "1 bps = 0.01%; percentage values are converted to bps.",
      source: {},
    });
  }

  if (actions.length === 0) {
    unresolved.push({
      question: "No executable action could be grounded in the proposal text.",
      source: {},
    });
  }

  return {
    proposalId: ctx.proposalId,
    version: ctx.version,
    title: extractTitle(rawText),
    actions,
    unresolved: dedupeUnresolved(unresolved),
    assumptions: dedupeAssumptions(assumptions),
  };
}

async function callGroq(
  rawText: string,
  options: ExtractOptions,
  apiKey: string,
  model: string
): Promise<string> {
  const fetchImpl: FetchLike = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 12_000
  );

  try {
    const response = await fetchImpl(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(rawText, options.knownAddresses) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Groq response is missing choices[0].message.content");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `You extract a machine-checkable execution intent from a DAO governance proposal.

Return ONLY a JSON object (no markdown) with this exact shape:
{
  "title": string,
  "actions": [{
    "kind": "ERC20_TRANSFER" | "ERC20_APPROVE" | "PARAM_SET" | "UPGRADE" | "OWNERSHIP_TRANSFER" | "MULTICALL",
    "target": string,
    "selector": string,
    "counterparty": string,
    "maxAmount": string,
    "codeHash": string | null,
    "children": [],
    "quote": string,
    "confidence": number
  }],
  "unresolved": [{ "question": string, "quote": string }],
  "assumptions": [{ "name": string, "value": string, "quote": string }]
}

Rules:
- Never invent addresses or amounts. Use "" for unknown fields and add an UNRESOLVED item.
- Use the supplied known-address map for named contracts. Keep a raw address only if it appears verbatim in the proposal.
- maxAmount is an integer string in base units: USDC/DAI/USDT = 6 decimals, ETH/WETH = 18 decimals.
- For PARAM_SET, maxAmount is the parameter value (bps for fee parameters) and selector is the function selector if the text names the function.
- Add an UNRESOLVED item for: missing recipient, vague/unspecified amount, delegated discretion, recurring vs one-time ambiguity, unknown selector, or missing target.
- quote must be copied verbatim from the proposal text and must ground the action.
- confidence is 0..1. Be conservative.
- Do not output anything except the JSON object.`;

function buildUserPrompt(
  rawText: string,
  knownAddresses?: Record<string, string>
): string {
  return `Proposal text (verbatim):
"""
${rawText}
"""

Known contract names -> addresses (use only these; never invent addresses):
${JSON.stringify(knownAddresses ?? {}, null, 2)}

Return the JSON object now.`;
}

function normalizeLlmResult(
  result: unknown,
  rawText: string,
  options: ExtractOptions
): IntentSpec {
  const ctx = buildContext(rawText, options);
  const known = normalizeKnown(options.knownAddresses);
  const obj = (result && typeof result === "object" ? result : {}) as LlmResult;
  const actions: IntentAction[] = [];
  const unresolved: UnresolvedItem[] = [];
  const assumptions: Assumption[] = [];

  for (const item of Array.isArray(obj.actions) ? obj.actions : []) {
    const kind = String(item?.kind ?? "").toUpperCase() as ActionKindName;
    if (!ACTION_KINDS.includes(kind)) {
      unresolved.push({
        question: `Unsupported action kind "${String(item?.kind ?? "")}".`,
        source: {},
      });
      continue;
    }

    const span =
      locateQuote(rawText, item?.quote ?? "") ?? findKeywordSpan(rawText, kind);
    if (!span) {
      unresolved.push({
        question: `Could not ground the ${kind} action in the proposal text.`,
        source: {},
      });
      continue;
    }
    const source = sourceAt(ctx, span);

    const target = resolveAddress(item?.target, known);
    const counterparty = resolveAddress(item?.counterparty, known);
    const maxAmount = normalizeIntegerString(item?.maxAmount);
    const selector = normalizeSelector(item?.selector, kind);
    const codeHash = normalizeCodeHash(item?.codeHash);

    if (!target) {
      unresolved.push({
        question: `Which contract is the target of the ${kind} action?`,
        source,
      });
    }
    if (requiresCounterparty(kind) && !counterparty) {
      unresolved.push({
        question: `Who is the counterparty for the ${kind} action?`,
        source,
      });
    }
    if (!maxAmount && kind !== "UPGRADE" && kind !== "OWNERSHIP_TRANSFER" && kind !== "MULTICALL") {
      unresolved.push({
        question: `What exact base-unit amount applies to the ${kind} action?`,
        source,
      });
    }
    if (kind === "PARAM_SET" && !selector) {
      unresolved.push({
        question:
          "Which function selector should be committed for this parameter change?",
        source,
      });
    }

    actions.push({
      kind,
      target,
      selector,
      counterparty,
      maxAmount: maxAmount || "0",
      codeHash,
      children: normalizeChildren(item?.children, source, known, 0),
      source,
      confidence: clamp(Number(item?.confidence ?? 0.5), 0.05, 0.99),
    });
  }

  for (const item of Array.isArray(obj.unresolved) ? obj.unresolved : []) {
    const question = String(item?.question ?? "").trim();
    if (!question) continue;
    const span = locateQuote(rawText, item?.quote ?? "");
    unresolved.push({
      question,
      source: span ? sourceAt(ctx, span) : {},
    });
  }

  for (const item of Array.isArray(obj.assumptions) ? obj.assumptions : []) {
    const name = String(item?.name ?? "").trim();
    const value = String(item?.value ?? "").trim();
    if (!name || !value) continue;
    const span = locateQuote(rawText, item?.quote ?? "");
    assumptions.push({
      name,
      value,
      source: span ? sourceAt(ctx, span) : {},
    });
  }

  if (actions.length === 0) {
    unresolved.push({
      question: "No executable action could be extracted from the proposal.",
      source: {},
    });
  }

  return {
    proposalId: ctx.proposalId,
    version: ctx.version,
    title:
      typeof obj.title === "string" && obj.title.trim()
        ? obj.title.trim()
        : extractTitle(rawText),
    actions,
    unresolved: dedupeUnresolved(unresolved),
    assumptions: dedupeAssumptions(assumptions),
  };
}

function normalizeChildren(
  children: unknown,
  source: IntentSource,
  known: Record<string, string>,
  depth: number
): IntentAction[] {
  if (!Array.isArray(children) || depth >= 2) return [];
  const out: IntentAction[] = [];
  for (const raw of children) {
    const item = raw as LlmAction;
    const kind = String(item?.kind ?? "").toUpperCase() as ActionKindName;
    if (!ACTION_KINDS.includes(kind)) continue;
    out.push({
      kind,
      target: resolveAddress(item?.target, known),
      selector: normalizeSelector(item?.selector, kind),
      counterparty: resolveAddress(item?.counterparty, known),
      maxAmount: normalizeIntegerString(item?.maxAmount) || "0",
      codeHash: normalizeCodeHash(item?.codeHash),
      children: normalizeChildren(item?.children, source, known, depth + 1),
      source,
      confidence: clamp(Number(item?.confidence ?? 0.5), 0.05, 0.99),
    });
  }
  return out;
}

interface DraftContext {
  docHash: string;
  page: number;
  section: string;
  proposalId: string;
  version: number;
}

function buildContext(rawText: string, options: ExtractOptions): DraftContext {
  const docHash =
    options.docHash ?? ethers.keccak256(ethers.toUtf8Bytes(rawText));
  return {
    docHash,
    page: options.page ?? 1,
    section: options.section ?? detectSection(rawText),
    proposalId: options.proposalId ?? `draft-${docHash.slice(2, 10)}`,
    version: options.version ?? 1,
  };
}

function sourceAt(ctx: DraftContext, span: [number, number]): IntentSource {
  return {
    docHash: ctx.docHash,
    page: ctx.page,
    section: ctx.section,
    span,
  };
}

function detectActionKind(text: string): ActionKindName | null {
  const t = text.toLowerCase();
  if (/\b(multicall|batch(ed)?|bundle)\b/.test(t)) return "MULTICALL";
  if (/\b(upgrade|new implementation|implementation address)\b/.test(t)) {
    return "UPGRADE";
  }
  if (/\b(transfer ownership|change (the )?owner|new owner|ownership transfer|set owner)\b/.test(t)) {
    return "OWNERSHIP_TRANSFER";
  }
  if (/\b(approve|approval|allowance)\b/.test(t)) return "ERC20_APPROVE";
  if (/\b(fee|fees|feebps|parameter|bps|tune)\b/.test(t) || /\bset\s+(the\s+)?\w+\s+to\b/.test(t)) {
    return "PARAM_SET";
  }
  if (/\b(transfer|send|pay|payment|disburse|allocate)\b/.test(t)) {
    return "ERC20_TRANSFER";
  }
  return null;
}

function parseTokenAmount(
  text: string
): { asset: string; baseUnits: string } | null {
  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(USDC|USDT|DAI|WETH|ETH)\b/i);
  if (!match) return null;
  const asset = match[2].toUpperCase();
  const decimals = asset === "ETH" || asset === "WETH" ? 18 : 6;
  try {
    return {
      asset,
      baseUnits: ethers.parseUnits(match[1].replace(/,/g, ""), decimals).toString(),
    };
  } catch {
    return null;
  }
}

function parseParameterValue(text: string): { value: string; unit: string } | null {
  const bps = text.match(/(\d+(?:\.\d+)?)\s*(bps|%)/i);
  if (bps) {
    const parsed = Number(bps[1]);
    if (!Number.isFinite(parsed)) return null;
    return {
      value: String(bps[2] === "%" ? Math.round(parsed * 100) : Math.round(parsed)),
      unit: bps[2],
    };
  }
  const to = text.match(/\bto\s+(\d+(?:\.\d+)?)\b/i);
  if (to) {
    const parsed = Number(to[1]);
    if (!Number.isFinite(parsed)) return null;
    return { value: String(Math.round(parsed)), unit: "" };
  }
  return null;
}

function detectSelector(text: string): string {
  const lower = text.toLowerCase();
  if (/\bset\s*(the\s*)?fee\b|\bsetfee\b/.test(lower)) return SELECTORS.setFee;
  if (/\btransfer ownership\b|\btransferownership\b/.test(lower)) return SELECTORS.transferOwnership;
  if (/\bapprove\b/.test(lower)) return SELECTORS.approve;
  if (/\bmulticall\b/.test(lower)) return SELECTORS.multicall;
  if (/\bupgrade\b/.test(lower)) return SELECTORS.upgradeTo;
  const fn = text.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
  if (fn && SELECTORS[fn[1]]) return SELECTORS[fn[1]];
  return "";
}

function resolveTokenAddress(asset: string, known: Record<string, string>): string {
  const lower = asset.toLowerCase();
  const exact = Object.entries(known).find(([name]) => name.toLowerCase() === lower);
  if (exact) return exact[1];
  const partial = Object.entries(known).find(([name]) =>
    name.toLowerCase().includes(lower)
  );
  return partial ? partial[1] : "";
}

function findKnownMentions(
  text: string,
  known: Record<string, string>
): { name: string; address: string }[] {
  const mentions: { name: string; address: string }[] = [];
  for (const [name, address] of Object.entries(known)) {
    const words = name
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[\s_-]+/)
      .filter((word) => word.length >= 3);
    if (words.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(text))) {
      mentions.push({ name, address });
    }
  }
  return mentions;
}

function findKnownMention(
  text: string,
  known: Record<string, string>
): { name: string; address: string } | null {
  return findKnownMentions(text, known)[0] ?? null;
}

function extractAddresses(text: string): string[] {
  const matches = text.match(/0x[0-9a-fA-F]{40}/g) ?? [];
  return unique(matches.map((address) => address.toLowerCase()));
}

function extractHash32(text: string): string | null {
  const match = text.match(/0x[0-9a-fA-F]{64}/);
  return match ? match[0].toLowerCase() : null;
}

function extractTitle(text: string): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const cleaned = firstLine
    .replace(/^#+\s*/, "")
    .replace(/^(proposal|title)\s*[:\-]\s*/i, "")
    .trim();
  if (cleaned) return cleaned;
  return (splitSentences(text)[0]?.text ?? "Untitled proposal").slice(0, 120);
}

function detectSection(text: string): string {
  const match = text.match(/(?:section|§)\s*([0-9]+(?:\.[0-9]+)*)/i);
  return match ? match[1] : "1";
}

function looksLikeTitle(text: string): boolean {
  if (/^(proposal|title)\s*[:\-]/i.test(text)) return true;
  return (
    text.length <= 80 &&
    !/0x[0-9a-fA-F]{40}/.test(text) &&
    !/\d+\s*(usdc|usdt|dai|eth|weth|bps|%)/i.test(text)
  );
}

function splitSentences(
  text: string
): { text: string; start: number; end: number }[] {
  const sentences: { text: string; start: number; end: number }[] = [];
  let start = 0;

  const push = (raw: string, offset: number) => {
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const begin = offset + leading;
    sentences.push({ text: trimmed, start: begin, end: begin + trimmed.length });
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    let boundary = false;
    if (char === "\n") {
      boundary = true;
    } else if (char === "." || char === "!" || char === "?") {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) boundary = true;
    }
    if (!boundary) continue;
    push(text.slice(start, i + 1), start);
    start = i + 1;
  }
  if (start < text.length) push(text.slice(start), start);
  return sentences;
}

function locateQuote(text: string, quote: string): [number, number] | null {
  const needle = quote.trim();
  if (!needle) return null;
  const direct = text.indexOf(needle);
  if (direct >= 0) return [direct, direct + needle.length];
  const lower = text.toLowerCase().indexOf(needle.toLowerCase());
  if (lower >= 0) return [lower, lower + needle.length];
  return null;
}

function findKeywordSpan(text: string, kind: ActionKindName): [number, number] | null {
  const keywords: Record<ActionKindName, RegExp> = {
    ERC20_TRANSFER: /\b(transfer|send|pay|disburse)\b/i,
    ERC20_APPROVE: /\b(approve|approval|allowance)\b/i,
    PARAM_SET: /\b(fee|parameter|bps|tune)\b/i,
    UPGRADE: /\b(upgrade|implementation)\b/i,
    OWNERSHIP_TRANSFER: /\b(ownership|owner)\b/i,
    MULTICALL: /\b(multicall|batch|bundle)\b/i,
  };
  const sentence = splitSentences(text).find((item) => keywords[kind].test(item.text));
  return sentence ? [sentence.start, sentence.end] : null;
}

function normalizeSelector(value: unknown, kind: ActionKindName): string {
  const selector = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (/^0x[0-9a-f]{8}$/.test(selector)) return selector;
  return KIND_SELECTORS[kind] ?? "";
}

function normalizeIntegerString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value !== "string") return "";
  const cleaned = value.trim().replace(/,/g, "");
  return /^\d+$/.test(cleaned) ? cleaned : "";
}

function normalizeCodeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hash = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(hash) ? hash.toLowerCase() : null;
}

function resolveAddress(
  value: unknown,
  known: Record<string, string>
): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (ethers.isAddress(value.trim())) return normalized;
  const entry = Object.entries(known).find(
    ([name]) => name.toLowerCase() === normalized
  );
  return entry ? entry[1].toLowerCase() : "";
}

function normalizeKnown(
  known?: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, address] of Object.entries(known ?? {})) {
    if (typeof address === "string" && ethers.isAddress(address)) {
      out[name] = address;
    }
  }
  return out;
}

function requiresCounterparty(kind: ActionKindName): boolean {
  return (
    kind === "ERC20_TRANSFER" ||
    kind === "ERC20_APPROVE" ||
    kind === "UPGRADE" ||
    kind === "OWNERSHIP_TRANSFER"
  );
}

function scoreAction(
  hasTarget: boolean,
  hasCounterparty: boolean,
  hasAmount: boolean,
  hasUnresolved: boolean
): number {
  let score = 0.45;
  if (hasTarget) score += 0.2;
  if (hasCounterparty) score += 0.15;
  if (hasAmount) score += 0.15;
  if (hasUnresolved) score -= 0.2;
  return Math.round(clamp(score, 0.2, 0.95) * 100) / 100;
}

function dedupeUnresolved(items: UnresolvedItem[]): UnresolvedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.question)) return false;
    seen.add(item.question);
    return true;
  });
}

function dedupeAssumptions(items: Assumption[]): Assumption[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function sameAddress(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function deploymentName(): string {
  if (process.env.SENTINEL_NETWORK) return process.env.SENTINEL_NETWORK;
  if (process.env.NEXT_PUBLIC_CHAIN_ID === "11155111") return "sepolia";
  return "local";
}

function loadKnownAddresses(): Record<string, string> {
  try {
    const manifestPath = path.join(
      __dirname,
      "..",
      "deployments",
      `${deploymentName()}.json`
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      contracts?: Record<string, { address?: string }>;
    };
    const out: Record<string, string> = {};
    for (const [name, entry] of Object.entries(manifest.contracts ?? {})) {
      if (entry && typeof entry.address === "string") out[name] = entry.address;
    }
    return out;
  } catch {
    return {};
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  const offline = args.includes("--offline");
  const rawText = file ? fs.readFileSync(file, "utf8") : SAMPLE_PROPOSAL;

  extractIntentDetailed(rawText, {
    offline,
    knownAddresses: loadKnownAddresses(),
  })
    .then((result) => {
      // Metadata on stderr keeps stdout as pure Intent JSON for piping.
      console.error(
        JSON.stringify(
          {
            mode: result.mode,
            model: result.model,
            latencyMs: result.latencyMs,
            warnings: result.warnings,
          },
          null,
          2
        )
      );
      console.log(JSON.stringify(result.intent, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
