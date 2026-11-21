import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { JetBrains_Mono, Questrial } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Self-hosted at build time by next/font: no runtime request to Google, so CSP can stay `font-src 'self'`.
// Century Gothic stays the brand face where it is installed; Questrial is its metric-close web fallback.
const questrial = Questrial({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-questrial" });
// Data face: CAS, part numbers, supplier codes, masses, record keys (docs/DESIGN-SYSTEM.md → Type).
const mono = JetBrains_Mono({ weight: ["400", "500", "600"], subsets: ["latin"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "IMDS Intelligence Control Center",
  description: "Toyota IMDS / G-CATS case management and evidence-linked judgement workspace."
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await getAuthContext();
  const role = auth.role || "viewer";
  if (auth.userId && auth.role === "supplier") {
    const pathname = (await headers()).get("x-pathname") || "";
    const allowed = pathname.startsWith("/supplier-precheck") || pathname.startsWith("/api/") || ["/login", "/forgot-password", "/reset-password", "/setup-required"].includes(pathname) || pathname.startsWith("/auth/");
    if (pathname && !allowed) redirect("/supplier-precheck");
  }
  const themeScript = `try{var t=localStorage.getItem("imds-theme");if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;
  return <html lang="en" suppressHydrationWarning className={`${questrial.variable} ${mono.variable}`}><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body><AppShell role={role} email={auth.email}>{children}</AppShell></body></html>;
}
