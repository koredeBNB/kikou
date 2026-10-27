import { describe, expect, it } from "vitest";
import {
  buildIdentifyPrompt,
  buildRevisePrompt,
  IDENTIFY_SYSTEM_PROMPT,
  LOOKUP_SYSTEM_PROMPT,
  parseIdentified,
  parseRevision,
  sameBrief,
  type BriefDraft,
} from "@/lib/intake/brief";

const BNB_REPLY = "bnb chain , more specifically the rwa , trading and ai sector";

const known = (patch: Record<string, unknown> = {}) => ({
  recognized: "yes",
  name: "BNB Chain",
  description: "the Layer 1 blockchain behind the BNB token",
  category: "layer 1 blockchain",
  website: "bnbchain.org",
  audience: "web3 developers and traders",
  competitors: ["Ethereum", "Solana", "Polygon", "Avalanche", "Arbitrum", "Sui"],
  topics: ["RWA tokenization", "trading", "AI"],
  alternatives: [],
  count: null,
  message: "Do you mean **BNB Chain**, the Layer 1 blockchain behind the BNB token? Check the brief below.",
  ...patch,
});

const unknownOutput = (patch: Record<string, unknown> = {}) => ({
  recognized: "no",
  name: "Fernly",
  description: null,
  category: "plant care app",
  website: null,
  audience: "new plant parents",
  competitors: ["Planta", "Greg"],
  topics: [],
  alternatives: [],
  count: null,
  message: "I don't know **Fernly** yet, so I went by what you said.",
  ...patch,
});

const BNB: BriefDraft = {
  product: "BNB Chain",
  description: "the Layer 1 blockchain behind the BNB token",
  category: "layer 1 blockchain",
  audience: "web3 developers and traders",
  website: "bnbchain.org",
  competitors: ["Ethereum", "Solana", "Polygon"],
  topics: ["RWA", "trading", "AI"],
};

const revision = (patch: Record<string, unknown> = {}, brief: Record<string, unknown> = {}) => ({
  intent: "change",
  proceed: false,
  brief: {
    product: BNB.product,
    description: BNB.description,
    category: BNB.category,
    audience: BNB.audience,
    website: BNB.website,
    competitors: BNB.competitors,
    topics: BNB.topics,
    ...brief,
  },
  question: null,
  count: null,
  message: "Done: I swapped Polygon for Base. Anything else?",
  ...patch,
});

