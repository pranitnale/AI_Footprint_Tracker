import type {
  EngineMethodIdentity,
  EnginePreferenceRecord,
} from "@footprint/contracts";
import type { LocalSelectionState } from "@footprint/ledger";

export function initialOriginalView(
  method: Readonly<EngineMethodIdentity>,
  preference: EnginePreferenceRecord,
  state: {
    active: unknown;
    selected: unknown;
    inputCount?: number;
    uniformOriginalMethodHash?: string | null;
    originalEvidenceCurrent?: boolean;
  },
) {
  return (
    !state.active &&
    !state.selected &&
    preference.preference === "build_default" &&
    preference.selection_revision === 1 &&
    method.engine_id === "original" &&
    Number.isSafeInteger(state.inputCount) &&
    (state.inputCount === 0 ||
      (state.inputCount !== undefined &&
        state.inputCount > 0 &&
        state.uniformOriginalMethodHash === method.method_hash &&
        state.originalEvidenceCurrent === true))
  );
}

export function localViewState(
  vector: LocalSelectionState,
  method: Readonly<EngineMethodIdentity>,
  preference: EnginePreferenceRecord,
) {
  const matches = (member: LocalSelectionState["members"][number]) =>
    member.selected?.target.method_hash === method.method_hash &&
    member.selected.selectionRevision === preference.selection_revision;
  const initialOriginal =
    vector.status === "ready" &&
    vector.members.every((member) =>
      initialOriginalView(method, preference, member),
    );
  const ready =
    vector.status === "ready" &&
    vector.members.every(
      (member) => member.inputCount === 0 || matches(member),
    );
  const active = vector.members.find((member) => member.active)?.active ?? null;
  const pending = vector.members.reduce(
    (count, member) =>
      count +
      (member.active
        ? Math.max(0, member.active.snapshotTotal - member.active.processed)
        : member.pending),
    0,
  );
  const processed = vector.members.reduce(
    (count, member) =>
      count + ((member.active ?? member.selected)?.processed ?? 0),
    0,
  );
  const unavailable =
    vector.unprovableCount +
    vector.members.reduce(
      (count, member) =>
        count + ((member.active ?? member.selected)?.unavailable ?? 0),
      0,
    );
  return {
    initialOriginal,
    ready,
    active,
    pending: initialOriginal ? 0 : pending,
    processed,
    unavailable,
    updating: !initialOriginal && (!ready || pending > 0 || active !== null),
    incompleteAuthority: vector.status !== "ready",
  };
}
