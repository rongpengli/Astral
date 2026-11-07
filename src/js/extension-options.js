'use strict';
(async()=>{
 await AstralStore.ready;
 const el=id=>document.getElementById(id);
 const fields={'ext-auto-change':'autoChange','ext-auto-download':'autoDownload','ext-download-dir':'downloadDir','ext-user-image':'userImage','ext-user-image-src':'userImageSrc'};
 let last='';
 function directoryTone(){
  const dir=el('ext-download-dir');
  dir.dataset.defaultDirectory=dir.value==='bingImg'&&!el('ext-auto-download').checked&&dir.dataset.directoryDirty!=='1'?'true':'false';
 }
 function render(force=false){
  const extras=AstralStore.read().config.extensionFeatures;last=JSON.stringify(extras);
  if(force)el('ext-download-dir').dataset.directoryDirty='0';
  for(const [id,key] of Object.entries(fields)){
   const field=el(id);if(id==='ext-download-dir'&&field.dataset.directoryDirty==='1')continue;
   field[field.type==='checkbox'?'checked':'value']=extras[key];
  }
  directoryTone();
 }
 async function saveField(id,key){
  const field=el(id),data=AstralStore.read(),patch={[key]:field.type==='checkbox'?field.checked:field.value.trim()};
  if(key==='downloadDir'){
   patch.autoDownload=true;field.dataset.directoryDirty='0';el('ext-auto-download').checked=true;
  }
  if(key==='userImage'&&field.checked)el('ext-auto-change').checked=false;
  if(key==='autoChange'&&field.checked)el('ext-user-image').checked=false;
  directoryTone();
  try{
   AstralStore.write({config:AstralCompat.features(data.config,patch)});await AstralStore.flush();
   myNewTabWE.config=AstralStore.read().config;last=JSON.stringify(myNewTabWE.config.extensionFeatures);directoryTone();
  }catch(error){AstralStore.notify(error.message,'保存失败');render(true)}
 }
 render();
 addEventListener('astral-defaults-restored',()=>render(true));
 addEventListener('storage',()=>{if(JSON.stringify(AstralStore.read().config.extensionFeatures)!==last)render()});
 for(const [id,key] of Object.entries(fields))el(id).addEventListener('change',()=>saveField(id,key));
 el('ext-download-dir').addEventListener('input',()=>{el('ext-download-dir').dataset.directoryDirty='1';el('ext-auto-download').checked=true;directoryTone()});
 el('ext-download-dir').addEventListener('blur',()=>{if(el('ext-download-dir').dataset.directoryDirty==='1')return saveField('ext-download-dir','downloadDir')});
})();
