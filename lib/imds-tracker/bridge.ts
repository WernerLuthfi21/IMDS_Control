import { postToFlow } from "@/lib/automation/flow";

export async function pushTrackerToPowerAutomate(payload: unknown) {
  const url = process.env.POWER_AUTOMATE_TRACKER_URL?.trim();
  const secret = process.env.POWER_AUTOMATE_SECRET?.trim() || null;
  if (!url || !/^https:\/\//i.test(url)) {
    return { configured: false, ok: false, status: 0, error: "POWER_AUTOMATE_TRACKER_URL is not configured." };
  }
  const result = await postToFlow(url, secret, payload);
  return { configured: true, ...result };
}
