import { NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { publicWhatsAppSenders } from "@/lib/whatsapp/config";

export async function GET() {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  try {
    return NextResponse.json({ senders: publicWhatsAppSenders(), configured: true });
  } catch {
    return NextResponse.json({ senders: [], configured: false, error: "WhatsApp sender configuration is invalid." }, { status: 503 });
  }
}
