// The interface. Runs as the Slicefield constructor: everything it keeps is local to this instance, and it
// draws into the host element's shadow root.
function slicefieldUI(hostEl,engineFactory,synth,markup){
  const EF=engineFactory(),FX=EF.FX,{makeLoop,resample,stretch2}=synth;
  const root=hostEl.attachShadow({mode:'open'});root.innerHTML=markup;this.root=root;
  const FONT='"Martian Mono", ui-monospace, Menlo, monospace';
  const ALL_FX=['stutter','random','pitch','reverse','env','freeze','crush','delay','reverb'];
  const HUES=[8,24,44,90,138,166,190,214,262,318,340];
  const TRACK_HUES=[40];
  const LOOP_NAMES={break:'Breakbeat',boombap:'Boom bap',acid:'Acid bass',reese:'Reese bass',dub:'Dub stabs',lead:'Synth lead',keys:'Electric piano',kalimba:'Kalimba',vox:'Vocal chops',};
  const BAND_LO=0.42,BAND_HI=0.58,STRIP=28,HW=30,LROW=36,LLAB=34,LROT=30;   // LROT: the lane's rotate column
  const $=id=>root.getElementById(id);
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const canvas=$('grid'),wrap=$('gridwrap'),laneCv=$('lane'),laneG=laneCv.getContext('2d'),gridG=canvas.getContext('2d');
  let g=gridG,LW=300,laneDpr=1;
  const ACC='#ffc65c',ACCRGB='255,198,92';const ACCA=a=>'rgba('+ACCRGB+','+a+')';
  const BG='#111317';
  const playBtn=$('play'),bpmEl=$('bpm'),swingEl=$('swing'),expBtn=$('export'),modeBtn=$('recmode'),fxoBtn=$('fxonly'),clearBtn=$('clear'),steppedBtn=$('stepped'),diceEl=$('dice'),dieEl=$('die'),diceVal=$('diceval'),prefsBtn=$('prefs'),sessBtn=$('sessbtn'),recBtn=$('rec'),capBtn=$('capture'),loadBtn=$('loadclip'),projBtn=$('project'),projIn=$('projfile'),fieldBtn=$('fieldbtn'),gameBtn=$('gamebtn');
  const soundSel=$('sound'),fileIn=$('file'),sheet=$('sheet'),card=$('card');
  const sessEl=$('session'),takeList=$('takelist'),sessScroll=$('sessScroll'),ghost=$('ghost'),fieldBar=$('fieldbar');

  // ---------- state ----------
  function defCfg(){
    const c=EF.allCfg();for(const k in c)c[k].hue=FX[k].hue;
    return c;
  }
  // ---------- fields ----------
  // A field is a layout of effect cells plus the effects' settings: {id, name, cells:[{k, y, h}], cfg}.
  // Cells are full-width bands on a grid FG units tall; they may overlap, and a touch where they do drives
  // each of them by its place inside that cell. Top to bottom is the signal order (Delay and Reverb, being
  // sends, always come after the step). 'center' is the loop row: high-pass above, dry in the middle,
  // low-pass below. Each effect has at most one cell. Clips keep a copy of the field they were captured on.
  const FG=48;
  const PRESETS={
    all:{name:'All effects',cells:[['stutter',0,3],['random',3,3],['pitch',6,10],['center',16,14],['reverse',30,3],['env',33,3],['freeze',36,3],['crush',39,3],['delay',42,3],['reverb',45,3]]},
    dub:{name:'Dub',cells:[['stutter',0,6],['delay',6,12],['reverb',12,12],['center',24,16],['env',40,8]],set:{delay:{x:{fb:0.7}},reverb:{x:{size:0.7},o:{tails:'ring'}}}},
    glitch:{name:'Glitch',cells:[['stutter',0,10],['random',8,8],['reverse',16,6],['crush',20,12],['center',32,16]]},
    pitch:{name:'Pitch play',cells:[['pitch',0,18],['delay',14,8],['freeze',22,10],['center',32,16]]},
  };
  let fieldCtr=0;
  const newFieldId=()=>'f'+(++fieldCtr)+Math.random().toString(36).slice(2,5);
  function presetField(key){
    const P=PRESETS[key],cfg=defCfg();
    for(const k in P.set||{}){const q=P.set[k];Object.assign(cfg[k].x,q.x||{});Object.assign(cfg[k].o,q.o||{});}
    return {id:newFieldId(),name:P.name,cells:P.cells.map(([k,y,h])=>({k,y,h})),cfg};
  }
  const cloneCfg=c=>{const o={};for(const k in c){const x=c[k];o[k]={cells:x.cells.slice(),lo:Object.assign({},x.lo),hi:Object.assign({},x.hi),x:Object.assign({},x.x),o:Object.assign({},x.o,x.o.mask?{mask:x.o.mask.slice()}:{}),hue:x.hue};}return o;};
  const cloneField=f=>({id:f.id,name:f.name,cells:f.cells.map(c=>Object.assign({},c)),cfg:cloneCfg(f.cfg)});
  const fxKey=k=>k==='center'?'filter':k;
  // top to bottom (cells starting at the same place keep their order)
  const sortedCells=f=>f.cells.map((c,i)=>({c,i})).sort((a,b)=>a.c.y-b.c.y||a.i-b.i).map(x=>x.c);
  const fieldOrder=f=>sortedCells(f).map(c=>fxKey(c.k));
  const fieldHas=(f,k)=>f.cells.some(c=>fxKey(c.k)===k);
  const sameField=(a,b)=>!!a&&!!b&&JSON.stringify([a.cells,a.cfg])===JSON.stringify([b.cells,b.cfg]);
  // A random field: the loop row (at least 12 units, so its dry middle is easy to find), 3 to 6 other
  // effects, every cell at least 3 units (5 for pitch and freeze), the whole height covered, and up to two
  // overlaps, never more than two cells deep.
  function randomField(){
    const R=Math.random,pool=ALL_FX.slice().sort(()=>R()-0.5),n=3+Math.floor(R()*4),ks=pool.slice(0,n);
    const list=ks.concat('center').sort(()=>R()-0.5),min=k=>k==='center'?12:k==='pitch'||k==='freeze'?5:3;
    let left=FG-list.reduce((s,k)=>s+min(k),0);const h=list.map(min);
    while(left>0){h[Math.floor(R()*h.length)]++;left--;}
    let y=0;const cells=list.map((k,i)=>{const c={k,y,h:h[i]};y+=h[i];return c;});
    // overlaps: a cell grows into its lower neighbour's top (only where nothing else reaches)
    const deep=()=>{for(let u=0;u<FG;u++)if(cells.filter(c=>u>=c.y&&u<c.y+c.h).length>2)return true;return false;};
    for(let o=0,tries=0;o<1+Math.floor(R()*2)&&tries<12;tries++){
      const i=Math.floor(R()*(cells.length-1)),a=cells[i],b=cells[i+1],d=2+Math.floor(R()*Math.max(1,b.h/2-1));
      a.h+=d;if(deep()||a.y+a.h>FG){a.h-=d;continue;}o++;}
    const names=['Spiral','Drift','Shard','Bloom','Tangle','Rift','Echo','Static','Pulse','Haze'];
    return {id:newFieldId(),name:names[Math.floor(R()*names.length)]+' '+(10+Math.floor(R()*90)),cells,cfg:defCfg()};
  }
  // One channel: a single track (the engine could run more side by side, the app uses one).
  // seq: the sequence on the main page (there always is one: a blank one plays the loop's slices in order).
  // loopSet: strips for when no sequence is given (export of the plain loop).
  // kind: the loop playing, a demo loop's name or 'f:<id>' for an imported file (see files).
  // silPat: the second strip's mode, SKIP ('mute') or GAP ('insert'), kept with the sequence.
  // field: the field on the main page (one of the project's fields); cfg is its effect settings.
  const newTrack=(i,kind,field)=>{const t={i,kind,cols:16,len16:16,field,loopSet:{orderV:1,muteV:1,silPat:'mute'},seq:null,buf:null,pk:null};
    Object.defineProperty(t,'cfg',{get(){return t.field.cfg;}});return t;};
  let fields=[presetField('all')];
  const tracks=[newTrack(0,'break',fields[0])];
  let view=0;
  // touchWin: touches play through SKIP.
  // fit: how imported audio is fitted to the bar ('stretch' keeps its pitch, 'resample' does not)
  const PREF0={grace:40,touchWin:true,fit:'stretch'};
  const prefs=Object.assign({},PREF0);
  // Strips: the stored value belongs to the sequence (or the plain loop). With the pin on, moving a strip
  // changes the stored value. With it off, the move is live only and the strip snaps back on release.
  const PIN0={order:true,mute:false};const pin=Object.assign({},PIN0);
  const liveV={order:null,mute:null};
  const ctxSet=t=>t.seq||t.loopSet;
  const oS=t=>ctxSet(t).orderV, mS=t=>ctxSet(t).muteV;   // stored
  const oV=t=>liveV.order!=null?liveV.order:oS(t), mV=t=>liveV.mute!=null?liveV.mute:mS(t);   // heard
  const silOf=t=>ctxSet(t).silPat||'mute';
  // imported audio, by id: {id, name, L, R} at the file's own rate and level
  const files=new Map();
  const loopName=k=>k&&k.startsWith('f:')?(files.get(k.slice(2))||{}).name||'Your file':LOOP_NAMES[k]||k;
  // page: 'field' or 'clips' (sessOn: the Clips page is showing); projects are a sheet
  let bpm=124,swing=0,stepped=true,sessOn=false,projOn=false,page='field',playMode='replace',fxOnly=false;
  // Clips: sequences saved with Capture, in list order. While any exist, one is selected.
  // songPlaying: a clip is playing from the Clips page (songList: just that clip; it loops).
  // recOn: Record is on, so touches are written into the sequence (recBn: the bar of the last write).
  let clips=[],clipNum=0,selClip=null,songPlaying=false,songList=[],recOn=false,recBn=-1;
  let st={playing:false,t:0,len:1,tracks:[],hist:[],song:null,recv:0};
  let fieldEdit=false;   // the field editor is open (see setFieldEdit)
  const ptrs=new Map();let orderCtr=0,tsCtr=0,idCtr=0;
  let cssW=300,cssH=400,dpr=1,lay=[],laneRows=1,TOP=100;
  let lanePage=0,laneFollow=true;
  const T=()=>tracks[view];
  const info=i=>(st.tracks&&st.tracks[i])||{};
  const barSteps=t=>t.len16*t.cols/16;

  // ---------- audio ----------
  let actx=null,send=null,ready=null,sr=48000,unlocked=false,gotStatus=false,usingFallback=false,workletNode=null,spKeep=null,intent=null,gen=0,mediaEl=null,heardHint=false;
  const isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  // A looping, silent media element moves iOS into its playback audio session, so Web Audio is heard
  // even when the phone is in Silent Mode.
  function silentWav(){
    const n=800,b=new Uint8Array(44+n*2),v=new DataView(b.buffer),w=(o,s)=>{for(let i=0;i<s.length;i++)b[o+i]=s.charCodeAt(i);};
    w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
    let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return 'data:audio/wav;base64,'+btoa(s);
  }
  function mediaUnlock(){
    if(!isIOS)return;
    try{
      if(!mediaEl){mediaEl=document.createElement('audio');mediaEl.src=silentWav();mediaEl.loop=true;mediaEl.setAttribute('playsinline','');mediaEl.setAttribute('x-webkit-airplay','deny');mediaEl.preload='auto';}
      if(mediaEl.paused){const p=mediaEl.play();if(p&&p.catch)p.catch(()=>{});}
    }catch(_){}
  }
  function ensureCtx(){
    if(actx)return;
    const AC=window.AudioContext||window.webkitAudioContext;
    try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch(_){}
    try{actx=new AC({latencyHint:'interactive'});}catch(_){actx=new AC();}
    sr=actx.sampleRate;
  }
  function unlock(e){
    ensureCtx();mediaUnlock();
    // WebKit only counts some events as a user gesture, so keep trying on each one until audio runs.
    if(actx.state!=='running'){
      try{const r=actx.resume();if(r&&r.then)r.then(()=>tx(prefMsg()),()=>{});if(r&&r.catch)r.catch(()=>{});}catch(_){}
      try{const b=actx.createBuffer(1,1,actx.sampleRate),s=actx.createBufferSource();s.buffer=b;s.connect(actx.destination);s.start(0);}catch(_){}
    }
  }
  ['pointerdown','pointerup','touchstart','touchend','mousedown','click','keydown'].forEach(ev=>window.addEventListener(ev,unlock,{capture:true,passive:true}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&actx&&actx.state!=='running'){try{actx.resume();}catch(_){}}});
  const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
  function onEngine(m){
    if(m.type==='status')onStatus(m);
    else if(m.type==='clipStep')onClipStep(m);
    else if(m.type==='songRow')onSongRow(m);
    else if(m.type==='songEnd')songEnded();
    else if(m.type==='grabbed')onGrabbed(m);
    else if(m.type==='grid'){
      const t=tracks[m.tr],old=t.cols;t.cols=m.n;t.colsQ=0;
      for(const p of ptrs.values())if(p.tr===m.tr&&p.col>=0)p.col=Math.min(m.n-1,Math.floor(p.col*m.n/old));
      if(m.tr===view)computeLayout();
    }
  }
  function connectOut(node){node.connect(actx.destination);}
  function useFallback(){
    if(usingFallback)return;usingFallback=true;
    // retire the worklet completely so only one engine ever talks to the UI
    if(workletNode){try{workletNode.port.postMessage({type:'stop'});workletNode.port.onmessage=null;workletNode.disconnect();}catch(_){}workletNode=null;}
    const myGen=gen,e=new EF.Engine(sr);e.post=m=>{if(myGen===gen)onEngine(m);};
    const sp=actx.createScriptProcessor(2048,0,2);
    sp.onaudioprocess=ev=>{const b=ev.outputBuffer;e.render(b.getChannelData(0),b.getChannelData(1),b.length);};
    const own=m=>m.clip||m.rows?JSON.parse(JSON.stringify(m)):m;   // its own copies, as the worklet gets
    connectOut(sp);spKeep=sp;send=m=>e.msg(own(m));
    syncAll();
    if(st.playing||intent)send({type:'play'});
  }
  function initAudio(){
    unlock();
    if(ready)return ready;
    ready=(async()=>{
      try{
        if(actx.audioWorklet&&window.AudioWorkletNode){
          const code='const EF=('+engineFactory.toString()+')();'+
            'class P extends AudioWorkletProcessor{constructor(){super();this.e=new EF.Engine(sampleRate);this.e.post=m=>this.port.postMessage(m);this.port.onmessage=ev=>this.e.msg(ev.data);}'+
            'process(i,o){const c=o[0];this.e.render(c[0],c[1]||c[0],c[0].length);return true;}}registerProcessor("slicefield",P);';
          const urls=[()=>URL.createObjectURL(new Blob([code],{type:'application/javascript'})),()=>'data:application/javascript;base64,'+btoa(unescape(encodeURIComponent(code)))];
          for(const mk of urls){
            try{await withTimeout(actx.audioWorklet.addModule(mk()),1500);
              workletNode=new AudioWorkletNode(actx,'slicefield',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});break;}
            catch(_){workletNode=null;}
          }
        }
      }catch(_){workletNode=null;}
      if(workletNode){
        const node=workletNode,myGen=gen;
        node.port.onmessage=ev=>{if(myGen===gen&&!usingFallback)onEngine(ev.data);};node.onprocessorerror=()=>useFallback();
        send=m=>{if(!usingFallback&&myGen===gen)node.port.postMessage(m);};
        connectOut(node);syncAll();
        let runSince=0;
        const check=()=>{if(gotStatus||usingFallback)return;
          if(actx.state==='running'){if(!runSince)runSince=performance.now();else if(performance.now()-runSince>1000){useFallback();return;}}
          setTimeout(check,250);};
        check();
      }else useFallback();
    })().catch(()=>{try{useFallback();}catch(_){}});
    return ready;
  }
  function checkBlocked(){setTimeout(()=>{if(actx&&actx.state!=='running')unlock();},700);}
  const tx=m=>{if(send)send(m);};

  // ---------- loops ----------
  const loopLen=rate=>Math.round(rate*240/bpm/64)*64;
  function buildLoop(t,rate){return loopBuf(t.kind,rate);}
  // Loops are built once per tempo and rate and kept, since clips made on other loops can play too.
  const loopCache=new Map();
  function loopBuf(key,rate){
    const len=loopLen(rate),ck=key+'|'+len,hit=loopCache.get(ck);if(hit)return hit;
    let b;
    if(key.startsWith('f:')){const f=files.get(key.slice(2));
      b=!f?makeLoop('break',rate,bpm):prefs.fit==='stretch'?stretch2(f.L,f.R,len,f.sr||rate):{L:resample(f.L,len),R:resample(f.R,len)};}
    else b=makeLoop(key,rate,bpm);
    if(loopCache.size>24)loopCache.clear();
    loopCache.set(ck,b);return b;
  }
  // the engine keeps the loops sequences can name; each is sent once per length
  const sentLoops=new Map();
  function engineLoop(key){const b=loopBuf(key,curRate());if(sentLoops.get(key)===b)return;sentLoops.set(key,b);tx({type:'loopBuf',key,L:b.L,R:b.R});}
  function peaks(b){
    const B=720,out=new Float32Array(B*2),n=b.L.length;
    for(let k=0;k<B;k++){let lo=1,hi=-1;const a=Math.floor(k*n/B),z=Math.floor((k+1)*n/B);for(let i=a;i<z;i++){const v=(b.L[i]+b.R[i])*0.5;if(v<lo)lo=v;if(v>hi)hi=v;}out[k*2]=lo;out[k*2+1]=hi;}
    return out;
  }
  const curRate=()=>actx?sr:48000;
  function genTrack(t){t.buf=buildLoop(t,curRate());t.pk=peaks(t.buf);tx({type:'load',tr:t.i,L:t.buf.L,R:t.buf.R});}
  // Make sure a track's buffer matches the device rate; resampling is instant, so audio never waits.
  function fitTrack(t){
    const len=loopLen(curRate());
    if(!t.buf)genTrack(t);
    else if(t.buf.L.length!==len){t.buf={L:resample(t.buf.L,len),R:resample(t.buf.R,len)};}
  }
  let genTimer=0;
  // Build all four loops (one per tick so the page stays responsive), then hand them to the engine
  // together, so no track ever plays at a length that does not match its audio.
  let genRun=0;
  function regenAll(){
    clearTimeout(genTimer);const run=++genRun,rate=curRate(),bufs=[];let i=0;
    const nx=()=>{
      if(run!==genRun)return;
      if(i<tracks.length){const t=tracks[i];bufs[i]=buildLoop(t,rate);i++;genTimer=setTimeout(nx,20);return;}
      tracks.forEach((t,j)=>{t.buf=bufs[j];t.pk=peaks(bufs[j]);});
      tx({type:'loadAll',bufs:bufs.map(b=>({L:b.L,R:b.R}))});
      if(songPlaying)songList.forEach(k=>engineLoop(k.loop));
    };
    genTimer=setTimeout(nx,0);
  }
  // the field's settings and its signal order
  function sendField(t){sendCfg(t);tx({type:'field',tr:t.i,order:fieldOrder(t.field)});}
  function syncTrack(t){
    tx({type:'grid',tr:t.i,n:t.cols});tx({type:'range',tr:t.i,s16:0,e16:t.len16});sendField(t);
    sendLoopSet(t);
    if(t.buf)tx({type:'load',tr:t.i,L:t.buf.L,R:t.buf.R});
    push(t);
  }
  // the output latency the device reports (plus the backup engine's large blocks) widens the late-touch window
  const outLat=()=>actx?Math.round(((actx.outputLatency||0)+(actx.baseLatency||0))*1000+(usingFallback?2048/sr*1000:0)):0;
  const prefMsg=()=>({type:'pref',pref:{silPat:tracks[0].loopSet.silPat||'mute',grace:prefs.grace,lat:outLat(),touchWin:prefs.touchWin}});
  // the engine works out every effect value from these settings, so edits reach recorded sequences too
  function sendCfg(t){const c={};for(const k in t.cfg){const x=t.cfg[k];c[k]={cells:x.cells.slice(),lo:Object.assign({},x.lo),hi:Object.assign({},x.hi),x:Object.assign({},x.x),o:Object.assign({},x.o,x.o.mask?{mask:x.o.mask.slice()}:{})};}tx({type:'cfg',tr:t.i,cfg:c});}
  function syncAll(){
    sentLoops.clear();   // a new engine holds none of the loops yet
    tx({type:'swing',s:swing});tx({type:'stepped',on:stepped});tx({type:'live',tr:0,ord:null,mute:null});if(tracks[0].seq)tx({type:'launch',tr:0,clip:clipForm(tracks[0].seq)});sendRec();tx({type:'mode',mode:playMode});tx({type:'fxonly',on:fxOnly});tx(prefMsg());tx({type:'view',tr:view});
    tracks.forEach(t=>{fitTrack(t);syncTrack(t);});
    // regenerate at the device rate in the background for best quality
    if(curRate()!==48000)regenAll();
  }
  const barSec=()=>240/bpm;

  // ---------- strips ----------
  // ORDER and SKIP: each slider position is one fixed pattern (see the engine's orderPattern and
  // skipPattern). On screen the default is at the left, next to the pin, and the pattern number grows to
  // the right: a strip position p (0…1) is the engine value v = 1 − p. Values are stored with the
  // sequence, or the plain loop.
  const ordOf=(t,v)=>({perm:EF.orderPattern(v,barSteps(t))}), muteOf=(t,v)=>({bits:EF.skipPattern(v,barSteps(t))});
  const tr0=()=>tracks[0];
  // a sequence carries its patterns in engine form too, so it plays (and exports) the same anywhere
  function clipForm(c){const t=tr0();c.ord=ordOf(t,c.orderV);c.mute=muteOf(t,c.muteV);return c;}
  function withSettings(c,from){const f=from||{};c.orderV=f.orderV!=null?f.orderV:1;c.muteV=f.muteV!=null?f.muteV:1;c.silPat=f.silPat||'mute';return clipForm(c);}
  function sendLoopSet(t){const L=t.loopSet;tx({type:'order',tr:t.i,perm:ordOf(t,L.orderV).perm});tx({type:'mute',tr:t.i,bits:muteOf(t,L.muteV).bits});}
  function sendCtx(t){if(t.seq){clipForm(t.seq);tx({type:'clipEdit',tr:t.i,clip:t.seq});}else sendLoopSet(t);}
  const STRIP_DEF={order:1,mute:1};
  function setStrip(t,which,v,stored){
    if(v>=EF.DEAD)v=Math.max(v,EF.DEAD);
    if(stored){ctxSet(t)[which+'V']=v;liveV[which]=null;sendCtx(t);tx({type:'live',tr:t.i,[which==='order'?'ord':'mute']:null});return;}
    liveV[which]=v;
    tx({type:'live',tr:t.i,[which==='order'?'ord':'mute']:which==='order'?ordOf(t,v):muteOf(t,v)});
  }
  function endLive(t,which){if(liveV[which]==null)return;liveV[which]=null;tx({type:'live',tr:t.i,[which==='order'?'ord':'mute']:null});}
  const SX=30,SWD=()=>cssW-SX;   // strips run from just right of the pin to the edge
  const stripX=v=>SX+(1-v)*SWD();
  // pattern number shown on a strip (1…PATN), or 0 in the default zone
  const patNo=v=>v>=EF.DEAD?0:Math.min(EF.PATN,Math.floor((EF.DEAD-v)/EF.DEAD*EF.PATN)+1);

  // ---------- touches ----------
  // Cell values: unipolar cells map bottom→top onto the range; bipolar cells move outward from the
  // centre band, up to the range's top value above and its bottom value below.
  // Touches carry only their raw cell position; values come from the track's settings.
  const resolve=(t,k,raw)=>EF.resolve(t.cfg[k],k,raw);
  // a touch's fxs: every cell under the finger with its value there ([] = a dry touch: just the slice)
  const toEngine=e=>({id:e.hid,a:e.a,n:e.n,o:e.order,fx:e.fxs.length?e.fxs.map(f=>({k:f.k,raw:f.raw})):null});
  function entriesOf(t){
    const out=[];
    for(const p of ptrs.values())if(p.live&&p.fxs&&!p.mined&&p.tr===t.i)out.push({hid:p.hid,fxs:p.fxs,a:p.col*16/t.cols,n:16/t.cols,order:p.order,ts:p.ts,finger:true});
    return out;
  }
  function push(t){tx({type:'touches',tr:t.i,list:entriesOf(t).map(toEngine).sort((a,b)=>a.o-b.o)});}
  function pushFor(ptr){push(tracks[ptr.tr]);}

  // ---------- geometry ----------
  // the lane shows one bar, in two rows when it has more than 8 steps (pr: steps per row)
  function laneInfo(){
    const t=T(),i=info(view),clip=t.seq;
    const n=clip?clip.n:(i.n||barSteps(t)),slots=clip?clip.slots:null,rows=n>8?2:1;
    return {t,clip,n,slots,rows,pr:Math.ceil(n/rows)};
  }
  function hasCell(t,k){return t.cfg[k].cells.length>0;}
  // lay: the field's cells on screen, top to bottom: {id, y, h, ci (index in field.cells), lane, lanes}.
  // Overlapping cells form a group; each gets a lane (its slice of the handle column, and its column in
  // the editor).
  // the field's height (the editor's bar takes the bottom while editing)
  const fieldH=()=>cssH-(fieldEdit?48:0);
  function computeLayout(){
    laneRows=laneInfo().rows;
    TOP=STRIP+4+STRIP+6;
    sizeLane();
    const t=T(),f=t.field,area=Math.max(1,fieldH()-TOP);
    const order=f.cells.map((c,ci)=>({c,ci})).sort((a,b)=>a.c.y-b.c.y||a.ci-b.ci);
    // b0/b1: the band a cell answers touches in; y/h: where it is drawn (a small gap to its neighbours)
    lay=order.map(({c,ci})=>{const b0=TOP+c.y/FG*area,b1=b0+c.h/FG*area,y=b0+1.5,h=Math.max(4,b1-b0-3),o={id:c.k,y,h,b0,b1,ci,lane:0,lanes:1};if(c.k==='center'){o.z1=y+h*0.36;o.z2=y+h*0.64;}return o;});
    // overlap groups and lanes
    let g0=0;
    while(g0<lay.length){
      let end=lay[g0].b1,g1=g0+1;
      while(g1<lay.length&&lay[g1].b0<end-0.5){end=Math.max(end,lay[g1].b1);g1++;}
      const ends=[];
      for(let i=g0;i<g1;i++){const r=lay[i];let l=ends.findIndex(e=>e<=r.b0+0.5);if(l<0){l=ends.length;ends.push(0);}ends[l]=r.b1;r.lane=l;}
      for(let i=g0;i<g1;i++)lay[i].lanes=ends.length;
      g0=g1;
    }
  }
  function sizeLane(){
    const w=laneCv.clientWidth||cssW,h=laneRows*LROW+6;laneDpr=Math.min(3,window.devicePixelRatio||1);
    if(laneCv.style.height!==h+'px')laneCv.style.height=h+'px';
    LW=w;const W2=Math.round(w*laneDpr),H2=Math.round(h*laneDpr);if(laneCv.width!==W2||laneCv.height!==H2){laneCv.width=W2;laneCv.height=H2;}
  }
  new ResizeObserver(()=>sizeLane()).observe(laneCv);
  laneCv.addEventListener('pointerdown',async e=>{
    e.preventDefault();try{laneCv.setPointerCapture(e.pointerId);}catch(_){}
    const b=laneCv.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;initAudio();laneDown(e.pointerId,x,y);
  });
  // A step switches off or on when it is released. While a step is held, tapping a cell assigns that
  // cell (and the finger's position in it) to the step. Several steps can be held at once (for Trash).
  const laneHolds=new Map();
  const laneUp=e=>{
    const h=laneHolds.get(e.pointerId);if(!h)return;laneHolds.delete(e.pointerId);
    if(laneHold===h)laneHold=[...laneHolds.values()].pop()||null;
    if(!h.used&&e.type==='pointerup'){const s=h.clip.slots[h.idx];if(s){checkpoint();s.on=!(s.on!==false);seqEdited(h.t);}}
  };
  ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>laneCv.addEventListener(ev,laneUp));
  function resize(){
    const b=wrap.getBoundingClientRect();if(!b.width)return;cssW=Math.max(1,b.width);cssH=Math.max(1,b.height);
    dpr=Math.min(3,window.devicePixelRatio||1);canvas.width=Math.round(cssW*dpr);canvas.height=Math.round(cssH*dpr);computeLayout();
  }
  new ResizeObserver(resize).observe(wrap);resize();
  const W=()=>cssW-HW;
  const hueOf=(t,id)=>FX[fxKey(id)].hue;
  const cellBip=(t,k)=>EF.rowBip(t.cfg[k],k);
  const yOrder=()=>0,yMute=()=>yOrder()+STRIP+4;
  // a cell's value at height y
  function rawIn(t,r,y){
    if(r.id==='center'){
      if(y<r.z1)return {k:'filter',raw:Math.max(0.001,clamp((r.z1-y)/(r.z1-r.y),0,1))};
      if(y>r.z2)return {k:'filter',raw:-Math.max(0.001,clamp((y-r.z2)/(r.y+r.h-r.z2),0,1))};
      return null;   // the dry middle
    }
    const rel=clamp(1-(y-r.y)/r.h,0,1);
    if(cellBip(t,r.id)){const p=rel>BAND_HI?(rel-BAND_HI)/(1-BAND_HI):rel<BAND_LO?-(BAND_LO-rel)/BAND_LO:0;return {k:r.id,raw:clamp(p,-1,1)};}
    return {k:r.id,raw:rel};
  }
  const coversAt=y=>{const out=[];lay.forEach((r,ri)=>{if(y>=r.b0&&(y<r.b1||r.b1>=cssH-1&&y<=cssH))out.push(ri);});return out;};
  function hit(x,y){
    const t=T();
    if(y<yMute()-2)return {strip:'order',snapBox:x<SX-2};
    if(y<TOP-3)return {strip:'mute',snapBox:x<SX-2};
    let cv=coversAt(y);
    if(x<HW){if(!cv.length)return {};const n=lay[cv[0]].lanes,l=Math.min(n-1,Math.floor(x/(HW/n)));const ri=cv.find(i=>lay[i].lane===l);
      return ri==null?{}:{handle:true,ri,id:lay[ri].id};}
    const col=Math.min(t.cols-1,Math.max(0,Math.floor((x-HW)/W()*t.cols)));
    const fxs=[];for(const ri of cv){const v=rawIn(t,lay[ri],y);if(v)fxs.push(v);}
    return {cell:true,col,cells:cv,fxs};
  }
  function rawToRel(t,id,raw){
    if(cellBip(t,id))return raw>0?BAND_HI+raw*(1-BAND_HI):raw<0?BAND_LO+raw*BAND_LO:0.5;
    return raw;
  }

  // ---------- pointer handling ----------
  function pos(e){const b=canvas.getBoundingClientRect();return [e.clientX-b.left,e.clientY-b.top];}
  const special=new Map();
  // start playback (waiting for the audio engine if this is the first touch)
  function ensurePlaying(){if(st.playing||intent)return;intent={type:'play'};initAudio();ready.then(()=>{if(intent)tx(intent);});paintIcons();}
  const fxSig=fxs=>fxs.map(f=>f.k).join('+');
  function update(ptr){
    const h=hit(ptr.x,ptr.y);if(!h.cell)return;
    if(ptr.order<0){ptr.order=++orderCtr;ptr.hid='h'+(++idCtr);}
    ensurePlaying();
    const changed=!ptr.fxs||fxSig(h.fxs)!==fxSig(ptr.fxs)||h.col!==ptr.col;
    if(changed||h.fxs.some((f,i)=>Math.abs(f.raw-ptr.fxs[i].raw)>0.002)){ptr.fxs=h.fxs;ptr.col=h.col;ptr.cells=h.cells;ptr.ts=++tsCtr;pushFor(ptr);}
  }
  let lastStrip={which:null,t:0};
  canvas.addEventListener('pointerdown',async e=>{
    e.preventDefault();try{canvas.setPointerCapture(e.pointerId);}catch(_){}
    const [x,y]=pos(e),h=hit(x,y),t=T();
    initAudio();
    if(fieldEdit&&y>=TOP-3){editDown(e.pointerId,x,y);return;}
    if(h.strip&&(gameOn||gameMsg))return;   // the round's display covers the strips
    if(h.strip){
      if(h.snapBox){
        pin[h.strip]=!pin[h.strip];
        // unpinning puts the stored pattern back to the default, so an unpinned strip always springs home there
        if(!pin[h.strip]&&ctxSet(t)[h.strip+'V']<EF.DEAD){checkpoint();setStrip(t,h.strip,STRIP_DEF[h.strip],true);}
        return;
      }
      // double-tap a strip to put its stored value back to the default
      const now=performance.now(),dbl=lastStrip.which===h.strip&&now-lastStrip.t<320;lastStrip={which:h.strip,t:dbl?0:now};
      const keep=dbl||pin[h.strip];if(keep)checkpoint();
      const v=dbl?STRIP_DEF[h.strip]:clamp(1-(x-SX)/SWD(),0,1);
      special.set(e.pointerId,{kind:'strip',which:h.strip,held:dbl,keep,x,v});await ready;
      setStrip(t,h.strip,v,keep);return;
    }
    if(h.handle){special.set(e.pointerId,{kind:'handle',id:h.id,y0:y,y,moved:false});return;}
    if(laneHold&&h.cell){special.set(e.pointerId,{kind:'assign'});assignStep(h);return;}
    // FX ONLY with the trash held: tapping an effect row takes its effects off every step of the sequence
    if(trashHeld&&fxOnly&&h.cell){trashHeld.used=true;special.set(e.pointerId,{kind:'assign'});removeEffect(t,h.fxs.map(f=>f.k));return;}
    if(!h.cell)return;
    const ptr={x,y,tr:view,col:-1,fxs:null,cells:[],order:-1,ts:0,hid:null,live:false,mined:false};ptrs.set(e.pointerId,ptr);
    if(gameOn)gameDown(ptr);
    checkBlocked();await ready;
    if(ptrs.get(e.pointerId)===ptr){ptr.live=true;update(ptr);}else ensurePlaying();
  });
  canvas.addEventListener('pointermove',e=>{
    const [x,y]=pos(e),sp=special.get(e.pointerId);
    if(editing.has(e.pointerId)){editMove(e.pointerId,x,y);return;}
    if(sp){
      // Fine control: the further the finger moves above or below its strip, the slower the value moves
      // (down to a tenth), so every one of the patterns can be reached.
      if(sp.kind==='strip'){if(!sp.held){
        const cy=(sp.which==='order'?yOrder():yMute())+STRIP/2,off=Math.max(0,Math.abs(y-cy)-STRIP*0.75),rate=1/(1+Math.min(9,off/22));
        sp.v=clamp(sp.v-(x-sp.x)/SWD()*rate,0,1);sp.x=x;sp.fine=rate<0.99?rate:0;setStrip(T(),sp.which,sp.v,sp.keep);}}
      else if(sp.kind==='handle'){if(Math.abs(y-sp.y0)>8)sp.moved=true;sp.y=y;}
      else if(sp.kind==='assign'){const h=hit(x,y);if(h.cell&&laneHold)assignStep(h);}
      return;
    }
    const ptr=ptrs.get(e.pointerId);if(!ptr)return;ptr.x=x;ptr.y=y;if(ptr.live&&ptr.tr===view)update(ptr);
  });
  // a mouse moving with no button down, or a lost capture, always ends the gesture
  canvas.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&e.buttons===0&&(special.has(e.pointerId)||ptrs.has(e.pointerId)))end(e);},true);
  const end=e=>{
    if(editing.has(e.pointerId)){editUp(e.pointerId,e.type==='pointerup');return;}
    const sp=special.get(e.pointerId);
    if(sp){special.delete(e.pointerId);
      if(sp.kind==='strip')endLive(T(),sp.which);
      if(sp.kind==='handle'){if(sp.moved)dropRow(sp.id,sp.y);else openSettings(sp.id);}
      return;}
    const ptr=ptrs.get(e.pointerId);if(!ptr)return;ptrs.delete(e.pointerId);
    if(ptr.live&&ptr.fxs)pushFor(ptr);
  };
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
  window.addEventListener('blur',()=>{for(const id of [...special.keys(),...ptrs.keys()])end({pointerId:id});});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  // Dragging a handle moves its cell, with any cells overlapping it, to another place in the order; the
  // field is then stacked again top to bottom (each group keeps its shape). The order is the signal order.
  function fieldGroups(f){
    const cs=sortedCells(f),out=[];
    for(const c of cs){const g=out[out.length-1];if(g&&c.y<g.end){g.cells.push(c);g.end=Math.max(g.end,c.y+c.h);}else out.push({cells:[c],top:c.y,end:c.y+c.h});}
    return out;
  }
  function dropRow(id,y){
    const t=T(),f=t.field,groups=fieldGroups(f),from=groups.findIndex(g=>g.cells.some(c=>c.k===id));if(from<0)return;
    const area=cssH-TOP,uy=(y-TOP)/area*FG;let to=groups.findIndex(g=>uy<(g.top+g.end)/2);if(to<0)to=groups.length;
    if(to===from||to===from+1)return;
    checkpoint();const g=groups.splice(from,1)[0];groups.splice(to>from?to-1:to,0,g);
    let u=0;for(const q of groups){const d=u-q.top;q.cells.forEach(c=>{c.y+=d;});u+=q.end-q.top;}
    fieldEdited(t);
  }

  // ---------- sequencer lane ----------
  function lanePageInfo(){
    const L=laneInfo(),i=info(view),per=L.n;
    const total=L.slots?L.slots.length:L.n;
    const pages=Math.max(1,Math.ceil(total/per));
    const playIdx=L.clip&&i.clipId===L.clip.id?i.cIdx:-1;
    const page=laneFollow&&playIdx>=0?Math.floor(playIdx/per):Math.min(lanePage,pages-1);
    return Object.assign(L,{per,pages,page,playIdx});
  }
  let laneHold=null;
  function laneDown(id,x,y){
    let d=lanePageInfo();
    if(x<LLAB){if(d.pages>1){laneFollow=false;lanePage=(d.page+1)%d.pages;}return;}
    // the rotate column: the upper half moves every step one to the left, the lower half one to the right
    if(x>=LW-LROT){if(trashHeld||diceHeld)return;rotateSeq(d.t,y<(d.rows*LROW+4)/2?-1:1);return;}
    const row=clamp(Math.floor((y-4)/LROW),0,d.rows-1),col=Math.floor((x-LLAB)/(LW-LLAB-LROT)*d.pr);
    const idx=d.page*d.per+row*d.pr+col;
    if(col<0||col>=d.pr||row*d.pr+col>=d.n)return;
    // a held Trash empties tapped steps; a held die randomizes them
    if(trashHeld){trashHeld.used=true;clearSteps(d.t,[idx]);return;}
    if(diceHeld){diceStep(idx);return;}
    // on the plain loop, touching a step starts a sequence of empty steps (the loop plays through them);
    // touching a step while stopped starts playback
    if(!d.clip){checkpoint();loadSeq(d.t,blankClip(d.t),true);d=lanePageInfo();}
    ensurePlaying();
    if(idx>=d.slots.length)return;
    const h={id,idx,clip:d.clip,t:d.t,used:false};laneHolds.set(id,h);laneHold=h;
    // a cell already held on the grid is pasted straight into the step
    let finger=null;for(const p of ptrs.values())if(p.live&&p.fxs&&p.tr===view&&(!finger||p.ts>finger.ts))finger=p;
    if(finger)assignStep({col:finger.col,fxs:finger.fxs});
  }
  // Rotate: the whole sequence moves one step left (dir −1) or right (+1), wrapping round. Empty steps are
  // first fixed to the loop slice they play, so the loop moves with them; on the plain loop this makes
  // a sequence of the loop's own slices.
  function rotateSeq(t,dir){
    checkpoint();if(!t.seq)loadSeq(t,blankClip(t),true);
    const c=t.seq,n=c.slots.length,step=16/c.cols;
    const fixed=c.slots.map((s,i)=>{if(!s.empty)return s;const x={on:s.on!==false,a:(i%c.n)*step,off:0,sid:'R'+(++idCtr),slen:1,fx:[]};return x;});
    c.slots=fixed.map((_,i)=>fixed[((i-dir)%n+n)%n]);
    seqEdited(t);
  }
  function assignStep(h){
    const L=laneHold;if(!L)return;const t=L.t;if(!L.used)checkpoint();L.used=true;
    const fx=h.fxs.map(f=>({k:f.k,raw:f.raw}));
    if(fxOnly){   // FX only: the step keeps its slice (an empty step takes its loop slice) and gets the effect
      const old=L.base||(L.base=L.clip.slots[L.idx]),c=L.clip;
      const s=Object.assign({},old.empty?{on:true,a:(L.idx%c.n)*16/c.cols,off:0,sid:'P'+(++idCtr),slen:1}:old,{fx});delete s.empty;
      L.clip.slots[L.idx]=s;
    }
    else L.clip.slots[L.idx]={on:true,a:h.col*16/t.cols,off:0,sid:L.sid||(L.sid='P'+(++idCtr)),slen:1,fx};
    seqEdited(t);
  }

  // ---------- transport ----------
  async function togglePlay(){
    initAudio();checkBlocked();await ready;
    // Stop also turns Record off
    if(st.playing||intent){intent=null;tx({type:'stop'});if(songPlaying)songEnded();if(gameOn)endGame(true,'Round stopped');if(recOn){recOn=false;recBn=-1;sendRec();}paintIcons();updateSession();}
    // on the Clips page, Play plays the list from the selected clip (with nothing captured it does nothing)
    else if(sessOn){if(selClip)playClips(selClip);}
    else{intent={type:'play'};tx(intent);paintIcons();}
  }
  // Record: while it is on, the steps you touch are written into the sequence (Replace or Combine, and
  // FX only, decide what is written). Off, touches are only heard. Recording on the plain loop first makes a
  // sequence of empty steps to record into. Each bar that records something is one undo step.
  recBtn.addEventListener('click',()=>{
    initAudio();const t=T();recOn=!recOn;recBn=-1;
    if(recOn&&!t.seq){checkpoint();loadSeq(t,blankClip(t),true);}else sendRec();
    paintIcons();
  });
  function sendRec(){const t=T();if(ready)ready.then(()=>tx({type:'rec',tr:t.i,on:recOn&&!!t.seq,id:t.seq?t.seq.id:null}));}
  function onClipStep(m){
    const t=tracks[m.tr];if(!t||!t.seq||t.seq.id!==m.id||m.idx>=t.seq.slots.length)return;
    if(m.bn!==recBn){recBn=m.bn;checkpoint();}
    t.seq.slots[m.idx]=copySlot(m.slot);t.seq.edited=true;
  }
  playBtn.addEventListener('click',togglePlay);
  window.addEventListener('keydown',e=>{
    const a=root.activeElement||document.activeElement;
    if(e.code==='Space'&&!(a&&/INPUT|SELECT|BUTTON/.test(a.tagName))&&sheet.hidden){e.preventDefault();togglePlay();}
  });
  function dragNumber(el,get,set,stepPx,fmt){
    let y0=0,x0=0,v0=0,id=null;
    const show=()=>{el.querySelector('b').textContent=fmt(get());el.setAttribute('aria-valuenow',String(Math.round(get())));};
    el.addEventListener('pointerdown',e=>{id=e.pointerId;y0=e.clientY;x0=e.clientX;v0=get();try{el.setPointerCapture(id);}catch(_){}});
    el.addEventListener('pointermove',e=>{if(e.pointerId!==id)return;if(e.pointerType==='mouse'&&e.buttons===0){id=null;return;}set(v0+((e.clientX-x0)+(y0-e.clientY))/stepPx);show();});
    const up=e=>{if(e.pointerId===id)id=null;};el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('lostpointercapture',up);
    window.addEventListener('blur',()=>{id=null;});
    el.addEventListener('keydown',e=>{const d={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1}[e.key];if(d){e.preventDefault();set(get()+d);show();}});
    show();return show;
  }
  let bpmTimer=0;
  dragNumber(bpmEl,()=>bpm,v=>{const nb=clamp(Math.round(v),60,200);if(nb!==bpm){bpm=nb;clearTimeout(bpmTimer);bpmTimer=setTimeout(regenAll,350);}},4,v=>String(v));
  // Swing as the swung step's place between its neighbours: 50 is straight, 75 is three quarters of the way
  // (the engine's swing s = (value − 50) / 50, 0…0.5)
  dragNumber(swingEl,()=>Math.round(50+swing*50),v=>{swing=(clamp(Math.round(v),50,75)-50)/50;tx({type:'swing',s:swing});},4,v=>String(v));
  const press=(b,on)=>b.setAttribute('aria-pressed',on?'true':'false');
  // Replace: each step plays one touch's effect. Combine: every held effect stacks on each step.
  modeBtn.addEventListener('click',()=>{playMode=playMode==='replace'?'combine':'replace';tx({type:'mode',mode:playMode});paintIcons();});
  // FX only: the sequence (or loop) keeps its slices and touches only bring effects.
  fxoBtn.addEventListener('click',()=>{fxOnly=!fxOnly;tx({type:'fxonly',on:fxOnly});paintIcons();});
  // Trash: a tap (on release) clears the sequence, so the plain loop plays. Hold it and tap steps, or hold
  // steps and tap it, to empty just those steps; then releasing it clears nothing more.
  // On the Clips page it works the same way on clips: hold it and tap clips (or hold clips and tap it) to
  // delete them; a tap on its own deletes the selected clip.
  let trashHeld=null;
  clearBtn.addEventListener('pointerdown',e=>{
    if(clearBtn.disabled)return;trashHeld={id:e.pointerId,used:false};clearBtn.classList.add('held');
    try{clearBtn.setPointerCapture(e.pointerId);}catch(_){}
    if(!sessOn&&laneHolds.size){trashHeld.used=true;clearSteps(T(),[...laneHolds.values()].map(h=>{h.used=true;return h.idx;}));}
    if(sessOn&&clipHolds.size){trashHeld.used=true;deleteClips([...clipHolds.values()].map(h=>{h.used=true;return h.k;}));}
  });
  // a tap on its own: the field's sequence is cleared; on the Clips page the selected clip is deleted
  const trashTap=()=>{if(sessOn){if(selClip)deleteClips([selClip]);}else clearSequence(T());};
  const trashUp=e=>{const h=trashHeld;if(!h||h.id!==e.pointerId)return;trashHeld=null;clearBtn.classList.remove('held');
    if(e.type==='pointerup'&&!h.used)trashTap();};
  ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>clearBtn.addEventListener(ev,trashUp));
  clearBtn.addEventListener('click',e=>{if(e.detail===0)trashTap();}); // keyboard
  // while recording, clearing leaves an empty sequence to keep recording into
  // Clearing leaves a blank sequence (the loop's slices in order, no effects) with the same ORDER, SKIP and
  // SKIP/GAP mode. While recording it takes over at once, so recording carries on.
  const seqEmpty=t=>!t.seq||t.seq.slots.every(s=>s.empty&&s.on!==false);
  function clearSequence(t){
    if(seqEmpty(t))return;checkpoint();loadSeq(t,blankClip(t,t.seq),recOn);
  }
  function removeEffect(t,ks){
    const has=s=>(s.fx||[]).some(f=>ks.includes(f.k));
    const c=t.seq;if(!c||!c.slots.some(has))return;checkpoint();
    c.slots=c.slots.map(s=>has(s)?Object.assign({},s,{fx:s.fx.filter(f=>!ks.includes(f.k))}):s);
    seqEdited(t);
  }
  // an emptied step plays the loop's own slice for its position
  function clearSteps(t,idxs){
    const c=t.seq;if(!c)return;checkpoint();
    for(const i of idxs){if(i>=c.slots.length)continue;c.slots[i]=EF.emptyStep(++idCtr);}
    seqEdited(t);
  }
  // The main page's sequence: load one (a clip, a blank, or null for the plain loop), or note an edit.
  // Playing, it takes over at the next bar line; now: at once (a blank made from the plain loop).
  // Loading never starts playback.
  function loadSeq(t,c,now){
    t.seq=c;liveV.order=liveV.mute=null;laneFollow=true;
    if(songPlaying){songPlaying=false;songList=[];tx({type:'songStop'});}
    if(c)clipForm(c);
    initAudio();ready.then(()=>{tx({type:'live',tr:t.i,ord:null,mute:null});tx({type:'launch',tr:t.i,clip:c,now:!!now});});
    sendRec();computeLayout();updateSession();
  }
  function seqEdited(t){if(t.seq){t.seq.edited=true;tx({type:'clipEdit',tr:t.i,clip:clipForm(t.seq)});}}
  steppedBtn.addEventListener('click',()=>{stepped=!stepped;paintIcons();tx({type:'stepped',on:stepped});});
  // Changing the grid or bar length clears the sequence and the clips (they were made on the other grid),
  // so it asks first. The change lands on the next bar.
  function setShape(t,nc,nl){
    checkpoint();songPlaying=false;songList=[];tx({type:'songStop'});
    clips=[];selClip=null;recOn=false;liveV.order=liveV.mute=null;
    t.len16=nl;if(nc!==(t.colsQ||t.cols))t.colsQ=nc;t.seq=blankClip(t);tx({type:'launch',tr:t.i,clip:clipForm(t.seq)});sendRec();
    if(nc!==t.cols){if(st.playing){t.colsQ=nc;tx({type:'grid',tr:t.i,n:nc,q:true});}else{t.cols=nc;t.colsQ=0;tx({type:'grid',tr:t.i,n:nc});}}
    tx({type:'range',tr:t.i,s16:0,e16:nl,q:st.playing});
    sendLoopSet(t);computeLayout();renderSession();
  }
  // a blank sequence is all empty steps, so it plays the loop straight through until steps are written;
  // it takes over the plain loop's ORDER and SKIP
  function blankClip(t,from){
    const cols=t.colsQ||t.cols,n=t.len16*cols/16,slots=[];
    for(let i=0;i<n;i++)slots.push(EF.emptyStep(++idCtr));
    return withSettings({id:'q'+(++idCtr),cols,n,slots},from||t.loopSet);
  }
  // the loop picker: the demo loops, then each imported file, then "Load your own…"
  function setLoop(t,key){t.kind=key;fileOption(key);soundSel.value=key;genTrack(t);}
  function fileOption(key){
    if(!key.startsWith('f:')||soundSel.querySelector('option[value="'+key+'"]'))return;
    const o=el('option',{value:key,textContent:loopName(key)});soundSel.insertBefore(o,soundSel.querySelector('option[value="pick"]'));
  }
  soundSel.addEventListener('change',()=>{
    const v=soundSel.value,t=T();
    if(v==='pick'){soundSel.value=t.kind;initAudio();fileIn.click();return;}
    t.kind=v;genTrack(t);renderSession();
  });
  fileIn.addEventListener('change',async()=>{
    const f=fileIn.files&&fileIn.files[0];if(!f)return;await ready;const t=T();
    try{
      const ab=await actx.decodeAudioData(await f.arrayBuffer());
      const max=Math.min(ab.length,Math.round(ab.sampleRate*4));
      const l=ab.getChannelData(0).slice(0,max),r=(ab.numberOfChannels>1?ab.getChannelData(1):ab.getChannelData(0)).slice(0,max);
      // kept at its own level: untouched audio plays and exports at unity
      const id=Math.random().toString(36).slice(2,10);files.set(id,{id,name:f.name.replace(/\.[^.]+$/,'').slice(0,18),L:l,R:r});
      setLoop(t,'f:'+id);
    }catch(err){soundSel.value=t.kind;}
    fileIn.value='';
  });

  // ---------- icons ----------
  const svg=p=>'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>';
  const ICON={
    play:svg('<path d="M6 4.5l10 5.5-10 5.5z" fill="currentColor" stroke="none"/>'),
    stop:svg('<rect x="5" y="5" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>'),
    rec:svg('<circle cx="10" cy="10" r="5.5" stroke="none"/>'),
    stepOn:svg('<path d="M2 15H6V9H10V12H14V5H18"/>'),
    stepOff:svg('<path d="M2 15C4.5 15 4.5 9 7 9S9.5 12 12 12S13.5 5 18 5"/>'),
    // just the pips: the die's own outline is its edge
    dice:'<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="5.2" cy="5.2" r="2"/><circle cx="14.8" cy="14.8" r="2"/><circle cx="10" cy="10" r="2"/><circle cx="14.8" cy="5.2" r="2"/><circle cx="5.2" cy="14.8" r="2"/></svg>',
    list:svg('<path d="M3 5H17M3 10H17M3 15H17"/>'),
    handle:svg('<path d="M6 5H14M6 10H14M6 15H14"/>'),
    check:svg('<path d="M4.5 10.5L8.5 14.5L15.5 6"/>'),
    lines:svg('<path d="M3 5H8.5M3 10H8.5M3 15H8.5M11.5 5H17M11.5 10H17M11.5 15H17"/>'),
    grid:svg('<circle cx="3.5" cy="3.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="7.83" cy="3.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="12.16" cy="3.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="16.49" cy="3.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="3.5" cy="7.83" r="1.25" fill="currentColor" stroke="none"/><circle cx="7.83" cy="7.83" r="1.25" fill="currentColor" stroke="none"/><circle cx="12.16" cy="7.83" r="1.25" fill="currentColor" stroke="none"/><circle cx="16.49" cy="7.83" r="1.25" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12.16" r="1.25" fill="currentColor" stroke="none"/><circle cx="7.83" cy="12.16" r="1.25" fill="currentColor" stroke="none"/><circle cx="12.16" cy="12.16" r="1.25" fill="currentColor" stroke="none"/><circle cx="16.49" cy="12.16" r="1.25" fill="currentColor" stroke="none"/><circle cx="3.5" cy="16.49" r="1.25" fill="currentColor" stroke="none"/><circle cx="7.83" cy="16.49" r="1.25" fill="currentColor" stroke="none"/><circle cx="12.16" cy="16.49" r="1.25" fill="currentColor" stroke="none"/><circle cx="16.49" cy="16.49" r="1.25" fill="currentColor" stroke="none"/>'),
    gear:svg('<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6"/><circle cx="10" cy="10" r="5.4"/>'),
    x:svg('<path d="M5 5L15 15M15 5L5 15"/>'),
    undo:svg('<path d="M7.5 5L4 8.5L7.5 12M4 8.5H12.5A4 4 0 0 1 12.5 16.5H9"/>'),
    redo:svg('<path d="M12.5 5L16 8.5L12.5 12M16 8.5H7.5A4 4 0 0 0 7.5 16.5H11"/>'),
    trash:svg('<path d="M3.5 5.5H16.5M8 5.5V3.5H12V5.5M5.5 5.5L6.3 16.5H13.7L14.5 5.5M8.5 8.5V13.5M11.5 8.5V13.5"/>'),
    share:svg('<path d="M10 12.5V3M6.5 6.5L10 3L13.5 6.5M5 10H4V17H16V10H15"/>'),
    dup:svg('<rect x="7" y="7" width="9.5" height="10.5" rx="1.5"/><path d="M13 4.5V4A1.5 1.5 0 0 0 11.5 2.5H5A1.5 1.5 0 0 0 3.5 4V13A1.5 1.5 0 0 0 5 14.5H5.5"/>'),
    // a field: bands of cells, two of them overlapping
    field:svg('<rect x="3" y="3" width="14" height="4" rx="1"/><rect x="3" y="9" width="14" height="5" rx="1"/><path d="M5 12.5H15" stroke-dasharray="1.5 1.5"/><rect x="3" y="11.5" width="14" height="5.5" rx="1"/>'),
    // the game: a crosshair
    game:svg('<circle cx="10" cy="10" r="6"/><path d="M10 1.5V5.5M10 14.5V18.5M1.5 10H5.5M14.5 10H18.5"/><circle cx="10" cy="10" r="1" fill="currentColor" stroke="none"/>'),
    folder:svg('<path d="M2.5 5.5A1.5 1.5 0 0 1 4 4H8L9.5 6H16A1.5 1.5 0 0 1 17.5 7.5V14.5A1.5 1.5 0 0 1 16 16H4A1.5 1.5 0 0 1 2.5 14.5Z"/>'),
    // capture: a frame with a plus (save what is in the sequencer now)
    capture:svg('<path d="M3 7V3H7M13 3H17V7M17 13V17H13M7 17H3V13M10 7V13M7 10H13"/>')
  };
  function paintIcons(){
    playBtn.innerHTML=st.playing||intent?ICON.stop:ICON.play;playBtn.setAttribute('aria-label',st.playing||intent?'Stop':'Play');
    expBtn.innerHTML=ICON.share;clearBtn.innerHTML=ICON.trash;capBtn.innerHTML=ICON.capture;recBtn.innerHTML=ICON.rec;
    press(recBtn,recOn);recBtn.setAttribute('aria-label',recOn?'Record (on)':'Record');
    // row 3 and the lane are the field's; row 2's middle shows the loop, field and game there, LOAD on the Clips page
    root.querySelectorAll('.fieldonly').forEach(n=>{n.hidden=page!=='field';});root.querySelectorAll('.clipsonly').forEach(n=>{n.hidden=!sessOn;});
    loadBtn.disabled=!selClip;projBtn.innerHTML=ICON.folder;fieldBtn.innerHTML=ICON.field;gameBtn.innerHTML=ICON.game;press(gameBtn,gameOn);
    capBtn.disabled=gameOn;recBtn.disabled=gameOn;fieldBtn.disabled=gameOn;
    clearBtn.disabled=sessOn?!selClip:seqEmpty(T());
    clearBtn.title=sessOn?'Tap: delete the selected clip · hold and tap clips: delete those':'Tap: clear the sequence · hold and tap steps: empty just those';
    // Replace in orange, Combine in blue; stepped in orange, smooth in blue
    const cmb=playMode==='combine';modeBtn.textContent=cmb?'COMBINE':'REPLACE';modeBtn.classList.toggle('alt',cmb);
    modeBtn.title=cmb?'Combine: every held effect plays on each step':'Replace: each step plays one touch and its effect';
    press(fxoBtn,fxOnly);fxoBtn.title=fxOnly?'FX only: slices come from the sequence; touches only bring effects':'FX only is off: touched slices play';
    steppedBtn.innerHTML=stepped?ICON.stepOn:ICON.stepOff;steppedBtn.classList.toggle('alt',!stepped);steppedBtn.setAttribute('aria-label',stepped?'Stepped values':'Smooth values');
    prefsBtn.innerHTML=ICON.gear;$('undo').innerHTML=ICON.undo;$('redo').innerHTML=ICON.redo;
    sessBtn.innerHTML=(sessOn?ICON.grid:ICON.list)+'<b>'+(clips.length||'')+'</b>';sessBtn.setAttribute('aria-label',sessOn?'Back to the field':'Clips ('+clips.length+')');
    sessBtn.title=sessOn?'Back to the field':'Clips: what you saved with Capture';
  }

  // ---------- randomizer ----------
  // A die on a slider. Drag it right (or tap the slider) to set how far the sequence moves away from
  // its current state; you hear it while dragging, and letting go keeps it and rolls the die home.
  // Hold the die and tap steps to re-roll just those steps (at the die's amount; 100% from its rest spot).
  // Every step gets its own fixed random numbers for the gesture, so more amount only ever adds change.
  // Rolls follow the play mode: Replace gives a step one effect, Combine stacks effects, FX ONLY leaves
  // the slices where they are.
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  const copySlot=s=>Object.assign({},s,{fx:(s.fx||[]).map(f=>Object.assign({},f,f.auto?{auto:f.auto.slice()}:{}))});
  const cloneClip=c=>Object.assign({},c,{ord:c.ord&&Object.assign({},c.ord),mute:c.mute&&Object.assign({},c.mute),slots:c.slots.map(copySlot)});
  const fxBip=(t,k)=>k==='filter'||cellBip(t,k);
  // the effects the die can add: the field's (with a cell parameter, or Reverse)
  const dicePool=t=>ALL_FX.filter(k=>fieldHas(t.field,k)&&(hasCell(t,k)||k==='reverse')).concat(fieldHas(t.field,'filter')?['filter']:[]);
  function rollStep(orig,a,R,t,clip,idx){
    const n=clip.n,step=16/clip.cols,combine=playMode==='combine';
    const uAff=R(),uSl=R(),uSlD=R(),uAdd=R(),uAddK=R(),uAddR=R(),uAddS=R(),dev=[R(),R(),R(),R()],rem=[R(),R(),R(),R()],u2=R(),u2K=R(),u2R=R(),u2S=R();
    const a3=a*a*a;   // extra change that only builds up towards the right of the slider
    if(uAff>=a)return copySlot(orig);                      // chance a step is touched at all: a
    // an empty step is rolled as its loop slice; if nothing ends up changing it stays empty
    const s=orig.empty?{on:orig.on!==false,a:(idx%n)*step,off:0,sid:'D'+(++idCtr),slen:1,fx:[]}:orig;
    const y=copySlot(s);let moved=false;
    if(!fxOnly&&uSl<Math.min(1,a+a3)){                     // chance its slice moves: a + a³ (capped), up to ±a·bar away
      const cur=Math.round(s.a/step),d=Math.round((uSlD*2-1)*a*n)||(uSlD<0.5?-1:1);
      y.a=((((cur+d)%n)+n)%n)*step;moved=y.a!==s.a;
    }
    y.fx=y.fx.filter((f,j)=>rem[j%4]>=a*0.5);             // each effect removed: a/2
    y.fx.forEach((f,j)=>{                                  // each kept effect's cell position nudged by up to ±a
      const lo=fxBip(t,f.k)?-1:0,nr=clamp(f.raw+(dev[j%4]*2-1)*a,lo,1),dd=nr-f.raw;f.raw=nr;
      if(f.auto)f.auto=f.auto.map(v=>clamp(v+dd,lo,1));
    });
    // an effect added (Combine) or swapped in (Replace): a/2 + a³/2, so every step gets one at the far right
    const addFx=(uK,uR,uS,swap)=>{const pool=dicePool(t).filter(k=>!y.fx.some(f=>f.k===k));
      if(pool.length){const k=pool[Math.min(pool.length-1,Math.floor(uK*pool.length))],f={k,raw:fxBip(t,k)?(uS<0.5?-1:1)*(0.15+0.85*uR):uR};
        if(swap)y.fx=[f];else y.fx.push(f);}};
    if(uAdd<a*0.5+a3*0.5)addFx(uAddK,uAddR,uAddS,!combine);
    if(combine&&u2<a3*0.7)addFx(u2K,u2R,u2S,false);       // Combine: a second effect stacks, mostly near the right
    if(!combine&&y.fx.length>1)y.fx=y.fx.slice(-1);        // Replace: a rolled step plays one effect
    if(orig.empty&&!moved&&!y.fx.length)return copySlot(orig);
    if(moved){y.sid='D'+(++idCtr);y.off=0;y.slen=1;}
    return y;
  }
  let diceHeld=null,diceRaf=0;
  const DIE=30;
  function diceAmt(e){const b=diceEl.getBoundingClientRect();return clamp((e.clientX-b.left-DIE/2)/Math.max(1,b.width-DIE-4),0,1);}
  function dicePos(a,roll){
    const w=diceEl.clientWidth-DIE-4;
    dieEl.style.transition=roll?'transform .5s cubic-bezier(.25,.8,.3,1)':'none';
    dieEl.style.transform='translateX('+(a*w)+'px) rotate('+(a*w*1.9)+'deg)';
    diceVal.textContent=diceHeld&&a>0.01?Math.round(a*100)+'%':'';
    diceVal.classList.toggle('left',a>0.5);
    diceEl.setAttribute('aria-valuenow',String(Math.round(a*100)));
  }
  function diceBase(h){
    if(!h.base)h.base=h.t.seq?cloneClip(h.t.seq):blankClip(h.t);
    return h.base;
  }
  function storeDice(h,c){
    const t=h.t;if(!h.cp){h.cp=true;checkpoint();}c.edited=true;ensurePlaying();   // a roll starts playback
    if(t.seq&&t.seq.id===c.id){t.seq=c;tx({type:'clipEdit',tr:t.i,clip:clipForm(c)});}
    else loadSeq(t,c);
  }
  function diceAll(h){
    const base=diceBase(h),out=cloneClip(base);
    out.slots=base.slots.map((s,i)=>rollStep(s,h.a,mulberry32((h.seed+Math.imul(i+1,0x9E3779B1))>>>0),h.t,base,i));
    storeDice(h,out);
  }
  function diceStep(idx){
    const h=diceHeld;if(!h.used){h.used=true;h.work=cloneClip(diceBase(h));}
    const s=h.work.slots[idx];if(!s)return;
    h.work.slots[idx]=rollStep(s,h.rest?1:h.a,mulberry32((Math.random()*4294967296)>>>0),h.t,h.work,idx);
    storeDice(h,cloneClip(h.work));
  }
  diceEl.addEventListener('pointerdown',e=>{
    e.preventDefault();initAudio();try{diceEl.setPointerCapture(e.pointerId);}catch(_){}
    const t=T(),b=diceEl.getBoundingClientRect();
    diceHeld={id:e.pointerId,x0:e.clientX,a:diceAmt(e),rest:e.clientX-b.left<DIE+6,moved:false,used:false,t,base:null,seed:(Math.random()*4294967296)>>>0};
    diceEl.classList.add('held');dicePos(diceHeld.a,false);
  });
  diceEl.addEventListener('pointermove',e=>{
    const h=diceHeld;if(!h||h.id!==e.pointerId)return;
    h.a=diceAmt(e);if(Math.abs(e.clientX-h.x0)>4){h.moved=true;h.rest=false;}
    dicePos(h.a,false);
    if(h.moved&&!h.used&&!diceRaf)diceRaf=requestAnimationFrame(()=>{diceRaf=0;if(diceHeld===h&&!h.used)diceAll(h);});
  });
  const diceUp=e=>{
    const h=diceHeld;if(!h||h.id!==e.pointerId)return;diceHeld=null;diceEl.classList.remove('held');
    if(e.type==='pointerup'&&!h.used&&(h.a>0.01||h.base))ready.then(()=>diceAll(h));
    dicePos(0,true);
  };
  ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>diceEl.addEventListener(ev,diceUp));
  diceEl.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;e.preventDefault();initAudio();
    const t=T();ready.then(()=>diceAll({a:0.5,t,seed:(Math.random()*4294967296)>>>0}));});

  // ---------- clips ----------
  // Capture saves the sequence as it is now, with its loop, field, ORDER, SKIP and SKIP/GAP mode, to the end
  // of the Clips list and selects it. Clips never change once saved: Load copies one into the sequencer
  // (with its loop and field) to edit. The Clips page is for jamming: tapping a clip selects it and loops it
  // (from the next bar line if something is playing), until another clip is tapped or Stop is pressed.
  // a clip in engine form: its patterns, its SKIP/GAP mode, its field's settings and signal order, and the
  // key of its loop (sent to the engine first)
  function clipEngine(k,send){if(send!==false)engineLoop(k.loop);
    return {id:k.id,cols:k.cols,n:k.n,slots:k.slots,ord:ordOf(tr0(),k.orderV),mute:muteOf(tr0(),k.muteV),silPat:k.silPat||'mute',loop:k.loop,
      cfg:k.field?k.field.cfg:null,rank:k.field?EF.rankOf(fieldOrder(k.field)):null};}
  const newClipId=()=>'k'+(++idCtr)+Math.random().toString(36).slice(2,6);
  // a clip from the sequence as it is now
  function clipOf(t,src){return {id:newClipId(),num:++clipNum,cols:src.cols,n:src.n,slots:src.slots.map(copySlot),orderV:src.orderV,muteV:src.muteV,silPat:src.silPat||'mute',loop:t.kind,field:cloneField(t.field)};}
  function flashCapture(){for(const b of [capBtn,sessBtn]){b.classList.remove('flash');void b.offsetWidth;b.classList.add('flash');}}
  capBtn.addEventListener('click',()=>{
    if(sessOn)return;const t=T(),src=t.seq||blankClip(t);checkpoint();
    const k=clipOf(t,src);clips.push(k);selClip=k;
    if(t.seq){t.seq.src=k.id;t.seq.num=k.num;t.seq.edited=false;}   // the lane now shows its number
    flashCapture();paintIcons();
  });
  // Load: the selected clip goes into the sequencer (a copy; the clip itself stays as it is), with its loop
  // and field, and the field page opens. If the clip was playing, it carries on playing there.
  loadBtn.addEventListener('click',()=>{
    const k=selClip;if(!k)return;checkpoint();const t=T();
    if(k.loop&&k.loop!==t.kind)setLoop(t,k.loop);
    if(k.field)useField(t,fieldFromClip(k));
    loadSeq(t,withSettings({id:'q'+(++idCtr),cols:k.cols,n:k.n,slots:k.slots.map(copySlot),src:k.id,num:k.num},k));
    showPage('field');
  });
  // GAP makes a sequence drift against the bar: it repeats exactly after L / gcd(steps played per bar, L)
  // bars (L: its length). With SKIP, or no gaps, that is one bar.
  const gcd=(a,b)=>b?gcd(b,a%b):a;
  function cycleBars(k){
    if((k.silPat||'mute')!=='insert')return 1;
    const bits=EF.skipPattern(k.muteV,k.n);if(!bits)return 1;
    const per=bits.reduce((s,b)=>s+b,0),L=k.slots.length;
    return per?L/gcd(per,L):1;
  }
  function songRowsOf(list,full){return list.map(k=>({bars:full?cycleBars(k):1,clips:[clipEngine(k)]}));}
  // tap a clip: it is selected and loops (from the next bar line if something is playing)
  function playClips(k){
    if(!clips.includes(k))return;selClip=k;songPlaying=true;songList=[k];
    initAudio();ready.then(()=>{tx({type:'live',tr:0,ord:null,mute:null});tx({type:'song',rows:songRowsOf(songList),from:0,once:false});});
    liveV.order=liveV.mute=null;paintIcons();updateSession();
  }
  function onSongRow(m){if(!songPlaying)return;updateSession();}
  // the clip stopped (Stop): the engine goes back to the sequencer's sequence
  function songEnded(){
    if(!songPlaying)return;songPlaying=false;songList=[];const t=T();
    tx({type:'launch',tr:t.i,clip:t.seq?clipForm(t.seq):null});sendRec();paintIcons();updateSession();
  }
  // after the list changes while a clip plays: if the playing clip went, the new selection takes over
  function resyncSong(){
    if(!songPlaying)return;
    const cur=songList[0];if(cur&&clips.includes(cur))return;
    if(!selClip){stopAll();return;}
    songList=[selClip];tx({type:'songRows',rows:songRowsOf(songList),idx:0});
  }
  function stopAll(){intent=null;tx({type:'stop'});songEnded();}
  function deleteClips(list){
    const gone=new Set(list.filter(k=>clips.includes(k)));if(!gone.size)return;checkpoint();
    if(selClip&&gone.has(selClip)){
      // the selection moves to the next clip that is left, or the one before
      const i=clips.indexOf(selClip);selClip=clips.slice(i+1).find(k=>!gone.has(k))||clips.slice(0,i).reverse().find(k=>!gone.has(k))||null;
    }
    clips=clips.filter(k=>!gone.has(k));
    resyncSong();renderSession();paintIcons();
  }
  let sessBusy=0,sessDirty=false;
  const busy=on=>{sessBusy+=on?1:-1;if(sessBusy<0)sessBusy=0;if(!sessBusy&&sessDirty){sessDirty=false;renderSession();}};
  // A clip held down can be deleted by tapping the trash; with the trash held, tapping a clip deletes it.
  // A tap (released without either) selects the clip and plays from it.
  const clipHolds=new Map(),clipCvs=new Map();   // clipCvs: each row's canvas, so the playing clip can light its step
  function takeRow(k,i){
    const row=el('div',{className:'take'});row.dataset.i=i;
    const hdl=el('div',{className:'hdl',title:'Drag to move this clip'});hdl.innerHTML=ICON.handle;rowMover(hdl,k);
    const th=el('button',{type:'button',className:'th',title:'Loop clip '+k.num+' · '+loopName(k.loop)+(k.field?' · '+k.field.name:'')});const cv=el('canvas');
    cv.style.height=((k.n>8?2:1)*LROW+4)+'px';th.appendChild(cv);clipCvs.set(k.id,cv);
    th.addEventListener('pointerdown',e=>{
      if(trashHeld){trashHeld.used=true;deleteClips([k]);return;}
      clipHolds.set(e.pointerId,{k,used:false,row});row.classList.add('held');
    });
    const up=e=>{const h=clipHolds.get(e.pointerId);if(!h)return;clipHolds.delete(e.pointerId);row.classList.remove('held');
      if(e.type==='pointerup'&&!h.used){initAudio();checkBlocked();playClips(k);}};
    ['pointerup','pointercancel','pointerleave'].forEach(ev=>th.addEventListener(ev,up));
    th.addEventListener('click',e=>{if(e.detail===0){initAudio();playClips(k);}});   // keyboard
    row.append(hdl,th);
    requestAnimationFrame(()=>drawClipLane(cv,k,-1));
    return row;
  }
  // Lightweight refresh: only classes change, so a drag in progress is never rebuilt away.
  function updateSession(){
    if(!sessOn)return;
    const pi=songPlaying&&st.song?st.song.idx:-1,now=pi>=0?songList[pi]:null;
    takeList.querySelectorAll('.take').forEach(r=>{const k=clips[+r.dataset.i];if(!k)return;
      r.classList.toggle('now',st.playing&&k===now);r.classList.toggle('sel',k===selClip);});
  }
  function renderSession(){
    if(!sessOn)return;
    if(sessBusy){sessDirty=true;return;}
    takeList.textContent='';clipHolds.clear();clipCvs.clear();
    if(!clips.length){takeList.appendChild(el('p',{className:'takes-empty',textContent:'No clips yet. On the field, Capture saves the sequence as it is now; a game round saves every bar.'}));return;}
    clips.forEach((k,i)=>takeList.appendChild(takeRow(k,i)));
    updateSession();
  }
  // Drag a clip's handle up or down to move it: a line between two clips shows where it will land.
  function rowMover(node,k){
    let s0=null;const line=el('div',{className:'dropline'});
    // the gap the finger is nearest: 0 is above the first clip, clips.length below the last
    const gapAt=y=>{const rows=[...takeList.querySelectorAll('.take')];let g=rows.length;
      for(let i=0;i<rows.length;i++){const b=rows[i].getBoundingClientRect();if(y<b.top+b.height/2){g=i;break;}}return {g,rows};};
    const showLine=y=>{const {g,rows}=gapAt(y),from=clips.indexOf(k);
      if(g===from||g===from+1||!rows.length){line.remove();return;}
      const lb=takeList.getBoundingClientRect(),rb=rows[Math.min(g,rows.length-1)].getBoundingClientRect();
      const top=g<rows.length?rb.top-2:rb.bottom+2;line.style.top=(top-lb.top)+'px';if(!line.parentNode)takeList.appendChild(line);};
    node.addEventListener('pointerdown',e=>{e.preventDefault();s0={y:e.clientY,id:e.pointerId,drag:false};busy(true);try{node.setPointerCapture(e.pointerId);}catch(_){}});
    node.addEventListener('pointermove',e=>{
      if(!s0||e.pointerId!==s0.id)return;
      if(e.pointerType==='mouse'&&e.buttons===0){end(e);return;}
      if(!s0.drag&&Math.abs(e.clientY-s0.y)>6){s0.drag=true;ghost.textContent=String(k.num);ghost.hidden=false;}
      if(s0.drag){ghost.style.left=e.clientX+'px';ghost.style.top=e.clientY+'px';showLine(e.clientY);
        const b=sessScroll.getBoundingClientRect();if(e.clientY<b.top+30)sessScroll.scrollTop-=8;else if(e.clientY>b.bottom-30)sessScroll.scrollTop+=8;}
    });
    const end=e=>{
      if(!s0||e.pointerId!==s0.id)return;const s=s0;s0=null;ghost.hidden=true;line.remove();busy(false);
      if(!s.drag)return;
      const {g}=gapAt(e.clientY),from=clips.indexOf(k);if(from<0||g===from||g===from+1)return;
      checkpoint();clips.splice(from,1);clips.splice(g>from?g-1:g,0,k);resyncSong();renderSession();
    };
    node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);
    node.addEventListener('lostpointercapture',e=>{if(s0&&e.pointerId===s0.id&&!s0.drag){s0=null;busy(false);}});
  }
  // Switching pages. Leaving the Clips page without Load, the sequencer's own sequence plays again (from
  // the next bar line if a clip was playing).
  function showPage(p){
    if(p===page)return;const from=page;
    for(const id of [...special.keys(),...ptrs.keys(),...editing.keys()])end({pointerId:id,type:'pointercancel'});laneHolds.clear();laneHold=null;clipHolds.clear();
    if(p!=='field'&&fieldEdit)setFieldEdit(false);
    page=p;sessOn=p==='clips';
    sessEl.hidden=!sessOn;wrap.hidden=p!=='field';laneCv.hidden=p!=='field';
    if(from==='clips'){
      if(songPlaying){songPlaying=false;songList=[];tx({type:'songStop'});}
      const t=T(),f=info(t.i),id=t.seq?t.seq.id:null;
      if(f.clipId!==id||f.clipQ!==undefined)tx({type:'launch',tr:t.i,clip:t.seq?clipForm(t.seq):null});
      sendRec();
    }
    if(sessOn){if(!selClip&&clips.length)selClip=clips[clips.length-1];renderSession();
      const r=takeList.querySelector('.take.sel');if(r)r.scrollIntoView({block:'nearest'});else sessScroll.scrollTop=sessScroll.scrollHeight;}
    if(p==='field')requestAnimationFrame(resize);
    paintIcons();
  }
  sessBtn.addEventListener('click',()=>{if(gameOn)return;showPage(sessOn?'field':'clips');});

  let sessKey='';
  function onStatus(m){
    gotStatus=true;m.recv=performance.now();const was=st.playing;st=m;
    if(was!==m.playing){if(!m.playing){intent=null;songEnded();}paintIcons();}
    clearBtn.disabled=sessOn?!selClip:seqEmpty(T());paintUndo();
    if(sessOn){const k=(m.song?m.song.idx:-1)+'|'+m.playing+'|'+(selClip?selClip.id:'');if(k!==sessKey){sessKey=k;updateSession();}}
    const lr=laneInfo().rows;if(lr!==laneRows)computeLayout();
  }

  // ---------- hard reset (from Preferences) ----------
  async function hardReset(){
    gen++;
    try{if(workletNode){workletNode.port.postMessage({type:'stop'});workletNode.port.onmessage=null;workletNode.disconnect();}}catch(_){}
    try{if(spKeep){spKeep.onaudioprocess=null;spKeep.disconnect();spKeep=null;}}catch(_){}
    const old=actx;actx=null;ready=null;send=null;workletNode=null;usingFallback=false;gotStatus=false;intent=null;
    try{if(old)await old.close();}catch(_){}
    if(mediaEl){try{mediaEl.pause();}catch(_){}}
    ptrs.clear();special.clear();laneHolds.clear();laneHold=null;trashHeld=null;diceHeld=null;clipHolds.clear();
    const keep=tracks[0].kind==='break'&&tracks[0].buf&&tracks[0].buf.L.length===loopLen(48000)?tracks[0]:null;
    if(gameOn)endGame(false);if(fieldEdit)setFieldEdit(false);
    fields=[presetField('all')];tracks[0]=newTrack(0,'break',fields[0]);if(keep){tracks[0].buf=keep.buf;tracks[0].pk=keep.pk;}
    tracks[0].seq=blankClip(tracks[0]);
    view=0;clips=[];clipNum=0;selClip=null;songPlaying=false;songList=[];recOn=false;recBn=-1;
    bpm=124;swing=0;stepped=true;playMode='replace';fxOnly=false;
    Object.assign(prefs,PREF0);
    Object.assign(pin,PIN0);liveV.order=liveV.mute=null;undoS.length=0;redoS.length=0;
    st={playing:false,t:0,len:1,tracks:[],hist:[],song:null,recv:0};
    press(playBtn,false);clearBtn.disabled=true;
    bpmEl.querySelector('b').textContent='124';swingEl.querySelector('b').textContent='50';
    files.clear();soundSel.querySelectorAll('option[value^="f:"]').forEach(o=>o.remove());sentLoops.clear();
    soundSel.value='break';
    if(page!=='field'){page='field';sessOn=false;sessEl.hidden=true;wrap.hidden=false;laneCv.hidden=false;clipHolds.clear();}
    cur={id:null,name:'',folder:''};
    computeLayout();
    sheet.hidden=true;paintIcons();requestAnimationFrame(resize);
    (function pre(){let n=0;const nx=()=>{if(n>=tracks.length)return;const t=tracks[n++];if(!t.buf){t.buf=buildLoop(t,48000);t.pk=peaks(t.buf);}setTimeout(nx,10);};setTimeout(nx,0);})();
    savedSig=projSig();
  }

  // ---------- fields: switching and editing ----------
  // The Fields sheet lists the project's fields. Loading one keeps the loop and clears the sequence (Undo
  // brings it back). Edit opens the editor on the field itself: drag a cell to move it, its top or bottom edge
  // to resize it (cells may overlap), × to take it out, tap it for its settings.
  let fieldSendRaf=0;
  const editing=new Map();
  function useField(t,f){if(!fields.includes(f))fields.push(f);t.field=f;sendField(t);computeLayout();}
  // after a layout or settings change: the engine follows (once per frame)
  function fieldEdited(t){computeLayout();if(!fieldSendRaf)fieldSendRaf=requestAnimationFrame(()=>{fieldSendRaf=0;sendField(t);});}
  // the field a clip was captured on, as one of the project's fields (added if it changed since)
  function fieldFromClip(k){
    const same=fields.find(f=>f.id===k.field.id);
    if(same&&sameField(same,k.field))return same;
    const nf=cloneField(k.field);if(same){nf.id=newFieldId();nf.name=k.field.name+' · clip '+k.num;}
    fields.push(nf);return nf;
  }
  function loadField(f){
    const t=T();if(f===t.field)return;checkpoint();
    useField(t,f);if(!seqEmpty(t))loadSeq(t,blankClip(t,t.seq),true);
    paintIcons();
  }
  // a small picture of a field: its cells as coloured bands (overlaps see-through)
  function fieldThumb(f,w,h){
    const cv=el('canvas'),d=Math.min(3,window.devicePixelRatio||1);cv.width=w*d;cv.height=h*d;cv.style.width=w+'px';cv.style.height=h+'px';
    const c=cv.getContext('2d');c.scale(d,d);c.fillStyle='#15171c';c.fillRect(0,0,w,h);
    for(const x of sortedCells(f)){c.globalAlpha=0.7;c.fillStyle=`hsl(${FX[fxKey(x.k)].hue} 55% ${x.k==='center'?38:48}%)`;c.fillRect(1,x.y/FG*h+0.5,w-2,Math.max(1,x.h/FG*h-1));}
    return cv;
  }
  fieldBtn.addEventListener('click',()=>openFields());
  function openFields(){
    openSheet('Fields',cardEl=>{
      const t=T(),list=el('div',{className:'fieldlist'});
      const paint=()=>{
        list.textContent='';
        for(const f of fields){
          const row=el('div',{className:'frow'+(f===t.field?' cur':'')}),b=el('button',{type:'button',className:'pb'});
          const n=f.cells.length;b.append(fieldThumb(f,30,36),el('span',{},[el('b',{textContent:f.name}),el('small',{textContent:(f===t.field?'on the field · ':'')+n+(n>1?' cells':' cell')+' · '+sortedCells(f).map(c=>c.k==='center'?'loop':FX[c.k].name.toLowerCase()).join(', ')})]));
          b.addEventListener('click',()=>{loadField(f);closeSheet();});
          const del=el('button',{type:'button',className:'ic',title:'Delete this field (clips keep their own copy)',disabled:fields.length<2||f===t.field});del.innerHTML=ICON.trash;
          del.addEventListener('click',()=>{checkpoint();fields=fields.filter(x=>x!==f);paint();});
          row.append(b,del);list.appendChild(row);
        }
      };
      paint();
      const name=el('input',{type:'text',value:t.field.name,maxLength:30,spellcheck:false});name.style.cssText='flex:1;min-width:0;height:32px;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:0 8px';
      name.addEventListener('change',()=>{const v=name.value.trim();if(v){t.field.name=v;paint();}});
      const edit=el('button',{type:'button',textContent:'Edit layout'});edit.addEventListener('click',()=>{closeSheet();setFieldEdit(true);});
      const dup=el('button',{type:'button',textContent:'Duplicate'});dup.addEventListener('click',()=>{checkpoint();const f=cloneField(t.field);f.id=newFieldId();f.name=t.field.name+' 2';fields.push(f);t.field=f;sendField(t);computeLayout();paint();name.value=f.name;});
      cardEl.appendChild(el('div',{},[el('h3',{},['This field']),el('div',{className:'btnrow'},[name,edit,dup])]));
      cardEl.appendChild(el('div',{},[el('h3',{},['Fields in this project']),list,el('p',{},['Loading a field keeps the loop and clears the sequence (Undo brings it back). Clips keep the field they were captured on; Load puts it back.'])]));
      const rnd=el('button',{type:'button',textContent:'Random field'});rnd.addEventListener('click',()=>{const f=randomField();fields.push(f);loadField(f);closeSheet();});
      const pre=el('select');pre.appendChild(el('option',{value:'',textContent:'New from a preset…'}));for(const k in PRESETS)pre.appendChild(el('option',{value:k,textContent:PRESETS[k].name}));
      pre.addEventListener('change',()=>{if(!pre.value)return;const f=presetField(pre.value);fields.push(f);loadField(f);closeSheet();});
      cardEl.appendChild(el('div',{},[el('h3',{},['New field']),el('div',{className:'btnrow'},[rnd,pre]),el('p',{},['Top to bottom is the signal order: each step’s effects run in the order of their cells (Delay and Reverb, which ring on after the step, always come last). Where cells overlap, a touch drives all of them, each by its place in its own cell.'])]));
    });
  }
  // the editor's bar, over the bottom of the field
  function setFieldEdit(on){
    fieldEdit=on;fieldBar.hidden=!on;for(const id of [...editing.keys()])editing.delete(id);
    if(on){
      for(const id of [...special.keys(),...ptrs.keys()])end({pointerId:id,type:'pointercancel'});
      fieldBar.textContent='';const t=T();
      const add=el('select',{title:'Add an effect'});
      const fill=()=>{add.textContent='';add.appendChild(el('option',{value:'',textContent:'+ Add…'}));
        for(const k of ['center'].concat(ALL_FX))if(!t.field.cells.some(c=>c.k===k))add.appendChild(el('option',{value:k,textContent:k==='center'?'Loop / filter':FX[k].name}));
        add.disabled=add.options.length<2;};
      add.addEventListener('change',()=>{if(add.value){addCell(t,add.value);fill();}});fill();fieldBar.fill=fill;
      const even=el('button',{type:'button',textContent:'Even out',title:'Stack every cell top to bottom with no overlaps or gaps, keeping their sizes in proportion'});
      even.addEventListener('click',()=>{checkpoint();evenOut(t.field);fieldEdited(t);});
      const done=el('button',{type:'button',className:'play',textContent:'Done'});done.addEventListener('click',()=>setFieldEdit(false));
      fieldBar.append(add,even,el('span',{className:'hint'}),done);
    }
    computeLayout();paintIcons();
  }
  // a new cell goes in the largest free space, or takes the lower half of the tallest cell
  function addCell(t,k){
    checkpoint();const f=t.field,cover=new Array(FG).fill(0);f.cells.forEach(c=>{for(let u=c.y;u<c.y+c.h&&u<FG;u++)cover[u]++;});
    let best=null;for(let u=0;u<FG;){if(cover[u]){u++;continue;}let v=u;while(v<FG&&!cover[v])v++;if(!best||v-u>best.h)best={y:u,h:v-u};u=v;}
    if(best&&best.h>=2)f.cells.push({k,y:best.y,h:best.h});
    else{const big=f.cells.reduce((a,b)=>b.h>a.h?b:a),h=Math.floor(big.h/2);big.h-=h;f.cells.push({k,y:big.y+big.h,h});}
    fieldEdited(t);
  }
  function evenOut(f){
    const cs=sortedCells(f),sum=cs.reduce((a,c)=>a+c.h,0);let y=0;
    cs.forEach((c,i)=>{const h=i===cs.length-1?FG-y:Math.max(2,Math.round(c.h*FG/sum));c.y=y;c.h=Math.max(1,Math.min(h,FG-y-(cs.length-1-i)*2));y+=c.h;});
  }
  // the editor shows overlapping cells side by side (one column per lane), each at its true height
  function editRect(r){const cw=(cssW-HW)/r.lanes;return {x:HW+r.lane*cw+2,w:cw-4,y:r.b0+1,h:r.b1-r.b0-2};}
  function editDown(id,x,y){
    const t=T();let ri=-1;
    lay.forEach((r,i)=>{const q=editRect(r);if(x>=q.x&&x<q.x+q.w&&y>=q.y&&y<q.y+q.h)ri=i;});
    if(ri<0)return;const r=lay[ri],q=editRect(r),c=t.field.cells[r.ci];
    if(x>q.x+q.w-24&&y<q.y+22&&t.field.cells.length>1){checkpoint();t.field.cells.splice(r.ci,1);fieldEdited(t);if(fieldBar.fill)fieldBar.fill();return;}
    const ez=Math.min(14,q.h/3),mode=y<q.y+ez?'top':y>q.y+q.h-ez?'bot':'move';
    editing.set(id,{c,k:c.k,mode,y0:y,c0:{y:c.y,h:c.h},moved:false,cp:false});
  }
  function editMove(id,x,y){
    const e=editing.get(id),t=T();if(!e)return;
    const du=Math.round((y-e.y0)/Math.max(1,fieldH()-TOP)*FG),c=e.c,c0=e.c0;if(!du&&!e.moved)return;
    if(Math.abs(y-e.y0)>6)e.moved=true;
    let ny=c.y,nh=c.h;
    if(e.mode==='move'){ny=clamp(c0.y+du,0,FG-c0.h);nh=c0.h;}
    else if(e.mode==='top'){ny=clamp(c0.y+du,0,c0.y+c0.h-2);nh=c0.y+c0.h-ny;}
    else{nh=clamp(c0.h+du,2,FG-c0.y);}
    if(ny===c.y&&nh===c.h)return;
    if(!e.cp){e.cp=true;checkpoint();}
    c.y=ny;c.h=nh;fieldEdited(t);
  }
  function editUp(id,tap){const e=editing.get(id);editing.delete(id);if(e&&tap&&!e.moved)openSettings(e.k);}
  function drawEdit(fs){
    const t=T();
    // the grid's units, faintly
    g.fillStyle='rgba(255,255,255,.035)';for(let u=0;u<=FG;u+=4){const y=TOP+u/FG*(fieldH()-TOP);g.fillRect(HW,y,cssW-HW,1);}
    g.fillStyle='#ece7dc';g.font=`600 ${fs}px ${FONT}`;g.textAlign='left';g.textBaseline='middle';g.fillText('EDITING · '+t.field.name.toUpperCase(),8,STRIP/2);
    g.fillStyle='#8a8f99';g.font=`400 ${fs}px ${FONT}`;g.fillText('Top to bottom = signal order · drag, resize, tap',8,STRIP+4+STRIP/2);
    lay.forEach(r=>{
      const q=editRect(r),hue=hueOf(t,r.id),held=[...editing.values()].some(e=>e.k===r.id);
      g.fillStyle=`hsla(${hue} 45% ${r.id==='center'?26:30}% / .9)`;rr(q.x,q.y,q.w,q.h,6);g.fill();
      g.strokeStyle=held?'#fff':`hsl(${hue} 70% 60%)`;g.lineWidth=held?2:1.2;rr(q.x,q.y,q.w,q.h,6);g.stroke();
      // grips at the top and bottom edges
      g.fillStyle=`hsla(${hue} 80% 80% / .7)`;const gw=Math.min(28,q.w/3);g.fillRect(q.x+q.w/2-gw/2,q.y+3,gw,2);g.fillRect(q.x+q.w/2-gw/2,q.y+q.h-5,gw,2);
      g.fillStyle='#fff';g.font=`600 ${fs}px ${FONT}`;g.textAlign='left';g.textBaseline='middle';
      const nm=r.id==='center'?'LOOP':FX[r.id].name.toUpperCase(),cy=q.h>34?q.y+14:q.y+q.h/2;
      g.save();g.beginPath();g.rect(q.x,q.y,q.w-24,q.h);g.clip();g.fillText(nm,q.x+8,cy);g.restore();
      const c=t.field.cells[r.ci];g.fillStyle='rgba(255,255,255,.6)';g.font=`400 ${fs-1}px ${FONT}`;if(q.h>34)g.fillText(c.h+' / '+FG,q.x+8,cy+14);
      if(t.field.cells.length>1){g.strokeStyle='rgba(255,255,255,.75)';g.lineWidth=1.5;const bx=q.x+q.w-15,by=q.y+10;g.beginPath();g.moveTo(bx-4,by-4);g.lineTo(bx+4,by+4);g.moveTo(bx+4,by-4);g.lineTo(bx-4,by+4);g.stroke();}
    });
    // the handle column: each cell's place in the signal order
    sortedCells(t.field).forEach((c,i)=>{const r=lay.find(x=>x.ci===t.field.cells.indexOf(c));if(!r)return;
      g.fillStyle='#6c7380';g.font=`600 ${fs}px ${FONT}`;g.textAlign='center';g.fillText(String(i+1),HW/2-2+(r.lanes>1?(r.lane-(r.lanes-1)/2)*10:0),r.b0+10);});
  }

  // ---------- sheets ----------
  function openSheet(title,build){
    card.textContent='';card.className='card';
    const head=el('div',{className:'sheethead'}),h=el('h2');
    (Array.isArray(title)?title:[title]).forEach(x=>h.appendChild(typeof x==='string'?document.createTextNode(x):x));
    const x=el('button',{type:'button',className:'x',title:'Close'});x.innerHTML=ICON.x;x.setAttribute('aria-label','Close');x.addEventListener('click',()=>closeSheet());
    head.appendChild(h);head.appendChild(x);card.appendChild(head);
    build(card);sheet.hidden=false;x.focus();
  }
  let sheetOnClose=null;
  function closeSheet(){sheet.hidden=true;computeLayout();if(sheetOnClose){const f=sheetOnClose;sheetOnClose=null;f();}}
  sheet.addEventListener('pointerdown',e=>{if(e.target===sheet)closeSheet();});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)closeSheet();});

  const el=(tag,props,kids)=>{const n=document.createElement(tag);if(props)Object.assign(n,props);(kids||[]).forEach(k=>n.appendChild(typeof k==='string'?document.createTextNode(k):k));return n;};
  function radios(name,choices,cur,on){
    const box=el('div',{className:'opt'});
    choices.forEach(([v,lab])=>{const i=el('input',{type:'radio',name,value:v,checked:v===cur,id:name+'-'+v});i.addEventListener('change',()=>on(v));box.appendChild(el('label',{htmlFor:i.id},[i,lab]));});
    return box;
  }
  // Vertical slider for one effect parameter. With "Cell" ticked it has two handles: the values the
  // cell's bottom and top play (for centred parameters, the values below and above the centre band).
  function vcol(t,k,n,changed){
    const P=FX[k].params[n],c=t.cfg[k];
    const col=el('div',{className:'vcol'}),valT=el('div',{className:'vval'}),valB=el('div',{className:'vval'});
    const track=el('div',{className:'vtrack',tabIndex:0});track.setAttribute('role','slider');track.setAttribute('aria-label',P.name);
    const fill=el('i',{className:'vfill'}),thH=el('b',{className:'vth'}),thL=el('b',{className:'vth lo'});
    if(P.bip)track.appendChild(el('s',{className:'vzero'}));
    track.appendChild(fill);track.appendChild(thH);track.appendChild(thL);
    const cb=el('input',{type:'checkbox',checked:c.cells.includes(n)});
    const toY=v=>P.bip?(1-v)/2:1-v, fromY=f=>P.bip?clamp(1-2*f,-1,1):clamp(1-f,0,1);
    const on=()=>c.cells.includes(n);
    function paint(){
      col.classList.toggle('cell',on());
      if(on()){
        const yh=toY(c.hi[n]),yl=toY(c.lo[n]);thH.style.top=yh*100+'%';thL.style.top=yl*100+'%';thL.hidden=false;
        fill.style.top=Math.min(yh,yl)*100+'%';fill.style.height=Math.abs(yl-yh)*100+'%';
        valT.textContent=P.lab(c.hi[n],c.o);valB.textContent=P.lab(c.lo[n],c.o);
      }else{
        const y=toY(c.x[n]),z=P.bip?0.5:1;thH.style.top=y*100+'%';thL.hidden=true;
        fill.style.top=Math.min(y,z)*100+'%';fill.style.height=Math.abs(z-y)*100+'%';
        valT.textContent=P.lab(c.x[n],c.o);valB.textContent=' ';
      }
    }
    let drag=null;
    function set(v){
      if(drag==='x')c.x[n]=v;
      else if(P.bip){if(drag==='hi')c.hi[n]=Math.max(0.02,v);else c.lo[n]=Math.min(-0.02,v);}
      else c[drag][n]=v;
      paint();changed();
    }
    const fAt=e=>{const b=track.getBoundingClientRect();return clamp((e.clientY-b.top)/b.height,0,1);};
    track.addEventListener('pointerdown',e=>{
      e.preventDefault();const f=fAt(e);
      drag=on()?(Math.abs(f-toY(c.hi[n]))<=Math.abs(f-toY(c.lo[n]))?'hi':'lo'):'x';
      try{track.setPointerCapture(e.pointerId);}catch(_){}set(fromY(f));
    });
    track.addEventListener('pointermove',e=>{if(!drag)return;if(e.pointerType==='mouse'&&e.buttons===0){drag=null;return;}set(fromY(fAt(e)));});
    const up=()=>{drag=null;};['pointerup','pointercancel','lostpointercapture'].forEach(ev=>track.addEventListener(ev,up));
    track.addEventListener('keydown',e=>{const d={ArrowUp:0.02,ArrowDown:-0.02}[e.key];if(!d)return;e.preventDefault();
      drag=on()?(e.shiftKey?'lo':'hi'):'x';const cur=drag==='x'?c.x[n]:c[drag][n];set(clamp(cur+d,P.bip?-1:0,1));drag=null;});
    cb.addEventListener('change',()=>{if(cb.checked){if(!on())c.cells.push(n);}else c.cells=c.cells.filter(q=>q!==n);paint();changed();});
    col.appendChild(el('div',{className:'vname'},[P.name]));col.appendChild(valT);col.appendChild(track);col.appendChild(valB);
    col.appendChild(el('label',{className:'vcb'},[cb,'Cell']));
    paint();return {col,paint};
  }
  // Scale picker plus a one-octave keyboard (pitch 0 = C). Tapping keys makes a custom scale.
  function scaleEditor(c,id,changed){
    const box=el('div',{className:'opt'}),sel=el('select',{id});
    EF.FX.pitch.opts.scale.choices.forEach(([v,l])=>sel.appendChild(el('option',{value:v,textContent:l})));
    sel.value=c.o.scale;
    const kb=el('div',{className:'keys'}),BLACK=[1,3,6,8,10];
    const paint=()=>kb.querySelectorAll('button').forEach(b=>{const pc=+b.dataset.pc;press(b,c.o.mask[pc]);b.title=(c.o.mask[pc]?'Remove ':'Add ')+EF.NOTES[pc];});
    for(let pc=0;pc<12;pc++){
      const b=el('button',{type:'button',className:BLACK.includes(pc)?'blk':'wht',textContent:EF.NOTES[pc]});b.dataset.pc=pc;
      b.addEventListener('click',()=>{c.o.mask[pc]=!c.o.mask[pc];c.o.scale='custom';sel.value='custom';paint();changed();});
      kb.appendChild(b);
    }
    sel.addEventListener('change',()=>{c.o.scale=sel.value;if(sel.value!=='custom')c.o.mask=EF.maskOf(EF.SCALES[sel.value]);paint();changed();});
    box.appendChild(el('h3',{},['Scale · root C']));box.appendChild(sel);box.appendChild(kb);
    paint();return box;
  }
  function openSettings(rowId){
    const t=T(),k=rowId==='center'?'filter':rowId,d=FX[k],c=t.cfg[k];
    const dot=el('i');dot.style.cssText=`width:12px;height:12px;border-radius:50%;background:hsl(${c.hue} 70% 58%)`;
    let raf=0,cols=[];
    // every change reaches the engine straight away, so a playing sequence follows the new settings
    let cp=false;   // the first change is an undo step
    const changed=()=>{if(!cp){cp=true;checkpoint();}cols.forEach(x=>x.paint());if(!raf)raf=requestAnimationFrame(()=>{raf=0;sendCfg(t);});};
    sheetOnClose=()=>{sendCfg(t);push(t);};
    openSheet([dot,rowId==='center'?'Filter':d.name],cardEl=>{
      if(d.opts)for(const on in d.opts){
        const od=d.opts[on];
        if(on==='scale'){cardEl.appendChild(scaleEditor(c,k+'-scale',changed));continue;}
        cardEl.appendChild(el('div',{},[el('h3',{},[od.name]),radios(k+'-'+on,od.choices,c.o[on],v=>{c.o[on]=v;changed();})]));
      }
      const names=Object.keys(d.params);
      if(names.length){cols=names.map(n=>vcol(t,k,n,changed));cardEl.appendChild(el('div',{className:'vrow'},cols.map(x=>x.col)));}
    });
  }
  prefsBtn.addEventListener('click',()=>openSheet('Preferences',cardEl=>{
    const sendPref=()=>tx(prefMsg());
    // a confirm box under a control, for changes that delete sequences
    function confirmBox(){
      const w=el('div',{className:'warn'});w.hidden=true;
      w.ask=(text,label,go,cancel)=>{
        w.textContent='';const g=el('button',{type:'button',className:'danger',textContent:label}),n=el('button',{type:'button',textContent:'Cancel'});
        g.addEventListener('click',()=>{w.hidden=true;go();});n.addEventListener('click',()=>{w.hidden=true;if(cancel)cancel();});
        w.appendChild(el('span',{},[text]));w.appendChild(el('span',{className:'wb'},[g,n]));w.hidden=false;
      };
      return w;
    }
    // grid and bar length; either change deletes the sequences, so it asks first
    const gbox=el('div',{className:'opt'});
    tracks.forEach(t=>{
      const row=el('div',{className:'gridrow'}),w=confirmBox();
      let cols=t.colsQ||t.cols,len=t.len16;
      const out=el('span',{className:'blen'});
      function tryShape(nc,nl){
        if(nc===cols&&nl===len){w.hidden=true;return;}
        const count=clips.length,go=()=>{cols=nc;len=nl;setShape(t,nc,nl);paint();};
        if(!count&&seqEmpty(t)){w.hidden=true;go();return;}
        w.ask('This clears the sequence'+(count?' and your '+count+(count>1?' clips':' clip'):'')+'.','Change',go);
      }
      const btns=[16,8].map(n=>{const b=el('button',{type:'button',textContent:'1/'+n});b.dataset.n=n;
        b.addEventListener('click',()=>{const st=16/n;tryShape(n,Math.max(st,Math.round(len/st)*st));});return b;});
      const minus=el('button',{type:'button',textContent:'−',title:'Shorter bar'}),plus=el('button',{type:'button',textContent:'+',title:'Longer bar'});
      minus.addEventListener('click',()=>tryShape(cols,Math.max(16/cols,len-16/cols)));
      plus.addEventListener('click',()=>tryShape(cols,Math.min(16,len+16/cols)));
      function paint(){btns.forEach(b=>press(b,+b.dataset.n===cols));out.textContent=(len*cols/16)+' steps';}
      paint();
      row.appendChild(el('span',{className:'seg'},btns));
      row.appendChild(el('span',{className:'seg blen-ctl'},[minus,out,plus]));
      gbox.appendChild(row);gbox.appendChild(w);
    });
    cardEl.appendChild(el('div',{},[el('h3',{},['Grid and bar length']),gbox]));
    // SKIP or GAP belongs to the sequence (or the plain loop), so it is saved with clips
    cardEl.appendChild(el('div',{},[el('h3',{},['Second slider · this sequence']),radios('p-silp',[['mute','SKIP: its steps go quiet; the sequence keeps moving'],['insert','GAP: a quiet step is inserted; the sequence waits, so every step still plays']],silOf(T()),v=>{
      const t=T();checkpoint();ctxSet(t).silPat=v;if(t.seq)seqEdited(t);else sendPref();}),el('p',{},['Kept with the sequence, and with clips captured from it.'])]));
    const tw=el('input',{type:'checkbox',checked:prefs.touchWin});tw.addEventListener('change',()=>{prefs.touchWin=tw.checked;sendPref();});
    cardEl.appendChild(el('div',{},[el('label',{},[tw,'Touches play through SKIP and GAP']),el('p',{},['Off: the pattern silences touched steps too.'])]));
    const ol=outLat();
    cardEl.appendChild(el('div',{},[el('h3',{},['Late touches']),radios('p-grace',[['0','Always wait for the next step'],['20','Count touches up to 20 ms late as on time'],['40','Count touches up to 40 ms late as on time'],['70','Count touches up to 70 ms late as on time']],String(prefs.grace),v=>{prefs.grace=+v;sendPref();}),
      el('p',{},['A touch (or a release) this soon after a step starts counts for that step; the slice keeps its place in time. '+(ol?'This device’s '+ol+' ms output latency is added to the window.':'Any output latency the device reports is added to the window.')])]));
    // imported audio is fitted to one bar: stretched (its pitch stays) or resampled (pitch follows the speed)
    cardEl.appendChild(el('div',{},[el('h3',{},['Your own audio']),radios('p-fit',[['stretch','Stretch it to the bar (keeps its pitch)'],['resample','Resample it to the bar (pitch changes with the speed)']],prefs.fit,v=>{
      prefs.fit=v;loopCache.clear();if(T().kind.startsWith('f:'))genTrack(T());sentLoops.clear();}),el('p',{},['Up to 4 seconds of the file becomes one bar at the current tempo.'])]));
    const lat=[];
    lat.push('Audio engine: '+(!actx?'not started yet':usingFallback?'backup mode (adds about 45 ms)':'low-latency worklet'));
    if(actx){lat.push('Processing block: '+(usingFallback?2048:128)+' samples ('+((usingFallback?2048:128)/sr*1000).toFixed(1)+' ms) at '+sr+' Hz');
      const ol=(actx.outputLatency||0)+(actx.baseLatency||0);lat.push('Device output: '+(ol?Math.round(ol*1000)+' ms':'not reported by this browser'));}
    lat.push('Touches wait for the next slice: up to '+Math.round(barSec()/T().cols*1000)+' ms on this track’s grid.');
    cardEl.appendChild(el('div',{},[el('h3',{},['Latency']),...lat.map(s=>el('p',{},[s]))]));
    const rb=el('button',{type:'button',className:'danger',textContent:'Reset everything'});let arm=0;
    rb.addEventListener('click',()=>{
      if(!arm){arm=setTimeout(()=>{arm=0;rb.textContent='Reset everything';},2500);rb.textContent='Tap again to reset';return;}
      clearTimeout(arm);arm=0;hardReset();
    });
    cardEl.appendChild(el('div',{},[el('h3',{},['Testing']),rb,el('p',{},['Stops playback, shuts down the audio engine and returns every setting, the sequence and the clips to the start.'])]));
  }));
  // ---------- export ----------
  // Clips and the sequence are rendered offline (faster than real time) by a fresh engine with the same
  // loop, effect settings, tempo and swing. A single bar renders after a pre-roll of itself, so it loops
  // seamlessly (delay echoes wrap into its start). Files are 24-bit WAV, or 32-bit float. Inside claude.ai
  // the page hands them over through the downloads capability, which takes a zip (not .wav); elsewhere a
  // single file downloads as .wav and several as a .zip.
  let dlCap=null;
  try{if(window.claude&&window.claude.use)window.claude.use('downloads').then(d=>{dlCap=d;},()=>{});}catch(_){}
  const expOpt={float:false,tail:false,cycle:false};
  function wav(L,R,rate){
    const fl=expOpt.float,bps=fl?4:3,n=L.length,b=new Uint8Array(44+n*2*bps),v=new DataView(b.buffer),w=(o,s)=>{for(let i=0;i<s.length;i++)b[o+i]=s.charCodeAt(i);};
    w(0,'RIFF');v.setUint32(4,36+n*2*bps,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,fl?3:1,true);v.setUint16(22,2,true);
    v.setUint32(24,rate,true);v.setUint32(28,rate*2*bps,true);v.setUint16(32,2*bps,true);v.setUint16(34,bps*8,true);w(36,'data');v.setUint32(40,n*2*bps,true);
    let o=44;
    for(let i=0;i<n;i++)for(const x of [L[i],R[i]]){
      if(fl){v.setFloat32(o,x,true);o+=4;continue;}
      const q=Math.max(-8388608,Math.min(8388607,Math.round(x*8388607)));b[o++]=q&255;b[o++]=(q>>8)&255;b[o++]=(q>>16)&255;}
    return b;
  }
  let CRC=null;
  function crc32(d){if(!CRC){CRC=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;CRC[i]=c>>>0;}}
    let c=0xFFFFFFFF;for(let i=0;i<d.length;i++)c=CRC[(c^d[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
  function zip(files){ // stored (uncompressed): audio barely compresses anyway
    const parts=[],cent=[];let off=0;
    for(const f of files){
      const nm=new TextEncoder().encode(f.name),crc=crc32(f.data),h=new DataView(new ArrayBuffer(30));
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint32(14,crc,true);h.setUint32(18,f.data.length,true);h.setUint32(22,f.data.length,true);h.setUint16(26,nm.length,true);
      parts.push(new Uint8Array(h.buffer),nm,f.data);
      const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint32(16,crc,true);
      c.setUint32(20,f.data.length,true);c.setUint32(24,f.data.length,true);c.setUint16(28,nm.length,true);c.setUint32(42,off,true);
      cent.push(new Uint8Array(c.buffer),nm);off+=30+nm.length+f.data.length;
    }
    const size=cent.reduce((s,x)=>s+x.length,0),e=new DataView(new ArrayBuffer(22));
    e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,off,true);
    return new Blob([...parts,...cent,new Uint8Array(e.buffer)],{type:'application/zip'});
  }
  // a fresh engine with this track's loop and settings, and the plain loop's own ORDER and SKIP
  function exportEngine(){
    const t=T(),rate=t.buf.L.length===loopLen(curRate())?curRate():48000,e=new EF.Engine(rate);
    e.msg({type:'load',tr:0,L:t.buf.L,R:t.buf.R});e.msg({type:'grid',tr:0,n:t.cols});e.msg({type:'range',tr:0,s16:0,e16:t.len16});
    const keep=send;send=m=>e.msg(m);sendCfg(t);sendLoopSet(t);send=keep;
    e.msg({type:'swing',s:swing});e.msg(prefMsg());e.msg({type:'pref',pref:{lat:0}});return e;
  }
  // the export engine gets the loops of the clips it plays, at its own rate
  function expClip(e,k){const b=loopBuf(k.loop,e.sr);e.msg({type:'loopBuf',key:k.loop,L:b.L,R:b.R});return clipEngine(k,false);}
  // bars that loop seamlessly (a pre-roll of the same length first): a sequence (null: the plain loop with
  // its ORDER and SKIP). bars > 1 for a GAP sequence's full cycle.
  function bounceBar(c,bars){const e=exportEngine(),n=e.len*(bars||1);e.msg({type:'launch',tr:0,clip:c});e.msg({type:'play'});
    const b=EF.bounce(e,2*n);return {buf:{L:b.L.slice(n),R:b.R.slice(n)},sr:e.sr};}
  const expBars=k=>expOpt.cycle?cycleBars(k):1;
  function bounceClip(k){const e0=exportEngine(),n=e0.len*expBars(k),c=expClip(e0,k);e0.msg({type:'launch',tr:0,clip:c});e0.msg({type:'play'});
    const b=EF.bounce(e0,2*n);return {buf:{L:b.L.slice(n),R:b.R.slice(n)},sr:e0.sr};}
  function bounceClips(list){const e=exportEngine(),rows=list.map(k=>({bars:expBars(k),clips:[expClip(e,k)]}));if(expOpt.tail)rows.push({bars:2,clips:[null]});
    e.msg({type:'song',rows,from:0});
    return {buf:EF.bounce(e,rows.reduce((s,r)=>s+r.bars,0)*e.len),sr:e.sr};}
  async function offer(files,zipName,status){
    const many=files.length>1;
    if(dlCap){
      try{await dlCap.save({filename:zipName,data:zip(files)});status('Saved '+zipName);}
      catch(err){const c=err&&err.code;status(c==='declined'?'Not saved':c==='rate_limited'?'Another save is waiting; try again in a moment':'Saving is not available here ('+(c||'error')+')');}
      return;
    }
    const blob=many?zip(files):new Blob([files[0].data],{type:'audio/wav'}),name=many?zipName:files[0].name;
    const url=URL.createObjectURL(blob),a=el('a',{href:url,download:name});root.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);status('Downloaded '+name);
  }
  // "what you just heard": the engine keeps the last 8 bars of output
  let grabWait=null;
  function onGrabbed(m){const w=grabWait;grabWait=null;if(!w)return;
    if(!m.L.length){w.status('Nothing has played yet');return;}
    const nm='slicefield-heard-'+Math.round(m.L.length/(barSec()*m.sr))+'bars-'+bpm+'bpm';offer([{name:nm+'.wav',data:wav(m.L,m.R,m.sr)}],nm+'.zip',w.status);}
  expBtn.addEventListener('click',()=>openSheet('Export',cardEl=>{
    const t=T(),n=clips.length,k=selClip;
    const msg=el('p',{className:'expmsg'}),status=x=>{msg.textContent=x;};
    const tag='-'+bpm+'bpm';
    const run=(label,fn)=>()=>{if(!t.buf)return;status('Rendering '+label+'…');setTimeout(()=>{try{fn();}catch(err){status('Export failed: '+err.message);}},30);};
    const one=(c,nm)=>{const r=bounceClip(c);return {name:nm,data:wav(r.buf.L,r.buf.R,r.sr)};};
    const gapN=clips.filter(c=>cycleBars(c)>1).length;
    const inOrder=el('button',{type:'button',textContent:'All clips in order, one file',disabled:!n});
    inOrder.addEventListener('click',run('the clips',()=>{const r=bounceClips(clips);offer([{name:'slicefield-clips'+tag+'.wav',data:wav(r.buf.L,r.buf.R,r.sr)}],'slicefield-clips'+tag+'.zip',status);}));
    const each=el('button',{type:'button',textContent:'All individual clips ('+n+(n===1?' file)':' files)'),disabled:!n});
    each.addEventListener('click',run('the clips',()=>offer(clips.map(c=>one(c,'slicefield-clip-'+c.num+tag+'.wav')),'slicefield-clips-each'+tag+'.zip',status)));
    const selB=el('button',{type:'button',textContent:k?'Selected clip only ('+k.num+')':'Selected clip only',disabled:!k});
    selB.addEventListener('click',run('the clip',()=>offer([one(k,'slicefield-clip-'+k.num+tag+'.wav')],'slicefield-clip-'+k.num+tag+'.zip',status)));
    // GAP drifts against the bar, so a GAP sequence can be exported as one bar or its whole cycle
    const gapBox=radios('p-cyc',[['bar','One bar'],['cycle','The full cycle, until it repeats exactly']],expOpt.cycle?'cycle':'bar',v=>{expOpt.cycle=v==='cycle';});
    const tailCb=el('input',{type:'checkbox',checked:expOpt.tail});tailCb.addEventListener('change',()=>{expOpt.tail=tailCb.checked;});
    cardEl.appendChild(el('div',{},[el('h3',{},['Clips']),el('div',{className:'expclips'},[inOrder,each,selB]),
      el('p',{},[n?'In order: one file, each clip once (one bar, or its GAP cycle). Individual and selected: one seamless loop per clip. Each clip plays on the loop it was captured with.':'No clips yet. Press Capture on the field page to save the sequence as a clip.']),
      el('label',{},[tailCb,'In order: add 2 bars at the end for delay echoes to ring out'])]));
    cardEl.appendChild(el('div',{},[el('h3',{},['Sequences set to GAP']),gapBox,
      el('p',{},[gapN?gapN+(gapN>1?' clips use':' clip uses')+' GAP. With GAP the sequence shifts against the bar, so it takes several bars to come round: '+clips.filter(c=>cycleBars(c)>1).slice(0,6).map(c=>c.num+': '+cycleBars(c)+' bars').join(', ')+'.':'No clip uses GAP yet; this applies to the sequencer too.'])]));
    const seqB=el('button',{type:'button',textContent:'This sequence'});
    const seqK=()=>t.seq||{silPat:t.loopSet.silPat,muteV:t.loopSet.muteV,n:barSteps(t),slots:{length:barSteps(t)}};
    seqB.addEventListener('click',run('the sequence',()=>{const r=bounceBar(t.seq?clipForm(t.seq):null,expBars(seqK())),nm='slicefield-'+(t.seq?'sequence':'loop')+tag;offer([{name:nm+'.wav',data:wav(r.buf.L,r.buf.R,r.sr)}],nm+'.zip',status);}));
    cardEl.appendChild(el('div',{},[el('h3',{},['Sequencer']),seqB,el('p',{},['A seamless loop with its stored ORDER and SKIP (one bar, or its GAP cycle as chosen above).'])]));
    const heard=el('div',{className:'expclips'},[2,4,8].map(n=>{const b=el('button',{type:'button',textContent:'Last '+n+' bars'});
      b.addEventListener('click',()=>{if(!send){status('Nothing has played yet');return;}grabWait={status};status('Collecting…');tx({type:'grab',bars:n});});return b;}));
    cardEl.appendChild(el('div',{},[el('h3',{},['What you just heard']),heard,el('p',{},['The last whole bars that played, exactly as they sounded, live touches included.'])]));
    const flCb=el('input',{type:'checkbox',checked:expOpt.float});flCb.addEventListener('change',()=>{expOpt.float=flCb.checked;});
    cardEl.appendChild(el('div',{},[el('h3',{},['Format']),el('label',{},[flCb,'32-bit float'])]));
    cardEl.appendChild(msg);
  }));

  // ---------- projects ----------
  // A project is the whole state: tempo, swing, modes, preferences, the loop (imported audio included),
  // grid, effect settings and row order, the plain loop's strips, the sequence, and the Clips list.
  // It is saved as one JSON file (inside a zip where the page can only hand over zips) and opened from
  // either. Undo history is not kept.
  const b64=a=>{const u=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s);};
  const unb64=s=>{const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return new Float32Array(u.buffer);};
  const plainClip=c=>{const o=Object.assign({},c,{slots:c.slots.map(copySlot)});delete o.ord;delete o.mute;return o;};
  function projectState(){
    const t=T();
    return {app:'slicefield',version:22,bpm,swing,stepped,playMode,fxOnly,
      prefs:{grace:prefs.grace,touchWin:prefs.touchWin,fit:prefs.fit},pin:Object.assign({},pin),
      fields:fields.map(cloneField),field:t.field.id,
      track:{kind:t.kind,cols:t.colsQ||t.cols,len16:t.len16,loopSet:Object.assign({},t.loopSet),seq:t.seq?plainClip(t.seq):null},
      clips:clips.map(plainClip),sel:clips.indexOf(selClip),clipNum,
      files:[...files.values()].map(f=>({id:f.id,name:f.name,L:b64(f.L),R:b64(f.R)}))};
  }
  // settings saved before an effect changed get that effect's defaults (and effects added since get theirs)
  function fixCfg(q){const c=defCfg();for(const k in q||{}){const x=q[k];if(FX[k]&&x&&x.x&&Object.keys(FX[k].params).every(n=>n in x.x))c[k]=Object.assign({},x,{hue:FX[k].hue});}return c;}
  function fixField(f){
    const cells=(f.cells||[]).filter(c=>c&&(c.k==='center'||FX[c.k])).map(c=>({k:c.k,y:clamp(Math.round(c.y),0,FG-1),h:clamp(Math.round(c.h),1,FG)}));
    return {id:f.id||newFieldId(),name:f.name||'Field',cells:cells.length?cells:presetField('all').cells,cfg:fixCfg(f.cfg)};
  }
  // before v22 a project had one row order and the effects shown: that becomes its one field
  function fieldFromRows(rows,cfg,shown){
    const ks=(rows||[]).filter(r=>(r==='center'||FX[r])&&(r==='center'||!shown||shown.includes(r)));
    for(const r of PRESETS.all.cells.map(c=>c[0]))if(!ks.includes(r)&&(r==='center'||!shown||shown.includes(r)))ks.push(r);
    const w=ks.map(k=>k==='center'?14:k==='pitch'?10:3),sum=w.reduce((a,b)=>a+b,0);let y=0;
    const cells=ks.map((k,i)=>{const h=i===ks.length-1?FG-y:Math.max(1,Math.round(w[i]*FG/sum));const c={k,y,h};y+=h;return c;});
    return {id:newFieldId(),name:'Field 1',cells,cfg:fixCfg(cfg)};
  }
  async function openProject(p){
    if(!p||p.app!=='slicefield'||!p.track)throw new Error('not a Slicefield project');
    initAudio();await ready;
    if(gameOn)endGame(false);if(fieldEdit)setFieldEdit(false);
    if(st.playing||intent){intent=null;tx({type:'stop'});}
    songPlaying=false;songList=[];recOn=false;recBn=-1;
    // imported audio first, so the loop and clips can find it
    files.clear();soundSel.querySelectorAll('option[value^="f:"]').forEach(o=>o.remove());
    for(const f of p.files||[])files.set(f.id,{id:f.id,name:f.name,L:unb64(f.L),R:unb64(f.R)});
    for(const id of files.keys())fileOption('f:'+id);loopCache.clear();
    bpm=clamp(p.bpm||124,60,200);swing=clamp(p.swing||0,0,0.5);stepped=p.stepped!==false;playMode=p.playMode==='combine'?'combine':'replace';fxOnly=!!p.fxOnly;
    // projects from before v22 resampled imported audio
    if(p.prefs){prefs.grace=p.prefs.grace!=null?p.prefs.grace:40;prefs.touchWin=p.prefs.touchWin!==false;prefs.fit=p.prefs.fit||'resample';}
    if(p.pin)Object.assign(pin,p.pin);liveV.order=liveV.mute=null;
    const t=T(),q=p.track;
    fields=p.fields&&p.fields.length?p.fields.map(fixField):[q.cfg||q.rows?fieldFromRows(q.rows,q.cfg,p.prefs&&p.prefs.shown):presetField('all')];
    t.field=fields.find(f=>f.id===p.field)||fields[0];
    t.kind=q.kind&&(!q.kind.startsWith('f:')||files.has(q.kind.slice(2)))?q.kind:'break';
    t.cols=q.cols===8?8:16;t.colsQ=0;t.len16=clamp(q.len16||16,1,16);
    t.loopSet=Object.assign({orderV:1,muteV:1,silPat:'mute'},q.loopSet||{});
    t.seq=q.seq?clipForm(Object.assign({},q.seq)):blankClip(t);
    // clips from before v22 played with the project's settings: they get the project's field
    clips=(p.clips||[]).map(k=>Object.assign({silPat:'mute',loop:t.kind},k,{field:k.field?fixField(k.field):cloneField(t.field)}));clipNum=p.clipNum||clips.length;
    selClip=clips[p.sel]||clips[clips.length-1]||null;
    undoS.length=0;redoS.length=0;
    bpmEl.querySelector('b').textContent=String(bpm);swingEl.querySelector('b').textContent=String(Math.round(50+swing*50));
    soundSel.value=t.kind;
    genTrack(t);syncAll();
    computeLayout();renderSession();paintIcons();paintUndo();
  }
  async function saveProject(status){
    const d=new Date(),pad=x=>String(x).padStart(2,'0');
    const nm='slicefield-'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes());
    const data=new TextEncoder().encode(JSON.stringify(projectState()));
    if(dlCap){
      try{await dlCap.save({filename:nm+'.zip',data:zip([{name:nm+'.json',data}])});status('Saved '+nm+'.zip');}
      catch(err){const c=err&&err.code;status(c==='declined'?'Not saved':'Saving is not available here ('+(c||'error')+')');}
      return;
    }
    const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=el('a',{href:url,download:nm+'.json'});
    root.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Downloaded '+nm+'.json');
  }
  // a project file, or a zip holding one (stored, as this page writes them)
  function readProjectFile(buf){
    const u=new Uint8Array(buf),v=new DataView(buf);
    if(u.length>30&&v.getUint32(0,true)===0x04034b50){
      if(v.getUint16(8,true)!==0)throw new Error('this zip is compressed: unzip it and open the .json inside');
      const size=v.getUint32(18,true),nl=v.getUint16(26,true),xl=v.getUint16(28,true);
      return JSON.parse(new TextDecoder().decode(u.subarray(30+nl+xl,30+nl+xl+size)));
    }
    return JSON.parse(new TextDecoder().decode(u));
  }
  // ---------- project library ----------
  // Projects are kept in a library with folders (nested, as paths like "Beats/Drafts"). Inside claude.ai
  // the library lives in this artifact's database, in the viewer's own private space; elsewhere in this
  // browser's IndexedDB. Both keep the same records: a small meta record per project (listed), its state
  // (split into chunks under 200 kB, since a project with imported audio can be megabytes), and one record
  // holding the folder list (so empty folders survive).
  const CHUNK=200000;
  function dbLib(db,uid){
    const col=db.collection('data/users/'+uid),one=async f=>{try{return await f();}catch(e){if(e&&e.code==='unavailable'){await new Promise(r=>setTimeout(r,400+Math.random()*400));return f();}throw e;}};
    return {
      where:'your Claude library',
      async list(){const q=await one(()=>col.where('kind','==','project').get());return q.docs.map(d=>d.data());},
      async folders(){const d=await one(()=>col.doc('folders').get());return d.exists?(d.data().list||[]):[];},
      async setFolders(list){await one(()=>col.doc('folders').set({kind:'folders',list}));},
      async load(id){const m=await one(()=>col.doc('p_'+id).get());if(!m.exists)throw new Error('missing');let s='';
        for(let i=0;i<m.data().chunks;i++){const c=await one(()=>col.doc('p_'+id+'_'+i).get());s+=c.exists?c.data().d:'';}return JSON.parse(s);},
      async save(meta,json){const old=await one(()=>col.doc('p_'+meta.id).get()),n=Math.max(1,Math.ceil(json.length/CHUNK));
        for(let i=0;i<n;i++){const d=json.slice(i*CHUNK,(i+1)*CHUNK);await one(()=>col.doc('p_'+meta.id+'_'+i).set({kind:'chunk',d}));}
        await one(()=>col.doc('p_'+meta.id).set(Object.assign({kind:'project',chunks:n},meta)));
        const was=old.exists?old.data().chunks||0:0;for(let i=n;i<was;i++)await one(()=>col.doc('p_'+meta.id+'_'+i).delete());},
      async meta(meta){await one(()=>col.doc('p_'+meta.id).update(meta));},
      async remove(id){const m=await one(()=>col.doc('p_'+id).get());const n=m.exists?m.data().chunks||0:0;
        await one(()=>col.doc('p_'+id).delete());for(let i=0;i<n;i++)await one(()=>col.doc('p_'+id+'_'+i).delete());},
    };
  }
  function idbLib(){
    let dbp=null;
    const open=()=>dbp||(dbp=new Promise((res,rej)=>{const r=indexedDB.open('slicefield',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}));
    const run=async(mode,f)=>{const d=await open();return new Promise((res,rej)=>{const tr=d.transaction('kv',mode),st=tr.objectStore('kv'),q=f(st);tr.oncomplete=()=>res(q&&q.result);tr.onerror=()=>rej(tr.error);});};
    return {
      where:'this browser',
      async list(){const all=await run('readonly',st=>st.getAll());return (all||[]).filter(x=>x&&x.kind==='project');},
      async folders(){const f=await run('readonly',st=>st.get('folders'));return f?f.list:[];},
      async setFolders(list){await run('readwrite',st=>st.put({kind:'folders',list},'folders'));},
      async load(id){const s=await run('readonly',st=>st.get('d_'+id));if(!s)throw new Error('missing');return JSON.parse(s.json);},
      async save(meta,json){await run('readwrite',st=>{st.put({kind:'data',json},'d_'+meta.id);st.put(Object.assign({kind:'project'},meta),'p_'+meta.id);});},
      async meta(meta){const m=await run('readonly',st=>st.get('p_'+meta.id));if(m)await run('readwrite',st=>st.put(Object.assign(m,meta),'p_'+meta.id));},
      async remove(id){await run('readwrite',st=>{st.delete('p_'+id);st.delete('d_'+id);});},
    };
  }
  let libP=null;
  function library(){
    if(!libP)libP=(async()=>{
      try{if(window.claude&&window.claude.use){const db=await window.claude.use('db'),u=await window.claude.use('user'),uid=u&&await u.id();if(db&&uid)return dbLib(db,uid);}}catch(_){}
      if(window.indexedDB)return idbLib();
      return null;
    })();
    return libP;
  }

  // ---------- projects sheet ----------
  // The project open now (id null until it is first saved), the folder being looked at, and what the library
  // holds. A new project is saved as soon as it is named; after that, SAVE keeps changes, and they are kept
  // automatically before another project is opened or a new one started, and when the page is hidden.
  // In the sheet, tap a project or folder to select it and tap it again to open it. The sheet's trash deletes
  // the selected one (or hold it and tap rows; or hold rows and tap it); a deleted row turns red at once.
  let projList=null,crumbsEl=null,projName=null,projStateEl=null,projMsg=null,projScroll=null;
  let cur={id:null,name:'',folder:''},browse='',libItems=[],libFolders=[],savedSig='',libBusy=false,psel=null,ptrash=null;
  const projHolds=new Map();
  // what a project's content is, to tell whether it changed since it was saved (imported audio by id only)
  const projSig=()=>{const p=projectState();p.files=p.files.map(f=>f.id);return JSON.stringify(p);};
  const isDirty=()=>projSig()!==savedSig;
  const newProjId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  function say(text,undo){
    if(!projMsg)return;
    projMsg.textContent='';projMsg.appendChild(el('span',{textContent:text}));
    if(undo){const b=el('button',{type:'button',textContent:'Undo'});b.addEventListener('click',()=>{projMsg.hidden=true;undo();});projMsg.appendChild(b);}
    projMsg.hidden=false;clearTimeout(say.t);const m=projMsg;say.t=setTimeout(()=>{m.hidden=true;},undo?7000:3500);
  }
  async function refreshLib(){
    const L=await library();if(!L){libItems=[];libFolders=[];return;}
    try{libItems=await L.list();libFolders=await L.folders();}catch(e){say('The library could not be read ('+(e&&(e.code||e.message))+')');}
  }
  function untitled(){let n=1;const names=new Set(libItems.map(x=>x.name));while(names.has('Untitled '+n))n++;return 'Untitled '+n;}
  async function saveCurrent(quiet){
    const L=await library();if(!L){say('No library here: use Save to file');return false;}
    if(!cur.id){cur.id=newProjId();cur.folder=browse;if(!cur.name)cur.name=(projName&&projName.value.trim())||untitled();}
    const st=projectState(),json=JSON.stringify(st);
    const meta={id:cur.id,name:cur.name,folder:cur.folder,updated:Date.now(),clips:clips.length,loop:loopName(T().kind),bpm};
    try{libBusy=true;paintProjState('Saving…');await L.save(meta,json);savedSig=projSig();
      const i=libItems.findIndex(x=>x.id===meta.id);if(i>=0)libItems[i]=Object.assign({},libItems[i],meta);else libItems.push(meta);
      psel={proj:meta.id};if(!quiet)say('Saved '+cur.name);return true;}
    catch(e){say('Not saved: '+(e&&e.code==='quota_exceeded'?'the library is full; delete some projects':(e&&(e.code||e.message))));return false;}
    finally{libBusy=false;renderProjects();}
  }
  // before leaving the current project: keep it if it changed (a new, unnamed and untouched one is not kept)
  async function keepCurrent(){if(isDirty())return saveCurrent(true);return true;}
  async function openFromLibrary(m){
    if(m.id===cur.id)return;
    if(!(await keepCurrent()))return;
    const L=await library();
    try{const p=await L.load(m.id);await openProject(p);cur={id:m.id,name:m.name,folder:m.folder||''};savedSig=projSig();say('Opened '+m.name);}
    catch(e){say('Could not open '+m.name+': '+(e&&(e.code||e.message)));}
    renderProjects();
  }
  async function newProject(){
    if(!(await keepCurrent()))return;
    await openProject({app:'slicefield',track:{}});cur={id:null,name:'',folder:browse};savedSig=projSig();psel=null;renderProjects();
    say('New project: name it to keep it');if(projName){projName.value='';projName.focus();}
  }
  // naming a new project saves it; renaming a saved one renames it in the library
  async function nameChanged(){
    const v=projName.value.trim();if(!v){projName.value=cur.name;return;}
    cur.name=v;
    if(!cur.id){await saveCurrent(false);return;}
    const L=await library();try{await L.meta({id:cur.id,name:cur.name});const m=libItems.find(x=>x.id===cur.id);if(m)m.name=cur.name;}catch(_){}renderProjects();
  }
  // a new folder inside the one being looked at: name it in place
  function newFolder(){
    if(!projList||projList.querySelector('.ni'))return;
    const row=el('div',{className:'prow folder'}),inp=el('input',{className:'ni',type:'text',maxLength:30,placeholder:'Folder name'});
    const box=el('div',{className:'pb'});box.innerHTML=ICON.folder;box.appendChild(inp);row.append(el('div'),box);projList.prepend(row);inp.focus();
    let fin=false;   // Enter and losing focus both finish it, once
    const done=async ok=>{if(fin)return;fin=true;const nm=inp.value.replace(/\//g,' ').trim();row.remove();if(!ok||!nm)return;
      const path=(browse?browse+'/':'')+nm;if(!libFolders.includes(path)){libFolders.push(path);const L=await library();try{await L.setFolders(libFolders);}catch(_){}}
      psel={folder:path};renderProjects();};
    inp.addEventListener('keydown',e=>{if(e.key==='Enter')done(true);if(e.key==='Escape')done(false);});inp.addEventListener('blur',()=>done(true));
  }
  // folders that exist: named ones and every folder a project sits in, with their parents
  function allFolders(){const s=new Set();const add=p=>{while(p){s.add(p);p=p.includes('/')?p.slice(0,p.lastIndexOf('/')):'';}};
    libFolders.forEach(add);libItems.forEach(x=>add(x.folder||''));return [...s];}
  const childFolders=f=>allFolders().filter(p=>(f?p.startsWith(f+'/'):true)&&!p.slice(f?f.length+1:0).includes('/')&&p!==f).sort();
  const inFolder=f=>libItems.filter(x=>(x.folder||'')===f).sort((a,b)=>b.updated-a.updated);
  const under=f=>libItems.filter(x=>(x.folder||'')===f||(x.folder||'').startsWith(f+'/'));
  const fmtDate=t=>{const d=new Date(t);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});};
  function paintProjState(x){if(projStateEl)projStateEl.textContent=x!=null?x:!cur.id?'not saved yet':isDirty()?'changed':'saved';}
  const isSel=w=>!!psel&&(w.proj?psel.proj===w.proj.id:psel.folder===w.folder);
  function renderProjects(){
    if(!projOn||!projList)return;
    if(root.activeElement!==projName)projName.value=cur.name;projName.placeholder=cur.id?'':'Name this project to keep it';
    paintProjState(libBusy?'Saving…':null);
    crumbsEl.textContent='';const parts=browse?browse.split('/'):[];
    const crumb=(label,path)=>{const b=el('button',{type:'button',textContent:label,className:path===browse?'cur':''});b.dataset.folder=path;b.addEventListener('click',()=>{browse=path;renderProjects();});return b;};
    crumbsEl.appendChild(crumb('Projects',''));parts.forEach((p,i)=>{crumbsEl.appendChild(document.createTextNode('›'));crumbsEl.appendChild(crumb(p,parts.slice(0,i+1).join('/')));});
    projList.textContent='';projHolds.clear();
    const folders=childFolders(browse),items=inFolder(browse);
    for(const f of folders){
      const w={folder:f},row=el('div',{className:'prow folder'+(isSel(w)?' sel':'')});row.dataset.folder=f;const b=el('button',{type:'button',className:'pb'});
      const n=under(f).length;b.innerHTML=ICON.folder;b.appendChild(el('b',{textContent:f.slice(f.lastIndexOf('/')+1)}));b.appendChild(el('small',{textContent:(n?n+(n>1?' projects':' project'):'empty')+(isSel(w)?' · tap again to open':'')}));
      holdable(b,row,w,()=>{browse=f;psel=null;renderProjects();});row.append(el('div'),b);projList.appendChild(row);
    }
    for(const m of items){
      const w={proj:m},row=el('div',{className:'prow'+(m.id===cur.id?' cur':'')+(isSel(w)?' sel':'')});const b=el('button',{type:'button',className:'pb'});
      b.appendChild(el('b',{textContent:m.name+(m.id===cur.id?' · open':'')}));
      b.appendChild(el('small',{textContent:isSel(w)&&m.id!==cur.id?'Tap again to open':fmtDate(m.updated)+' · '+(m.clips||0)+(m.clips===1?' clip':' clips')+(m.loop?' · '+m.loop:'')+(m.bpm?' · '+m.bpm+' BPM':'')}));
      const hdl=el('div',{className:'hdl',title:'Drag onto a folder to move it'});hdl.innerHTML=ICON.handle;projMover(hdl,m);
      holdable(b,row,w,()=>openFromLibrary(m));row.append(hdl,b);projList.appendChild(row);
    }
    if(!folders.length&&!items.length)projList.appendChild(el('p',{className:'projempty',textContent:browse?'This folder is empty. A project named while you are here is saved here; drag projects onto a folder to move them.':
      'No saved projects yet. Name this one above and it is saved. Save to file makes a copy you can keep anywhere.'}));
  }
  // a row: tap to select, tap again to open; with the sheet's trash held, a tap deletes it
  function holdable(b,row,what,open){
    b.addEventListener('pointerdown',e=>{if(ptrash){ptrash.used=true;deleteEntry(what,row);return;}projHolds.set(e.pointerId,{what,used:false,row});row.classList.add('held');});
    const up=e=>{const h=projHolds.get(e.pointerId);if(!h)return;projHolds.delete(e.pointerId);row.classList.remove('held');if(e.type==='pointerup'&&!h.used)tapRow(what,open);};
    ['pointerup','pointercancel','pointerleave'].forEach(ev=>b.addEventListener(ev,up));
    b.addEventListener('click',e=>{if(e.detail===0)tapRow(what,open);});
  }
  function tapRow(what,open){if(isSel(what))open();else{psel=what.proj?{proj:what.proj.id}:{folder:what.folder};renderProjects();}}
  // Deleting turns the row red at once; it goes a moment later, and the message offers Undo for a few
  // seconds (the data is held until then).
  async function deleteEntry(what,row){
    const L=await library();if(!L)return;
    if(row)row.classList.add('gone');
    const gone=what.proj?[what.proj]:under(what.folder),folders=what.folder?allFolders().filter(p=>p===what.folder||p.startsWith(what.folder+'/')):[];
    if(isSel(what))psel=null;
    const left=libFolders.filter(p=>!folders.includes(p));
    setTimeout(()=>{libItems=libItems.filter(x=>!gone.includes(x));libFolders=libFolders.filter(p=>!folders.includes(p));renderProjects();},260);
    if(gone.some(m=>m.id===cur.id)){cur.id=null;savedSig='';}   // the open project stays open, now unsaved
    const job=(async()=>{const kept=[];for(const m of gone){try{kept.push({m,p:await L.load(m.id)});}catch(_){}}
      for(const m of gone){try{await L.remove(m.id);}catch(_){}}
      if(folders.length){try{await L.setFolders(left);}catch(_){}}return kept;})();
    const name=what.proj?what.proj.name:'folder '+what.folder.slice(what.folder.lastIndexOf('/')+1)+(gone.length?' and '+gone.length+(gone.length>1?' projects':' project'):'');
    say('Deleted '+name,async()=>{const kept=await job;for(const k of kept){await L.save(k.m,JSON.stringify(k.p));if(!libItems.includes(k.m))libItems.push(k.m);}
      if(folders.length){libFolders=libFolders.concat(folders.filter(p=>!libFolders.includes(p)));await L.setFolders(libFolders);}renderProjects();});
  }
  function deleteSelected(){
    if(!psel)return;const row=[...projList.querySelectorAll('.prow.sel')][0];
    const w=psel.proj?{proj:libItems.find(x=>x.id===psel.proj)}:{folder:psel.folder};if(w.proj===undefined&&psel.proj)return;deleteEntry(w,row);
  }
  // drag a project's handle onto a folder row (or a folder in the path above) to move it there
  function projMover(node,m){
    let s0=null;const target=(x,y)=>{const n=root.elementFromPoint(x,y);if(!n||!n.closest)return null;return n.closest('.prow.folder')||n.closest('.crumbs button');};
    const clear=()=>root.querySelectorAll('.prow.drop,.crumbs button.drop').forEach(n=>n.classList.remove('drop'));
    node.addEventListener('pointerdown',e=>{e.preventDefault();s0={y:e.clientY,id:e.pointerId,drag:false};try{node.setPointerCapture(e.pointerId);}catch(_){}});
    node.addEventListener('pointermove',e=>{if(!s0||e.pointerId!==s0.id)return;
      if(!s0.drag&&Math.abs(e.clientY-s0.y)>6){s0.drag=true;ghost.textContent=m.name.slice(0,10);ghost.hidden=false;}
      if(s0.drag){ghost.style.left=e.clientX+'px';ghost.style.top=e.clientY+'px';clear();const t=target(e.clientX,e.clientY);if(t)t.classList.add('drop');}});
    const end=async e=>{if(!s0||e.pointerId!==s0.id)return;const s=s0;s0=null;ghost.hidden=true;clear();if(!s.drag)return;
      const t=target(e.clientX,e.clientY);if(!t)return;const f=t.dataset.folder;if(f==null||f===(m.folder||''))return;
      const L=await library();try{await L.meta({id:m.id,folder:f});m.folder=f;if(m.id===cur.id)cur.folder=f;say('Moved '+m.name+' to '+(f||'Projects'));}catch(err){say('Not moved: '+(err&&(err.code||err.message)));}
      renderProjects();};
    node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);
  }
  function openProjects(){
    openSheet('Projects',cardEl=>{
      card.classList.add('big');projOn=true;
      projName=el('input',{type:'text',maxLength:40,spellcheck:false});projName.setAttribute('aria-label','Project name');projName.addEventListener('change',nameChanged);
      projStateEl=el('span',{className:'projstate'});crumbsEl=el('div',{className:'crumbs'});projList=el('div',{className:'projlist'});
      projScroll=el('div',{className:'sess-scroll'},[projList]);projMsg=el('div',{className:'projmsg'});projMsg.hidden=true;
      const tr=el('button',{type:'button',className:'ic trash',title:'Tap: delete the selected project or folder · hold and tap rows: delete those'});tr.innerHTML=ICON.trash;
      tr.addEventListener('pointerdown',e=>{ptrash={id:e.pointerId,used:false};tr.classList.add('held');try{tr.setPointerCapture(e.pointerId);}catch(_){}
        if(projHolds.size){ptrash.used=true;for(const h of projHolds.values()){h.used=true;deleteEntry(h.what,h.row);}}});
      const trUp=e=>{const h=ptrash;if(!h||h.id!==e.pointerId)return;ptrash=null;tr.classList.remove('held');if(e.type==='pointerup'&&!h.used)deleteSelected();};
      ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>tr.addEventListener(ev,trUp));
      tr.addEventListener('click',e=>{if(e.detail===0)deleteSelected();});
      const nf=el('button',{type:'button',className:'tiny',textContent:'NEW FOLDER'});nf.addEventListener('click',newFolder);
      const sv=el('button',{type:'button',className:'tiny',textContent:'SAVE'});sv.addEventListener('click',()=>saveCurrent(false));
      const np=el('button',{type:'button',className:'tiny',textContent:'NEW PROJECT'});np.addEventListener('click',newProject);
      const tf=el('button',{type:'button',textContent:'Save to file'});tf.addEventListener('click',()=>{say('Saving…');saveProject(say);});
      const ff=el('button',{type:'button',textContent:'Open file…'});ff.addEventListener('click',()=>{initAudio();projIn.click();});
      cardEl.append(el('div',{className:'projhead'},[projName,projStateEl]),el('div',{className:'projtools'},[tr,nf,sv,np]),crumbsEl,projScroll,el('div',{className:'projfoot'},[tf,ff]),projMsg);
      if(cur.id&&!psel)psel={proj:cur.id};
      renderProjects();refreshLib().then(renderProjects);
    });
    sheetOnClose=()=>{projOn=false;projHolds.clear();ptrash=null;};
  }
  projIn.addEventListener('change',async()=>{
    const f=projIn.files&&projIn.files[0];projIn.value='';if(!f)return;
    try{const p=readProjectFile(await f.arrayBuffer());if(!(await keepCurrent()))return;await openProject(p);
      cur={id:null,name:f.name.replace(/\.(json|zip)$/i,'').replace(/^slicefield-/,'').slice(0,40),folder:browse};savedSig='';say('Opened '+f.name+' (not in the library until you SAVE)');}
    catch(err){say('Could not open '+f.name+': '+err.message);}
    renderProjects();
  });
  // the page being hidden (another app, a closed tab) keeps a saved project's latest changes
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&cur.id&&isDirty())saveCurrent(true);});
  projBtn.addEventListener('click',()=>openProjects());

  // ---------- undo / redo ----------
  // Every edit gesture saves a snapshot of the sequence, the strips, the fields and the Clips list first
  // (captures, deletes and moves included; clips never change, so the list keeps references). While
  // recording, each bar that writes steps is one undo step. Live touches are not undoable.
  const undoS=[],redoS=[];
  function snapState(){const t=T();return {seq:t.seq?cloneClip(t.seq):null,loopSet:Object.assign({},t.loopSet),clips:clips.slice(),sel:selClip,clipNum,kind:t.kind,
    fields:fields.map(cloneField),field:t.field.id};}
  function checkpoint(){undoS.push(snapState());if(undoS.length>100)undoS.shift();redoS.length=0;paintUndo();}
  function restoreState(sn){
    const t=T(),f=info(t.i);
    clips=sn.clips;selClip=sn.sel&&clips.includes(sn.sel)?sn.sel:null;clipNum=sn.clipNum;
    t.loopSet=sn.loopSet;t.seq=sn.seq||blankClip(t);liveV.order=liveV.mute=null;
    if(sn.fields){fields=sn.fields;t.field=fields.find(x=>x.id===sn.field)||fields[0];sendField(t);}
    if(sn.kind&&sn.kind!==t.kind)setLoop(t,sn.kind);tx(prefMsg());
    if(!songPlaying){
      // the same sequence is edited in place at once; a different one takes over at the next bar
      if(t.seq&&f.clipId===t.seq.id)tx({type:'clipEdit',tr:t.i,clip:clipForm(t.seq)});
      else tx({type:'launch',tr:t.i,clip:t.seq&&clipForm(t.seq)});
    }
    sendLoopSet(t);sendRec();resyncSong();computeLayout();renderSession();paintUndo();paintIcons();
  }
  function undo(){if(!undoS.length)return;redoS.push(snapState());restoreState(undoS.pop());}
  function redo(){if(!redoS.length)return;undoS.push(snapState());restoreState(redoS.pop());}
  const undoBtn=$('undo'),redoBtn=$('redo');
  function paintUndo(){undoBtn.disabled=!undoS.length;redoBtn.disabled=!redoS.length;}
  undoBtn.addEventListener('click',undo);redoBtn.addEventListener('click',redo);

  // ---------- drawing ----------
  function rr(x,y,w,h,r){g.beginPath();if(g.roundRect)g.roundRect(x,y,w,h,r);else g.rect(x,y,w,h);}
  const cellX=(t,a16)=>HW+a16/16*W();
  const stepHue=(t,s)=>{const k=s.fx&&s.fx.length?s.fx[0].k:null;return k?(t.cfg[k]||{}).hue:null;};
  function laneCell(t,s,x,y,w,h,lit,dim,fs,cont,pos){
    if(s&&s.empty){
      g.globalAlpha=s.on===false?0.4:1;g.strokeStyle='#3a3f4a';g.lineWidth=1;g.strokeRect(x+1.5,y+0.5,w-3,h-1);
      if(s.on!==false){const step=16/t.cols;g.fillStyle='rgba(236,231,220,.32)';g.font=`400 ${Math.min(fs,w<20?8:9)}px ${FONT}`;
        g.textAlign='center';g.textBaseline='middle';g.fillText(String(Math.floor(pos/step)+1),x+w/2,y+h/2+0.5);}
      g.globalAlpha=1;
      if(lit){g.strokeStyle=lit==='rec'?'#ff6b6b':lit==='hold'?'#fff':ACC;g.lineWidth=lit==='hold'?2:1.5;g.strokeRect(x+1,y-1,w-2,h+2);}
      return;
    }
    g.globalAlpha=dim?0.28:1;
    const hue=s?stepHue(t,s):null;
    g.fillStyle=!s?'#1c1f25':hue!=null?`hsl(${hue} 50% 34%)`:'#3a3f4a';
    g.fillRect(x+(cont?0:1),y,w-(cont?1:2),h);
    // stacked effects: the cell colour is the first, a dot for each of the next three, and a + for more
    if(s&&s.fx&&s.fx.length>1)s.fx.slice(1,4).forEach((f,q)=>{const hh=(t.cfg[f.k]||{}).hue;g.fillStyle=`hsl(${hh} 70% 60%)`;g.fillRect(x+2+q*4,y+h-4,3,3);});
    if(s&&s.fx&&s.fx.length>4){g.fillStyle='#fff';g.fillRect(x+14,y+h-3.5,3,1);g.fillRect(x+15,y+h-4.5,1,3);}
    if(s){
      const step=16/t.cols,sn=Math.floor(s.a/step)+1,half=s.a%step;
      g.fillStyle='rgba(236,231,220,.85)';g.font=`500 ${Math.min(fs,w<20?8:9)}px ${FONT}`;g.textAlign='center';g.textBaseline='middle';
      g.fillText(String(sn)+(half?'+':''),x+w/2,y+h/2+0.5);
    }
    g.globalAlpha=1;
    if(lit){g.strokeStyle=lit==='rec'?'#ff6b6b':lit==='hold'?'#fff':ACC;g.lineWidth=lit==='hold'?2:1.5;g.strokeRect(x+1,y-1,w-2,h+2);}
  }
  // The steps SKIP will silence (as GAP the sequence shifts instead, so nothing is dimmed)
  function patDim(t,idx){
    if(silOf(t)!=='mute')return false;
    const b=EF.skipPattern(mV(t),barSteps(t));return !!b&&!b[idx%b.length];
  }
  // the lane's label column: a clip number in the Capture icon's corner ticks (or SEQ / LIVE), and a note under it
  function laneLabel(num,edited,word,on,sub,red,h,fs){
    const col=on?`hsl(${TRACK_HUES[0]} 75% 62%)`:'#6c7380',cy=h/2-(sub?8:0);
    g.textBaseline='middle';g.textAlign='center';g.fillStyle=col;
    if(num){
      const lab=String(num)+(edited?'*':'');g.font=`600 ${lab.length>3?fs-2:fs}px ${FONT}`;g.fillText(lab,LLAB/2,cy+0.5);
      const bw=26,bh=20,x0=LLAB/2-bw/2,y0=cy-bh/2,k=5;g.strokeStyle=col;g.lineWidth=1.4;g.lineCap='round';g.beginPath();
      for(const [x,y,dx,dy] of [[x0,y0,1,1],[x0+bw,y0,-1,1],[x0,y0+bh,1,-1],[x0+bw,y0+bh,-1,-1]]){g.moveTo(x+dx*k,y);g.lineTo(x,y);g.lineTo(x,y+dy*k);}
      g.stroke();
    }else{g.font=`600 ${fs}px ${FONT}`;g.fillText(word,LLAB/2,cy);}
    if(sub){g.font=`${red?600:400} ${fs-2}px ${FONT}`;g.fillStyle=red?'#ff6b6b':'#8a8f99';g.fillText(sub,LLAB/2,h/2+12);}
  }
  // A clip drawn exactly as the sequencer shows it (without the rotate column); lit: the step playing.
  function drawClipLane(cv,k,lit){
    const W=cv.clientWidth||300,rows=k.n>8?2:1,pr=Math.ceil(k.n/rows),H=rows*LROW+4,d=Math.min(3,window.devicePixelRatio||1);
    if(cv.width!==Math.round(W*d)||cv.height!==Math.round(H*d)){cv.width=Math.round(W*d);cv.height=Math.round(H*d);}
    const keep=g;g=cv.getContext('2d');g.setTransform(d,0,0,d,0,0);g.clearRect(0,0,W,H);
    if('letterSpacing' in g)g.letterSpacing='0.06em';
    const t=T(),fs=10,bits=(k.silPat||'mute')==='mute'?EF.skipPattern(k.muteV,k.n):null;
    g.fillStyle='#16181d';rr(0,0,W,H,7);g.fill();
    const other=k.loop&&k.loop!==t.kind?loopName(k.loop).replace(/\s.*/,'').slice(0,5).toUpperCase():'';
    laneLabel(k.num,false,'',true,other,false,H,fs);
    const w=(W-LLAB-3)/pr;
    for(let j=0;j<k.slots.length&&j<k.n;j++){const s=k.slots[j];
      laneCell(t,s,LLAB+(j%pr)*w,4+Math.floor(j/pr)*LROW,w,LROW-5,j===lit,s.on===false||(!!bits&&!bits[j%bits.length]),fs,(s.off||0)>0,j*16/k.cols);}
    g=keep;
  }
  let litClip=null;
  function drawPlayingClip(){
    const i=info(0),k=songPlaying&&st.playing?clips.find(c=>c.id===i.clipId):null,cv=k&&clipCvs.get(k.id),idx=cv?i.cIdx:-1,key=k?k.id+':'+idx:'';
    if(key===litClip)return;
    if(litClip){const [id]=litClip.split(':'),o=clips.find(c=>c.id===id),oc=o&&clipCvs.get(id);if(oc)drawClipLane(oc,o,-1);}
    litClip=key;if(cv)drawClipLane(cv,k,idx);
  }
  function drawLane(fs){
    const d=lanePageInfo(),t=d.t,i=info(view),h=laneRows*LROW+4;
    g.fillStyle='#16181d';rr(0,0,LW,h,7);g.fill();
    g.textBaseline='middle';g.textAlign='center';g.font=`600 ${fs}px ${FONT}`;
    // The clip's number, in the corner ticks of the Capture icon, when the sequence came from (or was captured
    // as) that clip, with a * once it has changed since; SEQ otherwise (a blank sequence too).
    laneLabel(d.clip&&d.clip.num||0,!!d.clip&&d.clip.edited,'SEQ',true,d.pages>1?(d.page+1)+'/'+d.pages:'',false,h,fs);
    // the rotate column: move the whole sequence one step left (upper half) or right (lower half)
    {const x0=LW-LROT+3,hh=(h-6)/2;
      for(const [y,dir] of [[3,-1],[3+hh+1,1]]){g.fillStyle='#1f2229';rr(x0,y,LROT-4,hh-1,5);g.fill();
        const cx=x0+(LROT-4)/2,yc=y+hh/2-0.5;g.fillStyle='#a7adb8';g.beginPath();g.moveTo(cx+4*dir,yc);g.lineTo(cx-3*dir,yc-5);g.lineTo(cx-3*dir,yc+5);g.closePath();g.fill();}}
    const w=(LW-LLAB-LROT)/d.pr,at=j=>[LLAB+(j%d.pr)*w,4+Math.floor(j/d.pr)*LROW];
    if(d.clip){
      for(let j=0;j<d.n;j++){
        const idx=d.page*d.per+j,s=d.slots[idx];if(idx>=d.slots.length)continue;
        const lit=laneHold&&laneHold.idx===idx&&laneHold.clip===d.clip?'hold':st.playing&&idx===d.playIdx?(recOn?'rec':true):false,dim=s.on===false||patDim(t,idx);
        const [x,y]=at(j);laneCell(t,s,x,y,w,LROW-5,lit,dim,fs,(s.off||0)>0,j*16/t.cols);
      }
    }else{
      // live: the current bar as it plays
      const H=(st.hist||[]),cur=H.length?H[H.length-1]:null,bp=cur?cur.bp:-1,bn=cur?cur.bn:-1;
      const heard=new Map();if(st.playing)for(const e of H)if(e.bn===bn)heard.set(e.bp,e);
      for(let j=0;j<d.n;j++){
        const s=heard.get(j)||null,now=st.playing&&j===bp,[x,y]=at(j);
        laneCell(t,s,x,y,w,LROW-5,now,s?!s.on:patDim(t,j),fs,s&&(s.off||0)>0);
      }
    }
  }
  function drawStrips(fs){
    const t=T(),sw=SWD();let y0=yOrder(),h=STRIP;
    // pin box (left): when on, strip moves are kept on the sequence; when off they are live and snap back
    const box=(y,on)=>{g.fillStyle=on?'#3a3120':'#1a1d23';rr(0,y,26,h,6);g.fill();const c=on?ACC:'#6c7380',cx=13,cy=y+h/2;
      g.fillStyle=c;g.strokeStyle=c;g.lineWidth=1.6;g.beginPath();g.arc(cx,cy-3.5,3.6,0,Math.PI*2);on?g.fill():g.stroke();
      g.beginPath();g.moveTo(cx,cy);g.lineTo(cx,cy+7);g.stroke();};
    const ghost=(v,y,col)=>{if(v==null)return;g.strokeStyle=col;g.lineWidth=1.5;g.setLineDash([2,2]);rr(stripX(v)-3,y+2,6,h-4,3);g.stroke();g.setLineDash([]);};
    // ORDER and SKIP (GAP): the small zone at the left, next to the pin, is the default; the further right,
    // the more the pattern changes. Each position is one fixed pattern, numbered. The solid marker is the
    // stored value, the dashed one a live (unpinned) move.
    const fine=[...special.values()].find(sp=>sp.kind==='strip'&&sp.fine);
    const strip=(y,which,name,col,colA,defLab)=>{
      const v=which==='order'?oV(t):mV(t),n=patNo(v),dz=SX+(1-EF.DEAD)*sw;
      g.fillStyle='#1a1d23';rr(SX,y,sw,h,7);g.fill();
      const grd=g.createLinearGradient(dz,0,cssW,0);grd.addColorStop(0,colA(.03));grd.addColorStop(1,colA(.30));
      g.fillStyle=grd;rr(dz,y,cssW-dz,h,7);g.fill();
      g.fillStyle=n?'#262a32':colA(.22);g.fillRect(SX+2,y+3,dz-SX-2,h-6);
      g.textBaseline='middle';g.font=`600 ${fs}px ${FONT}`;g.textAlign='left';g.fillStyle=n?col:'#8a8f99';g.fillText(name,dz+8,y+h/2);
      g.textAlign='right';g.font=`${n?600:400} ${fs}px ${FONT}`;g.fillStyle=n?col:'#6c7380';
      g.fillText(fine&&fine.which===which?'FINE · #'+n:n?'#'+n:defLab,cssW-10,y+h/2);
      g.fillStyle=col;rr(Math.max(SX+1,stripX(ctxSet(t)[which+'V'])-2),y+3,4,h-6,2);g.fill();ghost(liveV[which],y,'#fff');
      box(y,pin[which]);
    };
    strip(y0,'order','ORDER',ACC,ACCA,'FORWARD');
    strip(yMute(),'mute',silOf(t)==='insert'?'GAP':'SKIP','#b8c4ff',a=>'rgba(150,170,255,'+a+')','NONE');
  }
  function draw(){
    requestAnimationFrame(draw);
    if(sessOn){drawPlayingClip();return;}
    if(projOn)return;
    g=gridG;g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle=BG;g.fillRect(0,0,cssW,cssH);
    if('letterSpacing' in g)g.letterSpacing='0.06em';
    const t=T(),i=info(view),cols=t.cols,cw=W()/cols,gap=3;
    const unitH=lay.length?Math.min(...lay.map(r=>r.h)):30,fs=unitH<24?9:10;
    const step=16/cols,curSlice=st.playing&&i.src&&!i.rest?Math.floor(i.a/step):-1;
    if(fieldEdit){drawEdit(fs);return;}
    const E=entriesOf(t);
    // marks: each held touch once per effect it drives (raw: its value in that cell); dry ones as 'dry'
    const marks=[];for(const e of E){const base={a:e.a,n:e.n,ts:e.ts,hid:e.hid,finger:e.finger};if(!e.fxs.length)marks.push(Object.assign({fx:'dry',raw:0},base));
      for(const f of e.fxs)marks.push(Object.assign({fx:f.k,raw:f.raw},base));}
    const nowHid=i.src==='touch'&&i.sid?i.sid.slice(1,i.sid.indexOf('#')):null;
    const touch=new Set();for(const p of ptrs.values())if(p.live&&p.tr===view&&p.cells)for(const ri of p.cells)touch.add(ri+':'+(fxOnly?0:p.col));
    // FX ONLY: slices come from the sequence, so each row is one undivided strip: a touch anywhere in it
    // plays that row's effect. dc/dw: the columns drawn and their width; span: where a held cell is drawn.
    const dc=fxOnly?1:cols,dw=W()/dc,span=m=>fxOnly?[HW+gap/2,W()-gap]:[cellX(t,m.a)+gap/2,m.n/16*W()-gap];
    lay.forEach((r,ri)=>{
      const hue=hueOf(t,r.id),hw=HW/r.lanes,hx=r.lane*hw;
      // the handle: overlapping cells share the column, one lane each
      g.fillStyle='#1a1d23';rr(hx,r.y,hw-3,r.h,5);g.fill();
      g.fillStyle=`hsl(${hue} 60% 55%)`;g.fillRect(hx+3,r.y+4,3,r.h-8);
      if(hw>20){g.fillStyle='#6c7380';for(let q=0;q<3;q++)g.fillRect(hx+11,r.y+r.h/2-5+q*4,hw-21,1.5);}
      // where cells overlap, each is drawn see-through (so the overlap shows both colours) and outlined
      const ov=r.lanes>1;if(ov)g.globalAlpha=0.66;
      if(r.id==='center'){drawCenter(t,i,r,ri,curSlice,marks,touch,cw,gap,fs,nowHid,dc,dw,span);g.globalAlpha=1;if(ov)outlineCell(r,hue);return;}
      const k=r.id,c=t.cfg[k],d=FX[k],cn=c.cells.filter(n=>d.params[n]),P=cn.length?d.params[cn[0]]:null,pn=cn[0];
      const rm=marks.filter(m=>m.fx===k);
      for(let col=0;col<dc;col++){
        let l=13,s=16;if(!fxOnly&&col===curSlice&&!i.fx.length)l+=3;
        g.fillStyle=`hsl(${hue} ${s}% ${l}%)`;rr(HW+col*dw+gap/2,r.y,dw-gap,r.h,5);g.fill();
      }
      for(const m of rm){const now=nowHid===m.hid,[x0,ww]=span(m);g.fillStyle=`hsl(${hue} ${now?62:42}% ${now?32:21}%)`;rr(x0,r.y,ww,r.h,5);g.fill();}
      if(st.playing&&i.fx&&i.fx.includes(k)&&curSlice>=0){const c0=fxOnly?0:curSlice;g.strokeStyle=`hsl(${hue} 80% 68%)`;g.lineWidth=1.5;rr(HW+c0*dw+gap/2+0.75,r.y+0.75,dw-gap-1.5,r.h-1.5,5);g.stroke();}
      for(let col=0;col<dc;col++)if(touch.has(ri+':'+col)){g.fillStyle=`hsl(${hue} 70% 46%)`;rr(HW+col*dw+gap/2,r.y,dw-gap,r.h,5);g.fill();}
      if(cellBip(t,k)){
        const yb1=r.y+r.h*(1-BAND_HI),yb2=r.y+r.h*(1-BAND_LO);
        g.fillStyle='rgba(0,0,0,.28)';g.fillRect(HW,yb1,W(),yb2-yb1);
        g.setLineDash([2,4]);g.strokeStyle=`hsl(${hue} 30% 55%)`;g.lineWidth=1;
        g.beginPath();g.moveTo(HW,yb1);g.lineTo(cssW,yb1);g.moveTo(HW,yb2);g.lineTo(cssW,yb2);g.stroke();g.setLineDash([]);
        if(d.tall){g.textBaseline='middle';g.font=`400 ${fs}px ${FONT}`;g.textAlign='center';g.fillStyle=`hsl(${hue} 20% 58%)`;
          g.fillText('NO CHANGE',HW+W()/2,(yb1+yb2)/2);}
        if(c.o&&c.o.mask&&P&&P.bip){
          g.fillStyle=`hsl(${hue} 30% ${rm.length?60:42}%)`;
          const nu=EF.scaleNotes(c.o.mask,1).length,nd=EF.scaleNotes(c.o.mask,-1).length;
          for(let q=1;q<nu;q++){const raw=q/nu/c.hi[pn];if(raw<1)g.fillRect(cssW-6,yb1-(yb1-r.y)*raw-0.5,4,1);}
          for(let q=1;q<nd;q++){const raw=q/nd/(-c.lo[pn]);if(raw<1)g.fillRect(cssW-6,yb2+(r.y+r.h-yb2)*raw-0.5,4,1);}
        }
      }else if(P&&P.steps){
        const n=P.steps(c.o),lo=c.lo[pn],hi=c.hi[pn];
        if(n&&hi!==lo){g.fillStyle=`hsl(${hue} 30% ${rm.length?55:34}%)`;for(let q=1;q<n;q++){const rel=(q/n-lo)/(hi-lo);if(rel>0&&rel<1){const yy=r.y+r.h*(1-rel);g.fillRect(cssW-6,yy-0.5,4,1);}}}
      }
      const lines=rm.map(m=>{const [x0,ww]=span(m);return {x0:x0+3,x1:x0+ww-3,raw:m.raw};});
      // a held finger hides its own cell, so its value is also shown as a faint guide across the row
      if(P)for(const m of rm)if(m.finger){const yy=r.y+r.h*(1-rawToRel(t,k,m.raw));g.setLineDash([3,3]);g.strokeStyle=`hsla(${hue} 85% 72% / .55)`;g.lineWidth=1;g.beginPath();g.moveTo(HW,yy);g.lineTo(cssW,yy);g.stroke();g.setLineDash([]);}
      if(P)for(const L of lines){const yy=r.y+r.h*(1-rawToRel(t,k,L.raw));g.strokeStyle=`hsl(${hue} 85% 72%)`;g.lineWidth=1.5;g.beginPath();g.moveTo(L.x0,yy);g.lineTo(L.x1,yy);g.stroke();}
      const latest=(rm.length?rm.reduce((x,y)=>y.ts>x.ts?y:x):null);
      g.textBaseline='middle';const ty=d.tall||cellBip(t,k)?r.y+Math.min(12,r.h*(1-BAND_HI)/2+1):r.h>46?r.y+12:r.y+r.h/2;
      g.font=`600 ${fs}px ${FONT}`;g.textAlign='left';g.fillStyle=latest?`hsl(${hue} 90% 84%)`:`hsl(${hue} 50% 64%)`;
      g.fillText(d.name.toUpperCase(),HW+8,ty);
      g.font=`400 ${fs}px ${FONT}`;g.textAlign='right';g.fillStyle=latest?'#fff':`hsl(${hue} 14% 52%)`;
      let lab='';
      if(P){if(latest){const v=resolve(t,k,latest.raw);lab=cn.map(n=>d.params[n].lab(v[n],c.o)).join(' · ');}
        else lab=P.bip?P.lab(c.lo[pn],c.o)+' ↓  ↑ '+P.lab(c.hi[pn],c.o):P.lab(c.lo[pn],c.o)+' → '+P.lab(c.hi[pn],c.o);}
      g.fillText(lab,cssW-12,ty);
      g.globalAlpha=1;if(ov)outlineCell(r,hue);
    });
    drawOverlaps(fs);
    const y0=lay.length?lay[0].y:TOP;
    // columns past this track's bar length still play their slices, but sit outside the bar
    const xe=cellX(t,t.len16);if(!fxOnly&&xe<cssW-1){g.fillStyle='rgba(10,11,14,.42)';g.fillRect(xe,y0,cssW-xe,cssH-y0);}
    // the current step when it is silenced
    if(!fxOnly&&st.playing&&i.gate===false&&i.src){g.fillStyle='rgba(10,11,14,.5)';const x=i.rest?HW+((i.s+Math.max(0,i.barPos))%cols)*cw:HW+curSlice*cw;if(x>=HW)g.fillRect(x,y0,cw,cssH-y0);}
    drawStrips(fs);drawGame(fs);
    g=laneG;laneG.setTransform(laneDpr,0,0,laneDpr,0,0);laneG.fillStyle=BG;laneG.fillRect(0,0,LW,laneRows*LROW+6);
    if('letterSpacing' in laneG)laneG.letterSpacing='0.06em';drawLane(fs);g=gridG;
    for(const p of ptrs.values())if(p.tr===view){g.strokeStyle='rgba(255,255,255,.85)';g.lineWidth=2;g.beginPath();g.arc(p.x,p.y,17,0,Math.PI*2);g.stroke();}
    // a grabbed effect row is outlined; while dragging, a copy follows the finger and a line shows where it lands
    for(const sp of special.values())if(sp.kind==='handle'){
      const r=lay.find(x=>x.id===sp.id);if(!r)continue;
      g.strokeStyle=ACC;g.lineWidth=2;rr(1,r.y+1,cssW-2,r.h-2,6);g.stroke();
      g.fillStyle=ACCA(.10);g.fillRect(0,r.y,cssW,r.h);
      if(sp.moved){
        const gh=Math.min(r.h,40);g.globalAlpha=0.9;g.fillStyle='#2a2619';rr(4,sp.y-gh/2,cssW-8,gh,6);g.fill();g.strokeStyle=ACC;g.lineWidth=1.5;rr(4,sp.y-gh/2,cssW-8,gh,6);g.stroke();
        g.fillStyle=ACC;g.font=`600 ${fs}px ${FONT}`;g.textAlign='left';g.textBaseline='middle';g.fillText((sp.id==='center'?'LOOP':FX[sp.id].name.toUpperCase()),HW+8,sp.y);g.globalAlpha=1;
        // the line between the groups (cells overlapping move together) where it will land
        const gs=fieldGroups(T().field),area=cssH-TOP,uy=(sp.y-TOP)/area*FG;let to=gs.findIndex(q=>uy<(q.top+q.end)/2);
        const yy=to<0?TOP+gs[gs.length-1].end/FG*area:TOP+gs[to].top/FG*area;
        g.fillStyle=ACC;g.fillRect(0,yy-1.5,cssW,3);
      }
    }
    // a track that is muted, or silenced by another track's solo, is dimmed
  }
  // where two cells overlap: stripes of both colours, and both names (a touch there drives both)
  function drawOverlaps(fs){
    for(let a=0;a<lay.length;a++)for(let b=a+1;b<lay.length;b++){
      const A=lay[a],B=lay[b],y0=Math.max(A.y,B.y),y1=Math.min(A.y+A.h,B.y+B.h);if(y1-y0<4)continue;
      g.save();g.beginPath();g.rect(HW,y0,W(),y1-y0);g.clip();g.lineWidth=5;
      for(let x=HW-(y1-y0),q=0;x<cssW;x+=10,q++){g.strokeStyle=`hsla(${hueOf(T(),q%2?B.id:A.id)} 70% 55% / .16)`;g.beginPath();g.moveTo(x,y1);g.lineTo(x+(y1-y0),y0);g.stroke();}
      g.restore();
      const nm=r=>r.id==='center'?'FILTER':FX[r.id].name.toUpperCase();
      g.font=`600 ${fs-1}px ${FONT}`;g.textAlign='center';g.textBaseline='middle';g.fillStyle='rgba(255,255,255,.75)';
      g.fillText(nm(A)+' + '+nm(B),HW+W()/2,(y0+y1)/2);
    }
  }
  function outlineCell(r,hue){g.strokeStyle=`hsla(${hue} 80% 65% / .8)`;g.lineWidth=1;g.setLineDash([4,3]);rr(HW+1,r.y+0.5,W()-2,r.h-1,5);g.stroke();g.setLineDash([]);}
  function drawCenter(t,i,r,ri,curSlice,marks,touch,cw,gap,fs,nowHid,dc,dw,span){
    const cols=t.cols,bot=r.y+r.h,fm=marks.filter(m=>m.fx==='filter'),dm=marks.filter(m=>m.fx==='dry'),fh=t.cfg.filter.hue;
    for(let col=0;col<dc;col++){g.fillStyle=!fxOnly&&col===curSlice?'#252931':'#1a1d23';rr(HW+col*dw+gap/2,r.y,dw-gap,r.h,6);g.fill();}
    for(const m of dm){const now=nowHid===m.hid,[x0,ww]=span(m);g.fillStyle=now?'#3a3527':'#2a2822';rr(x0,r.y,ww,r.h,6);g.fill();}
    for(let col=0;col<dc;col++)if(touch.has(ri+':'+col)){g.fillStyle='#343a46';rr(HW+col*dw+gap/2,r.y,dw-gap,r.h,6);g.fill();}
    const fz=(x0,x1,raw,now)=>{const hp=raw>0;g.fillStyle=hp?`hsla(${fh} 85% 60% / ${now?0.36:0.2})`:`hsla(${(fh+160)%360} 85% 60% / ${now?0.36:0.2})`;
      if(hp)g.fillRect(x0,r.y,x1-x0,r.z1-r.y);else g.fillRect(x0,r.z2,x1-x0,bot-r.z2);};
    for(const s of fm){const [x0,ww]=span(s);fz(x0,x0+ww,s.raw,nowHid===s.hid);}
    const pk=t.pk;
    if(pk){
      const mid=r.y+r.h/2,amp=r.h*0.46,B=pk.length/2,c0=HW+curSlice*cw,c1=c0+cw;
      for(const pass of [0,1]){
        g.beginPath();
        for(let x=HW;x<cssW;x+=1){const inSl=x>=c0&&x<c1;if(pass===0&&inSl||pass===1&&!inSl)continue;
          const k=Math.min(B-1,Math.floor((x-HW)/W()*B));g.moveTo(x+0.5,mid-pk[k*2+1]*amp);g.lineTo(x+0.5,mid-pk[k*2]*amp+0.5);}
        g.strokeStyle=pass?'#ece7dc':'#6c7380';g.lineWidth=1;g.stroke();
      }
    }
    // a line at each held or latched filter value, like the other rows
    if(hasCell(t,'filter')){
      const fl=fm.map(m=>{const [x0,ww]=span(m);return {x0:x0+3,x1:x0+ww-3,raw:m.raw};});
      for(const m of fm)if(m.finger){const hp=m.raw>0,yy=hp?r.z1-(r.z1-r.y)*m.raw:r.z2+(bot-r.z2)*(-m.raw);g.setLineDash([3,3]);g.strokeStyle=hp?`hsla(${fh} 90% 72% / .55)`:`hsla(${(fh+160)%360} 90% 72% / .55)`;g.lineWidth=1;g.beginPath();g.moveTo(HW,yy);g.lineTo(cssW,yy);g.stroke();g.setLineDash([]);}
      for(const L of fl){const hp=L.raw>0,yy=hp?r.z1-(r.z1-r.y)*L.raw:r.z2+(bot-r.z2)*(-L.raw);
        g.strokeStyle=hp?`hsl(${fh} 90% 72%)`:`hsl(${(fh+160)%360} 90% 72%)`;g.lineWidth=1.5;g.beginPath();g.moveTo(L.x0,yy);g.lineTo(L.x1,yy);g.stroke();}
    }
    g.setLineDash([2,4]);g.strokeStyle='#8a8f99';g.lineWidth=1;g.beginPath();g.moveTo(HW,r.z1);g.lineTo(cssW,r.z1);g.moveTo(HW,r.z2);g.lineTo(cssW,r.z2);g.stroke();g.setLineDash([]);
    const latest=(fm.length?fm.reduce((x,y)=>y.ts>x.ts?y:x):null),P=FX.filter.params.cut;
    g.textBaseline='middle';g.font=`600 ${fs}px ${FONT}`;g.textAlign='left';
    const yHp=(r.y+r.z1)/2,yLp=(r.z2+bot)/2;
    g.fillStyle=latest&&latest.raw>0?`hsl(${fh} 90% 80%)`:`hsl(${fh} 40% 58%)`;g.fillText('HIGH-PASS ↑',HW+8,yHp);
    g.fillStyle=latest&&latest.raw<0?`hsl(${(fh+160)%360} 90% 80%)`:`hsl(${(fh+160)%360} 40% 60%)`;g.fillText('LOW-PASS ↓',HW+8,yLp);
    g.textAlign='right';g.font=`400 ${fs}px ${FONT}`;
    const lv=latest?P.lab(resolve(t,'filter',latest.raw).cut):'';
    g.fillStyle='#fff';if(latest&&latest.raw>0)g.fillText(lv,cssW-12,yHp);if(latest&&latest.raw<0)g.fillText(lv,cssW-12,yLp);
    g.textAlign='left';g.fillStyle='#8a8f99';g.font=`500 ${fs}px ${FONT}`;g.textBaseline='top';
    const every=cols>8&&cw<30?2:1;
    if(!fxOnly)for(let col=0;col<cols;col+=every)g.fillText(String(col+1),HW+col*cw+gap/2+4,r.z1+4);
    if(st.playing&&i.src&&!i.rest){const x=HW+(i.pos/16)*W();g.fillStyle=ACC;g.fillRect(x-0.75,r.z1,1.5,r.z2-r.z1);}
  }

  // ---------- game (first pass: no scoring) ----------
  // A round is 16 bars after a one-bar count-in. Targets appear over the field on the beat; hitting one is
  // just touching the cell under it, so everything you do is played and, with Record on for the round,
  // written into the sequence. At the end of every round bar the sequence is captured, so a round always
  // leaves 16 clips, whatever happens.
  //   drone: tap it.  armoured: hold it for its beats (letting go early resets it).  serpent: hold its head
  //   and follow it to the end of its path.  linked: hold all of its nodes at once.  mine: don't touch it
  //   (a finger that does is silenced until it lifts).
  // Difficulty is the tempo. The game only reads touches; the engine is driven as by any fingers.
  let gameOn=false,game=null,gameMsg=null;
  const GBARS=16,BEAT=0.25,LEAD=0.125;
  const nowSamples=()=>st.playing?st.t+(performance.now()-st.recv)*sr/1000:st.t;
  const barS=()=>{const t=T();return Math.max(1,barSteps(t)*st.len/t.cols);};
  const nowBar=()=>nowSamples()/barS();
  gameBtn.addEventListener('click',()=>{if(gameOn)endGame(true,'Round stopped');else startGame();});
  function startGame(){
    if(sessOn||gameOn)return;if(fieldEdit)setFieldEdit(false);
    gameOn=true;checkpoint();recOn=true;recBn=-1;sendRec();
    game={startBar:null,plan:null,next:0,enemies:[],parts:[],captured:0,hits:0,missed:0,lastNb:-1,capNext:0};
    ensurePlaying();gameMsg=null;paintIcons();
  }
  function endGame(early,text){
    if(!gameOn)return;const g0=game;gameOn=false;game=null;
    recOn=false;recBn=-1;sendRec();
    for(const p of ptrs.values())if(p.mined){p.mined=false;}push(T());
    gameMsg={text:text||(g0.captured+' clips saved'),sub:g0.hits+' hit · '+g0.missed+' got away'+(g0.captured<GBARS?'':' · see them on the Clips page'),until:performance.now()+5000};
    paintIcons();
  }
  // the plan: what appears when (in bars from the start of playback), harder as the round goes on
  function makePlan(b0){
    const R=Math.random,out=[];
    for(let b=0;b<GBARS;b++){
      const bar=b0+b,lv=b/GBARS,beats=[0,1,2,3].concat(b>=6?[0.5,1.5,2.5,3.5]:[]).sort(()=>R()-0.5);
      const nd=2+Math.floor(lv*3);for(let i=0;i<nd&&i<beats.length;i++)out.push({type:'drone',t0:bar+beats[i]*BEAT});
      if(b>=4&&R()<0.7)out.push({type:'armour',t0:bar+Math.floor(R()*2)*BEAT,H:1+Math.floor(R()*Math.min(4,1+lv*4))});
      if(b>=8&&b%2===0)out.push({type:'serpent',t0:bar+(1+Math.floor(R()*2))*BEAT,D:2+Math.floor(R()*3)});
      if(b>=8&&b%2===1)out.push({type:'linked',t0:bar+Math.floor(R()*3)*BEAT,n:b>=12?3:2});
      if(b>=12){const nm=1+Math.floor(R()*2);for(let i=0;i<nm;i++)out.push({type:'mine',t0:bar+Math.floor(R()*4)*BEAT});}
    }
    return out.sort((a,b)=>a.t0-b.t0);
  }
  // a place on the field: a column, and a height inside one of the field's cells (not too near a finger)
  function gameSpot(avoid){
    const t=T(),cw=W()/t.cols,R=Math.random;
    for(let tries=0;tries<20;tries++){
      const r=lay[Math.floor(R()*lay.length)];if(!r)break;
      const x=HW+(Math.floor(R()*t.cols)+0.5)*cw,y=r.b0+(0.15+0.7*R())*(r.b1-r.b0);
      if(avoid&&[...ptrs.values()].some(p=>Math.hypot(p.x-x,p.y-y)<70))continue;
      return {fx:(x-HW)/W(),fy:(y-TOP)/Math.max(1,cssH-TOP)};
    }
    return {fx:0.5,fy:0.5};
  }
  const gpx=q=>[HW+q.fx*W(),TOP+q.fy*(cssH-TOP)];
  function spawn(s){
    const e=Object.assign({state:'alive',born:performance.now(),prog:0},s);
    if(s.type==='serpent'){const t=T(),cols=t.cols;let c=Math.floor(Math.random()*cols),q=gameSpot();e.path=[q];
      for(let i=0;i<3+Math.floor(Math.random()*3);i++){c=clamp(c+(Math.random()<0.5?-1:1)*(1+Math.floor(Math.random()*2)),0,cols-1);
        const n=gameSpot();e.path.push({fx:(c+0.5)/cols,fy:clamp(q.fy+(n.fy-q.fy)*0.5,0.02,0.98)});q=e.path[e.path.length-1];}
      e.trk=0;e.broken=false;e.was=false;}
    else if(s.type==='linked'){e.nodes=[];for(let i=0;i<s.n;i++)e.nodes.push(gameSpot());e.hold=0;}
    else Object.assign(e,gameSpot(s.type==='mine'));
    game.enemies.push(e);
  }
  const RAD=()=>Math.max(22,Math.min(34,W()/T().cols*0.7));
  const fingers=()=>[...ptrs.values()].filter(p=>p.live&&p.tr===view);
  const near=(x,y)=>fingers().some(p=>Math.hypot(p.x-x,p.y-y)<RAD());
  function burst(x,y,col){game.parts.push({x,y,col,t:performance.now()});}
  function kill(e,x,y){e.state='dead';e.dead=performance.now();game.hits++;burst(x,y,'#ffd1e6');}
  function miss(e){e.state='gone';e.dead=performance.now();game.missed++;}
  // a finger coming down: drones are tapped
  function gameDown(ptr){
    if(!game||!game.plan)return;const nb=nowBar();
    for(const e of game.enemies)if(e.state==='alive'&&e.type==='drone'&&nb>=e.t0-0.06){const [x,y]=gpx(e);if(Math.hypot(ptr.x-x,ptr.y-y)<RAD()){kill(e,x,y);break;}}
  }
  function gameTick(){
    const g0=game,i=info(0);if(!g0)return;
    if(!st.playing){if(g0.startBar!=null&&!intent)endGame(true,'Round stopped');return;}
    const nb=nowBar();
    if(g0.startBar==null){const f=nb%1;g0.startBar=nb<0.3?1:Math.floor(nb)+(f<0.5?1:2);g0.plan=makePlan(g0.startBar);g0.lastNb=nb;}
    const dt=Math.max(0,Math.min(0.1,nb-g0.lastNb));g0.lastNb=nb;
    // capture each round bar once the engine has moved past it (its last step has been written by then)
    const bn=i.barN==null?-1:i.barN;
    while(g0.capNext<GBARS&&bn>=g0.startBar+g0.capNext+1){const t=T();clips.push(clipOf(t,t.seq));selClip=clips[clips.length-1];g0.capNext++;g0.captured++;flashCapture();paintIcons();}
    if(g0.capNext>=GBARS){endGame(false);return;}
    while(g0.next<g0.plan.length&&g0.plan[g0.next].t0-LEAD<=nb)spawn(g0.plan[g0.next++]);
    for(const e of g0.enemies){if(e.state!=='alive')continue;
      if(e.type==='drone'){if(nb>e.t0+1.25*BEAT)miss(e);}
      else if(e.type==='armour'){const [x,y]=gpx(e);if(nb>=e.t0-LEAD&&near(x,y)){e.prog+=dt/BEAT;if(e.prog>=e.H)kill(e,x,y);}else e.prog=0;if(e.state==='alive'&&nb>e.t0+(e.H+2)*BEAT)miss(e);}
      else if(e.type==='serpent'){const u=(nb-e.t0)/(e.D*BEAT),[x,y]=serpHead(e,u);
        if(u>0&&u<1){const on=near(x,y);if(on)e.trk+=dt;else if(e.was)e.broken=true;e.was=on;}
        if(u>=1){if(e.trk/(e.D*BEAT)>=0.6)kill(e,x,y);else miss(e);}}
      else if(e.type==='linked'){const all=e.nodes.every(q=>{const [x,y]=gpx(q);return near(x,y);});
        if(all&&nb>=e.t0-LEAD){e.hold+=dt/BEAT;if(e.hold>=0.5){const [x,y]=gpx(e.nodes[0]);kill(e,x,y);e.nodes.slice(1).forEach(q=>burst(...gpx(q),'#ffd1e6'));}}else e.hold=0;
        if(e.state==='alive'&&nb>e.t0+3*BEAT)miss(e);}
      else if(e.type==='mine'){const [x,y]=gpx(e);
        for(const p of fingers())if(!p.mined&&Math.hypot(p.x-x,p.y-y)<RAD()*0.8){p.mined=true;e.state='boom';e.dead=performance.now();burst(x,y,'#ff5050');push(T());break;}
        if(e.state==='alive'&&nb>e.t0+2)e.state='gone',e.dead=performance.now();}
    }
    const now=performance.now();g0.enemies=g0.enemies.filter(e=>e.state==='alive'||now-e.dead<500);g0.parts=g0.parts.filter(p=>now-p.t<500);
  }
  function serpHead(e,u){const P=e.path,n=P.length-1,v=clamp(u,0,1)*n,j=Math.min(n-1,Math.floor(v)),f=v-j,[x1,y1]=gpx(P[j]),[x2,y2]=gpx(P[j+1]);return [x1+(x2-x1)*f,y1+(y2-y1)*f];}
  const PINK='#ff5fa2';
  function drawGame(fs){
    const now=performance.now();
    if(gameMsg&&now>gameMsg.until)gameMsg=null;
    if(!gameOn){if(gameMsg)hud(gameMsg.text,gameMsg.sub,fs);return;}
    gameTick();const g0=game;if(!g0)return;
    const nb=g0.plan?nowBar():0,R=RAD();
    if(g0.startBar==null||nb<g0.startBar){const left=g0.startBar==null?4:Math.max(1,Math.ceil((g0.startBar-nb)/BEAT));hud('GET READY  '+left,'16 bars · every bar becomes a clip',fs);}
    else hud('BAR '+Math.min(GBARS,Math.floor(nb)-g0.startBar+1)+' / '+GBARS,g0.captured+' clips · '+g0.hits+' hit',fs);
    for(const e of g0.enemies){
      const fade=e.state==='alive'?clamp((nb-(e.t0-LEAD))/LEAD,0.15,1):Math.max(0,1-(now-e.dead)/500);
      g.globalAlpha=fade;
      if(e.type==='drone'){const [x,y]=gpx(e),r=R*0.5,a=now/400;g.save();g.translate(x,y);g.rotate(a);
        g.fillStyle='rgba(255,95,162,.25)';g.beginPath();g.arc(0,0,R*0.9,0,7);g.fill();
        g.fillStyle=e.state==='dead'?'#fff':PINK;g.beginPath();g.moveTo(0,-r);g.lineTo(r,0);g.lineTo(0,r);g.lineTo(-r,0);g.closePath();g.fill();g.restore();}
      else if(e.type==='armour'){const [x,y]=gpx(e),r=R*0.75;g.strokeStyle=PINK;g.lineWidth=3;g.beginPath();for(let k=0;k<6;k++){const a=k*Math.PI/3+Math.PI/6;g[k?'lineTo':'moveTo'](x+r*Math.cos(a),y+r*Math.sin(a));}g.closePath();g.stroke();
        g.fillStyle='rgba(255,95,162,.18)';g.fill();
        if(e.prog>0){g.strokeStyle='#fff';g.lineWidth=4;g.beginPath();g.arc(x,y,r+6,-Math.PI/2,-Math.PI/2+2*Math.PI*Math.min(1,e.prog/e.H));g.stroke();}
        g.fillStyle='#fff';g.font=`700 ${fs+2}px ${FONT}`;g.textAlign='center';g.textBaseline='middle';g.fillText(String(Math.max(1,Math.ceil(e.H-e.prog))),x,y+0.5);}
      else if(e.type==='serpent'){const u=(nb-e.t0)/(e.D*BEAT);
        g.strokeStyle='rgba(255,95,162,.35)';g.lineWidth=2;g.setLineDash([4,5]);g.beginPath();e.path.forEach((q,k)=>{const [x,y]=gpx(q);g[k?'lineTo':'moveTo'](x,y);});g.stroke();g.setLineDash([]);
        for(let k=5;k>=0;k--){const [x,y]=serpHead(e,u-k*0.05);g.fillStyle=k?`rgba(255,95,162,${0.5-k*0.07})`:(e.broken?'#a05a7a':PINK);g.beginPath();g.arc(x,y,k?R*0.35:R*0.55,0,7);g.fill();}
        const [hx,hy]=serpHead(e,u);if(u<0){g.strokeStyle='#fff';g.lineWidth=1.5;g.beginPath();g.arc(hx,hy,R*0.8,0,7);g.stroke();}}
      else if(e.type==='linked'){const P=e.nodes.map(gpx);g.strokeStyle=PINK;g.lineWidth=2;g.beginPath();P.forEach(([x,y],k)=>g[k?'lineTo':'moveTo'](x,y));if(P.length>2)g.closePath();g.stroke();
        for(const [x,y] of P){const on=near(x,y);g.fillStyle=on?'#fff':PINK;g.beginPath();g.arc(x,y,R*0.45,0,7);g.fill();g.strokeStyle='rgba(255,95,162,.5)';g.lineWidth=1.5;g.beginPath();g.arc(x,y,R*0.8,0,7);g.stroke();}}
      else if(e.type==='mine'){const [x,y]=gpx(e),p=1+0.12*Math.sin(now/120),r=R*0.42*p;g.fillStyle=e.state==='boom'?'#ff5050':'#c0303a';g.beginPath();g.arc(x,y,r,0,7);g.fill();
        g.strokeStyle='#ff8080';g.lineWidth=2;g.beginPath();for(let k=0;k<8;k++){const a=k*Math.PI/4;g.moveTo(x+r*Math.cos(a),y+r*Math.sin(a));g.lineTo(x+(r+6)*Math.cos(a),y+(r+6)*Math.sin(a));}g.stroke();}
      g.globalAlpha=1;
    }
    for(const q of g0.parts){const k=(now-q.t)/500;g.globalAlpha=1-k;g.strokeStyle=q.col;g.lineWidth=3;g.beginPath();g.arc(q.x,q.y,R*(0.6+1.6*k),0,7);g.stroke();}
    g.globalAlpha=1;
    // a silenced finger (it touched a mine) is shown red
    for(const p of fingers())if(p.mined){g.strokeStyle='#ff5050';g.lineWidth=3;g.beginPath();g.arc(p.x,p.y,20,0,7);g.stroke();}
  }
  // the round's state, over the ORDER and SKIP strips (which rest during a round)
  function hud(big,small,fs){
    g.fillStyle='rgba(17,19,23,.94)';g.fillRect(0,0,cssW,TOP-4);g.strokeStyle=PINK;g.lineWidth=1;rr(0.5,0.5,cssW-1,TOP-5,7);g.stroke();
    g.fillStyle='#ffd1e6';g.font=`700 ${fs+3}px ${FONT}`;g.textAlign='left';g.textBaseline='middle';g.fillText(big,12,(TOP-4)/2-(small?7:0));
    if(small){g.fillStyle='#c9a3b6';g.font=`400 ${fs}px ${FONT}`;g.fillText(small,12,(TOP-4)/2+10);}
  }

  // ---------- start ----------
  // the layout is portrait only; where the browser allows it, keep the screen upright
  try{const o=screen.orientation;if(o&&o.lock){const p=o.lock('portrait');if(p&&p.catch)p.catch(()=>{});}}catch(_){}
  tracks[0].seq=blankClip(tracks[0]);savedSig=projSig();
  paintIcons();computeLayout();dieEl.innerHTML=ICON.dice;
  // the count on the Clips button (and Capture) flash once, after a capture
  [sessBtn,capBtn].forEach(b=>b.addEventListener('animationend',()=>b.classList.remove('flash'),true));
  (function pre(){let n=0;const nx=()=>{if(n>=tracks.length)return;const t=tracks[n++];if(!t.buf){t.buf=buildLoop(t,48000);t.pk=peaks(t.buf);}setTimeout(nx,10);};setTimeout(nx,0);})();
  requestAnimationFrame(draw);
}
