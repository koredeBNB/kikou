import { describe, expect, it } from "vitest";
import { discoverBrands } from "@/lib/sov/discover";

const answerA = `Here are the best options:

1. **Pipedrive** – visual pipelines for small teams.
2. **Close**: built-in calling.
3. **Copper** - great with Google Workspace.

**Pros:** easy setup.
**Bottom line:** pick what fits.`;

const answerB = `- **Close** is a favourite for inside sales.
- **Copper** (formerly ProsperWorks) integrates with Gmail.
- **Key features**: pipelines, email sync.
- Freshsales: AI scoring.`;

describe("discoverBrands", () => {
  it("finds list-item brands that recur across answers", () => {
    expect(discoverBrands([answerA, answerB], [])).toEqual(["Close", "Copper"]);
  });

  it("can accept single-answer brands with a lower threshold", () => {
    expect(discoverBrands([answerA, answerB], [], { minAnswers: 1 })).toEqual([
      "Close",
      "Copper",
      "Pipedrive",
      "Freshsales",
    ]);
  });

  it("skips generic headings and brands that are already known", () => {
    const found = discoverBrands([answerA, answerB], ["copper"], { minAnswers: 1 });
    expect(found).not.toContain("Copper");
    expect(found).not.toContain("Pros");
    expect(found).not.toContain("Key features");
    expect(found).not.toContain("Bottom line");
  });
});
