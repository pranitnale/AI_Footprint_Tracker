(function(root){
  'use strict';
  const BASE='fern-v1';
  function empty(){return {schema:'aft-design-review',version:1,baseVersion:BASE,revision:0,updatedAt:null,edits:{},comments:[],status:{},density:{},positions:{}};}
  const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  function validate(input,ids){
    const known=new Set(ids),out=empty();
    const fail=msg=>{throw new Error(msg);};
    const screen=id=>{if(!known.has(id))fail('Unknown screen: '+id);};
    const short=(value,max,name)=>{if(typeof value!=='string'||value.length>max)fail('Invalid '+name);return value;};
    const dict=(v,name)=>{if(!obj(v))fail('Invalid '+name);return Object.entries(v);};
    if(!obj(input)||input.schema!==out.schema||input.version!==1||input.baseVersion!==BASE)fail('This is not a compatible Fern v1 review file.');
    for(const key of Object.keys(input))if(!Object.hasOwn(out,key))fail('Unknown review field: '+key);
    if(!Number.isSafeInteger(input.revision)||input.revision<0)fail('Invalid revision');
    out.revision=input.revision;
    if(input.updatedAt!==null&&(typeof input.updatedAt!=='string'||!Number.isFinite(Date.parse(input.updatedAt))))fail('Invalid update date');
    out.updatedAt=input.updatedAt;
    let count=0;
    for(const [id,entries] of dict(input.edits,'edits')){screen(id);out.edits[id]={};for(const [key,item] of dict(entries,'element edits')){
      if(!new RegExp('^'+id+':n[0-9]{1,5}$').test(key))fail('Invalid element anchor');
      if(++count>20000||!obj(item))fail('Too many or malformed edits');
      for(const p of Object.keys(item))if(!['text','style'].includes(p))fail('Unknown edit field');
      const clean={};if(Object.hasOwn(item,'text'))clean.text=short(item.text,4000,'edited text');
      if(Object.hasOwn(item,'style')){clean.style={};for(const [prop,value]of dict(item.style,'style')){
        if(prop==='fontSize'){if(typeof value!=='number'||value<10||value>96)fail('Font size must be 10–96');}
        else if(prop==='color'){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))fail('Invalid color');}
        else if(prop==='fontWeight'){if(!['400','500','600','700','800'].includes(String(value)))fail('Invalid font weight');}
        else if(prop==='textAlign'){if(!['left','center','right'].includes(value))fail('Invalid alignment');}
        else fail('Unsupported style field');
        clean.style[prop]=value;
      }}out.edits[id][key]=clean;
    }}
    if(!Array.isArray(input.comments)||input.comments.length>2000)fail('Invalid comments');
    const commentIds=new Set();
    out.comments=input.comments.map(c=>{
      if(!obj(c))fail('Invalid comment');screen(c.screen);
      short(c.id,100,'comment ID');if(!/^[a-z0-9-]+$/i.test(c.id)||commentIds.has(c.id))fail('Duplicate or invalid comment ID');commentIds.add(c.id);
      if(c.node!==null&&(typeof c.node!=='string'||!new RegExp('^'+c.screen+':n[0-9]{1,5}$').test(c.node)))fail('Invalid comment anchor');
      if(typeof c.resolved!=='boolean'||typeof c.createdAt!=='string'||!Number.isFinite(Date.parse(c.createdAt)))fail('Invalid comment status/date');
      return {id:c.id,screen:c.screen,node:c.node,text:short(c.text,4000,'comment text'),author:short(c.author,80,'reviewer name'),resolved:c.resolved,createdAt:c.createdAt};
    });
    for(const[id,value]of dict(input.status,'status')){screen(id);if(!['draft','review','approved'].includes(value))fail('Invalid approval status');out.status[id]=value;}
    for(const[id,value]of dict(input.density,'density')){screen(id);if(!['comfortable','compact','spacious'].includes(value))fail('Invalid density');out.density[id]=value;}
    for(const[id,value]of dict(input.positions,'positions')){screen(id);if(!obj(value)||!Number.isFinite(value.x)||!Number.isFinite(value.y)||Math.abs(value.x)>100000||Math.abs(value.y)>100000)fail('Invalid screen position');out.positions[id]={x:value.x,y:value.y};}
    return out;
  }
  function notes(review,screens){
    const lines=['# AI Footprint Tracker: design review','',`Design version: ${BASE}`,`Exported: ${new Date().toISOString()}`,'','This preview uses sample data. Design approval does not mean the live app has been tested.',''];
    for(const s of screens){
      lines.push(`## ${s.id} · ${s.name}`,'',`Group: ${s.group} | Role: ${s.role} | State: ${s.state}`,`Surface: ${s.route}`,`Review: ${review.status[s.id]||'draft'}`,`Size: ${s.width} × ${s.height}`,`Notes: ${s.note}`,'');
      if(review.density[s.id])lines.push('Layout density: '+review.density[s.id],'');
      for(const [key,edit]of Object.entries(review.edits[s.id]||{}))lines.push(`Element ${key}`,Object.hasOwn(edit,'text')?'Text: '+JSON.stringify(edit.text):'',edit.style?'Style: '+JSON.stringify(edit.style):'','');
      for(const c of review.comments.filter(c=>c.screen===s.id))lines.push(`- [${c.resolved?'x':' '}] ${c.author} · ${c.node||'Screen'} · ${c.createdAt}`, '  '+c.text.replace(/\n/g,'\n  '),'');
    }
    return lines.join('\n');
  }
  root.AFTReview={empty,validate,notes,BASE};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.AFTReview;
})(typeof window==='undefined'?globalThis:window);
