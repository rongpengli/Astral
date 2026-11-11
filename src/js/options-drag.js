
'use strict';
const AstralNavigationDrag=(()=>{
 let dragging=null;
 const groupId=el=>el?.dataset.dragGroup;
 const findGroup=(groups,id)=>groups.find(g=>g._syncId===id);
 function move(sourceId,itemId,destId,destItemId,after=false){
  const groups=structuredClone(AstralStore.read().sites);
  if(itemId){
   const from=findGroup(groups,sourceId),to=findGroup(groups,destId);if(!from||!to)return false;
   const start=from.list.findIndex(s=>s._syncId===itemId);if(start<0)return false;
   const [site]=from.list.splice(start,1);
   let index=destItemId?to.list.findIndex(s=>s._syncId===destItemId):-1;
   if(index<0)index=to.list.length;else if(after)index++;
   to.list.splice(index,0,site);
  }else{
   const from=groups.findIndex(g=>g._syncId===sourceId),to=groups.findIndex(g=>g._syncId===destId);
   if(from<0||to<0||from===to)return false;
   const [g]=groups.splice(from,1);let index=groups.findIndex(x=>x._syncId===destId);if(index<0)return false;
   if(after)index++;groups.splice(index,0,g);
  }
  myNewTabWE.sites=groups;if(!myNewTabWE.setStorage())return false;
  myNewTabWE.renderSites();return true;
 }
 function init(){const root=document.getElementById('sites');
  root.addEventListener('dragstart',e=>{
   const handle=e.target.closest('.astral-drag-handle');if(!handle)return;
   const g=handle.closest('[data-drag-group]'),r=handle.closest('[data-drag-item]');if(!g)return;
   dragging={group:groupId(g),item:r?.dataset.dragItem||null};
   e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','astral-navigation');handle.classList.add('dragging');
  });
  root.addEventListener('dragover',e=>{
   if(!dragging)return;const g=e.target.closest('[data-drag-group]');if(!g)return;
   const r=e.target.closest('[data-drag-item]');if(dragging.item){if(r?.dataset.dragItem===dragging.item)return;}
   else if(r||g.dataset.dragGroup===dragging.group)return;
   e.preventDefault();e.dataTransfer.dropEffect='move';
   root.querySelectorAll('.astral-drop-target').forEach(n=>n.classList.remove('astral-drop-target'));
   (r&&dragging.item?r:g).classList.add('astral-drop-target');
  });
  root.addEventListener('drop',e=>{
   if(!dragging)return;const g=e.target.closest('[data-drag-group]');if(!g)return;
   const r=e.target.closest('[data-drag-item]');const item=dragging.item? r?.dataset.dragItem||null:null;
   if(!dragging.item&&r)return;
   e.preventDefault();
   const rect=(r&&dragging.item?r:g).getBoundingClientRect();
   const after=e.clientY>rect.top+rect.height/2;
   if(!(dragging.group===g.dataset.dragGroup&&dragging.item===item))move(dragging.group,dragging.item,g.dataset.dragGroup,item,after);
   dragging=null;root.querySelectorAll('.astral-drop-target,.dragging').forEach(n=>n.classList.remove('astral-drop-target','dragging'));
  });
  root.addEventListener('dragend',()=>{dragging=null;root.querySelectorAll('.astral-drop-target,.dragging').forEach(n=>n.classList.remove('astral-drop-target','dragging'));});
 }
 return {init};
})();
