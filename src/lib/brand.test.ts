import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import { INTAKE_SYSTEM_PROMPT } from "@/lib/intake/prompt";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("brand", () => {
  it("is Kioku, with its tagline", () => {
    expect(BRAND_NAME).toBe("Kioku");
    expect(BRAND_TAGLINE).toBe("Are you in the AI's memory?");
  });

  it("tells the intake model which product it works for", () => {
    expect(INTAKE_SYSTEM_PROMPT).toContain("for Kioku, a tool");
  });

  it("leaves the old product name nowhere in the app source", () => {
    const stale = sourceFiles(join(process.cwd(), "src")).filter((file) => readFileSync(file, "utf8").includes("Meadowlark"));
    expect(stale).toEqual([]);
  });
});
