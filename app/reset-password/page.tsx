import "../login/login.css";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export default async function ResetPasswordPage() {
  const auth = await getAuthContext();
  if (auth.configured && !auth.userId) redirect("/login?error=link"); // only reachable through a valid e-mailed link
  return <ResetPasswordForm/>;
}
