import { describe, expect, it } from "vitest";
import { previewIndexes } from "./preview";

const items = (topics: (string | undefined)[]) => topics.map((topic) => ({ topic }));

describe("previewIndexes", () => {
  it("keeps everything when the list is short enough", () => {
    expect(previewIndexes(items(["a", "a", "b"]), 8)).toEqual([0, 1, 2]);
  });

  it("takes the first items of an ungrouped list", () => {
    expect(previewIndexes(items(Array(20).fill(undefined)), 4)).toEqual([0, 1, 2, 3]);
  });

  it("spreads the preview evenly across topics, in the original order", () => {
    const list = items([...Array(10).fill("pricing"), ...Array(10).fill("integrations")]);
    expect(previewIndexes(list, 8)).toEqual([0, 1, 2, 3, 10, 11, 12, 13]);
  });

  it("lets small groups show everything and shares the rest round-robin", () => {
    const list = items(["a", "a", "a", "a", "a", "b", "c", "c", "c", "c"]);
    expect(previewIndexes(list, 7)).toEqual([0, 1, 2, 5, 6, 7, 8]);
    expect(previewIndexes(list, 4)).toEqual([0, 1, 5, 6]);
  });

  it("treats questions without a topic as their own group", () => {
    const list = items(["a", "a", "a", "a", undefined, undefined, undefined, undefined]);
    expect(previewIndexes(list, 4)).toEqual([0, 1, 4, 5]);
  });
});
