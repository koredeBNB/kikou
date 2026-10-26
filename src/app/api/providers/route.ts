import { connection } from "next/server";
import { providerStatus } from "@/lib/providers/config";
import { budgetStatus } from "@/lib/sov/budget";

export async function GET() {
  await connection();
  const budget = budgetStatus(process.env);
  return Response.json(
    {
      providers: providerStatus(process.env),
      budget: budget && { limitUsd: budget.limitUsd, remainingUsd: budget.remainingUsd },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
