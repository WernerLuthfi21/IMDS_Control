import "../login/login.css";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";
export default function ForgotPasswordPage() { return <LoginForm next="/workspace" initialMode="forgot"/>; }
