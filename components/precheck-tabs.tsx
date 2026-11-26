"use client";
import { type ReactNode } from "react";
import { SettingsTabs } from "@/components/settings-tabs";

/** Supplier Pre-check shares the same keyboard-accessible tab pattern. */
export function PrecheckTabs({ tabs }: { tabs: Array<{ id: string; label: string; hint: string; content: ReactNode }> }) {
  return <SettingsTabs compact syncHash={false} label="Pre-check tools" tabs={tabs}/>;
}
