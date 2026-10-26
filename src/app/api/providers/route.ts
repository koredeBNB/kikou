import { connection } from "next/server";
import { providerStatus } from "@/lib/providers/config";
import { budgetStatus } from "@/lib/sov/budget";
import { checkStore } from "@/lib/store";

export async function GET() {
  await connection();
  const budget = await budgetStatus(process.env, checkStore()).catch((error) => {
    console.error("Budget status unavailable", error);
    return null;
  });
  return Response.json(
    {
      providers: providerStatus(process.env),
      budget: budget && { limitUsd: budget.limitUsd, remainingUsd: budget.remainingUsd },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
