import { useState } from "react";
import { Icon } from "@footprint/ui/icons";
import inventory from "../../../../THIRD-PARTY-INVENTORY.json";
import type { BundledNotices } from "../dashboard/about-notices";

type Component = { name: string; license: string; version?: string; homepage?: string; browser_runtime?: boolean };

/** What each component in the extension itself is for; the rest are build and test tools. */
const ROLES: Record<string, string> = {
  "EcoLogits independent TypeScript port": "Electricity, carbon and water estimates",
  ecologits: "Model and provider data",
  "gpt-tokenizer": "Counting tokens in your browser",
  react: "Interface",
  "react-dom": "Interface",
  scheduler: "Interface",
  wxt: "Extension build",
  "@wxt-dev/browser": "Extension build",
  vite: "Extension build",
  zod: "Data checks",
  "@noble/hashes": "Privacy-preserving identifiers",
  "decimal.js": "Exact decimal sums",
  "pdfjs-dist": "Reading text from PDF files you attach",
  fflate: "Reading attached office documents",
  saxes: "Reading attached office documents",
  xmlchars: "Reading attached office documents",
  "@streamparser/json": "Reading replies as they stream",
  "core-js": "Browser compatibility",
};
const SHOWN = 8;

/** Release packaging supplies these paths only after the bundled files are verified. */
export function bundledPath(path: string | undefined) {
  return path && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(path) && !path.split("/").includes("..") ? path : null;
}

export function Licences({ notices }: { notices?: BundledNotices }) {
  const [all, setAll] = useState(false);
  const components = (inventory as { components: Component[] }).components;
  // Components the extension runs come first, in the order the canvas lists them.
  const ordered = [...components].sort((a, b) => Number(!!b.browser_runtime) - Number(!!a.browser_runtime) || Number(!!ROLES[b.name]) - Number(!!ROLES[a.name]) || a.name.localeCompare(b.name));
  const counts = components.reduce<Record<string, number>>((acc, c) => {
    const key = ["MIT", "BSD-3-Clause", "MPL-2.0", "Apache-2.0"].includes(c.license) ? c.license : "Other";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const shown = all ? ordered : ordered.slice(0, SHOWN);
  const license = bundledPath(notices?.licensePath);
  const source = bundledPath(notices?.sourcePath);
  return (
    <div className="dh-licences">
      <p className="dh-lead">
        AI Footprint Tracker is open source under the MIT licence, © 2026 Pranit Jagannath Nale. It builds on {components.length} other open-source components, each under its own licence.
      </p>
      <ul className="lc-counts">
        {(
          [
            ["MIT", "MIT"],
            ["BSD-3-Clause", "BSD 3-Clause"],
            ["MPL-2.0", "MPL 2.0"],
            ["Apache-2.0", "Apache 2.0"],
            ["Other", "Other licences"],
          ] as const
        ).map(([key, label]) => (
          <li key={key}>
            <b className="lg-display lg-num">{counts[key] ?? 0}</b> {label}
          </li>
        ))}
      </ul>
      <div className="dh-card lc-ecologits">
        <Icon name="book" size={18} />
        <p>
          <b>EcoLogits, MPL 2.0.</b> The estimates use an independent TypeScript port of EcoLogits. Its source, including our changes, is available with the extension and in the project repository.
        </p>
      </div>
      <section className="dh-card" aria-labelledby="lc-components">
        <h2 id="lc-components" className="lg-display">
          Components
        </h2>
        <table className="dh-table">
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Used for</th>
              <th scope="col">Licence</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={`${c.name}@${c.version ?? ""}`}>
                <th scope="row">
                  {c.name}
                  {c.version && <span className="dh-soft"> {c.version}</span>}
                </th>
                <td className="dh-soft">{ROLES[c.name] ?? (c.browser_runtime ? "Part of the extension" : "Build and test tools")}</td>
                <td>
                  <span className="lc-licence">{c.license === "NOASSERTION" ? "Not stated" : c.license}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dh-soft lc-more">
          Showing {shown.length} of {components.length}
          {!all && (
            <>
              {" · "}
              <button type="button" className="dh-link dh-link-btn" onClick={() => setAll(true)}>
                Show all
              </button>
            </>
          )}
        </p>
        {license && source ? (
          <p className="lc-files">
            {notices!.release && <span>Release {notices!.release}. </span>}
            <a href={license} target="_blank" rel="noopener noreferrer" className="dh-link">
              Bundled licences and notices
            </a>{" "}
            ·{" "}
            <a href={source} target="_blank" rel="noopener noreferrer" className="dh-link">
              Corresponding source and changes
            </a>
          </p>
        ) : (
          <p className="dh-soft lc-files">The full licence texts are packaged with released builds. This development build does not include them yet.</p>
        )}
      </section>
    </div>
  );
}
