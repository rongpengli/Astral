/* Compare legacy artwork against site-native favicon in the user's Chrome session. */
'use strict';
const AstralIconCompare = (() => {
  const limit = 5;
  function bitmap(source) { return new Promise((resolve,reject)=>{
    const img=new Image(); img.onload=()=>resolve(img); img.onerror=()=>reject(Error('图标无法解码'));img.src=source;
  }); }
  async function pixels(src) {
    const img=await bitmap(src);
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,32,32);
    const size=Math.min(img.naturalWidth,img.naturalHeight);
    ctx.drawImage(img,(img.naturalWidth-size)/2,(img.naturalHeight-size)/2,size,size,0,0,32,32);
    return ctx.getImageData(0,0,32,32).data;
  }
  function difference(a,b) {
    let sum=0,weight=0;
    for(let i=0;i<a.length;i+=4){
      const alpha=Math.max(a[i+3],b[i+3])/255;
      sum+=alpha*(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;
      sum+=Math.abs(a[i+3]-b[i+3]);weight+=alpha+1;
    }
    return sum/(weight*255);
  }
  async function remotePixels(url) {
    const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(6500)});
    if(!response.ok)throw Error('HTTP '+response.status);
    const blob=await response.blob();
    if(!blob.type.startsWith('image/') && !/\.(ico|png|svg|webp|jpg|jpeg)(?:\?|$)/i.test(url))throw Error('非图像响应');
    const obj=URL.createObjectURL(blob);
    try{return await pixels(obj);}finally{URL.revokeObjectURL(obj);}
  }
  async function compress(src) {
    const img=await bitmap(src);const c=document.createElement('canvas');c.width=64;c.height=64;
    const ctx=c.getContext('2d');ctx.clearRect(0,0,64,64);
    const s=Math.min(64/img.naturalWidth,64/img.naturalHeight);
    const w=img.naturalWidth*s,h=img.naturalHeight*s;
    ctx.drawImage(img,(64-w)/2,(64-h)/2,w,h);
    const webp=c.toDataURL('image/webp',0.72);
    const png=c.toDataURL('image/png');
    return webp.startsWith('data:image/webp')&&webp.length<png.length?webp:png;
  }
  async function compare(data, progress) {
    const result=JSON.parse(JSON.stringify(data));
    const entries=result.sites.flatMap(g=>g.list).filter(s=>typeof s.icon==='string'&&s.icon.startsWith('data:image/'));
    let done=0,matched=0,custom=0,unknown=0;
    // Sequential fetch avoids flooding remote websites.
    for(const site of entries){
      try {
        const original=await pixels(site.icon);
        const candidates=await AstralIcons.discover(site.url);
        let found=false,checked=0;
        for(const candidate of candidates.slice(0,limit)){
          try {if(difference(original,await remotePixels(candidate))<=0.09){found=true;break;}checked++;}catch(_){}
        }
        if(found){site.iconMode='auto';site.icon='';matched++;}
        else {site.iconMode='custom';site.icon=await compress(site.icon);custom++;if(!checked)unknown++;}
      }catch(_){site.iconMode='custom';custom++;unknown++;}
      done++;if(progress)progress({done,total:entries.length,matched,custom,unknown});
    }
    return {data:result,stats:{total:entries.length,matched,custom,unknown}};
  }
  return {compare};
})();
if(typeof module!=='undefined')module.exports=AstralIconCompare;
