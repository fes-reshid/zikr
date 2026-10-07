/* Templates, transition gallery and original nasheed lyric captions.
 * All generated titles remain editable; adding a scene is one undo step. */
(function () {
    'use strict';
    const app=window.ReelApp, T=app.T, el=app.el;
    const THEMES={
        emerald:{label:'Emerald',colors:['#092d28','#176454'],ink:'#fff9e9',accent:'#e6c77d'},
        paper:{label:'Warm paper',colors:['#faf7ed','#e9e2d0'],ink:'#283c35',accent:'#367866'},
        midnight:{label:'Midnight',colors:['#091b35','#2e456c'],ink:'#f8f6ec',accent:'#e8ca7c'},
        rose:{label:'Rose',colors:['#421f40','#914e63'],ink:'#fff2e9',accent:'#ffd3ab'},
        sky:{label:'Sky',colors:['#dcefeb','#b8ddd9'],ink:'#143c40',accent:'#ad7435'},
        sand:{label:'Desert sand',colors:['#f3e3c3','#d9b77e'],ink:'#3d2a12',accent:'#8a5a1c'},
        forest:{label:'Forest',colors:['#0f2a1d','#2f5d3a'],ink:'#f4f1e3',accent:'#c9d98a'},
        sunset:{label:'Sunset',colors:['#5a1f2b','#d9733f'],ink:'#fff4e6',accent:'#ffd27a'},
        ocean:{label:'Ocean',colors:['#06283d','#1a6e8e'],ink:'#eefaff',accent:'#7fe0d4'},
        charcoal:{label:'Charcoal & gold',colors:['#16161a','#34343c'],ink:'#f6f1e1',accent:'#d6b25e'},
        royal:{label:'Royal purple',colors:['#1f1235','#4b2a73'],ink:'#fbf4ff',accent:'#f0c674'},
        teal:{label:'Teal & coral',colors:['#063b3f','#0f7173'],ink:'#f2fffd',accent:'#ff9f80'}
    };
    const PACKS=[
        {id:'gratitude',name:'A grateful heart · English',theme:'emerald',lines:['With every dawn, a chance to grow','A kinder word, a seed to sow','Alhamdulillah, hearts awake','Let goodness guide each step we take']},
        {id:'kindness',name:'Little acts of kindness · English',theme:'sky',lines:['A little smile, a helping hand','Bring light and care across the land','We share, we learn, we try again','And ask Allah to guide us then']},
        {id:'light',name:'نور وخير · Arabic',theme:'midnight',lines:['يا رب نور دربنا','وازرع سلاماً بيننا','نمضي بخير كل يوم','والحمد يملأ قلبنا']},
        {id:'journey',name:'Steps of goodness · English',theme:'rose',lines:['Across the road, beneath the sky','We see the days go softly by','With thankful hearts and purpose clear','We choose the good, both far and near']}
    ];
    const TEMPLATES=[
        {id:'muhadara-gold',name:'Emerald Muhadara',tag:'GOLD COLLECTION',theme:'emerald',art:'emerald-arch',title:'Muhadara on Zoom',subtitle:'In English & Afaan Oromo',topic:'لِكُلِّ شَيْءٍ أَجْرٌ',speaker:'By Shekh Shamsuddin'},
        {id:'moonlight-talk',name:'Moonlight lecture',tag:'GOLD COLLECTION',theme:'midnight',art:'moonlit-mosque',title:'An evening of reflection',subtitle:'Learn • Reflect • Grow',topic:'Add your lecture topic',speaker:'Speaker: add a name'},
        {id:'ivory-class',name:'Ivory learning circle',tag:'GOLD COLLECTION',theme:'paper',art:'ivory-lanterns',title:'Islamic learning circle',subtitle:'A welcoming space to learn together',topic:'Add your class topic',speaker:'Teacher: add a name'},
        {id:'gold-eid',name:'Golden Eid invitation',tag:'CELEBRATION',theme:'emerald',art:'emerald-arch',title:'Eid Mubarak',subtitle:'Celebrate with family and friends',topic:'You are warmly invited',speaker:'Hosted by: add your organisation'},
        {id:'night-reminder',name:'Ramadan nights',tag:'RAMADAN',theme:'midnight',art:'moonlit-mosque',title:'Ramadan nights',subtitle:'Prayer • Reflection • Generosity',topic:'A moment for your heart',speaker:'Add your reminder or speaker'},
        {id:'ivory-event',name:'Community gathering',tag:'INVITATION',theme:'paper',art:'ivory-lanterns',title:'You are invited',subtitle:'Together in learning and kindness',topic:'Add your event name',speaker:'Hosted by: add your organisation'},
        {id:'ramadan',name:'Ramadan reflections',tag:'RAMADAN',theme:'midnight',title:'Ramadan Mubarak',subtitle:'A month of reflection, prayer and generosity',lines:['Make time for prayer and Qur’an','Share kindness with those around you'],motif:'crescent'},
        {id:'eid',name:'Eid greetings',tag:'EID',theme:'emerald',title:'Eid Mubarak',subtitle:'Wishing you and your family joy and peace',lines:['Celebrate with grateful hearts','Share the joy with family and neighbours'],motif:'sparkles'},
        {id:'class',name:'Islamic class invitation',tag:'ONLINE CLASS',theme:'paper',title:'Learn together. Grow together.',subtitle:'Add your course, teacher and registration details',lines:['Class time: add your day and time','Register: add your contact or website'],motif:'book'},
        {id:'lesson',name:'My Islamic lesson',tag:'LESSON INTRO',theme:'sky',title:'Bismillah — let’s begin',subtitle:'Add your lesson topic here',lines:['Today we will learn…','Think, practise and share what you learned'],hand:true,motif:'star'},
        {id:'whiteboard',name:'The whiteboard',tag:'HANDWRITING',theme:'paper',title:'Every good deed matters',subtitle:'A small lesson. A lasting difference.',lines:['Begin with a kind word','Follow it with a helping hand'],hand:true},
        {id:'reminder',name:'A moment to reflect',tag:'REMINDER',theme:'emerald',title:'Pause. Reflect. Be grateful.',subtitle:'Make room for what matters.',lines:['Notice the blessings around you','Share one kindness today']},
        {id:'lyrics',name:'Words from the heart',tag:'NASHEED LYRICS',theme:'midnight',title:'A grateful heart',subtitle:'Original words, ready for your voice.',lyrics:true},
        {id:'kids',name:'Little learners',tag:'LEARNING',theme:'sky',title:'Let’s learn something new!',subtitle:'Watch • Think • Try',lines:['What does kindness look like?','Try one kind action today']},
        {id:'event',name:'You are invited',tag:'ANNOUNCEMENT',theme:'rose',title:'A special gathering',subtitle:'Add your date, time and venue',lines:['Learn, connect and grow together','Everyone is welcome']},
        {id:'story',name:'One beautiful thought',tag:'SOCIAL STORY',theme:'emerald',title:'Small steps. Good intentions.',subtitle:'Your next chapter starts here.',lines:['Choose one meaningful goal','Take your first step today']},
        // More templates, each with its own entrance so they feel different.
        {id:'jumuah',name:'Jumu‘ah reminder',tag:'FRIDAY',theme:'forest',title:'Jumu‘ah Mubarak',subtitle:'A blessed Friday to you and your family',lines:['Make time for the Friday prayer','Remember those in need in your du‘a'],motif:'mosque',anim:'drop'},
        {id:'hajj',name:'Hajj & Umrah journey',tag:'HAJJ',theme:'sand',title:'The journey of a lifetime',subtitle:'Hajj & Umrah • add your group or dates',lines:['Prepare your heart before your bags','Add your talk, tips or itinerary'],motif:'kaaba',anim:'zoom-out'},
        {id:'hifz',name:'Qur’an memorisation class',tag:'HIFZ CLASS',theme:'emerald',title:'Join our hifz circle',subtitle:'Add the age group, days and time',lines:['Learn with patience and care','Register: add your contact details'],motif:'book',anim:'blur'},
        {id:'dua',name:'Du‘a of the day',tag:'DU‘A',theme:'midnight',title:'Du‘a of the day',subtitle:'Add the du‘a and where it is from',lines:['Add its meaning in your language','Share it with someone you love'],motif:'crescent',anim:'blur'},
        {id:'charity',name:'Charity appeal',tag:'SADAQAH',theme:'sunset',title:'Every gift makes a difference',subtitle:'Add your cause and how to give',lines:['Add what the donations will do','Give today: add your link or details'],motif:'heart',anim:'bounce'},
        {id:'nikah',name:'Nikah announcement',tag:'NIKAH',theme:'rose',title:'A blessed union',subtitle:'Add the names and the date',lines:['Your presence and du‘a are a gift','Venue: add the address and time'],motif:'flower',anim:'zoom-in'},
        {id:'aqiqah',name:'Welcome, little one',tag:'AQIQAH',theme:'sky',title:'Alhamdulillah, welcome!',subtitle:'Add the baby’s name and the date',lines:['Join us for the aqiqah','Add the time and place'],motif:'gift',anim:'pop'},
        {id:'quiz',name:'Quiz time',tag:'QUIZ',theme:'ocean',title:'Quiz time!',subtitle:'How much do you know?',lines:['Question 1: add your question','Answer: add the answer here'],motif:'check',anim:'spin'},
        {id:'countdown',name:'Ramadan countdown',tag:'COUNTDOWN',theme:'charcoal',title:'Ramadan is coming',subtitle:'Add how many days are left',lines:['Plan your goals for the month','Start your good habits today'],motif:'lantern',anim:'flip'},
        {id:'hadith-day',name:'Hadith of the day',tag:'HADITH',theme:'sand',title:'Hadith of the day',subtitle:'Add the hadith text and its source',lines:['Add a short explanation','How can we act on it today?'],motif:'rosette',anim:'slide-right'},
        {id:'seerah',name:'Seerah story',tag:'SEERAH',theme:'forest',title:'Stories from the Seerah',subtitle:'Add the title of today’s story',lines:['Add where and when it happened','What lesson can we take from it?'],motif:'palm',anim:'rise'},
        {id:'thanks',name:'Thanks for watching',tag:'END SCREEN',theme:'emerald',title:'Jazakum Allahu khayran',subtitle:'Thank you for watching',lines:['Like, share and subscribe','See you in the next video, in sha Allah'],motif:'sparkles',anim:'swing'},
        {id:'hijri',name:'Islamic New Year',tag:'HIJRI NEW YEAR',theme:'midnight',title:'A new Hijri year',subtitle:'Add the year, e.g. 1448 AH',lines:['A fresh page to grow closer to Allah','Add your goal for this year'],motif:'moonStar',anim:'zoom-out'},
        {id:'arafah',name:'Day of Arafah',tag:'ARAFAH',theme:'sand',title:'The Day of Arafah',subtitle:'Add the date',lines:['A day for du‘a and remembrance','Add your reminder here'],motif:'sunrise',anim:'rise'},
        {id:'adha',name:'Eid al-Adha',tag:'EID AL-ADHA',theme:'forest',title:'Eid al-Adha Mubarak',subtitle:'From our family to yours',lines:['Celebrate with gratitude','Remember those in need'],motif:'gift',anim:'pop'},
        {id:'last-ten',name:'The last ten nights',tag:'RAMADAN',theme:'charcoal',title:'The last ten nights',subtitle:'Seek Laylat al-Qadr',lines:['Add your plan for the nights','Pray, give and make du‘a'],motif:'lantern',anim:'blur'},
        {id:'morning',name:'Morning adhkar',tag:'ADHKAR',theme:'sky',title:'Start your morning with dhikr',subtitle:'Add the adhkar and their source',lines:['Add the words in Arabic','Add the meaning in your language'],motif:'sun',anim:'fade'},
        {id:'evening',name:'Evening adhkar',tag:'ADHKAR',theme:'royal',title:'Evening adhkar',subtitle:'Add the adhkar and their source',lines:['Add the words in Arabic','Add the meaning in your language'],motif:'moonStar',anim:'fade'},
        {id:'masjid-appeal',name:'Masjid building appeal',tag:'FUNDRAISER',theme:'teal',title:'Help build our masjid',subtitle:'Add your target and progress',lines:['Add what the masjid will offer','Donate: add your link or details'],motif:'minaret',anim:'drop'},
        {id:'new-muslim',name:'Welcome to Islam',tag:'NEW MUSLIM',theme:'emerald',title:'Welcome to the family',subtitle:'Add a warm welcome message',lines:['You are not alone on this journey','Add classes or contacts for support'],motif:'heart',anim:'zoom-in'},
        {id:'podcast',name:'Podcast episode',tag:'PODCAST',theme:'charcoal',title:'New episode',subtitle:'Add the episode title and guest',lines:['In this episode: add the topic','Listen now: add where to find it'],motif:'mic',anim:'slide-right'},
        {id:'announcements',name:'Weekly announcements',tag:'ANNOUNCEMENTS',theme:'ocean',title:'This week at our masjid',subtitle:'Add the dates',lines:['Add your first announcement','Add your second announcement'],motif:'bell',anim:'drop'},
        {id:'book-club',name:'Book club',tag:'BOOK CLUB',theme:'paper',title:'This month’s book',subtitle:'Add the title and author',lines:['Add why it is worth reading','Join us: add the meeting details'],motif:'book',anim:'flip'},
        {id:'sisters',name:'Sisters’ circle',tag:'SISTERS',theme:'rose',title:'Sisters’ circle',subtitle:'Add the topic, day and time',lines:['A warm space to learn together','Add the venue or online link'],motif:'flower',anim:'rise'},
        {id:'youth',name:'Youth halaqa',tag:'YOUTH',theme:'sunset',title:'Youth halaqa',subtitle:'Add the age group and time',lines:['Questions welcome!','Add the venue and how to join'],motif:'bulb',anim:'bounce'},
        {id:'tips',name:'Three quick tips',tag:'TIPS',theme:'sky',title:'3 quick tips',subtitle:'Add your topic',lines:['Tip 1: add your first tip','Tip 2 and 3: add the rest'],motif:'check',anim:'slide'},
        {id:'tea-talk',name:'Tea and talk',tag:'COMMUNITY',theme:'sand',title:'Tea & talk',subtitle:'Add the topic and speaker',lines:['Bring a friend, everyone welcome','Add the date, time and place'],motif:'tea',anim:'swing'},
        {id:'travel',name:'Travel diary',tag:'TRAVEL',theme:'ocean',title:'Our journey',subtitle:'Add where you went',lines:['Day 1: add the highlights','Add a lesson from the trip'],motif:'pin',anim:'zoom-out'},
        {id:'subscribe',name:'Subscribe reminder',tag:'CHANNEL',theme:'charcoal',title:'Enjoying the videos?',subtitle:'Add your channel name',lines:['Subscribe for more','Turn on the bell for new videos'],motif:'play',anim:'bounce'},
        {id:'winners',name:'Competition results',tag:'RESULTS',theme:'royal',title:'And the winners are…',subtitle:'Add the competition name',lines:['First place: add the name','Thank you to everyone who took part'],motif:'trophy',anim:'pop'}
    ];
    const TRANSITIONS={crossfade:'Crossfade',dip:'Dip to black',slide:'Slide in',push:'Push',wipe:'Wipe',zoom:'Zoom','slide-up':'Slide up','wipe-right':'Wipe from right',iris:'Circle reveal',blur:'Soft dissolve'};
    function select(options,value){return el('select',{value},options.map(([v,name])=>el('option',{value:v,selected:v===value,text:name})));}
    function button(text,run,attrs){return el('button',Object.assign({type:'button',text,onclick:run},attrs));}
    function field(label,input,hint){return app.dialogField(label,input,hint);}
    function number(value,min,max,step){return el('input',{type:'number',value,min,max,step:step||1});}
    function lastTrack(p,kind){return p.tracks.find(t=>t.kind===kind).id;}
    function newTrack(p,kind,name){const id=T.nextTrackId(p,kind);return {p:T.addTrack(p,kind,name),id};}
    function safeNumber(input,min,max,fallback){const n=Number(input.value);return Number.isFinite(n)&&n>=min&&n<=max?n:fallback;}

    function background(theme,width,height){
        const cv=el('canvas',{width,height}),c=cv.getContext('2d'),p=THEMES[theme]||THEMES.emerald;
        const g=c.createLinearGradient(0,0,width,height);g.addColorStop(0,p.colors[0]);g.addColorStop(1,p.colors[1]);c.fillStyle=g;c.fillRect(0,0,width,height);
        const unit=Math.min(width,height);
        c.strokeStyle=p.accent;c.lineWidth=Math.max(1,unit*.0015);c.globalAlpha=.22;
        for(let n=0;n<5;n++){
            c.beginPath();c.arc(width*.99,height*.02,unit*(.22+n*.13),0,Math.PI*2);c.stroke();
            c.beginPath();c.arc(0,height,unit*(.12+n*.09),0,Math.PI*2);c.stroke();
        }
        c.globalAlpha=.35;c.strokeRect(width*.045,height*.05,width*.91,height*.9);
        c.globalAlpha=1;
        return cv;
    }
    async function importBackground(theme,w,h){
        const cv=background(theme,w,h);
        const blob=await new Promise(resolve=>cv.toBlob(resolve,'image/png'));
        if(!blob) throw new Error('Could not create the background.');
        const ids=await app.importFiles([new File([blob],'Studio '+THEMES[theme].label+'.png',{type:'image/png'})],{noCommit:true,fresh:true});
        if(!ids.length) throw new Error('Could not open the background.');
        return ids[0];
    }
    function addTitle(p,track,start,text,patch){
        const c=Object.assign(T.textClip(track,start,text),{font:'marcellus',fontSize:52,bold:false,fadeIn:.25,fadeOut:.3,anim:'rise',animDuration:.7},patch);
        return T.addClip(p,c);
    }
    async function makeTemplate(id,options){
        const item=TEMPLATES.find(t=>t.id===id);if(!item) throw new Error('Unknown template');
        if(item.lyrics){openLyrics('gratitude');return;}
        if(item.art)return window.ReelGallery.makePoster(item,options);
        app.pause();
        const before=app.state.project;
        const size=options.size.split('x').map(Number),empty=!before.clips.length;
        // A template appends to an existing project, preserving its size and edits.
        const w=empty?size[0]:before.width,h=empty?size[1]:before.height,start=T.projectDuration(before);
        const mediaId=await importBackground(item.theme,w,h);
        let p=T.clone(app.state.project);
        if(empty){p.width=w;p.height=h;p.name=item.name;}
        const bgTrack=newTrack(p,'video',item.name+' · background');p=bgTrack.p;
        const titleTrack=newTrack(p,'text',item.name+' · titles');p=titleTrack.p;
        const detailTrack=newTrack(p,'text',item.name+' · details');p=detailTrack.p;
        const palette=THEMES[item.theme], scene=6,portrait=h>w;
        const texts=[options.title.trim()||item.title,...item.lines];
        texts.forEach((text,i)=>{
            const at=start+i*scene;
            const bg=Object.assign(T.clipFromMedia(T.getMedia(p,mediaId),bgTrack.id,at),{duration:scene,fit:'cover',transition:i?{type:'crossfade',duration:.8}:null});
            p=T.addClip(p,bg);
            p=addTitle(p,titleTrack.id,at,text,{duration:scene,y:.44,fontSize:portrait?34:58,color:palette.ink,shadow:false,
                font:T.isArabic(text)?'amiri':item.hand?'hand':'marcellus',anim:item.hand?'handwrite':(item.anim||'rise'),hand:item.hand?'pen':'none',handStyle:'realistic',writeDuration:4.4,handSize:1});
            p=addTitle(p,detailTrack.id,at,i===0?(options.subtitle.trim()||item.subtitle):['','One small action can make a difference.','Create something worth sharing.'][i],
                {duration:scene,y:.69,font:'sans',fontSize:portrait?14:23,color:palette.ink,shadow:false,anim:'fade',opacity:.85});
        });
        if(item.motif){const st=newTrack(p,'text','Template decoration');p=st.p;const deco=Object.assign(T.drawClip(st.id,start,[]),{duration:scene*texts.length,anim:'none',hand:'none',x:.5,y:.17,scale:.55,sticker:{kind:item.motif,motion:'float',color:palette.accent,rotation:0}});p=T.addClip(p,deco);}
        app.apply(p);app.seek(start+1.3);app.zoomToFit();
        const first=p.clips.find(c=>c.track===titleTrack.id);app.selectOnly(first.id);
        app.toast('Template added. Select any title to edit it. Undo removes the whole template.');
    }
    function openTemplates(){
        app.pause();let chosen=TEMPLATES[0];
        const grid=el('div',{className:'studio-grid'}),preview=el('div',{className:'studio-template-detail'});
        const title=el('input',{type:'text',value:chosen.title,maxlength:160}),subtitle=el('input',{type:'text',value:chosen.subtitle,maxlength:200});
        const size=select([['1080x1350','Portrait poster · 4:5'],['1280x720','Landscape · 16:9'],['1080x1920','Portrait · 9:16'],['1080x1080','Square · 1:1']],'1080x1350');
        const topic=el('input',{value:chosen.topic||'',dir:'auto',maxlength:160}),speaker=el('input',{value:chosen.speaker||'',maxlength:120}),date=el('input',{value:'Add your date • Add your time',maxlength:120}),venue=el('input',{value:'Join us on Zoom • Add meeting ID',maxlength:160});
        const posterFields=el('div',{},[field('Topic / Arabic heading',topic),field('Speaker / host',speaker),field('Date and time',date),field('Venue / Zoom details',venue)]);
        const cards=[];
        TEMPLATES.forEach(item=>{
            const image=background(item.theme,320,180),c=image.getContext('2d'),theme=THEMES[item.theme];
            c.textAlign='center';c.fillStyle=theme.ink;c.font='23px Georgia';
            const words=item.name.split(' '),half=Math.ceil(words.length/2);
            c.fillText(words.slice(0,half).join(' '),160,83);c.fillText(words.slice(half).join(' '),160,111);
            const card=button('',()=>{chosen=item;title.value=item.title;subtitle.value=item.subtitle;topic.value=item.topic||'';speaker.value=item.speaker||'';posterFields.hidden=!item.art;cards.forEach(b=>b.setAttribute('aria-pressed',String(b===card)));preview.hidden=!!item.lyrics;},
                {className:'studio-card','aria-label':item.name,'aria-pressed':String(item===chosen)});
            card.append(item.art?el('img',{src:'assets/'+item.art+'.webp',alt:item.name,loading:'lazy',style:{width:'100%',height:'150px',objectFit:'cover',objectPosition:'center 25%'}}):image,el('span',{className:'studio-tag',text:item.tag}),el('strong',{text:item.name}));cards.push(card);grid.append(card);
        });
        posterFields.hidden=!chosen.art;
        preview.append(field('Opening title',title),field('Subtitle',subtitle),posterFields,field('Format',size,app.state.project.clips.length?'Uses your current project’s frame size and adds scenes at the end.':'Choose the shape of your new video.'));
        app.openDialog({title:'Start with a template',wide:true,intro:'A little inspiration, ready to make your own. Every title, scene and transition stays editable.',
            body:[grid,preview],actions:[{label:'Cancel'},{label:'Use template',primary:true,run:async d=>{
                if(chosen.lyrics){d.close();openLyrics('gratitude');return false;}
                const before=app.state.project;
                d.busy(true);d.status('Creating your scenes…');
                try{await makeTemplate(chosen.id,{title:title.value,subtitle:subtitle.value,size:size.value,topic:topic.value,speaker:speaker.value,date:date.value,venue:venue.value});return true;}
                catch(e){app.state.project=before;app.afterChange();d.status(e.message);d.busy(false);return false;}
            }}]});
    }
    function openLyrics(packId){
        app.pause();const initial=PACKS.find(p=>p.id===packId)||PACKS[0];
        const pack=select(PACKS.map(p=>[p.id,p.name]).concat([['custom','Write my own lyrics']]),initial.id);
        const words=el('textarea',{rows:7,dir:'auto','aria-label':'Nasheed lyrics',className:'studio-lyrics',maxlength:6000});words.value=initial.lines.join('\n');
        const theme=select(Object.entries(THEMES).map(([id,t])=>[id,t.label]),initial.theme);
        const pace=number(4,1,20,.5),style=select([['karaoke','Word highlight'],['plain','Gentle fade'],['handwrite','Realistic handwriting']],'karaoke');
        const size=select([['1280x720','Landscape · 16:9'],['1080x1920','Portrait · 9:16'],['1080x1080','Square · 1:1']],'1080x1920');
        const audio=el('input',{type:'file',accept:'audio/*','aria-label':'Vocal audio file'});
        const audioPick=select([['','No existing audio']].concat(app.state.project.media.filter(m=>m.type==='audio').map(m=>[m.id,m.name])),'');
        const fit=el('input',{type:'checkbox',checked:true});
        const withBackground=el('input',{type:'checkbox',checked:true});
        pack.addEventListener('change',()=>{const p=PACKS.find(p=>p.id===pack.value);words.value=p?p.lines.join('\n'):'';if(p)theme.value=p.theme;});
        app.openDialog({title:'Nasheed lyrics',wide:true,intro:'Original verses for your videos. Edit them freely or write your own. These are lyric captions; add a vocal recording if you want sound.',
            body:[field('Verse collection',pack),words,el('p',{className:'hint',text:'One line per scene. Arabic is displayed right to left. Word timing is evenly spaced; adjust each clip to match your singing.'}),
                el('div',{className:'dialog-grid'},[field('Caption style',style),field('Seconds per line',pace),field('Colour theme',theme),field('Format',size)]),
                el('label',{className:'check'},[withBackground,'Add a matching background']),
                field('Upload vocals',audio),field('Or use imported audio',audioPick),el('label',{className:'check'},[fit,'Fit all lines to the audio length']),
                el('p',{className:'hint',text:'Your recording stays on your device. Lyrics are original creative writing, not Qur’an or hadith.'})],
            actions:[{label:'Cancel'},{label:'Add lyric video',primary:true,run:async d=>{
                const lines=words.value.split(/\n/).map(s=>s.trim()).filter(Boolean);
                if(!lines.length||lines.length>60){d.status('Enter between 1 and 60 lines.');return false;}
                if(!lines.every(s=>s.length<=180)){d.status('Keep each line under 180 characters so it stays readable.');return false;}
                const seconds=safeNumber(pace,1,20,null);if(!seconds){d.status('Choose 1–20 seconds per line.');return false;}
                const savedProject=app.state.project;
                d.busy(true);d.status('Preparing your lyric video…');
                try{
                    const before=app.state.project,start=T.projectDuration(before),empty=!before.clips.length,dimensions=size.value.split('x').map(Number);
                    const w=empty?dimensions[0]:before.width,h=empty?dimensions[1]:before.height;
                    let audioId=audioPick.value;
                    if(audio.files[0]){const ids=await app.importFiles([audio.files[0]],{noCommit:true});if(!ids.length)throw new Error('This audio file could not be opened.');audioId=ids[0];}
                    const media=audioId?T.getMedia(app.state.project,audioId):null;
                    const per=media&&fit.checked?media.duration/lines.length:seconds;
                    if(per<.5)throw new Error('The recording is too short for these lines. Use fewer lines or turn off Fit to audio.');
                    const bgId=withBackground.checked?await importBackground(theme.value,w,h):null;
                    let p=T.clone(app.state.project);if(empty){p.width=w;p.height=h;p.name='Nasheed · '+(PACKS.find(x=>x.id===pack.value)?.name||'My lyrics');}
                    const track=newTrack(p,'text','Nasheed lyrics');p=track.p;
                    if(bgId){const bt=newTrack(p,'video','Lyrics background');p=bt.p;p=T.addClip(p,Object.assign(T.clipFromMedia(T.getMedia(p,bgId),bt.id,start),{duration:per*lines.length,fit:'cover'}));}
                    const palette=THEMES[theme.value];
                    lines.forEach((line,i)=>{p=addTitle(p,track.id,start+i*per,line,{duration:per,font:T.isArabic(line)?'amiri':style.value==='handwrite'?'hand':'marcellus',fontSize:h>w?28:54,
                        y:.5,color:palette.ink,lyricStyle:style.value==='karaoke'?'karaoke':'plain',lyricHighlight:palette.accent,
                        anim:style.value==='handwrite'?'handwrite':'fade',hand:style.value==='handwrite'?'pen':'none',handStyle:'realistic',writeDuration:per*.72,
                        box:!withBackground.checked,boxColor:'#15221e',shadow:false,fadeIn:.15,fadeOut:.15});});
                    if(media){const at=newTrack(p,'audio','Nasheed vocals');p=at.p;p=T.addClip(p,T.clipFromMedia(media,at.id,start));}
                    app.apply(p);app.seek(start+Math.min(1,per*.25));app.zoomToFit();app.selectOnly(p.clips.find(c=>c.track===track.id).id);
                    app.toast(media?'Lyrics and vocals added. Adjust each line’s timing to match your voice.':'Lyric captions added. Import a vocal recording whenever you’re ready.');
                    return true;
                }catch(e){app.state.project=savedProject;app.afterChange();d.status(e.message);d.busy(false);return false;}
            }}]});
    }
    function paintTransition(cv,type,progress){
        const c=cv.getContext('2d'),W=cv.width,H=cv.height,mix=T.transitionMix(type,progress);
        c.fillStyle='#09131b';c.fillRect(0,0,W,H);
        ['from','to'].forEach(role=>{
            c.save();c.globalAlpha=mix[role];app.applyTransition(c,{type,role,progress},W,H);
            const g=c.createLinearGradient(0,0,W,H);g.addColorStop(0,role==='from'?'#1c735f':'#9e5f3b');g.addColorStop(1,role==='from'?'#0b2a2b':'#e5bd78');c.fillStyle=g;c.fillRect(0,0,W,H);
            c.strokeStyle='rgba(255,255,255,.3)';c.lineWidth=2;c.strokeRect(12,12,W-24,H-24);
            c.fillStyle='#fff';c.font='32px Georgia';c.textAlign='center';c.fillText(role==='from'?'A':'B',W/2,H/2+10);c.restore();
        });
    }
    function openTransitions(){
        app.pause();let selected='crossfade',alive=true,raf=0;
        const grid=el('div',{className:'studio-grid transitions'}),canvases=[],buttons=[];
        Object.entries(TRANSITIONS).forEach(([id,label])=>{
            const cv=el('canvas',{width:240,height:132});canvases.push([cv,id]);
            const b=button('',()=>{selected=id;buttons.forEach(([b,k])=>b.setAttribute('aria-pressed',String(k===id)));},{className:'studio-card','aria-label':label,'aria-pressed':String(id===selected)});
            b.append(cv,el('strong',{text:label}));grid.append(b);buttons.push([b,id]);
        });
        const length=number(.8,.2,3,.1),target=select([['selected','Before the selected clip'],['all','Every cut on visual tracks']],'selected');
        const clip=T.getClip(app.state.project,app.state.selected);
        const applicable=clip&&T.previousAdjacent(app.state.project,clip);
        if(!applicable)target.value='all';
        const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        function frame(now){if(!alive)return;const progress=reduce?.5:Math.max(0,Math.min(1,(now%2600-400)/1800));canvases.forEach(([cv,id])=>paintTransition(cv,id,progress));if(!reduce)raf=requestAnimationFrame(frame);}
        const d=app.openDialog({title:'Transitions',wide:true,intro:'Preview the move, choose its length, then apply it to touching clips.',body:[grid,
            el('div',{className:'dialog-grid'},[field('Apply to',target),field('Duration (s)',length)]),
            el('p',{className:'hint',text:'Clips must touch on the same track. Drag a clip until its edge snaps to the previous clip. Gaps are left unchanged.'})],
            onClose:()=>{alive=false;cancelAnimationFrame(raf);},actions:[{label:'Cancel'},{label:'Apply transition',primary:true,run:d=>{
                const duration=safeNumber(length,.2,3,null);if(!duration){d.status('Choose a duration between 0.2 and 3 seconds.');return false;}
                let p=app.state.project,count=0;
                if(target.value==='selected'){
                    const c=T.getClip(p,app.state.selected);
                    if(!c||!T.previousAdjacent(p,c)){d.status('Select a clip with another clip touching its start on the same track.');return false;}
                    if(T.clipKind(p,c)==='audio'){d.status('Select a title, image or video clip for a visual transition.');return false;}
                    p=T.setTransition(p,c.id,selected,duration);count=1;
                }else{
                    p.clips.forEach(c=>{if(T.clipKind(p,c)!=='audio'&&T.previousAdjacent(p,c)){p=T.setTransition(p,c.id,selected,duration);count++;}});
                }
                if(!count){d.status('There are no touching clips yet. Add two clips to the same track and snap their edges together.');return false;}
                app.apply(p);app.toast(TRANSITIONS[selected]+' added to '+count+(count===1?' cut.':' cuts.'));return true;
            }}]});
        raf=requestAnimationFrame(frame);return d;
    }
    const bar=el('div',{className:'studio-bar','aria-label':'Creative tools'},[
        el('span',{className:'studio-label',text:'CREATE'}),
        button('Templates',openTemplates,{id:'studio-templates'}),
        button('Transitions',openTransitions,{id:'studio-transitions'}),
        button('Nasheed lyrics',()=>openLyrics(),{id:'studio-lyrics'}),
        button('Handwriting',()=>document.getElementById('add-handwrite').click(),{id:'studio-handwriting'})
    ]);
    document.querySelector('.viewer').prepend(bar);
    app.addTool({section:'Create',label:'Templates…',run:openTemplates});
    app.addTool({section:'Create',label:'Nasheed lyrics…',run:()=>openLyrics()});
    app.addTool({section:'Timeline',label:'Transition gallery…',run:openTransitions});
    const hint=document.getElementById('stage-hint');
    hint.textContent='Your next video starts here. Import clips, or choose a template above.';
    window.ReelStudio={openTemplates,openLyrics,openTransitions,makeTemplate,TEMPLATES,PACKS,paintTransition,background,importBackground};
}());