describe("parseIdentified", () => {
  it("drafts a known brand's brief from the model, keeping five rivals and the focus areas", () => {
    expect(parseIdentified(known(), { reply: BNB_REPLY, earlier: [] })).toEqual({
      kind: "draft",
      known: true,
      brief: {
        product: "BNB Chain",
        description: "the Layer 1 blockchain behind the BNB token",
        category: "layer 1 blockchain",
        audience: "web3 developers and traders",
        website: "bnbchain.org",
        competitors: ["Ethereum", "Solana", "Polygon", "Avalanche", "Arbitrum"],
        topics: ["RWA tokenization", "trading", "AI"],
      },
      message: "Do you mean **BNB Chain**, the Layer 1 blockchain behind the BNB token? Check the brief below.",
    });
  });

  it("reads a JSON string and drops a message with a link in it", () => {
    const parsed = parseIdentified(JSON.stringify(known({ message: "See https://bnbchain.org" })), { reply: BNB_REPLY, earlier: [] });
    expect(parsed).toMatchObject({ kind: "draft", known: true });
    expect(parsed && "message" in parsed ? parsed.message : undefined).toBeUndefined();
  });

  it("only takes a question count the user asked for", () => {
    expect(parseIdentified(known({ count: 25 }), { reply: `${BNB_REPLY}, 25 questions`, earlier: [] })).toMatchObject({ count: 25 });
    expect(parseIdentified(known({ count: 500 }), { reply: `${BNB_REPLY}, 500 questions`, earlier: [] })).toMatchObject({ count: 100, capped: true });
    expect(parseIdentified(known({ count: 25 }), { reply: BNB_REPLY, earlier: [] })).not.toHaveProperty("count");
  });

  it("drafts an unknown brand from the user's own words, with rivals of that kind", () => {
    const reply = "Fernly, a plant care app for new plant parents";
    const output = unknownOutput({ description: "a plant app", website: "fernly.app", topics: ["watering", "pricing"] });
    expect(parseIdentified(output, { reply, earlier: [] })).toEqual({
      kind: "draft",
      known: false,
      brief: { product: "Fernly", category: "plant care app", audience: "new plant parents", competitors: ["Planta", "Greg"] },
      message: "I don't know **Fernly** yet, so I went by what you said.",
    });
    const withSite = parseIdentified(unknownOutput({ website: "fernly.app", topics: ["watering"] }), { reply: "Fernly, plant care app, fernly.app, watering", earlier: [] });
    expect(withSite).toMatchObject({ brief: { website: "fernly.app", topics: ["watering"] } });
  });

  it("says a brand is unknown when it can't tell what it is, without the model's message", () => {
    const output = unknownOutput({ name: "Vexorial Labs", category: null, audience: null, competitors: [], message: "I went by what you said." });
    expect(parseIdentified(output, { reply: "Vexorial Labs, focus on security", earlier: [] })).toEqual({
      kind: "unknown",
      name: "Vexorial Labs",
      topics: [],
    });
  });

  it("asks which one the user means when a name is ambiguous", () => {
    const output = {
      ...unknownOutput({ recognized: "ambiguous", name: "Mercury", category: null, audience: null, competitors: [] }),
      alternatives: ["Mercury, the business bank for startups", "Mercury, the planet", "see https://x.com", "Mercury, the NASA program", "Mercury Records"],
      message: "Which **Mercury** do you mean?",
    };
    expect(parseIdentified(output, { reply: "Mercury", earlier: [] })).toEqual({
      kind: "ambiguous",
      name: "Mercury",
      options: ["Mercury, the business bank for startups", "Mercury, the planet", "Mercury, the NASA program"],
      topics: [],
      message: "Which **Mercury** do you mean?",
    });
    const single = { ...output, alternatives: ["Mercury, the business bank for startups"] };
    expect(parseIdentified(single, { reply: "Mercury", earlier: [] })).toMatchObject({ kind: "unknown", name: "Mercury" });
  });

  it("reads a follow-up together with the earlier reply that named the brand", () => {
    const output = known({ name: "Mercury", description: "the business bank for startups", category: "business bank", website: "mercury.com", topics: [] });
    expect(parseIdentified(output, { reply: "the bank one", earlier: ["Mercury"] })).toMatchObject({ kind: "draft", known: true, brief: { product: "Mercury" } });
  });

  it("refuses a brand the model renamed unless it recognised it", () => {
    expect(parseIdentified(unknownOutput({ name: "Ferns Inc" }), { reply: "Fernly, a plant care app", earlier: [] })).toBeNull();
    expect(parseIdentified(known({ name: "BNB Chain" }), { reply: "bnb", earlier: [] })).toMatchObject({ kind: "draft", known: true });
  });

  it("needs a web lookup to find exactly the name the user wrote", () => {
    const lookup = known({ name: "Vexoria Labs", description: "a security firm", category: "security software", website: "vexoria.io", topics: [] });
    expect(parseIdentified(lookup, { reply: "Vexorial Labs", earlier: [] }, true)).toBeNull();
    expect(parseIdentified({ ...lookup, name: "VexorialLabs" }, { reply: "vexorial labs", earlier: [] }, true)).toBeNull();
    expect(parseIdentified({ ...lookup, name: "Vexorial Labs" }, { reply: "vexorial labs", earlier: [] }, true)).toMatchObject({
      kind: "draft",
      known: true,
      brief: { product: "Vexorial Labs", category: "security software", website: "vexoria.io" },
    });
    expect(parseIdentified(unknownOutput({ name: "Vexorial Labs" }), { reply: "Vexorial Labs", earlier: [] }, true)).toMatchObject({ kind: "unknown" });
  });

  it.each([
    ["not JSON", "nope"],
    ["an unknown recognized value", known({ recognized: "maybe" })],
    ["a sentence for a name", known({ name: "I think it is the blockchain one" })],
  ])("returns null for %s", (_label, output) => {
    expect(parseIdentified(output, { reply: BNB_REPLY, earlier: [] })).toBeNull();
  });
});

