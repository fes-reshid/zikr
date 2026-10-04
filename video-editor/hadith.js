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
function open(){
 app.pause();
 const choice=el('select',{},HADITH.map((h,i)=>el('option',{value:i,text:h.title+' — '+h.ref})));
 const arabic=el('textarea',{rows:3,dir:'rtl',lang:'ar'}),meaning=el('textarea',{rows:2});
 const source=el('a',{target:'_blank',rel:'noopener noreferrer',text:'Read the full hadith on Sunnah.com'});
 const background=el('select',{},window.ReelGallery.ART.filter(a=>!a[0].startsWith('uploaded-')).map(([value,text])=>el('option',{value,text})));background.value='blank-emerald-panel';
 const duration=el('input',{type:'number',min:5,max:120,value:15});
 const format=el('select',{},[['1280x720','Landscape'],['1080x1920','Portrait'],['1080x1080','Square']].map(([value,text])=>el('option',{value,text})));
 const refresh=()=>{const h=HADITH[Number(choice.value)];arabic.value=h.arabic;meaning.value=h.meaning;source.href=h.url;};choice.onchange=refresh;refresh();
 app.openDialog({title:'Hadith video',wide:true,intro:'A curated selection checked against Sunnah.com. Arabic matn (or marked excerpt), English meaning and reference become separate editable layers. Add your voice using Record voice after creating the video.',body:[app.dialogField('Hadith',choice),source,app.dialogField('Arabic text',arabic),app.dialogField('English meaning (paraphrase)',meaning),app.dialogField('Background',background),app.dialogField('Duration (seconds)',duration),app.dialogField('Format for an empty project',format)],actions:[{label:'Cancel'},{label:'Create Hadith video',primary:true,run:async d=>{
 const seconds=Number(duration.value);if(!Number.isFinite(seconds)||seconds<5||seconds>120||!arabic.value.trim()){d.status('Enter Arabic text and choose 5–120 seconds.');return false;}
 const before=app.state.project,h=HADITH[Number(choice.value)];d.busy(true);d.status('Creating editable layers…');
 try{
 const mediaId=await window.ReelGallery.importArt(background.value);let p=T.clone(app.state.project);if(!before.clips.length){[p.width,p.height]=format.value.split('x').map(Number);p.name=h.title;}
 const start=T.projectDuration(before),track=T.nextTrackId(p,'video');p=T.addTrack(p,'video','Hadith background');p=T.addClip(p,Object.assign(T.clipFromMedia(T.getMedia(p,mediaId),track,start),{duration:seconds,fit:'cover'}));
 const ratio=Math.min(1,p.width/p.height),light=background.value.includes('ivory'),ink=light?'#24372d':'#fff4d6',gold=light?'#855821':'#edcf83';
 const rows=[['Hadith',.21,23,gold,'marcellus'],[arabic.value.trim(),.39,40,ink,'amiri'],[meaning.value.trim(),.60,23,ink,'sans'],[h.ref,.74,17,gold,'sans'],[h.url.replace('https://','')+' · English meaning',.80,13,gold,'sans']];
 rows.forEach(([text,y,size,color,font],i)=>{if(!text)return;const id=T.nextTrackId(p,'text');p=T.addTrack(p,'text',['Hadith heading','Arabic hadith','English meaning','Hadith reference','Hadith source'][i]);p=T.addClip(p,Object.assign(T.textClip(id,start,text),{duration:seconds,y,fontSize:size*ratio,font,color,bold:false,shadow:!light,box:false,fadeIn:.6,fadeOut:.6,anim:'fade'}));});
 app.apply(p);app.seek(start+1);app.zoomToFit();app.toast('Hadith video added. Drag layers or double-click text to edit.');return true;
 }catch(e){app.state.project=before;app.afterChange();d.busy(false);d.status(e.message);return false;}
 }}]});
}
app.addTool({section:'Create',label:'Hadith video…',run:open});
document.querySelector('.studio-bar').append(el('button',{type:'button',id:'hadith-video',text:'Hadith video',onclick:open}));
window.ReelHadith={open,HADITH};
}());
