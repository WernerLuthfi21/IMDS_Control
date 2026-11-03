import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "IMDS Intelligence Control Center",
  description: "Toyota IMDS / G-CATS case management and evidence-linked judgement workspace."
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let role = "viewer";
  const supabase = await createClient();
  if (supabase) {
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
      role = profile?.role || "viewer";
    }
  }
  return <html lang="en"><body><AppShell role={role}>{children}</AppShell></body></html>;
}
