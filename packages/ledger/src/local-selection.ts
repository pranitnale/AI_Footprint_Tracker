import {
  canonicalJson,
  payloadHash,
  EnginePreferenceRecordSchema,
  SelectionRevisionSchema,
} from "@footprint/contracts";
import { request, type Scope } from "./ledger-support";
import {
  checkedScope,
  scopeKey,
  stateFor,
  writable,
  type JobRow,
  type StateRow,
} from "./estimation-storage";
import type {
  EnginePreferenceState,
  LocalSelectionState,
  RecalculationJob,
} from "./estimation-contracts";
import { uniformOriginalMethodHash } from "./original-method-proof";

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function validScope(value: unknown): value is Scope {
  try {
    checkedScope(value as Scope);
    return true;
  } catch {
    return false;
  }
}
export async function readLocalAuthority(tx: IDBTransaction) {
  const [history, credentials, personal] = await Promise.all([
    request(tx.objectStore("policy").get("ownership-history")),
    request(tx.objectStore("policy").get("credentials")),
    request(tx.objectStore("policy").get("personal")),
  ]);
  const eras: any[] = Array.isArray(history?.eras) ? history.eras : [];
  const last = eras.at(-1);
  const validEra = (era: any) =>
    era &&
    validScope(era.scope) &&
    Number.isFinite(era.start) &&
    (era.end === null || (Number.isFinite(era.end) && era.end >= era.start));
  let current: Scope | null =
    validEra(last) && last.end === null ? last.scope : null;
  if (
    current?.mode === "company" &&
    (!credentials ||
      credentials.namespace !== current.namespace ||
      credentials.enrollment_era?.id !== current.era ||
      typeof credentials.device_id !== "string" ||
      !credentials.device_id ||
      (credentials.enrollment_state !== undefined &&
        credentials.enrollment_state !== "active"))
  )
    current = null;
  if (
    current?.mode === "personal" &&
    (!personal || personal.namespace !== current.namespace)
  )
    current = null;
  const grants = new Map<string, Scope>();
  const savedPersonal = {
    namespace: personal?.namespace,
    mode: "personal",
    era: null,
  };
  const personalReadScope: Scope | null =
    validScope(savedPersonal) &&
    eras.some((era) => validEra(era) && same(era.scope, savedPersonal))
      ? savedPersonal
      : null;
  if (current)
    for (const era of eras) {
      if (
        validEra(era) &&
        era.scope.namespace === current.namespace &&
        era.scope.mode === current.mode
      )
        grants.set(scopeKey(era.scope), era.scope);
    }
  // Tokens bind trust rotations, but never include credentials or secrets in their public representation.
  const fingerprint = payloadHash({
    eras,
    personal: personal
      ? {
          namespace: personal.namespace ?? null,
          secret: personal.secret ?? null,
        }
      : null,
    credentials: credentials
      ? {
          namespace: credentials.namespace ?? null,
          device: credentials.device_id ?? null,
          era: credentials.enrollment_era ?? null,
          status: credentials.enrollment_state ?? null,
          origin: credentials.origin ?? null,
          methodKey: credentials.method_public_key ?? null,
          deletionKey: credentials.deletion_public_key ?? null,
          hmac: credentials.user_hmac_key ?? null,
        }
      : null,
  });
  return {
    current,
    personalReadScope,
    grants,
    fingerprint,
    legacy: !history && !credentials && !personal,
  };
}

