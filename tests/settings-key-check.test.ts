import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The latest migration that redefines imds_tracker_settings_key_check must keep every key an earlier one allowed,
// otherwise it fails on a live database ("violated by some row").
describe("imds_tracker_settings key check", () => {
  it("never drops a key allowed by an earlier migration", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const seen = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(dir, f), "utf8");
      const m = [...sql.matchAll(/key in \(([^)]*)\)/g)].pop();
      if (!m || !/imds_tracker_settings/.test(sql)) continue;
      const keys = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
      for (const k of seen) expect(keys, `${f} drops '${k}'`).toContain(k);
      keys.forEach((k) => seen.add(k));
    }
    expect([...seen]).toEqual(expect.arrayContaining(["directory", "followup_config", "autojudge_config", "due_dates"]));
  });
});
