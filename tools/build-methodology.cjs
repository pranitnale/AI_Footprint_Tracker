// Build the public reading page and canvas content from one authored article.
const fs = require('node:fs');
const path = require('node:path');
const { validateMethodologyNumerics, validatePublishedReferences } = require('./methodology-checks.cjs');
const root = path.resolve(__dirname, '..');
const articlePath = path.join(root, 'docs/methodology/content.html');
const catalogPath = path.join(root, 'registry/model-catalog-2026-09-09.json');
const screensPath = path.join(root, 'design-canvas/screens.js');
const outputPath = path.join(root, 'design-canvas/methodology.html');
const start = '  // BEGIN GENERATED METHODOLOGY';
const end = '  // END GENERATED METHODOLOGY';
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function sourceLink(source) {
  if (!source || !/^https:\/\//.test(source.url)) throw new Error('Catalog source requires a public HTTPS URL');
  return '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(source.id) + '</a>';
}

function renderCatalog(catalog) {
  if (catalog.schema_version !== '1.0.0' || !Array.isArray(catalog.entries) || !Array.isArray(catalog.sources)) throw new Error('Unsupported model catalog');
  const sources = new Map(catalog.sources.map(source => [source.id, source]));
  const rows = catalog.entries.map(entry => {
    if (!entry.source_ids?.length) throw new Error('Model entry lacks evidence: ' + entry.id);
    const references = entry.source_ids.map(id => sourceLink(sources.get(id))).join(' · ');
    return '<tr><td><span>' + escapeHtml(entry.site) + '</span></td><td><span>' + escapeHtml(entry.name) + '</span><small>' + escapeHtml(entry.kind + ' · ' + entry.surface.replaceAll('_', ' ')) + '</small></td><td><span>' + escapeHtml(entry.availability) + '</span></td><td>' + references + '</td></tr>';
  }).join('');
  const bibliography = catalog.sources.map(source => '<p class="methodology-source"><span>' + escapeHtml(source.id + ': ' + source.title + '. ' + (source.updated_or_published || 'No publication/update date supplied.') + ' Accessed ' + source.accessed_on + '.') + '</span> ' + sourceLink(source) + '</p>').join('');
  return '<div class="methodology-table" role="region" aria-label="Current model and mode inventory table" tabindex="0"><table><caption>Model and mode inventory checked ' + escapeHtml(catalog.verified_on) + '</caption><thead><tr><th scope="col">Tool</th><th scope="col">Model or mode</th><th scope="col">Availability and scope</th><th scope="col">Evidence</th></tr></thead><tbody>' + rows + '</tbody></table></div><details class="methodology-catalog-sources"><summary>Model-inventory source details</summary>' + bibliography + '</details>';
}

function validateArticle(html) {
  if (/<\/?(?:script|iframe|object|embed|form)\b/i.test(html) || /\son\w+\s*=|javascript:|data:\s*text\/html/i.test(html)) throw new Error('Active content is not allowed in the methodology article');
  if (html.includes(String.fromCharCode(0x2014))) throw new Error('Use plain punctuation in methodology copy');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate article anchor');
  for (const match of html.matchAll(/href="#([^"]+)"/g)) if (!ids.includes(match[1])) throw new Error('Missing article anchor: ' + match[1]);
  if (html.includes('<!-- MODEL-CATALOG -->')) throw new Error('Unresolved model catalog');
}

/** The public browser audit report, in the repository named once in config/source-repository.json. */
function browserAuditHref() {
  const repository = JSON.parse(fs.readFileSync(path.join(root, 'config/source-repository.json'), 'utf8'));
  return repository.url + '/blob/' + repository.branch + '/docs/implementation/LIVE-BROWSER-AUDIT-2026-09-09.md';
}

function buildArticle(options = {}) {
  // A Windows checkout with core.autocrlf gives the article CRLF endings, which would leak into
  // the generated JSON strings and change the review-anchor text of multi-line equations.
  let source = fs.readFileSync(articlePath, 'utf8').replace(/\r\n/g, '\n');
  if (options.browserAuditHref) {
    if (!/^https:\/\//.test(options.browserAuditHref)) throw new Error('Browser audit href must be a public HTTPS URL');
    source = source.replace('href="evidence/browser-audit.md"', 'href="' + escapeHtml(options.browserAuditHref) + '"');
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const article = source.replace('<!-- MODEL-CATALOG -->', renderCatalog(catalog));
  validateArticle(article);
  validateMethodologyNumerics(article,
    JSON.parse(fs.readFileSync(path.join(root, 'registry/text-reference-profiles-2026-09-09.json'), 'utf8')));
  validatePublishedReferences(article, JSON.parse(fs.readFileSync(path.join(root, 'registry/published-reference-evidence-2026-09-09.json'), 'utf8')));
  return { article, catalogEntries: catalog.entries.length };
}

function build(check = false) {
  const { article, catalogEntries } = buildArticle();
  const before = fs.readFileSync(screensPath, 'utf8');
  const from = before.indexOf(start), to = before.indexOf(end);
  if (from < 0 || to <= from || before.indexOf(start, from + 1) !== -1) throw new Error('Generated-content markers are missing or ambiguous');
  const generated = start + '\n  const methodologyDetails = ' + JSON.stringify(article) + ';\n' + end;
  const after = before.slice(0, from) + generated + before.slice(to + end.length);
  if (check && before !== after) throw new Error('Canvas methodology is stale. Run node tools/build-methodology.cjs');
  if (!check && before !== after) fs.writeFileSync(screensPath, after);
  delete require.cache[require.resolve(screensPath)];
  const screen = require(screensPath).find(item => item.id === 'P02');
  if (!screen) throw new Error('P02 methodology screen is missing');
  const readable = screen.html.replace(/<button type="button" class="([^"]*)" data-go="([A-Z][0-9]{2})">([^<]*)<\/button>/g,
    (_, cls, id, label) => '<a class="methodology-button ' + cls + '" href="./?screen=' + id + '">' + label + '</a>');
  const page = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'none\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Methodology | AI Footprint Tracker</title><link rel="stylesheet" href="screens.css"></head><body class="methodology-document"><div class="screen reading-page methodology-screen">' + readable + '</div><footer class="methodology-document-footer"><a href="./?screen=P02">Review this page in the design canvas</a><p>Calculation methodology. Resource figures are estimates, not meter readings.</p></footer></body></html>\n';
  if (check) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== page) throw new Error('Standalone methodology is stale. Run node tools/build-methodology.cjs');
  } else fs.writeFileSync(outputPath, page);
  const extensionPath = path.join(root, 'apps/extension/public/methodology-reference.html');
  const extensionArticle = buildArticle({ browserAuditHref: browserAuditHref() }).article;
  const extensionPage = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Technical reference | AI Footprint Tracker</title><style>html{color-scheme:light dark;scroll-padding-top:24px}body{font:16px/1.6 system-ui,sans-serif;max-width:1100px;margin:auto;padding:28px;color:light-dark(#203524,#e1eedb);background:light-dark(#f7f9f2,#18201a)}a{color:inherit;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:2px solid currentColor;outline-offset:4px}.methodology-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:36px}.methodology-toc ol{padding-left:20px}.methodology-toc li{margin:8px 0}section{margin-bottom:36px}h1,h2,h3{line-height:1.25}.methodology-table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #809181;padding:10px;text-align:left;vertical-align:top}small{display:block}.methodology-equation{white-space:pre-wrap;padding:16px;background:light-dark(#e1eedb,#283d2c);overflow-wrap:anywhere}p{overflow-wrap:anywhere}@media(max-width:760px){body{padding:20px}.methodology-layout{display:block}}</style></head><body><p><a href="methodology.html">Methodology</a></p><h1>Technical reference</h1><p>Resource figures are estimates, not meter readings. Message text is processed locally; only numeric records are retained.</p>' + extensionArticle + '</body></html>\n';
  if (check) {
    if (!fs.existsSync(extensionPath) || fs.readFileSync(extensionPath, 'utf8') !== extensionPage) throw new Error('Extension methodology is stale. Run node tools/build-methodology.cjs');
  } else {
    fs.mkdirSync(path.dirname(extensionPath), { recursive: true });
    fs.writeFileSync(extensionPath, extensionPage);
  }
  return { articleCharacters: article.length, catalogEntries };
}

if (require.main === module) {
  try { console.log(JSON.stringify(build(process.argv.includes('--check')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { build, buildArticle, browserAuditHref, renderCatalog, validateArticle };