/** This grants local numeric reads only. Upload and capture admission use their existing policies. */
export async function localScopeAllowed(
  tx: IDBTransaction,
  authorityScope: Scope,
  sourceScope: Scope,
): Promise<boolean> {
  if (
    !validScope(authorityScope) ||
    !validScope(sourceScope) ||
    !(await writable(tx, sourceScope))
  )
    return false;
  const authority = await readLocalAuthority(tx);
  if (authority.legacy) return same(authorityScope, sourceScope);
  if (
    authority.personalReadScope &&
    same(authorityScope, authority.personalReadScope)
  )
    return same(authorityScope, sourceScope);
  return (
    !!authority.current &&
    same(authorityScope, authority.current) &&
    authority.grants.has(scopeKey(sourceScope))
  );
}
/** Saved Personal observations remain readable when routing falls back from company mode. */
export async function localReadMemberAllowed(
  tx: IDBTransaction,
  scope: Scope,
): Promise<boolean> {
  if (!validScope(scope) || !(await writable(tx, scope))) return false;
  const authority = await readLocalAuthority(tx);
  return (
    authority.legacy ||
    (!!authority.current && authority.grants.has(scopeKey(scope))) ||
    (!!authority.personalReadScope && same(scope, authority.personalReadScope))
  );
}
export async function localMemberAllowed(
  tx: IDBTransaction,
  scope: Scope,
): Promise<boolean> {
  if (!validScope(scope) || !(await writable(tx, scope))) return false;
  const authority = await readLocalAuthority(tx);
  return (
    authority.legacy ||
    (!!authority.current && authority.grants.has(scopeKey(scope)))
  );
}
export async function readPreferenceState(
  tx: IDBTransaction,
): Promise<EnginePreferenceState> {
  const row = await request(
    tx.objectStore("engine_preferences").get("installation"),
  );
  if (!row) return { status: "missing", revision: null };
  const parsed = EnginePreferenceRecordSchema.safeParse(row.record);
  if (parsed.success)
    return {
      status: "valid",
      revision: parsed.data.selection_revision,
      record: parsed.data,
    };
  const revision = SelectionRevisionSchema.safeParse(
    row.record?.selection_revision,
  );
  return {
    status: "invalid",
    revision: revision.success ? revision.data : null,
  };
}
export const publicJob = ({
  key: _,
  namespace: __,
  scopeKey: ___,
  authority: ____,
  baseWatermark: _____,
  ...job
}: JobRow): RecalculationJob => job;

