const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const template = readFileSync("deploy/proxy/default.conf.template", "utf8");
const tenantTemplate = readFileSync("deploy/proxy/tenant.conf.template", "utf8");
const script = "deploy/proxy/10-validate-config.sh";

function serverBlock(variable) {
  const source = variable === "AIFT_TENANT_HOST" ? tenantTemplate : template;
  const start = source.indexOf(`server_name \${${variable}};`);
  assert.notEqual(start, -1, `missing ${variable} server`);
  const end = source.indexOf("\nserver {", start);
  return source.slice(start, end === -1 ? undefined : end);
}

function matches(block, path) {
  if (path === "/" && block.includes("location = /")) return true;
  // A pattern with a {n} quantifier is quoted for nginx; the quotes are not part of the regex.
  const patterns = [...block.matchAll(/location ~ "?(\^\S+?)"? \{/g)].map(
    (match) => new RegExp(match[1]),
  );
  return patterns.some((pattern) => pattern.test(path));
}

const PERSON = "/admin/people/0f2c6a1b-6d44-4b64-9f8e-0c4a3d2f1e7b";
const SITE = [
  "/",
  "/methodology",
  "/methodology/ecologits",
  "/methodology/reference",
  "/terms",
  "/privacy-policy",
  "/dpa",
  "/imprint",
  "/privacy",
  "/open-source",
  "/downloads",
  "/download",
  "/teams",
  "/self-host",
  "/login",
];
const ADMIN = [
  "/admin",
  "/admin/people",
  PERSON,
  "/admin/users",
  "/admin/usage",
  "/admin/tools",
  "/admin/activity",
  // Requests and Network show only while the server has person analytics (and, for Network,
  // IP collection) switched on; otherwise the website routes Requests to Activity.
  "/admin/requests",
  "/admin/network",
  "/admin/health",
  "/admin/policies",
  "/admin/exports",
  "/admin/audit",
  "/admin/deletions",
  "/admin/plan",
];

const routes = {
  // The hosted service has one address, so its administrators use the registration host.
  AIFT_REGISTRATION_HOST: [...SITE, "/contact", "/register", ...ADMIN],
  AIFT_TENANT_HOST: [...SITE, ...ADMIN],
  AIFT_OPERATOR_HOST: [
    "/operator",
    "/operator/login",
    "/operator/contacts",
    "/operator/plans",
    "/operator/exceptions",
    "/operator/health",
  ],
};

test("proxy serves every application route from the built static root", () => {
  for (const [host, paths] of Object.entries(routes)) {
    const block = serverBlock(host);
    assert.match(block, /root \/usr\/share\/nginx\/html;/);
    for (const path of paths)
      assert.equal(
        matches(block, path),
        true,
        `${host} does not serve ${path}`,
      );
  }
});

test("proxy rejects unknown product routes and keeps operator navigation separate", () => {
  for (const host of ["AIFT_REGISTRATION_HOST", "AIFT_TENANT_HOST"]) {
    const block = serverBlock(host);
    assert.equal(matches(block, "/admin/unknown"), false);
    assert.equal(matches(block, "/admin/people/not-an-id"), false);
    assert.equal(matches(block, "/operator"), false);
    // Members connect from the extension; the website has no member pages.
    assert.equal(matches(block, "/onboarding"), false);
  }
  assert.equal(matches(serverBlock("AIFT_OPERATOR_HOST"), "/admin"), false);
  assert.match(template, /listen 443 ssl default_server;[\s\S]*return 404;/);
  // The tenant server lives only in its own template, which the entrypoint adds for self-hosting.
  assert.equal(template.includes("AIFT_TENANT_HOST"), false);
});

test("organization hosts send contact and registration to the registration host", () => {
  const tenant = serverBlock("AIFT_TENANT_HOST");
  assert.match(
    tenant,
    /location ~ \^\/\(contact\|register\)\/\?\$ \{\s*return 302 https:\/\/\$\{AIFT_REGISTRATION_HOST\}\/\$1;/,
  );
  // The redirect comes before any page location, so it wins over a broader match.
  assert.ok(tenant.indexOf("(contact|register)") < tenant.indexOf("try_files /index.html"));
});

test("the image installs the tenant template outside the folder nginx renders by default", () => {
  const dockerfile = readFileSync("deploy/proxy/Dockerfile", "utf8");
  assert.match(
    dockerfile,
    /COPY deploy\/proxy\/tenant\.conf\.template \/etc\/nginx\/aift\/tenant\.conf\.template/,
  );
  assert.equal(/tenant\.conf\.template \/etc\/nginx\/templates\//.test(dockerfile), false);
});

function posixShell(context) {
  const gitShell = "C:/Program Files/Git/bin/sh.exe";
  const shell =
    process.platform === "win32"
      ? existsSync(gitShell)
        ? gitShell
        : "sh.exe"
      : "sh";
  if (spawnSync(shell, ["--version"], { encoding: "utf8" }).error) {
    context.skip(
      "POSIX shell unavailable on this host; CI executes this check on Ubuntu.",
    );
    return null;
  }
  return shell;
}

test("host validator accepts only exact DNS names or one leading tenant wildcard", (context) => {
  const shell = posixShell(context);
  if (!shell) return;
  for (const value of ["footprint.example.org", "operator.example.org"])
    assert.equal(
      spawnSync(shell, [script, "--validate-exact", value]).status,
      0,
    );
  for (const value of ["*.example.org", "company.example.org"])
    assert.equal(
      spawnSync(shell, [script, "--validate-tenant", value]).status,
      0,
    );
  for (const value of [
    "*.*.example.org",
    "foo.*.example.org",
    "-bad.example",
    "example",
  ])
    assert.notEqual(
      spawnSync(shell, [script, "--validate-tenant", value]).status,
      0,
    );
});

test("the entrypoint check adds the tenant server only when a tenant host is set", (context) => {
  const shell = posixShell(context);
  if (!shell) return;
  const root = mkdtempSync(join(tmpdir(), "aift-proxy-"));
  try {
    mkdirSync(join(root, "etc/nginx/aift"), { recursive: true });
    mkdirSync(join(root, "etc/nginx/templates"), { recursive: true });
    mkdirSync(join(root, "etc/nginx/conf.d"), { recursive: true });
    mkdirSync(join(root, "run/aift-tls"), { recursive: true });
    writeFileSync(join(root, "etc/nginx/aift/tenant.conf.template"), tenantTemplate);
    writeFileSync(join(root, "run/aift-tls/fullchain.pem"), "certificate");
    writeFileSync(join(root, "run/aift-tls/privkey.pem"), "key");
    const added = join(root, "etc/nginx/templates/tenant.conf.template");
    const rendered = join(root, "etc/nginx/conf.d/tenant.conf");
    const run = (tenant) =>
      spawnSync(shell, [script], {
        encoding: "utf8",
        env: {
          ...process.env,
          AIFT_PROXY_ROOT: root,
          AIFT_REGISTRATION_HOST: "footprint.example.org",
          AIFT_OPERATOR_HOST: "operator.footprint.example.org",
          AIFT_TENANT_HOST: tenant,
        },
      });

    const selfHosted = run("company.footprint.example.org");
    assert.equal(selfHosted.status, 0, selfHosted.stderr);
    assert.equal(readFileSync(added, "utf8"), tenantTemplate);

    // A restart with the tenant host removed must not keep the earlier server block.
    writeFileSync(rendered, "server {}");
    const hosted = run("");
    assert.equal(hosted.status, 0, hosted.stderr);
    assert.equal(existsSync(added), false);
    assert.equal(existsSync(rendered), false);

    for (const conflict of ["footprint.example.org", "operator.footprint.example.org", "-bad.example"])
      assert.notEqual(run(conflict).status, 0, `accepted tenant host ${conflict}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a location regex with braces is quoted so nginx can parse it", () => {
  // 13 Oct 2026: an unquoted {36} quantifier made nginx read "{" as a block start, and the
  // production web container refused to start. The route tests above only read the text.
  for (const [name, text] of [["default", template], ["tenant", tenantTemplate]]) {
    for (const line of text.split(/\r?\n/).filter((l) => /^\s*location ~\*? /.test(l))) {
      const pattern = line.trim().replace(/^location ~\*? /, "").replace(/\s*\{$/, "");
      if (pattern.includes("{")) assert.match(pattern, /^".*"$/, `${name}: ${pattern.slice(0, 60)}`);
    }
  }
});

/**
 * The template as nested blocks, each with its own directives. Quoted strings and comments are
 * skipped, so a quoted {36} quantifier is not read as a block. Template variables such as
 * ${AIFT_TENANT_HOST} become their bare names first, since their braces are not nginx syntax.
 */
function nginxBlocks(text) {
  const source = text.replace(/\$\{(\w+)\}/g, "$1");
  const plain = (value) => value.replace(/\s+/g, " ").trim();
  const root = { head: "", directives: [], children: [] };
  const stack = [root];
  let token = "";
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      token += ch;
      if (ch === quote && source[i - 1] !== "\\") quote = null;
    } else if (ch === "#") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      token += ch;
    } else if (ch === "{") {
      const block = { head: plain(token), directives: [], children: [] };
      stack.at(-1).children.push(block);
      stack.push(block);
      token = "";
    } else if (ch === ";") {
      stack.at(-1).directives.push(plain(token + ";"));
      token = "";
    } else if (ch === "}") {
      assert.equal(plain(token), "", "directive without a semicolon");
      stack.pop();
      token = "";
    } else token += ch;
  }
  assert.equal(stack.length, 1, "unbalanced braces");
  return root;
}

const HSTS = 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;';

test("every HTTPS response sends HSTS for one year including subdomains", () => {
  // The data processing agreement promises this header. nginx inherits a server's add_header only
  // in a block that sets none of its own, so every block with its own headers repeats it.
  const check = (block, label) => {
    if (block.directives.some((d) => d.startsWith("add_header ")))
      assert.ok(block.directives.includes(HSTS), `${label} sets headers without HSTS`);
    for (const child of block.children) check(child, `${label} > ${child.head}`);
  };
  for (const [name, text] of [["default", template], ["tenant", tenantTemplate]]) {
    const servers = nginxBlocks(text).children.filter((block) => block.head === "server");
    assert.ok(servers.length > 0, `${name}: no server block`);
    for (const server of servers) {
      const label = `${name} ${server.directives.find((d) => d.startsWith("server_name "))}`;
      assert.ok(server.directives.includes(HSTS), `${label} lacks HSTS`);
      check(server, label);
    }
  }
});

/** Every server block of both templates with its label, for the serving checks below. */
function servers() {
  const result = [];
  for (const [name, text] of [["default", template], ["tenant", tenantTemplate]]) {
    for (const block of nginxBlocks(text).children.filter((b) => b.head === "server")) {
      const label = `${name} ${block.directives.find((d) => d.startsWith("server_name "))}`;
      result.push({ label, block });
    }
  }
  return result;
}

const locationPattern = (location) => {
  const match = location.head.match(/^location ~\*? "?(\^.+?)"?$/);
  return match ? new RegExp(match[1]) : null;
};

/** The location nginx picks for a path among a server's regex locations: the first that matches. */
function regexLocation(block, path) {
  return block.children.find((child) => locationPattern(child)?.test(path));
}

// Speed work of 15 Oct 2026: summaries, breakdowns, the Activity page and request lists are
// compressed; nothing that carries a session, CSRF value or token is (BREACH).
const COMPRESSED_API = [
  "/v1/admin/summary",
  "/v1/company/summary",
  "/v1/me/summary",
  "/v1/me/conversations/abc/summary",
  "/v1/me/history/abc/summary",
  "/v1/me/recorded-threads/abc/summary",
  "/v1/admin/breakdown",
  "/v1/admin/activity",
  "/v1/admin/requests",
  "/v1/methods",
];
const UNCOMPRESSED_API = [
  "/v1/auth/session",
  "/v1/auth/otp/verify",
  "/v1/auth/refresh",
  "/v1/auth/bootstrap/exchange",
  "/auth/bootstrap/start",
  "/v1/connections/exchange",
  "/v1/connections/status",
  "/v1/config",
  "/v1/public/config",
  "/v1/admin/people",
  "/v1/admin/health",
  "/v1/admin/network",
  "/v1/admin/users",
  "/v1/admin/users/abc/devices",
  "/v1/admin/users/abc/requests/def",
  "/v1/me/history/export",
  "/v1/admin/summary/extra",
  "/v1/operator/auth/session",
  "/health/live",
];

test("only summary-type API answers are compressed, and they may take longer than the client's 90 s", () => {
  const api = servers().filter(({ block }) => block.children.some((c) => c.directives.includes("proxy_pass http://aift_api;")));
  assert.equal(api.length, 3, "registration, operator and tenant servers proxy the API");
  for (const { label, block } of api) {
    for (const path of UNCOMPRESSED_API) {
      const location = regexLocation(block, path);
      if (!location) continue;
      assert.ok(location.directives.includes("gzip off;"), `${label}: ${path} may be compressed`);
    }
    if (label.includes("AIFT_OPERATOR_HOST")) continue;
    for (const path of COMPRESSED_API) {
      const location = regexLocation(block, path);
      assert.ok(location, `${label}: ${path} is not proxied`);
      assert.ok(location.directives.includes("gzip on;"), `${label}: ${path} is not compressed`);
      assert.ok(location.directives.includes("proxy_pass http://aift_api;"), `${label}: ${path} is not proxied`);
      const read = location.directives.find((d) => d.startsWith("proxy_read_timeout "));
      assert.ok(read && Number.parseInt(read.split(" ")[1], 10) >= 95, `${label}: ${path} read timeout ${read}`);
      const send = location.directives.find((d) => d.startsWith("proxy_send_timeout "));
      assert.ok(send && Number.parseInt(send.split(" ")[1], 10) >= 95, `${label}: ${path} send timeout ${send}`);
    }
  }
  // Compression is never switched on for every location at once.
  const top = nginxBlocks(template).directives;
  assert.equal(top.includes("gzip on;"), false);
  assert.ok(top.some((d) => d.startsWith("gzip_types ") && d.includes("application/json")));
});

test("hashed assets are cached for a year, pages are revalidated and downloads briefly cached", () => {
  for (const { label, block } of servers()) {
    if (!block.children.length) continue;
    const assets = regexLocation(block, "/assets/index-CpZPdnKM.js") ?? block.children.find((c) => c.head === "location /assets/");
    assert.ok(assets, `${label}: no assets location`);
    assert.ok(assets.directives.includes('add_header Cache-Control "public, max-age=31536000, immutable";'), label);
    assert.ok(assets.directives.includes("gzip on;"), `${label}: assets not compressed`);
    const pages = block.children.filter((c) => c.directives.includes("try_files /index.html =404;"));
    assert.ok(pages.length > 0, `${label}: no page location`);
    for (const page of pages) {
      assert.ok(page.directives.includes('add_header Cache-Control "no-cache";'), `${label} ${page.head}`);
      assert.ok(page.directives.includes("gzip on;"), `${label} ${page.head} not compressed`);
    }
    if (label.includes("AIFT_OPERATOR_HOST")) continue;
    const downloads = regexLocation(block, "/downloads/ai-footprint-tracker-chrome.zip");
    assert.ok(downloads, `${label}: no downloads location`);
    assert.ok(downloads.directives.includes('add_header Cache-Control "public, max-age=300, must-revalidate";'), label);
  }
});

test("nginx keeps its connections to the API open between requests", () => {
  const root = nginxBlocks(template);
  const map = root.children.find((c) => c.head === "map $http_upgrade $connection_upgrade");
  // An ordinary request must send no Connection header; "close" ended every upstream connection.
  assert.ok(map.directives.includes('"" "";'), "ordinary requests send Connection: close");
  const upstream = root.children.find((c) => c.head === "upstream aift_api");
  assert.ok(upstream.directives.some((d) => d.startsWith("keepalive ")));
  for (const { label, block } of servers()) {
    for (const location of block.children.filter((c) => c.directives.includes("proxy_pass http://aift_api;"))) {
      assert.ok(location.directives.includes("proxy_http_version 1.1;"), `${label} ${location.head}`);
      const connection = location.directives.find((d) => d.startsWith("proxy_set_header Connection "));
      assert.ok(
        ['proxy_set_header Connection "";', "proxy_set_header Connection $connection_upgrade;"].includes(connection),
        `${label} ${location.head}: ${connection}`,
      );
    }
  }
});
