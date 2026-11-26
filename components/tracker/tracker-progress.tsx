import type { CSSProperties } from "react";
import { generalStatuses, partStatuses, type TrackerCounts, type TrackerModel } from "@/lib/tracker/shared-master";

export const formatCount = (value: number) => value.toLocaleString("en-GB");
export const modelAccent = (model: TrackerModel): CSSProperties => ({ "--model-accent": model.color }) as CSSProperties;

export function SubmissionBar({ counts, label }: { counts: TrackerCounts; label: string }) {
  const segments = ["complete", "process", "rejected", "missing"] as const;
  return <span className="trk-submission-bar" role="img" aria-label={label + ": " + generalStatuses.map(status => `${counts[status]} ${partStatuses[status].label}`).join(", ")}>
    {segments.filter(status => counts[status]).map(status => (
      <span key={status} className={`trk-segment trk-${partStatuses[status].tone}`} style={{ width: `${(counts[status] / counts.total * 100).toFixed(2)}%` }} />
    ))}
  </span>;
}

export function PartCounts({ counts }: { counts: TrackerCounts }) {
  return <span className="trk-part-counts">
    {generalStatuses.filter(status => counts[status]).map(status => {
      const meta = partStatuses[status];
      return <span key={status} className={`trk-${meta.tone}`} title={meta.label}>
        <span aria-hidden="true">{meta.glyph}</span> <b className="trk-num">{formatCount(counts[status])}</b><span className="sr-only"> {meta.label}</span>
      </span>;
    })}
  </span>;
}

export function ModelChips({ keys, models }: { keys: readonly string[]; models: readonly TrackerModel[] }) {
  return <span className="trk-model-chips">
    {keys.slice(0, 3).map(key => {
      const model = models.find(item => item.key === key);
      return model && <span className="trk-model-chip" key={key} style={modelAccent(model)} translate="no"><i aria-hidden="true" />{model.label}</span>;
    })}
    {keys.length > 3 && <span className="trk-model-chip">+{keys.length - 3}</span>}
  </span>;
}
