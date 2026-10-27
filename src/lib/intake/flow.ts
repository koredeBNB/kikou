import {
  INTAKE_FIELDS,
  OPTIONAL_FIELDS,
  REQUIRED_FIELDS,
  type IntakeField,
  type IntakeNext,
  type IntakeState,
  type IntakeTurn,
  type OptionalField,
  type PipLine,
} from "@/lib/intake/types";
import type { BriefDraft } from "@/lib/intake/brief";
import { listJoin } from "@/lib/format";
import { MAX_QUESTION_COUNT } from "@/lib/sov/intake";
import type { Brief } from "@/lib/sov/types";

export const DEFAULT_QUESTION_COUNT = 10;

export function emptyIntake(): IntakeState {
  return { product: "", category: "", audience: "", competitors: [], topics: [], skipped: [], nudged: [] };
}

function filled(state: IntakeState, field: IntakeField): boolean {
  switch (field) {
    case "competitors":
      return state.competitors.length > 0;
    case "topics":
      return state.topics.length > 0;
    case "count":
      return state.count !== undefined;
    case "website":
      return Boolean(state.website);
    default:
      return Boolean(state[field]);
  }
}

export function nextField(state: IntakeState): IntakeNext {
  return INTAKE_FIELDS.find((field) => !filled(state, field) && !state.skipped.includes(field)) ?? "review";
}

/** Questions per assistant: the user's number, or the default when they skipped it. */
export const questionCount = (state: IntakeState) => state.count ?? DEFAULT_QUESTION_COUNT;

/** The intake state for a brief Pip drafted, before the user has confirmed it. */
export function draftIntake(brief: Brief, count?: number): IntakeState {
  return {
    ...emptyIntake(),
    product: brief.product,
    category: brief.category,
    audience: brief.audience,
    competitors: [...brief.competitors],
    website: brief.website,
    topics: [...(brief.topics ?? [])],
    count,
  };
}

/**
 * Once the user confirms the draft, its empty fields stay empty, except the website and the question count,
 * which Pip still asks for: the website is what citations of the user's own site are counted against.
 */
export function acceptDraft(state: IntakeState): { state: IntakeState; next: IntakeNext } {
  const skipped = OPTIONAL_FIELDS.filter((field) => field !== "count" && field !== "website" && !filled(state, field));
  const next: IntakeState = { ...state, skipped: [...new Set([...state.skipped, ...skipped])] };
  return { state: next, next: nextField(next) };
}

export function toBrief(state: IntakeState): Brief {
  return {
    product: state.product,
    category: state.category,
    audience: state.audience,
    competitors: state.competitors,
    website: state.website,
    topics: state.topics.length ? [...state.topics] : undefined,
  };
}

const TOPIC_EXAMPLES: [RegExp, string[]][] = [
  [/crypto|wallet|exchange|defi|blockchain|token|bitcoin|web3|nft/i, ["security", "staking", "DeFi"]],
  [/\bcrm\b|sales/i, ["pipeline management", "reporting", "integrations"]],
  [/analytics|tracking/i, ["privacy", "dashboards", "pricing"]],
  [/bank|financ|accounting|invoic|payment|budget/i, ["fees", "invoicing", "security"]],
  [/plant|garden/i, ["watering reminders", "plant ID", "pest control"]],
  [/project|task|productivity/i, ["collaboration", "time tracking", "integrations"]],
  [/\bai\b|writing|chatbot/i, ["accuracy", "privacy", "pricing"]],
  [/shoe|apparel|fashion|clothing/i, ["comfort", "durability", "price"]],
];

/** Focus areas Pip suggests for a category. */
export function topicExamples(category: string): string[] {
  return TOPIC_EXAMPLES.find(([pattern]) => pattern.test(category))?.[1] ?? ["pricing", "ease of use", "integrations"];
}

