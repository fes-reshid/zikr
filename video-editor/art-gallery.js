/* Original backgrounds and editable invitation videos. */
(function(){
'use strict';
const app=window.ReelApp,T=app.T,el=app.el;
const ART=[['emerald-arch','Emerald & gold arch'],['moonlit-mosque','Moonlit mosque'],['ivory-lanterns','Ivory lantern courtyard'],['blank-emerald-panel','Blank emerald & gold panel'],['blank-ivory-panel','Blank ivory & gold panel'],['blank-midnight-panel','Blank midnight & gold panel'],['emerald-label','Emerald gold label'],['ivory-label','Ivory gold cartouche'],['gold-flourish','Gold arabesque flourish']];
const SHAPES=['emerald-label','ivory-label','gold-flourish'];
const THEMES=[['emerald','Emerald geometry'],['midnight','Midnight geometry'],['paper','Warm paper'],['rose','Rose glow'],['sky','Soft sky']];
async function importArt(id){
 if(!ART.some(a=>a[0]===id))throw new Error('Unknown background');
 const response=await fetch('assets/'+id+'.webp');if(!response.ok)throw new Error('Background could not load. Please try again.');
 const blob=await response.blob(),ids=await app.importFiles([new File([blob],id+'.webp',{type:'image/webp'})],{noCommit:true,fresh:true});
 if(!ids.length)throw new Error('Could not import the background.');return ids[0];
}
async function makePoster(item,options){
 app.pause();const before=app.state.project,empty=!before.clips.length,dimensions=options.size.split('x').map(Number);
 const w=empty?dimensions[0]:before.width,h=empty?dimensions[1]:before.height,start=T.projectDuration(before),duration=15;
 const mediaId=await importArt(item.art);let p=T.clone(app.state.project);
 if(empty){p.width=w;p.height=h;p.name=item.name;}
 const track=T.nextTrackId(p,'video');p=T.addTrack(p,'video',item.name+' · background');
 // Preserve the complete arch in wide projects, using a blurred fill outside it.
 p=T.addClip(p,Object.assign(T.clipFromMedia(T.getMedia(p,mediaId),track,start),{duration,fit:'contain',bgFill:'blur'}));
 const light=item.theme==='paper',ink=light?'#26352f':'#fff4d6',accent=light?'#78511e':'#f3cf77';
 const portrait=h>w,unit=portrait?Math.min(w/h,.8)/.8:1;
 const rows=[
  [options.title||item.title,.41,portrait?30:29,ink],
  [options.subtitle||item.subtitle,.48,portrait?15:15,ink],
  [options.topic||item.topic,.575,portrait?34:32,accent],
  [options.speaker||item.speaker,.665,portrait?17:17,ink],
  [options.date||'Add your date • Add your time',.745,portrait?20:19,accent],
  [options.venue||'Join us on Zoom • Add meeting ID',.81,portrait?14:14,ink]
 ];
 rows.forEach(([text,y,size,color],i)=>{
  const id=T.nextTrackId(p,'text');p=T.addTrack(p,'text',['Heading','Subtitle','Topic','Speaker','Date and time','Venue'][i]);
  p=T.addClip(p,Object.assign(T.textClip(id,start,String(text)),{duration,y,fontSize:size*unit,font:T.isArabic(text)?'amiri':'marcellus',color,bold:i===0,shadow:!light,anim:'fade',fadeIn:.65+i*.15,fadeOut:.5,box:false}));
 });
 app.apply(p);app.seek(start+2);app.zoomToFit();app.selectOnly(p.clips[p.clips.length-6].id);app.toast('Invitation added. Every text line is editable; Undo removes the template.');
}
function openBackgrounds(onlyShapes=false){
 onlyShapes=onlyShapes===true;
 app.pause();let chosen=onlyShapes?SHAPES[0]:ART[0][0];const cards=[],grid=el('div',{className:'studio-grid'});
 (onlyShapes?ART.filter(a=>SHAPES.includes(a[0])):[...ART,...THEMES]).forEach(([id,name])=>{
  const art=ART.some(a=>a[0]===id),preview=art?el('img',{src:'assets/'+id+'.webp',alt:name,loading:'lazy',style:{width:'100%',height:'170px',objectFit:SHAPES.includes(id)?'contain':'cover',background:'#23372f'}}):window.ReelStudio.background(id,320,200);
  const card=el('button',{type:'button',className:'studio-card','aria-pressed':String(id===chosen),onclick:()=>{chosen=id;target.value=SHAPES.includes(id)?'overlay':'new';cards.forEach(([b,key])=>b.setAttribute('aria-pressed',String(key===id)));}},[preview,el('strong',{text:name})]);grid.append(card);cards.push([card,id]);
 });
 const duration=el('input',{type:'number',value:10,min:1,max:300,step:1});
 const target=el('select',{},[el('option',{value:'overlay',text:'Add as a movable decoration above images'}),el('option',{value:'new',text:'Add at playhead, behind existing clips'}),el('option',{value:'replace',text:'Replace selected image background'})]);
 target.value=onlyShapes?'overlay':'new';
 app.openDialog({title:onlyShapes?'Decorative shapes':'Background images',wide:true,intro:'Text-free artwork and transparent decorative shapes. Move and resize a shape on the preview, then add your own text above it.',body:[grid,app.dialogField('Action',target),app.dialogField('Duration (seconds)',duration)],actions:[{label:'Cancel'},{label:'Use background',primary:true,run:async d=>{
  const seconds=Number(duration.value),before=app.state.project,selected=T.getClip(before,app.state.selected),time=app.state.time;
  if(!Number.isFinite(seconds)||seconds<1||seconds>300){d.status('Choose 1–300 seconds.');return false;}
  if(target.value==='replace'&&(!selected||T.clipKind(before,selected)!=='image')){d.status('Select an image clip first, or choose Add at playhead.');return false;}
  d.busy(true);d.status('Loading your background…');
  try{
   const mediaId=ART.some(a=>a[0]===chosen)?await importArt(chosen):await window.ReelStudio.importBackground(chosen,before.width,before.height);
   let p=T.clone(app.state.project),id;
   if(target.value==='replace'){id=selected.id;p=T.updateClip(p,id,{mediaId,cutout:null,fit:'contain',bgFill:'blur'});}
   else if(target.value==='overlay'){const track=T.nextTrackId(p,'video');p=T.addTrack(p,'video','Decorative shape');const clip=Object.assign(T.clipFromMedia(T.getMedia(p,mediaId),track,time),{duration:seconds,fit:'contain',bgFill:'none',scale:.65});id=clip.id;p=T.addClip(p,clip);}
   else{const track=T.nextTrackId(p,'video');p=T.addTrack(p,'video','Background image');const entry=p.tracks.find(t=>t.id===track);p.tracks=p.tracks.filter(t=>t.id!==track);const audio=p.tracks.findIndex(t=>t.kind==='audio');p.tracks.splice(audio<0?p.tracks.length:audio,0,entry);const clip=Object.assign(T.clipFromMedia(T.getMedia(p,mediaId),track,time),{duration:seconds,fit:'contain',bgFill:'blur'});id=clip.id;p=T.addClip(p,clip);}
   app.apply(p);app.selectOnly(id);app.zoomToFit();app.toast('Background added.');return true;
  }catch(e){app.state.project=before;app.afterChange();d.busy(false);d.status(e.message);return false;}
 }}]});
}
document.querySelector('.studio-bar').append(el('button',{type:'button',id:'studio-backgrounds',text:'Background images',onclick:openBackgrounds}));
app.addTool({section:'Create',label:'Background images…',run:openBackgrounds});
document.querySelector('.studio-bar').append(el('button',{type:'button',id:'studio-shapes',text:'Shapes',onclick:()=>openBackgrounds(true)}));
app.addTool({section:'Create',label:'Decorative shapes…',run:()=>openBackgrounds(true)});
window.ReelGallery={ART,SHAPES,openBackgrounds,importArt,makePoster};
}());
