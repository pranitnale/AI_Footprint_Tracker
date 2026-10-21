import type { UsageBreakdownView } from "../dashboard/types";
import { recordName } from "../ui/model-names";

export type Kind = { label: string; tone: "own" | "similar" | "family" | "other"; detail?: string };
type Tone = Exclude<Kind["tone"], "other">;

// A stand-in for a model the site does not name or the library does not list yet is the family's
// benchmark, which the legend calls a family estimate; other stand-ins are the closest model.
const FAMILY_BASES: ReadonlySet<string> = new Set(["family_benchmark", "model_not_named", "model_not_in_library"]);

/**
 * Why a model's electricity is Unknown while its tool has a value: none of its counted replies
 * has an estimate (QA of 19 Oct 2026). Shown on hover of the model table's Not estimated label.
 */
export const NOT_ESTIMATED_DETAIL =
  "No reply of this model has an electricity estimate yet: a reply still being estimated, or one stopped before any answer was written, which leaves no output to estimate from. The tool's figures add only replies that have an estimate.";

/** The legend entry of one reply's record selection; null when the reply has no estimate. */
function selectionTone(kind: string, basis: string | null): Tone | null {
  if (kind === "direct_mapping") return "own";
  if (kind === "provider_flagship") return "family";
  if (kind === "model_override") return basis !== null && FAMILY_BASES.has(basis) ? "family" : "similar";
  return null;
}

/**
 * How a model's electricity was estimated, from the record selection of its counted replies:
 * the live replies' tally (`selections`, from the usage breakdown) and the saved replies' energy
 * figures (`profile_selection`). The figure groups do not carry the selection, because replies
 * of several models add up in one group.
 *
 * Saved figures keep the selection kind and record but not why a stand-in was chosen. A saved
 * stand-in takes the reason of a live reply of the same model with the same record; without one
 * it reads as a similar model.
 */
export function estimationKind(view: UsageBreakdownView, model: string): Kind {
  const replies = new Map<Tone, number>();
  const similar: string[] = [];
  const add = (kind: string, basis: string | null, record: string | null, count: number) => {
    const tone = selectionTone(kind, basis);
    if (!tone || !(count > 0)) return;
    replies.set(tone, (replies.get(tone) ?? 0) + count);
    if (tone === "similar" && record && !similar.includes(record)) similar.push(record);
  };
  const live = view.models[model]?.selections ?? [];
  const bases = new Map(live.flatMap((s) => (s.kind === "model_override" && s.record ? [[s.record, s.basis] as const] : [])));
  for (const s of live) add(s.kind, s.basis, s.record, s.replies);
  for (const resource of view.history?.models[model]?.resources ?? [])
    if (resource.quantity === "energy")
      add(
        resource.profile_selection,
        resource.selected_profile_id ? (bases.get(resource.selected_profile_id) ?? null) : null,
        resource.selected_profile_id,
        Number(resource.known_message_count),
      );
  const mixed = replies.size > 1 ? { detail: "Some replies use another estimate" } : {};
  if (replies.has("similar")) return { label: similar[0] ? `Similar model: ${recordName(similar[0])}` : "Similar model", tone: "similar", ...mixed };
  if (replies.has("family")) return { label: "Family estimate", tone: "family", ...mixed };
  if (replies.has("own")) return { label: "Own record", tone: "own" };
  return { label: "Not estimated", tone: "other", detail: NOT_ESTIMATED_DETAIL };
}
