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

describe("discoverBrands on real assistant answers", () => {
  // Shapes seen in live ChatGPT, Claude, Gemini and Perplexity answers for "web analytics".
  const claude = `- **Fathom**: Similar to Plausible, polished and reliable, with a higher price.
- **Google Analytics 4 (GA4):** The default for most sites.
- **Matomo (formerly Piwik)**: self-hosted or cloud.`;
  const gemini = `*   **[Fathom Analytics](https://usefathom.com/):** Simple and privacy-friendly.
*   **[Umami](https://umami.is/):** Open source and lightweight.
*   **[Plausible Analytics](https://plausible.io/):** The most popular open-source alternative.
*   **Google Analytics 4:** The industry baseline.`;
  const perplexity = `1. **Umami**
  - Privacy\u2011first, cookieless, minimal interface.[5][11]
2. **Matomo**
  - Privacy\u2011first, open source.[5][10]
- **Fathom** is a paid, polished option.
* **[Plausible Analytics](https://plausible.io/)**: lightweight.`;
  const chatgpt = `| Pick | Why |
1. **Simple Analytics**
   - Privacy\u2011first, fast setup.`;
  const answers = [claude, gemini, perplexity, chatgpt];
  const found = discoverBrands(answers, ["Plausible"], { category: "web analytics" });

  it("counts a brand and its category-suffixed name as one brand", () => {
    expect(found.filter((b) => b.startsWith("Fathom"))).toEqual(["Fathom"]);
  });

  it("drops trailing parentheticals from names", () => {
    expect(found.filter((b) => b.startsWith("Google"))).toEqual(["Google Analytics 4"]);
    expect(found.filter((b) => b.startsWith("Matomo"))).toEqual(["Matomo"]);
  });

  it("reads brands written as markdown links", () => {
    expect(found).toContain("Umami");
  });

  it("never lists the product under a longer name", () => {
    expect(found).not.toContain("Plausible Analytics");
  });

  it("skips descriptor phrases", () => {
    expect(found).not.toContain("Privacy\u2011first");
  });

  it("merges variants before applying the answer threshold", () => {
    const merged = discoverBrands(["- **Swetrix**: cheap.", "- **Swetrix Analytics**: open source."], [], { category: "web analytics" });
    expect(merged).toEqual(["Swetrix"]);
  });
});