const quoted = (items: string[]) => {
  const parts = items.map((item) => `“${item}”`);
  return `${parts.slice(0, -1).join(", ")} or ${parts.at(-1)}`;
};

const withArticle = (noun: string) => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
const forAudience = (state: IntakeState) => (state.audience ? ` for ${state.audience}` : "");
const WHO_FOR = "Who is it for? Describe your typical buyer, or skip if it's for everyone.";
const questions = (n: number) => `${n} question${n === 1 ? "" : "s"}`;

/** Pip's standard question for a field. */
export function questionFor(field: IntakeField, state: IntakeState): string {
  switch (field) {
    case "product":
      return "What's your product called? A working name is fine.";
    case "category":
      return `What kind of product is **${state.product}**? A short category works best, like “CRM” or “plant care app”.`;
    case "audience":
      return WHO_FOR;
    case "competitors":
      return "Which competitors should I keep an eye on? List a few, separated by commas, or skip and I'll spot them in the answers.";
    case "website":
      return "What's your website? It's how I tell when assistants cite you, so it's worth adding. No site yet? Just skip.";
    case "topics":
      return `What should I focus on? Name up to five areas, like ${quoted(topicExamples(state.category))}, and I'll split the questions across them. Or skip for a broad check.`;
    case "count":
      return `Last one: how many questions should I ask each AI? Pick 10, 25, 50 or 100, or any number up to ${MAX_QUESTION_COUNT}.`;
  }
}

const CHECK_BRIEF = "Here's the brief I'd use. Tell me anything to change, or say it looks right.";
const WHAT_IS_IT = "What is it, in a few words? Something like “plant care app” or “CRM for small agencies” works.";

/** Pip's lines for a drafted brief, used when the model's own message can't be. */
export function draftLine(brief: BriefDraft, { known, web = false }: { known: boolean; web?: boolean }): string {
  if (!known) return `I don't know **${brief.product}** yet, so I went by what you said. ${CHECK_BRIEF}`;
  const what = brief.description ?? withArticle(brief.category);
  return `${web ? "I looked it up. Is it" : "Do you mean"} **${brief.product}**, ${what}? ${CHECK_BRIEF}`;
}

export const ambiguousLine = (name: string) => `**${name}** could be a few different things. Which one do you mean? Pick one below or say it in a few words.`;
export const lookingUpLine = (name: string) => `I don't know **${name}** yet, so let me look it up…`;
export const unknownLine = (name: string, lookedUp: boolean) =>
  lookedUp ? `I couldn't find **${name}** online, so I'll need your help. ${WHAT_IS_IT}` : `I don't know **${name}** yet. ${WHAT_IS_IT}`;

export const BRIEF_COPY = {
  rejected: "No problem. What should I change? You can fix anything, like “I meant the token” or “drop Solana, add Base”.",
  unclear: "Sorry, I didn't catch what to change. Try something like “add Base” or “focus on RWA and AI”, or say it looks right.",
  changed: "Done. Here's the updated brief. Anything else to change?",
  failed: "Sorry, I couldn't update the brief just now. Try again, or say it looks right to carry on.",
  accepted: "Great, that's the brief sorted.",
  nearly: "Great, nearly there.",
  planUnclear:
    "I can add a buyer question or change the brief. Try “Which wallet has the lowest fees?” or “add Base as a rival”, or press **Ask** on the plan to start.",
  planAccepted: "Lovely. Press **Ask** on the plan whenever you're ready, or say “go”.",
  planReady: "Press **Ask** on the plan below when you're ready.",
  planChanged: "Done, the plan's updated.",
};

/** What Pip says once the brief is confirmed, ending with the next question if there is one. */
export function acceptedLine(state: IntakeState, next: IntakeNext): string {
  if (next === "review") return BRIEF_COPY.accepted;
  return `${next === "website" ? BRIEF_COPY.nearly : BRIEF_COPY.accepted} ${questionFor(next, state)}`;
}

