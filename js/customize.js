
'use strict';
(()=>{
 const id=name=>document.getElementById(name);
 const modal=id('customize-modal');
 const editor=id('index-css');
 const tips=id('customize-tips');
 const trigger=id('open-customize');
 const closer=id('customize-close');
 if(!modal||!editor||!trigger||!closer){
  console.error('Astral 定制弹窗缺少必要页面元素');
  return;
 }
 const LAST_MODIFY_CSS_VERSION='27.31';
 let defaultCSS='',defaultCSSReady=false,opened=false;
 const adjust=()=>{editor.rows=Math.max(12,editor.value.split('\n').length)};
 const close=()=>{
  if(!opened)return;
  opened=false;
  modal.style.display='none';
  if(typeof myNewTabWE!=='undefined')myNewTabWE.editing=false;
  trigger.focus();
 };
 const open=()=>{
  if(opened||typeof myNewTabWE!=='undefined'&&myNewTabWE.editing)return;
  try{
   const saved=AstralStore.read().css;
   editor.value=saved.index||'';
   tips.textContent=saved.index&&saved.version!==LAST_MODIFY_CSS_VERSION
    ?'主页默认样式已更新，请检查定制 CSS 是否需要调整':'';
  }catch(error){
   console.warn('定制样式读取失败',error);
   editor.value='';
   tips.textContent='无法读取已有主页样式';
  }
  setPreview(false);
  adjust();
  opened=true;
  if(typeof myNewTabWE!=='undefined')myNewTabWE.editing=true;
  modal.style.display='flex';
  closer.focus();
 };
 trigger.addEventListener('click',open);
 closer.addEventListener('click',close);
 modal.addEventListener('click',event=>{if(event.target===modal)close()});
 modal.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();close()}
  if(event.key==='Tab'){
   const focusable=[...modal.querySelectorAll('button:not([disabled]),textarea:not([disabled])')].filter(el=>el.getClientRects().length);
   if(!focusable.length)return;
   const first=focusable[0],last=focusable[focusable.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
 });
 const preview=id('index-css-preview');
 const browse=id('index-browse');
 const setPreview=(show)=>{
  preview.hidden=!show;
  editor.hidden=show;
  browse.textContent=show?'返回编辑':'浏览';
  if(show){preview.textContent=defaultCSSReady?defaultCSS:'默认样式尚未加载';preview.focus()}
  else editor.focus();
 };
 browse.addEventListener('click',()=>setPreview(preview.hidden));
 id('index-default').addEventListener('click',()=>{
  if(!defaultCSSReady){AstralStore.notify('','无法读取默认样式');return}
  if(!editor.value||confirm('是否加载默认 CSS？')){editor.value=defaultCSS;adjust()}
 });
 id('index-save').addEventListener('click',async()=>{
  try{
   AstralStore.write({css:{...AstralStore.read().css,index:editor.value,version:editor.value?LAST_MODIFY_CSS_VERSION:0}});
   if(typeof AstralStore.flush==='function')await AstralStore.flush();
   AstralStore.notify('','主页样式已保存');
   tips.textContent='';
  }catch(error){AstralStore.notify(error.message,'保存失败')}
 });
 editor.addEventListener('input',adjust);
 editor.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  event.preventDefault();
  const start=editor.selectionStart,end=editor.selectionEnd;
  editor.value=editor.value.slice(0,start)+'\t'+editor.value.slice(end);
  editor.selectionStart=editor.selectionEnd=start+1;
  adjust();
 });
 fetch('../css/index.css',{cache:'no-store'}).then(response=>{
  if(!response.ok)throw Error('无法读取默认样式');
  return response.text();
 }).then(content=>{defaultCSS=content;defaultCSSReady=true}).catch(error=>console.warn('无法读取默认样式',error));
})();
