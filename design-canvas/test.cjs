const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const screens=require('./screens.js'),engine=require('./review-state.js'),ids=screens.map(s=>s.id);

function reviewLeafText(html) {
  const nodes = [...html.matchAll(/<(h[1-4]|p|span|strong|b|small|label|button|td|th|li|output)\b[^>]*>((?:[^<]|<br\s*\/?>)*)<\/\1>|<input\b([^>]*)>/gi)];
  return nodes.filter(match => match[1] ? match[2].trim() : !/type\s*=\s*["']?checkbox/i.test(match[3]))
    .map(match => (match[2] || match[3]).replace(/<br\s*\/?>/gi, '\n'));
}

test('methodology appends detail after the existing Fern v1 review anchors', () => {
  const screen = screens.find(screen => screen.id === 'P02');
  const parts = screen.html.split('<!-- METHODOLOGY DETAIL -->');
  assert.equal(parts.length, 2);
  const original = reviewLeafText(parts[0]);
  assert.equal(original.length, 27);
  assert.deepEqual(original.slice(-2), ['Explore measurement details', 'Read privacy policy']);
  assert.ok(parts[1].includes('id="method-energy"'));
  assert.ok(parts[1].includes('id="method-media"'));
  // 16 since 4 October 2026: the reply parts, media and shared chats section follows the
  // earlier-request section, after every existing review anchor. 17 since 17 October 2026:
  // the attribution and data sources section comes last, after those anchors too.
  assert.equal((parts[1].match(/<section id="method-/g) || []).length, 17);
  assert.ok(reviewLeafText(parts[1]).length > 200);
});

test('generated methodology, canonical source and catalog stay synchronized', () => {
  const { build, validateArticle } = require('../tools/build-methodology.cjs');
  assert.equal(build(true).catalogEntries, 67);
  const html = fs.readFileSync(path.join(__dirname, 'methodology.html'), 'utf8');
  assert.ok(!html.includes('undefined'));
  assert.ok(!html.includes('<!-- MODEL-CATALOG -->'));
  assert.ok(!/<script\b/i.test(html));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes('./?screen=P02'));
  assert.throws(() => validateArticle('<a href="#missing">Missing</a>'), /anchor/);
  assert.throws(() => validateArticle('<p id="x"></p><p id="x"></p>'), /Duplicate/);
  assert.throws(() => validateArticle('<p onclick="alert(1)">Bad</p>'), /Active/);
});

test('fallback and image details preserve proxy identity and the image estimate source', () => {
  const text = screens.find(screen => screen.id === 'C13').html;
  assert.ok(text.includes('Highest comparable estimate'));
  assert.ok(text.includes('Not identified'));
  assert.ok(text.includes('4 eligible text references'));
  const image = screens.find(screen => screen.id === 'C14').html;
  for (const phrase of ['Published average, added to totals', '2.907 Wh', 'Luccioni, Jernite and Strubell', 'added to the usage totals', 'Image-model output tokens']) assert.ok(image.includes(phrase), phrase);
  // The ML.ENERGY figures were removed on 20 October 2026; the specimen must not show them.
  for (const removed of ['208 public benchmark', 'B200', '7.24 Wh']) assert.ok(!image.includes(removed), removed);
});

test('reviewed confirmation ticks share a centered layout without changing other states', () => {
  for (const id of ['G05', 'N04']) assert.match(screens.find(screen => screen.id === id).html, /class="success-circle success-circle-centered">✓<\/div>/);
  assert.ok(!screens.find(screen => screen.id === 'G04').html.includes('success-circle-centered'));
  const css = fs.readFileSync(path.join(__dirname, 'screens.css'), 'utf8');
  assert.match(css, /\.success-circle\.success-circle-centered\{margin-inline:auto\}/);
});

test('access-denied recovery actions have separate full-width rows', () => {
  const screen = screens.find(screen => screen.id === 'L06');
  assert.match(screen.html, /<div class="actions auth-actions"><button[^>]+data-go="L01"[^>]*>Try another work email<\/button><button[^>]+data-go="E01"[^>]*>Use the extension locally<\/button><\/div>/);
  const css = fs.readFileSync(path.join(__dirname, 'screens.css'), 'utf8');
  assert.match(css, /\.actions\.auth-actions\{display:grid;align-items:stretch;gap:12px;margin-top:22px\}/);
  assert.match(css, /\.auth-form \.auth-actions \.primary\.wide\{margin-top:0\}/);
});

test('privacy edits retain email delivery and identifiable-usage disclosures', () => {
  const screen = screens.find(screen => screen.id === 'P03');
  assert.ok(screen.html.includes('counting on your computer'));
  assert.ok(screen.html.includes('verify your sign-in and connect your browsers'));
  for (const disclosure of ['Brevo sends your sign-in code', 'Your company can link usage to your email', 'connection IP addresses', 'These records are not anonymous']) assert.ok(screen.html.includes(disclosure));
});

test('September review edits keep the Fern v1 comment anchors', () => {
  for (const [id, count] of Object.entries({P03:23, G05:16, L06:11, N04:23})) assert.equal(reviewLeafText(screens.find(screen => screen.id === id).html).length, count, id);
  const privacy = reviewLeafText(screens.find(screen => screen.id === 'P03').html);
  // Fern v1 also counts the artboard label and Focus button before screen text.
  assert.ok(privacy[12 - 2].includes('counting on your computer'));
  assert.ok(privacy[16 - 2].includes('Your verified work email'));
  assert.equal(reviewLeafText(screens.find(screen => screen.id === 'L06').html)[12 - 2], 'Use the extension locally');
});

test('preview settings use named keyboard-operable controls, not decorative toggles',()=>{for(const id of ['E06','A08']){const s=screens.find(s=>s.id===id);assert.match(s.html,/<input type="checkbox" class="preview-switch" role="switch" aria-label="[^"]+" data-preview-setting="[^"]+" checked>/);assert.ok(!s.html.includes('class="toggle"'));}assert.ok(!screens.find(s=>s.id==='P08').html.includes('☰'));});
test('supporting text colors meet contrast target on their light surfaces',()=>{const css=fs.readFileSync(path.join(__dirname,'screens.css'),'utf8');const luminance=hex=>hex.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);for(const [fg,bg] of [['5c6958','e1eedb'],['6c655d','f3f0e9'],['5e6979','f0f4f9'],['5b7072','f2f5f4']]){assert.ok(css.includes('--muted:#'+fg));assert.ok((luminance(bg)+.05)/(luminance(fg)+.05)>=4.5,fg);}});
test('authored design copy has no em dashes and unknown values remain explicit',()=>{for(const s of screens)assert.ok(!JSON.stringify(s).includes(String.fromCharCode(0x2014)),s.id);for(const file of ['index.html','studio.js','review-state.js'])assert.ok(!fs.readFileSync(path.join(__dirname,file),'utf8').includes(String.fromCharCode(0x2014)),file);const missing=screens.find(s=>s.id==='S06');assert.ok(missing.html.includes('Unknown'));assert.ok(missing.html.includes('Unavailable, not zero'));});
test('copy style does not rewrite reviewer content',()=>{const r=engine.empty(),text='Keep my wording '+String.fromCharCode(0x2014)+' exactly';r.comments.push({id:'original-copy',screen:'P01',node:null,text,author:'Reviewer',createdAt:new Date().toISOString(),resolved:false});assert.equal(engine.validate(r,ids).comments[0].text,text);});
test('50% advisory keeps uncertainty inside Details with an accessible progress bar',()=>{const s=screens.find(s=>s.id==='C11');assert.match(s.name,/50%/);const hint=s.html.match(/<aside class="context-advisory"[\s\S]*?<\/aside>/)[0];assert.ok(hint.includes('data-context-open'));assert.ok(hint.includes('data-context-dismiss'));assert.ok(!hint.includes('unverified'));assert.match(s.html,/role="progressbar"[^>]+aria-valuenow="62"/);assert.ok(s.html.includes('We have not verified the app’s actual limit'));assert.ok(s.html.includes('not Claude’s verified capacity'));assert.ok(s.html.indexOf('class="context-advisory"')>s.html.indexOf('class="conversation-overlay"'));});
test('screen inventory, dimensions and unique IDs',()=>{assert.ok(screens.length>=70);assert.equal(new Set(ids).size,screens.length);for(const s of screens){assert.match(s.id,/^[A-Z][0-9]{2}$/);assert.ok(s.width>=390);assert.ok(s.height>=580);assert.ok(s.html.length>200);assert.ok(s.note);}});
test('every prototype navigation target exists',()=>{for(const s of screens)for(const m of s.html.matchAll(/data-go="([^"]+)"/g))assert.ok(ids.includes(m[1]),s.id+' targets missing '+m[1]);});
test('eight provider/theme variants have no in-chat product logo',()=>{for(const id of ['C01','C02','C03','C04','C05','C06','C07','C08']){const s=screens.find(s=>s.id===id);assert.ok(s);assert.ok(s.html.includes('footprint-bar'));assert.ok(!s.html.includes('class="logo"'));assert.ok(s.note.includes('Illustrative'));}});
test('extension surfaces do not contain admin links',()=>{for(const s of screens.filter(s=>s.group==='Extension'))assert.ok(!/data-go="[AO][0-9]/.test(s.html),s.id);});
test('host Details opens a hidden nonmodal overlay, not a new screen',()=>{for(const s of screens.filter(s=>s.html.includes('host-layout'))){assert.match(s.html,/data-details-open aria-expanded="false"/);assert.match(s.html,/class="conversation-overlay"[^>]+aria-modal="false" hidden/);assert.ok(s.html.includes('data-details-close'));assert.ok(!s.html.includes('data-go="C09"'));assert.ok(s.html.includes('Direct cooling water'));assert.ok(s.html.includes('Electricity-supply water'));}const partial=screens.find(s=>s.id==='C10');assert.ok(partial.html.includes('Resource estimates unavailable'));});
test('review serialization round trip',()=>{const r=engine.empty();r.edits.P01={'P01:n3':{text:'Edited headline',style:{fontSize:44,color:'#3D7542',fontWeight:'600',textAlign:'left'}}};r.comments.push({id:'test-1',screen:'P01',node:'P01:n3',text:'Make this clearer',author:'Reviewer',createdAt:new Date().toISOString(),resolved:false});r.status.P01='review';r.density.P01='compact';r.positions.P01={x:100,y:-20};assert.deepEqual(engine.validate(JSON.parse(JSON.stringify(r)),ids),r);});
test('reject incompatible imports and invalid identifiers',()=>{assert.throws(()=>engine.validate({},ids));const r=engine.empty();r.baseVersion='unknown';assert.throws(()=>engine.validate(r,ids));r.baseVersion=engine.BASE;r.status.Z99='approved';assert.throws(()=>engine.validate(r,ids));});
test('reject script-shaped styles and prototype pollution',()=>{const r=engine.empty();r.edits.P01={'P01:n0':{text:'text',style:{backgroundImage:'url(https://invalid.example)'}}};assert.throws(()=>engine.validate(r,ids));const bad=JSON.parse(JSON.stringify(engine.empty()).replace('"edits":{}','"edits":{"__proto__":{"polluted":true}}'));assert.throws(()=>engine.validate(bad,ids));assert.equal({}.polluted,undefined);});
test('imported text remains plain data and limited',()=>{const r=engine.empty();r.edits.P01={'P01:n0':{text:'<script>alert(1)</script>'}};assert.equal(engine.validate(r,ids).edits.P01['P01:n0'].text,'<script>alert(1)</script>');r.edits.P01['P01:n0'].text='x'.repeat(4001);assert.throws(()=>engine.validate(r,ids));});
test('reject duplicate comments, wrong anchors and bad style ranges',()=>{const r=engine.empty();const c={id:'same',screen:'P01',node:null,text:'a',author:'b',createdAt:new Date().toISOString(),resolved:false};r.comments=[c,{...c}];assert.throws(()=>engine.validate(r,ids));r.comments=[];r.edits.P01={'A01:n0':{text:'bad anchor'}};assert.throws(()=>engine.validate(r,ids));r.edits.P01={'P01:n0':{style:{fontSize:999}}};assert.throws(()=>engine.validate(r,ids));});
test('handoff export includes every screen and comments',()=>{const r=engine.empty();r.comments.push({id:'comment',screen:'A02',node:null,text:'Review roles',author:'You',createdAt:new Date().toISOString(),resolved:true});const md=engine.notes(r,screens);for(const id of ids)assert.ok(md.includes('## '+id+' ·'));assert.ok(md.includes('[x] You'));assert.ok(md.includes('Review roles'));});
test('locked Fern values and no network integrations',()=>{const css=fs.readFileSync(path.join(__dirname,'screens.css'),'utf8');for(const hex of ['#3d7542','#203524','#e1eedb','#f7f9f2'])assert.ok(css.includes(hex));for(const name of ['screens.js','studio.js','review-state.js']){const source=fs.readFileSync(path.join(__dirname,name),'utf8');assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(source));}assert.ok(fs.readFileSync(path.join(__dirname,'index.html'),'utf8').includes("connect-src 'none'"));});
test('all local HTML asset references exist',()=>{const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g))assert.ok(fs.existsSync(path.join(__dirname,match[1])),match[1]);});

test('earlier-request methodology preserves all 623 existing article review anchors', () => {
  const originalLeaves = reviewLeafText(screens.find(screen => screen.id === 'P02').html).slice(0, 623);
  const waterIndex = originalLeaves.findIndex(text => text.startsWith('EcoLogits mode reports its Water Consumption Footprint (WCF) range as estimated water consumption. Like electricity and carbon, the figure shown is one end of that range, chosen by the Range display setting: the midpoint, (minimum + maximum) / 2, by default, or the minimum or maximum scenario when selected. Totals add the same end of every record\'s range. It does not separately recalculate cooling and electricity-supply water. The following component rules apply to the Original calculation: total water is reported only when both required components are available under compatible definitions.'));
  assert.ok(waterIndex >= 0, 'The water amendment retains its existing review leaf');
  originalLeaves[waterIndex] = originalLeaves[waterIndex].replace('EcoLogits mode reports its Water Consumption Footprint (WCF) range as estimated water consumption. Like electricity and carbon, the figure shown is one end of that range, chosen by the Range display setting: the midpoint, (minimum + maximum) / 2, by default, or the minimum or maximum scenario when selected. Totals add the same end of every record\'s range. It does not separately recalculate cooling and electricity-supply water. The following component rules apply to the Original calculation: total water is reported only when both required components are available under compatible definitions.', 'Total water is reported only when both required components are available under compatible definitions.');
  // Normalize only the reviewed catalog notice edits to retain the historical anchor check.
  const referenceIndex = originalLeaves.findIndex(text => text.startsWith('The transparent starting reference is the operational component of EcoLogits 0.11.1,'));
  assert.ok(referenceIndex >= 0);
  assert.ok(originalLeaves[referenceIndex].includes('EcoLogits 0.11.2, commit c739e8d61f6a12a85864adb698ab85623fe70f3c'));
  originalLeaves[referenceIndex] = 'The transparent starting reference is the operational component of EcoLogits 0.11.1, published on 7 July 2026 and pinned to commit 886d1ebfadb51a2d6407fcea6d9778c997c85c35. Its code separates GPU energy, model-memory allocation, non-GPU host energy and facility overhead. The equations below reproduce that reference’s functional form; they do not claim that a closed provider uses the assumed hardware or deployment settings.';
  const catalogIndex = originalLeaves.indexOf('[3] EcoLogits contributors. Model registry at release 0.11.2, commit c739e8d61f6a12a85864adb698ab85623fe70f3c.');
  assert.ok(catalogIndex >= 0);
  originalLeaves[catalogIndex] = '[3] EcoLogits contributors. Model registry at the pinned release.';
  // 4 October 2026: the audit leaf now dates the audit and points to the later usage reports.
  const auditIndex = originalLeaves.findIndex(text => text.startsWith('The browser audit of 9 September 2026 found'));
  assert.ok(auditIndex >= 0);
  originalLeaves[auditIndex] = 'The browser audit found observable prompts and answer representations on all four supported websites, but no verified complete numerical input/output usage report in the inspected samples. Claude quota percentages, ChatGPT stop-token identifiers, Perplexity first-token booleans and undocumented Gemini positional values are not substitutes for a verified token-usage field. Exposed reasoning summaries also do not reveal the number of hidden reasoning tokens.';
  // 20 October 2026: the bundled ML.ENERGY image figures were removed because their source has no
  // licence. The image-cohort heading, its three figure paragraphs and sources [26] to [28] were
  // rewritten in place, so every anchor keeps its position. The figures are not repeated here:
  // those seven leaves become one marker, and the pinned hash covers every other original leaf
  // unchanged (it was computed the same way from the article before the revision).
  for (const prefix of ['Comparison with the ML.ENERGY Leaderboard', 'The ML.ENERGY Leaderboard by Chung and colleagues', 'Its figures are GPU energy within', 'The tracker applies no such allocation', '[26] ML.ENERGY. ML.ENERGY Leaderboard.', '[27] Chung, J.-W.', '[28] ML.ENERGY. Leaderboard source repository.']) {
    const index = originalLeaves.findIndex(text => text.startsWith(prefix));
    assert.ok(index >= 0, prefix);
    originalLeaves[index] = 'Image reference leaf revised on 20 October 2026';
  }
  const hash = require('node:crypto').createHash('sha256').update(JSON.stringify(originalLeaves)).digest('hex');
  assert.equal(hash, '06e21cc2d060b869705a55f234420cce571202209d74821f893cb87c3a5f3108');
});
