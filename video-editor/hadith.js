/* Short, source-checked hadith texts. English meanings are editorial paraphrases. */
(function(){
'use strict';
const app=window.ReelApp,T=app.T,el=app.el;
const HADITH=[
 {title:'Learning and teaching the Qur’an',ref:'Sahih al-Bukhari 5027',url:'https://sunnah.com/bukhari:5027',arabic:'خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ',meaning:'The best of you learn the Qur’an and teach it.'},
 {title:'Love for your brother',ref:'Sahih al-Bukhari 13',url:'https://sunnah.com/bukhari:13',arabic:'لَا يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لِأَخِيهِ مَا يُحِبُّ لِنَفْسِهِ',meaning:'Faith calls us to love for our brother the good we love for ourselves.'},
 {title:'Intentions',ref:'Sahih al-Bukhari 1 · excerpt',url:'https://sunnah.com/bukhari:1',arabic:'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى',meaning:'Deeds are judged by intentions; each person receives according to their intention.'},
 {title:'Speak good',ref:'Sahih al-Bukhari 6018 · excerpt',url:'https://sunnah.com/bukhari:6018',arabic:'وَمَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الآخِرِ فَلْيَقُلْ خَيْرًا أَوْ لِيَصْمُتْ',meaning:'Whoever believes in Allah and the Last Day should speak what is good or remain silent.'}
];
const cache={};
const normal=s=>s.normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g,'').toLowerCase();
function pages(text,limit=150){const words=String(text).trim().split(/\s+/),out=[];let line='';for(const word of words){if(line&&normal(line+' '+word).length>limit){out.push(line);line='';}line+=(line?' ':'')+word;}if(line)out.push(line);return out;}
async function loadCollection(id){
 if(cache[id])return cache[id];
 const response=await fetch('assets/hadith-'+id+'.json.gz');if(!response.ok)throw Error('Collection could not load. Check your connection and try again.');
 const bytes=new Uint8Array(await response.arrayBuffer());let text;
 if(bytes[0]===31&&bytes[1]===139){if(typeof DecompressionStream==='undefined')throw Error('Please use an updated browser to open the full collections.');text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}else text=new TextDecoder().decode(bytes);
 const data=JSON.parse(text),expected=id==='nawawi'?42:1896;if(data.items?.length!==expected||data.items.some((h,i)=>h.n!==i+1||!h.arabic))throw Error('Collection data is incomplete. Please reload.');cache[id]=data;return data;
}
function open(){
 app.pause();let data=null,selected=null,version=0,dialog;
 const options=items=>items.map(([value,text])=>el('option',{value,text}));
 const collection=el('select',{},options([['short','Selected short hadiths'],['nawawi','Full Forty Hadith of Imam Nawawi · 42'],['riyad','Full Riyad as-Salihin · 1,896']]));
 const chapter=el('select',{},options([['all','All books / chapters']]));
 const search=el('input',{type:'search',placeholder:'Search Arabic text or hadith number'}),number=el('input',{type:'number',min:1,value:1,'aria-label':'Go to hadith number'});
 const choice=el('select',{'aria-label':'Choose hadith'}),previous=el('button',{type:'button',text:'Previous'}),next=el('button',{type:'button',text:'Next'});
 const arabic=el('textarea',{rows:5,dir:'rtl',lang:'ar'}),meaning=el('textarea',{rows:2,placeholder:'Optional: add your own translation or meaning'});
 const source=el('a',{target:'_blank',rel:'noopener noreferrer',text:'Read and check the full hadith on Sunnah.com'}),status=el('p',{role:'status'});
 const background=el('select',{},window.ReelGallery.ART.filter(a=>!window.ReelGallery.SHAPES.includes(a[0])).map(([value,text])=>el('option',{value,text})));background.value='blank-emerald-panel';
 const duration=el('input',{type:'number',min:5,max:60,value:12});
 const format=el('select',{},options([['1280x720','Landscape'],['1080x1920','Portrait'],['1080x1080','Square']]));
 function select(n){const h=data?.items.find(x=>x.n===Number(n));if(!h)return;selected=h;choice.value=String(h.n);number.value=h.n;arabic.value=h.arabic;meaning.value=h.meaning||'';source.href=h.url||'https://sunnah.com/'+data.slug+':'+h.n;previous.disabled=h.n===1;next.disabled=h.n===data.items.length;status.textContent=data.items.length+' hadiths available · '+pages(h.arabic).length+' Arabic slide(s). Full text is preserved.';}
 function filter(){if(!data)return;const q=normal(search.value),list=data.items.filter(h=>(chapter.value==='all'||String(h.chapter)===chapter.value)&&(!q||String(h.n)===q||normal(h.arabic+' '+(h.title||'')).includes(q)));choice.replaceChildren(...list.map(h=>el('option',{value:h.n,text:h.n+' · '+(h.title||h.arabic.replace(/\s+/g,' ').slice(0,65))})));if(list.length)select(list[0].n);else{selected=null;arabic.value='';meaning.value='';source.removeAttribute('href');status.textContent='No matching hadith. Clear the search or change the book.';}}
 function jump(n){if(!data)return;chapter.value='all';search.value='';filter();select(Math.max(1,Math.min(data.items.length,Number(n)||1)));}
 async function change(){const ticket=++version;selected=null;data=null;arabic.value='';meaning.value='';source.removeAttribute('href');choice.replaceChildren();status.textContent='Loading collection…';try{const d=collection.value==='short'?{name:'Selected hadiths',items:HADITH.map((h,i)=>({...h,n:i+1,chapter:0})),chapters:[]}:await loadCollection(collection.value);if(ticket!==version)return;data=d;chapter.replaceChildren(...options([['all','All books / chapters'],...d.chapters.map(c=>[String(c.id),c.name])]));chapter.disabled=!d.chapters.length;number.max=d.items.length;search.value='';filter();}catch(e){if(ticket===version)status.textContent=e.message;}}
 collection.onchange=change;chapter.onchange=filter;search.oninput=filter;choice.onchange=()=>select(choice.value);number.onchange=()=>jump(number.value);previous.onclick=()=>jump((selected?.n||1)-1);next.onclick=()=>jump((selected?.n||1)+1);
 dialog=app.openDialog({title:'Hadith video',wide:true,intro:'Browse full Arabic collections, choose a hadith, and create readable slides with a reference on every slide. Optional translation text becomes separate slides. Record your voice afterwards.',body:[app.dialogField('Collection',collection),app.dialogField('Book / chapter',chapter),app.dialogField('Search',search),app.dialogField('Hadith number',number),app.dialogField('Hadith',choice),el('div',{className:'actions'},[previous,next]),status,source,app.dialogField('Full Arabic text',arabic),app.dialogField('Your translation / meaning',meaning),app.dialogField('Background',background),app.dialogField('Seconds per slide',duration),app.dialogField('Format (empty project)',format),el('small',{text:'Classical Arabic collection text: Sunnah.com via AhmedBaset/hadith-json v1.2.0. Review the source before sharing. Full English translations are available at the source link.'})],onClose:()=>{version++;},actions:[{label:'Cancel'},{label:'Create Hadith video',primary:true,run:async d=>{
 const seconds=Number(duration.value);if(!selected||!arabic.value.trim()||!Number.isFinite(seconds)||seconds<5||seconds>60){d.status('Choose a hadith, keep its Arabic text, and enter 5–60 seconds per slide.');return false;}
 const before=app.state.project,h=selected,ref=h.ref||(data.name+' '+h.n),url=h.url||'https://sunnah.com/'+data.slug+':'+h.n;
 const scenes=[...pages(arabic.value).map(text=>({text,font:'amiri',size:40})),...pages(meaning.value,180).map(text=>({text,font:'sans',size:28}))];
 d.busy(true);d.status('Creating '+scenes.length+' editable slides…');
 try{const mediaId=await window.ReelGallery.importArt(background.value);let p=T.clone(app.state.project);if(!before.clips.length){[p.width,p.height]=format.value.split('x').map(Number);p.name=ref;}
 const start=T.projectDuration(before),track=T.nextTrackId(p,'video');p=T.addTrack(p,'video','Hadith background');p=T.addClip(p,Object.assign(T.clipFromMedia(T.getMedia(p,mediaId),track,start),{duration:seconds*scenes.length,fit:'contain',bgFill:'blur'}));
 const ids=[];for(const name of ['Hadith heading','Hadith text','Hadith reference']){ids.push(T.nextTrackId(p,'text'));p=T.addTrack(p,'text',name);}
 const ratio=Math.min(1,p.width/p.height),light=background.value.includes('ivory'),ink=light?'#24372d':'#fff4d6',gold=light?'#855821':'#edcf83';
 scenes.forEach((scene,i)=>{const at=start+i*seconds;const rows=[['Hadith · '+(i+1)+' / '+scenes.length,.18,20,gold,'sans'],[scene.text,.47,scene.size,ink,scene.font],[ref+'\n'+url.replace('https://',''),.81,15,gold,'sans']];rows.forEach(([text,y,size,color,font],j)=>{p=T.addClip(p,Object.assign(T.textClip(ids[j],at,text),{duration:seconds,y,fontSize:size*ratio,font,color,bold:false,shadow:!light,box:false,fadeIn:.35,fadeOut:.35,anim:'fade'}));});});
 app.apply(p);app.seek(start+1);app.zoomToFit();app.toast(scenes.length+' Hadith slides added. Every text layer is editable.');return true;
 }catch(e){app.state.project=before;app.afterChange();d.busy(false);d.status(e.message);return false;}
 }}]});change();
}
app.addTool({section:'Create',label:'Hadith video…',run:open});document.querySelector('.studio-bar').append(el('button',{type:'button',id:'hadith-video',text:'Hadith video',onclick:open}));window.ReelHadith={open,HADITH,pages};
}());
