import { isRouteConversationId, type RouteSite } from "./routes";

export interface DisplayBinding {
  documentNonce: string;
  navigationNonce: string;
  captureId: string | null;
}
export interface ConversationIdentity {
  site: RouteSite;
  conversationId: string;
}
export interface DisplayContext {
  documentNonce: string;
  navigationNonce: string;
  selectedCaptureId: string | null;
  route: ConversationIdentity | null;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isDisplayBinding(
  value: unknown,
  expectedCaptureId: string | null,
): value is DisplayBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as DisplayBinding;
  return (
    Object.keys(v).sort().join(",") ===
      "captureId,documentNonce,navigationNonce" &&
    typeof v.documentNonce === "string" &&
    uuid.test(v.documentNonce) &&
    typeof v.navigationNonce === "string" &&
    uuid.test(v.navigationNonce) &&
    v.captureId === expectedCaptureId &&
    (v.captureId === null ||
      (typeof v.captureId === "string" && uuid.test(v.captureId)))
  );
}
export function isConversationIdentity(
  value: unknown,
): value is ConversationIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as ConversationIdentity;
  return (
    Object.keys(v).sort().join(",") === "conversationId,site" &&
    isRouteConversationId(v.site, v.conversationId)
  );
}
export function matchesDisplayContext(
  binding: DisplayBinding,
  identity: ConversationIdentity | null,
  context: DisplayContext,
): boolean {
  if (
    !isDisplayBinding(binding, binding?.captureId) ||
    (identity !== null && !isConversationIdentity(identity)) ||
    binding.documentNonce !== context.documentNonce
  )
    return false;
  const sameRoute =
    !!context.route &&
    !!identity &&
    context.route.site === identity.site &&
    context.route.conversationId === identity.conversationId;
  if (binding.captureId === null)
    return binding.navigationNonce === context.navigationNonce && sameRoute;
  if (binding.captureId !== context.selectedCaptureId) return false;
  return context.route
    ? sameRoute
    : binding.navigationNonce === context.navigationNonce;
}
