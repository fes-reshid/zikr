/* Direct preview editing. Controls are DOM overlays, never part of exported video. */
(function(){
'use strict';
const app=window.ReelApp,T=app.T,el=app.el,canvas=document.getElementById('preview'),stage=document.getElementById('stage');
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const box=el('div',{className:'preview-selection',hidden:true}),handle=el('button',{type:'button',className:'preview-resize','aria-label':'Drag to resize selected object',title:'Drag to resize'});box.append(handle);stage.append(box);
const pick=el('select',{'aria-label':'Select preview layer'}),edit=el('button',{type:'button',text:'Edit text',disabled:true,onclick:openText});
pick.title='Pick a layer to edit. On the picture: drag to move, double-click text to edit.';
const bar=el('div',{className:'preview-edit-bar'},[pick,edit]);document.querySelector('.transport').prepend(bar);
let drag=null,editor=null,lastKey='',tap=null,lastProject=null;
function layers(){return T.renderLayers(app.state.project,app.state.time).filter(l=>l.kind!=='audio'&&!l.clip.audioOnly&&l.alpha>0).reverse();}
function usable(){return !app.state.playing&&!app.state.exporting&&!stage.classList.contains('drawing');}
function point(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*app.state.project.width,y:(e.clientY-r.top)/r.height*app.state.project.height};}
function hit(e){const p=point(e);return layers().find(l=>{const b=app.previewBounds(l.clip);return b&&p.x>=b.x-8&&p.x<=b.x+b.w+8&&p.y>=b.y-8&&p.y<=b.y+b.h+8;})?.clip;}
pick.onchange=()=>{finishText(true);app.pause();app.selectOnly(pick.value||null);};
function begin(e,resize){
 if(e.button!==0||!usable()||editor)return;
 const clip=resize?T.getClip(app.state.project,app.state.selected):hit(e);if(!clip)return;
 e.preventDefault();app.pause();app.selectOnly(clip.id);
 drag={id:clip.id,before:app.state.project,clip,p:point(e),clientX:e.clientX,clientY:e.clientY,resize,moved:false,pointer:e.pointerId,target:e.currentTarget};
 e.currentTarget.setPointerCapture(e.pointerId);
}
function move(e){
 if(!drag||drag.pointer!==e.pointerId)return;e.preventDefault();
 const d=drag,p=point(e),W=d.before.width,H=d.before.height;
 if(Math.hypot(e.clientX-d.clientX,e.clientY-d.clientY)<3&&!d.moved)return;d.moved=true;
 let patch;
 if(d.resize){const cx=(d.clip.x??.5)*W,cy=(d.clip.y??.5)*H,ratio=Math.hypot(p.x-cx,p.y-cy)/Math.max(10,Math.hypot(d.p.x-cx,d.p.y-cy));patch=d.clip.type==='text'?{fontSize:clamp(d.clip.fontSize*ratio,8,300)}:{scale:clamp((d.clip.scale||1)*ratio,.05,8)};}
 else patch={x:clamp((d.clip.x??.5)+(p.x-d.p.x)/W,0,1),y:clamp((d.clip.y??.5)+(p.y-d.p.y)/H,0,1)};
 app.state.project=T.updateClip(d.before,d.id,patch);app.requestDraw();
}
function end(e,cancel){
 if(!drag||e.pointerId!==drag.pointer)return;const d=drag;drag=null;
 if(d.target.hasPointerCapture(e.pointerId))d.target.releasePointerCapture(e.pointerId);
 if(cancel){app.state.project=d.before;app.afterChange();return;}
 if(d.moved){app.commit();tap=null;}
 else if(e.pointerType!=='mouse'){const now=Date.now();if(tap&&tap.id===d.id&&now-tap.at<400){tap=null;openText();}else tap={id:d.id,at:now};}
}
for(const target of [canvas,handle]){target.addEventListener('pointerdown',e=>begin(e,target===handle));target.addEventListener('pointermove',move);target.addEventListener('pointerup',e=>end(e,false));target.addEventListener('pointercancel',e=>end(e,true));target.addEventListener('lostpointercapture',e=>{if(drag)end(e,true);});}
canvas.addEventListener('dblclick',e=>{const c=hit(e);if(c?.type==='text'){app.selectOnly(c.id);openText();}});
function finishText(save){
 if(!editor)return;const current=editor;editor=null;current.wrap.remove();
 const clip=T.getClip(app.state.project,current.id);if(save&&clip&&current.input.value!==clip.text)app.apply(T.updateClip(app.state.project,clip.id,{text:current.input.value}));
 lastKey='';app.requestDraw();
}
function openText(){
 const clip=T.getClip(app.state.project,app.state.selected);if(!clip||clip.type!=='text'||!usable())return;
 finishText(true);app.pause();const input=el('textarea',{'aria-label':'Edit text on preview',dir:'auto',maxlength:6000,value:clip.text});input.value=clip.text;
 const wrap=el('div',{className:'preview-text-editor'},[input,el('div',{},[el('button',{type:'button',text:'Save text',onclick:()=>finishText(true)}),el('button',{type:'button',text:'Cancel',onclick:()=>finishText(false)})])]);
 stage.append(wrap);editor={id:clip.id,wrap,input};wrap.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();finishText(false);}if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();finishText(true);}});wrap.addEventListener('pointerdown',e=>e.stopPropagation());positionEditor();input.focus();input.select();
}
function positionEditor(){if(!editor)return;const clip=T.getClip(app.state.project,editor.id),b=clip&&app.previewBounds(clip);if(!b){finishText(false);return;}const r=canvas.getBoundingClientRect(),s=stage.getBoundingClientRect(),width=Math.min(Math.max(240,r.width*.8),s.width-16);editor.wrap.style.width=width+'px';editor.wrap.style.left=clamp(r.left-s.left+(clip.x??.5)*r.width-width/2,8,s.width-width-8)+'px';editor.wrap.style.top=clamp(r.top-s.top+b.y/app.state.project.height*r.height,8,Math.max(8,s.height-160))+'px';}
function refresh(){
 const p=app.state.project,r=canvas.getBoundingClientRect(),s=stage.getBoundingClientRect(),selected=T.getClip(p,app.state.selected),active=layers();
 const key=JSON.stringify([app.state.selected,app.state.time,r.width,r.height,r.left,r.top,usable()]);
 if(key!==lastKey||p!==lastProject){lastKey=key;lastProject=p;const b=selected&&active.some(l=>l.clip.id===selected.id)&&app.previewBounds(selected);box.hidden=!b||!usable()||!!editor;
  if(b){const x=Math.max(0,b.x),y=Math.max(0,b.y),w=Math.max(0,Math.min(p.width,b.x+b.w)-x),h=Math.max(0,Math.min(p.height,b.y+b.h)-y);Object.assign(box.style,{left:r.left-s.left+x/p.width*r.width+'px',top:r.top-s.top+y/p.height*r.height+'px',width:w/p.width*r.width+'px',height:h/p.height*r.height+'px'});}
  if(document.activeElement!==pick){pick.replaceChildren(el('option',{value:'',text:'Select a layer…'}),...active.map(l=>el('option',{value:l.clip.id,text:(l.clip.text||T.getMedia(p,l.clip.mediaId)?.name||l.clip.sticker?.kind||'Drawing').slice(0,55)})));pick.value=app.state.selected||'';}
  edit.disabled=!b||selected.type!=='text'||!usable();pick.disabled=!usable();positionEditor();
 }
 if(editor&&(!usable()||editor.id!==app.state.selected))finishText(true);
 requestAnimationFrame(refresh);
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag)end({pointerId:drag.pointer},true);});
requestAnimationFrame(refresh);
}());
