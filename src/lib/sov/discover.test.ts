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

describe("discoverBrands with everyday words as headings", () => {
  // Shapes seen in live answers for crypto questions: criteria as bold list headings.
  const answers = [
    `1. **Liquidity**: deep order books keep slippage low.\n2. **Fees**: watch the fees on small trades.\n3. **Solana**: fast and cheap.\n4. **Ledger**: a hardware wallet.`,
    `- **Fees** – low fees matter when you trade often.\n- **Liquidity** – thin liquidity hurts.\n- **Solana** is popular.\n- **Ledger** keeps keys offline.\n- **MetaMask** – the default browser wallet (metamask.io).`,
    `Look for liquidity and fair fees. **MetaMask** (https://metamask.io) and Solana come up a lot.\n- **MetaMask**: browser wallet, see metamask.io.\n- **Ledger**: every chain records a public ledger, and Ledger signs offline.`,
  ];

  it("skips headings that the answers also use as ordinary words", () => {
    const found = discoverBrands(answers, []);
    expect(found).not.toContain("Liquidity");
    expect(found).not.toContain("Fees");
    expect(found).toEqual(expect.arrayContaining(["Solana", "Ledger"]));
  });

  it("keeps brands whose site is linked in lower case", () => {
    expect(discoverBrands(answers, [])).toContain("MetaMask");
  });

  it("skips headings made only of generic criteria, but keeps brands that contain one", () => {
    const item = (name: string) => `- **${name}**: details.`;
    const names = [
      "Tokenomics",
      "Competition",
      "Regulatory risk",
      "Liquidity Risk",
      "User Experience",
      "Customer Support",
      "Hardware wallets",
      "Security features",
      "Coinbase Advanced",
      "Ocean Protocol",
      "Coinbase Wallet",
      "Trust Wallet",
      "Ledger Live",
    ];
    const text = names.map(item).join("\n");
    expect(discoverBrands([text, text], [])).toEqual(["Coinbase Advanced", "Ocean Protocol", "Coinbase Wallet", "Trust Wallet", "Ledger Live"]);
  });

  it("skips section headings, choices between brands and advice lines", () => {
    // Headings seen in a live 400-answer crypto wallet check.
    const junk = [
      "For Solana",
      "For Long-Term Security",
      "Ledger or Trezor",
      "Ethereum and DeFi",
      "Whichever you choose",
      "Protect your recovery phrase",
      "Verify before you sign",
      "Start Small",
      "Pro Tip",
      "EVM chains",
      "Supports **Bitcoin",
      "Clear Signing",
      "Air-Gapping",
    ];
    const brands = ["Sparrow Wallet", "Trezor Safe 3", "Ledger Nano S Plus", "Monero GUI", "BitBox02", "NOW Wallet"];
    const text = [...junk, ...brands].map((name) => `- **${name}**: details.`).join("\n");
    expect(discoverBrands([text, text], [])).toEqual(brands);
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
