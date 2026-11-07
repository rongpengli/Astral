'use strict';
(async()=>{
 await AstralStore.ready;
 const el=id=>document.getElementById(id);
 const fields={'ext-auto-change':'autoChange','ext-auto-download':'autoDownload','ext-download-dir':'downloadDir','ext-user-image-src':'userImageSrc'};

 function directoryTone(){
  const dir=el('ext-download-dir');
  dir.dataset.defaultDirectory=dir.value==='bingImg'&&!el('ext-auto-download').checked&&dir.dataset.directoryDirty!=='1'?'true':'false';
 }
 function render(force=false){
  const config=AstralStore.read().config,extras=config.extensionFeatures;
  el('wallpaper-mode').value=extras.userImage?'custom':'bing';
  el('custom-controls').hidden=!extras.userImage;
  el('bing-controls').hidden=extras.userImage;
  for(const id of ['wallpaper-resolution','ext-auto-download','ext-download-dir'])el(id).disabled=!extras.autoChange;
  const limit=extras.autoChange?8:config.bingCacheLimit||config.bingMaxHistory;
  for(const option of el('bing-max-history').options)option.disabled=option.hidden=Number(option.value)>limit;
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
  directoryTone();
  try{
   AstralStore.write({config:AstralCompat.features(data.config,patch)});await AstralStore.flush();
   myNewTabWE.config=AstralStore.read().config;render();
  }catch(error){AstralStore.notify(error.message,'保存失败');render(true)}
 }
 let sourceRevision=0;
 el('wallpaper-mode').addEventListener('change',async event=>{
  ++sourceRevision;
  const custom=event.target.value==='custom';
  try{
   const data=AstralStore.read();
   myNewTabWE.config=AstralStore.write({config:AstralCompat.switchWallpaperMode(data.config,custom)}).config;
   render();await AstralStore.flush();
  }catch(error){AstralStore.notify(error.message,'保存失败');render(true)}
 });
 el('ext-user-image-src').addEventListener('input',()=>++sourceRevision);
 el('reset-custom-wallpaper').onclick=async()=>{
  ++sourceRevision;
  el('wallpaper-file').value='';
  el('ext-user-image-src').value='';
  await saveField('ext-user-image-src','userImageSrc');
 };
 el('pick-wallpaper').onclick=()=>el('wallpaper-file').click();
 el('wallpaper-file').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  const revision=++sourceRevision;
  try{
   if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(file.type)||file.size>16*1024*1024)throw Error('请选择 16 MB 以内的 JPG、PNG、WebP、GIF 或 AVIF 图片');
   const reader=new FileReader();
   const url=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('读取图片失败'));reader.readAsDataURL(file)});
   const img=new Image();img.src=url;await img.decode();
   if(revision!==sourceRevision||!AstralStore.read().config.userImage)return;
   el('ext-user-image-src').value=url;await saveField('ext-user-image-src','userImageSrc');
  }catch(error){AstralStore.notify(error.message,'壁纸上传失败')}
 });
 render();
 addEventListener('astral-defaults-restored',()=>render(true));
 addEventListener('storage',()=>{render()});
 for(const [id,key] of Object.entries(fields))el(id).addEventListener('change',()=>saveField(id,key));
 el('ext-download-dir').addEventListener('input',()=>{el('ext-download-dir').dataset.directoryDirty='1';el('ext-auto-download').checked=true;directoryTone()});
 el('ext-download-dir').addEventListener('blur',()=>{if(el('ext-download-dir').dataset.directoryDirty==='1')return saveField('ext-download-dir','downloadDir')});
})();
