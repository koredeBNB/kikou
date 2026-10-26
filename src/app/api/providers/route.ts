import { connection } from "next/server";
import { providerStatus } from "@/lib/providers/config";

export async function GET() {
  await connection();
  return Response.json({ providers: providerStatus(process.env) });
}