/** Read the complete publication vector in the caller's transaction, without observing page-progress writes. */
export async function readLocalSelection(
  tx: IDBTransaction,
  authorityScope: Scope,
): Promise<LocalSelectionState> {
  checkedScope(authorityScope);
  const authority = await readLocalAuthority(tx);
  const preference = await readPreferenceState(tx);
  const unavailable = (): LocalSelectionState => ({
    execution: "local_only",
    authorityScope,
    status: "unavailable",
    members: [],
    unprovableCount: 0,
    scopeLimitExceeded: false,
    token: payloadHash({
      authority: authority.fingerprint,
      authorityScope,
      preference,
      unavailable: true,
    }),
  });
  const currentAuthority =
    !!authority.current && same(authority.current, authorityScope);
  const personalRead =
    !!authority.personalReadScope &&
    same(authority.personalReadScope, authorityScope);
  if (
    (!currentAuthority && !personalRead) ||
    !(await writable(tx, authorityScope))
  )
    return unavailable();
  const readableScopes = currentAuthority
    ? authority.grants
    : new Map([[scopeKey(authorityScope), authorityScope]]);
  const directory: StateRow[] = await request(
    tx
      .objectStore("estimation_state")
      .index("namespace")
      .getAll(authorityScope.namespace, 65),
  );
  const scopes = new Map<string, Scope>([
    [scopeKey(authorityScope), authorityScope],
  ]);
  for (const state of directory) {
    const scope = readableScopes.get(state.key);
    if (scope && scopes.size < 64) scopes.set(state.key, scope);
  }
  const scopeLimitExceeded =
    directory.length > 64 ||
    directory.some(
      (state) => readableScopes.has(state.key) && !scopes.has(state.key),
    );
  const revision =
    preference.status === "missing"
      ? 1
      : preference.status === "valid"
        ? preference.revision
        : null;
  const members: LocalSelectionState["members"] = [];
  const vector: unknown[] = [];
  for (const scope of scopes.values()) {
    const state = await stateFor(tx, scope);
    const inputCount = await request(
      tx.objectStore("estimation_inputs").index("scope").count(state.key),
    );
    const originalHashProof = await uniformOriginalMethodHash(
      tx,
      state.key,
      inputCount,
    );
    const originalEvidenceCurrent =
      (await request(
        tx
          .objectStore("estimation_inputs")
          .index("originalEvidence")
          .count([state.key, 1]),
      )) === inputCount;
    const [savedActive, savedSelected]: Array<JobRow | undefined> =
      await Promise.all([
        state.activeJob
          ? request(tx.objectStore("estimation_jobs").get(state.activeJob))
          : undefined,
        state.selectedJob
          ? request(tx.objectStore("estimation_jobs").get(state.selectedJob))
          : undefined,
      ]);
    const active =
      currentAuthority &&
      savedActive?.status === "running" &&
      savedActive.scopeKey === state.key &&
      savedActive.generation === state.generation &&
      savedActive.authority === authority.fingerprint &&
      savedActive.selectionRevision === revision
        ? savedActive
        : null;
    // Completed local arithmetic remains valid under a renewed read grant for the unchanged source.
    const selected =
      savedSelected?.status === "complete" &&
      savedSelected.scopeKey === state.key &&
      savedSelected.selectionRevision === revision
        ? savedSelected
        : null;
    const pending = selected
      ? await request(
          tx
            .objectStore("estimation_inputs")
            .index("sequence")
            .count(
              IDBKeyRange.bound(
                [state.key, selected.watermark],
                [state.key, Number.MAX_SAFE_INTEGER],
                true,
              ),
            ),
        )
      : inputCount;
    members.push({
      scope,
      inputCount,
      uniformOriginalMethodHash: originalHashProof,
      originalEvidenceCurrent,
      pending,
      publicationVersion: state.publicationVersion,
      active: active ? publicJob(active) : null,
      selected: selected ? publicJob({ ...selected, pending }) : null,
    });
    const binding = (job: JobRow | null) =>
      job
        ? {
            id: job.id,
            status: job.status,
            generation: job.generation,
            target: job.target,
            fallbackMethod: job.fallbackMethod ?? null,
            selectionRevision: job.selectionRevision,
            watermark: job.watermark,
          }
        : null;
    vector.push({
      scope,
      sequence: state.sequence,
      inputCount,
      uniformOriginalMethodHash: originalHashProof,
      originalEvidenceCurrent,
      pending,
      publicationVersion: state.publicationVersion,
      active: binding(active),
      selected: binding(selected),
    });
  }
  const total = await request(
    tx
      .objectStore("estimation_inputs")
      .index("namespace")
      .count(authorityScope.namespace),
  );
  const unprovableCount = Math.max(
    0,
    total - members.reduce((count, member) => count + member.inputCount, 0),
  );
  const epoch = await request(
    tx.objectStore("dashboard_cache").get(`epoch:${authorityScope.namespace}`),
  );
  const status =
    preference.status === "invalid"
      ? "unavailable"
      : unprovableCount || scopeLimitExceeded
        ? "partial"
        : "ready";
  return {
    execution: "local_only",
    authorityScope,
    status,
    members,
    unprovableCount,
    scopeLimitExceeded,
    token: payloadHash({
      authority: authority.fingerprint,
      preference,
      vector,
      total,
      scopeLimitExceeded,
      epoch: epoch ?? null,
    }),
  };
}
export async function localSelectionCurrent(
  tx: IDBTransaction,
  authorityScope: Scope,
  token: string,
): Promise<boolean> {
  const current = await readLocalSelection(tx, authorityScope);
  // Invalid preferences still permit an explicitly Original view under a valid local read grant.
  return current.members.length > 0 && current.token === token;
}