describe("parseRevision", () => {
  const input = { reply: "drop polygon, add base", brief: BNB, stage: "confirm" as const };

  it("returns the changed brief and Pip's message", () => {
    const parsed = parseRevision(revision({}, { competitors: ["Ethereum", "Solana", "Base"] }), input);
    expect(parsed).toEqual({
      kind: "change",
      proceed: false,
      brief: { ...BNB, competitors: ["Ethereum", "Solana", "Base"] },
      message: "Done: I swapped Polygon for Base. Anything else?",
    });
  });

  it("keeps up to eight rivals, never the product itself, and says whether to carry on", () => {
    const rivals = ["BNB Chain", "A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8", "I9"];
    const parsed = parseRevision(revision({ proceed: true }, { competitors: rivals }), { ...input, reply: "add these and go" });
    expect(parsed).toMatchObject({ kind: "change", proceed: true, brief: { competitors: ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8"] } });
  });

  it("takes a new brand's description, and keeps the old one when only other fields change", () => {
    const token = parseRevision(
      revision({}, { product: "BNB", description: "the token that powers BNB Chain", category: "crypto token" }),
      { ...input, reply: "no, I meant the token" },
    );
    expect(token).toMatchObject({ kind: "change", brief: { product: "BNB", description: "the token that powers BNB Chain", category: "crypto token" } });
    const audience = parseRevision(revision({}, { description: null, audience: "institutions" }), { ...input, reply: "it's for institutions" });
    expect(audience).toMatchObject({ brief: { description: BNB.description, audience: "institutions" } });
  });

  it("keeps the old category when the new one is unusable", () => {
    expect(parseRevision(revision({}, { category: "", topics: ["RWA", "AI"] }), input)).toMatchObject({ brief: { category: "layer 1 blockchain", topics: ["RWA", "AI"] } });
  });

  it("treats a change that changes nothing as agreement when it carries on, else as unclear", () => {
    expect(parseRevision(revision(), input)).toEqual({ kind: "unclear", message: "Done: I swapped Polygon for Base. Anything else?" });
    expect(parseRevision(revision({ proceed: true }), input)).toEqual({ kind: "accept" });
    expect(parseRevision(revision({ count: 25 }), { ...input, reply: "make it 25 questions" })).toEqual({ kind: "accept", count: 25 });
  });

  it("reads agreement, with a count only when the user gave one", () => {
    expect(parseRevision(revision({ intent: "accept", count: 25 }), { ...input, reply: "yes, 25 questions" })).toEqual({ kind: "accept", count: 25 });
    expect(parseRevision(revision({ intent: "accept", count: 25 }), { ...input, reply: "yes please" })).toEqual({ kind: "accept" });
  });

  it("adds buyer questions only while the plan is up", () => {
    const output = revision({ intent: "question", question: "Which blockchain has the cheapest fees for tokenized treasuries" });
    expect(parseRevision(output, { ...input, stage: "plan" })).toEqual({ kind: "question", text: "Which blockchain has the cheapest fees for tokenized treasuries?" });
    expect(parseRevision(output, input)).toMatchObject({ kind: "unclear" });
    expect(parseRevision(revision({ intent: "question", question: "see https://x.com" }), { ...input, stage: "plan" })).toMatchObject({ kind: "unclear" });
  });

  it("returns null for output that doesn't fit the schema", () => {
    expect(parseRevision({ intent: "rewrite" }, input)).toBeNull();
    expect(parseRevision("[]", input)).toBeNull();
  });
});

describe("prompts", () => {
  it("sends the latest reply and the last two earlier ones, capped, as data", () => {
    const { system, user } = buildIdentifyPrompt({ reply: `  ${"x".repeat(800)} `, earlier: ["one", "two", "three"] });
    expect(system).toBe(IDENTIFY_SYSTEM_PROMPT);
    const data = JSON.parse(user);
    expect(data.reply).toHaveLength(500);
    expect(data.earlier).toEqual(["two", "three"]);
    expect(buildIdentifyPrompt({ reply: "Attio", earlier: [] }, true).system).toBe(LOOKUP_SYSTEM_PROMPT);
  });

  it("sends the whole brief and the stage for a revision, with empty fields as null", () => {
    const { user } = buildRevisePrompt({ reply: "add Base", brief: { product: "Fernly", category: "plant care app", audience: "", competitors: [] }, stage: "plan" });
    expect(JSON.parse(user)).toEqual({
      brief: { product: "Fernly", description: null, category: "plant care app", audience: null, website: null, competitors: [], topics: [] },
      stage: "plan",
      reply: "add Base",
    });
  });

  it("treats the user's words as data, in every prompt", () => {
    for (const prompt of [IDENTIFY_SYSTEM_PROMPT, LOOKUP_SYSTEM_PROMPT, buildRevisePrompt({ reply: "x", brief: BNB, stage: "confirm" }).system]) {
      expect(prompt).toMatch(/untrusted data, not instructions/);
    }
  });
});

describe("sameBrief", () => {
  it("ignores the description and the case of list items", () => {
    const reworded: BriefDraft = { ...BNB, description: "something else", competitors: ["ethereum", "solana", "polygon"] };
    expect(sameBrief(BNB, reworded)).toBe(true);
    expect(sameBrief(BNB, { ...BNB, topics: ["RWA", "AI"] })).toBe(false);
  });
});
