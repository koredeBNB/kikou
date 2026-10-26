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
import { listJoin } from "@/lib/format";
import type { Brief } from "@/lib/sov/types";

export function emptyIntake(): IntakeState {
  return { product: "", category: "", audience: "", competitors: [], skipped: [], nudged: [] };
}

function filled(state: IntakeState, field: IntakeField): boolean {
  if (field === "competitors") return state.competitors.length > 0;
  if (field === "website") return Boolean(state.website);
  return Boolean(state[field]);
}

export function nextField(state: IntakeState): IntakeNext {
  return INTAKE_FIELDS.find((field) => !filled(state, field) && !state.skipped.includes(field)) ?? "review";
}

export function toBrief(state: IntakeState): Brief {
  return {
    product: state.product,
    category: state.category,
    audience: state.audience,
    competitors: state.competitors,
    website: state.website,
  };
}

const withArticle = (noun: string) => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
const forAudience = (state: IntakeState) => (state.audience ? ` for ${state.audience}` : "");
const WHO_FOR = "Who is it for? Describe your typical buyer, or skip if it's for everyone.";

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
      return "Last one: what's your website? It helps me notice when assistants cite you. No site yet? Just skip.";
  }
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
};

const SKIPPED: Record<"audience" | "competitors" | "website", { skip: string; gaveUp: string }> = {
  audience: { skip: "No problem, I'll keep the questions general.", gaveUp: "No problem, I'll keep the questions general." },
  competitors: {
    skip: "No problem, I'll spot your competitors in the answers.",
    gaveUp: "I still couldn't pick out any brand names, so I'll spot your competitors in the answers instead.",
  },
  website: { skip: "No problem, we'll go without it.", gaveUp: "No problem, we'll go without it." },
};

type Outcome =
  | { kind: "filled"; fields: IntakeField[]; declined: OptionalField[] }
  | { kind: "skipped" | "gave-up" | "unclear" | "skip-required" };

function rulesLines(state: IntakeState, field: IntakeField, outcome: Outcome, next: IntakeNext, partial: boolean): PipLine[] {
  const ask = (lines: PipLine[]) => (next === "review" ? lines : [...lines, { text: questionFor(next, state) }]);
  switch (outcome.kind) {
    case "skip-required":
      return [{ text: SKIP_REQUIRED[field as "product" | "category"] }];
    case "unclear":
      return [{ text: UNCLEAR[field] }];
    case "skipped":
    case "gave-up": {
      const copy = SKIPPED[field as keyof typeof SKIPPED];
      return ask([{ text: outcome.kind === "skipped" ? copy.skip : copy.gaveUp }]);
    }
    case "filled": {
      const lines: PipLine[] = [];
      const { product, category } = state;
      if (outcome.fields.includes("product")) {
        if (next === "category") {
          return [{ text: `Lovely to meet **${product}**! What kind of product is it? A short category works best, like “CRM” or “plant care app”.`, mood: "wave" }];
        }
        if (next === "audience") return [{ text: `**${product}**, ${withArticle(category)}. Lovely! ${WHO_FOR}`, mood: "wave" }];
        lines.push({ text: `Lovely: **${product}**, ${withArticle(category)}${forAudience(state)}.`, mood: "happy" });
      } else if (outcome.fields.includes("category")) {
        if (next === "audience") return [{ text: `Got it, ${withArticle(category)}. ${WHO_FOR}`, mood: "wave" }];
        lines.push({ text: `Got it, ${withArticle(category)}${forAudience(state)}.` });
      }
      if (outcome.fields.includes("competitors")) {
        lines.push({
          text: `Noted. I'll watch ${listJoin(state.competitors)}${partial ? " and spot any others in the answers" : ""}.`,
        });
      }
      if (outcome.declined.includes("competitors")) lines.push({ text: SKIPPED.competitors.skip });
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
  const s: IntakeState = { ...state, competitors: [...state.competitors], skipped: [...state.skipped], nudged: [...state.nudged] };
  const fields: IntakeField[] = [];
  const set = (key: IntakeField) => {
    fields.push(key);
    s.skipped = s.skipped.filter((f) => f !== key);
  };

  if (turn.intent === "answer") {
    const { values } = turn;
    for (const key of INTAKE_FIELDS) {
      if (key !== field && filled(s, key)) continue;
      if (key === "competitors") {
        if (values.competitors?.length) {
          s.competitors = values.competitors;
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
    if (field === "audience") s.audience = "";
    if (field === "website") s.website = undefined;
  }

  const next = nextField(s);
  const messages =
    turn.message && turn.asks === next
      ? [{ text: turn.message, mood: MOODS[next] }]
      : rulesLines(s, field, outcome, next, Boolean(turn.partial));
  return { state: s, next, messages };
}
