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
import { MAX_LOOKUP_SITES, type BriefDraft, type BriefStage } from "@/lib/intake/brief";
import { listJoin } from "@/lib/format";
import { coveredBy, ownDomains, siteFields } from "@/lib/sov/citations";
import { MAX_QUESTION_COUNT, readSiteChanges } from "@/lib/sov/intake";
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
    otherSites: brief.otherSites ? [...brief.otherSites] : undefined,
    topics: [...(brief.topics ?? [])],
    count,
  };
}

/**
 * Once the user confirms the draft, its empty fields stay empty. Pip still asks about the website, even
 * when the draft has one, since citations of the user's own sites are what Kioku tracks, then the count.
 */
export function acceptDraft(state: IntakeState): { state: IntakeState; next: IntakeNext } {
  const skipped = OPTIONAL_FIELDS.filter((field) => field !== "count" && field !== "website" && !filled(state, field));
  const next: IntakeState = { ...state, skipped: [...new Set([...state.skipped, ...skipped])] };
  return { state: next, next: "website" };
}

export function toBrief(state: IntakeState): Brief {
  return {
    product: state.product,
    category: state.category,
    audience: state.audience,
    competitors: state.competitors,
    website: state.website,
    otherSites: state.otherSites?.length ? [...state.otherSites] : undefined,
    topics: state.topics.length ? [...state.topics] : undefined,
  };
}

const boldList = (items: string[]) => listJoin(items.map((item) => `**${item}**`));

export const SITES_COPY = {
  kept: "Perfect.",
  unclear: "I couldn't spot a web address in that. List your sites, like acme.com, or say “that's all”.",
};

/** Settles the brand's own sites once Pip has asked about them. No sites means the website is skipped. */
export function settleSites(state: IntakeState, sites: string[] | "keep"): { state: IntakeState; next: IntakeNext; text: string } {
  const s: IntakeState = { ...state, skipped: state.skipped.filter((field) => field !== "website") };
  if (sites !== "keep") Object.assign(s, siteFields(sites));
  if (!s.website) s.skipped.push("website");
  const said = !s.website
    ? SKIPPED.website.skip
    : sites === "keep"
      ? SITES_COPY.kept
      : `Got it: I'll count citations of ${boldList(ownDomains(s))} as yours.`;
  const next = nextField(s);
  return { state: s, next, text: next === "review" ? said : `${said} ${questionFor(next, s)}` };
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
    case "website": {
      const sites = ownDomains(state);
      if (!sites.length) {
        return "What's your website? It's how I tell when assistants cite you, so it's worth adding. Got more than one? List them all. No site yet? Just skip.";
      }
      return `I'll count citations of ${boldList(sites)} as yours, subdomains included. Got any other sites, like a separate docs or blog domain? List them, fix ${sites.length > 1 ? "these" : "that one"} if it's wrong, or say “that's all”.`;
    }
    case "topics":
      return `What should I focus on? Name up to five areas, like ${quoted(topicExamples(state.category))}, and I'll split the questions across them. Or skip for a broad check.`;
    case "count":
      return `Last one: how many questions should I ask each AI? Pick 10, 25, 50 or 100, or any number up to ${MAX_QUESTION_COUNT}.`;
  }
}

const CHECK_BRIEF = "Here's the brief I'd use. Tell me anything to change, or say it looks right.";
const WHAT_IS_IT = "What is it, in a few words? Something like “plant care app” or “CRM for small agencies” works.";

/** Pip's lines for a drafted brief, used when the model's own message can't be. `searched`: a lookup found nothing. */
export function draftLine(brief: BriefDraft, { known, web = false, searched = false }: { known: boolean; web?: boolean; searched?: boolean }): string {
  if (!known) {
    const opener = searched ? `I couldn't find much about **${brief.product}** online` : `I don't know **${brief.product}** yet`;
    return `${opener}, so I went by what you said. ${CHECK_BRIEF}`;
  }
  const what = brief.description ?? withArticle(brief.category);
  return `${web ? "I looked it up. Is it" : "Do you mean"} **${brief.product}**, ${what}? ${CHECK_BRIEF}`;
}

export const ambiguousLine = (name: string) => `**${name}** could be a few different things. Which one do you mean? Pick one below or say it in a few words.`;
export const unknownLine = (name: string, lookedUp: boolean) =>
  lookedUp ? `I couldn't find **${name}** online, so I'll need your help. ${WHAT_IS_IT}` : `I don't know **${name}** yet. ${WHAT_IS_IT}`;

/** Lookups in one intake: when Pip first meets the brand, then for a site it hasn't read or rivals the user turned down. */
export const MAX_LOOKUPS = 3;

/** What Pip has looked up about the brand so far, so it never reads the same site twice. */
export interface Research {
  /** A lookup can run at all: there's a model with web search, and room in today's budget. */
  available: boolean;
  /** Pip knew the brand or found it online, so the sites its brief lists are already right. */
  known: boolean;
  /** Sites Pip has tried to read. */
  read: string[];
  lookups: number;
}

export const NO_RESEARCH: Research = { available: false, known: false, read: [], lookups: 0 };

/**
 * "unknown": Pip doesn't know the brand. "site": the user gave a site Pip hasn't read. "rivals": the user
 * turned down the rivals (`rejected`). `sites` are the brand's sites to read first.
 */
