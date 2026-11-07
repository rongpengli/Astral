/* One legacy-compatible storage schema; namespaced aliases are accepted for older JSON files. */
'use strict';
const AstralCompat=(()=>{
 const defaults={autoChange:true,autoDownload:false,downloadDir:'bingImg',userImage:false,userImageSrc:''};
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 function config(input={}){
  const c={...input},nested=input.extensionFeatures&&typeof input.extensionFeatures==='object'?input.extensionFeatures:{};
  const extras={};
  for(const [key,fallback] of Object.entries(defaults)){
   const raw=own(input,key)?input[key]:(nested[key]??fallback);
   extras[key]=typeof fallback==='boolean'?!!raw:String(raw??'');if(key==='userImageSrc'&&/^data:/i.test(extras[key]))extras[key]='data:'+extras[key].slice(5);c[key]=extras[key];
  }
  if(extras.userImage)c.autoChange=extras.autoChange=false;
  if(!c.autoChange)c.autoDownload=extras.autoDownload=false;
  c.weatherMode=input.weatherMode==='off'?'off':'native';
  for(const key of ['weatherSrc','weatherLegacySrc','_astralWeatherBridge','downloadDirEdited'])delete c[key];
  c.extensionFeatures=extras;
  return c;
 }
 function storage(input){const c=config(input);delete c.extensionFeatures;return c}
 function features(input,patch){const c=config(input);if(patch.autoChange===true)patch={...patch,userImage:false};if(patch.userImage===true)patch={...patch,autoChange:false};for(const [key,value] of Object.entries(patch)){c[key]=value;c.extensionFeatures[key]=value}return config(c)}
 function switchWallpaperMode(input,custom){
  const previous=config(input);
  if(previous.userImage===custom)return previous;
  if(custom){
   previous.bingPreferences={autoChange:previous.autoChange,autoDownload:previous.autoDownload};
   return features(previous,{userImage:true});
  }
  const saved=previous.bingPreferences;
  delete previous.bingPreferences;
  return features(previous,{
   userImage:false,
   autoChange:typeof saved?.autoChange==='boolean'?saved.autoChange:previous.autoChange,
   autoDownload:typeof saved?.autoDownload==='boolean'?saved.autoDownload:previous.autoDownload
  });
 }
 function portable(input){return storage(input)}
 function downloadFilename(directory,name){
  const clean=value=>String(value||'').replace(/[<>:"|?*\\/\x00-\x1f]/g,'_').replace(/[. ]+$/g,'');
  const parts=String(directory||'').split(/[\\/]+/).filter(v=>v&&v!=='.'&&v!=='..').map(clean).filter(Boolean).map(v=>/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v)?'_'+v:v);
  return [...parts,clean(name)||'bing.jpg'].join('/');
 }
 function equal(a,b){
  if(a===b)return true;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>equal(value,b[index]));
  const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
  return ak.length===bk.length&&ak.every((key,index)=>key===bk[index]&&equal(a[key],b[key]));
 }
 return {config,storage,features,switchWallpaperMode,portable,downloadFilename,equal};
})();
if(typeof module!=='undefined')module.exports=AstralCompat;
