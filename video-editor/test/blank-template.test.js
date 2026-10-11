const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const T = require('../timeline.js');
function setup() {
    const app={T, el(){return {};}, addTool(){}, pause(){}, seek(){}, zoomToFit(){}, selectOnly(id){this.selected=id;}, toast(){},
        state:{project:T.createProject()}, apply(p){this.state.project=p;},
        async importFiles(){const id='image-'+this.state.project.media.length;this.state.project.media.push({id,type:'image',width:1024,height:1536,name:'Blank poster'});return [id];}};
    const window={ReelApp:app};
    vm.runInNewContext(fs.readFileSync(require.resolve('../art-gallery.js'),'utf8'), {window,document:{querySelector(){return {append(){}};}},fetch:async()=>new Response(new Blob(['image'],{type:'image/webp'})),File});
    return {app,gallery:window.ReelGallery};
}
const item={name:'Blank fundraiser',art:'blank-community-fundraiser',theme:'paper',blank:true};
test('blank template adds one full poster with no writing or placeholder text',async()=>{
    const {app,gallery}=setup();
    await gallery.makePoster(item,{size:'1080x1620',title:'',subtitle:''});
    const p=app.state.project;
    assert.equal(p.width,1080);assert.equal(p.height,1620);
    assert.equal(p.clips.length,1);assert.equal(p.clips[0].type,'media');
    assert.equal(p.clips[0].fit,'contain');assert.equal(p.clips[0].duration,15);
    assert.ok(app.selected);
});
test('optional text stays editable and adding a template preserves the existing project',async()=>{
    const {app,gallery}=setup();
    app.state.project=T.addClip(app.state.project,Object.assign(T.textClip('T1',0,'My existing title'),{duration:4}));
    await gallery.makePoster(item,{size:'1080x1620',title:'Community event',subtitle:''});
    const p=app.state.project;
    assert.equal(p.width,1280);assert.equal(p.height,720);
    assert.ok(p.clips.some(c=>c.text==='My existing title'));
    const title=p.clips.find(c=>c.text==='Community event');
    assert.equal(title.type,'text');assert.equal(title.start,4);
    assert.equal(p.clips.filter(c=>c.type==='text').length,2);
});
