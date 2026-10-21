import inventory from "../../../../THIRD-PARTY-INVENTORY.json";
import { websiteNotices } from "../generated/website-notices";

type Component = { name: string; version: string; license: string; scope: string; ecosystem: string; browser_runtime?: boolean };
type Data = { name: string; version: string; license: string; license_status: string; source: string; shipped_in?: string[]; part_of?: string };

const record = inventory as unknown as { components: Component[]; data: Data[] };

function usedIn(component: Component) {
  if (component.browser_runtime) return "Browser extension";
  if (component.ecosystem === "pypi" && component.scope === "runtime") return "Server";
  return component.scope === "optional_not_shipped" ? "Not shipped (optional)" : "Development only";
}

const PLACES: Record<string, string> = { browser_extension: "Extension", server: "Server", website: "Website" };

/**
 * The licence notices this website must carry for the code and fonts it ships, generated at
 * build time, followed by the project inventory for the extension and server.
 */
export function ThirdPartyNotices() {
  return (
    <article className="art notices">
      <h2>Licences and notices</h2>
      <p>This website includes the third-party components below. Each keeps its own licence, and its full licence text is shown with it. The browser extension carries its own notices in every download (open licenses.html in the package).</p>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th>Version</th>
              <th>Licence</th></tr></thead>
          <tbody>
            {websiteNotices.map((item) => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td>{item.version}</td>
                <td>{item.license}</td></tr>
            ))}</tbody></table></div>
      {websiteNotices.map((item) => (
        <details key={item.name}>
          <summary>
            {item.name} {item.version}: licence text</summary>
          {item.notices.map((notice) => (
            <div key={notice.file}>
              <p>
                <b>{notice.file}</b></p>
              <pre>{notice.text}</pre></div>
          ))}</details>
      ))}
      <h3>Data</h3>
      <p>Data the extension or server includes, and the sources it comes from. Where a licence could not be verified, it says so.</p>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Licence</th>
              <th>Included in</th></tr></thead>
          <tbody>
            {record.data.map((item) => (
              <tr key={item.name}>
                <td>
                  <a href={item.source} target="_blank" rel="noopener noreferrer">{item.name}</a></td>
                <td>{item.license_status === "unverified" ? "Not verified" : item.license}</td>
                <td>{(item.shipped_in ?? []).map((place) => PLACES[place] ?? place).join(", ")}</td></tr>
            ))}</tbody></table></div>
      <details>
        <summary>All {record.components.length} components of the extension and server</summary>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Version</th>
                <th>Licence</th>
                <th>Used in</th></tr></thead>
            <tbody>
              {record.components.map((item) => (
                <tr key={`${item.ecosystem}:${item.name}`}>
                  <td>{item.name}</td>
                  <td>{item.version}</td>
                  <td>{item.license === "NOASSERTION" ? "Not stated" : item.license}</td>
                  <td>{usedIn(item)}</td></tr>
              ))}</tbody></table></div></details>
    </article>
  );
}
