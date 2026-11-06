/* Manifest V3 background service worker */
importScripts('js/site-icons.js', 'js/merge-core.js', 'js/sync.js');
AstralSync.listen();
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('astral-sync', {periodInMinutes:1});
  AstralSync.bootstrap().then(()=>AstralSync.tick()).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('astral-sync', {periodInMinutes:1});
  AstralSync.bootstrap().then(()=>AstralSync.tick()).catch(() => {});
});
// Restore alarm if worker starts after an extension update or alarm loss.
chrome.alarms.get('astral-sync').then(a=>{
  if(!a) return chrome.alarms.create('astral-sync',{periodInMinutes:1});
}).catch(() => {});
AstralSync.bootstrap().then(()=>AstralSync.tick()).catch(() => {});

// New tabs can request an initial cloud-to-local reconciliation before rendering.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ASTRAL_SYNC_READY') return;
  (async () => {
    await AstralSync.bootstrap();
    const s = await AstralSync.state();
    if (s.enabled && s.status !== 'conflict') await AstralSync.run();
    const result = await AstralSync.state();
    sendResponse({ok:true,status:result.status,error:result.error||null});
  })().catch(e => sendResponse({ok:false,error:String(e?.message||e)}));
  return true;
});
