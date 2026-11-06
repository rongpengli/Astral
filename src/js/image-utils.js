/* Runs in options page, never in MV3 service worker. */
'use strict';
const AstralImages = {
  async compactDataUrl(source, maxBytes=1800) {
    if (!/^data:image\//.test(source)) return source;
    const image = new Image(); image.src=source;
    await image.decode();
    const canvas=document.createElement('canvas');
    for(const size of [64,48,32,24,16]) {
      const scale=Math.min(1,size/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of [0.8,0.55,0.35]) {
        const result=canvas.toDataURL('image/webp',quality);
        if(result.startsWith('data:image/webp') && new TextEncoder().encode(result).length<=maxBytes) return result;
      }
    }
    // Do not discard the user's original local icon. Sync filter omits oversized icons.
    return source;
  }
};
