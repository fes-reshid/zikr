/* Preview space is a view preference; it never changes video resolution. */
(function(){
'use strict';
const app=window.ReelApp,el=app.el,viewer=document.querySelector('.viewer');
const size=el('input',{type:'range',min:30,max:85,step:1,value:64,'aria-label':'Preview workspace size'}),value=el('output',{text:'64%'});
const expand=el('button',{type:'button',text:'Expand preview','aria-pressed':'false'}),panels=el('button',{type:'button',text:'Hide side panels','aria-pressed':'false'});
const apply=()=>{const pct=Number(size.value);document.body.style.setProperty('--timeline-h',Math.max(110,innerHeight*(1-pct/100))+'px');value.textContent=pct+'%';try{localStorage.setItem('reel-preview-space',String(pct));}catch{}window.dispatchEvent(new Event('resize'));};
size.oninput=apply;
try{const n=Number(localStorage.getItem('reel-preview-space'));if(n>=30&&n<=85){size.value=n;apply();}}catch{}
const focus=on=>{document.body.classList.toggle('preview-expanded',on);expand.textContent=on?'Restore workspace':'Expand preview';expand.setAttribute('aria-pressed',String(on));window.dispatchEvent(new Event('resize'));};
expand.onclick=()=>focus(!document.body.classList.contains('preview-expanded'));
panels.onclick=()=>{const on=document.body.classList.toggle('preview-wide');panels.textContent=on?'Show side panels':'Hide side panels';panels.setAttribute('aria-pressed',String(on));window.dispatchEvent(new Event('resize'));};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('preview-expanded'))focus(false);});
viewer.prepend(el('div',{className:'workspace-size-bar'},[el('label',{text:'Preview space',style:{whiteSpace:'nowrap'}},[size]),value,expand,panels]));
const divider=document.getElementById('resizer');divider.tabIndex=0;divider.setAttribute('aria-label','Resize preview and timeline. Drag or use arrow keys.');divider.style.touchAction='none';divider.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();size.value=Math.max(30,Math.min(85,Number(size.value)+(e.key==='ArrowDown'?5:-5)));apply();});
}());
