import type { FileTextCoverage, FileTextSeries } from "@footprint/ui";

export type Role = "user" | "admin" | "operator";
export type Session = {
  role: Role;
  user_id: string | null;
  company_id: string | null;
  company_name: string | null;
  /** The signed-in work email; older servers leave it out. */
  email?: string | null;
  /**
   * Whether the organization is being deleted; null for the developer panel and absent on older
   * servers. While deletion is scheduled, admin pages other than the session and deletion answer
   * 403 service_suspended.
   */
  organization_status?: "active" | "deletion_scheduled" | "deleting" | null;
  csrf_token: string;
  expires_at: string;
};
export type ApiProblem = {
  code: string;
  retryable: boolean;
  correlation_id?: string;
  safe_message: string;
  status: number;
};
export type Series = {
  quantity: string;
  unit: string;
  scope: string;
  value: string | null;
  applicable_count: number;
  unknown_count: number;
  partial_count: number;
  unvalidated_count: number;
  contributing_attempt_count: number;
  reason_counts?: Record<string, number | string>;
  method_group?: Record<string, unknown>;
  measurement_group?: Record<string, unknown>;
};
export type HistorySummary = {
  schema_version: "1.0.0";
  scope: "loaded_history";
  status: "available" | "empty" | "unavailable";
  observed_prompt_count: string;
  observed_response_count: string;
  prompt_count: string;
  response_count: string;
  dated_message_count: string;
  undated_message_count: string;
  calculated_message_count: string;
  uncalculated_message_count: string;
  matched_live_message_count: string;
  unresolved_overlap_message_count: string;
  conflicting_message_count: string;
  first_request_verified: boolean;
  branch_scope: "selected_branch" | "loaded_messages" | "unknown";
  provider_history_complete: false;
  file_text: FileTextSeries[];
  file_text_coverage: {
    observed_message_count: string;
    unknown_message_count: string;
    scope: "extracted_file_text";
    additive: false;
  };
  tokens: Array<{
    role: "prompt" | "response";
    part: "total" | "tool_output" | "image_input_tokens" | "other_models";
    profile_id: string | null;
    evidence: "heuristic_estimate" | "provider_reported" | "unknown";
    value: string | null;
    known_message_count: string;
    unknown_message_count: string;
  }>;
  resources: Array<{
    quantity:
      "energy" | "carbon" | "water_direct" | "water_upstream" | "water_total";
    value: string | null;
    unit: string;
    scope: "historical_visible_response";
    method_id: string;
    method_hash: string;
    status: "partial_estimate" | "unavailable";
    validation_state: "unvalidated_reference";
    profile_selection: "highest_comparable" | "unavailable";
    selected_profile_id: string | null;
    reasons: string[];
    missing_components: string[];
    known_message_count: string;
    unknown_message_count: string;
  }>;
};
export type Summary = {
  snapshot_id?: string;
  generated_at?: string;
  range_start?: string;
  range_end?: string;
  timezone?: string;
  aggregate_status: string;
  suppressed?: boolean;
  safe_message?: string;
  retention_cutoff?: string | null;
  request_count?: string;
  attempt_count?: string;
  unresolved_request_count?: string;
  active_users?: string;
  active_installations?: string;
  outcomes?: Record<string, string>;
  tokens?: Series[];
  resources?: Series[];
  pending_estimates?: string;
  mixed_methods?: boolean;
  method_groups?: string[];
  observed_search_operations?: string | null;
  search_known_request_count?: string;
  search_unknown_request_count?: string;
  media_counts?: Series[];
  /** Series of results saved before the image benchmark data was removed on 20 Oct 2026; not shown. */
  image_references?: Series[];
  file_text?: FileTextSeries[] | null;
  file_text_coverage?: FileTextCoverage | null;
  history?: HistorySummary;
  coverage?: {
    recorded_attempts: string;
    resource_scope: string;
    unknown_is_zero: false;
    reference_only_excluded: true;
  };
};
export type Member = {
  user_id: string;
  email: string | null;
  role: "user" | "admin";
  status: string;
  membership_version: number;
  installations: number;
};
/** One row of the Requests page, sent only while the server has person analytics switched on. */
export type RequestRow = {
  request_id: string;
  user_id: string;
  dispatched_at: string;
  ended_at: string | null;
  site: string;
  model_id: string | null;
  state: string;
  coverage_reasons: string[];
  attempt_count: string;
  shared_attempt_count?: string;
  detail_path: string;
  /** Tokens and electricity added from the request's own attempts, as Details adds them. */
  figures?: {
    tokens_in: string | null;
    tokens_out: string | null;
    energy: {
      value: string;
      unit: string;
      value_kind: "scalar" | "midpoint_sum";
      scenario_low: string | null;
      scenario_high: string | null;
    } | null;
    energy_status: "available" | "pending" | "unknown";
  };
};
export type Registration = {
  registration_id: string;
  state: string;
  expires_at: string;
  next_step?: string;
  company_origin?: string;
  destination?: string;
  csrf_token?: string;
};
export type OtpChallenge = {
  challenge_id: string;
  delivery_state: "accepted" | "delivery_unknown" | "failed";
  expires_at: string;
  retry_at: string;
  error_code: string | null;
};

export type CalculationMethod = {
  method_id: string;
  method_hash: string;
  equation_id: string;
  default: boolean;
  state: "supported";
  validation_state: "unvalidated_reference" | string;
  provenance: Record<string, unknown>;
  approval: {
    trust: "packaged_release" | "deployment_pinned_p256_signature";
    [key: string]: unknown;
  };
  installed_at: string | null;
  /** Present on engine methods: "ecologits" for the shipped method. */
  engine_id?: string;
  /** The EcoLogits release an engine method uses, for example "0.11.2". */
  source_version?: string | null;
};

export type MethodInventory = {
  default_method_id: string;
  methods: CalculationMethod[];
};

declare global {
  interface Window {
    __AIFT_CONFIG__?: {
      registrationOrigin?: string;
      hostedDomain?: string;
      sourceRepository?: string;
      downloads?: Partial<Record<"chrome" | "edge" | "firefox", string>>;
    };
  }
}
