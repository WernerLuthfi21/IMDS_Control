import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "IMDS Intelligence Control Center",
  description: "Toyota IMDS / G-CATS case management and evidence-linked judgement workspace."
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await getAuthContext();
  const role = auth.role || "viewer";
  if (auth.userId && auth.role === "supplier") {
    const pathname = (await headers()).get("x-pathname") || "";
    const allowed = pathname.startsWith("/supplier-precheck") || pathname.startsWith("/api/") || pathname === "/login" || pathname === "/setup-required";
    if (pathname && !allowed) redirect("/supplier-precheck");
  }
  return <html lang="en"><body><AppShell role={role} email={auth.email}>{children}</AppShell></body></html>;
}
