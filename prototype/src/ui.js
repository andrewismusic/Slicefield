// The interface. Runs as the Slicefield constructor: everything it keeps is local to this instance, and it
// draws into the host element's shadow root.
function slicefieldUI(hostEl,engineFactory,synth,markup){
  const EF=engineFactory(),FX=EF.FX,{makeLoop,resample}=synth;
  const root=hostEl.attachShadow({mode:'open'});root.innerHTML=markup;this.root=root;
  const FONT='"Martian Mono", ui-monospace, Menlo, monospace';
  const ALL_FX=['stutter','random','pitch','reverse','env','freeze','crush','delay'];
  const HUES=[8,24,44,90,138,166,190,214,262,318,340];
  const TRACK_HUES=[40];
  const LOOP_NAMES={break:'Breakbeat',boombap:'Boom bap',acid:'Acid bass',reese:'Reese bass',dub:'Dub stabs',lead:'Synth lead',keys:'Electric piano',kalimba:'Kalimba',vox:'Vocal chops',file:'Your file'};
  const BAND_LO=0.42,BAND_HI=0.58,STRIP=28,HW=30,LROW=24,LLAB=34;
  const $=id=>root.getElementById(id);
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const canvas=$('grid'),wrap=$('gridwrap'),laneCv=$('lane'),laneG=laneCv.getContext('2d'),gridG=canvas.getContext('2d');
  let g=gridG,LW=300,laneDpr=1;
  const ACC='#ffc65c',ACCRGB='255,198,92';const ACCA=a=>'rgba('+ACCRGB+','+a+')';
  const BG='#111317';
  const playBtn=$('play'),bpmEl=$('bpm'),swingEl=$('swing'),expBtn=$('export'),modeBtn=$('recmode'),fxoBtn=$('fxonly'),clearBtn=$('clear'),steppedBtn=$('stepped'),diceEl=$('dice'),dieEl=$('die'),diceVal=$('diceval'),prefsBtn=$('prefs'),sessBtn=$('sessbtn');
  const soundSel=$('sound'),fileIn=$('file'),sheet=$('sheet'),card=$('card');
  const sessEl=$('session'),takeList=$('takelist'),takesHead=$('takeshead'),sessScroll=$('sessScroll'),ghost=$('ghost');

  // ---------- state ----------
  function defCfg(){
    const c=EF.allCfg();for(const k in c)c[k].hue=FX[k].hue;
    return c;
  }
  // One channel: a single track (the engine could run more side by side, the app uses one).
  // seq: the sequence on the main page (null: the plain loop plays). loopSet: the plain loop's own strips.
  const newTrack=(i,kind)=>({i,kind,file:null,cols:16,len16:16,rows:['stutter','random','pitch','center','reverse','env','freeze','crush','delay'],
    cfg:defCfg(),loopSet:{orderV:1,muteV:1},seq:null,buf:null,pk:null});
  const tracks=[newTrack(0,'break')];
  let view=0;
  // touchWin: touches play through SKIP. silPat: 'mute' (SKIP) or 'insert' (GAP: the sequence waits).
  const PREF0={silPat:'mute',grace:40,touchWin:true};
  const prefs=Object.assign({},PREF0,{shown:new Set(ALL_FX)});
  // Strips: the stored value belongs to the sequence (or the plain loop). With the pin on, moving a strip
  // changes the stored value. With it off, the move is live only and the strip snaps back on release.
  const PIN0={order:true,mute:false};const pin=Object.assign({},PIN0);
  const liveV={order:null,mute:null};
  const ctxSet=t=>t.seq||t.loopSet;
  const oS=t=>ctxSet(t).orderV, mS=t=>ctxSet(t).muteV;   // stored
  const oV=t=>liveV.order!=null?liveV.order:oS(t), mV=t=>liveV.mute!=null?liveV.mute:mS(t);   // heard
  let bpm=124,swing=0,stepped=true,sessOn=false,playMode='replace',fxOnly=false;
  // Takes: every bar played is captured; the ones that add something are kept here, oldest first.
  let takes=[],takeNum=0,capBn=-9,songPlaying=false;
  let st={playing:false,t:0,len:1,tracks:[],hist:[],song:null,recv:0};
  const ptrs=new Map();let orderCtr=0,tsCtr=0,idCtr=0;
  const SLIM=24;let folded=false;
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
    else if(m.type==='bar')onBar(m);
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
    connectOut(sp);spKeep=sp;send=m=>e.msg(m);
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
  function buildLoop(t,rate){
    const len=loopLen(rate);
    if(t.kind==='file'&&t.file)return {L:resample(t.file.L,len),R:resample(t.file.R,len)};
    return makeLoop(t.kind,rate,bpm);
  }
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
  const prefMsg=()=>({type:'pref',pref:{silPat:prefs.silPat,grace:prefs.grace,lat:outLat(),touchWin:prefs.touchWin}});
  // the engine works out every effect value from these settings, so edits reach recorded sequences too
  function sendCfg(t){const c={};for(const k in t.cfg){const x=t.cfg[k];c[k]={cells:x.cells.slice(),lo:Object.assign({},x.lo),hi:Object.assign({},x.hi),x:Object.assign({},x.x),o:Object.assign({},x.o,x.o.mask?{mask:x.o.mask.slice()}:{})};}tx({type:'cfg',tr:t.i,cfg:c});}
  function syncAll(){
    tx({type:'swing',s:swing});tx({type:'stepped',on:stepped});tx({type:'live',tr:0,ord:null,mute:null});if(tracks[0].seq)tx({type:'launch',tr:0,clip:clipForm(tracks[0].seq)});tx({type:'mode',mode:playMode});tx({type:'fxonly',on:fxOnly});tx(prefMsg());tx({type:'view',tr:view});
    tracks.forEach(t=>{fitTrack(t);syncTrack(t);});
    // regenerate at the device rate in the background for best quality
    if(curRate()!==48000)regenAll();
  }
  const barSec=()=>240/bpm;

  // ---------- strips ----------
  // ORDER and SKIP: each slider position is one fixed pattern (see the engine's orderPattern and
  // skipPattern); the far right is the default. Values are stored with the sequence, or the plain loop.
  const ordOf=(t,v)=>({perm:EF.orderPattern(v,barSteps(t))}), muteOf=(t,v)=>({bits:EF.skipPattern(v,barSteps(t))});
  const tr0=()=>tracks[0];
  // a sequence carries its patterns in engine form too, so it plays (and exports) the same anywhere
  function clipForm(c){const t=tr0();c.ord=ordOf(t,c.orderV);c.mute=muteOf(t,c.muteV);return c;}
  function withSettings(c,from){const f=from||{};c.orderV=f.orderV!=null?f.orderV:1;c.muteV=f.muteV!=null?f.muteV:1;return clipForm(c);}
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
  function laneInfo(){
    const t=T(),i=info(view),clip=t.seq;
    const n=clip?clip.n:(i.n||t.cols),slots=clip?clip.slots:null;
    return {t,clip,n,slots,rows:1};
  }
  function hasCell(t,k){return t.cfg[k].cells.length>0;}
  function computeLayout(){
    laneRows=laneInfo().rows;
    TOP=folded?SLIM+6:STRIP+4+STRIP+6;
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
  const SW=()=>cssW-30;
  const hueOf=(t,id)=>id==='center'?t.cfg.filter.hue:t.cfg[id].hue;
  const cellBip=(t,k)=>EF.rowBip(t.cfg[k],k);
  const yOrder=()=>0,yMute=()=>yOrder()+STRIP+4;
  function hit(x,y){
    const t=T();
    if(folded&&y<TOP-3)return {unfold:true};
    if(y<yMute()-2)return {strip:'order',snapBox:x>cssW-28};
    if(y<TOP-3)return {strip:'mute',snapBox:x>cssW-28};
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
  function ensurePlaying(){if(!st.playing&&!intent){intent={type:'play'};tx(intent);}}
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
        // unpinning SKIP puts its stored pattern back to the default
        if(h.strip==='mute'&&!pin.mute&&mS(t)<EF.DEAD){checkpoint();setStrip(t,'mute',STRIP_DEF.mute,true);}
        return;
      }
      // double-tap a strip to put its stored value back to the default
      const now=performance.now(),dbl=lastStrip.which===h.strip&&now-lastStrip.t<320;lastStrip={which:h.strip,t:dbl?0:now};
      const keep=dbl||pin[h.strip];if(keep)checkpoint();
      const v=dbl?STRIP_DEF[h.strip]:clamp(x/SW(),0,1);
      special.set(e.pointerId,{kind:'strip',which:h.strip,held:dbl,keep,x,v});await ready;
      setStrip(t,h.strip,v,keep);return;
    }
    if(h.unfold){setFold(false);return;}
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
        sp.v=clamp(sp.v+(x-sp.x)/SW()*rate,0,1);sp.x=x;sp.fine=rate<0.99?rate:0;setStrip(T(),sp.which,sp.v,sp.keep);}}
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
    const L=laneInfo(),i=info(view),per=L.n*L.rows;
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
    const row=Math.min(d.rows-1,Math.floor((y-4)/LROW)),col=Math.floor((x-LLAB)/(LW-LLAB)*d.n);
    const idx=d.page*d.per+row*d.n+col;
    if(col<0||col>=d.n)return;
    // a held Trash empties tapped steps; a held die randomizes them
    if(trashHeld){trashHeld.used=true;clearSteps(d.t,[idx]);return;}
    if(diceHeld){diceStep(idx);return;}
    // on the plain loop, touching a step starts a sequence of empty steps (the loop plays through them)
    if(!d.clip){checkpoint();loadSeq(d.t,blankClip(d.t));d=lanePageInfo();}
    if(idx>=d.slots.length)return;
    const h={id,idx,clip:d.clip,t:d.t,used:false};laneHolds.set(id,h);laneHold=h;
    // a cell already held on the grid is pasted straight into the step
    let finger=null;for(const p of ptrs.values())if(p.live&&p.fx&&p.tr===view&&(!finger||p.ts>finger.ts))finger=p;
    if(finger)assignStep({col:finger.col,fx:finger.fx,raw:finger.raw});
  }
  function assignStep(h){
    const L=laneHold;if(!L)return;const t=L.t;if(!L.used)checkpoint();L.used=true;
    L.clip.slots[L.idx]={on:true,a:h.col*16/t.cols,off:0,sid:L.sid||(L.sid='P'+(++idCtr)),slen:1,fx:h.fx==='dry'?[]:[{k:h.fx,raw:h.raw}]};
    seqEdited(t);
  }

  // ---------- transport ----------
  async function togglePlay(){
    initAudio();checkBlocked();await ready;
    if(st.playing||intent){intent=null;tx({type:'stop'});songPlaying=false;capBn=-9;paintIcons();updateSession();}
    else{intent={type:'play'};tx(intent);paintIcons();}
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
  dragNumber(swingEl,()=>Math.round(swing*100),v=>{swing=clamp(Math.round(v),0,50)/100;tx({type:'swing',s:swing});},4,v=>v+'%');
  const press=(b,on)=>b.setAttribute('aria-pressed',on?'true':'false');
  // Replace: each step plays one touch's effect. Combine: every held effect stacks on each step.
  modeBtn.addEventListener('click',()=>{playMode=playMode==='replace'?'combine':'replace';tx({type:'mode',mode:playMode});paintIcons();});
  // FX only: the sequence (or loop) keeps its slices and touches only bring effects.
  fxoBtn.addEventListener('click',()=>{fxOnly=!fxOnly;tx({type:'fxonly',on:fxOnly});paintIcons();});
  // Trash: a tap (on release) clears the sequence, so the plain loop plays. Hold it and tap steps, or hold
  // steps and tap it, to empty just those steps; then releasing it clears nothing more.
  let trashHeld=null;
  clearBtn.addEventListener('pointerdown',e=>{
    if(clearBtn.disabled)return;trashHeld={id:e.pointerId,used:false};clearBtn.classList.add('held');
    try{clearBtn.setPointerCapture(e.pointerId);}catch(_){}
    if(laneHolds.size){trashHeld.used=true;clearSteps(T(),[...laneHolds.values()].map(h=>{h.used=true;return h.idx;}));}
  });
  const trashUp=e=>{const h=trashHeld;if(!h||h.id!==e.pointerId)return;trashHeld=null;clearBtn.classList.remove('held');
    if(e.type==='pointerup'&&!h.used)clearSequence(T());};
  ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>clearBtn.addEventListener(ev,trashUp));
  clearBtn.addEventListener('click',e=>{if(e.detail===0)clearSequence(T());}); // keyboard
  function clearSequence(t){
    if(!t.seq)return;checkpoint();loadSeq(t,null);
  }
  // an emptied step plays the loop's own slice for its position
  function clearSteps(t,idxs){
    const c=t.seq;if(!c)return;checkpoint();
    for(const i of idxs){if(i>=c.slots.length)continue;c.slots[i]=EF.emptyStep(++idCtr);}
    seqEdited(t);
  }
  // The main page's sequence: load one (a take, a blank, or null for the plain loop), or note an edit.
  function loadSeq(t,c){
    t.seq=c;liveV.order=liveV.mute=null;laneFollow=true;
    if(songPlaying){songPlaying=false;tx({type:'songStop'});}
    if(c)clipForm(c);
    initAudio();ready.then(()=>{tx({type:'live',tr:t.i,ord:null,mute:null});tx({type:'launch',tr:t.i,clip:c});});
    computeLayout();updateSession();
  }
  function seqEdited(t){if(t.seq){t.seq.edited=true;tx({type:'clipEdit',tr:t.i,clip:clipForm(t.seq)});}}
  steppedBtn.addEventListener('click',()=>{stepped=!stepped;paintIcons();tx({type:'stepped',on:stepped});});
  // Changing the grid or bar length clears the sequence and the takes (they were made on the other grid),
  // so it asks first. The change lands on the next bar.
  function setShape(t,nc,nl){
    checkpoint();songPlaying=false;tx({type:'songStop'});
    takes=[];t.seq=null;liveV.order=liveV.mute=null;tx({type:'launch',tr:t.i,clip:null});
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
      t.file={L:l,R:r};t.kind='file';   // kept at its own level: untouched audio plays and exports at unity
      LOOP_NAMES.file=f.name.replace(/\.[^.]+$/,'').slice(0,18);
      let opt=soundSel.querySelector('option[value="file"]');
      if(!opt){opt=document.createElement('option');opt.value='file';soundSel.appendChild(opt);}
      opt.textContent=LOOP_NAMES.file;soundSel.value='file';genTrack(t);
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
    fold:svg('<path d="M5 12.5L10 7.5L15 12.5"/>'),
    unfold:svg('<path d="M5 7.5L10 12.5L15 7.5"/>'),
    undo:svg('<path d="M7.5 5L4 8.5L7.5 12M4 8.5H12.5A4 4 0 0 1 12.5 16.5H9"/>'),
    redo:svg('<path d="M12.5 5L16 8.5L12.5 12M16 8.5H7.5A4 4 0 0 0 7.5 16.5H11"/>'),
    trash:svg('<path d="M3.5 5.5H16.5M8 5.5V3.5H12V5.5M5.5 5.5L6.3 16.5H13.7L14.5 5.5M8.5 8.5V13.5M11.5 8.5V13.5"/>'),
    share:svg('<path d="M10 12.5V3M6.5 6.5L10 3L13.5 6.5M5 10H4V17H16V10H15"/>')
  };
  function paintIcons(){
    playBtn.innerHTML=st.playing||intent?ICON.stop:ICON.play;playBtn.setAttribute('aria-label',st.playing||intent?'Stop':'Play');
    expBtn.innerHTML=ICON.share;clearBtn.innerHTML=ICON.trash;
    const cmb=playMode==='combine';modeBtn.textContent=cmb?'COMBINE':'REPLACE';press(modeBtn,cmb);
    modeBtn.title=cmb?'Combine: every held effect plays on each step':'Replace: each step plays one touch and its effect';
    press(fxoBtn,fxOnly);fxoBtn.title=fxOnly?'FX only: slices come from the sequence or loop; touches only bring effects':'FX only is off: touched slices play';
    steppedBtn.innerHTML=stepped?ICON.stepOn:ICON.stepOff;steppedBtn.setAttribute('aria-label',stepped?'Stepped values (on)':'Stepped values (off)');
    prefsBtn.innerHTML=ICON.gear;$('undo').innerHTML=ICON.undo;$('redo').innerHTML=ICON.redo;
    sessBtn.innerHTML=(sessOn?ICON.grid:ICON.list)+'<b>'+(takes.length||'')+'</b>';sessBtn.setAttribute('aria-label',sessOn?'Effects view':'Takes ('+takes.length+')');
    sessBtn.title=sessOn?'Back to the effects':'Takes: every bar you play that adds something is kept here';
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
    const uAff=R(),uSl=R(),uSlD=R(),uAdd=R(),uAddK=R(),uAddR=R(),uAddS=R(),dev=[R(),R(),R(),R()],rem=[R(),R(),R(),R()];
    if(uAff>=a)return copySlot(orig);                      // chance a step is touched at all: a
    // an empty step is rolled as its loop slice; if nothing ends up changing it stays empty
    const s=orig.empty?{on:orig.on!==false,a:(idx%n)*step,off:0,sid:'D'+(++idCtr),slen:1,fx:[]}:orig;
    const y=copySlot(s);let moved=false;
    if(!fxOnly&&uSl<a){                                    // chance its slice moves: a (so a² overall), up to ±a·bar away
      const cur=Math.round(s.a/step),d=Math.round((uSlD*2-1)*a*n)||(uSlD<0.5?-1:1);
      y.a=((((cur+d)%n)+n)%n)*step;moved=y.a!==s.a;
    }
    y.fx=y.fx.filter((f,j)=>rem[j%4]>=a*0.5);             // each effect removed: a/2
    y.fx.forEach((f,j)=>{                                  // each kept effect's cell position nudged by up to ±a
      const lo=fxBip(t,f.k)?-1:0,nr=clamp(f.raw+(dev[j%4]*2-1)*a,lo,1),dd=nr-f.raw;f.raw=nr;
      if(f.auto)f.auto=f.auto.map(v=>clamp(v+dd,lo,1));
    });
    if(uAdd<a*0.5){                                        // an effect added (Combine) or swapped in (Replace): a/2
      const pool=dicePool(t).filter(k=>!y.fx.some(f=>f.k===k));
      if(pool.length){const k=pool[Math.min(pool.length-1,Math.floor(uAddK*pool.length))],f={k,raw:fxBip(t,k)?(uAddS<0.5?-1:1)*(0.15+0.85*uAddR):uAddR};
        if(combine)y.fx.push(f);else y.fx=[f];}
    }
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

  // ---------- takes ----------
  // Capture: the engine hands over every whole bar it played, as heard (ORDER, SKIP and random slices
  // already written into its steps). A bar is kept as a take when it adds something: not the plain loop,
  // and not an untouched replay of a take already kept. Playing the same thing again straight after
  // counts as a repeat of that take (×2, ×3…); only bars you touched add repeats, so a sequence left
  // looping doesn't run the count up. Repeats can also be set by hand, and takes dragged into any order.
  const fxKey=f=>f.k+(f.auto?f.auto.map(x=>x.toFixed(3)).join('/'):(+f.raw).toFixed(3));
  const barKey=slots=>slots.map(s=>(s.on===false?0:1)+':'+(+s.a).toFixed(3)+':'+(s.off||0)+':'+(+(s.slen||1)).toFixed(3)+':'+(s.fx||[]).map(fxKey).join(',')).join('|');
  const plainKey=t=>{const n=barSteps(t),out=[];for(let i=0;i<n;i++)out.push({on:true,a:i*16/t.cols,off:0,slen:1,fx:[]});return barKey(out);};
  let backPos=-1;   // where "◀ Take" has stepped back to (-1: start from the newest take)
  function onBar(m){
    const t=tracks[m.tr];if(!t||m.n!==barSteps(t))return;
    const k=barKey(m.slots);
    if(k===plainKey(t))return;
    const last=takes[takes.length-1];
    if(last&&last.key===k&&capBn===m.bn-1){capBn=m.bn;if(m.touched){last.reps=Math.min(64,last.reps+1);takesChanged(false);}return;}
    if(!m.touched&&takes.some(x=>x.key===k))return;
    takes.push({id:'k'+(++idCtr),num:++takeNum,n:m.n,cols:m.cols,slots:m.slots,reps:1,key:k,sel:false});
    capBn=m.bn;backPos=-1;takesChanged(true);
  }
  function takesChanged(added){
    paintIcons();if(added){sessBtn.classList.remove('flash');void sessBtn.offsetWidth;sessBtn.classList.add('flash');}
    if(!sessOn)return;
    const atEnd=sessScroll.scrollTop+sessScroll.clientHeight>=sessScroll.scrollHeight-60;
    renderSession();if(added&&atEnd)sessScroll.scrollTop=sessScroll.scrollHeight;
    pushSongRows();
  }
  const takeClip=k=>({id:k.id,cols:k.cols,n:k.n,slots:k.slots,ord:{perm:null},mute:{bits:null}});
  // looping a take puts a copy of it on the main page: edit it, play over it, and new takes follow
  function loopTake(k,keepBack){
    checkpoint();if(!keepBack)backPos=takes.indexOf(k);
    loadSeq(T(),withSettings({id:'q'+(++idCtr),cols:k.cols,n:k.n,slots:k.slots.map(copySlot),src:k.id,num:k.num},null));
  }
  $('lasttake').addEventListener('click',()=>{
    if(!takes.length)return;const t=T();
    const cur=t.seq&&t.seq.src?takes.findIndex(k=>k.id===t.seq.src):-1;
    // the first tap loops the newest take; each further tap the one before (an edited copy reloads first)
    if(backPos<0||backPos>=takes.length)backPos=takes.length-1;
    else if(cur===backPos&&!t.seq.edited)backPos=Math.max(0,backPos-1);
    loopTake(takes[backPos],true);
  });
  const songRows=()=>takes.map(k=>({bars:k.reps,clips:[takeClip(k)]}));
  function pushSongRows(){if(songPlaying)tx({type:'songRows',rows:songRows()});}
  function playAll(from){
    if(!takes.length)return;checkpoint();const t=T();t.seq=null;liveV.order=liveV.mute=null;songPlaying=true;
    initAudio();ready.then(()=>{tx({type:'live',tr:t.i,ord:null,mute:null});tx({type:'song',rows:songRows(),from});});
    computeLayout();renderSession();
  }
  function stopAll(){songPlaying=false;tx({type:'songStop'});renderSession();}
  function drawThumb(cv,clip,hue){
    const w=cv.clientWidth||70,h=cv.clientHeight||44,d=Math.min(2,window.devicePixelRatio||1);
    cv.width=Math.round(w*d);cv.height=Math.round(h*d);const x=cv.getContext('2d');x.scale(d,d);
    x.fillStyle=`hsl(${hue} 30% 14%)`;x.fillRect(0,0,w,h);
    if(!clip)return;
    const S=clip.slots,L=S.length,bw=w/L,top=6,hh=h-top-4;
    S.forEach((s,i)=>{
      const k=s.fx&&s.fx.length?s.fx[0].k:null,fh=k?(tracks[0].cfg[k]||{}).hue:null;
      const a=s.empty?(i%clip.n)*16/clip.cols:s.a;
      x.globalAlpha=s.on===false?0.18:s.empty?0.35:1;
      x.fillStyle=fh!=null?`hsl(${fh} 75% 60%)`:`hsl(${hue} 60% 70%)`;
      const y=top+(1-(a+0.5)/16)*hh;x.fillRect(i*bw+0.5,y-1.5,Math.max(1,bw-1.5),3);
    });
    x.globalAlpha=1;
  }
  let sessBusy=0,sessDirty=false,clearArm=0;
  const busy=on=>{sessBusy+=on?1:-1;if(sessBusy<0)sessBusy=0;if(!sessBusy&&sessDirty){sessDirty=false;renderSession();}};
  function paintTakesHead(){
    takesHead.textContent='';const nSel=takes.filter(k=>k.sel).length;
    takesHead.appendChild(el('h2',{textContent:'Takes'+(takes.length?' · '+takes.length:'')}));
    const pa=el('button',{type:'button',title:'Play every take in order, with its repeats'});pa.disabled=!takes.length;
    pa.innerHTML=(songPlaying?ICON.stop:ICON.play)+'<span>'+(songPlaying?'Stop':'Play all')+'</span>';press(pa,songPlaying);
    pa.addEventListener('click',()=>{if(songPlaying)stopAll();else playAll(0);});
    takesHead.appendChild(pa);
    if(nSel){const cs=el('button',{type:'button',textContent:nSel+' selected ×',title:'Clear the selection'});cs.addEventListener('click',()=>{takes.forEach(k=>{k.sel=false;});renderSession();});takesHead.appendChild(cs);}
    const clr=el('button',{type:'button',className:'danger',textContent:clearArm?'Tap to clear all':'Clear',title:'Delete every take'});clr.disabled=!takes.length;
    clr.addEventListener('click',()=>{
      if(!clearArm){clearArm=setTimeout(()=>{clearArm=0;paintTakesHead();},2500);paintTakesHead();return;}
      clearTimeout(clearArm);clearArm=0;checkpoint();if(songPlaying)stopAll();takes=[];backPos=-1;renderSession();paintIcons();
    });
    takesHead.appendChild(clr);
  }
  function takeRow(k,i){
    const row=el('div',{className:'take'});row.dataset.i=i;
    const hdl=el('div',{className:'hdl',title:'Drag to move this take'});hdl.innerHTML=ICON.handle;rowMover(hdl,k);
    const th=el('button',{type:'button',className:'th',title:'Loop take '+k.num+' on the main page'});const cv=el('canvas');
    th.appendChild(cv);th.appendChild(el('span',{textContent:String(k.num)}));th.addEventListener('click',()=>loopTake(k));
    const reps=el('div',{className:'reps'}),lab=el('span',{textContent:'×'+k.reps});
    const minus=el('button',{type:'button',textContent:'−',title:'Fewer repeats'}),plus=el('button',{type:'button',textContent:'+',title:'More repeats'});
    minus.addEventListener('click',()=>{if(k.reps<=1)return;checkpoint();k.reps--;lab.textContent='×'+k.reps;pushSongRows();});
    plus.addEventListener('click',()=>{if(k.reps>=64)return;checkpoint();k.reps++;lab.textContent='×'+k.reps;pushSongRows();});
    reps.append(minus,lab,plus);
    const sel=el('button',{type:'button',className:'sel',title:'Select for export'});sel.innerHTML=ICON.check;press(sel,k.sel);
    sel.addEventListener('click',()=>{k.sel=!k.sel;press(sel,k.sel);paintTakesHead();});
    const del=el('button',{type:'button',className:'del',textContent:'×',title:'Delete take '+k.num});
    del.addEventListener('click',()=>{checkpoint();takes=takes.filter(x=>x!==k);if(songPlaying&&!takes.length)stopAll();pushSongRows();renderSession();paintIcons();});
    row.append(hdl,th,reps,sel,del);
    requestAnimationFrame(()=>drawThumb(cv,takeClip(k),TRACK_HUES[0]));
    return row;
  }
  // Lightweight refresh: only classes change, so a drag in progress is never rebuilt away.
  function updateSession(){
    if(!sessOn)return;
    const t=T(),f=info(0),pi=songPlaying&&st.song?st.song.idx:-1;
    takeList.querySelectorAll('.take').forEach(r=>{const i=+r.dataset.i,k=takes[i];if(!k)return;
      const cur=!songPlaying&&!!t.seq&&t.seq.src===k.id;
      r.classList.toggle('now',st.playing&&(pi===i||cur&&f.clipId===t.seq.id));r.classList.toggle('cur',cur);});
  }
  function renderSession(){
    if(!sessOn)return;
    if(sessBusy){sessDirty=true;return;}
    paintTakesHead();takeList.textContent='';
    if(!takes.length){takeList.appendChild(el('p',{className:'takes-empty',textContent:'Nothing yet. Press play and touch the grid: every bar that adds something is kept here as a take, oldest at the top. Tap a take to loop it on the main page; play over it and the result becomes a new take.'}));return;}
    takes.forEach((k,i)=>takeList.appendChild(takeRow(k,i)));
    updateSession();
  }
  // drag a take's handle up or down to move it
  function rowMover(node,k){
    let s0=null;
    const over=(x,y)=>{const n=root.elementFromPoint(x,y),r=n&&n.closest?n.closest('.take'):null;return r&&takeList.contains(r)?r:null;};
    const clearOver=()=>takeList.querySelectorAll('.take.drop').forEach(n=>n.classList.remove('drop'));
    node.addEventListener('pointerdown',e=>{e.preventDefault();s0={y:e.clientY,id:e.pointerId,drag:false};busy(true);try{node.setPointerCapture(e.pointerId);}catch(_){}});
    node.addEventListener('pointermove',e=>{
      if(!s0||e.pointerId!==s0.id)return;
      if(e.pointerType==='mouse'&&e.buttons===0){end(e);return;}
      if(!s0.drag&&Math.abs(e.clientY-s0.y)>6){s0.drag=true;ghost.textContent='Take '+k.num;ghost.hidden=false;}
      if(s0.drag){ghost.style.left=e.clientX+'px';ghost.style.top=e.clientY+'px';clearOver();const r=over(e.clientX,e.clientY);if(r)r.classList.add('drop');
        const b=sessScroll.getBoundingClientRect();if(e.clientY<b.top+30)sessScroll.scrollTop-=8;else if(e.clientY>b.bottom-30)sessScroll.scrollTop+=8;}
    });
    const end=e=>{
      if(!s0||e.pointerId!==s0.id)return;const s=s0;s0=null;ghost.hidden=true;clearOver();busy(false);
      if(!s.drag)return;
      const r=over(e.clientX,e.clientY);if(!r)return;const to=+r.dataset.i,from=takes.indexOf(k);if(to===from||from<0)return;
      checkpoint();takes.splice(from,1);takes.splice(to,0,k);backPos=-1;pushSongRows();renderSession();
    };
    node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);
    node.addEventListener('lostpointercapture',e=>{if(s0&&e.pointerId===s0.id&&!s0.drag){s0=null;busy(false);}});
  }
  sessBtn.addEventListener('click',()=>{
    sessOn=!sessOn;sessEl.hidden=!sessOn;wrap.hidden=sessOn;laneCv.hidden=sessOn||folded;$('trackbar').hidden=sessOn||folded;paintIcons();
    if(sessOn){renderSession();sessScroll.scrollTop=sessScroll.scrollHeight;}else requestAnimationFrame(resize);
  });

  let sessKey='';
  function onStatus(m){
    gotStatus=true;m.recv=performance.now();const was=st.playing;st=m;
    if(was!==m.playing){if(!m.playing){intent=null;if(songPlaying){songPlaying=false;renderSession();}capBn=-9;}paintIcons();}
    clearBtn.disabled=!T().seq;paintUndo();$('lasttake').disabled=!takes.length;
    if(sessOn){const f=info(0),k=f.clipId+'|'+(m.song?m.song.idx:-1)+'|'+m.playing;if(k!==sessKey){sessKey=k;updateSession();}}
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
    ptrs.clear();special.clear();laneHolds.clear();laneHold=null;trashHeld=null;diceHeld=null;
    const keep=tracks[0].kind==='break'&&tracks[0].buf&&tracks[0].buf.L.length===loopLen(48000)?tracks[0]:null;
    tracks[0]=newTrack(0,'break');if(keep){tracks[0].buf=keep.buf;tracks[0].pk=keep.pk;}
    view=0;takes=[];takeNum=0;capBn=-9;backPos=-1;songPlaying=false;
    bpm=124;swing=0;stepped=true;playMode='replace';fxOnly=false;
    Object.assign(prefs,PREF0,{shown:new Set(ALL_FX)});
    Object.assign(pin,PIN0);liveV.order=liveV.mute=null;undoS.length=0;redoS.length=0;
    st={playing:false,t:0,len:1,tracks:[],hist:[],song:null,recv:0};
    press(playBtn,false);clearBtn.disabled=true;
    bpmEl.querySelector('b').textContent='124';swingEl.querySelector('b').textContent='0%';
    soundSel.value='break';
    if(sessOn){sessOn=false;sessEl.hidden=true;wrap.hidden=false;}
    setFold(false);
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
        const count=takes.length,go=()=>{cols=nc;len=nl;setShape(t,nc,nl);paint();};
        if(!count&&!t.seq){w.hidden=true;go();return;}
        w.ask('This clears the sequence'+(count?' and your '+count+(count>1?' takes':' take'):'')+'.','Change',go);
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
    cardEl.appendChild(el('div',{},[el('h3',{},['Second slider']),radios('p-silp',[['mute','SKIP: its steps go quiet; the sequence keeps moving'],['insert','GAP: a quiet step is inserted; the sequence waits, so every step still plays']],prefs.silPat,v=>{prefs.silPat=v;sendPref();})]));
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
    cardEl.appendChild(el('div',{},[el('h3',{},['Testing']),rb,el('p',{},['Stops playback, shuts down the audio engine and returns every setting, the sequence and the takes to the start.'])]));
  }));
  // ---------- export ----------
  // Takes and the sequence are rendered offline (faster than real time) by a fresh engine with the same
  // loop, effect settings, tempo and swing. A single bar renders after a pre-roll of itself, so it loops
  // seamlessly (delay echoes wrap into its start). Files are 24-bit WAV, or 32-bit float. Inside claude.ai
  // the page hands them over through the downloads capability, which takes a zip (not .wav); elsewhere a
  // single file downloads as .wav and several as a .zip.
  let dlCap=null;
  try{if(window.claude&&window.claude.use)window.claude.use('downloads').then(d=>{dlCap=d;},()=>{});}catch(_){}
  const expOpt={float:false,tail:false};
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
  // one bar that loops seamlessly: a sequence (null: the plain loop with its ORDER and SKIP)
  function bounceBar(c){const e=exportEngine(),n=e.len;e.msg({type:'launch',tr:0,clip:c});if(!c)e.msg({type:'play'});
    const b=EF.bounce(e,2*n);return {buf:{L:b.L.slice(n),R:b.R.slice(n)},sr:e.sr};}
  function bounceTakes(list){const rows=list.map(k=>({bars:k.reps,clips:[takeClip(k)]}));if(expOpt.tail)rows.push({bars:2,clips:[null]});
    const e=exportEngine();e.msg({type:'song',rows,from:0});
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
    const t=T(),sel=takes.filter(k=>k.sel),list=sel.length?sel:takes,bars=list.reduce((s,k)=>s+k.reps,0);
    const msg=el('p',{className:'expmsg'}),status=x=>{msg.textContent=x;};
    const tag='-'+bpm+'bpm',what=sel.length?'selected takes':'takes';
    const run=(label,fn)=>()=>{if(!t.buf)return;status('Rendering '+label+'…');setTimeout(()=>{try{fn();}catch(err){status('Export failed: '+err.message);}},30);};
    const inOrder=el('button',{type:'button',textContent:sel.length?'Selected, in order':'All, in order',disabled:!list.length});
    inOrder.addEventListener('click',run('the '+what,()=>{const r=bounceTakes(list);offer([{name:'slicefield-takes'+tag+'.wav',data:wav(r.buf.L,r.buf.R,r.sr)}],'slicefield-takes'+tag+'.zip',status);}));
    const each=el('button',{type:'button',textContent:(sel.length?'Each selected':'Each take')+' ('+list.length+(list.length===1?' file)':' files)'),disabled:!list.length});
    each.addEventListener('click',run('the '+what,()=>offer(list.map(k=>{const r=bounceBar(takeClip(k));return {name:'slicefield-take-'+k.num+tag+'.wav',data:wav(r.buf.L,r.buf.R,r.sr)};}),'slicefield-'+(sel.length?'selected':'takes')+tag+'.zip',status)));
    const tailCb=el('input',{type:'checkbox',checked:expOpt.tail});tailCb.addEventListener('change',()=>{expOpt.tail=tailCb.checked;});
    cardEl.appendChild(el('div',{},[el('h3',{},['Takes'+(sel.length?' · '+sel.length+' selected':'')]),el('div',{className:'expclips'},[inOrder,each]),
      el('p',{},[list.length?'In order: one file, '+bars+(bars>1?' bars':' bar')+' with repeats ('+(bars*barSec()).toFixed(1)+' s). Each: one seamless one-bar loop per take.'+(sel.length?'':' Select takes in the Takes list to export just those.'):'No takes yet. Every bar you play that adds something is kept as a take.']),
      el('label',{},[tailCb,'In order: add 2 bars at the end for delay echoes to ring out'])]));
    const seqB=el('button',{type:'button',textContent:t.seq?'This sequence':'The loop as set'});
    seqB.addEventListener('click',run('the sequence',()=>{const r=bounceBar(t.seq?clipForm(t.seq):null),nm='slicefield-'+(t.seq?'sequence':'loop')+tag;offer([{name:nm+'.wav',data:wav(r.buf.L,r.buf.R,r.sr)}],nm+'.zip',status);}));
    cardEl.appendChild(el('div',{},[el('h3',{},['Main page']),seqB,el('p',{},['One seamless bar, with its stored ORDER and SKIP.'])]));
    const heard=el('div',{className:'expclips'},[2,4,8].map(n=>{const b=el('button',{type:'button',textContent:'Last '+n+' bars'});
      b.addEventListener('click',()=>{if(!send){status('Nothing has played yet');return;}grabWait={status};status('Collecting…');tx({type:'grab',bars:n});});return b;}));
    cardEl.appendChild(el('div',{},[el('h3',{},['What you just heard']),heard,el('p',{},['The last whole bars that played, exactly as they sounded, live touches included.'])]));
    const flCb=el('input',{type:'checkbox',checked:expOpt.float});flCb.addEventListener('change',()=>{expOpt.float=flCb.checked;});
    cardEl.appendChild(el('div',{},[el('h3',{},['Format']),el('label',{},[flCb,'32-bit float'])]));
    cardEl.appendChild(msg);
  }));

  // ---------- undo / redo ----------
  // Every edit gesture saves a snapshot of the sequence, the plain loop's strips and the takes list first.
  // Live touches don't, and capture doesn't: undo never removes takes captured since the snapshot.
  const undoS=[],redoS=[];
  function snapState(){const t=T();return {seq:t.seq?cloneClip(t.seq):null,loopSet:Object.assign({},t.loopSet),takes:takes.map(k=>({k,reps:k.reps})),takeNum};}
  function checkpoint(){undoS.push(snapState());if(undoS.length>100)undoS.shift();redoS.length=0;paintUndo();}
  function restoreState(sn){
    const t=T(),f=info(t.i),newer=takes.filter(k=>k.num>sn.takeNum);
    takes=sn.takes.map(x=>{x.k.reps=x.reps;return x.k;}).concat(newer);
    t.loopSet=sn.loopSet;t.seq=sn.seq;liveV.order=liveV.mute=null;
    if(!songPlaying){
      // the same sequence is edited in place at once; a different one takes over at the next bar
      if(t.seq&&f.clipId===t.seq.id)tx({type:'clipEdit',tr:t.i,clip:clipForm(t.seq)});
      else tx({type:'launch',tr:t.i,clip:t.seq&&clipForm(t.seq)});
    }
    sendLoopSet(t);pushSongRows();computeLayout();renderSession();paintUndo();paintIcons();
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
    if(prefs.silPat!=='mute')return false;
    const b=EF.skipPattern(mV(t),barSteps(t));return !!b&&!b[idx%b.length];
  }
  function drawLane(fs){
    const d=lanePageInfo(),t=d.t,i=info(view),h=laneRows*LROW+4;
    g.fillStyle='#16181d';rr(0,0,LW,h,7);g.fill();
    g.textBaseline='middle';g.textAlign='center';g.font=`600 ${fs}px ${FONT}`;
    // LIVE: the plain loop as it plays. A take's number when one is looping (* once it's edited), SEQ otherwise.
    g.fillStyle=d.clip?`hsl(${TRACK_HUES[view]} 75% 62%)`:'#6c7380';
    const lab=!d.clip?'LIVE':d.clip.num?'T'+d.clip.num+(d.clip.edited?'*':''):'SEQ';
    if(lab.length>4)g.font=`600 ${fs-2}px ${FONT}`;
    g.fillText(lab,LLAB/2,h/2-(d.pages>1?6:0));
    if(d.pages>1){g.font=`400 ${fs-1}px ${FONT}`;g.fillStyle='#8a8f99';g.fillText((d.page+1)+'/'+d.pages,LLAB/2,h/2+7);}
    const w=(LW-LLAB)/d.n;
    if(d.clip){
      for(let r=0;r<d.rows;r++)for(let j=0;j<d.n;j++){
        const idx=d.page*d.per+r*d.n+j,s=d.slots[idx];if(idx>=d.slots.length)continue;
        const lit=laneHold&&laneHold.idx===idx&&laneHold.clip===d.clip?'hold':st.playing&&idx===d.playIdx,dim=s.on===false||patDim(t,idx);
        laneCell(t,s,LLAB+j*w,4+r*LROW,w,LROW-5,lit,dim,fs,(s.off||0)>0,j*16/t.cols);
      }
    }else{
      // live: the current bar as it plays
      const H=(st.hist||[]),cur=H.length?H[H.length-1]:null,bp=cur?cur.bp:-1,bn=cur?cur.bn:-1,w0=bn;
      const at=new Map();if(st.playing)for(const e of H)if(e.bn>=w0)at.set((e.bn-w0)+':'+e.bp,e);
      for(let r=0;r<d.rows;r++)for(let j=0;j<d.n;j++){
        const s=at.get(r+':'+j)||null,now=st.playing&&bn-w0===r&&j===bp;
        laneCell(t,s,LLAB+j*w,4+r*LROW,w,LROW-5,now,s?!s.on:patDim(t,j),fs,s&&(s.off||0)>0);
      }
    }
  }
  // Folded: the loop picker, the lane and both strips fold away, leaving one slim bar; tap it to open.
  const foldBtn=$('fold');
  function setFold(on){folded=on;laneCv.hidden=on||sessOn;$('trackbar').hidden=on||sessOn;press(foldBtn,on);foldBtn.innerHTML=ICON.fold;
    foldBtn.setAttribute('aria-label','Hide sequencer, loop and sliders');foldBtn.title=foldBtn.getAttribute('aria-label');computeLayout();}
  foldBtn.addEventListener('click',()=>setFold(!folded));
  function drawSlim(fs){
    g.fillStyle='#1a1d23';rr(0,0,cssW,SLIM,7);g.fill();
    g.strokeStyle='#8a8f99';g.lineWidth=1.7;g.lineCap='round';g.lineJoin='round';
    const cx=cssW/2,cy=SLIM/2;g.beginPath();g.moveTo(cx-6,cy-3);g.lineTo(cx,cy+3);g.lineTo(cx+6,cy-3);g.stroke();
  }
  function drawStrips(fs){
    const t=T(),sw=SW();let y0=yOrder(),h=STRIP;
    // pin box: when on, strip moves are kept on the clip; when off they are live and snap back
    const box=(y,on)=>{g.fillStyle=on?'#3a3120':'#1a1d23';rr(cssW-26,y,26,h,6);g.fill();const c=on?ACC:'#6c7380',cx=cssW-13,cy=y+h/2;
      g.fillStyle=c;g.strokeStyle=c;g.lineWidth=1.6;g.beginPath();g.arc(cx,cy-3.5,3.6,0,Math.PI*2);on?g.fill():g.stroke();
      g.beginPath();g.moveTo(cx,cy);g.lineTo(cx,cy+7);g.stroke();};
    const ghost=(v,y,col)=>{if(v==null)return;g.strokeStyle=col;g.lineWidth=1.5;g.setLineDash([2,2]);rr(v*sw-3,y+2,6,h-4,3);g.stroke();g.setLineDash([]);};
    // ORDER and SKIP (GAP): the further left, the more the pattern changes; the small zone at the far right is
    // the default. Each position is one fixed pattern, numbered. The solid marker is the stored value, the
    // dashed one a live (unpinned) move.
    const fine=[...special.values()].find(sp=>sp.kind==='strip'&&sp.fine);
    const strip=(y,which,name,col,colA,defLab)=>{
      const v=which==='order'?oV(t):mV(t),n=patNo(v),dz=EF.DEAD*sw;
      g.fillStyle='#1a1d23';rr(0,y,sw,h,7);g.fill();
      const grd=g.createLinearGradient(0,0,dz,0);grd.addColorStop(0,colA(.30));grd.addColorStop(1,colA(.03));
      g.fillStyle=grd;rr(0,y,dz,h,7);g.fill();
      g.fillStyle=n?'#262a32':colA(.22);g.fillRect(dz,y+3,sw-dz-2,h-6);
      g.textBaseline='middle';g.font=`600 ${fs}px ${FONT}`;g.textAlign='left';g.fillStyle=n?col:'#8a8f99';g.fillText(name,8,y+h/2);
      g.textAlign='right';g.font=`${n?600:400} ${fs}px ${FONT}`;g.fillStyle=n?col:'#6c7380';
      g.fillText(fine&&fine.which===which?'FINE · #'+n:n?'#'+n:defLab,sw-12,y+h/2);
      g.fillStyle=col;rr(Math.min(sw-4,ctxSet(t)[which+'V']*sw-2),y+3,4,h-6,2);g.fill();ghost(liveV[which],y,'#fff');
      box(y,pin[which]);
    };
    strip(y0,'order','ORDER',ACC,ACCA,'FORWARD');
    strip(yMute(),'mute',prefs.silPat==='insert'?'GAP':'SKIP','#b8c4ff',a=>'rgba(150,170,255,'+a+')','NONE');
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
    const touch=new Set();for(const p of ptrs.values())if(p.live&&p.tr===view&&p.ri>=0)touch.add(p.ri+':'+p.col);
    lay.forEach((r,ri)=>{
      const hue=hueOf(t,r.id);
      g.fillStyle='#1a1d23';rr(0,r.y,HW-4,r.h,5);g.fill();
      g.fillStyle=`hsl(${hue} 60% 55%)`;g.fillRect(4,r.y+4,3,r.h-8);
      g.fillStyle='#6c7380';for(let q=0;q<3;q++)g.fillRect(12,r.y+r.h/2-5+q*4,9,1.5);
      if(r.id==='center'){drawCenter(t,i,r,ri,curSlice,marks,touch,cw,gap,fs,nowHid);return;}
      const k=r.id,c=t.cfg[k],d=FX[k],cn=c.cells.filter(n=>d.params[n]),P=cn.length?d.params[cn[0]]:null,pn=cn[0];
      const rm=marks.filter(m=>m.fx===k);
      for(let col=0;col<cols;col++){
        let l=13,s=16;if(col===curSlice&&!i.fx.length)l+=3;
        g.fillStyle=`hsl(${hue} ${s}% ${l}%)`;rr(HW+col*cw+gap/2,r.y,cw-gap,r.h,5);g.fill();
      }
      for(const m of rm){const now=nowHid===m.hid;g.fillStyle=`hsl(${hue} ${now?62:42}% ${now?32:21}%)`;rr(cellX(t,m.a)+gap/2,r.y,m.n/16*W()-gap,r.h,5);g.fill();}
      if(st.playing&&i.fx&&i.fx.includes(k)&&curSlice>=0){g.strokeStyle=`hsl(${hue} 80% 68%)`;g.lineWidth=1.5;rr(HW+curSlice*cw+gap/2+0.75,r.y+0.75,cw-gap-1.5,r.h-1.5,5);g.stroke();}
      for(let col=0;col<cols;col++)if(touch.has(ri+':'+col)){g.fillStyle=`hsl(${hue} 70% 46%)`;rr(HW+col*cw+gap/2,r.y,cw-gap,r.h,5);g.fill();}
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
      const lines=rm.map(m=>({x0:cellX(t,m.a)+gap/2+3,x1:cellX(t,m.a+m.n)-gap/2-3,raw:m.raw}));
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
    const xe=cellX(t,t.len16);if(xe<cssW-1){g.fillStyle='rgba(10,11,14,.42)';g.fillRect(xe,y0,cssW-xe,cssH-y0);}
    // the current step when it is silenced
    if(st.playing&&i.gate===false&&i.src){g.fillStyle='rgba(10,11,14,.5)';const x=i.rest?HW+((i.s+Math.max(0,i.barPos))%cols)*cw:HW+curSlice*cw;if(x>=HW)g.fillRect(x,y0,cw,cssH-y0);}
    if(folded)drawSlim(fs);else drawStrips(fs);
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
  function drawCenter(t,i,r,ri,curSlice,marks,touch,cw,gap,fs,nowHid){
    const cols=t.cols,bot=r.y+r.h,fm=marks.filter(m=>m.fx==='filter'),dm=marks.filter(m=>m.fx==='dry'),fh=t.cfg.filter.hue;
    for(let col=0;col<cols;col++){g.fillStyle=col===curSlice?'#252931':'#1a1d23';rr(HW+col*cw+gap/2,r.y,cw-gap,r.h,6);g.fill();}
    for(const m of dm){const now=nowHid===m.hid;g.fillStyle=now?'#3a3527':'#2a2822';rr(cellX(t,m.a)+gap/2,r.y,m.n/16*W()-gap,r.h,6);g.fill();}
    for(let col=0;col<cols;col++)if(touch.has(ri+':'+col)){g.fillStyle='#343a46';rr(HW+col*cw+gap/2,r.y,cw-gap,r.h,6);g.fill();}
    const fz=(x0,x1,raw,now)=>{const hp=raw>0;g.fillStyle=hp?`hsla(${fh} 85% 60% / ${now?0.36:0.2})`:`hsla(${(fh+160)%360} 85% 60% / ${now?0.36:0.2})`;
      if(hp)g.fillRect(x0,r.y,x1-x0,r.z1-r.y);else g.fillRect(x0,r.z2,x1-x0,bot-r.z2);};
    for(const s of fm)fz(cellX(t,s.a)+gap/2,cellX(t,s.a+s.n)-gap/2,s.raw,nowHid===s.hid);
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
      const fl=fm.map(m=>({x0:cellX(t,m.a)+gap/2+3,x1:cellX(t,m.a+m.n)-gap/2-3,raw:m.raw}));
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
    for(let col=0;col<cols;col+=every)g.fillText(String(col+1),HW+col*cw+gap/2+4,r.z1+4);
    if(st.playing&&i.src&&!i.rest){const x=HW+(i.pos/16)*W();g.fillStyle=ACC;g.fillRect(x-0.75,r.z1,1.5,r.z2-r.z1);}
  }

  // ---------- start ----------
  // the layout is portrait only; where the browser allows it, keep the screen upright
  try{const o=screen.orientation;if(o&&o.lock){const p=o.lock('portrait');if(p&&p.catch)p.catch(()=>{});}}catch(_){}
  paintIcons();setFold(false);dieEl.innerHTML=ICON.dice;
  (function pre(){let n=0;const nx=()=>{if(n>=tracks.length)return;const t=tracks[n++];if(!t.buf){t.buf=buildLoop(t,48000);t.pk=peaks(t.buf);}setTimeout(nx,10);};setTimeout(nx,0);})();
  requestAnimationFrame(draw);
}
