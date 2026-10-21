# Build the website on the host with `pnpm --filter @footprint/web build` first. That build
# needs the release artifacts, the source reconstruction report and the full checkout, which
# stay outside this build context, and it refuses packages that do not match the verified
# release manifest. This stage checks the copied site again, so a missing or altered build
# fails here.
FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS downloads
WORKDIR /opt/aift
COPY apps/web/scripts/check-built-downloads.mjs check-built-downloads.mjs
COPY apps/web/dist dist
RUN node check-built-downloads.mjs dist

FROM nginx:1.30.4-alpine3.24@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c
COPY deploy/proxy/default.conf.template /etc/nginx/templates/default.conf.template
# Outside the templates folder: the entrypoint check adds it only when a tenant host is set.
COPY deploy/proxy/tenant.conf.template /etc/nginx/aift/tenant.conf.template
COPY deploy/proxy/10-validate-config.sh /docker-entrypoint.d/10-validate-config.sh
RUN chmod 0555 /docker-entrypoint.d/10-validate-config.sh
COPY --from=downloads /opt/aift/dist /usr/share/nginx/html
EXPOSE 443
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- --no-check-certificate --header="Host: ${AIFT_REGISTRATION_HOST}" https://127.0.0.1/health/live >/dev/null || exit 1
