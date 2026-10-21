import identity from "../../../packages/ecologits-core/data/identity.json";

/** Relative extension-only routes generated and checked by the release packaging hook. */
export const bundledNotices = Object.freeze({
  licensePath: "licenses.html",
  sourcePath: "source/ecologits-source.zip",
  release: `EcoLogits ${identity.upstream_version}, catalog ${identity.catalog_sha256}`,
});
