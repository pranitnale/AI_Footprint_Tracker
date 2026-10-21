(function(){
  'use strict';
  const screens=window.AFTScreens,engine=window.AFTReview,ids=screens.map(s=>s.id),byId=new Map(screens.map(s=>[s.id,s]));
  const $=id=>document.getElementById(id),key='aft-design-review-fern-v1';
  let review=engine.empty(),savedRaw=null,locked=false,selected='P01',nodeKey=null,mode='explore',view='board',zoom=.42,pan={x:35,y:35},drag=null,undo=[],redo=[],toastTimer,transferKind='json',pendingImport=null,pendingDelete=null;
  const nodeDefaults=new Map(),anchorSets=new Map(),openDetails=new Set(),previewSettings=new Map();
  const escape=x=>String(x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function warning(message){$('warning').textContent=message;$('warning').hidden=!message;document.body.classList.toggle('has-warning',!!message);}
  function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5500);}
  function load(){try{savedRaw=localStorage.getItem(key);if(savedRaw)review=engine.validate(JSON.parse(savedRaw),ids);$('save-state').textContent=savedRaw?'Review restored locally':'Ready · local only';}catch(error){locked=true;warning('We could not read the saved review. It has not been changed. Export any new work before importing a valid backup. '+error.message);$('save-state').textContent='Not saved. Check the warning';}}
  function persist(force=false){
    review.updatedAt=new Date().toISOString();review.revision++;
    if(locked&&!force){$('save-state').textContent='Not saved · export backup';return false;}
    try{
      if(!force&&localStorage.getItem(key)!==savedRaw){locked=true;warning('Another tab changed this review. Your edits are in memory only. Export them now; reload to see the other tab, or import your chosen backup to replace it.');$('save-state').textContent='Conflict · not saved';return false;}
      const next=JSON.stringify(review);localStorage.setItem(key,next);savedRaw=next;locked=false;warning('');$('save-state').textContent='Saved on this browser';return true;
    }catch(error){$('save-state').textContent='Not saved · export backup';warning('Browser storage failed. Your edits remain in this open tab only. Export review now. '+error.message);return false;}
  }
  function commit(fn){undo.push(JSON.stringify(review));if(undo.length>30)undo.shift();redo=[];fn();persist();render();}
  function transform(){ $('board').style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`;$('zoom').value=Math.round(zoom*100);$('zoom-label').value=Math.round(zoom*100)+'%'; }
  function visible(){const q=$('search').value.trim().toLowerCase(),group=$('group').value;return screens.filter(s=>(group==='all'||s.group===group)&&(!q||[s.id,s.name,s.state,s.role].join(' ').toLowerCase().includes(q)));}
  function layout(items){const positions=new Map();let x=0,y=0,rowHeight=0,col=0;for(const s of items){positions.set(s.id,review.positions[s.id]||{x,y});rowHeight=Math.max(rowHeight,s.height+40);col++;if(col===3){col=0;x=0;y+=rowHeight+100;rowHeight=0;}else x+=1320+85;}return positions;}
  function index(){let html='',previous='';for(const s of visible()){if(previous!==s.group){previous=s.group;html+=`<div class="screen-group-title">${escape(s.group)}</div>`;}const count=review.comments.filter(c=>c.screen===s.id&&!c.resolved).length;html+=`<button class="screen-link" data-screen="${s.id}" aria-current="${selected===s.id}"><i class="status-dot ${review.status[s.id]||'draft'}"></i><code>${s.id}</code><span>${escape(s.name)}${count?' · '+count+' note'+(count>1?'s':''):''}</span></button>`;}$('screen-list').innerHTML=html;$('screen-count').textContent=visible().length+'/'+screens.length;}
  function applyEdits(article,s){
    const leafTags='h1,h2,h3,h4,p,span,strong,b,small,label,button,td,th,li,output,input:not([type=checkbox])';let i=0;const anchors=new Set();
    article.querySelectorAll('.screen '+leafTags).forEach(el=>{
      if([...el.children].some(child=>child.tagName!=='BR')||(!el.textContent.trim()&&el.tagName!=='INPUT')||el.closest('svg'))return;
      const anchor=s.id+':n'+i++;el.dataset.node=anchor;anchors.add(anchor);
      if(!nodeDefaults.has(anchor))nodeDefaults.set(anchor,{text:el.tagName==='INPUT'?el.value:el.innerText});
      const change=review.edits[s.id]?.[anchor];if(change){if(Object.hasOwn(change,'text')){if(el.tagName==='INPUT')el.value=change.text;else{el.textContent=change.text;el.style.whiteSpace='pre-line';}}for(const[prop,value]of Object.entries(change.style||{}))el.style[prop]=prop==='fontSize'?value+'px':value;}
      el.classList.toggle('node-selected',s.id===selected&&anchor===nodeKey);
    });anchorSets.set(s.id,anchors);
  }
  function positionDetails(article){const screen=article.querySelector('.screen'),overlay=article.querySelector('.conversation-overlay'),composer=article.querySelector('.context-advisory:not([hidden])')||article.querySelector('.composer-field');if(!overlay||overlay.hidden||!composer)return;const bounds=screen.getBoundingClientRect(),scale=bounds.height/screen.offsetHeight;if(!scale)return;const composerTop=(composer.getBoundingClientRect().top-bounds.top)/scale;overlay.style.bottom=Math.max(100,screen.clientHeight-composerTop+12)+'px';overlay.style.maxHeight=Math.max(120,composerTop-32)+'px';}
  function draw(){
    const list=view==='focus'?[byId.get(selected)]:visible(),positions=layout(list);$('no-results').hidden=!!list.length;
    $('board').innerHTML=list.map(s=>{
      const p=view==='focus'?{x:0,y:0}:positions.get(s.id),count=review.comments.filter(c=>c.screen===s.id&&!c.resolved).length;
      return `<article class="artboard ${s.id===selected?'selected':''}" data-screen-id="${s.id}" style="left:${p.x}px;top:${p.y}px;width:${s.width}px"><header class="artboard-heading" data-drag-id="${s.id}"><div>${s.id} / ${escape(s.name)}<span>${s.width} × ${s.height} · ${review.status[s.id]||'draft'}</span></div><button data-focus="${s.id}">${count?'● '+count+' · ':''}Focus ↗</button></header><div class="frame-wrap"><div class="screen ${s.classes} ${review.density[s.id]||''}" data-editing="${mode==='edit'}" data-commenting="${mode==='comment'}" style="width:${s.width}px;height:${s.height}px">${s.html}</div></div></article>`;
    }).join('');
    for(const article of $('board').querySelectorAll('.artboard')){applyEdits(article,byId.get(article.dataset.screenId));const overlay=article.querySelector('.conversation-overlay'),trigger=article.querySelector('[data-details-open]');if(overlay){overlay.hidden=!openDetails.has(article.dataset.screenId);overlay.id='footprint-details-'+article.dataset.screenId;if(trigger){trigger.setAttribute('aria-controls',overlay.id);trigger.setAttribute('aria-expanded',String(!overlay.hidden));}}}
    // Assign new text IDs before moving the hint and context panel into place.
    // This keeps saved edits and comments attached to the same elements.
    for(const article of $('board').querySelectorAll('.artboard')){const hint=article.querySelector('.context-advisory'),context=article.querySelector('.context-window');if(hint)article.querySelector('.host-composer').insertBefore(hint,article.querySelector('.composer-field'));if(context)article.querySelector('.details-scroll').prepend(context);}
    for(const control of $('board').querySelectorAll('[data-preview-setting]')){const setting=control.dataset.previewSetting;if(previewSettings.has(setting))control.checked=previewSettings.get(setting);}
    transform();for(const article of $('board').querySelectorAll('.artboard'))positionDetails(article);
  }
  function inspector(){
    const s=byId.get(selected);$('inspector-name').textContent=s.name;$('inspector-meta').textContent=s.id+' · '+s.group;
    $('selection-caption').textContent=s.id+' / '+s.name+' · '+s.width+' × '+s.height;
    $('approval').value=review.status[selected]||'draft';$('density').value=review.density[selected]||'comfortable';
    $('spec').innerHTML=[['Role',s.role],['Surface / route',s.route],['State',s.state],['Design note',s.note]].map(([a,b])=>`<div class="spec-row"><strong>${a}</strong><span>${escape(b)}</span></div>`).join('');
    $('editor-panel').hidden=mode!=='edit';$('spec').hidden=mode!=='explore';
    const el=nodeKey?$('board').querySelector(`[data-node="${nodeKey}"]`):null;
    $('element-label').textContent=el?'Selected: '+nodeKey:'Click a text element on the screen.';
    $('apply-edit').disabled=!el;$('reset-element').disabled=!el;
    if(el){const css=getComputedStyle(el);$('edit-text').value=el.tagName==='INPUT'?el.value:el.innerText;$('edit-size').value=Math.round(parseFloat(css.fontSize));const m=css.color.match(/\d+/g);$('edit-color').value=m?'#'+m.slice(0,3).map(v=>Number(v).toString(16).padStart(2,'0')).join(''):'#203524';$('edit-weight').value=['400','500','600','700','800'].includes(css.fontWeight)?css.fontWeight:'400';$('edit-align').value=['left','center','right'].includes(css.textAlign)?css.textAlign:'left';}
    else $('edit-text').value='';
    const comments=review.comments.filter(c=>c.screen===selected);$('screen-comment-count').textContent=comments.length;$('comment-total').textContent=review.comments.filter(c=>!c.resolved).length;
    $('comment-anchor').textContent=nodeKey?'Feedback attached to '+nodeKey:'New comment on this screen';
    $('comments').innerHTML=comments.length?comments.map(c=>`<article class="comment-card ${c.resolved?'resolved':''}"><header><strong>${escape(c.author)}</strong><span>${c.resolved?'Resolved':'Open'}</span></header><small>${escape(c.node||'Screen-level')} · ${new Date(c.createdAt).toLocaleDateString()}</small><p>${escape(c.text)}</p><button data-resolve="${c.id}">${c.resolved?'Reopen':'Resolve'}</button><button data-delete="${c.id}">Delete</button></article>`).join(''):'<p style="margin-top:16px">No comments yet. Add a note for this screen or select a specific element.</p>';
    $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;
  }
  function render(){index();draw();inspector();}
  function select(id,focus=false){if(!byId.has(id))return;openDetails.clear();selected=id;nodeKey=null;if(focus)view='focus';$('board-view').setAttribute('aria-pressed',view==='board');$('focus-view').setAttribute('aria-pressed',view==='focus');render();if(focus)fit();else locate(id);}
  function locate(id){const el=$('board').querySelector(`[data-screen-id="${id}"]`);if(!el)return;pan.x=30-parseFloat(el.style.left)*zoom;pan.y=30-parseFloat(el.style.top)*zoom;transform();}
  function fit(){const s=byId.get(selected),vp=$('viewport').getBoundingClientRect();zoom=Math.max(.15,Math.min(1,(vp.width-60)/s.width,(vp.height-70)/(s.height+40)));if(view==='focus')pan={x:Math.max(20,(vp.width-s.width*zoom)/2),y:25};else locate(selected);transform();}
  function setZoom(value){const vp=$('viewport').getBoundingClientRect(),x=vp.width/2,y=vp.height/2,next=Math.max(.15,Math.min(1.3,value));pan={x:x-(x-pan.x)*next/zoom,y:y-(y-pan.y)*next/zoom};zoom=next;transform();}
  function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  load();
  [...new Set(screens.map(s=>s.group))].forEach(group=>{const o=document.createElement('option');o.value=group;o.textContent=group;$('group').append(o);});
  // Build all anchors before any import so element validation does not depend on current filter.
  render();
  function validateAnchors(candidate){for(const[id,edits]of Object.entries(candidate.edits))for(const anchor of Object.keys(edits))if(!anchorSets.get(id)?.has(anchor))throw new Error('This element does not exist in this design: '+anchor);for(const c of candidate.comments)if(c.node&&!anchorSets.get(c.screen)?.has(c.node))throw new Error('A comment points to an unknown element: '+c.node);}
  try{validateAnchors(review);}catch(error){locked=true;warning('Review anchors do not match this design version. Existing stored data are untouched. '+error.message);}
  const requestedScreen=new URLSearchParams(location.search).get('screen');
  if(byId.has(requestedScreen))select(requestedScreen,true);
  document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>{mode=btn.dataset.mode;nodeKey=null;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b===btn));$('mode-help').textContent=mode==='edit'?'Select text to edit it. Drag screen headers to move them.':mode==='comment'?'Select an element, then add a note in the inspector.':'Click a screen to inspect it. Drag empty canvas to pan.';render();}));
  $('screen-list').addEventListener('click',e=>{const el=e.target.closest('[data-screen]');if(el)select(el.dataset.screen,true);});
  $('search').addEventListener('input',()=>{view='board';$('board-view').setAttribute('aria-pressed','true');$('focus-view').setAttribute('aria-pressed','false');pan={x:25,y:25};render();});
  $('group').addEventListener('change',()=>{view='board';pan={x:25,y:25};nodeKey=null;const first=visible()[0];if(first)selected=first.id;$('board-view').setAttribute('aria-pressed','true');$('focus-view').setAttribute('aria-pressed','false');render();});
  $('board-view').addEventListener('click',()=>{view='board';$('board-view').setAttribute('aria-pressed','true');$('focus-view').setAttribute('aria-pressed','false');render();locate(selected);});
  $('focus-view').addEventListener('click',()=>select(selected,true));$('fit').addEventListener('click',fit);
  $('zoom').addEventListener('input',()=>setZoom(Number($('zoom').value)/100));$('zoom-in').addEventListener('click',()=>setZoom(zoom+.1));$('zoom-out').addEventListener('click',()=>setZoom(zoom-.1));
  $('board').addEventListener('click',e=>{
    if(drag?.moved)return;const focus=e.target.closest('[data-focus]');if(focus){select(focus.dataset.focus,true);return;}
    const article=e.target.closest('.artboard');if(!article)return;const id=article.dataset.screenId,leaf=e.target.closest('[data-node]');
    if(selected!==id){selected=id;nodeKey=null;index();document.querySelectorAll('.artboard').forEach(a=>a.classList.toggle('selected',a.dataset.screenId===id));}
    if(mode==='edit'||mode==='comment'){e.preventDefault();nodeKey=leaf?.dataset.node||null;document.querySelectorAll('.node-selected').forEach(el=>el.classList.remove('node-selected'));if(leaf)leaf.classList.add('node-selected');inspector();if(mode==='comment')$('comment-text').focus();return;}
    if(e.target.closest('[data-context-dismiss]')){article.querySelector('.context-advisory').hidden=true;article.querySelector('[data-details-open]').focus({preventScroll:true});positionDetails(article);return;}
    const trigger=e.target.closest('[data-details-open],[data-context-open]'),close=e.target.closest('[data-details-close]');
    if(trigger||close){e.preventDefault();const overlay=article.querySelector('.conversation-overlay'),source=article.querySelector('[data-details-open]');const opening=!!trigger&&overlay.hidden;overlay.hidden=!opening;source.setAttribute('aria-expanded',String(opening));if(opening){openDetails.add(id);positionDetails(article);overlay.querySelector('[data-details-close]').focus({preventScroll:true});}else{openDetails.delete(id);source.focus({preventScroll:true});}inspector();return;}
    const next=e.target.closest('[data-go]');if(next){e.preventDefault();select(next.dataset.go,true);return;}
    const sectionLink=e.target.closest('a[href^="#method-"]');
    if(sectionLink){e.preventDefault();const target=article.querySelector(sectionLink.getAttribute('href')),screen=article.querySelector('.screen');if(target){const scale=screen.getBoundingClientRect().width/screen.offsetWidth;screen.scrollTop+=(target.getBoundingClientRect().top-screen.getBoundingClientRect().top)/scale-18;target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}return;}
    if(e.target.closest('[data-demo]'))toast('This button is a preview only. Add a comment to describe how it should work.');
    inspector();
  });
  $('board').addEventListener('change',e=>{const control=e.target.closest('[data-preview-setting]');if(!control||mode!=='explore')return;previewSettings.set(control.dataset.previewSetting,control.checked);toast('Preview updated. Account settings are unchanged. This resets when you reload.');});
  $('board').addEventListener('submit',e=>e.preventDefault());
  document.addEventListener('pointerdown',e=>{if(mode!=='explore'||e.target.closest('.conversation-overlay,[data-details-open],.studio-top,.inspector,.canvas-toolbar'))return;for(const article of $('board').querySelectorAll('.artboard')){const overlay=article.querySelector('.conversation-overlay');if(overlay&&!overlay.hidden){overlay.hidden=true;article.querySelector('[data-details-open]').setAttribute('aria-expanded','false');openDetails.delete(article.dataset.screenId);}}});
  $('board').addEventListener('keydown',e=>{if(e.key!=='Escape')return;const article=e.target.closest('.artboard'),overlay=article?.querySelector('.conversation-overlay');if(overlay&&!overlay.hidden){e.preventDefault();e.stopPropagation();overlay.hidden=true;openDetails.delete(article.dataset.screenId);const source=article.querySelector('[data-details-open]');source.setAttribute('aria-expanded','false');source.focus({preventScroll:true});}});
  $('viewport').addEventListener('pointerdown',e=>{
    if(e.button!==0)return;const header=e.target.closest('[data-drag-id]');if(e.target.closest('button,input,select,textarea'))return;
    if(header&&view==='board'){const el=header.closest('.artboard');drag={kind:'card',id:header.dataset.dragId,el,startX:e.clientX,startY:e.clientY,x:parseFloat(el.style.left),y:parseFloat(el.style.top),moved:false};}
    else if(!e.target.closest('.artboard'))drag={kind:'pan',startX:e.clientX,startY:e.clientY,x:pan.x,y:pan.y,moved:false};
    else return;$('viewport').setPointerCapture(e.pointerId);
  });
  $('viewport').addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;if(Math.abs(dx)+Math.abs(dy)>5)drag.moved=true;if(drag.kind==='pan'){pan={x:drag.x+dx,y:drag.y+dy};transform();}else{drag.el.style.left=drag.x+dx/zoom+'px';drag.el.style.top=drag.y+dy/zoom+'px';}});
  function finishDrag(){if(!drag)return;const d=drag;drag=null;if(d.kind==='card'&&d.moved){selected=d.id;const pos={x:Math.round(parseFloat(d.el.style.left)),y:Math.round(parseFloat(d.el.style.top))};commit(()=>{review.positions[d.id]=pos;});}}
  $('viewport').addEventListener('pointerup',finishDrag);$('viewport').addEventListener('pointercancel',()=>{drag=null;draw();});
  $('viewport').addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();setZoom(zoom*(e.deltaY>0?.9:1.1));}else if(!e.target.closest('.screen')){e.preventDefault();pan.x-=e.deltaX;pan.y-=e.deltaY;transform();}},{passive:false});
  $('viewport').addEventListener('keydown',e=>{if(e.target!==$('viewport'))return;const moves={ArrowLeft:[70,0],ArrowRight:[-70,0],ArrowUp:[0,70],ArrowDown:[0,-70]};if(moves[e.key]){e.preventDefault();pan.x+=moves[e.key][0];pan.y+=moves[e.key][1];transform();}else if(e.key==='+'||e.key==='='){e.preventDefault();setZoom(zoom+.1);}else if(e.key==='-'){e.preventDefault();setZoom(zoom-.1);}});
  $('apply-edit').addEventListener('click',()=>{if(!nodeKey)return;const size=Number($('edit-size').value);if(!Number.isFinite(size)||size<10||size>96){toast('Text size must be between 10 and 96 pixels.');return;}const anchor=nodeKey,id=selected,change={text:$('edit-text').value,style:{fontSize:size,color:$('edit-color').value,fontWeight:$('edit-weight').value,textAlign:$('edit-align').value}};commit(()=>{review.edits[id]||={};review.edits[id][anchor]=change;review.status[id]='review';});toast(locked?'Edit applied in memory; export a backup.':'Edit applied. This screen is marked Needs changes.');});
  $('reset-element').addEventListener('click',()=>{if(!nodeKey)return;commit(()=>{if(review.edits[selected])delete review.edits[selected][nodeKey];review.status[selected]='review';});});
  $('density').addEventListener('change',()=>{const value=$('density').value;commit(()=>{review.density[selected]=value;review.status[selected]='review';});});
  $('approval').addEventListener('change',()=>{const value=$('approval').value;commit(()=>review.status[selected]=value);});
  $('add-comment').addEventListener('click',()=>{const text=$('comment-text').value.trim(),author=$('comment-author').value.trim()||'You';if(!text){toast('Write your feedback before adding a comment.');$('comment-text').focus();return;}const c={id:globalThis.crypto?.randomUUID?crypto.randomUUID():'note-'+Date.now()+'-'+Math.random().toString(36).slice(2),screen:selected,node:nodeKey,text,author,resolved:false,createdAt:new Date().toISOString()};commit(()=>{review.comments.push(c);if(review.status[selected]==='approved')review.status[selected]='review';});$('comment-text').value='';toast('Comment added to '+selected+'. Export review to share it.');});
  $('comments').addEventListener('click',e=>{const resolve=e.target.closest('[data-resolve]'),del=e.target.closest('[data-delete]');if(resolve)commit(()=>{const c=review.comments.find(c=>c.id===resolve.dataset.resolve);if(c)c.resolved=!c.resolved;});if(del){if(pendingDelete===del.dataset.delete){const id=pendingDelete;pendingDelete=null;commit(()=>review.comments=review.comments.filter(c=>c.id!==id));toast('Comment deleted. Undo restores it.');}else{pendingDelete=del.dataset.delete;del.textContent='Confirm delete';toast('Click Confirm delete to remove this comment. Undo can restore it.');}}});
  $('undo').addEventListener('click',()=>{if(!undo.length)return;redo.push(JSON.stringify(review));review=JSON.parse(undo.pop());persist();render();});
  $('redo').addEventListener('click',()=>{if(!redo.length)return;undo.push(JSON.stringify(review));review=JSON.parse(redo.pop());persist();render();});
  function openTransfer(kind){transferKind=kind;pendingImport=null;$('confirm-import').hidden=true;const importing=kind==='import';$('transfer-title').textContent=importing?'Import review':kind==='json'?'Export review':'Export handoff notes';$('transfer-description').textContent=importing?'Paste a Fern v1 review JSON or choose a file. Import replaces this browser’s current review after confirmation.':'Copy the text below or download it. If your browser does not download the file, the text remains available here.';$('transfer-text').readOnly=!importing;$('transfer-text').value=importing?'':kind==='json'?JSON.stringify(review,null,2):engine.notes(review,screens);$('transfer-primary').textContent=importing?'Validate import':'Copy to clipboard';$('transfer-download').hidden=importing;$('transfer-file').hidden=!importing;$('transfer-result').textContent='';$('transfer-dialog').showModal();}
  function importText(text){pendingImport=null;$('confirm-import').hidden=true;try{if(text.length>5*1024*1024)throw new Error('Review exceeds the 5 MB limit.');const incoming=engine.validate(JSON.parse(text),ids);validateAnchors(incoming);pendingImport=incoming;$('transfer-result').textContent='Valid backup: '+incoming.comments.length+' comments, '+Object.keys(incoming.edits).length+' edited screens. Replacing will overwrite the current review. Export current work first, or confirm below. Undo is available after import.';$('confirm-import').hidden=false;}catch(error){$('transfer-result').textContent='Import rejected: '+error.message;}}
  $('confirm-import').addEventListener('click',()=>{if(!pendingImport)return;undo.push(JSON.stringify(review));redo=[];review=pendingImport;pendingImport=null;$('confirm-import').hidden=true;const saved=persist(true);nodeKey=null;render();$('transfer-result').textContent=saved?'Review imported and saved on this browser.':'Review imported in memory only. Browser storage failed; keep a backup.';toast(saved?'Review imported and saved locally.':'Import is in memory only. Export a backup.');});
  $('transfer-text').addEventListener('input',()=>{pendingImport=null;$('confirm-import').hidden=true;});
  $('export-json').addEventListener('click',()=>openTransfer('json'));$('export-notes').addEventListener('click',()=>openTransfer('notes'));$('import-review').addEventListener('click',()=>openTransfer('import'));
  $('transfer-primary').addEventListener('click',async()=>{if(transferKind==='import'){importText($('transfer-text').value);return;}try{await navigator.clipboard.writeText($('transfer-text').value);$('transfer-result').textContent='Copied. Paste into a file or share it with your implementer.';}catch{$('transfer-text').focus();$('transfer-text').select();$('transfer-result').textContent='Automatic clipboard access is unavailable. The text is selected; copy it manually.';}});
  $('transfer-download').addEventListener('click',()=>{download(transferKind==='json'?'ai-footprint-tracker-review.json':'ai-footprint-tracker-handoff.md',$('transfer-text').value,transferKind==='json'?'application/json':'text/markdown');$('transfer-result').textContent='Download requested, not confirmed. If no file appears, copy the text above instead.';});
  $('transfer-file').addEventListener('click',()=>$('import-file').click());$('transfer-close').addEventListener('click',()=>$('transfer-dialog').close());
  $('import-file').addEventListener('change',async()=>{const file=$('import-file').files[0];if(!file)return;try{if(file.size>5*1024*1024)throw new Error('Review file exceeds the 5 MB limit.');const text=await file.text();$('transfer-text').value=text;importText(text);}catch(error){$('transfer-result').textContent='Import rejected: '+error.message;}finally{$('import-file').value='';}});
  $('help').addEventListener('click',()=>$('help-dialog').showModal());$('close-help').addEventListener('click',()=>$('help-dialog').close());
  window.addEventListener('storage',e=>{if(e.key===key&&e.newValue!==savedRaw){locked=true;warning('The review changed in another tab. Export this tab’s work before reloading or importing a backup.');$('save-state').textContent='Conflict · not saved';}});
  window.addEventListener('error',e=>{warning('The canvas encountered an error. Export your review before refreshing. '+e.message);});
  window.addEventListener('unhandledrejection',()=>warning('An operation failed. Export your review and check the last action before continuing.'));
  window.addEventListener('resize',()=>{if(view==='focus')fit();});
  window.AFTStudio={getReview:()=>JSON.parse(JSON.stringify(review)),screenCount:screens.length,select,validateAnchors};
})();
