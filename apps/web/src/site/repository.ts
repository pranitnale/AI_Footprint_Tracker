import repository from "../../../../config/source-repository.json";

/** The public source repository. The address lives in config/source-repository.json. */
export const SOURCE_REPOSITORY_URL: string = repository.url;

/** The address without its scheme, as the legal pages show it in link text. */
export const SOURCE_REPOSITORY_LABEL: string = repository.url.replace(/^https:\/\//, "");

/** A file in the public repository, for example "docs/operations/SELF-HOSTING.md". */
export const sourceFileUrl = (path: string) =>
  `${repository.url}/blob/${repository.branch}/${path}`;