const SKIP_REQUIRED: Record<"product" | "category", string> = {
  product: "Let's start with the name. What's your product called? A working name is fine.",
  category:
    "No worries. Think of what a buyer would type into a search box, like “CRM”, “plant care app” or “running shoes”. What would yours be?",
};

const UNCLEAR: Record<IntakeField, string> = {
  product:
    "I couldn't spot a product name in that. What's it called? Just the name works, like “Acme”, or add what it is: “Acme, a CRM for small agencies”.",
  category: "Could you say that in a few words? Something like “plant care app” or “CRM” works best.",
  audience: "Could you sum that up in a few words? Something like “small agencies” or “new plant parents”.",
  competitors:
    "I couldn't pick out any brand names there. Could you list them, like “HubSpot, Pipedrive”? Or skip and I'll spot them in the answers.",
  website: "I couldn't spot a web address in that. Try something like acme.com, or skip.",
  topics: "Could you list a few focus areas, separated by commas, like “pricing, integrations”? Or skip for a broad check.",
  count: `How many questions should I ask each AI? Any number from 1 to ${MAX_QUESTION_COUNT} works, like 10, 25, 50 or 100.`,
};

const BROAD = "I'll run a broad check across the whole category.";
const SKIPPED: Record<OptionalField, { skip: string; gaveUp: string }> = {
  audience: { skip: "No problem, I'll keep the questions general.", gaveUp: "No problem, I'll keep the questions general." },
  competitors: {
    skip: "No problem, I'll spot your competitors in the answers.",
    gaveUp: "I still couldn't pick out any brand names, so I'll spot your competitors in the answers instead.",
  },
  website: { skip: "No problem, we'll go without it.", gaveUp: "No problem, we'll go without it." },
  topics: { skip: `No problem, ${BROAD}`, gaveUp: `I couldn't pick out any focus areas, so ${BROAD}` },
  count: {
    skip: `No problem, I'll ask ${questions(DEFAULT_QUESTION_COUNT)}.`,
    gaveUp: `I couldn't spot a number there, so I'll ask ${questions(DEFAULT_QUESTION_COUNT)}.`,
  },
};

type Outcome =
  | { kind: "filled"; fields: IntakeField[]; declined: OptionalField[] }
  | { kind: "skipped" | "gave-up" | "unclear" | "skip-required" };

function rulesLines(
  state: IntakeState,
  field: IntakeField,
  outcome: Outcome,
  next: IntakeNext,
  turn: Pick<IntakeTurn, "partial" | "capped">,
): PipLine[] {
  const ask = (lines: PipLine[]) => (next === "review" ? lines : [...lines, { text: questionFor(next, state) }]);
  switch (outcome.kind) {
    case "skip-required":
      return [{ text: SKIP_REQUIRED[field as "product" | "category"] }];
    case "unclear":
      return [{ text: UNCLEAR[field] }];
    case "skipped":
    case "gave-up": {
      const copy = SKIPPED[field as OptionalField];
      return ask([{ text: outcome.kind === "skipped" ? copy.skip : copy.gaveUp }]);
    }
    case "filled": {
      const lines: PipLine[] = [];
      const { product, category } = state;
      const gotTopics = outcome.fields.includes("topics");
      const focus = gotTopics && field !== "topics" ? `I'll focus on ${listJoin(state.topics)}. ` : "";
      if (outcome.fields.includes("product")) {
        if (next === "category") {
          return [
            {
              text: `Lovely to meet **${product}**! ${focus}What kind of product is it? A short category works best, like “CRM” or “plant care app”.`,
              mood: "wave",
            },
          ];
        }
        if (next === "audience") return [{ text: `**${product}**, ${withArticle(category)}. Lovely! ${focus}${WHO_FOR}`, mood: "wave" }];
        lines.push({ text: `Lovely: **${product}**, ${withArticle(category)}${forAudience(state)}.`, mood: "happy" });
      } else if (outcome.fields.includes("category")) {
        if (next === "audience") return [{ text: `Got it, ${withArticle(category)}. ${focus}${WHO_FOR}`, mood: "wave" }];
        lines.push({ text: `Got it, ${withArticle(category)}${forAudience(state)}.` });
      }
      if (outcome.fields.includes("competitors")) {
        lines.push({
          text: `Noted. I'll watch ${listJoin(state.competitors)}${turn.partial ? " and spot any others in the answers" : ""}.`,
        });
      }
      if (outcome.declined.includes("competitors")) lines.push({ text: SKIPPED.competitors.skip });
      if (gotTopics) {
        lines.push({
          text: field === "topics" ? `Got it. I'll split the questions evenly across ${listJoin(state.topics)}.` : focus.trim(),
        });
      }
      if (outcome.fields.includes("count")) {
        lines.push({
          text: turn.capped
            ? `${MAX_QUESTION_COUNT} is the most I can ask in one check, so I'll ask ${MAX_QUESTION_COUNT}.`
            : `Got it, ${questions(questionCount(state))} for each assistant.`,
        });
      }
      return ask(lines);
    }
  }
}

