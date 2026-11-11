/**************************************************
*   Astral New Tab - inline homepage CSS editor
**************************************************/
'use strict';
const $customizeId=id=>document.getElementById(id);
(async()=>{
 try{
  if(typeof AstralStore.initializeFromFile==='function')await AstralStore.initializeFromFile();
  else await AstralStore.ready;
 }catch(error){AstralStore.notify(error.message,'预设加载失败');return}
 const modal=$customizeId('customize-modal');
 const editor=$customizeId('index-css');
 const tips=$customizeId('customize-tips');
 const openButton=$customizeId('open-customize');
 const closeButton=$customizeId('customize-close');
 const LAST_MODIFY_CSS_VERSION='1.12.5';
 let defaultCSS='',defaultCSSReady=false;
 let opened=false;
 const adjust=()=>{editor.rows=Math.max(12,editor.value.split('\n').length)};
 const close=()=>{
  if(!opened)return;
  opened=false;
  modal.style.display='none';
  myNewTabWE.editing=false;
  openButton.focus();
 };
 const open=()=>{
  if(myNewTabWE.editing)return;
  const saved=AstralStore.read().css;
  editor.value=saved.index||'';
  tips.textContent=saved.index&&saved.version!==LAST_MODIFY_CSS_VERSION
   ?'主页默认样式已更新，请检查定制 CSS 是否需要调整':'';
  setPreview(false);
  adjust();
  opened=true;
  myNewTabWE.editing=true;
  modal.style.display='flex';
  closeButton.focus();
 };
 openButton.addEventListener('click',open);
 closeButton.addEventListener('click',close);
 modal.addEventListener('click',event=>{if(event.target===modal)close()});
 modal.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();close()}
 });
 const preview=$customizeId('index-css-preview');
 const browse=$customizeId('index-browse');
 const setPreview=show=>{
  preview.hidden=!show;
  editor.hidden=show;
  browse.textContent=show?'返回编辑':'浏览';
  if(show){preview.textContent=defaultCSSReady?defaultCSS:'默认样式尚未加载';preview.focus()}
  else editor.focus();
 };
 browse.addEventListener('click',()=>setPreview(preview.hidden));
 $customizeId('index-default').addEventListener('click',()=>{
  if(!defaultCSSReady){AstralStore.notify('', '无法读取默认样式');return}
  if(!editor.value||confirm('是否加载默认 CSS？')){editor.value=defaultCSS;adjust()}
 });
 $customizeId('index-save').addEventListener('click',async()=>{
  try{
   AstralStore.write({css:{...AstralStore.read().css,index:editor.value,version:editor.value?LAST_MODIFY_CSS_VERSION:0}});
   if(typeof AstralStore.flush==='function')await AstralStore.flush();
   AstralStore.notify('', '主页样式已保存');
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

 try{
  const response=await fetch('../css/index.css');
  if(!response.ok)throw Error('无法读取默认样式');
  defaultCSS=await response.text();
  defaultCSSReady=true;
 }catch(error){AstralStore.notify(error.message,'默认样式加载失败')}
})();
