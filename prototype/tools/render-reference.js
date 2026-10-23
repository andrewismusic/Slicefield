// Renders scripted scenarios through the prototype engine and writes reference output for parity tests:
//   tools/out/<name>.wav          stereo 32-bit float WAV of the master output
//   tools/out/<name>.steps.json   every step decision per track: [t, track, src, slice(16ths), gate, fx keys]
//   tools/out/<name>.events.json  engine events (recorded steps, grid, songRow)
// Randomness comes from a seeded mulberry32, so runs are repeatable. If the native engine uses the
// same generator and draws numbers in the same order, its step log should match exactly; audio should
// match within a small tolerance (see HANDOFF.md, "Parity testing").
// The app runs one track; a scenario with several "loops" runs that many side by side.
// Usage: node tools/render-reference.js [scenario.json ...]   (default: every file in tools/scenarios)
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),src=f=>fs.readFileSync(path.join(root,'src',f),'utf8');
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
eval(src('engine.js')+src('synth.js')+';global.EFx=engineFactory;global.ML=synthFactory().makeLoop;');
function wav(L,R,sr){const n=L.length,b=Buffer.alloc(44+n*8);b.write('RIFF',0);b.writeUInt32LE(36+n*8,4);b.write('WAVE',8);b.write('fmt ',12);
  b.writeUInt32LE(16,16);b.writeUInt16LE(3,20);b.writeUInt16LE(2,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*8,28);b.writeUInt16LE(8,32);b.writeUInt16LE(32,34);
  b.write('data',36);b.writeUInt32LE(n*8,40);for(let i=0;i<n;i++){b.writeFloatLE(L[i],44+i*8);b.writeFloatLE(R[i],48+i*8);}return b;}
function runScenario(file){
  const sc=JSON.parse(fs.readFileSync(file,'utf8')),sr=sc.sr||48000,bpm=sc.bpm||124,BL=128;
  Math.random=mulberry32(sc.seed||1);
  const kinds=sc.loops||['break'],EF=EFx(),e=new EF.Engine(sr,kinds.length),events=[],stepsLog=[];
  e.post=m=>{if(m.type!=='status')events.push(Object.assign({t:e.t},m));};
  // log every step decision
  for(const tr of e.tracks){const d=tr.decide.bind(tr);tr.decide=(t,k)=>{d(t,k);const c=tr.cur;stepsLog.push([t,tr.i,c.src,+(c.a/e.u).toFixed(3),tr.gate?1:0,c.fx.map(x=>x.k).join('+')]);};}
  // the prototype's loop length rule: one bar at this tempo, rounded to 64 samples
  kinds.forEach((k,i)=>{const lp=ML(k,sr,bpm);e.msg({type:'load',tr:i,L:lp.L,R:lp.R});});
  // ORDER and SKIP may be given as a slider position {"v":0.3}; the pattern is worked out as the app does
  // shorthands: {"type":"loopBuf","key","kind"} renders a demo loop for the engine to hold; {"type":"cfgOpt",
  // "tr","k","o"} sends an effect's default settings with these options (e.g. tails: "cut")
  const short=m=>m.type==='loopBuf'&&m.kind?(lp=>({type:'loopBuf',key:m.key,L:lp.L,R:lp.R}))(ML(m.kind,sr,bpm)):
    m.type==='cfgOpt'?(c=>(Object.assign(c.o,m.o),{type:'cfg',tr:m.tr,cfg:{[m.k]:c}}))(EF.defCfg(m.k)):m;
  const pat0=m=>m.v===undefined?m:m.type==='order'?{type:'order',tr:m.tr,perm:EF.orderPattern(m.v,e.tracks[m.tr].n)}:m.type==='mute'?{type:'mute',tr:m.tr,bits:EF.skipPattern(m.v,e.tracks[m.tr].n)}:m;
  const pat=m=>pat0(short(m));
  const msgs=(sc.msgs||[]).map(x=>Object.assign({},x,{msg:pat(x.msg)})).sort((a,b)=>a.at-b.at);
  // "at" may be a sample index, or {bar, step} in sixteenths of the 1-bar loop
  const atS=a=>typeof a==='number'?a:Math.round(((a.bar||0)*16+(a.step||0))*e.len/16);
  const total=Math.ceil(atS(sc.length||{bar:8})/BL)*BL,L=new Float32Array(total),R=new Float32Array(total);
  let mi=0;const bl=new Float32Array(BL),br=new Float32Array(BL);
  for(let t=0;t<total;t+=BL){
    while(mi<msgs.length&&atS(msgs[mi].at)<=t)e.msg(msgs[mi++].msg);
    e.render(bl,br,BL);L.set(bl,t);R.set(br,t);
  }
  const out=path.join(__dirname,'out');fs.mkdirSync(out,{recursive:true});const nm=path.basename(file,'.json');
  fs.writeFileSync(path.join(out,nm+'.wav'),wav(L,R,sr));
  fs.writeFileSync(path.join(out,nm+'.steps.json'),JSON.stringify(stepsLog));
  fs.writeFileSync(path.join(out,nm+'.events.json'),JSON.stringify(events,(k,v)=>v instanceof Float32Array?Array.from(v):v));
  let pk=0;for(const v of L)pk=Math.max(pk,Math.abs(v));
  console.log(nm.padEnd(22),(total/sr).toFixed(2)+' s','steps',String(stepsLog.length).padStart(4),'events',String(events.length).padStart(3),'peak',pk.toFixed(3));
}
const args=process.argv.slice(2),dir=path.join(__dirname,'scenarios');
(args.length?args:fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>path.join(dir,f))).forEach(runScenario);
