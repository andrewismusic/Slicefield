// The interface. Runs as the Slicefield constructor: everything it keeps is local to this instance, and it
// draws into the host element's shadow root.
function slicefieldUI(hostEl,engineFactory,synth,markup){
  const EF=engineFactory(),FX=EF.FX,{makeLoop,resample}=synth;
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
  const playBtn=$('play'),bpmEl=$('bpm'),swingEl=$('swing'),expBtn=$('export'),modeBtn=$('recmode'),fxoBtn=$('fxonly'),clearBtn=$('clear'),steppedBtn=$('stepped'),diceEl=$('dice'),dieEl=$('die'),diceVal=$('diceval'),prefsBtn=$('prefs'),sessBtn=$('sessbtn'),recBtn=$('rec'),capBtn=$('capture'),loopBtn=$('cliploop'),dupBtn=$('dupclip'),loadBtn=$('loadclip'),projBtn=$('project'),projIn=$('projfile');
  const soundSel=$('sound'),fileIn=$('file'),sheet=$('sheet'),card=$('card');
  const sessEl=$('session'),takeList=$('takelist'),takesHead=$('takeshead'),sessScroll=$('sessScroll'),ghost=$('ghost');

  // ---------- state ----------
  function defCfg(){
    const c=EF.allCfg();for(const k in c)c[k].hue=FX[k].hue;
    return c;
  }
  // One channel: a single track (the engine could run more side by side, the app uses one).
  // seq: the sequence on the main page (null: the plain loop plays). loopSet: the plain loop's own strips.
  // kind: the loop playing, a demo loop's name or 'f:<id>' for an imported file (see files).
  // silPat: the second strip's mode, SKIP ('mute') or GAP ('insert'), kept with the sequence or loop.
  const newTrack=(i,kind)=>({i,kind,cols:16,len16:16,rows:['stutter','random','pitch','center','reverse','env','freeze','crush','delay','reverb'],
    cfg:defCfg(),loopSet:{orderV:1,muteV:1,silPat:'mute'},seq:null,buf:null,pk:null});
  const tracks=[newTrack(0,'break')];
  let view=0;
  // touchWin: touches play through SKIP.
  const PREF0={grace:40,touchWin:true};
  const prefs=Object.assign({},PREF0,{shown:new Set(ALL_FX)});
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
  let bpm=124,swing=0,stepped=true,sessOn=false,playMode='replace',fxOnly=false;
  // Clips: sequences saved with Capture, in list order. While any exist, one is selected.
  // songPlaying: the Clips list is playing (songList: the clips it was sent, in its order).
  // recOn: Record is on, so touches are written into the sequence (recBn: the bar of the last write).
  let clips=[],clipNum=0,selClip=null,clipLoop=false,songPlaying=false,songList=[],recOn=false,recBn=-1;
  let st={playing:false,t:0,len:1,tracks:[],hist:[],song:null,recv:0};
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
    if(key.startsWith('f:')){const f=files.get(key.slice(2));b=f?{L:resample(f.L,len),R:resample(f.R,len)}:makeLoop('break',rate,bpm);}
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
  function syncTrack(t){
    tx({type:'grid',tr:t.i,n:t.cols});tx({type:'range',tr:t.i,s16:0,e16:t.len16});sendCfg(t);
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
  const toEngine=e=>({id:e.hid,a:e.a,n:e.n,o:e.order,fx:e.fx==='dry'?null:{k:e.fx,raw:e.raw}});
  function entriesOf(t){
    const out=[];
    for(const p of ptrs.values())if(p.live&&p.fx&&p.tr===t.i)out.push({hid:p.hid,fx:p.fx,a:p.col*16/t.cols,n:16/t.cols,raw:p.raw,order:p.order,ts:p.ts,finger:true});
    return out;
  }
  function push(t){tx({type:'touches',tr:t.i,list:entriesOf(t).map(toEngine).sort((a,b)=>a.o-b.o)});}
  function pushFor(ptr){push(tracks[ptr.tr]);}

  // ---------- geometry ----------
  const visRows=t=>t.rows.filter(id=>id==='center'||prefs.shown.has(id));
  // the lane shows one bar, in two rows when it has more than 8 steps (pr: steps per row)
  function laneInfo(){
    const t=T(),i=info(view),clip=t.seq;
    const n=clip?clip.n:(i.n||barSteps(t)),slots=clip?clip.slots:null,rows=n>8?2:1;
    return {t,clip,n,slots,rows,pr:Math.ceil(n/rows)};
  }
  function hasCell(t,k){return t.cfg[k].cells.length>0;}
  function computeLayout(){
    laneRows=laneInfo().rows;
    TOP=STRIP+4+STRIP+6;
    sizeLane();
    // every row, including ones with no cell parameter (Reverse), is at least one unit tall
    const t=T(),rows=visRows(t),gap=3;
    const wt=id=>id==='center'?3.2:FX[id].tall&&hasCell(t,id)?2.8:1;
    const units=rows.reduce((s,id)=>s+wt(id),0)||1;
    const unit=(cssH-TOP-gap*(rows.length-1))/units;let y=TOP;
    lay=rows.map(id=>{const h=unit*wt(id),o={id,y,h};if(id==='center'){o.z1=y+h*0.36;o.z2=y+h*0.64;}y+=h+gap;return o;});
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
  const hueOf=(t,id)=>id==='center'?t.cfg.filter.hue:t.cfg[id].hue;
  const cellBip=(t,k)=>EF.rowBip(t.cfg[k],k);
  const yOrder=()=>0,yMute=()=>yOrder()+STRIP+4;
  function hit(x,y){
    const t=T();
    if(y<yMute()-2)return {strip:'order',snapBox:x<SX-2};
    if(y<TOP-3)return {strip:'mute',snapBox:x<SX-2};
    let ri=lay.findIndex(r=>y<r.y+r.h);if(ri<0)ri=lay.length-1;
    const r=lay[ri];
    if(x<HW)return {handle:true,ri,id:r.id};
    const col=Math.min(t.cols-1,Math.max(0,Math.floor((x-HW)/W()*t.cols)));
    if(r.id==='center'){
      if(y<r.z1)return {cell:true,col,ri,fx:'filter',raw:Math.max(0.001,clamp((r.z1-y)/(r.z1-r.y),0,1))};
      if(y>r.z2)return {cell:true,col,ri,fx:'filter',raw:-Math.max(0.001,clamp((y-r.z2)/(r.y+r.h-r.z2),0,1))};
      return {cell:true,col,ri,fx:'dry',raw:0};
    }
    const rel=clamp(1-(y-r.y)/r.h,0,1);
    if(cellBip(t,r.id)){
      const p=rel>BAND_HI?(rel-BAND_HI)/(1-BAND_HI):rel<BAND_LO?-(BAND_LO-rel)/BAND_LO:0;
      return {cell:true,col,ri,fx:r.id,raw:clamp(p,-1,1)};
    }
    return {cell:true,col,ri,fx:r.id,raw:rel};
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
  function update(ptr){
    const h=hit(ptr.x,ptr.y);if(!h.cell)return;
    const t=tracks[ptr.tr];
    if(ptr.order<0){ptr.order=++orderCtr;ptr.hid='h'+(++idCtr);}
    ensurePlaying();
    const changed=h.fx!==ptr.fx||h.col!==ptr.col;
    if(changed||Math.abs(h.raw-ptr.raw)>0.002){ptr.fx=h.fx;ptr.col=h.col;ptr.raw=h.raw;ptr.ri=h.ri;ptr.ts=++tsCtr;pushFor(ptr);}
  }
  let lastStrip={which:null,t:0};
  canvas.addEventListener('pointerdown',async e=>{
    e.preventDefault();try{canvas.setPointerCapture(e.pointerId);}catch(_){}
    const [x,y]=pos(e),h=hit(x,y),t=T();
    initAudio();
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
    const ptr={x,y,tr:view,col:-1,fx:null,raw:0,ri:-1,order:-1,ts:0,hid:null,live:false};ptrs.set(e.pointerId,ptr);
    checkBlocked();await ready;
    if(ptrs.get(e.pointerId)===ptr){ptr.live=true;update(ptr);}else ensurePlaying();
  });
  canvas.addEventListener('pointermove',e=>{
    const [x,y]=pos(e),sp=special.get(e.pointerId);
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
    const sp=special.get(e.pointerId);
    if(sp){special.delete(e.pointerId);
      if(sp.kind==='strip')endLive(T(),sp.which);
      if(sp.kind==='handle'){if(sp.moved)dropRow(sp.id,sp.y);else openSettings(sp.id);}
      return;}
    const ptr=ptrs.get(e.pointerId);if(!ptr)return;ptrs.delete(e.pointerId);
    if(ptr.live&&ptr.fx)pushFor(ptr);
  };
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
  window.addEventListener('blur',()=>{for(const id of [...special.keys(),...ptrs.keys()])end({pointerId:id});});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  function dropRow(id,y){
    const t=T(),vis=visRows(t);let target=lay.findIndex(r=>y<r.y+r.h/2);if(target<0)target=lay.length;
    const from=vis.indexOf(id);if(from<0)return;
    vis.splice(from,1);vis.splice(target>from?target-1:target,0,id);
    const hidden=t.rows.filter(r=>!vis.includes(r));t.rows=vis.concat(hidden);computeLayout();
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
    let finger=null;for(const p of ptrs.values())if(p.live&&p.fx&&p.tr===view&&(!finger||p.ts>finger.ts))finger=p;
    if(finger)assignStep({col:finger.col,fx:finger.fx,raw:finger.raw});
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
    const fx=h.fx==='dry'?[]:[{k:h.fx,raw:h.raw}];
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
    if(st.playing||intent){intent=null;tx({type:'stop'});if(songPlaying)songEnded();paintIcons();updateSession();}
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
  // delete them; a tap on its own asks before deleting them all.
  let trashHeld=null;
  clearBtn.addEventListener('pointerdown',e=>{
    if(clearBtn.disabled)return;trashHeld={id:e.pointerId,used:false};clearBtn.classList.add('held');
    try{clearBtn.setPointerCapture(e.pointerId);}catch(_){}
    if(!sessOn&&laneHolds.size){trashHeld.used=true;clearSteps(T(),[...laneHolds.values()].map(h=>{h.used=true;return h.idx;}));}
    if(sessOn&&clipHolds.size){trashHeld.used=true;deleteClips([...clipHolds.values()].map(h=>{h.used=true;return h.k;}));}
  });
  const trashTap=()=>{if(sessOn)askDeleteAll();else clearSequence(T());};
  const trashUp=e=>{const h=trashHeld;if(!h||h.id!==e.pointerId)return;trashHeld=null;clearBtn.classList.remove('held');
    if(e.type==='pointerup'&&!h.used)trashTap();};
  ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>clearBtn.addEventListener(ev,trashUp));
  clearBtn.addEventListener('click',e=>{if(e.detail===0)trashTap();}); // keyboard
  // while recording, clearing leaves an empty sequence to keep recording into
  function clearSequence(t){
    if(!t.seq)return;checkpoint();loadSeq(t,recOn?blankClip(t):null,recOn);
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
    clips=[];selClip=null;t.seq=null;recOn=false;liveV.order=liveV.mute=null;tx({type:'launch',tr:t.i,clip:null});sendRec();
    t.len16=nl;
    if(nc!==(t.colsQ||t.cols)){if(st.playing){t.colsQ=nc;tx({type:'grid',tr:t.i,n:nc,q:true});}else{t.cols=nc;tx({type:'grid',tr:t.i,n:nc});}}
    tx({type:'range',tr:t.i,s16:0,e16:nl,q:st.playing});
    sendLoopSet(t);computeLayout();renderSession();
  }
  // a blank sequence is all empty steps, so it plays the loop straight through until steps are written;
  // it takes over the plain loop's ORDER and SKIP
  function blankClip(t){
    const cols=t.colsQ||t.cols,n=t.len16*cols/16,slots=[];
    for(let i=0;i<n;i++)slots.push(EF.emptyStep(++idCtr));
    return withSettings({id:'q'+(++idCtr),cols,n,slots},t.loopSet);
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
    folder:svg('<path d="M2.5 5.5A1.5 1.5 0 0 1 4 4H8L9.5 6H16A1.5 1.5 0 0 1 17.5 7.5V14.5A1.5 1.5 0 0 1 16 16H4A1.5 1.5 0 0 1 2.5 14.5Z"/>'),
    // capture: a frame with a plus (save what is in the sequencer now)
    capture:svg('<path d="M3 7V3H7M13 3H17V7M17 13V17H13M7 17H3V13M10 7V13M7 10H13"/>')
  };
  function paintIcons(){
    playBtn.innerHTML=st.playing||intent?ICON.stop:ICON.play;playBtn.setAttribute('aria-label',st.playing||intent?'Stop':'Play');
    expBtn.innerHTML=ICON.share;clearBtn.innerHTML=ICON.trash;capBtn.innerHTML=ICON.capture;recBtn.innerHTML=ICON.rec;
    press(recBtn,recOn);recBtn.setAttribute('aria-label',recOn?'Record (on)':'Record');
    capBtn.disabled=sessOn;press(loopBtn,clipLoop);
    root.querySelectorAll('.fieldonly').forEach(n=>{n.hidden=sessOn;});root.querySelectorAll('.clipsonly').forEach(n=>{n.hidden=!sessOn;});
    loopBtn.disabled=dupBtn.disabled=loadBtn.disabled=!clips.length;dupBtn.innerHTML=ICON.dup;projBtn.innerHTML=ICON.folder;
    clearBtn.disabled=sessOn?!clips.length:!T().seq;
    clearBtn.title=sessOn?'Hold and tap clips to delete them · tap: delete duplicates or all clips':'Tap: clear the sequence · hold and tap steps: empty just those';
    const cmb=playMode==='combine';modeBtn.textContent=cmb?'COMBINE':'REPLACE';press(modeBtn,cmb);
    modeBtn.title=cmb?'Combine: every held effect plays on each step':'Replace: each step plays one touch and its effect';
    press(fxoBtn,fxOnly);fxoBtn.title=fxOnly?'FX only: slices come from the sequence or loop; touches only bring effects':'FX only is off: touched slices play';
    steppedBtn.innerHTML=stepped?ICON.stepOn:ICON.stepOff;steppedBtn.setAttribute('aria-label',stepped?'Stepped values (on)':'Stepped values (off)');
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
  const dicePool=t=>ALL_FX.filter(k=>prefs.shown.has(k)&&(hasCell(t,k)||k==='reverse')).concat('filter');
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
    const t=h.t;if(!h.cp){h.cp=true;checkpoint();}c.edited=true;
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
  // Capture saves the sequence as it is now (or the plain loop), with its loop, ORDER, SKIP and SKIP/GAP
  // mode, to the end of the Clips list and selects it. Clips never change once saved: Load copies one into
  // the sequencer to edit. On the Clips page, tapping a clip selects it and plays the list from there (at
  // the next bar line if something is playing); the selection follows playback. LOOP repeats just the
  // selected clip; otherwise the list plays to its end and stops.
  const fxKey=f=>f.k+(f.auto?f.auto.map(x=>x.toFixed(3)).join('/'):(+f.raw).toFixed(3));
  const stepKey=s=>s.empty?(s.on===false?'e0':'e1'):(s.on===false?0:1)+':'+(+s.a).toFixed(3)+':'+(s.off||0)+':'+(+(s.slen||1)).toFixed(3)+':'+(s.fx||[]).map(fxKey).join(',');
  const clipKey=k=>k.loop+'/'+k.cols+'/'+k.n+'/'+patNo(k.orderV)+'/'+patNo(k.muteV)+'/'+(k.silPat||'mute')+'|'+k.slots.map(stepKey).join('|');
  // a clip in engine form: its patterns, its SKIP/GAP mode and the key of its loop (sent to the engine first)
  function clipEngine(k,send){if(send!==false)engineLoop(k.loop);
    return {id:k.id,cols:k.cols,n:k.n,slots:k.slots,ord:ordOf(tr0(),k.orderV),mute:muteOf(tr0(),k.muteV),silPat:k.silPat||'mute',loop:k.loop};}
  const newClipId=()=>'k'+(++idCtr)+Math.random().toString(36).slice(2,6);
  capBtn.addEventListener('click',()=>{
    if(sessOn)return;const t=T(),src=t.seq||blankClip(t);checkpoint();
    const k={id:newClipId(),num:++clipNum,cols:src.cols,n:src.n,slots:src.slots.map(copySlot),orderV:src.orderV,muteV:src.muteV,silPat:src.silPat||'mute',loop:t.kind};
    clips.push(k);selClip=k;
    if(t.seq){t.seq.src=k.id;t.seq.num=k.num;t.seq.edited=false;}   // the lane now shows its number
    for(const b of [capBtn,sessBtn]){b.classList.remove('flash');void b.offsetWidth;b.classList.add('flash');}
    paintIcons();
  });
  // Load: the selected clip goes into the sequencer (a copy; the clip itself stays as it is), with its loop,
  // and the field page opens. If the list was playing, the loaded clip carries on playing there.
  loadBtn.addEventListener('click',()=>{
    const k=selClip;if(!k)return;checkpoint();const t=T();
    if(k.loop&&k.loop!==t.kind)setLoop(t,k.loop);
    loadSeq(t,withSettings({id:'q'+(++idCtr),cols:k.cols,n:k.n,slots:k.slots.map(copySlot),src:k.id,num:k.num},k));
    showClips(false);
  });
  // Duplicate: a copy of the selected clip goes right after it, with the next number, and is selected
  dupBtn.addEventListener('click',()=>{
    const k=selClip;if(!k)return;checkpoint();
    const c=Object.assign({},k,{id:newClipId(),num:++clipNum,slots:k.slots.map(copySlot)});
    clips.splice(clips.indexOf(k)+1,0,c);selClip=c;resyncSong();renderSession();paintIcons();
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
  function playClips(k){
    if(!clips.includes(k))return;selClip=k;songPlaying=true;
    songList=clipLoop?[k]:clips.slice();
    const from=songList.indexOf(k);
    initAudio();ready.then(()=>{tx({type:'live',tr:0,ord:null,mute:null});tx({type:'song',rows:songRowsOf(songList),from,once:!clipLoop});});
    liveV.order=liveV.mute=null;paintIcons();updateSession();
  }
  function onSongRow(m){if(!songPlaying)return;const k=songList[m.idx];if(k&&clips.includes(k))selClip=k;updateSession();}
  // the list stopped (its end, or Stop): the engine goes back to the sequencer's sequence
  function songEnded(){
    if(!songPlaying)return;songPlaying=false;songList=[];const t=T();
    tx({type:'launch',tr:t.i,clip:t.seq?clipForm(t.seq):null});sendRec();paintIcons();updateSession();
  }
  // after the list changes while it plays: the clip now playing keeps playing, then the list carries on
  function resyncSong(){
    if(!songPlaying)return;
    const cur=st.song&&st.song.idx>=0?songList[st.song.idx]:null;
    if(clipLoop){
      const k=cur&&clips.includes(cur)?cur:selClip;
      if(!k){stopAll();return;}
      songList=[k];tx({type:'songRows',rows:songRowsOf(songList),idx:0});return;
    }
    if(!clips.length){stopAll();return;}
    let idx=cur?clips.indexOf(cur):-1;
    // the playing clip was deleted: carry on from the next one that is left
    if(idx<0&&cur){const old=songList.indexOf(cur);idx=songList.slice(0,old).filter(k=>clips.includes(k)).length-1;}
    songList=clips.slice();tx({type:'songRows',rows:songRowsOf(songList),idx});
  }
  function stopAll(){intent=null;tx({type:'stop'});songEnded();}
  loopBtn.addEventListener('click',()=>{
    clipLoop=!clipLoop;paintIcons();
    if(!songPlaying||!selClip)return;
    // from the next bar line: LOOP repeats the selected clip; off, the list carries on after it
    if(clipLoop){songList=[selClip];tx({type:'song',rows:songRowsOf(songList),from:0,once:false});}
    else{songList=clips.slice();tx({type:'song',rows:songRowsOf(songList),from:clips.indexOf(selClip)+1,once:true});}
  });
  const duplicatesOf=()=>{const seen=new Set();return clips.filter(k=>{const key=clipKey(k);if(seen.has(key))return true;seen.add(key);return false;});};
  function deleteClips(list){
    const gone=new Set(list.filter(k=>clips.includes(k)));if(!gone.size)return;checkpoint();
    if(selClip&&gone.has(selClip)){
      // the selection moves to the next clip that is left, or the one before
      const i=clips.indexOf(selClip);selClip=clips.slice(i+1).find(k=>!gone.has(k))||clips.slice(0,i).reverse().find(k=>!gone.has(k))||null;
    }
    clips=clips.filter(k=>!gone.has(k));
    resyncSong();renderSession();paintIcons();
  }
  // the trash tapped on its own on the Clips page: delete the duplicates (the first of each stays) or everything
  function askDeleteAll(){
    if(!clips.length)return;
    openSheet('Delete clips',cardEl=>{
      const dups=duplicatesOf();
      const dd=el('button',{type:'button',textContent:dups.length?'Delete duplicates ('+dups.length+')':'No duplicates',disabled:!dups.length});
      const go=el('button',{type:'button',className:'danger',textContent:'Delete all '+clips.length+(clips.length>1?' clips':' clip')}),no=el('button',{type:'button',textContent:'Cancel'});
      dd.addEventListener('click',()=>{closeSheet();deleteClips(dups);});
      go.addEventListener('click',()=>{closeSheet();deleteClips(clips.slice());});no.addEventListener('click',()=>closeSheet());
      cardEl.appendChild(el('p',{},['Duplicates: clips identical to an earlier one (the first of each stays). Undo brings deleted clips back.']));
      cardEl.appendChild(el('div',{className:'delall'},[dd,go,no]));
    });
  }
  // Thumbnail: one mark per step at its slice's height; a step with several effects is split into one
  // colour per effect (up to four).
  function drawThumb(cv,clip,hue){
    const w=cv.clientWidth||70,h=cv.clientHeight||44,d=Math.min(2,window.devicePixelRatio||1);
    cv.width=Math.round(w*d);cv.height=Math.round(h*d);const x=cv.getContext('2d');x.scale(d,d);
    x.fillStyle=`hsl(${hue} 30% 14%)`;x.fillRect(0,0,w,h);
    if(!clip)return;
    const S=clip.slots,L=S.length,bw=w/L,top=6,hh=h-top-4,cfg=tracks[0].cfg;
    S.forEach((s,i)=>{
      const a=s.empty?(i%clip.n)*16/clip.cols:s.a,y=top+(1-(a+0.5)/16)*hh,fx=(s.fx||[]).slice(0,4);
      x.globalAlpha=s.on===false?0.18:s.empty?0.35:1;
      const x0=i*bw+0.5,ww=Math.max(1,bw-1.5);
      if(!fx.length){x.fillStyle=`hsl(${hue} 60% 70%)`;x.fillRect(x0,y-1.5,ww,3);return;}
      const sw=ww/fx.length;fx.forEach((f,j)=>{x.fillStyle=`hsl(${(cfg[f.k]||{}).hue} 75% 60%)`;x.fillRect(x0+j*sw,y-2,Math.max(1,sw-(j<fx.length-1?0.5:0)),4);});
    });
    x.globalAlpha=1;
  }
  let sessBusy=0,sessDirty=false;
  const busy=on=>{sessBusy+=on?1:-1;if(sessBusy<0)sessBusy=0;if(!sessBusy&&sessDirty){sessDirty=false;renderSession();}};
  function paintTakesHead(){
    takesHead.textContent='';
    takesHead.appendChild(el('h2',{},['Clips'+(clips.length?' · '+clips.length:''),el('small',{textContent:clips.length?'Tap to play · Load to edit':''})]));
  }
  // A clip held down can be deleted by tapping the trash; with the trash held, tapping a clip deletes it.
  // A tap (released without either) selects the clip and plays from it.
  const clipHolds=new Map();
  function takeRow(k,i){
    const row=el('div',{className:'take'});row.dataset.i=i;
    const hdl=el('div',{className:'hdl',title:'Drag to move this clip'});hdl.innerHTML=ICON.handle;rowMover(hdl,k);
    const th=el('button',{type:'button',className:'th',title:'Play from clip '+k.num+' · '+loopName(k.loop)});const cv=el('canvas');
    th.appendChild(cv);th.appendChild(el('span',{textContent:String(k.num)+(k.loop!==T().kind?' · '+loopName(k.loop):'')}));
    th.addEventListener('pointerdown',e=>{
      if(trashHeld){trashHeld.used=true;deleteClips([k]);return;}
      clipHolds.set(e.pointerId,{k,used:false,row});row.classList.add('held');
    });
    const up=e=>{const h=clipHolds.get(e.pointerId);if(!h)return;clipHolds.delete(e.pointerId);row.classList.remove('held');
      if(e.type==='pointerup'&&!h.used){initAudio();checkBlocked();playClips(k);}};
    ['pointerup','pointercancel','pointerleave'].forEach(ev=>th.addEventListener(ev,up));
    th.addEventListener('click',e=>{if(e.detail===0){initAudio();playClips(k);}});   // keyboard
    row.append(hdl,th);
    requestAnimationFrame(()=>drawThumb(cv,k,TRACK_HUES[0]));
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
    paintTakesHead();takeList.textContent='';clipHolds.clear();
    if(!clips.length){takeList.appendChild(el('p',{className:'takes-empty',textContent:'Nothing captured yet. On the field page, press Capture (right of the tools, under this button) to save the sequence as it is now. Clips are added here in order.'}));return;}
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
  // Switching pages. Back on the field page without Load, the sequencer's own sequence plays again (from
  // the next bar line if the list was playing).
  function showClips(on){
    if(on===sessOn)return;
    sessOn=on;sessEl.hidden=!on;wrap.hidden=on;laneCv.hidden=on;
    for(const id of [...special.keys(),...ptrs.keys()])end({pointerId:id});laneHolds.clear();laneHold=null;
    if(on){if(!selClip&&clips.length)selClip=clips[clips.length-1];renderSession();
      const r=takeList.querySelector('.take.sel');if(r)r.scrollIntoView({block:'nearest'});else sessScroll.scrollTop=sessScroll.scrollHeight;}
    else{
      if(songPlaying){songPlaying=false;songList=[];tx({type:'songStop'});}
      const t=T(),f=info(t.i),id=t.seq?t.seq.id:null;
      if(f.clipId!==id||f.clipQ!==undefined)tx({type:'launch',tr:t.i,clip:t.seq?clipForm(t.seq):null});
      sendRec();requestAnimationFrame(resize);
    }
    paintIcons();
  }
  sessBtn.addEventListener('click',()=>showClips(!sessOn));

  let sessKey='';
  function onStatus(m){
    gotStatus=true;m.recv=performance.now();const was=st.playing;st=m;
    if(was!==m.playing){if(!m.playing){intent=null;songEnded();}paintIcons();}
    clearBtn.disabled=sessOn?!clips.length:!T().seq;paintUndo();
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
    tracks[0]=newTrack(0,'break');if(keep){tracks[0].buf=keep.buf;tracks[0].pk=keep.pk;}
    view=0;clips=[];clipNum=0;selClip=null;clipLoop=false;songPlaying=false;songList=[];recOn=false;recBn=-1;
    bpm=124;swing=0;stepped=true;playMode='replace';fxOnly=false;
    Object.assign(prefs,PREF0,{shown:new Set(ALL_FX)});
    Object.assign(pin,PIN0);liveV.order=liveV.mute=null;undoS.length=0;redoS.length=0;
    st={playing:false,t:0,len:1,tracks:[],hist:[],song:null,recv:0};
    press(playBtn,false);clearBtn.disabled=true;
    bpmEl.querySelector('b').textContent='124';swingEl.querySelector('b').textContent='50';
    files.clear();soundSel.querySelectorAll('option[value^="f:"]').forEach(o=>o.remove());sentLoops.clear();
    soundSel.value='break';
    if(sessOn){sessOn=false;sessEl.hidden=true;wrap.hidden=false;laneCv.hidden=false;clipHolds.clear();}
    computeLayout();
    sheet.hidden=true;paintIcons();requestAnimationFrame(resize);
    (function pre(){let n=0;const nx=()=>{if(n>=tracks.length)return;const t=tracks[n++];if(!t.buf){t.buf=buildLoop(t,48000);t.pk=peaks(t.buf);}setTimeout(nx,10);};setTimeout(nx,0);})();
  }

  // ---------- sheets ----------
  function openSheet(title,build){
    card.textContent='';
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
    const changed=()=>{cols.forEach(x=>x.paint());if(!raf)raf=requestAnimationFrame(()=>{raf=0;sendCfg(t);});};
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
        if(!count&&!t.seq){w.hidden=true;go();return;}
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
    cardEl.appendChild(el('div',{},[el('h3',{},['Second slider · this '+(T().seq?'sequence':'loop')]),radios('p-silp',[['mute','SKIP: its steps go quiet; the sequence keeps moving'],['insert','GAP: a quiet step is inserted; the sequence waits, so every step still plays']],silOf(T()),v=>{
      const t=T();checkpoint();ctxSet(t).silPat=v;if(t.seq)seqEdited(t);else sendPref();}),el('p',{},['Kept with the sequence, and with clips captured from it.'])]));
    const tw=el('input',{type:'checkbox',checked:prefs.touchWin});tw.addEventListener('change',()=>{prefs.touchWin=tw.checked;sendPref();});
    cardEl.appendChild(el('div',{},[el('label',{},[tw,'Touches play through SKIP and GAP']),el('p',{},['Off: the pattern silences touched steps too.'])]));
    const ol=outLat();
    cardEl.appendChild(el('div',{},[el('h3',{},['Late touches']),radios('p-grace',[['0','Always wait for the next step'],['20','Count touches up to 20 ms late as on time'],['40','Count touches up to 40 ms late as on time'],['70','Count touches up to 70 ms late as on time']],String(prefs.grace),v=>{prefs.grace=+v;sendPref();}),
      el('p',{},['A touch (or a release) this soon after a step starts counts for that step; the slice keeps its place in time. '+(ol?'This device’s '+ol+' ms output latency is added to the window.':'Any output latency the device reports is added to the window.')])]));
    const box=el('div',{className:'opt'});
    ALL_FX.forEach(k=>{const i=el('input',{type:'checkbox',checked:prefs.shown.has(k),id:'show-'+k});i.addEventListener('change',()=>{if(i.checked)prefs.shown.add(k);else prefs.shown.delete(k);computeLayout();});box.appendChild(el('label',{htmlFor:i.id},[i,FX[k].name]));});
    cardEl.appendChild(el('div',{},[el('h3',{},['Effects shown']),box,el('p',{},['Hidden effects still play when they are recorded in a sequence.'])]));
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
    const seqB=el('button',{type:'button',textContent:t.seq?'This sequence':'The loop as set'});
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
    return {app:'slicefield',version:20,bpm,swing,stepped,playMode,fxOnly,
      prefs:{grace:prefs.grace,touchWin:prefs.touchWin,shown:[...prefs.shown]},pin:Object.assign({},pin),
      track:{kind:t.kind,cols:t.colsQ||t.cols,len16:t.len16,rows:t.rows.slice(),cfg:t.cfg,loopSet:Object.assign({},t.loopSet),seq:t.seq?plainClip(t.seq):null},
      clips:clips.map(plainClip),sel:clips.indexOf(selClip),clipNum,clipLoop,
      files:[...files.values()].map(f=>({id:f.id,name:f.name,L:b64(f.L),R:b64(f.R)}))};
  }
  async function openProject(p){
    if(!p||p.app!=='slicefield'||!p.track)throw new Error('not a Slicefield project');
    initAudio();await ready;
    if(st.playing||intent){intent=null;tx({type:'stop'});}
    songPlaying=false;songList=[];recOn=false;recBn=-1;
    // imported audio first, so the loop and clips can find it
    files.clear();soundSel.querySelectorAll('option[value^="f:"]').forEach(o=>o.remove());
    for(const f of p.files||[])files.set(f.id,{id:f.id,name:f.name,L:unb64(f.L),R:unb64(f.R)});
    for(const id of files.keys())fileOption('f:'+id);
    bpm=clamp(p.bpm||124,60,200);swing=clamp(p.swing||0,0,0.5);stepped=p.stepped!==false;playMode=p.playMode==='combine'?'combine':'replace';fxOnly=!!p.fxOnly;
    if(p.prefs){prefs.grace=p.prefs.grace!=null?p.prefs.grace:40;prefs.touchWin=p.prefs.touchWin!==false;if(p.prefs.shown)prefs.shown=new Set(p.prefs.shown);}
    if(p.pin)Object.assign(pin,p.pin);liveV.order=liveV.mute=null;
    const t=T(),q=p.track;
    t.kind=q.kind&&(!q.kind.startsWith('f:')||files.has(q.kind.slice(2)))?q.kind:'break';
    t.cols=q.cols===8?8:16;t.colsQ=0;t.len16=clamp(q.len16||16,1,16);
    // effects added since the project was saved get their defaults, and a row
    t.cfg=Object.assign(defCfg(),q.cfg||{});t.rows=(q.rows||[]).filter(r=>r==='center'||FX[r]);
    for(const r of newTrack(0,'break').rows)if(!t.rows.includes(r))t.rows.push(r);
    t.loopSet=Object.assign({orderV:1,muteV:1,silPat:'mute'},q.loopSet||{});
    t.seq=q.seq?clipForm(Object.assign({},q.seq)):null;
    clips=(p.clips||[]).map(k=>Object.assign({silPat:'mute',loop:t.kind},k));clipNum=p.clipNum||clips.length;
    selClip=clips[p.sel]||clips[clips.length-1]||null;clipLoop=!!p.clipLoop;
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
  let projStatus=null;
  projIn.addEventListener('change',async()=>{
    const f=projIn.files&&projIn.files[0];projIn.value='';if(!f)return;const say=projStatus||(()=>{});
    try{await openProject(readProjectFile(await f.arrayBuffer()));say('Opened '+f.name);closeSheet();}
    catch(err){say('Could not open '+f.name+': '+err.message);}
  });
  projBtn.addEventListener('click',()=>openSheet('Project',cardEl=>{
    const msg=el('p',{className:'expmsg'}),status=x=>{msg.textContent=x;};projStatus=status;
    const sv=el('button',{type:'button',textContent:'Save project'}),op=el('button',{type:'button',textContent:'Open project…'}),nw=el('button',{type:'button',className:'danger',textContent:'New project'});
    sv.addEventListener('click',()=>{status('Saving…');saveProject(status);});
    op.addEventListener('click',()=>{initAudio();projIn.click();});
    let arm=0;nw.addEventListener('click',()=>{
      if(!arm){arm=setTimeout(()=>{arm=0;nw.textContent='New project';},2500);nw.textContent='Tap again: start over';return;}
      clearTimeout(arm);arm=0;hardReset();});
    cardEl.appendChild(el('div',{className:'projrow'},[sv,op,nw]));
    cardEl.appendChild(el('p',{},['Saves everything: tempo, swing, modes, the loop (your imported audio too), effect settings, the sequence and every clip. Open a saved project (.json, or the .zip this page saves inside Claude) to carry on. New project starts over; save first to keep this one.']));
    cardEl.appendChild(msg);
  }));

  // ---------- undo / redo ----------
  // Every edit gesture saves a snapshot of the sequence, the plain loop's strips and the Clips list first
  // (captures, deletes and moves included; clips never change, so the list keeps references). While
  // recording, each bar that writes steps is one undo step. Live touches are not undoable.
  const undoS=[],redoS=[];
  function snapState(){const t=T();return {seq:t.seq?cloneClip(t.seq):null,loopSet:Object.assign({},t.loopSet),clips:clips.slice(),sel:selClip,clipNum,kind:t.kind};}
  function checkpoint(){undoS.push(snapState());if(undoS.length>100)undoS.shift();redoS.length=0;paintUndo();}
  function restoreState(sn){
    const t=T(),f=info(t.i);
    clips=sn.clips;selClip=sn.sel&&clips.includes(sn.sel)?sn.sel:null;clipNum=sn.clipNum;
    t.loopSet=sn.loopSet;t.seq=sn.seq;liveV.order=liveV.mute=null;
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
  function drawLane(fs){
    const d=lanePageInfo(),t=d.t,i=info(view),h=laneRows*LROW+4;
    g.fillStyle='#16181d';rr(0,0,LW,h,7);g.fill();
    g.textBaseline='middle';g.textAlign='center';g.font=`600 ${fs}px ${FONT}`;
    // LIVE: the plain loop as it plays. The clip's number, in the corner ticks of the Capture icon, when the
    // sequence came from (or was captured as) that clip, with a * once it has changed since; SEQ otherwise.
    // REC underneath while recording.
    const col=d.clip?`hsl(${TRACK_HUES[view]} 75% 62%)`:'#6c7380',sub=recOn?'REC':d.pages>1?(d.page+1)+'/'+d.pages:'';
    const cy=h/2-(sub?8:0);g.fillStyle=col;
    if(d.clip&&d.clip.num){
      const lab=String(d.clip.num)+(d.clip.edited?'*':'');g.font=`600 ${lab.length>3?fs-2:fs}px ${FONT}`;g.fillText(lab,LLAB/2,cy+0.5);
      const bw=26,bh=20,x0=LLAB/2-bw/2,y0=cy-bh/2,k=5;g.strokeStyle=col;g.lineWidth=1.4;g.lineCap='round';g.beginPath();
      for(const [x,y,dx,dy] of [[x0,y0,1,1],[x0+bw,y0,-1,1],[x0,y0+bh,1,-1],[x0+bw,y0+bh,-1,-1]]){g.moveTo(x+dx*k,y);g.lineTo(x,y);g.lineTo(x,y+dy*k);}
      g.stroke();
    }else{const lab=d.clip?'SEQ':'LIVE';g.fillText(lab,LLAB/2,cy);}
    if(sub){g.font=`${recOn?600:400} ${fs-1}px ${FONT}`;g.fillStyle=recOn?'#ff6b6b':'#8a8f99';g.fillText(sub,LLAB/2,h/2+12);}
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
    if(sessOn)return;
    g=gridG;g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle=BG;g.fillRect(0,0,cssW,cssH);
    if('letterSpacing' in g)g.letterSpacing='0.06em';
    const t=T(),i=info(view),cols=t.cols,cw=W()/cols,gap=3;
    const unitH=lay.length?Math.min(...lay.map(r=>r.h)):30,fs=unitH<24?9:10;
    const step=16/cols,curSlice=st.playing&&i.src&&!i.rest?Math.floor(i.a/step):-1;
    const E=entriesOf(t);
    const marks=E.map(e=>({fx:e.fx,a:e.a,n:e.n,raw:e.raw,ts:e.ts,hid:e.hid,finger:e.finger}));
    const nowHid=i.src==='touch'&&i.sid?i.sid.slice(1,i.sid.indexOf('#')):null;
    const touch=new Set();for(const p of ptrs.values())if(p.live&&p.tr===view&&p.ri>=0)touch.add(p.ri+':'+(fxOnly?0:p.col));
    // FX ONLY: slices come from the sequence, so each row is one undivided strip: a touch anywhere in it
    // plays that row's effect. dc/dw: the columns drawn and their width; span: where a held cell is drawn.
    const dc=fxOnly?1:cols,dw=W()/dc,span=m=>fxOnly?[HW+gap/2,W()-gap]:[cellX(t,m.a)+gap/2,m.n/16*W()-gap];
    lay.forEach((r,ri)=>{
      const hue=hueOf(t,r.id);
      g.fillStyle='#1a1d23';rr(0,r.y,HW-4,r.h,5);g.fill();
      g.fillStyle=`hsl(${hue} 60% 55%)`;g.fillRect(4,r.y+4,3,r.h-8);
      g.fillStyle='#6c7380';for(let q=0;q<3;q++)g.fillRect(12,r.y+r.h/2-5+q*4,9,1.5);
      if(r.id==='center'){drawCenter(t,i,r,ri,curSlice,marks,touch,cw,gap,fs,nowHid,dc,dw,span);return;}
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
      g.textBaseline='middle';const ty=d.tall||cellBip(t,k)?r.y+Math.min(12,r.h*(1-BAND_HI)/2+1):r.y+r.h/2;
      g.font=`600 ${fs}px ${FONT}`;g.textAlign='left';g.fillStyle=latest?`hsl(${hue} 90% 84%)`:`hsl(${hue} 50% 64%)`;
      g.fillText(d.name.toUpperCase(),HW+8,ty);
      g.font=`400 ${fs}px ${FONT}`;g.textAlign='right';g.fillStyle=latest?'#fff':`hsl(${hue} 14% 52%)`;
      let lab='';
      if(P){if(latest){const v=resolve(t,k,latest.raw);lab=cn.map(n=>d.params[n].lab(v[n],c.o)).join(' · ');}
        else lab=P.bip?P.lab(c.lo[pn],c.o)+' ↓  ↑ '+P.lab(c.hi[pn],c.o):P.lab(c.lo[pn],c.o)+' → '+P.lab(c.hi[pn],c.o);}
      g.fillText(lab,cssW-12,ty);
    });
    const y0=lay.length?lay[0].y:TOP;
    // columns past this track's bar length still play their slices, but sit outside the bar
    const xe=cellX(t,t.len16);if(!fxOnly&&xe<cssW-1){g.fillStyle='rgba(10,11,14,.42)';g.fillRect(xe,y0,cssW-xe,cssH-y0);}
    // the current step when it is silenced
    if(!fxOnly&&st.playing&&i.gate===false&&i.src){g.fillStyle='rgba(10,11,14,.5)';const x=i.rest?HW+((i.s+Math.max(0,i.barPos))%cols)*cw:HW+curSlice*cw;if(x>=HW)g.fillRect(x,y0,cw,cssH-y0);}
    drawStrips(fs);
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
        let target=lay.findIndex(x=>sp.y<x.y+x.h/2);const yy=target<0?lay[lay.length-1].y+lay[lay.length-1].h+1:lay[target].y-2;
        g.fillStyle=ACC;g.fillRect(0,yy-1,cssW,3);
      }
    }
    // a track that is muted, or silenced by another track's solo, is dimmed
  }
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

  // ---------- start ----------
  // the layout is portrait only; where the browser allows it, keep the screen upright
  try{const o=screen.orientation;if(o&&o.lock){const p=o.lock('portrait');if(p&&p.catch)p.catch(()=>{});}}catch(_){}
  paintIcons();computeLayout();dieEl.innerHTML=ICON.dice;
  // the count on the Clips button (and Capture) flash once, after a capture
  [sessBtn,capBtn].forEach(b=>b.addEventListener('animationend',()=>b.classList.remove('flash'),true));
  (function pre(){let n=0;const nx=()=>{if(n>=tracks.length)return;const t=tracks[n++];if(!t.buf){t.buf=buildLoop(t,48000);t.pk=peaks(t.buf);}setTimeout(nx,10);};setTimeout(nx,0);})();
  requestAnimationFrame(draw);
}