const MOODS: Partial<Record<IntakeNext, PipLine["mood"]>> = { category: "wave", audience: "wave", review: "happy" };

/**
 * Merges one understood reply into the intake state and decides what Pip says next. The flow is
 * deterministic: the model's message is only used when it asks for the field this function picks.
 */
export function applyTurn(
  state: IntakeState,
  field: IntakeField,
  turn: IntakeTurn,
): { state: IntakeState; next: IntakeNext; messages: PipLine[] } {
  const s: IntakeState = {
    ...state,
    competitors: [...state.competitors],
    topics: [...state.topics],
    skipped: [...state.skipped],
    nudged: [...state.nudged],
  };
  const fields: IntakeField[] = [];
  const set = (key: IntakeField) => {
    fields.push(key);
    s.skipped = s.skipped.filter((f) => f !== key);
  };

  if (turn.intent === "answer") {
    const { values } = turn;
    for (const key of INTAKE_FIELDS) {
      if (key !== field && filled(s, key)) continue;
      if (key === "competitors" || key === "topics") {
        const list = values[key];
        if (list?.length) {
          s[key] = [...list];
          set(key);
        }
        continue;
      }
      if (key === "count") {
        if (values.count !== undefined) {
          s.count = values.count;
          set(key);
        }
        continue;
      }
      const value = values[key];
      if (value) {
        s[key] = value;
        set(key);
      }
    }
  }

  const declined = (turn.skips ?? []).filter(
    (key) => OPTIONAL_FIELDS.includes(key) && key !== field && !filled(s, key) && !s.skipped.includes(key),
  );
  s.skipped.push(...declined);

  const required = REQUIRED_FIELDS.includes(field);
  let outcome: Outcome;
  if (fields.includes(field)) {
    outcome = { kind: "filled", fields, declined };
  } else if (turn.intent === "skip") {
    outcome = { kind: required ? "skip-required" : "skipped" };
  } else if (required || !s.nudged.includes(field)) {
    if (!s.nudged.includes(field)) s.nudged.push(field);
    outcome = { kind: "unclear" };
  } else {
    outcome = { kind: "gave-up" };
  }

  if (outcome.kind === "skipped" || outcome.kind === "gave-up") {
    if (!s.skipped.includes(field)) s.skipped.push(field);
    if (field === "competitors") s.competitors = [];
    if (field === "topics") s.topics = [];
    if (field === "audience") s.audience = "";
    if (field === "website") s.website = undefined;
    if (field === "count") s.count = undefined;
  }

  const next = nextField(s);
  const messages =
    turn.message && turn.asks === next ? [{ text: turn.message, mood: MOODS[next] }] : rulesLines(s, field, outcome, next, turn);
  return { state: s, next, messages };
}
