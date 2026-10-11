/* Local microphone recording, vocal-to-lyric alignment and personal templates. */
(function () {
    'use strict';
    const tokens=text=>String(text).trim().split(/\s+/).filter(Boolean);
    const normal=text=>text.toLowerCase().normalize('NFKD').replace(/[\u0640\p{M}\p{P}\p{S}]/gu,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه');
    function alignLyrics(lines,chunks,duration){
        const expected=[];lines.forEach((line,i)=>tokens(line).forEach((word,j)=>expected.push({word:normal(word),line:i,index:j})));
        const heard=[];
        chunks.forEach(c=>{
            if(!c.timestamp||!Number.isFinite(c.timestamp[0]))return;
            const words=tokens(c.text),start=Math.max(0,c.timestamp[0]),end=Math.min(duration,c.timestamp[1]??start+.4*words.length);
            words.forEach((word,i)=>heard.push({word:normal(word),start:start+(end-start)*i/words.length,end:start+(end-start)*(i+1)/words.length}));
        });
        if(!expected.length||!heard.length)throw new Error('No vocal words were detected. Try a clearer vocal recording.');
        if(expected.length>1200||heard.length>5000)throw new Error('Sync a shorter section (up to 1,200 lyric words) at a time.');
        const n=expected.length,m=heard.length,dp=Array.from({length:n+1},()=>new Uint16Array(m+1));
        for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=expected[i].word&&expected[i].word===heard[j].word?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
        const matches=new Map();let i=0,j=0;
        while(i<n&&j<m){if(expected[i].word&&expected[i].word===heard[j].word){matches.set(i,heard[j]);i++;j++;}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;}
        if(matches.size/n<.6)throw new Error('Too few words matched the lyrics. Use the matching vocal recording, correct the lyrics, or try the Balanced model.');
        const cues=[];let cursor=0,lastEnd=0;
        for(let line=0;line<lines.length;line++){
            const count=tokens(lines[line]).length,known=[];
            for(let k=0;k<count;k++)if(matches.has(cursor+k))known.push({index:k,...matches.get(cursor+k)});
            if(known.length/Math.max(1,count)<.5)throw new Error('Could not confidently match line '+(line+1)+'. Check that it appears in the recording.');
            const first=known[0],last=known[known.length-1];
            const start=Math.max(lastEnd,0,first.start-first.index*.25),end=Math.min(duration,last.end+(count-1-last.index)*.25);
            if(end-start<.2)throw new Error('Some lyric lines overlap in the recording. Split the lyrics into shorter phrases and try again.');
            const times=[];
            for(let k=0;k<count;k++){
                const at=known.find(w=>w.index===k);let time;
                if(at)time=at.start;
                else{
                    const left=known.filter(w=>w.index<k).pop(),right=known.find(w=>w.index>k);
                    if(left&&right)time=left.start+(right.start-left.start)*(k-left.index)/(right.index-left.index);
                    else if(right)time=start+(right.start-start)*k/Math.max(1,right.index);
                    else time=last.start+(end-last.start)*(k-last.index)/Math.max(1,count-last.index);
                }
                times.push(Math.max(0,Math.min(end-start,time-start)));
            }
            cues.push({start,end,wordTimes:times});lastEnd=end;cursor+=count;
        }
        return {cues,matched:matches.size,total:n};
    }
    if(typeof module==='object'&&module.exports){module.exports={alignLyrics};return;}
    const app=window.ReelApp,T=app.T,el=app.el;
    const button=(text,run,attrs)=>el('button',Object.assign({type:'button',text,onclick:run},attrs));
    const choose=items=>el('select',null,items.map(([value,text])=>el('option',{value,text})));

    function openRecorder(){
        if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){app.toast('Voice recording needs HTTPS and a browser with microphone recording support.');return;}
        app.pause();const at=app.state.time;
        let stream=null,rec=null,chunks=[],blob=null,url=null,ctx=null,raf=0,started=0,closed=false,opening=false;
        const status=el('p',{role:'status',text:'Ready to record. Your microphone is used only after you press Record.'});
        const meter=el('meter',{min:0,max:1,value:0,'aria-label':'Microphone level',style:{width:'100%'}});
        const timer=el('strong',{text:'00:00',style:{fontSize:'28px',fontFamily:'monospace'}});
        const player=el('audio',{controls:true,hidden:true,style:{width:'100%'}});
        const name=el('input',{type:'text',value:'My voice recording',maxlength:80});
        const playAlong=el('input',{type:'checkbox'});
        function release(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}cancelAnimationFrame(raf);if(ctx){ctx.close().catch(()=>{});ctx=null;}app.pause();}
        const record=button('Record',async()=>{
            if(opening||rec?.state==='recording')return;
            opening=true;record.disabled=true;status.textContent='Allow microphone access in your browser…';
            try{
                stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
                if(closed){release();return;}
                const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(x=>MediaRecorder.isTypeSupported(x));
                rec=new MediaRecorder(stream,mime?{mimeType:mime}:{});chunks=[];blob=null;player.hidden=true;
                if(url){URL.revokeObjectURL(url);url=null;}
                rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
                rec.onerror=()=>{status.textContent='Recording stopped unexpectedly. Try again.';release();record.disabled=false;stop.disabled=true;};
                rec.onstop=()=>{
                    release();record.disabled=false;stop.disabled=true;if(closed)return;
                    blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});if(!blob.size){status.textContent='Nothing was recorded. Try again.';return;}
                    url=URL.createObjectURL(blob);player.src=url;player.hidden=false;status.textContent='Listen back, then add this recording to your timeline.';record.textContent='Record again';
                };
                const AC=window.AudioContext||window.webkitAudioContext;
                let analyser=null,data=null;
                try{ctx=new AC();analyser=ctx.createAnalyser();analyser.fftSize=256;ctx.createMediaStreamSource(stream).connect(analyser);data=new Uint8Array(analyser.fftSize);}catch(e){}
                started=performance.now();rec.start(250);stop.disabled=false;status.textContent='Recording…';
                if(playAlong.checked){app.seek(at);app.play();}
                function tick(){if(closed||rec.state!=='recording')return;const sec=(performance.now()-started)/1000;timer.textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(Math.floor(sec%60)).padStart(2,'0');
                    if(analyser){analyser.getByteTimeDomainData(data);meter.value=Math.min(1,Math.max(...data.map(v=>Math.abs(v-128)))/90);}
                    if(sec>=300){rec.stop();return;}raf=requestAnimationFrame(tick);}
                raf=requestAnimationFrame(tick);
            }catch(e){release();record.disabled=false;status.textContent=e.name==='NotAllowedError'?'Microphone access was denied. Allow it in your browser’s site settings, then try again.':'Could not open the microphone: '+e.message;}
            finally{opening=false;}
        },{className:'primary'});
        const stop=button('Stop',()=>{if(rec?.state==='recording')rec.stop();},{disabled:true});
        app.openDialog({title:'Record your voice',intro:'Record narration or nasheed vocals on this device. Up to five minutes per take.',
            body:[app.dialogField('Recording name',name),el('div',{className:'row-buttons'},[record,stop,timer]),meter,status,player,
                el('label',{className:'check'},[playAlong,'Play the timeline while recording (use headphones)'])],
            onClose:()=>{closed=true;if(rec?.state==='recording')rec.stop();release();if(url)URL.revokeObjectURL(url);},
            actions:[{label:'Cancel'},{label:'Add recording',primary:true,run:async d=>{
                if(rec?.state==='recording'||!blob){d.status('Press Stop and listen to your recording first.');return false;}
                d.busy(true);const before=app.state.project;
                try{const ext=blob.type.includes('mp4')?'m4a':blob.type.includes('ogg')?'ogg':'webm';
                    const ids=await app.importFiles([new File([blob],(name.value.trim()||'Voice recording')+'.'+ext,{type:blob.type})],{noCommit:true,fresh:true});
                    if(!ids.length)throw new Error('This browser could not open the recording.');
                    let p=app.state.project;const track=T.nextTrackId(p,'audio');p=T.addTrack(p,'audio','Voice recording');const clip=T.clipFromMedia(T.getMedia(p,ids[0]),track,at);p=T.addClip(p,clip);
                    app.apply(p);app.selectOnly(clip.id);app.seek(at);app.toast('Your recording is on the timeline.');return true;
                }catch(e){app.state.project=before;app.afterChange();d.busy(false);d.status(e.message);return false;}
            }}]});
    }

    function openSync(){
        const p=app.state.project;
        const vocals=p.clips.filter(c=>T.isTimed(p,c)&&!c.freeze&&app.files.has(c.mediaId));
        const tracks=p.tracks.filter(t=>t.kind==='text'&&p.clips.some(c=>c.track===t.id&&c.type==='text'));
        if(!vocals.length||!tracks.length){app.toast('Add your lyrics and a vocal recording to the timeline first.');return;}
        const source=choose(vocals.map(c=>[c.id,(T.getMedia(p,c.mediaId)?.name||'Audio')+' · '+app.fmt(c.start)]));
        const track=choose(tracks.map(t=>[t.id,t.name]));const preferred=tracks.find(t=>/nasheed|lyric/i.test(t.name));if(preferred)track.value=preferred.id;
        const language=choose([['','Detect automatically'],['english','English'],['arabic','Arabic'],['somali','Somali'],['amharic','Amharic'],['swahili','Swahili']]);
        const model=choose([['onnx-community/whisper-tiny_timestamped','Fast · about 40 MB'],['onnx-community/whisper-base_timestamped','Balanced · about 80 MB']]);
        let closed=false,running=false;
        app.openDialog({title:'Sync lyrics to vocals',intro:'Listen to your vocal clip on this device and align the written lyrics to the detected words. Clear solo vocals work best; singing can need timing corrections.',
            body:[app.dialogField('Vocal clip',source),app.dialogField('Lyrics track',track),app.dialogField('Language',language),app.dialogField('Speech model',model),
                el('p',{className:'hint',text:'The model downloads once. Your audio stays on this device. This creates a separate synced lyrics track and hides the original; Undo restores it.'})],
            onClose:()=>{closed=true;if(running)window.ReelCaptions.cancelTranscription();},
            actions:[{label:'Cancel',always:true},{label:'Sync automatically',primary:true,run:async d=>{
                const original=app.state.project,clip=T.getClip(original,source.value);
                const lines=original.clips.filter(c=>c.track===track.value&&c.type==='text').sort((a,b)=>a.start-b.start);
                if(!clip||!lines.length){d.status('Select a vocal clip and lyrics track.');return false;}
                if(clip.duration>300){d.status('Trim the vocal clip to five minutes or less, then sync.');return false;}
                d.busy(true);running=true;app.pause();
                try{
                    d.status('Preparing the vocal audio…');const isolated=T.clone(original);
                    isolated.clips.forEach(c=>{c.muted=c.id!==clip.id;if(c.id===clip.id)c.volume=c.volume||1;});
                    isolated.tracks.forEach(t=>{t.muted=false;t.duck=false;});
                    const samples=await window.ReelMix.renderMono16k(isolated,{from:clip.start,to:T.clipEnd(clip)});
                    if(closed)return false;if(!samples)throw new Error('No vocal audio was found.');
                    const downloads=new Map();
                    const out=await window.ReelCaptions.transcribe(samples,model.value,language.value,message=>{const text=window.ReelCaptions.progressText(message,downloads);if(text&&!closed)d.status(text);});
                    if(closed)return false;
                    const aligned=alignLyrics(lines.map(c=>c.text),out.chunks||[],clip.duration);
                    if(app.state.project!==original)throw new Error('The project changed while syncing. Please try again.');
                    let next=T.clone(original);const newId=T.nextTrackId(next,'text');next=T.addTrack(next,'text','Synced lyrics');next=T.updateTrack(next,track.value,{hidden:true});
                    aligned.cues.forEach((cue,i)=>{const c=Object.assign({},lines[i],{id:T.newId('c'),track:newId,start:clip.start+cue.start,duration:cue.end-cue.start,anim:'none',hand:'none',transition:null,
                        lyricStyle:'karaoke',lyricHighlight:lines[i].lyricHighlight||'#f2d27a',lyricWordTimes:cue.wordTimes,lyricSourceText:lines[i].text,fadeIn:0,fadeOut:.08});next=T.addClip(next,c);});
                    app.apply(next);app.seek(clip.start);app.zoomToFit();running=false;app.toast('Lyrics synced ('+Math.round(100*aligned.matched/aligned.total)+'% of words matched). Listen back and adjust any timing.');return true;
                }catch(e){if(!closed){d.status(e.message);d.busy(false);}return false;}finally{running=false;}
            }}]});
    }

    let dbPromise;
    function database(){
        if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
            if(!window.indexedDB){reject(new Error('This browser cannot save personal templates.'));return;}
            const r=indexedDB.open('reel-personal-templates',1);
            r.onupgradeneeded=()=>r.result.createObjectStore('templates',{keyPath:'id'});
            r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
        }).catch(e=>{dbPromise=null;throw e;});return dbPromise;
    }
    async function storeTemplate(action,value){
        const db=await database();return new Promise((resolve,reject)=>{
            const tx=db.transaction('templates',action==='getAll'?'readonly':'readwrite');const store=tx.objectStore('templates');const req=store[action](value);let result;
            req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||new Error('Could not save the template.'));tx.onabort=()=>reject(tx.error||new Error('Template save was cancelled.'));
        });
    }
    async function savePersonal(name){
        const p=T.clone(app.state.project);if(!p.clips.length)throw new Error('Add something to the timeline before saving a template.');
        const used=new Set(p.clips.map(c=>c.mediaId).filter(Boolean));p.media=p.media.filter(m=>used.has(m.id));
        const media=p.media.map(m=>{const file=app.files.get(m.id)?.file;if(!file)throw new Error('Relink '+m.name+' before saving the template.');return {id:m.id,file,name:file.name,type:file.type};});
        const bytes=media.reduce((s,m)=>s+m.file.size,0);if(bytes>150*1024*1024)throw new Error('This template is over 150 MB. Use shorter clips or remove large media first.');
        const id=T.newId('template');await storeTemplate('put',{id,name:name.trim()||p.name,project:p,media,bytes,saved:Date.now()});return id;
    }
    async function usePersonal(item){
        app.pause();const before=app.state.project,start=T.projectDuration(before),empty=!before.clips.length;
        try{
            const mediaMap=new Map();
            for(const m of item.media){const f=new File([m.file],m.name,{type:m.type});const ids=await app.importFiles([f],{noCommit:true,fresh:true});if(!ids.length)throw new Error('Could not restore '+m.name);mediaMap.set(m.id,ids[0]);}
            let p=T.clone(app.state.project);if(empty){p.width=item.project.width;p.height=item.project.height;p.fps=item.project.fps;p.background=item.project.background;p.name=item.name;}
            const trackMap=new Map();
            // addTrack inserts at the top; reverse preserves the saved layer order.
            item.project.tracks.slice().reverse().forEach(t=>{const id=T.nextTrackId(p,t.kind);p=T.addTrack(p,t.kind,t.name);p=T.updateTrack(p,id,Object.assign({},t,{id}));trackMap.set(t.id,id);});
            item.project.clips.forEach(c=>{const copy=Object.assign({},c,{id:T.newId('c'),track:trackMap.get(c.track),start:start+c.start});if(c.mediaId)copy.mediaId=mediaMap.get(c.mediaId);p=T.addClip(p,copy);});
            app.apply(p);app.seek(start);app.zoomToFit();app.toast('Your template was added. Every clip is editable.');
        }catch(e){app.state.project=before;app.afterChange();throw e;}
    }
    function openPersonal(){
        const name=el('input',{type:'text',value:app.state.project.name||'My template',maxlength:80});
        const list=el('div',{className:'personal-templates',role:'status',text:'Loading your templates…'});
        const save=button('Save current project as template',async()=>{
            save.disabled=true;try{await savePersonal(name.value);await refresh();app.toast('Template saved on this device.');}catch(e){d.status(e.name==='QuotaExceededError'?'There is not enough browser storage for this template.':e.message);}finally{save.disabled=false;}
        });
        let closed=false;
        const d=app.openDialog({title:'My templates',wide:true,intro:'Save your layout, titles, transitions and media together. Templates stay in this browser on this device; clearing site data removes them.',
            body:[app.dialogField('Template name',name),save,el('hr'),list],onClose:()=>{closed=true;},actions:[{label:'Close'}]});
        async function refresh(){
            try{const items=await storeTemplate('getAll');if(closed)return;list.textContent='';
                if(!items.length){list.textContent='No saved templates yet. Make a video you like, then save it here.';return;}
                items.sort((a,b)=>b.saved-a.saved).forEach(item=>{
                    const row=el('div',{className:'personal-template-row'},[el('div',null,[el('strong',{text:item.name}),el('p',{className:'hint',text:item.project.clips.length+' clips · '+app.fmt(T.projectDuration(item.project))+' · '+app.formatBytes(item.bytes)})])]);
                    const use=button('Use',async()=>{use.disabled=true;try{await usePersonal(item);d.close();}catch(e){d.status(e.message);use.disabled=false;}});
                    row.append(use,button('Delete',async()=>{if(!window.confirm('Delete the saved template “'+item.name+'”?'))return;try{await storeTemplate('delete',item.id);await refresh();}catch(e){d.status(e.message);}}));list.append(row);
                });
            }catch(e){if(!closed)list.textContent=e.message;}
        }refresh();
    }
    const bar=document.querySelector('.studio-bar');
    bar.append(button('Record voice',openRecorder,{id:'studio-record'}),button('Sync lyrics',openSync,{id:'studio-sync'}),button('My templates',openPersonal,{id:'studio-personal'}));
    app.addTool({section:'Create',label:'Record your voice…',run:openRecorder});app.addTool({section:'Create',label:'Sync lyrics to vocals…',run:openSync});app.addTool({section:'Create',label:'My templates…',run:openPersonal});
    window.ReelCreator={openRecorder,openSync,openPersonal,alignLyrics,savePersonal,usePersonal};
}());
