import { redirect } from "next/navigation";

// Master data, uploads and supplier e-mail live inside the IMDS Tracker (Settings and Follow-up), not in the Judgement workspace.
export default function ImdsMasterPage() {
  redirect("/imds-tracker#settings");
}
