/* Canvas-native stickers, social resizing and on-device background removal. */
(function(){
'use strict';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function keyPixels(data,key,tolerance,softness,despill){
 const r=parseInt(key.slice(1,3),16),g=parseInt(key.slice(3,5),16),b=parseInt(key.slice(5,7),16);
 for(let i=0;i<data.length;i+=4){
  // Compare chroma, rather than brightness, so shaded green is removed too.
  const sum=data[i]+data[i+1]+data[i+2]+1,ks=r+g+b+1;
  const distance=Math.hypot(data[i]/sum-r/ks,data[i+1]/sum-g/ks,data[i+2]/sum-b/ks)*255;
  const alpha=clamp((distance-tolerance)/Math.max(1,softness),0,1);
  data[i+3]=Math.round(data[i+3]*alpha);
  if(despill&&alpha>0&&alpha<1&&g>r&&g>b)data[i+1]=Math.min(data[i+1],Math.max(data[i],data[i+2])+20);
 }
 return data;
}
function resizeProject(project,width,height,fit){
 const p=JSON.parse(JSON.stringify(project)),oldShort=Math.min(p.width,p.height),newShort=Math.min(width,height);
 // Text units are measured against frame height. Preserve their visual size
 // relative to the short edge, avoiding oversized portrait titles.
 const ratio=(newShort/height)/(oldShort/p.height);
 p.clips.forEach(c=>{if(c.type==='text'){c.fontSize*=ratio;if(c.outline)c.outline.width*=ratio;}
  if(c.type==='media'&&!c.audioOnly&&p.media.find(m=>m.id===c.mediaId)?.type!=='audio'){c.fit=fit==='crop'?'cover':'contain';c.bgFill=fit==='blur'?'blur':'none';}});
 p.width=width;p.height=height;return p;
}
if(typeof module==='object'&&module.exports){module.exports={keyPixels,resizeProject,sticker};return;}
const app=window.ReelApp,T=app.T,el=app.el;
const select=items=>el('select',null,items.map(([value,text])=>el('option',{value,text})));
const button=(text,onclick,extra)=>el('button',Object.assign({type:'button',text,onclick},extra));
const slider=(value,min,max,step=1)=>el('input',{type:'range',value,min,max,step});
const STICKERS={arrow:'Arrow',curved:'Curved arrow',circle:'Highlight ring',star:'Gold star',check:'Check mark',heart:'Heart',crescent:'Crescent',sparkles:'Sparkles',book:'Open book',lantern:'Lantern'};
function sticker(c,clip,t,W,H){
 const o=clip.sticker||{},local=Math.max(0,t-clip.start),s=Math.min(W,H)*.17*(clip.scale||1);
 const motion=o.motion||'pop',intro=clamp(local/.55,0,1);
 const zoom=motion==='pop'?1-Math.pow(1-intro,3):motion==='pulse'?1+.07*Math.sin(local*4):1;
 c.save();c.translate((clip.x??.5)*W,(clip.y??.5)*H+(motion==='float'?Math.sin(local*2.5)*s*.08:0));
 c.rotate((o.rotation||0)*Math.PI/180+(motion==='wiggle'?Math.sin(local*5)*.09:0));c.scale(s*zoom,s*zoom);
 c.fillStyle=o.color||'#e5bc55';c.strokeStyle=c.fillStyle;c.lineWidth=.075;c.lineCap='round';c.lineJoin='round';
 const path=(points,fill=false)=>{c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));if(fill){c.closePath();c.fill();}else c.stroke();};
 switch(o.kind){
 case 'arrow':path([[-.48,-.1],[.12,-.1],[.12,-.3],[.5,0],[.12,.3],[.12,.1],[-.48,.1]],true);break;
 case 'curved':c.beginPath();c.moveTo(-.45,.35);c.bezierCurveTo(-.5,-.35,.1,-.4,.42,-.08);c.stroke();path([[.12,-.12],[.44,-.06],[.38,-.37]]);break;
 case 'circle':c.beginPath();c.ellipse(0,0,.46,.36,0,0,Math.PI*2);c.stroke();break;
 case 'check':path([[-.4,0],[-.1,.3],[.44,-.3]]);break;
 case 'heart':c.beginPath();c.moveTo(0,.42);c.bezierCurveTo(-.8,-.02,-.35,-.65,0,-.2);c.bezierCurveTo(.35,-.65,.8,-.02,0,.42);c.fill();break;
 case 'crescent':c.beginPath();c.arc(0,0,.45,.35*Math.PI,1.65*Math.PI);c.bezierCurveTo(-.1,-.25,-.1,.25,Math.cos(.35*Math.PI)*.45,Math.sin(.35*Math.PI)*.45);c.fill();break;
 case 'book':path([[0,-.3],[-.4,-.42],[-.4,.25],[0,.4],[.4,.25],[.4,-.42],[0,-.3]]);path([[0,-.3],[0,.4]]);break;
 case 'lantern':path([[-.28,-.28],[.28,-.28],[.35,.3],[-.35,.3],[-.28,-.28]]);path([[-.28,-.28],[0,-.5],[.28,-.28]]);path([[-.4,.4],[.4,.4]]);c.beginPath();c.ellipse(0,.03,.085,.15,0,0,Math.PI*2);c.fill();break;
 case 'sparkles':for(const [x,y,r] of [[0,0,.32],[-.35,-.3,.12],[.35,.3,.15]])path([[x-r,y],[x-r*.22,y-r*.22],[x,y-r],[x+r*.22,y-r*.22],[x+r,y],[x+r*.22,y+r*.22],[x,y+r],[x-r*.22,y+r*.22]],true);break;
 default:{const pts=[];for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2,r=i%2?.21:.48;pts.push([Math.cos(a)*r,Math.sin(a)*r]);}path(pts,true);}
 }
 c.restore();
}
function openStickers(){
 app.pause();const existing=T.getClip(app.state.project,app.state.selected),editing=existing?.sticker;
 const kind=select(Object.entries(STICKERS)),motion=select([['pop','Pop in'],['pulse','Pulse'],['float','Float'],['wiggle','Wiggle'],['none','Still']]);
 kind.value=editing?.kind||'arrow';motion.value=editing?.motion||'pop';
 const color=el('input',{type:'color',value:editing?.color||'#e5bc55'}),rotation=slider(editing?.rotation||0,-180,180),size=slider((existing?.sticker?existing.scale:1)*100,20,300);
 const x=slider(existing?.sticker?existing.x*100:50,0,100),y=slider(existing?.sticker?existing.y*100:50,0,100);
 const length=el('input',{type:'number',min:.2,max:120,step:.1,value:editing?existing.duration:5});
 const cv=el('canvas',{width:480,height:200,style:{width:'100%',background:'#132a25',borderRadius:'12px'}});let alive=true,frame=0;
 const get=()=>({kind:kind.value,motion:motion.value,color:color.value,rotation:Number(rotation.value)});
 const animate=now=>{if(!alive)return;const c=cv.getContext('2d');c.clearRect(0,0,480,200);sticker(c,{start:0,x:.5,y:.5,scale:Number(size.value)/100,sticker:get()},matchMedia('(prefers-reduced-motion: reduce)').matches?1:now/1000%4,480,200);frame=requestAnimationFrame(animate);};frame=requestAnimationFrame(animate);
 app.openDialog({title:editing?'Edit sticker':'Animated stickers & arrows',body:[cv,app.dialogField('Sticker',kind),app.dialogField('Animation',motion),app.dialogField('Colour',color),app.dialogField('Size',size),app.dialogField('Rotation',rotation),app.dialogField('Position X',x),app.dialogField('Position Y',y),app.dialogField('Duration (s)',length)],onClose:()=>{alive=false;cancelAnimationFrame(frame);},actions:[{label:'Cancel'},{label:editing?'Save changes':'Add sticker',primary:true,run:d=>{
  const duration=Number(length.value);if(!Number.isFinite(duration)||duration<.2||duration>120){d.status('Choose a duration from 0.2 to 120 seconds.');return false;}
  let p=app.state.project;const patch={sticker:get(),scale:Number(size.value)/100,x:Number(x.value)/100,y:Number(y.value)/100,duration,hand:'none',anim:'none'};
  if(editing){const c=T.getClip(p,existing.id);if(!T.isFree(p,c.track,c.start,duration,c.id)){d.status('The longer sticker would overlap another clip. Shorten it or move that clip.');return false;}p=T.updateClip(p,c.id,patch);}
  else{const track=T.nextTrackId(p,'text');p=T.addTrack(p,'text',STICKERS[kind.value]);const c=Object.assign(T.drawClip(track,app.state.time,[]),patch);p=T.addClip(p,c);app.state.selected=c.id;app.state.selection=[c.id];}
  app.apply(p);app.toast('Sticker added to the preview and exported video.');return true;
 }}]});
}
function openResize(){
 const fit=select([['blur','Fit with blurred background'],['fit','Fit with plain background'],['crop','Fill frame (crop edges)']]);
 const grid=el('div',{className:'studio-grid'});let d;
 const formats=[['WhatsApp Status / Reels',1080,1920,'9:16'],['YouTube landscape',1920,1080,'16:9'],['Instagram square',1080,1080,'1:1'],['Instagram portrait',1080,1350,'4:5']];
 formats.forEach(([name,w,h,ratio])=>grid.append(button(name+' · '+ratio,()=>{app.pause();app.apply(resizeProject(app.state.project,w,h,fit.value));d.close();app.toast('Resized to '+w+' × '+h+'. Review text placement; Undo restores the previous size.');},{className:'resize-card'})));
 d=app.openDialog({title:'Resize for social media',intro:'Choose how clips fit, then tap a format. Your timeline and audio timing stay intact.',body:[app.dialogField('Fit videos',fit),grid,el('p',{className:'hint',text:'Text is resized for the new frame. Review your title and sticker positions before exporting.'})],actions:[{label:'Cancel'}]});
}
let segmenter=null,loading=null,loadError=null;
async function loadPerson(){
 if(segmenter)return segmenter;
 if(!loading)loading=(async()=>{
  const base='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const {FilesetResolver,ImageSegmenter}=await import(base+'/vision_bundle.mjs');
  const files=await FilesetResolver.forVisionTasks(base+'/wasm');
  segmenter=await ImageSegmenter.createFromOptions(files,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite'},runningMode:'IMAGE',outputConfidenceMasks:true,outputCategoryMask:false});
  loadError=null;return segmenter;
 })().catch(e=>{loading=null;loadError=e;throw e;});return loading;
}
const frames=new Map();
function processBackground(source,clip,t){
 const o=clip.cutout;if(!o||o.mode==='none')return source;
 if(o.mode==='person'&&!segmenter){if(!loading&&!loadError)loadPerson().then(()=>app.requestDraw()).catch(()=>app.toast('Person background removal could not load. Open Background to retry, or use green screen.',6000));return source;}
 const key=JSON.stringify([clip.mediaId,t,source.w,source.h,o]);
 if(frames.has(key))return frames.get(key);
 const max=1280,ratio=Math.min(1,max/Math.max(source.w,source.h));
 const out=el('canvas',{width:Math.max(1,Math.round(source.w*ratio)),height:Math.max(1,Math.round(source.h*ratio))}),g=out.getContext('2d',{willReadFrequently:true});g.drawImage(source.src,0,0,out.width,out.height);
 if(o.mode==='chroma'){
  const data=g.getImageData(0,0,out.width,out.height);keyPixels(data.data,o.key||'#00ff00',o.tolerance??32,o.softness??20,o.despill!==false);g.putImageData(data,0,0);
 }else{
  segmenter.segment(out,result=>{
   const mask=result.confidenceMasks?.[0];if(!mask)throw new Error('Person mask unavailable.');
   const values=mask.getAsFloat32Array(),cv=el('canvas',{width:mask.width,height:mask.height}),m=cv.getContext('2d'),pixels=m.createImageData(mask.width,mask.height);
   for(let i=0;i<values.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=255;pixels.data[i*4+3]=Math.round(clamp((values[i]-.25)/.5,0,1)*255);}
   m.putImageData(pixels,0,0);g.globalCompositeOperation='destination-in';g.drawImage(cv,0,0,out.width,out.height);g.globalCompositeOperation='source-over';
  });
 }
 if(o.fill&&o.fill!=='transparent'){g.globalCompositeOperation='destination-over';g.fillStyle=o.fill;g.fillRect(0,0,out.width,out.height);g.globalCompositeOperation='source-over';}
 const result={src:out,w:out.width,h:out.height};if(frames.size>=3)frames.delete(frames.keys().next().value);frames.set(key,result);return result;
}
async function ready(project){if(project.clips.some(c=>c.cutout?.mode==='person'))await loadPerson();}
function openBackground(){
 const clip=T.getClip(app.state.project,app.state.selected);
 if(!clip||!['image','video'].includes(T.clipKind(app.state.project,clip))){app.toast('Select an image or video clip on the timeline first.');return;}
 app.pause();const o=clip.cutout||{},mode=select([['person','Auto remove background · person'],['chroma','Green / blue screen'],['none','Restore original background']]);mode.value=o.mode||'person';
 const key=el('input',{type:'color',value:o.key||'#00ff00'}),tolerance=slider(o.tolerance??32,0,140),softness=slider(o.softness??20,1,80),fill=el('input',{type:'color',value:o.fill&&o.fill!=='transparent'?o.fill:'#143d32'}),transparent=el('input',{type:'checkbox',checked:!o.fill||o.fill==='transparent'});
 const chroma=el('div',{className:'dialog-body'},[app.dialogField('Remove colour',key),app.dialogField('Tolerance',tolerance),app.dialogField('Soft edge',softness)]);chroma.hidden=mode.value!=='chroma';mode.onchange=()=>{chroma.hidden=mode.value!=='chroma';};
 let closed=false;
 app.openDialog({title:'Remove or replace background',intro:'Auto mode keeps people in photos and videos. Green screen removes a selected colour. Processing stays on this device.',body:[app.dialogField('Method',mode),chroma,el('label',{className:'check'},[transparent,'Reveal clips underneath']),app.dialogField('Or fill colour',fill),el('p',{className:'hint',text:'Auto mode downloads a person-segmentation model once. Video processing can be slower on phones. Fine hair and fast movement may need a green screen. Output processing is up to 1280 pixels on the long edge.'})],onClose:()=>{closed=true;},actions:[{label:'Cancel',always:true},{label:'Apply background',primary:true,run:async d=>{
  d.busy(true);try{if(mode.value==='person'){d.status('Loading person background removal…');loadError=null;await loadPerson();}if(closed)return false;
   frames.clear();app.apply(T.updateClip(app.state.project,clip.id,{cutout:mode.value==='none'?null:{mode:mode.value,key:key.value,tolerance:Number(tolerance.value),softness:Number(softness.value),despill:true,fill:transparent.checked?'transparent':fill.value},bgFill:'none'}));app.toast('Background effect applied. Add an image or video on a lower track to replace it.');return true;
  }catch(e){d.busy(false);d.status('Could not load background removal. Check your connection or choose Green / blue screen.');return false;}
 }}]});
}
const bar=document.querySelector('.studio-bar');bar.append(button('Stickers',openStickers,{id:'studio-stickers'}),button('Resize',openResize,{id:'studio-resize'}),button('Background',openBackground,{id:'studio-background'}));
app.addTool({section:'Create',label:'Animated stickers & arrows…',run:openStickers});app.addTool({section:'Timeline',label:'Resize for social media…',run:openResize});app.addTool({section:'Effects',label:'Remove / replace background…',run:openBackground});
window.ReelEffects={sticker,openStickers,openResize,openBackground,processBackground,ready,keyPixels,resizeProject};
}());
