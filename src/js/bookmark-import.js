
'use strict';
const AstralBookmarkImport=(()=>{
 const id=n=>document.getElementById(n), PER_ROW=6;

 const maxRows=()=>AstralStore.read().config.bookmarkImportMaxRows ?? 12;
 let tree=[], selected=new Map(), sequence=0, busy=false, open=false;
 const folder=(title,children=[])=>({type:'folder',title:String(title||''),children,id:'folder-'+(++sequence)});
 const bookmark=(title,url)=>({type:'bookmark',title:String(title||''),url:String(url||'')});
 function fromChrome(nodes){return nodes.map(n=>n.url!==undefined?bookmark(n.title,n.url):folder(n.title,fromChrome(n.children||[])));}
 function htmlTree(text){
  const doc=new DOMParser().parseFromString(text,'text/html');const root=doc.querySelector('dl');if(!root)throw Error('这不是有效的书签 HTML 文件');
  function walk(dl){
   const result=[],items=Array.from(dl.children);
   for(let i=0;i<items.length;i++){
    const el=items[i];if(!['DT','DD'].includes(el.tagName))continue;
    const head=Array.from(el.children).find(c=>['H3','A'].includes(c.tagName))||el.querySelector(':scope > h3, :scope > a');
    if(!head)continue;
    if(head.tagName==='A'){
     result.push(bookmark(head.textContent.trim(),head.getAttribute('href')||''));continue;
    }
    let nested=Array.from(el.children).find(c=>c.tagName==='DL');
    if(!nested){let next=items[i+1];if(next?.tagName==='DL'){nested=next;i++;}else if(next?.tagName==='DD'){nested=next.querySelector('dl');if(nested)i++;}}
    result.push(folder(head.textContent.trim(),nested?walk(nested):[]));
   }
   return result;
  }
  const parsed=walk(root);if(!parsed.length)throw Error('HTML 中未找到书签文件夹或网址');return parsed;
 }
 function validUrl(raw){try{const u=new URL(raw.trim());if(!['https:','http:','mailto:'].includes(u.protocol)||u.username||u.password)return null;return u.href;}catch{return null;}}
 function gather(node,out=[]){for(const c of node.children||[]){if(c.type==='bookmark')out.push(c);else gather(c,out);}return out;}
 function countRows(groups){return groups.reduce((sum,g)=>sum+Math.ceil((g.list||[]).length/PER_ROW),0);}
 function visibleGroups(groups){return groups.filter(g=>String(g.name).toLowerCase()!=='yooo');}
 function pathLabel(node,path){return [...path,node.title].filter(Boolean).join(' / ');}
 // A folder selection applies to its descendants. Individual descendants can
 // override it, including while the proposed import exceeds the row limit.
 function selectedState(node,ancestors=[]){
  let active=false;
  for(const ancestor of [...ancestors,node]){
   const setting=selected.get(ancestor.id);
   if(setting)active=setting.enabled;
  }
  return active;
 }
 function folderState(node,ancestors=[]){
  const active=selectedState(node,ancestors);
  const subfolders=(node.children||[]).filter(c=>c.type==='folder');
  if(!subfolders.length)return {checked:active,partial:false};
  const states=subfolders.map(child=>folderState(child,[...ancestors,node]));
  const all=active&&states.every(st=>st.checked);
  const any=active||states.some(st=>st.checked||st.partial);
  return {checked:all,partial:any&&!all};
 }
 function drawFolders(){
  const area=id('bookmark-folders');area.replaceChildren();
  function walk(node,path=[],level=0,parent=area){
   if(node.type!=='folder')return;
   const full=pathLabel(node,path);
   const details=document.createElement('details');
   details.className='bookmark-folder';details.open=level<2;
   const row=document.createElement('summary');
   const label=document.createElement('label');label.className='bookmark-folder-label';
   const checkbox=document.createElement('input');checkbox.type='checkbox';
   const state=folderState(node,pathNodes(node));
   checkbox.checked=state.checked;checkbox.indeterminate=state.partial;
   checkbox.dataset.folder=node.id;
   const title=document.createElement('span');title.textContent=node.title||'未命名文件夹';title.title=full;
   const count=document.createElement('small');count.textContent=String(gather(node).length);
   label.append(checkbox,title,count);row.append(label);details.append(row);
   checkbox.addEventListener('click',e=>e.stopPropagation());
   checkbox.addEventListener('change',()=>choose(node,full,checkbox.checked));
   for(const c of node.children||[])if(c.type==='folder')walk(c,[...path,node.title],level+1,details);
   parent.append(details);
  }
  for(const n of tree)if(n.type==='folder')walk(n);
 }
 function pathNodes(node){
  const result=[];
  function visit(nodes,ancestors){
   for(const current of nodes){
    if(current===node){result.push(...ancestors);return true;}
    if(current.type==='folder'&&visit(current.children||[],[...ancestors,current]))return true;
   }
   return false;
  }
  visit(tree,[]);return result;
 }
 function choose(node,path,checked){
  // Reset overrides within the selected subtree: selecting a parent selects
  // every child, while deselecting a child excludes only that subtree.
  for(const [key,entry] of selected){
   if(entry.node===node||isAncestor(node,entry.node))selected.delete(key);
  }
  const inherited=selectedState(node,pathNodes(node));
  if(checked!==inherited){
   selected.set(node.id,{node,path,target:'auto',name:node.title||'未命名文件夹',enabled:checked});
  }
  drawFolders();drawPreview();
 }
 function isAncestor(a,b){
  if(a===b)return false;
  for(const c of a.children||[]){
   if(c===b||c.type==='folder'&&isAncestor(c,b))return true;
  }
  return false;
 }
 function selectedEntries(){return Array.from(selected.values()).filter(entry=>entry.enabled);}
 function gatherSelected(entry){
  const out=[];
  function walk(node){
   for(const child of node.children||[]){
    if(child.type==='bookmark'){out.push(child);continue;}
    const override=selected.get(child.id);
    // A positive override has its own target group; do not double-import it.
    if(override)continue;
    walk(child);
   }
  }
  walk(entry.node);return out;
 }
 function importMode(){return id('bookmark-replace').checked?'replace':'merge';}
 function plan(base=AstralStore.read().sites){
  const groups=importMode()==='merge'?structuredClone(base):[];
  let invalid=0,duplicates=0,added=0;
  for(const entry of selectedEntries()){
   const source=gatherSelected(entry),valid=[];
   for(const b of source){const url=validUrl(b.url);if(!url){invalid++;continue;}valid.push({url,title:b.title||url});}
   if(!valid.length)continue;
   let target=entry.target==='new'?null:entry.target==='auto'?groups.find(g=>g.name===entry.name):groups.find(g=>g._syncId===entry.target);
   if(!target){target={_syncId:crypto.randomUUID(),name:entry.name,list:[]};groups.push(target);}
   const urls=new Set(target.list.map(s=>validUrl(s.url)||s.url));
   for(const b of valid){if(urls.has(b.url)){duplicates++;continue;}urls.add(b.url);target.list.push({_syncId:crypto.randomUUID(),title:b.title,url:b.url,icon:'',iconMode:'auto'});added++;}
  }
  return {sites:groups,rows:countRows(visibleGroups(groups)),added,duplicates,invalid,selected:selectedEntries().length};
 }
 function announce(message){id('bookmark-message').textContent=message;}
 function drawPreview(){const p=plan(),base=AstralStore.read().sites,existingRows=countRows(visibleGroups(base));
  const mapping=id('bookmark-targets');mapping.replaceChildren();
  for(const entry of selectedEntries()){
   const row=document.createElement('div');row.className='bookmark-target-row';
   const label=document.createElement('span');label.textContent=entry.path;label.title=entry.path;
   const select=document.createElement('select');select.setAttribute('aria-label','目标分组：'+entry.path);
   const options=[['auto','自动匹配 / 新建'],['new','新建 '+entry.name],...base.map(g=>[g._syncId,'合并到 '+g.name])];
   for(const [value,text] of options){const opt=document.createElement('option');opt.value=value;opt.textContent=text;select.append(opt);}
   select.value=entry.target;select.addEventListener('change',()=>{entry.target=select.value;drawPreview();});
   row.append(label,select);mapping.append(row);
  }
  id('bookmark-stats').textContent=`现有导航 ${existingRows} 行 · 已选 ${p.selected} 个文件夹 · 新增 ${p.added} 个链接 · 重复 ${p.duplicates} · 无效 ${p.invalid} · 预计 ${p.rows} / ${maxRows()} 行`;
  const bytes=new TextEncoder().encode(JSON.stringify({...AstralStore.read(),sites:p.sites})).length;
  id('bookmark-sync-hint').textContent=bytes>40000?'提示：预计配置体积较大，可能超出云同步容量；本机导入不受影响。':'';
  if(p.rows>maxRows())announce(`预计 ${p.rows} 行，超过设置的 ${maxRows()} 行，仍可导入`);
  else announce('');
  id('bookmark-confirm').disabled=!p.selected||!p.added&&importMode()==='merge';
 }
 function show(){open=true;myNewTabWE.editing=true;id('bookmark-modal').style.display='flex';id('bookmark-cancel').focus();}
 function hide(){open=false;myNewTabWE.editing=false;id('bookmark-modal').style.display='none';id('bookmark-replace-confirm').hidden=true;}
 async function readChrome(){

  const has=await chrome.permissions.request({permissions:['bookmarks']});
  if(!has)throw Error('未授予浏览器书签权限');
  const roots=await chrome.bookmarks.getTree();return fromChrome(roots.flatMap(n=>n.children||[]));
 }
 async function load(source){if(busy)return;busy=true;try{
  sequence=0;const parsed=source==='chrome'?await readChrome():htmlTree(await id('bookmark-file').files[0].text());
  tree=parsed;selected=new Map();drawFolders();drawPreview();announce('请选择要导入的文件夹');
 }catch(e){announce(e.message||String(e));}finally{busy=false;}}
 function confirmReplacement(count){return new Promise(resolve=>{
  const box=id('bookmark-replace-confirm');box.hidden=false;
  id('bookmark-replace-note').textContent=`将用 ${count} 个书签分组替换现有全部导航。其他设置不受影响。`;
  const yes=id('bookmark-replace-yes'),no=id('bookmark-replace-no');
  const finish=ok=>{box.hidden=true;yes.onclick=no.onclick=null;resolve(ok);};
  yes.onclick=()=>finish(true);no.onclick=()=>finish(false);no.focus();
 });}
 async function commit(){if(busy||!selectedEntries().length)return;busy=true;id('bookmark-confirm').disabled=true;
  try{
   await AstralStore.flush();const current=AstralStore.read().sites;const p=plan(current);
   if(importMode()==='replace'&&!await confirmReplacement(p.sites.length))return;
   const validated=AstralStore.validate({...AstralStore.read(),sites:p.sites});
   AstralStore.write({sites:validated.sites});await AstralStore.flush();
   myNewTabWE.sites=AstralStore.read().sites;myNewTabWE.renderSites();hide();
   myNewTabWE.notify(`新增 ${p.added} 个，重复 ${p.duplicates} 个，无效 ${p.invalid} 个`,'书签导入完成');
  }catch(e){announce('导入失败：'+(e.message||String(e)));}finally{busy=false;id('bookmark-confirm').disabled=false;}}
 function init(){
  id('bookmark-open').addEventListener('click',()=>{tree=[];selected=new Map();id('bookmark-file').value='';id('bookmark-folders').replaceChildren();drawPreview();show();});
  id('bookmark-cancel').addEventListener('click',hide);
  id('bookmark-modal').addEventListener('keydown',e=>{if(e.key==='Escape'&&!id('bookmark-replace-confirm').hidden){e.preventDefault();id('bookmark-replace-no').click();}else if(e.key==='Escape'){e.preventDefault();hide();}});
  id('bookmark-chrome').addEventListener('click',()=>load('chrome'));
  id('bookmark-html').addEventListener('click',()=>{id('bookmark-file').value='';id('bookmark-file').click();});
  id('bookmark-file').addEventListener('change',()=>{if(id('bookmark-file').files?.[0])load('html');});
  for(const x of ['bookmark-merge','bookmark-replace'])id(x).addEventListener('change',drawPreview);
  id('bookmark-confirm').addEventListener('click',commit);
 }

 function refresh(){if(open)drawPreview();}
 return {init,refresh,htmlTree,fromChrome,countRows,validUrl};
})();
