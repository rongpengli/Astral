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
  let enabling = null;
  let bootstrapping = null;
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
  // Reject a stale snapshot immediately before applying it to local storage.
  async function assertCurrentHead(incoming) {
    const head = (await remote.get(HEAD))[HEAD];
    if (!head || head.generation !== incoming.head.generation || head.hash !== incoming.head.hash)
      throw Error('云端快照在恢复过程中已变化，请重试');
  }
  async function digest(text) {
    const b = await crypto.subtle.digest('SHA-256',enc.encode(text));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  // Reclaim only orphaned generations. The published head is always protected.
  // Chrome Sync does not provide transactions; verify the head before each removal.
  async function pruneStaleGenerations(expectedHead, protectedGeneration = null) {
    const all = await remote.get(null);
    const currentHead = all[HEAD];
    if ((currentHead?.generation || null) !== (expectedHead?.generation || null) ||
        (currentHead?.hash || null) !== (expectedHead?.hash || null))
      throw Error('云端快照已变化，取消历史分块回收');
    const protectedIds = new Set([currentHead?.generation, protectedGeneration].filter(Boolean));
    const stale = Object.keys(all).filter(key => {
      if (!key.startsWith(PREFIX) || key === HEAD) return false;
      const match = /^astral:v1:([^:]+):(\d+)$/.exec(key);
      return match && !protectedIds.has(match[1]);
    });
    // A single remove call minimizes the race window; do not touch head or live chunks.
    if (stale.length) {
      const again = (await remote.get(HEAD))[HEAD];
      if ((again?.generation || null) !== (expectedHead?.generation || null) ||
          (again?.hash || null) !== (expectedHead?.hash || null))
        throw Error('云端快照已变化，取消历史分块回收');
      await remote.remove(stale);
    }
  }
  // Write chunks first, then publish the head. Never delete the currently published
  // generation to make room: a valid previous snapshot must survive failed uploads.
  async function writeRemote(payload, modifiedAt = Date.now()) {
    if (!(await state()).enabled) throw Error('当前设备同步已关闭');
    const generation = id(), text = serial(payload), parts = chunks(text, generation);
    const previous = (await remote.get(HEAD))[HEAD];
    // Old generations otherwise accumulate forever and exhaust the 100 KB quota.
    // Only the published generation (and this upload) must remain protected.
    await pruneStaleGenerations(previous, generation);
    const quota = remote.QUOTA_BYTES || 102400;
    const current = await remote.getBytesInUse(null);
    const additional = Object.entries(parts).reduce((n,[k,v]) => n + bytes(k) + bytes(serial(v)),0);
    if (current + additional > quota)
      throw Error('云端空间不足：当前有效快照与新快照无法同时容纳；已保留原配置');
    await remote.set(parts);
    const head = {version:1,generation,count:Object.keys(parts).length,hash:await digest(text),updatedAt:Date.now(),modifiedAt};
    const observed = (await remote.get(HEAD))[HEAD];
    if ((observed?.generation||null) !== (previous?.generation||null) ||
        (observed?.hash||null) !== (previous?.hash||null))
      throw Error('云端在上传过程中已变化，请重新合并');
    if (!(await state()).enabled) throw Error('当前设备同步已关闭');
    await remote.set({[HEAD]:head});
    // Best-effort post-commit cleanup. Never fail a successful upload due to GC.
    try { await pruneStaleGenerations(head); } catch (_) { /* retry on next upload */ }
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
    // A cloud stop signal must not allow an in-flight download to write local config.
    if (!(await state()).enabled) {
      throw Error('同步已关闭，已取消云端配置写入');
    }
    suppress=true;
    appliedSnapshot = clone(data);
    try { await local.set(data); } finally { suppress=false; }
  }
  // Whole-configuration last-write-wins. A sync/restore never counts as a user edit.
  // A backup is created before applying remote changes; empty lists cannot erase populated lists.
  async function reconcile() {
    const s=await state(); if(!s.enabled) return;
    if (s.importUploadPending) {
      await forceUpload();
      return;
    }
    await save({status:'syncing'});
    try {
      const incoming=await readRemote();
      const original=await getData(), ours=filter(original).data;
      const localTime=Number(s.localModifiedAt)||0;
      const localHasSites=(ours.sites||[]).some(g=>(g.list||[]).length);
      const explicitEmptyEdit=!localHasSites && !!s.base && !equal(ours,s.base) && Number(s.localModifiedAt)>0;
      if(!incoming) {
        if(!localHasSites && !explicitEmptyEdit) {
          // A fresh install has neither local data nor a cloud snapshot yet.
          // Chrome Sync may still be initializing; never call this 'synced'.
          await save({status:'waiting-cloud',pending:false,error:null,nextRetry:null});
          return;
        }
        const modifiedAt=localTime||Date.now();
        const head=await writeRemote({data:ours,deleted:{},revisions:{device:s.deviceId||id()},createdAt:Date.now()},modifiedAt);
        await save({status:'synced',base:ours,deleted:{},lastHead:head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,localModifiedAt:modifiedAt});
        return;
      }
      if (!incoming.data || !Array.isArray(incoming.data.sites) || !incoming.data.config || !incoming.data.css)
        throw Error('云端配置格式无效');
      const remoteHasSites=incoming.data.sites.some(g=>(g.list||[]).length);
      const remoteTime=Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0;
      const localDirty=!!s.base && !equal(ours,s.base); // The baseline, not wall-clock time alone, establishes an unsynced local edit.
      // Never treat a previously empty device as a newer edit.
      if (!localHasSites && remoteHasSites && !(explicitEmptyEdit && localTime > remoteTime)) {
        await local.set({__astralSyncRecoveryBackup:{createdAt:Date.now(),data:original}});
        await assertCurrentHead(incoming);
        await apply(restoreLocalOnly(clone(incoming.data),original));
        await save({status:'synced',base:incoming.data,deleted:incoming.deleted||{},lastHead:incoming.head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,lastSyncedModifiedAt:remoteTime,localModifiedAt:remoteTime});
        return;
      }
      if (localHasSites && !remoteHasSites && !(s.base && localDirty && remoteTime > localTime)) {
        // Empty cloud snapshots are never allowed to erase populated local data.
        // A nonempty local collection always takes precedence over an empty cloud collection.
        // Publish it automatically, without waiting for a confirmation dialog.
        const modifiedAt=Math.max(localTime,remoteTime+1,Date.now());
        const head=await writeRemote({data:ours,deleted:s.deleted||{},revisions:{device:s.deviceId||id()},createdAt:Date.now()},modifiedAt);
        await save({status:'synced',base:ours,deleted:s.deleted||{},lastHead:head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,localModifiedAt:modifiedAt,lastSyncedModifiedAt:modifiedAt});
        return;
      }
      if (equal(ours,incoming.data)) {
        await save({status:'synced',base:ours,deleted:incoming.deleted||{},lastHead:incoming.head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,lastSyncedModifiedAt:Math.max(localTime,remoteTime),localModifiedAt:Math.max(localTime,remoteTime)});
        return;
      }
      // Newer actual edit wins. Legacy snapshots use publication time as fallback.
      if (localDirty && localTime > remoteTime) {
        const headNow=(await remote.get(HEAD))[HEAD];
        if(headNow?.generation!==incoming.head.generation) { await save({status:'pending',pending:true}); return; }
        const head=await writeRemote({data:ours,deleted:{},revisions:{device:s.deviceId||id()},createdAt:Date.now()},localTime);
        await save({status:'synced',base:ours,deleted:{},lastHead:head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,lastSyncedModifiedAt:localTime});
      } else {
        await local.set({__astralSyncRecoveryBackup:{createdAt:Date.now(),data:original}});
        await assertCurrentHead(incoming);
        await apply(restoreLocalOnly(clone(incoming.data),original));
        await save({status:'synced',base:incoming.data,deleted:incoming.deleted||{},lastHead:incoming.head.generation,pending:false,retry:0,lastSuccess:Date.now(),error:null,lastSyncedModifiedAt:remoteTime,localModifiedAt:remoteTime});
      }
    } catch(e) {
      const next=Math.min((s.retry||0)+1,8);
      await save({status:'error',error:String(e.message||e),pending:true,retry:next,nextRetry:Date.now()+Math.min(3600000,30000*2**(next-1))});
      throw e;
    }
  }
  function runCore() {
    if (running) return running;
    const task = reconcile();
    running = task.finally(() => { running = null; });
    return running;
  }
  async function run() {
    // External callers must not reconcile while enableOnce is restoring.
    if (enabling) await enabling;
    return runCore();
  }
  async function enable(choice) {
    // Serialize automatic initialization: onInstalled, worker startup and new-tab
    // requests can otherwise race and publish/restore different snapshots.
    if (enabling) return enabling;
    enabling = enableOnce(choice).finally(() => { enabling = null; });
    return enabling;
  }
  async function enableOnce(choice) {
    const s=await state();
    const deviceId=s.deviceId||id();
    const incoming=await readRemote();
    const original=await getData(), ours=filter(original).data;
    const localHasSites=(ours.sites||[]).some(g=>(g.list||[]).length);
    if (incoming) {
      if (!incoming.data || !incoming.data.config || !Array.isArray(incoming.data.sites) || !incoming.data.css ||
          typeof incoming.data.config !== 'object' || typeof incoming.data.css !== 'object')
        throw Error('云端配置格式无效，已保留本机配置');
      const remoteHasSites=incoming.data.sites.some(g=>(g.list||[]).length);
      if (!choice) {
        if (!localHasSites && remoteHasSites) choice='remote';
        else if (equal(ours,incoming.data)) choice='same';
        else if (localHasSites && !remoteHasSites) choice='reconcile';
        else if (localHasSites && remoteHasSites) {
          // Typical single-editor workflow: choose the newest *known* local edit,
          // otherwise accept the published cloud snapshot. Always back up before restore.
          // Unknown local provenance is not evidence that it is newer.
          const remoteTime=Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0;
          const localDirty=!!s.base && !equal(ours,s.base);
          choice=localDirty && Number(s.localModifiedAt)>remoteTime ? 'reconcile' : 'remote';
        } else choice='same';
      }
    }
    await save({enabled:true,userDisabled:false,deviceId,status:'pending',retry:0,error:null});
    if(incoming && choice==='remote') {
      await local.set({__astralSyncRecoveryBackup: {createdAt:Date.now(),data:original}});
      await assertCurrentHead(incoming);
      await apply(restoreLocalOnly(clone(incoming.data),original));
      const t=Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0;
      await save({base:incoming.data,deleted:incoming.deleted||{},lastHead:incoming.head.generation,
        status:'synced',pending:false,retry:0,error:null,lastSuccess:Date.now(),lastSyncedModifiedAt:t,localModifiedAt:t});
    } else if(incoming && choice==='local') {
      if (!localHasSites) throw Error('本机网站列表为空，已阻止覆盖云端');
      await forceUpload();
    } else if(incoming && choice==='same') {
      const t=Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0;
      await save({base:ours,deleted:incoming.deleted||{},lastHead:incoming.head.generation,
        status:'synced',pending:false,retry:0,error:null,lastSuccess:Date.now(),lastSyncedModifiedAt:t,localModifiedAt:t});
    } else { await runCore(); }
    return 'enabled';
  }
  // Import is a deliberate local edit: publish it immediately when sync is on.
  // While importing, pause automatic reconciliation so an old cloud snapshot
  // cannot replace the newly imported configuration before its upload.
  async function importConfig(data, originalIcons) {
    const active = [enabling, running].filter(Boolean);
    if (active.length) await Promise.allSettled(active);
    clearTimeout(debounce); debounce = null;
    const before = await local.get([...KEYS, META]);
    const prior = before[META] || await state();
    const wasEnabled = !!prior.enabled && !prior.userDisabled;
    await save({enabled:false, pending:false});
    try {
      await local.set({
        __astralImportBackup:{createdAt:Date.now(),data:{config:before.config,sites:before.sites,css:before.css}},
        __astralLegacyIconBackup:{createdAt:Date.now(),icons:originalIcons},
        ...data
      });
      const actual = await local.get(KEYS);
      if (!KEYS.every(k => equal(actual[k], data[k]))) throw Error('本机配置写入后校验失败');
      if (!wasEnabled) {
        await save({enabled:false,userDisabled:!!prior.userDisabled,status:'off',pending:false,
          base:null,error:null,localModifiedAt:Date.now(),lastSyncedModifiedAt:0});
        return {uploaded:false};
      }
      await save({enabled:true,userDisabled:false,status:'pending',pending:true,importUploadPending:true,
        localModifiedAt:Date.now(),error:null});
      try {
        await forceUpload();
        return {uploaded:true};
      } catch (e) {
        // Keep the imported data locally and retry publishing; do not run
        // reconciliation against the old cloud snapshot while upload failed.
        await save({enabled:true,userDisabled:false,status:'error',pending:true,importUploadPending:true,
          nextRetry:Date.now()+30000,error:'导入已保存到本机，但上传云端失败：'+String(e?.message||e)});
        return {uploaded:false,uploadError:String(e?.message||e)};
      }
    } catch (e) {
      await save({enabled:false,userDisabled:!!prior.userDisabled,status:'error',error:String(e?.message||e)});
      throw e;
    }
  }
  async function forceUpload() {
    const s=await state(); if(!s.enabled) throw Error('同步尚未启用');
    const ours=filter(await getData()).data;
    if (!(ours.sites || []).some(g => (g.list || []).length) && !s.importUploadPending && !s.base) throw Error('本机网站列表为空，未确认是用户主动清空，已阻止上传');
    const modifiedAt=Date.now();
    const head=await writeRemote({data:ours,deleted:s.deleted||{},revisions:{device:s.deviceId},createdAt:Date.now()},modifiedAt);
    await save({base:ours,deleted:s.deleted||{},lastHead:head.generation,status:'synced',pending:false,importUploadPending:false,lastSuccess:Date.now(),error:null,conflicts:[],localModifiedAt:modifiedAt,lastSyncedModifiedAt:modifiedAt});
  }
  async function forceDownload() {
    const incoming=await readRemote(); if(!incoming) throw Error('云端没有配置');
    if (!incoming.data || typeof incoming.data.config !== 'object' || !Array.isArray(incoming.data.sites) || typeof incoming.data.css !== 'object' || incoming.data.config === null || incoming.data.css === null) throw Error('云端配置格式无效，未覆盖本机');
    const original=await getData();
    // Persist a pre-restore backup, including unsynced local-only assets.
    await local.set({__astralSyncRecoveryBackup: {createdAt:Date.now(),data:original}});
    await assertCurrentHead(incoming);
    await apply(restoreLocalOnly(clone(incoming.data),original));
    await save({enabled:true,base:incoming.data,deleted:incoming.deleted||{},lastHead:incoming.head.generation,status:'synced',pending:false,lastSuccess:Date.now(),error:null,conflicts:[],localModifiedAt:Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0,lastSyncedModifiedAt:Number(incoming.head.modifiedAt)||Number(incoming.head.updatedAt)||0});
  }
  async function disable() {
    // Local-only switch: never delete or mutate the cloud snapshot.
    clearTimeout(debounce); debounce = null;
    await save({enabled:false,userDisabled:true,status:'off',pending:false,
      importUploadPending:false,nextRetry:null,error:null});
    const active=[enabling,running].filter(Boolean);
    if(active.length) await Promise.allSettled(active);
  }
  function bootstrap() {
    if (bootstrapping) return bootstrapping;
    const task = (async () => {
      const s = await state();
      if (s.userDisabled) return;
      if (enabling) { await enabling; return; }
      if (s.enabled) await runCore();
      else await enable();
    })();
    bootstrapping = task.finally(() => { bootstrapping = null; });
    return bootstrapping;
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
    debounce=setTimeout(()=>run().catch(() => {}),1200);
  }
  function listen() {
    chrome.storage.onChanged.addListener((changes,area) => {
      if(area==='local' && KEYS.some(k=>k in changes)) schedule().catch(() => {});
      if(area==='sync' && HEAD in changes) state().then(s=>s.enabled ? run() : undefined).catch(() => {});
    });
    chrome.alarms?.onAlarm.addListener(a=>{if(a.name==='astral-sync') tick().catch(() => {});});
  }
  async function tick() {
    const s=await state();
    if(s.enabled && (!s.nextRetry || Date.now()>=s.nextRetry)) await run();
  }
  return {state,enable,disable,bootstrap,run,tick,listen,forceUpload,forceDownload,importConfig,readRemote,filter,merge};
})();
