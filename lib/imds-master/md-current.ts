// Pure rules for turning MD System search-result rows into a master update.
// Back-tested against the hand-maintained Part List LATEST (1871/1871 non-ambiguous parts identical; 0 unexplained
// mismatches). No I/O here so the rules are unit-testable and the import route stays thin.

export type MdItem = {
  idVersion: string | null;
  status: string | null;
  /** YYYY-MM-DD (what the master stores) */
  lastStatusChanged: string | null;
  /** full wall-clock ISO timestamp; needed because a cancelled v1 and a live v2 can share a day */
  lastStatusChangedAt?: string | null;
  reasonForDenial?: string | null;
  rowNo?: number;
};

export type Ambiguity = "MULTI_ID" | "VERSION_DATE_CONFLICT";
const CANCELLED = "cancelled by sender";

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const idNo = (v: string | null) => v?.match(/^\s*(\d+)\s*\//)?.[1] ?? null;
const version = (v: string | null) => {
  const m = v?.match(/\/\s*([\d.]+)\s*$/);
  return m ? Number(m[1]) : -1;
};
const ts = (i: MdItem) => {
  const t = Date.parse(i.lastStatusChangedAt || i.lastStatusChanged || "");
  return Number.isNaN(t) ? -Infinity : t;
};

/** Part number without the design-change suffix: "82172KK010D" -> "82172KK010" (verified 4005/4005 vs MD "FIXED PART NUMBER"). */
export function fixedPartNo(partNoNorm: string): string {
  return partNoNorm.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 10);
}

/**
 * Current record among several rows for the same part:
 *  1. cancelled-by-sender never supersedes a live record;
 *  2. newest timestamp wins, then higher version, then first row of the file;
 *  3. >1 distinct live IMDS ID, or a higher version of the same ID with an older timestamp => not trusted (ambiguity).
 */
export function selectCurrentMd<T extends MdItem>(items: T[]): { chosen: T; ambiguity: Ambiguity | null } {
  const live = items.filter((i) => norm(i.status) !== CANCELLED);
  const pool = live.length ? live : items;
  const chosen = [...pool].sort((a, b) => ts(b) - ts(a) || version(b.idVersion) - version(a.idVersion) || (a.rowNo ?? 0) - (b.rowNo ?? 0))[0];
  const liveIds = new Set(live.map((i) => idNo(i.idVersion)).filter(Boolean));
  let ambiguity: Ambiguity | null = null;
  if (liveIds.size > 1) ambiguity = "MULTI_ID";
  else if (live.some((i) => idNo(i.idVersion) === idNo(chosen.idVersion) && version(i.idVersion) > version(chosen.idVersion))) ambiguity = "VERSION_DATE_CONFLICT";
  return { chosen, ambiguity };
}

/** MD System status -> operational IMDS STATUS. Evidence in the real master: 1633/1633, 253/253, 16/16, 3/3. Others => human decides. */
export function mapMdStatusToImds(status: string | null): string | null {
  switch (norm(status)) {
    case "accepted": return "ACCEPTED";
    case "in process at recipient":
    case "not yet browsed": return "TMMIN WORKING";
    case "rejected": return "REJECTED";
    default: return null;
  }
}

/** Decisions people make that MD System cannot show; automation must never overwrite them. */
export const PROTECTED_IMDS_STATUSES = new Set(["DEAD (NEW SMS)", "NOT TO BE COLLECTED"]);

export type CandidateState = {
  imds_status: string | null;
  imds_id_version: string | null;
  md_id_version?: string | null;
  md_status_update_date: string | null;
  manual_overrides: string[] | null;
  extra_fields: Record<string, unknown> | null;
};

export type CandidatePlan = {
  patch: Record<string, unknown>;      // columns to write (never includes overridden fields)
  review: string[];                    // reasons a human must look; empty = clean
  stale: boolean;                      // incoming data is older than what the master holds
  chosen: MdItem | null;
};

/** Everything the import route needs to update ONE master row from the file rows that matched it. */
export function planCandidatePatch(state: CandidateState, items: MdItem[]): CandidatePlan {
  if (!items.length) return { patch: {}, review: [], stale: false, chosen: null };
  const overrides = new Set((state.manual_overrides ?? []).map(String));
  const { chosen, ambiguity } = selectCurrentMd(items);
  const extra = { ...(state.extra_fields ?? {}) } as Record<string, unknown>;
  const setReview = (reasons: string[]) => {
    if (reasons.length) extra.mdReview = { reasons, at: new Date().toISOString() };
    else delete extra.mdReview;
  };

  if (ambiguity) {
    const reasons = [`${ambiguity}: ${[...new Set(items.map((i) => i.idVersion))].join(" | ")}`];
    setReview(reasons);
    return { patch: { extra_fields: extra }, review: reasons, stale: false, chosen };   // nothing else changes: we do not guess
  }
  if (chosen.lastStatusChanged && state.md_status_update_date && chosen.lastStatusChanged < state.md_status_update_date) {
    return { patch: {}, review: [], stale: true, chosen };                                // dropping an old export must not roll data back
  }

  const patch: Record<string, unknown> = {};
  if (!overrides.has("status_update")) patch.status_update = chosen.status || null;
  if (!overrides.has("md_id_version")) patch.md_id_version = chosen.idVersion || null;
  if (!overrides.has("md_status_update_date")) patch.md_status_update_date = chosen.lastStatusChanged || null;
  if (!overrides.has("comment")) patch.comment = chosen.reasonForDenial || null;

  const review: string[] = [];
  const derived = mapMdStatusToImds(chosen.status);
  const current = state.imds_status;
  if (derived === null) review.push(`UNMAPPED_MD_STATUS: "${chosen.status}"`);
  else if (current && PROTECTED_IMDS_STATUSES.has(current)) review.push(`PROTECTED_STATUS_KEPT: ${current} vs MD "${chosen.status}"`);
  else if (current === "ACCEPTED" && derived !== "ACCEPTED") {
    // Highest status wins (ACCEPTED > TMMIN WORKING > REJECTED/NOT SUBMITTED) unless the ID version moved up: that is a revision.
    const prior = state.imds_id_version || state.md_id_version || null;
    const revised = idNo(prior) !== null && idNo(prior) === idNo(chosen.idVersion) && version(chosen.idVersion) > version(prior);
    if (revised && !overrides.has("imds_status")) {
      patch.imds_status = derived;
      extra.revision = { from: prior, to: chosen.idVersion, previousStatus: current, at: new Date().toISOString() };
    } else review.push(`ACCEPTED_DOWNGRADE: ACCEPTED -> ${derived} (MD "${chosen.status}")`);
  }
  else if (!overrides.has("imds_status") && derived !== current) patch.imds_status = derived;

  const curNo = idNo(state.imds_id_version);
  const newNo = idNo(chosen.idVersion);
  if (chosen.idVersion && !overrides.has("imds_id_version")) {
    if (curNo && newNo && curNo !== newNo) review.push(`ID_NUMBER_DIFFERS: sheet ${state.imds_id_version} vs MD ${chosen.idVersion}`);
    else if (state.imds_id_version !== chosen.idVersion) patch.imds_id_version = chosen.idVersion;
  }

  setReview(review);
  patch.extra_fields = extra;
  return { patch, review, stale: false, chosen };
}
