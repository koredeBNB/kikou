import { handleAudit } from "@/lib/audit/handler";
import { checkStore } from "@/lib/store";

/** Next.js reads this statically. The audit stops starting pages at 45 s, which leaves room to grade and close. */
export const maxDuration = 60;

/** Reads the brand's site the way AI crawlers do and streams the grade back. */
export async function POST(request: Request) {
  return handleAudit(request, { env: process.env, store: checkStore() });
}
