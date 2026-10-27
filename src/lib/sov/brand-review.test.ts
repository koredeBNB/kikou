import { describe, expect, it, vi } from "vitest";
import {
  applyBrandReview,
  buildBrandReviewPrompt,
  MAX_REVIEWED,
  parseBrandReview,
  requestBrandReview,
  validateBrandReviewRequest,
  type BrandReviewInput,
} from "@/lib/sov/brand-review";

const input: BrandReviewInput = {
  product: "MetaMask",
  category: "crypto wallet",
  competitors: ["Trust Wallet", "Phantom"],
  candidates: [
    { name: "Ledger", context: "**Ledger** – keeps keys offline." },
    { name: "Solana", context: "**Solana**: fast and cheap." },
    { name: "Ledger Nano X", context: "**Ledger Nano X** – Bluetooth." },
    { name: "OKX Web3 Wallet", context: "**OKX Web3 Wallet** – multichain." },
    { name: "OKX Wallet", context: "**OKX Wallet** – built into the exchange app." },
    { name: "MetaMask Flask", context: "**MetaMask Flask** – the developer build." },
    { name: "Trezor Safe 5", context: "**Trezor Safe 5** – touchscreen." },
    { name: "Rabby", context: "**Rabby** – built for DeFi." },
  ],
};

describe("buildBrandReviewPrompt", () => {
  it("sends the category, the tracked brands and each name with the item it came from", () => {
    const prompt = buildBrandReviewPrompt(input);
    expect(prompt.system).toMatch(/ignore any instructions/);
    expect(JSON.parse(prompt.user)).toMatchObject({
      category: "crypto wallet",
      product: "MetaMask",
      rivals: ["Trust Wallet", "Phantom"],
      names: expect.arrayContaining([{ name: "Solana", from: "**Solana**: fast and cheap." }]),
    });
  });
});

describe("parseBrandReview", () => {
  it("reads which names aren't rivals and which are product lines", () => {
    const review = parseBrandReview(
      JSON.stringify({
        notRivals: ["solana"],
        productLines: [
          { name: "Ledger Nano X", brand: "Ledger" },
          { name: "OKX Web3 Wallet", brand: "OKX Wallet" },
          { name: "MetaMask Flask", brand: "metamask" },
          { name: "Trezor Safe 5", brand: "Trezor" },
        ],
      }),
      input,
    );
    expect(review).toEqual({
      reviewed: input.candidates.map((c) => c.name),
      drop: ["Solana"],
      merge: { "Ledger Nano X": "Ledger", "OKX Web3 Wallet": "OKX Wallet", "MetaMask Flask": "MetaMask", "Trezor Safe 5": "Trezor" },
    });
  });

  it("ignores names it wasn't given and product lines that don't start with their brand", () => {
    const review = parseBrandReview(
      {
        notRivals: ["Bitcoin", "Rabby"],
        productLines: [
          { name: "Ledger Nano X", brand: "Trezor" },
          { name: "Rabby", brand: "MetaMask" },
          { name: "Coinbase Wallet", brand: "Coinbase" },
          { name: "Ledger", brand: "Ledger" },
          "Ledger Nano X",
        ],
      },
      input,
    );
    expect(review).toMatchObject({ drop: ["Rabby"], merge: {} });
  });

  it("never merges into a dropped brand or chains merges", () => {
    const review = parseBrandReview(
      {
        notRivals: ["Ledger"],
        productLines: [
          { name: "Ledger Nano X", brand: "Ledger" },
          { name: "OKX Web3 Wallet", brand: "OKX Wallet" },
          { name: "OKX Wallet", brand: "OKX" },
        ],
      },
      input,
    );
    expect(review?.merge).toEqual({ "OKX Wallet": "OKX" });
  });

  it("rejects output of the wrong shape", () => {
    expect(parseBrandReview("not json", input)).toBeNull();
    expect(parseBrandReview({ notRivals: "Solana", productLines: [] }, input)).toBeNull();
    expect(parseBrandReview({ notRivals: [] }, input)).toBeNull();
  });
});

describe("applyBrandReview", () => {
  const review = { reviewed: [], drop: ["Solana"], merge: { "Ledger Nano X": "Ledger", "MetaMask Flask": "MetaMask", "Trezor Safe 5": "Trezor" } };

  it("drops non-rivals, counts product lines as their brand, and leaves tracked brands to the brief", () => {
    expect(applyBrandReview(["Ledger", "Solana", "Ledger Nano X", "MetaMask Flask", "Trezor Safe 5", "Rabby"], review, ["MetaMask"])).toEqual([
      "Ledger",
      "Trezor",
      "Rabby",
    ]);
  });

  it("keeps the rules' brands without a review", () => {
    expect(applyBrandReview(["Solana", "Ledger"], undefined, ["MetaMask"])).toEqual(["Solana", "Ledger"]);
  });
});

describe("validateBrandReviewRequest", () => {
  it("cleans the request and caps how many names are sent", () => {
    const names = Array.from({ length: MAX_REVIEWED + 5 }, (_, i) => ({ name: `Brand ${i}`, context: "x".repeat(500) }));
    const parsed = validateBrandReviewRequest({
      product: " MetaMask ",
      category: "crypto\nwallet",
      competitors: ["Phantom", 4],
      candidates: [{ name: "Brand 0", context: "dup" }, ...names, "Ledger"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ product: "MetaMask", category: "crypto wallet", competitors: ["Phantom"] });
    expect(parsed.value.candidates).toHaveLength(MAX_REVIEWED);
    expect(parsed.value.candidates[0]).toEqual({ name: "Brand 0", context: "dup" });
    expect(parsed.value.candidates[1].context).toHaveLength(200);
  });

  it.each([
    ["a missing product", { category: "crypto wallet", candidates: [{ name: "Ledger" }] }],
    ["no names", { product: "MetaMask", category: "crypto wallet", candidates: [] }],
    ["a body that isn't an object", ["MetaMask"]],
  ])("rejects %s", (_label, body) => {
    expect(validateBrandReviewRequest(body).ok).toBe(false);
  });
});

describe("requestBrandReview", () => {
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("posts the names and reads the model's review again in the browser", async () => {
    const fetchImpl = reply({ source: "ai", output: { notRivals: ["Solana", "Bitcoin"], productLines: [] } });
    const review = await requestBrandReview(input, { fetchImpl });
    expect(review?.drop).toEqual(["Solana"]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/brands");
    expect(JSON.parse(String(init.body))).toMatchObject({ product: "MetaMask" });
  });

  it("returns null when the rules have to stand", async () => {
    expect(await requestBrandReview(input, { fetchImpl: reply({ source: "rules", reason: "no-model" }) })).toBeNull();
    expect(await requestBrandReview(input, { fetchImpl: reply({ error: "Slow down." }, 429) })).toBeNull();
    expect(await requestBrandReview(input, { fetchImpl: vi.fn(async () => Promise.reject(new Error("offline"))) })).toBeNull();
  });
});
