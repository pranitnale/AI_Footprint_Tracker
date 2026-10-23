# Build the website on the host with `pnpm --filter @footprint/web build` first. That build
# needs the release artifacts, the source reconstruction report and the full checkout, which
# stay outside this build context, and it refuses packages that do not match the verified
# release manifest. This stage checks the copied site again, so a missing or altered build
# fails here.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS downloads
WORKDIR /opt/aift
COPY apps/web/scripts/check-built-downloads.mjs check-built-downloads.mjs
COPY apps/web/dist dist
RUN node check-built-downloads.mjs dist

FROM nginx:1.30.6-alpine3.24@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951
COPY deploy/proxy/default.conf.template /etc/nginx/templates/default.conf.template
# Outside the templates folder: the entrypoint check adds it only when a tenant host is set.
COPY deploy/proxy/tenant.conf.template /etc/nginx/aift/tenant.conf.template
COPY deploy/proxy/10-validate-config.sh /docker-entrypoint.d/10-validate-config.sh
RUN chmod 0555 /docker-entrypoint.d/10-validate-config.sh
COPY --from=downloads /opt/aift/dist /usr/share/nginx/html
EXPOSE 443
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- --no-check-certificate --header="Host: ${AIFT_REGISTRATION_HOST}" https://127.0.0.1/health/live >/dev/null || exit 1
