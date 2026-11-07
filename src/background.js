/* Manifest V3 background service worker */
importScripts('js/compat.js','js/site-icons.js', 'js/site-ids.js', 'js/sync.js');
AstralSync.listen();
let initialization=null,initialized=false;
function initialize(){
 if(!initialization)initialization=(async()=>{
  try{if(!await chrome.alarms.get('astral-sync'))await chrome.alarms.create('astral-sync',{periodInMinutes:1})}catch{}
  await AstralSync.bootstrap();
 })().catch(()=>{}).finally(()=>{initialized=true});
 return initialization;
}
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);
initialize();

// New tabs can request an initial cloud-to-local reconciliation before rendering.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ASTRAL_SYNC_READY') return;
  (async () => {
    const needsRefresh=initialized;await initialize();
    if(needsRefresh)await AstralSync.bootstrap();
    const result = await AstralSync.state();
    sendResponse({ok:true,status:result.status,error:result.error||null});
  })().catch(e => sendResponse({ok:false,error:String(e?.message||e)}));
  return true;
});

// Serialize wallpaper downloads across tabs and remember only successful requests.
let wallpaperDownload=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.type!=='ASTRAL_WALLPAPER_SHOWN')return;
 wallpaperDownload=wallpaperDownload.catch(()=>{}).then(async()=>{
  if(!/^https:\/\/www\.bing\.com\/th\?id=OHR\.[A-Za-z0-9_-]+_(UHD|1920x1080|1366x768)\.jpg$/.test(message.url))return;
  const data=await chrome.storage.local.get(['config','__astralDownloadedWallpaper']);
  const extras=AstralCompat.config(data.config||{}).extensionFeatures;
  if(!extras.autoDownload||data.__astralDownloadedWallpaper===message.url)return;
  const name=typeof message.name==='string'&&message.name.length<=180&&!/[\\/\x00-\x1f:*?"<>|]/.test(message.name)&&message.name.endsWith('.jpg')?message.name:'bing.jpg';
  await chrome.downloads.download({url:message.url,filename:AstralCompat.downloadFilename(extras.downloadDir,name),conflictAction:'overwrite',saveAs:false});
  await chrome.storage.local.set({__astralDownloadedWallpaper:message.url});
 });
 wallpaperDownload.then(()=>sendResponse({ok:true}),e=>sendResponse({ok:false,error:String(e.message||e)}));return true;
});

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.type!=='ASTRAL_IMPORT_CONFIG')return;
 AstralSync.command('import',message.data).then(result=>sendResponse({ok:true,...result}),e=>sendResponse({ok:false,error:String(e.message||e)}));return true;
});

// The worker exclusively owns sync mutations; option pages only issue commands.
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.type!=='ASTRAL_SYNC_COMMAND')return;
 AstralSync.command(message.action).then(()=>sendResponse({ok:true}),error=>sendResponse({ok:false,error:String(error.message||error)}));return true;
});

