/* Pure Astral merge functions. Browser global + CommonJS for Node tests. */
'use strict';
const AstralMerge = (() => {
  const copy = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const uid = () => crypto.randomUUID();
  const norm = (groups, makeId=uid) => (groups||[]).map(g=>({
    ...g, _syncId:g._syncId||makeId(), list:(g.list||[]).map(s=>({...s,_syncId:s._syncId||makeId()}))
  }));
  const flatten = groups => {
    const map = new Map();
    for(const [gi,g] of (groups||[]).entries()) {
      map.set('g:'+g._syncId,{id:g._syncId,kind:'group',name:g.name,order:gi});
      for(const [si,s] of (g.list||[]).entries())
        map.set('s:'+s._syncId,{id:s._syncId,kind:'site',group:g._syncId,title:s.title,url:s.url,icon:s.icon,iconMode:s.iconMode,order:si});
    }
    return map;
  };
  // Every deleted ID remains in tombstones, including removed descendants.
  const tombstones = (base,current,old={}) => {
    const a=flatten(base), b=flatten(current), out={...old};
    for(const key of a.keys()) if(!b.has(key)) out[key]=out[key]||Date.now();
    for(const key of b.keys()) delete out[key];
    return out;
  };
  function mergeObject(base={},ours={},theirs={},path='') {
    const out={}, conflicts=[];
    for(const k of new Set([...Object.keys(base),...Object.keys(ours),...Object.keys(theirs)])) {
      const ac=!eq(ours[k],base[k]),bc=!eq(theirs[k],base[k]);
      if(ac&&bc&&!eq(ours[k],theirs[k])) { conflicts.push(path+k); if(Object.hasOwn(ours,k))out[k]=copy(ours[k]); }
      else { const src=bc?theirs:ours; if(Object.hasOwn(src,k))out[k]=copy(src[k]); }
    }
    return {value:out,conflicts};
  }
  function mergeSites(base=[],ours=[],theirs=[],baseDeletes={},ourDeletes={},theirDeletes={}) {
    const b=flatten(base), a=flatten(ours), r=flatten(theirs);
    const keys=new Set([...b.keys(),...a.keys(),...r.keys(),...Object.keys(baseDeletes),...Object.keys(ourDeletes),...Object.keys(theirDeletes)]);
    const result=new Map(), conflicts=[], deleted={...baseDeletes,...ourDeletes,...theirDeletes};
    for(const key of keys) {
      const old=b.get(key), left=a.get(key), right=r.get(key);
      const leftGone=!left || !!ourDeletes[key], rightGone=!right || !!theirDeletes[key];
      if(old && (leftGone||rightGone)) {
        if(leftGone && right && !eq(right,old)) conflicts.push(key+':delete-edit');
        else if(rightGone && left && !eq(left,old)) conflicts.push(key+':edit-delete');
        else deleted[key]=deleted[key]||Date.now();
        continue;
      }
      if(!old && (leftGone||rightGone)) {
        const live=left||right;
        if(live && !deleted[key]) result.set(key,copy(live));
        continue;
      }
      const m=mergeObject(old||{},left||{},right||{},key+'.');
      conflicts.push(...m.conflicts);
      result.set(key,m.value);
      delete deleted[key];
    }
    const groups=[...result.entries()].filter(([k,v])=>v.kind==='group').map(([k,v])=>v);
    const sites=[...result.entries()].filter(([k,v])=>v.kind==='site').map(([k,v])=>v);
    for(const s of sites) if(!groups.some(g=>g.id===s.group)) conflicts.push('s:'+s.id+':missing-group');
    // A single-sided reorder is merged; incompatible concurrent reorders conflict via `order`.
    groups.sort((x,y)=>x.order-y.order||x.id.localeCompare(y.id));
    const output=groups.map(g=>({name:g.name,_syncId:g.id,list:sites.filter(s=>s.group===g.id)
      .sort((x,y)=>x.order-y.order||x.id.localeCompare(y.id))
      .map(s=>({title:s.title,url:s.url,icon:s.icon,iconMode:s.iconMode,_syncId:s.id}))}));
    return {sites:output,deleted,conflicts};
  }
  function merge(base,ours,theirs,baseDeletes={},ourDeletes={},theirDeletes={}) {
    const config=mergeObject(base.config,ours.config,theirs.config,'config.');
    const css=mergeObject(base.css,ours.css,theirs.css,'css.');
    const sites=mergeSites(base.sites,ours.sites,theirs.sites,baseDeletes,ourDeletes,theirDeletes);
    return {data:{config:config.value,css:css.value,sites:sites.sites},deleted:sites.deleted,
      conflicts:[...config.conflicts,...css.conflicts,...sites.conflicts]};
  }
  return {norm,flatten,tombstones,mergeSites,merge,mergeObject};
})();
if(typeof module!=='undefined') module.exports=AstralMerge;
