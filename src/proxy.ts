import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth } from "@/lib/auth/basic-auth";

// No matcher: when basic auth is on, it covers every page, API route and asset.
export function proxy(request: NextRequest) {
  return checkBasicAuth(request.headers.get("authorization"), process.env) ?? NextResponse.next();
}
