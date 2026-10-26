import { describe, expect, it } from "vitest";
import { validateCheckRequest } from "@/lib/sov/validate";

const valid = {
  brief: { product: "Acme", category: "CRM", audience: "agencies", competitors: ["Close", 3, ""] },
  questions: [{ id: "q1", text: "Best CRM?", intent: "best-for" }],
};

describe("validateCheckRequest", () => {
  it("accepts a valid request and defaults to every model", () => {
    const result = validateCheckRequest(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.models).toEqual(["chatgpt", "claude", "gemini", "perplexity"]);
    expect(result.value.brief.competitors).toEqual(["Close"]);
  });

  it("requires a product, a category and at least one question", () => {
    expect(validateCheckRequest({ ...valid, brief: { category: "CRM" } })).toMatchObject({ ok: false });
    expect(validateCheckRequest({ ...valid, brief: { product: "Acme" } })).toMatchObject({ ok: false });
    expect(validateCheckRequest({ ...valid, questions: [] })).toMatchObject({ ok: false });
    expect(validateCheckRequest(null)).toMatchObject({ ok: false });
  });

  it("caps question count and ignores unknown models", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `q${i}`, text: `Q${i}?` }));
    expect(validateCheckRequest({ ...valid, questions: many })).toMatchObject({ ok: false });
    const result = validateCheckRequest({ ...valid, models: ["claude", "grok"] });
    expect(result.ok && result.value.models).toEqual(["claude"]);
  });
});
