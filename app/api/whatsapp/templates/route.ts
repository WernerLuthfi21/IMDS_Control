import { NextRequest, NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { getWhatsAppSender } from "@/lib/whatsapp/config";
import { fetchApprovedTemplates } from "@/lib/whatsapp/cloud-api";
import { sameOrigin } from "@/lib/security/request";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  const key = request.nextUrl.searchParams.get("senderKey") || "";
  if (!key) return NextResponse.json({ error: "senderKey is required." }, { status: 400 });
  try {
    const sender = getWhatsAppSender(key);
    if (!sender) return NextResponse.json({ error: "Unknown or unconfigured WhatsApp sender." }, { status: 404 });
    const templates = await fetchApprovedTemplates(sender);
    return NextResponse.json({ templates });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load templates." }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  return NextResponse.json({ error: "Use GET to load approved templates." }, { status: 405 });
}
