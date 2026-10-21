#!/bin/sh
set -eu

# Tests run this script against a temporary directory; the image leaves it empty.
root=${AIFT_PROXY_ROOT:-}
tenant_source="$root/etc/nginx/aift/tenant.conf.template"
tenant_template="$root/etc/nginx/templates/tenant.conf.template"
tenant_output="$root/etc/nginx/conf.d/tenant.conf"

validate_exact_host() {
  value=$1
  printf '%s\n' "$value" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
}

validate_tenant_host() {
  value=$1
  case "$value" in
    \*.*) validate_exact_host "${value#*.}" ;;
    *) validate_exact_host "$value" ;;
  esac
}

case "${1:-}" in
  --validate-exact) validate_exact_host "${2:-}"; exit ;;
  --validate-tenant) validate_tenant_host "${2:-}"; exit ;;
esac

validate_exact_host "${AIFT_REGISTRATION_HOST:-}" || {
  echo "AIFT_REGISTRATION_HOST must be an exact DNS host" >&2
  exit 1
}
validate_exact_host "${AIFT_OPERATOR_HOST:-}" || {
  echo "AIFT_OPERATOR_HOST must be an exact DNS host" >&2
  exit 1
}
if [ "$AIFT_REGISTRATION_HOST" = "$AIFT_OPERATOR_HOST" ]; then
  echo "Registration and operator hosts must be distinct" >&2
  exit 1
fi
# A self-hosted organization needs its own host. The hosted service serves every organization at
# the registration host, so an empty AIFT_TENANT_HOST leaves the tenant server block out.
tenant_host=${AIFT_TENANT_HOST:-}
if [ -n "$tenant_host" ]; then
  validate_tenant_host "$tenant_host" || {
    echo "AIFT_TENANT_HOST must be empty, an exact DNS host or one leading-wildcard DNS host" >&2
    exit 1
  }
  if [ "$tenant_host" = "$AIFT_OPERATOR_HOST" ]; then
    echo "Tenant and operator hosts must be distinct" >&2
    exit 1
  fi
  if [ "$tenant_host" = "$AIFT_REGISTRATION_HOST" ]; then
    echo "Tenant and registration hosts must be distinct" >&2
    exit 1
  fi
  test -r "$tenant_source" || {
    echo "The tenant server template is missing" >&2
    exit 1
  }
  mkdir -p "$(dirname "$tenant_template")"
  cp "$tenant_source" "$tenant_template"
else
  # A restarted container keeps its files, so a host removed since the last start must not linger.
  rm -f "$tenant_template" "$tenant_output"
fi
test -r "$root/run/aift-tls/fullchain.pem" || {
  echo "TLS certificate is missing" >&2
  exit 1
}
test -r "$root/run/aift-tls/privkey.pem" || {
  echo "TLS private key is missing" >&2
  exit 1
}