export interface ResearchPlan {
  why: "unknown" | "site" | "rivals";
  sites: string[];
  rejected: string[];
}

const canResearch = (research: Research) => research.available && research.lookups < MAX_LOOKUPS;
const unread = (sites: string[], skip: string[]) => sites.filter((site) => !coveredBy(site, skip)).slice(0, MAX_LOOKUP_SITES);

/** Sites in a reply that Pip hasn't read. Once it knows the brand, sites its brief already lists are skipped too. */
export function sitesToRead(words: string, research: Research, brief?: Brief): string[] {
  const listed = research.known && brief ? ownDomains(brief) : [];
  return unread(readSiteChanges(words).add, [...research.read, ...listed]);
}

const RIVALS = String.raw`(?:rivals?|competitors?|competition)`;
const REJECTS_RIVALS = [
  new RegExp(String.raw`\b(?:wrong|bad|incorrect|irrelevant|better|real|actual|different)\s+${RIVALS}\b`),
  new RegExp(
    String.raw`\b${RIVALS}\b[^.,;!?]{0,25}?\b(?:wrong|incorrect|irrelevant|rubbish|nonsense|not\s+(?:right|correct|relevant)|(?:are|look|seem)\s+(?:way\s+|totally\s+|a\s+bit\s+)?off|(?:aren'?t|are\s+not)\s+(?:right|correct|relevant)|(?:don'?t|do\s+not)\s+make\s+sense)\b`,
  ),
  new RegExp(String.raw`\b(?:aren'?t|are\s+not|not)\s+(?:its\s+|their\s+|the\s+)?(?:right\s+|real\s+|actual\s+)?${RIVALS}\b`),
];

/** "wrong rivals", "these aren't its competitors": the user turned down the rivals Pip suggested. */
export function rejectsRivals(text: string): boolean {
  const reply = text.toLowerCase().replace(/[’‘]/g, "'");
  return REJECTS_RIVALS.some((pattern) => pattern.test(reply));
}

/**
 * Whether to look up a brand Pip has just met: one it doesn't know (no `draft`, or a draft from the user's
 * words), or one the user gave a site for that its draft doesn't list, which may mean a different brand.
 */
export function draftResearch(words: string, research: Research, draft?: { known: boolean; brief: Brief }): ResearchPlan | null {
  if (!canResearch(research)) return null;
  const known = draft?.known ?? false;
  const sites = sitesToRead(words, { ...research, known }, draft?.brief);
  if (known && !sites.length) return null;
  return { why: known ? "site" : "unknown", sites, rejected: [] };
}

/**
 * Whether a reply about the brief calls for a lookup: a site Pip hasn't read, or rivals the user turned down.
 * On the website question and the plan, adding domains is expected, so a new site only counts for a brand Pip doesn't know.
 */
export function replyResearch(text: string, research: Research, brief: Brief, stage: BriefStage = "confirm"): ResearchPlan | null {
  if (!canResearch(research)) return null;
  const sites = stage === "confirm" || !research.known ? sitesToRead(text, research, brief) : [];
  const rejected = rejectsRivals(text) ? [...brief.competitors] : [];
  if (sites.length) return { why: "site", sites, rejected };
  if (!rejectsRivals(text)) return null;
  return { why: "rivals", sites: unread(ownDomains(brief), research.read), rejected };
}

export const researched = (research: Research, sites: string[], found: boolean): Research => ({
  ...research,
  known: research.known || found,
  read: [...new Set([...research.read, ...sites])],
  lookups: research.lookups + 1,
});

export function researchLine(name: string, { why, sites }: ResearchPlan): string {
  const read = sites.length ? `read ${boldList(sites)} and ` : "";
  if (why === "unknown") return `I don't know **${name}** yet, so let me ${read}look it up…`;
  if (why === "site") return `Let me ${read}look **${name}** up, so the brief's right…`;
  return `Let me ${read}look into who **${name}** really competes with…`;
}

/** Pip's line for a brief it looked up, used when the model's own message can't be. Next to the plan, there's no brief card to check. */
export function researchedLine(brief: BriefDraft, { why }: ResearchPlan, stage: BriefStage = "confirm"): string {
  const done =
    why === "rivals" ? `I looked into who **${brief.product}** competes with and updated the rivals.` : `I looked **${brief.product}** up and updated the brief.`;
  if (stage === "plan") return done;
  if (why === "rivals") return `${done} Anything else to change, or does it look right?`;
  return draftLine(brief, { known: true, web: true });
}

export const researchFailedLine = (name: string, { why }: ResearchPlan) =>
  why === "rivals" ? `I couldn't find better rivals for **${name}** online just now.` : `I couldn't find more about **${name}** online just now.`;

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
      if (key === "website") {
        if (values.website) {
          Object.assign(s, siteFields([values.website, ...(values.otherSites ?? [])]));
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
    if (field === "website") Object.assign(s, siteFields([]));
    if (field === "count") s.count = undefined;
  }

  const next = nextField(s);
  const messages =
    turn.message && turn.asks === next ? [{ text: turn.message, mood: MOODS[next] }] : rulesLines(s, field, outcome, next, turn);
  return { state: s, next, messages };
}
