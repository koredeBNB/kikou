import { describe, expect, it } from "vitest";
import { INTAKE_JSON_SCHEMA, parseIntakeTurn } from "@/lib/intake/schema";

const valid = {
  intent: "answer",
  values: { product: "Fernly", category: "plant care app", audience: "new plant parents", competitors: null, website: "fernly.app" },
  asks: "competitors",
  message: "Lovely to meet **Fernly**! Which competitors should I watch? Or skip and I'll spot them.",
};
const reply = "It's Fernly, a plant care app for new plant parents, site's fernly.app";

describe("INTAKE_JSON_SCHEMA", () => {
  it("is a strict schema that requires every key", () => {
    expect(INTAKE_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(INTAKE_JSON_SCHEMA.required).toEqual(["intent", "values", "skips", "asks", "message"]);
    expect(INTAKE_JSON_SCHEMA.properties.values.required).toEqual(["product", "category", "audience", "competitors", "website", "topics", "count"]);
    expect(INTAKE_JSON_SCHEMA.properties.intent.enum).toEqual(["answer", "skip", "unclear"]);
    expect(INTAKE_JSON_SCHEMA.properties.skips.items.enum).toEqual(["audience", "competitors", "website", "topics", "count"]);
  });
});

describe("parseIntakeTurn topics and count", () => {
  const blank = { product: null, category: null, audience: null, competitors: null, website: null, topics: null, count: null };
  const turnWith = (values: Record<string, unknown>, asks = "review") => ({ intent: "answer", values: { ...blank, ...values }, skips: [], asks, message: "Got it." });

  it("keeps only the topics the reply names, up to five", () => {
    const turn = parseIntakeTurn(
      turnWith({ product: "BNB", topics: ["trading", "RWA", "AI", "memecoins"] }, "category"),
      "research BNB's standing within trading, RWA, AI",
      "product",
    );
    expect(turn?.values).toEqual({ product: "BNB", topics: ["trading", "RWA", "AI"] });
    const many = parseIntakeTurn(turnWith({ topics: ["a1", "b2", "c3", "d4", "e5", "f6"] }), "a1, b2, c3, d4, e5, f6", "topics");
    expect(many?.values.topics).toHaveLength(5);
  });

  it("takes a question count when the user is answering how many", () => {
    expect(parseIntakeTurn(turnWith({ count: 50 }), "about fifty", "count")?.values).toEqual({ count: 50 });
    expect(parseIntakeTurn(turnWith({ count: 30 }), "Acme with 30 questions please", "product")?.values).toEqual({ count: 30 });
  });

  it("ignores numbers that aren't about the question count", () => {
    const turn = parseIntakeTurn(turnWith({ product: "Acme", count: 50 }, "category"), "Acme, for 50-person agencies", "product");
    expect(turn?.values).toEqual({ product: "Acme" });
  });

  it("caps the count at 100 and rejects counts without a number in the reply", () => {
    const capped = parseIntakeTurn(turnWith({ count: 250 }), "250", "count");
    expect(capped?.values).toEqual({ count: 100 });
    expect(capped?.capped).toBe(true);
    expect(parseIntakeTurn(turnWith({ count: 40 }), "whatever works", "count")).toBeNull();
    expect(parseIntakeTurn(turnWith({ count: 2.5 }), "2.5", "count")).toBeNull();
  });
});

describe("parseIntakeTurn skips", () => {
  const messy = "It's Fernly, a plant care app for new plant parents, site's fernly.app. competitors? honestly not sure";

  it("keeps declined optional fields that the reply talks about", () => {
    const turn = parseIntakeTurn({ ...valid, skips: ["competitors", "audience"], asks: "review" }, messy);
    expect(turn?.skips).toEqual(["competitors"]);
  });

  it("drops skips for fields that were also given a value, or aren't optional", () => {
    const turn = parseIntakeTurn({ ...valid, skips: ["website", "product", "pricing"] }, messy);
    expect(turn?.skips).toBeUndefined();
  });

  it("rejects skips that aren't a list", () => {
    expect(parseIntakeTurn({ ...valid, skips: "competitors" }, messy)).toBeNull();
  });
});

describe("parseIntakeTurn", () => {
  it("accepts a valid object and drops nulls", () => {
    expect(parseIntakeTurn(valid, reply)).toEqual({
      intent: "answer",
      values: { product: "Fernly", category: "plant care app", audience: "new plant parents", website: "fernly.app" },
      asks: "competitors",
      message: valid.message,
    });
  });

  it("accepts JSON text, with or without a code fence", () => {
    expect(parseIntakeTurn(JSON.stringify(valid), reply)?.values.product).toBe("Fernly");
    expect(parseIntakeTurn("```json\n" + JSON.stringify(valid) + "\n```", reply)?.values.product).toBe("Fernly");
  });

  it("tolerates missing value keys", () => {
    const turn = parseIntakeTurn({ intent: "skip", values: {}, asks: "website", message: "No problem." }, "not sure");
    expect(turn).toEqual({ intent: "skip", values: {}, asks: "website", message: "No problem." });
  });

  it.each([
    ["not JSON", "Sure! Here you go"],
    ["an array", [valid]],
    ["an unknown intent", { ...valid, intent: "maybe" }],
    ["an unknown field to ask for", { ...valid, asks: "pricing" }],
    ["a non-string message", { ...valid, message: 42 }],
    ["values that aren't an object", { ...valid, values: "Fernly" }],
    ["competitors that aren't a list", { ...valid, values: { ...valid.values, competitors: "Planta" } }],
    ["a non-string product", { ...valid, values: { ...valid.values, product: ["Fernly"] } }],
  ])("rejects %s", (_label, raw) => {
    expect(parseIntakeTurn(raw, reply)).toBeNull();
  });

  it("rejects an answer with nothing usable left after cleaning", () => {
    const raw = { ...valid, values: { product: "Zapster", category: null, audience: null, competitors: null, website: null } };
    expect(parseIntakeTurn(raw, "not sure honestly")).toBeNull();
  });

  it("only keeps names and domains that appear in the reply", () => {
    const turn = parseIntakeTurn(
      {
        intent: "answer",
        values: { product: null, category: null, audience: null, competitors: ["Planta", "Greg", "Blossom"], website: "planta.com" },
        asks: "website",
        message: "Noted.",
      },
      "planta and greg mostly",
    );
    expect(turn?.values).toEqual({ competitors: ["Planta", "Greg"] });
  });

  it("cleans values with the same rules as the parser", () => {
    const turn = parseIntakeTurn(
      {
        intent: "answer",
        values: {
          product: "Fernly.",
          category: "a plant care app",
          audience: "for new plant parents",
          competitors: ["Planta", "Fernly", "planta"],
          website: "https://www.fernly.app/",
        },
        asks: "review",
        message: "All set.",
      },
      "Fernly, a plant care app for new plant parents, vs Planta, https://www.fernly.app/",
    );
    expect(turn?.values).toEqual({
      product: "Fernly",
      category: "plant care app",
      audience: "new plant parents",
      competitors: ["Planta"],
      website: "fernly.app",
    });
  });

  it("drops a category or audience that's really a sentence", () => {
    const turn = parseIntakeTurn(
      {
        ...valid,
        values: { product: "Fernly", category: "it helps you remember to water your plants", audience: null, competitors: null, website: null },
      },
      "Fernly",
    );
    expect(turn?.values).toEqual({ product: "Fernly" });
  });

  it("drops a message that carries links, markup or is too long, but keeps the values", () => {
    for (const message of ["Visit https://evil.example now", "See www.evil.example", "<script>x</script>", "a".repeat(401)]) {
      const turn = parseIntakeTurn({ ...valid, message }, reply);
      expect(turn?.message).toBeUndefined();
      expect(turn?.values.product).toBe("Fernly");
    }
  });

  it("caps runaway lists", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Brand${i}`);
    const turn = parseIntakeTurn(
      { ...valid, values: { product: null, category: null, audience: null, competitors: names, website: null } },
      names.join(", "),
    );
    expect(turn?.values.competitors).toHaveLength(8);
  });
});
