/* Astral Sync v1: classic script, MV3 service worker compatible. */
'use strict';
const AstralSync = (() => {
  const PREFIX = 'astral:v1:';
  const HEAD = PREFIX + 'head';
  const META = '__astralSync';
  const KEYS = ['config', 'sites', 'css'];
  const MAX_ITEM = 7900, MAX_TOTAL = 45000;
  const enc = new TextEncoder();
  const bytes = x => enc.encode(x).length;
  const clone = x => JSON.parse(JSON.stringify(x));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const serial = x => JSON.stringify(x);
  const id = () => crypto.randomUUID();
  let running = null;
  let suppress = false;
  let appliedSnapshot = null;
  let debounce = null;
  const local = chrome.storage.local, remote = chrome.storage.sync;
  const state = async () => (await local.get(META))[META] || { enabled:false, status:'off', base:null, pending:false, retry:0 };
  const save = async patch => { const s = await state(); await local.set({[META]: {...s,...patch}}); };
  const getData = async () => {
    const v = await local.get(KEYS);
    const sites = v.sites||[];
    if(sites.some(g=>!g._syncId || (g.list||[]).some(site=>!site._syncId))) {
      const migrated=AstralMerge.norm(sites);
      await local.set({sites:migrated});
      return {config:v.config||{},sites:migrated,css:v.css||{}};
    }
    return {config:v.config||{},sites,css:v.css||{}};
  };
  function filter(data) {
    const v = clone(data), omitted = [];
    v.sites = AstralMerge.norm(v.sites);
    if (typeof v.config.userImageSrc === 'string' && v.config.userImageSrc.startsWith('data:')) {
      delete v.config.userImageSrc; omitted.push('config.userImageSrc');
      // A local-only wallpaper should not be enabled on another device.
      v.config.userImage = false;
    }
    for (const group of v.sites) for (const site of (group.list||[])) {
      if (site.iconMode !== 'custom') {
        // Legacy data URLs have no user-intent marker; do not upload them.
        site.iconMode = 'auto'; site.icon = '';
      } else Object.assign(site, AstralIcons.normalize(site));
    }
    return {data:v, omitted};
  }
  // UTF-8 safe chunking; JSON string chunks, each item includes the JSON quoting overhead.
  function chunks(text, generation) {
    const out = {}; let buf = '', n = 0;
    for (const ch of text) {
      const key = PREFIX + generation + ':' + n;
      if (bytes(key) + bytes(JSON.stringify(buf + ch)) > MAX_ITEM) {
        if (!buf) throw Error('Single character exceeds quota');
        out[key] = buf; n++; buf = ch;
      } else buf += ch;
    }
    out[PREFIX + generation + ':' + n] = buf;
    if (Object.entries(out).reduce((sum,[k,v]) => sum + bytes(k) + bytes(JSON.stringify(v)),0) > MAX_TOTAL)
      throw Error('同步配置超过约 45 KB 的双版本安全容量预算；请减少自定义 CSS 或图标');
    return out;
  }
  async function readRemote() {
    const h = (await remote.get(HEAD))[HEAD];
    if (!h) return null;
    if (h.version !== 1 || !Number.isInteger(h.count) || h.count < 1 || h.count > 100) throw Error('不支持的云端配置版本');
    const keys = Array.from({length:h.count},(_,i) => PREFIX+h.generation+':'+i);
    const parts = await remote.get(keys);
    if (keys.some(k => typeof parts[k] !== 'string')) throw Error('云端分块不完整，请稍后重试');
    const text = keys.map(k => parts[k]).join('');
    const hash = await digest(text);
    if (hash !== h.hash) throw Error('云端数据校验失败');
    const value = JSON.parse(text);
    if (!value || !value.data || !value.revisions) throw Error('云端格式错误');
    return {head:h, ...value};
  }
  async function digest(text) {
    const b = await crypto.subtle.digest('SHA-256',enc.encode(text));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  // A generation is written before the head: readers never accept partial snapshots.
  async function writeRemote(payload, modifiedAt = Date.now()) {
    const generation = id(); const text = serial(payload); const parts = chunks(text,generation);
    const previous = (await remote.get(HEAD))[HEAD];
    const existing = await remote.get(null);
    const stale = Object.keys(existing).filter(k=>k.startsWith(PREFIX) && k!==HEAD && !k.startsWith(PREFIX+(previous?.generation||'')+':'));
    if(stale.length) await remote.remove(stale);
    const current = await remote.getBytesInUse(null);
    if (current + Object.entries(parts).reduce((n,[k,v])=>n+bytes(k)+bytes(serial(v)),0) > 102400)
      throw Error('云端容量不足，请清理旧同步数据后重试');
    await remote.set(parts);
    const head = {version:1,generation,count:Object.keys(parts).length,hash:await digest(text),updatedAt:Date.now(),modifiedAt};
    const observed = (await remote.get(HEAD))[HEAD];
    if ((observed?.generation||null) !== (previous?.generation||null))
      throw Error('云端在上传过程中已变化，请重新合并');
    await remote.set({[HEAD]:head});
    // Old chunks are removed only after the new head is committed.
    // Failure to clean is nonfatal; next publish can retry cleanup.
    try {
      const headNow=(await remote.get(HEAD))[HEAD];
      if(headNow?.generation !== generation) return head;
      const all=await remote.get(null);
      const obsolete=Object.keys(all).filter(k=>k.startsWith(PREFIX) && k!==HEAD && !k.startsWith(PREFIX+generation+':'));
      if(obsolete.length) await remote.remove(obsolete);
    } catch(e) { console.warn('Astral sync cleanup:',e); }
    return head;
  }
  const merge = (base,ours,theirs,baseDeletes={},ourDeletes={},theirDeletes={}) =>
    AstralMerge.merge(base,ours,theirs,baseDeletes,ourDeletes,theirDeletes);
  // Keep unsynced local-only wallpaper and large icons if their sites still match.
  function restoreLocalOnly(merged, original) {
    if (original.config?.userImageSrc?.startsWith('data:')) {
      merged.config.userImageSrc=original.config.userImageSrc;
      merged.config.userImage=original.config.userImage;
    }
    const icons=new Map();
    for(const group of original.sites||[]) for(const site of group.list||[]) {
      if (typeof site.icon !== 'string' || !site.icon) continue;
      if (site._syncId) icons.set('id:'+site._syncId,site.icon);
      icons.set('url:'+site.url,site.icon);
    }
    for(const group of merged.sites||[]) for(const site of group.list||[]) {
      const icon=icons.get('id:'+site._syncId) || icons.get('url:'+site.url);
      if(icon && AstralIcons.mode(site)==='custom' && !site.icon) site.icon=icon;
    }
    return merged;
  }
  async function apply(data) {
    suppress=true;
    appliedSnapshot = clone(data);
    try { await local.set(data); } finally { suppress=false; }
  }
  // Whole-configuration last-write-wins. A sync/restore never counts as a user edit.
  // A backup is created before applying remote changes; empty lists cannot erase populated lists.
  async function reconcile() {
    const s=await state(); if(!s.enabled) return;
    await save({status:'syncing'});
    try {
      const incoming=await readRemote();
      const original=await getData(), ours=filter(original).data;
      const localTime=Number(s.localModifiedAt)||0;
      const localHasSites=(ours.sites||[]).some(g=>(g.list||[]).length);
      if(!incoming) {
        if(!localHasSites) { await save({status:'synced',pending:false}); return; }
        const modifiedAt=localTime||Date.now();
        const head=await writeRemote({data:ours,deleted:{},revisions:{device:s.deviceId||id()},createdAt:Date.now()},modifiedAt);
        await save({status:'synced',base:ours,deleted:{},lastHead:head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,localModifiedAt:modifiedAt});
        return;
      }
      if (!incoming.data || !Array.isArray(incoming.data.sites) || !incoming.data.config || !incoming.data.css)
        throw Error('云端配置格式无效');
      const remoteHasSites=incoming.data.sites.some(g=>(g.list||[]).length);
      const remoteTime=Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0;
      const localDirty=localTime > (Number(s.lastSyncedModifiedAt)||0) && !equal(ours,s.base);
      // Never treat a previously empty device as a newer edit.
      if (!localHasSites && remoteHasSites) {
        await local.set({__astralSyncRecoveryBackup:{createdAt:Date.now(),data:original}});
        await apply(restoreLocalOnly(clone(incoming.data),original));
        await save({status:'synced',base:incoming.data,deleted:incoming.deleted||{},lastHead:incoming.head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,lastSyncedModifiedAt:remoteTime,localModifiedAt:remoteTime});
        return;
      }
      if (localHasSites && !remoteHasSites) {
        // Empty cloud snapshots are never allowed to erase populated local data.
        if (!localDirty) throw Error('云端网站列表为空；已保留本机配置，请手动上传以修复云端');
      }
      if (equal(ours,incoming.data)) {
        await save({status:'synced',base:ours,deleted:incoming.deleted||{},lastHead:incoming.head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,lastSyncedModifiedAt:Math.max(localTime,remoteTime),localModifiedAt:Math.max(localTime,remoteTime)});
        return;
      }
      // Newer actual edit wins. Legacy snapshots use publication time as fallback.
      if (localHasSites && localDirty && localTime > remoteTime) {
        const headNow=(await remote.get(HEAD))[HEAD];
        if(headNow?.generation!==incoming.head.generation) { await save({status:'pending',pending:true}); return; }
        const head=await writeRemote({data:ours,deleted:{},revisions:{device:s.deviceId||id()},createdAt:Date.now()},localTime);
        await save({status:'synced',base:ours,deleted:{},lastHead:head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,lastSyncedModifiedAt:localTime});
      } else {
        await local.set({__astralSyncRecoveryBackup:{createdAt:Date.now(),data:original}});
        await apply(restoreLocalOnly(clone(incoming.data),original));
        await save({status:'synced',base:incoming.data,deleted:incoming.deleted||{},lastHead:incoming.head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,lastSyncedModifiedAt:remoteTime,localModifiedAt:remoteTime});
      }
    } catch(e) {
      const next=Math.min((s.retry||0)+1,8);
      await save({status:'error',error:String(e.message||e),pending:true,retry:next,nextRetry:Date.now()+Math.min(3600000,30000*2**(next-1))});
      throw e;
    }
  }
  function run() {
    if(running) return running;
    running=reconcile().finally(()=>{running=null;});
    return running;
  }
  async function enable(choice) {
    const s=await state();
    const deviceId=s.deviceId||id();
    const incoming=await readRemote();
    const original=await getData(), ours=filter(original).data;
    // Never silently replace a populated local configuration with cloud data.
    if (incoming && !choice) {
      if ((ours.sites || []).some(g => (g.list || []).length)) {
        await save({enabled:false,status:'needs-choice',remoteHead:incoming.head.generation});
        return 'needs-choice';
      }
      choice = 'remote';
    }
    await save({enabled:true,userDisabled:false,deviceId,status:'pending',retry:0});
    if(incoming && choice==='remote') {
      if (!incoming.data || !incoming.data.config || !Array.isArray(incoming.data.sites) || !incoming.data.css || typeof incoming.data.config !== 'object' || typeof incoming.data.css !== 'object') throw Error('云端配置格式无效，已保留本机配置');
      await local.set({__astralSyncRecoveryBackup: {createdAt:Date.now(),data:original}});
      await apply(restoreLocalOnly(clone(incoming.data),original));
      await save({base:incoming.data,deleted:incoming.deleted||{},lastHead:incoming.head.generation,status:'synced',pending:false,lastSuccess:Date.now(),lastSyncedModifiedAt:Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0,localModifiedAt:Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0});
    } else if(incoming && choice==='local') {
      // Explicit overwrite is user-authorized; baseline is remote and local edits win.
      await save({base:incoming.data});
      await forceUpload();
    } else { await run(); }
    return 'enabled';
  }
  async function forceUpload() {
    const s=await state(); if(!s.enabled) throw Error('同步尚未启用');
    const ours=filter(await getData()).data;
    if (!(ours.sites || []).some(g => (g.list || []).length)) throw Error('本机网站列表为空，为避免覆盖云端配置，已阻止上传');
    const modifiedAt=Date.now();
    const head=await writeRemote({data:ours,deleted:s.deleted||{},revisions:{device:s.deviceId},createdAt:Date.now()},modifiedAt);
    await save({base:ours,deleted:s.deleted||{},lastHead:head.generation,status:'synced',pending:false,lastSuccess:Date.now(),error:null,conflicts:[],localModifiedAt:modifiedAt,lastSyncedModifiedAt:modifiedAt});
  }
  async function forceDownload() {
    const incoming=await readRemote(); if(!incoming) throw Error('云端没有配置');
    if (!incoming.data || typeof incoming.data.config !== 'object' || !Array.isArray(incoming.data.sites) || typeof incoming.data.css !== 'object' || incoming.data.config === null || incoming.data.css === null) throw Error('云端配置格式无效，未覆盖本机');
    const original=await getData();
    // Persist a pre-restore backup, including unsynced local-only assets.
    await local.set({__astralSyncRecoveryBackup: {createdAt:Date.now(),data:original}});
    await apply(restoreLocalOnly(clone(incoming.data),original));
    await save({enabled:true,base:incoming.data,deleted:incoming.deleted||{},lastHead:incoming.head.generation,status:'synced',pending:false,lastSuccess:Date.now(),error:null,conflicts:[],localModifiedAt:Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0,lastSyncedModifiedAt:Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0});
  }
  async function disable() { await save({enabled:false,userDisabled:true,status:'off',pending:false}); }
  async function bootstrap() {
    const s = await state();
    if (s.userDisabled || s.enabled) return;
    // No implicit cloud restore or upload. The user must explicitly enable sync.
    return;
  }
  async function schedule() {
    if(suppress) return;
    if (appliedSnapshot) {
      const actual = await local.get(KEYS);
      if (KEYS.every(k => equal(actual[k], appliedSnapshot[k]))) {
        appliedSnapshot = null;
        return;
      }
      appliedSnapshot = null;
    }
    const s=await state(); if(!s.enabled) return;
    await save({pending:true,status:'pending',localModifiedAt:Math.max(Date.now(),(Number(s.localModifiedAt)||0)+1)});
    clearTimeout(debounce);
    debounce=setTimeout(()=>run().catch(console.warn),1200);
  }
  function listen() {
    chrome.storage.onChanged.addListener((changes,area) => {
      if(area==='local' && KEYS.some(k=>k in changes)) schedule().catch(console.warn);
      if(area==='sync' && HEAD in changes) run().catch(console.warn);
    });
    chrome.alarms?.onAlarm.addListener(a=>{if(a.name==='astral-sync') tick().catch(console.warn);});
  }
  async function tick() {
    const s=await state();
    if(s.enabled && (s.pending || s.status==='error') && (!s.nextRetry || Date.now()>=s.nextRetry)) await run();
  }
  return {state,enable,disable,bootstrap,run,tick,listen,forceUpload,forceDownload,readRemote,filter,merge};
})();
