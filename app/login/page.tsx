import "./login.css";
import { LoginForm } from "@/components/login-form";
import { safeNextPath } from "@/lib/security/next-path";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> }) {
  const params = await searchParams;
  const next = safeNextPath(Array.isArray(params.next) ? params.next[0] : params.next);
  return <LoginForm next={next} linkError={params.error === "link"}/>;
}
