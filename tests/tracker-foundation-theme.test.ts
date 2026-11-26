import {describe,it,expect} from "vitest";
import {normalizeTrackerTheme,resolveTrackerTheme,TRACKER_THEME_KEY} from "@/lib/tracker/theme";
describe("Tracker theme isolation",()=>{
 it("normalizes invalid and missing preferences",()=>{expect(normalizeTrackerTheme(null)).toBe("system");expect(normalizeTrackerTheme("invalid")).toBe("system");});
 it("resolves system and explicit modes",()=>{expect(resolveTrackerTheme("system",true)).toBe("dark");expect(resolveTrackerTheme("system",false)).toBe("light");expect(resolveTrackerTheme("light",true)).toBe("light");expect(resolveTrackerTheme("dark",false)).toBe("dark");});
 it("uses an independent storage key",()=>expect(TRACKER_THEME_KEY).not.toBe("imds-theme"));
});
