(function(){
  const EF=engineFactory(),FX=EF.FX;
  const FONT='"Martian Mono", ui-monospace, Menlo, monospace';
  const ALL_FX=['stutter','random','pitch','reverse','env','freeze','crush'];
  const HUES=[8,24,44,90,138,166,190,214,262,318,340];
  const TRACK_HUES=[40,170,265,330];
  const LET=['A','B','C','D'];
  const SCENES=8;
  const LOOP_NAMES={break:'Breakbeat',boombap:'Boom bap',acid:'Acid bass',reese:'Reese bass',dub:'Dub stabs',lead:'Synth lead',keys:'Electric piano',kalimba:'Kalimba',vox:'Vocal chops',file:'Your file'};
  const BAND_LO=0.42,BAND_HI=0.58,STRIP=28,HW=30,LROW=24,LLAB=34;
  const $=id=>document.getElementById(id);
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const canvas=$('grid'),wrap=$('gridwrap'),laneCv=$('lane'),laneG=laneCv.getContext('2d'),gridG=canvas.getContext('2d');
  let g=gridG,LW=300,laneDpr=1;
  // App-wide mode colour: amber normally; in global mode the accent turns blue and the whole background tints.
  const MODES={n:['#ffc65c','255,198,92'],l:['#5ee0b4','94,224,180'],g:['#7fb2ff','127,178,255'],b:['#c99bff','201,155,255']};
  let ACC=MODES.n[0],ACCRGB=MODES.n[1];const ACCA=a=>'rgba('+ACCRGB+','+a+')';
  let BG='#111317';
  function setMode(){
    [ACC,ACCRGB]=MODES[globalOn?'g':'n'];BG=globalOn?'#0f1a2c':'#111317';
    document.body.classList.toggle('m-global',globalOn);
  }
  const playBtn=$('play'),bpmEl=$('bpm'),swingEl=$('swing'),recBtn=$('rec'),capBtn=$('cap'),modeBtn=$('recmode'),clearBtn=$('clear'),steppedBtn=$('stepped'),globeBtn=$('globe'),diceBtn=$('dice'),prefsBtn=$('prefs'),sessBtn=$('sessbtn');
  const tabsEl=$('tabs'),soundSel=$('sound'),fileIn=$('file'),sheet=$('sheet'),card=$('card');
  const sessEl=$('session'),sgrid=$('sgrid'),songEl=$('song'),songGrid=$('songgrid'),ghost=$('ghost');

  // ---------- state ----------
  function defCfg(){
    const c=EF.allCfg();for(const k in c)c[k].hue=FX[k].hue;
    return c;
  }
  const newTrack=(i,kind)=>({i,kind,file:null,cols:16,muted:false,solo:false,vol:0.8,recBuf:null,len16:16,rows:['stutter','random','pitch','center','reverse','env','freeze','crush'],
    cfg:defCfg(),orderV:1,muteV:0.5,slots:new Array(SCENES).fill(null),edit:0,buf:null,pk:null,lg:{}});
  const tracks=[newTrack(0,'break'),newTrack(1,'reese'),newTrack(2,'kalimba'),newTrack(3,'vox')];
  let view=0,scenes=SCENES;
  const PREF0={silRnd:'mute',silPat:'mute',grace:40,seqLen:2};
  const prefs=Object.assign({},PREF0,{shown:new Set(ALL_FX)});
  const snap={order:false,mute:false};const globe={order:false,mute:false};
  // While the globe is on, its value overrides every track; each track keeps its own value underneath.
  const gval={order:1,mute:0.5};
  const oV=t=>globe.order?gval.order:t.orderV, mV=t=>globe.mute?gval.mute:t.muteV;
  let bpm=124,swing=0,stepped=true,sessOn=false,playMode='replace';
  const seqName=t=>LET[t.i]+(t.edit+1);
  let song=[{clips:[null,null,null,null],scene:null}];
  let st={playing:false,t:0,len:1,tracks:[],hist:[],song:null,recv:0};
  const ptrs=new Map();let orderCtr=0,tsCtr=0,idCtr=0;
  const SLIM=24;let folded=false;
  let cssW=300,cssH=400,dpr=1,lay=[],laneRows=1,TOP=100;
  let lanePage=0,laneFollow=true;
  const T=()=>tracks[view];
  const info=i=>(st.tracks&&st.tracks[i])||{};
  const clipOf=(t,s)=>t.slots[s]||null;
  const editClip=t=>clipOf(t,t.edit);

  // ---------- audio ----------
  let actx=null,send=null,ready=null,sr=48000,unlocked=false,gotStatus=false,usingFallback=false,workletNode=null,intent=null,gen=0,mediaEl=null,heardHint=false;
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
      try{const r=actx.resume();if(r&&r.catch)r.catch(()=>{});}catch(_){}
      try{const b=actx.createBuffer(1,1,actx.sampleRate),s=actx.createBufferSource();s.buffer=b;s.connect(actx.destination);s.start(0);}catch(_){}
    }
  }
  ['pointerdown','pointerup','touchstart','touchend','mousedown','click','keydown'].forEach(ev=>window.addEventListener(ev,unlock,{capture:true,passive:true}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&actx&&actx.state!=='running'){try{actx.resume();}catch(_){}}});
  const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
  function onEngine(m){
    if(m.type==='status')onStatus(m);
    else if(m.type==='clip')storeClip(m.tr,m.clip,m.cap);
    else if(m.type==='clipStep'){const c=findClip(m.tr,m.id);if(c){c.slots[m.idx]=m.slot;delete tracks[m.tr].lg[m.idx];}}
    else if(m.type==='overDone'){renderSession();pushSong();}
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
    connectOut(sp);window.__keep=sp;send=m=>e.msg(m);
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
      if(i<4){const t=tracks[i];bufs[i]=buildLoop(t,rate);i++;genTimer=setTimeout(nx,20);return;}
      tracks.forEach((t,j)=>{t.buf=bufs[j];t.pk=peaks(bufs[j]);});
      tx({type:'loadAll',bufs:bufs.map(b=>({L:b.L,R:b.R}))});
    };
    genTimer=setTimeout(nx,0);
  }
  function syncTrack(t){
    tx({type:'grid',tr:t.i,n:t.cols});tx({type:'range',tr:t.i,s16:0,e16:t.len16});sendCfg(t);tx({type:'tmute',tr:t.i,on:!audible(t)});tx({type:'tvol',tr:t.i,v:volGain(t.vol)});
    const o=orderFrom(oV(t)),m=muteFrom(mV(t));tx({type:'order',tr:t.i,mode:o.mode,r:o.r});tx({type:'mute',tr:t.i,rnd:m.rnd,bits:m.bits});
    if(t.buf)tx({type:'load',tr:t.i,L:t.buf.L,R:t.buf.R});
    push(t);
  }
  const prefMsg=()=>({type:'pref',pref:{silRnd:prefs.silRnd,silPat:prefs.silPat,grace:prefs.grace,seqLen:prefs.seqLen}});
  // the engine works out every effect value from these settings, so edits reach recorded sequences too
  function sendCfg(t){const c={};for(const k in t.cfg){const x=t.cfg[k];c[k]={cells:x.cells.slice(),lo:Object.assign({},x.lo),hi:Object.assign({},x.hi),x:Object.assign({},x.x),o:Object.assign({},x.o,x.o.mask?{mask:x.o.mask.slice()}:{})};}tx({type:'cfg',tr:t.i,cfg:c});}
  function syncAll(){
    tx({type:'swing',s:swing});tx({type:'stepped',on:stepped});tx({type:'mode',mode:playMode});tx(prefMsg());tx({type:'view',tr:view});
    tracks.forEach(t=>{fitTrack(t);syncTrack(t);});
    // regenerate at the device rate in the background for best quality
    if(curRate()!==48000)regenAll();
  }
  const barSec=()=>240/bpm;

  // ---------- strips ----------
  function orderFrom(v){
    if(v<=0.06)return {mode:'back',r:0};
    if(v>=0.94)return {mode:'fwd',r:0};
    if(v<0.5)return {mode:'back',r:(v-0.06)/0.44};
    return {mode:'fwd',r:(0.94-v)/0.44};
  }
  let PATS=null;
  function patterns(){
    if(PATS)return PATS;const n=8,out=[];
    for(let m=0;m<128;m++){
      const bits=[1];for(let i=1;i<n;i++)bits.push((m>>(n-1-i))&1);
      const on=[];bits.forEach((b,i)=>{if(b)on.push(i);});
      const k=on.length,mean=n/k;let ev=0;
      for(let i=0;i<k;i++){const d=((on[(i+1)%k]-on[i])+n)%n||n;ev+=(d-mean)*(d-mean);}
      out.push({bits,k,ev,v:-m});
    }
    out.sort((a,b)=>b.k-a.k||a.ev-b.ev||a.v-b.v);
    return PATS=out.map(o=>o.bits);
  }
  function muteFrom(v){
    if(Math.abs(v-0.5)<0.015)return {rnd:0,bits:null};
    if(v<0.5)return {rnd:(0.5-v)/0.5,bits:null};
    const P=patterns(),i=Math.round((v-0.5)/0.5*(P.length-1));
    return {rnd:0,bits:i===0?null:P[i]};
  }
  function sendStrip(x,which){
    if(which==='order'){const o=orderFrom(oV(x));tx({type:'order',tr:x.i,mode:o.mode,r:o.r});}
    else if(which==='mute'){x.lg={};const m=muteFrom(mV(x));tx({type:'mute',tr:x.i,rnd:m.rnd,bits:m.bits});}
  }
  const STRIP_DEF={order:1,mute:0.5};
  function setStrip(t,which,v){
    if(which==='mute'&&Math.abs(v-0.5)<0.015)v=0.5;
    if(globe[which]){gval[which]=v;tracks.forEach(x=>sendStrip(x,which));}
    else{if(which==='order')t.orderV=v;else t.muteV=v;sendStrip(t,which);}
  }

  // ---------- touches ----------
  // Cell values: unipolar cells map bottom→top onto the range; bipolar cells move outward from the
  // centre band, up to the range's top value above and its bottom value below.
  // Touches carry only their raw cell position; values come from the track's settings.
  const resolve=(t,k,raw)=>EF.resolve(t.cfg[k],k,raw);
  const toEngine=(t,e)=>({id:e.hid,a:e.a,n:e.n,o:e.order,fx:e.fx==='dry'?null:{k:e.fx,raw:e.raw},glob:false});
  function entriesOf(t){
    const out=[];
    if(globalOn){
      for(const p of ptrs.values())if(p.live&&p.fx&&p.g){const s=tracks[p.tr];out.push({hid:p.hid,fx:p.fx,a:p.col*16/s.cols,n:16/s.cols,raw:p.raw,order:p.order,ts:p.ts,src:p.tr,finger:true});}
      return out;
    }
    for(const p of ptrs.values())if(p.live&&p.fx&&p.tr===t.i&&!p.g)out.push({hid:p.hid,fx:p.fx,a:p.col*16/t.cols,n:16/t.cols,raw:p.raw,order:p.order,ts:p.ts,src:t.i,finger:true});
    return out;
  }
  function push(t){tx({type:'touches',tr:t.i,list:entriesOf(t).map(e=>toEngine(e.src!=null?tracks[e.src]:t,e)).sort((a,b)=>a.o-b.o)});}
  function pushFor(ptr){if(ptr.g)tracks.forEach(push);else push(tracks[ptr.tr]);}

  // ---------- geometry ----------
  const visRows=t=>t.rows.filter(id=>id==='center'||prefs.shown.has(id));
  function laneInfo(){
    const t=T(),i=info(view);
    let clip=editClip(t);
    if(t.recBuf&&(i.rec==='on'||i.rec==='closing')){
      // what is being recorded replaces the sequence step by step, as you hear it
      const base=clip?clip.slots.slice():[];t.recBuf.forEach((s,k)=>{base[k]=s;});
      clip={id:'__rec',n:clip?clip.n:(i.n||t.cols),cols:t.cols,slots:base,rec:true,recIdx:t.recBuf.length-1,real:clip};
    }
    const n=clip?clip.n:(i.n||t.cols),slots=clip?clip.slots:null;
    const total=slots?slots.length:n,bars=Math.max(1,Math.ceil(total/n));
    // the lane keeps the height of the sequence length, so nothing jumps when sequences change
    return {t,clip,n,slots,bars,rows:Math.min(2,Math.max(prefs.seqLen,bars)),over:i.recOver&&i.rec==='on',dub:i.recDub&&i.rec==='on'};
  }
  function hasCell(t,k){return t.cfg[k].cells.length>0;}
  function computeLayout(){
    laneRows=laneInfo().rows;
    TOP=folded?SLIM+6:STRIP+4+STRIP+6;
    sizeLane();
    const t=T(),rows=visRows(t),gap=3,THIN=20;
    const wt=id=>id==='center'?3.2:!hasCell(t,id)?0:FX[id].tall?2.8:1;
    const thin=rows.filter(id=>wt(id)===0).length,units=rows.reduce((s,id)=>s+wt(id),0)||1;
    const unit=(cssH-TOP-gap*(rows.length-1)-thin*THIN)/units;let y=TOP;
    lay=rows.map(id=>{const w=wt(id),h=w?unit*w:THIN,o={id,y,h,thin:!w};if(id==='center'){o.z1=y+h*0.36;o.z2=y+h*0.64;}y+=h+gap;return o;});
  }
  function sizeLane(){
    const w=laneCv.clientWidth||cssW,h=laneRows*LROW+6;laneDpr=Math.min(3,window.devicePixelRatio||1);
    if(laneCv.style.height!==h+'px')laneCv.style.height=h+'px';
    LW=w;const W2=Math.round(w*laneDpr),H2=Math.round(h*laneDpr);if(laneCv.width!==W2||laneCv.height!==H2){laneCv.width=W2;laneCv.height=H2;}
  }
  new ResizeObserver(()=>sizeLane()).observe(laneCv);
  laneCv.addEventListener('pointerdown',async e=>{
    e.preventDefault();try{laneCv.setPointerCapture(e.pointerId);}catch(_){}
    const b=laneCv.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;initAudio();await ready;laneDown(e.pointerId,x,y);
  });
  // A step switches off or on when it is released. While a step is held, tapping a cell assigns that
  // cell (and the finger's position in it) to the step.
  const laneUp=e=>{
    const h=laneHold;if(!h||h.id!==e.pointerId)return;laneHold=null;
    if(!h.used&&e.type==='pointerup'){const s=h.clip.slots[h.idx];if(s){s.on=!(s.on!==false);delete h.t.lg[h.idx];tx({type:'clipEdit',tr:h.t.i,clip:h.clip});pushSong();renderSession();}}
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
      if(h.snapBox){snap[h.strip]=!snap[h.strip];return;}
      // double-tap a strip to put it back to its default
      const now=performance.now(),dbl=lastStrip.which===h.strip&&now-lastStrip.t<320;lastStrip={which:h.strip,t:dbl?0:now};
      special.set(e.pointerId,{kind:'strip',which:h.strip,held:dbl});await ready;
      setStrip(t,h.strip,dbl?STRIP_DEF[h.strip]:clamp(x/SW(),0,1));return;
    }
    if(h.unfold){setFold(false);return;}
    if(h.handle){special.set(e.pointerId,{kind:'handle',id:h.id,y0:y,y,moved:false});return;}
    if(laneHold&&h.cell&&!laneHold.clip.rec){special.set(e.pointerId,{kind:'assign'});assignStep(h);return;}
    const ptr={x,y,tr:view,col:-1,fx:null,raw:0,ri:-1,order:-1,ts:0,hid:null,g:globalOn,live:false};ptrs.set(e.pointerId,ptr);
    checkBlocked();await ready;
    if(ptrs.get(e.pointerId)===ptr){ptr.live=true;update(ptr);}else ensurePlaying();
  });
  canvas.addEventListener('pointermove',e=>{
    const [x,y]=pos(e),sp=special.get(e.pointerId);
    if(sp){
      if(sp.kind==='strip'){if(!sp.held)setStrip(T(),sp.which,clamp(x/SW(),0,1));}
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
      if(sp.kind==='strip'&&snap[sp.which])setStrip(T(),sp.which,STRIP_DEF[sp.which]);
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
    const playIdx=L.clip&&L.clip.rec?L.clip.recIdx:(L.clip&&i.clipId===L.clip.id?i.cIdx:-1);
    const page=laneFollow&&playIdx>=0?Math.floor(playIdx/per):Math.min(lanePage,pages-1);
    return Object.assign(L,{per,pages,page,playIdx});
  }
  let laneHold=null;
  function laneDown(id,x,y){
    const d=lanePageInfo();
    if(x<LLAB){if(d.pages>1){laneFollow=false;lanePage=(d.page+1)%d.pages;}return;}
    if(!d.clip||d.clip.rec||d.over)return;
    const row=Math.min(d.rows-1,Math.floor((y-4)/LROW)),col=Math.floor((x-LLAB)/(LW-LLAB)*d.n);
    const idx=d.page*d.per+row*d.n+col;
    if(col<0||col>=d.n||idx>=d.slots.length)return;
    laneHold={id,idx,clip:d.clip,t:d.t,used:false};
    // a cell already held on the grid is pasted straight into the step
    let finger=null;for(const p of ptrs.values())if(p.live&&p.fx&&p.tr===view&&(!finger||p.ts>finger.ts))finger=p;
    if(finger)assignStep({col:finger.col,fx:finger.fx,raw:finger.raw});
  }
  function assignStep(h){
    const L=laneHold;if(!L)return;const t=L.t;L.used=true;
    L.clip.slots[L.idx]={on:true,a:h.col*16/t.cols,off:0,sid:L.sid||(L.sid='P'+(++idCtr)),slen:1,fx:h.fx==='dry'?[]:[{k:h.fx,raw:h.raw}]};
    delete t.lg[L.idx];tx({type:'clipEdit',tr:t.i,clip:L.clip});pushSong();renderSession();
  }

  // ---------- transport ----------
  async function togglePlay(){
    initAudio();checkBlocked();await ready;
    if(st.playing||intent){intent=null;tx({type:'stop'});songPlaying=false;pendSong=-1;paintIcons();updateSession();}
    else{intent={type:'play'};tx(intent);paintIcons();}
  }
  playBtn.addEventListener('click',togglePlay);
  window.addEventListener('keydown',e=>{
    if(e.code==='Space'&&!/INPUT|SELECT|BUTTON/.test(document.activeElement.tagName)&&sheet.hidden){e.preventDefault();togglePlay();}
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
  recBtn.addEventListener('click',async()=>{
    initAudio();checkBlocked();await ready;
    const i=info(view),t=T(),ex=editClip(t);
    if(i.rec==='on'||i.rec==='waiting')tx({type:'rec',tr:view,on:false});
    else if(!i.rec){
      // an existing sequence is recorded over in place and keeps its length; an empty slot records a new one
      if(ex)tx({type:'rec',tr:view,on:true,id:ex.id,over:{id:ex.id,cols:ex.cols,n:ex.n,slots:ex.slots}});
      else tx({type:'rec',tr:view,on:true,id:'t'+view+'s'+t.edit+'_'+(++idCtr)});
    }
  });
  // Replace: touches take over the sequence (and recording replaces steps).
  // Combine: touches only add effects to whatever plays (and recording stacks effects on steps).
  modeBtn.addEventListener('click',()=>{playMode=playMode==='replace'?'combine':'replace';tx({type:'mode',mode:playMode});paintIcons();});
  // Capture prints what you just heard into a sequence (into the next empty slot if this one is taken).
  capBtn.addEventListener('click',async()=>{
    initAudio();await ready;if(!st.playing)return;
    const t=T();let s=t.edit;
    if(t.slots[s]){s=-1;for(let q=1;q<=t.slots.length;q++){const j=(t.edit+q)%t.slots.length;if(!t.slots[j]){s=j;break;}}
      if(s<0){scenes++;tracks.forEach(x=>x.slots.push(null));s=t.slots.length-1;}}
    tx({type:'capture',tr:view,id:'t'+view+'s'+s+'_c'+(++idCtr)});
  });
  // Clear deletes the sequence in the selected slot. The first tap arms it; tap again to confirm.
  let clearArm=0;
  function disarmClear(){if(clearArm){clearTimeout(clearArm);clearArm=0;}clearBtn.textContent='Clear';clearBtn.classList.remove('armed');}
  clearBtn.addEventListener('click',()=>{
    const t=T();if(!editClip(t))return;
    if(!clearArm){clearArm=setTimeout(disarmClear,2500);clearBtn.textContent='Sure?';clearBtn.classList.add('armed');return;}
    disarmClear();clearSequence(t);
  });
  function clearSequence(t){
    const c=editClip(t),f=info(t.i);if(!c)return;
    if(f.rec&&f.recId===c.id)tx({type:'rec',tr:t.i,on:false});
    if(f.clipId===c.id||f.clipQ===c.id)tx({type:'launch',tr:t.i,clip:null});
    t.slots[t.edit]=null;t.lg={};t.recBuf=null;computeLayout();renderSession();pushSong();
  }
  steppedBtn.addEventListener('click',()=>{stepped=!stepped;paintIcons();tx({type:'stepped',on:stepped});});
  // Changing a track's grid deletes its sequences (they were made on the other grid), so it asks first.
  // Changing a track's grid or bar length deletes its sequences; both changes land on the track's next bar.
  function setShape(t,nc,nl){
    const f=info(t.i);if(f.rec)tx({type:'rec',tr:t.i,on:false});
    t.slots=t.slots.map(()=>null);t.lg={};t.recBuf=null;tx({type:'launch',tr:t.i,clip:null});
    t.len16=nl;
    if(nc!==(t.colsQ||t.cols)){if(st.playing){t.colsQ=nc;tx({type:'grid',tr:t.i,n:nc,q:true});}else{t.cols=nc;tx({type:'grid',tr:t.i,n:nc});}}
    tx({type:'range',tr:t.i,s16:0,e16:nl,q:st.playing});
    computeLayout();renderSession();pushSong();
  }
  // a blank sequence plays the bar straight through, ready for steps to be assigned
  function blankSequence(t,bars){
    const c=editClip(t),cols=t.colsQ||t.cols,n=t.len16*cols/16,step=16/cols,slots=[];
    for(let i=0;i<n*bars;i++)slots.push({on:true,a:(i%n)*step,off:0,sid:'B'+(++idCtr),slen:1,fx:[]});
    const nc={id:c?c.id:'t'+t.i+'s'+t.edit+'_b'+(++idCtr),cols,n,slots,tr:t.i,scene:t.edit};
    t.slots[t.edit]=nc;t.lg={};if(c)tx({type:'clipEdit',tr:t.i,clip:nc});
    computeLayout();renderSession();pushSong();
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
      t.file=normalize({L:l,R:r});t.kind='file';LOOP_NAMES.file=f.name.replace(/\.[^.]+$/,'').slice(0,18);
      let opt=soundSel.querySelector('option[value="file"]');
      if(!opt){opt=document.createElement('option');opt.value='file';soundSel.appendChild(opt);}
      opt.textContent=LOOP_NAMES.file;soundSel.value='file';genTrack(t);
    }catch(err){soundSel.value=t.kind;}
    fileIn.value='';
  });

  // ---------- tracks ----------
  // ---------- icons ----------
  const svg=p=>'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>';
  const ICON={
    play:svg('<path d="M6 4.5l10 5.5-10 5.5z" fill="currentColor" stroke="none"/>'),
    stop:svg('<rect x="5" y="5" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>'),
    rec:svg('<circle cx="10" cy="10" r="5.5" stroke="none"/>'),
    stepOn:svg('<path d="M2 15H6V9H10V12H14V5H18"/>'),
    stepOff:svg('<path d="M2 15C4.5 15 4.5 9 7 9S9.5 12 12 12S13.5 5 18 5"/>'),
    globe:svg('<circle cx="10" cy="10" r="7"/><ellipse cx="10" cy="10" rx="3" ry="7"/><path d="M3 10H17"/>'),
    dice:svg('<rect x="3.5" y="3.5" width="13" height="13" rx="3"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="13" cy="13" r="1" fill="currentColor"/><circle cx="10" cy="10" r="1" fill="currentColor"/><circle cx="13" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="13" r="1" fill="currentColor"/>'),
    lines:svg('<path d="M3 5H8.5M3 10H8.5M3 15H8.5M11.5 5H17M11.5 10H17M11.5 15H17"/>'),
    grid:svg('<circle cx="3.5" cy="3.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="7.83" cy="3.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="12.16" cy="3.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="16.49" cy="3.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="3.5" cy="7.83" r="1.25" fill="currentColor" stroke="none"/><circle cx="7.83" cy="7.83" r="1.25" fill="currentColor" stroke="none"/><circle cx="12.16" cy="7.83" r="1.25" fill="currentColor" stroke="none"/><circle cx="16.49" cy="7.83" r="1.25" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12.16" r="1.25" fill="currentColor" stroke="none"/><circle cx="7.83" cy="12.16" r="1.25" fill="currentColor" stroke="none"/><circle cx="12.16" cy="12.16" r="1.25" fill="currentColor" stroke="none"/><circle cx="16.49" cy="12.16" r="1.25" fill="currentColor" stroke="none"/><circle cx="3.5" cy="16.49" r="1.25" fill="currentColor" stroke="none"/><circle cx="7.83" cy="16.49" r="1.25" fill="currentColor" stroke="none"/><circle cx="12.16" cy="16.49" r="1.25" fill="currentColor" stroke="none"/><circle cx="16.49" cy="16.49" r="1.25" fill="currentColor" stroke="none"/>'),
    gear:svg('<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6"/><circle cx="10" cy="10" r="5.4"/>'),
    x:svg('<path d="M5 5L15 15M15 5L5 15"/>'),
    fold:svg('<path d="M5 12.5L10 7.5L15 12.5"/>'),
    unfold:svg('<path d="M5 7.5L10 12.5L15 7.5"/>'),
    cap:svg('<path d="M3 7V3.5H6.5M13.5 3.5H17V7M17 13V16.5H13.5M6.5 16.5H3V13"/><circle cx="10" cy="10" r="2.6" fill="currentColor" stroke="none"/>')
  };
  function paintIcons(){
    playBtn.innerHTML=st.playing||intent?ICON.stop:ICON.play;playBtn.setAttribute('aria-label',st.playing||intent?'Stop':'Play');
    recBtn.innerHTML=ICON.rec;capBtn.innerHTML=ICON.cap;
    const cmb=playMode==='combine';modeBtn.textContent=cmb?'Combine':'Replace';press(modeBtn,cmb);
    modeBtn.title=cmb?'Combine: touches add effects to what plays; slices never change':'Replace: touches take over from the sequence';
    steppedBtn.innerHTML=stepped?ICON.stepOn:ICON.stepOff;steppedBtn.setAttribute('aria-label',stepped?'Stepped values (on)':'Stepped values (off)');
    globeBtn.innerHTML=ICON.globe;diceBtn.innerHTML=ICON.dice;prefsBtn.innerHTML=ICON.gear;
    sessBtn.innerHTML=sessOn?ICON.grid:ICON.lines;sessBtn.setAttribute('aria-label',sessOn?'Track and effects view':'Session view');sessBtn.title=sessOn?'Track and effects view':'Session view';
  }

  // ---------- tracks, mute and solo ----------
  const anySolo=()=>tracks.some(t=>t.solo);
  const audible=t=>t.solo||(!t.muted&&!anySolo());
  function sendMutes(){tracks.forEach(t=>tx({type:'tmute',tr:t.i,on:!audible(t)}));}
  function msBtns(t,cls){
    const s=el('button',{type:'button',className:'sb',textContent:'S',title:'Solo track '+LET[t.i]});press(s,!!t.solo);
    const m=el('button',{type:'button',className:'mt',textContent:'M',title:'Mute track '+LET[t.i]});press(m,t.muted);
    s.addEventListener('click',ev=>{ev.stopPropagation();t.solo=!t.solo;sendMutes();renderTabs();renderSession();});
    m.addEventListener('click',ev=>{ev.stopPropagation();t.muted=!t.muted;sendMutes();renderTabs();renderSession();});
    return [s,m];
  }
  function renderTabs(){
    tabsEl.textContent='';
    tracks.forEach(t=>{
      const d=el('div',{className:'tab'});d.setAttribute('role','tab');d.setAttribute('aria-selected',t.i===view?'true':'false');d.tabIndex=0;
      d.setAttribute('aria-label','Track '+LET[t.i]);
      const n=el('span',{className:'n',textContent:LET[t.i]});n.style.color=`hsl(${TRACK_HUES[t.i]} 75% 62%)`;
      const [s,m]=msBtns(t);
      d.appendChild(n);d.appendChild(el('i'));d.appendChild(el('span',{className:'bx'},[s,m]));
      d.addEventListener('click',()=>selectTrack(t.i));
      d.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();selectTrack(t.i);}});
      tabsEl.appendChild(d);
    });
  }
  function selectTrack(i){
    if(i===view)return;
    // recording only ever happens on the track you are looking at, so leaving it stops the recording
    if(info(view).rec)tx({type:'rec',tr:view,on:false});
    for(const [id,p] of ptrs){if(p.tr===view&&!p.g)ptrs.delete(id);}push(T());
    view=i;const t=T();disarmClear();
    soundSel.value=t.kind==='file'&&!soundSel.querySelector('option[value="file"]')?'break':t.kind;
    laneFollow=true;tx({type:'view',tr:i});setMode();computeLayout();renderTabs();renderSession();
  }
  function updateTabDots(){
    const dots=tabsEl.querySelectorAll('.tab i');
    tracks.forEach((t,i)=>{const on=st.playing&&audible(t)&&info(i).gate;if(dots[i])dots[i].className=on?'on':'';});
  }

  // ---------- global mode ----------
  // While the globe is on, touches and both strips act on every track. Each track keeps its own
  // settings underneath, and gets them back when the globe goes off.
  let globalOn=false;
  globeBtn.addEventListener('click',()=>{
    globalOn=!globalOn;press(globeBtn,globalOn);
    const t=T();
    if(globalOn){gval.order=t.orderV;gval.mute=t.muteV;}
    globe.order=globe.mute=globalOn;
    if(!globalOn){for(const [id,p] of ptrs)if(p.g)ptrs.delete(id);}
    setMode();
    tracks.forEach(x=>{sendStrip(x,'order');sendStrip(x,'mute');push(x);});
  });

  // ---------- random sequence ----------
  diceBtn.addEventListener('click',()=>{
    const t=T(),n=t.len16*t.cols/16,L=n*prefs.seqLen,step=16/t.cols;
    const pool=['dry','dry','dry',...ALL_FX.filter(k=>prefs.shown.has(k)&&hasCell(t,k)),'filter'];
    const slots=[];
    for(let i=0;i<L;i++){
      const k=pool[Math.floor(Math.random()*pool.length)],a=Math.floor(Math.random()*n)*step;
      let fx=[];
      if(k!=='dry'){const bip=k==='filter'||cellBip(t,k);const raw=bip?(Math.random()<0.5?-1:1)*(0.15+0.85*Math.random()):Math.random();fx=[{k,raw}];}
      slots.push({on:true,a,off:0,sid:'D'+(++idCtr),slen:1,fx});
    }
    const clip={id:'t'+t.i+'s'+t.edit+'_dice'+(++idCtr),cols:t.cols,n,slots,tr:t.i,scene:t.edit};
    t.slots[t.edit]=clip;t.lg={};laneFollow=true;
    initAudio();ready.then(()=>tx({type:'launch',tr:t.i,clip}));
    computeLayout();renderSession();pushSong();
  });

  // ---------- clips, session and song ----------
  function storeClip(tr,clip,cap){
    const m=/^t(\d+)s(\d+)_/.exec(clip.id);const t=tracks[tr],s=m?+m[2]:t.edit;if(!cap)t.recBuf=null;
    while(t.slots.length<=s)tracks.forEach(x=>x.slots.push(null));scenes=Math.max(scenes,t.slots.length);
    clip.tr=tr;clip.scene=s;t.slots[s]=clip;if(cap)t.edit=s;t.lg={};laneFollow=true;computeLayout();renderSession();pushSong();
  }
  function findClip(tr,id){const t=tracks[tr];return t.slots.find(c=>c&&c.id===id)||null;}
  const clipBars=c=>c?Math.max(1,Math.ceil(c.slots.length/(c.n||c.cols))):1;
  let pendSong=-1;
  function launchSlot(tr,s){
    const t=tracks[tr],c=clipOf(t,s);t.edit=s;t.lg={};laneFollow=true;
    initAudio();ready.then(()=>tx({type:'launch',tr,clip:c}));
    if(songPlaying){songPlaying=false;pendSong=-1;}
    if(tr!==view)selectTrack(tr);else computeLayout();
    updateSession();
  }
  function launchScene(s){
    for(const t of tracks){t.edit=s;t.lg={};const c=clipOf(t,s);initAudio();ready.then(()=>tx({type:'launch',tr:t.i,clip:c}));}
    songPlaying=false;pendSong=-1;computeLayout();updateSession();
  }
  function drawThumb(cv,clip,hue){
    const w=cv.clientWidth||70,h=cv.clientHeight||44,d=Math.min(2,window.devicePixelRatio||1);
    cv.width=Math.round(w*d);cv.height=Math.round(h*d);const x=cv.getContext('2d');x.scale(d,d);
    x.fillStyle=`hsl(${hue} 30% 14%)`;x.fillRect(0,0,w,h);
    if(!clip)return;
    const S=clip.slots,L=S.length,bw=w/L,top=12,hh=h-top-3;
    for(let b=1;b<Math.ceil(L/clip.n);b++){x.fillStyle='rgba(255,255,255,.08)';x.fillRect(b*clip.n*bw,top,1,hh);}
    S.forEach((s,i)=>{
      const k=s.fx&&s.fx.length?s.fx[0].k:null,fh=k?(tracks[clip.tr].cfg[k]||{}).hue:null;
      x.globalAlpha=s.on===false?0.25:1;
      x.fillStyle=fh!=null?`hsl(${fh} 75% 60%)`:`hsl(${hue} 60% 70%)`;
      const y=top+(1-(s.a+0.5)/16)*hh;x.fillRect(i*bw,y-1.5,Math.max(1,bw-0.6),3);
    });
    x.globalAlpha=1;
  }
  let songPlaying=false,sessBusy=0,sessDirty=false;
  // Lightweight refresh: only classes change, so a drag or knob turn in progress is never rebuilt away.
  function updateSession(){
    if(!sessOn)return;
    sgrid.querySelectorAll('.slot').forEach(d=>{
      const tr=+d.dataset.tr,s=+d.dataset.s,t=tracks[tr],c=clipOf(t,s),f=info(tr);
      d.classList.toggle('sel',t.edit===s);
      d.classList.toggle('play',!!(c&&f.clipId===c.id&&f.clipQ===undefined));
      d.classList.toggle('queued',!!(c&&f.clipQ===c.id)||(!c&&t.edit===s&&f.clipQ===null));
      d.classList.toggle('dim',!audible(t));
    });
    sgrid.querySelectorAll('.launch').forEach(b=>{const s=+b.dataset.s;
      b.classList.toggle('on',tracks.every(t=>t.edit===s));
      b.classList.toggle('queued',tracks.some(t=>t.edit===s&&info(t.i).clipQ!==undefined));});
    const pi=songPlaying&&st.song?st.song.idx:-1;
    songGrid.querySelectorAll('.launch').forEach(b=>{const r=+b.dataset.real;b.classList.toggle('on',r===pi&&pi>=0);b.classList.toggle('queued',r>=0&&r===pendSong);});
    songGrid.querySelectorAll('.slot').forEach(d=>{const r=+d.dataset.real;d.classList.toggle('play',r===pi&&pi>=0&&d.dataset.has==='1');d.classList.toggle('queued',r>=0&&r===pendSong&&d.dataset.has==='1');d.classList.toggle('dim',!audible(tracks[+d.dataset.tr]));});
  }
  const busy=on=>{sessBusy+=on?1:-1;if(sessBusy<0)sessBusy=0;if(!sessBusy&&sessDirty){sessDirty=false;renderSession();}};
  // knob at 0.8 = 0 dB; full turn = +3.9 dB
  const volGain=v=>0.85*Math.pow(v/0.8,2);
  const volDb=v=>{const r=Math.pow(v/0.8,2);if(r<0.001)return '−∞';const d=20*Math.log10(r);return (d>0.05?'+':'')+(Math.abs(d)<0.05?'0.0':d.toFixed(1))+' dB';};
  function knob(t){
    const k=el('div',{className:'knob'+(audible(t)?'':' dim'),tabIndex:0});k.setAttribute('role','slider');k.setAttribute('aria-label','Track '+LET[t.i]+' volume');
    k.innerHTML='<i></i><span></span>';
    const show=()=>{k.querySelector('i').style.transform='rotate('+(-135+270*t.vol)+'deg)';k.querySelector('span').textContent=volDb(t.vol);k.setAttribute('aria-valuenow',String(Math.round(t.vol*100)));k.style.setProperty('--h',TRACK_HUES[t.i]);};
    const set=v=>{t.vol=clamp(v,0,1);tx({type:'tvol',tr:t.i,v:volGain(t.vol)});show();};
    let id=null,y0=0,v0=0,last=0;
    k.addEventListener('pointerdown',e=>{const now=performance.now();if(now-last<300){set(0.8);}last=now;id=e.pointerId;y0=e.clientY;v0=t.vol;busy(true);try{k.setPointerCapture(id);}catch(_){}});
    k.addEventListener('pointermove',e=>{if(e.pointerId!==id)return;if(e.pointerType==='mouse'&&e.buttons===0){id=null;busy(false);return;}set(v0+(y0-e.clientY)/150);});
    const up=e=>{if(e.pointerId!==id)return;id=null;busy(false);};
    k.addEventListener('pointerup',up);k.addEventListener('pointercancel',up);k.addEventListener('lostpointercapture',up);
    k.addEventListener('keydown',e=>{const d={ArrowUp:0.02,ArrowRight:0.02,ArrowDown:-0.02,ArrowLeft:-0.02}[e.key];if(d){e.preventDefault();set(t.vol+d);}});
    k.title='Drag up or down · double-tap for 0 dB';
    show();return k;
  }
  function trackHeader(t){
    const d=el('div',{className:'sbox'}),top=el('div',{className:'top'});
    const n=el('span',{className:'n',textContent:LET[t.i]});n.style.color=`hsl(${TRACK_HUES[t.i]} 75% 62%)`;
    const [s,m]=msBtns(t);
    const stp=el('button',{type:'button',title:'Stop track '+LET[t.i]+' (plays its raw loop)'});stp.innerHTML=ICON.stop;stp.setAttribute('aria-label','Stop track '+LET[t.i]);
    stp.addEventListener('click',()=>{tx({type:'launch',tr:t.i,clip:null});updateSession();});
    top.appendChild(n);top.appendChild(el('span',{className:'bx'},[s,m]));d.appendChild(top);
    stp.className='stp';const low=el('div',{className:'low'},[stp,knob(t)]);d.appendChild(low);
    return d;
  }
  function renderSession(){
    if(!sessOn)return;
    if(sessBusy){sessDirty=true;return;}
    sgrid.textContent='';
    sgrid.appendChild(el('div',{className:'ptitle'},['Clips']));
    // headers sit in the same grid as the clips, so they line up with their columns
    const stopAll=el('button',{type:'button',className:'stopall',title:'Stop all clips'});stopAll.innerHTML=ICON.stop;stopAll.setAttribute('aria-label','Stop all clips');
    stopAll.addEventListener('click',()=>{tracks.forEach(t=>tx({type:'launch',tr:t.i,clip:null}));songPlaying=false;pendSong=-1;tx({type:'songStop'});updateSession();});
    sgrid.appendChild(stopAll);
    tracks.forEach(t=>sgrid.appendChild(trackHeader(t)));
    sgrid.appendChild(el('div'));
    for(let s=0;s<scenes;s++){
      const lb=el('button',{type:'button',className:'launch',title:'Launch row '+(s+1)+' · drag it into the song'});lb.innerHTML=ICON.play;lb.dataset.s=s;lb.setAttribute('aria-label','Launch row '+(s+1));
      dragSource(lb,()=>({kind:'scene',scene:s,label:'Row '+(s+1)}),()=>launchScene(s));
      sgrid.appendChild(lb);
      tracks.forEach(t=>{
        const c=clipOf(t,s),d=el('div',{className:'slot'});d.dataset.tr=t.i;d.dataset.s=s;
        const cv=el('canvas');d.appendChild(cv);
        d.title=c?LET[t.i]+(s+1)+' · play and edit · drag into the song':LET[t.i]+(s+1)+' · empty · tap to select for recording';
        dragSource(d,()=>c?{kind:'clip',tr:t.i,scene:s,label:LET[t.i]+(s+1)}:null,()=>launchSlot(t.i,s));
        sgrid.appendChild(d);
        requestAnimationFrame(()=>drawThumb(cv,c,TRACK_HUES[t.i]));
      });
      sgrid.appendChild(el('div'));
    }
    const add=el('button',{type:'button',className:'addrow',textContent:'+ Add row'});
    add.addEventListener('click',()=>{scenes++;tracks.forEach(t=>t.slots.push(null));renderSession();});
    sgrid.appendChild(add);
    renderSong();updateSession();
  }
  function rowClips(r){return r.scene!=null?tracks.map(t=>clipOf(t,r.scene)):r.clips.map((c,i)=>c?clipOf(tracks[i],c.scene):null);}
  const rowFilled=r=>r.scene!=null||r.clips.some(Boolean);
  function songRowsForEngine(){
    return song.filter(rowFilled).map(r=>{const cl=rowClips(r);return {bars:Math.max(1,...cl.map(c=>c?clipBars(c):1)),clips:cl};});
  }
  function pushSong(){if(songPlaying)tx({type:'songRows',rows:songRowsForEngine()});}
  function ensureSongTail(){if(!song.length||rowFilled(song[song.length-1]))song.push({clips:[null,null,null,null],scene:null});}
  function playSongFrom(idx){
    const rows=songRowsForEngine();if(!rows.length)return;
    const real=Math.max(0,song.slice(0,idx+1).filter(rowFilled).length-1);
    initAudio();ready.then(()=>tx({type:'song',rows,from:real}));songPlaying=true;pendSong=real;updateSession();
  }
  function renderSong(){
    ensureSongTail();songGrid.textContent='';
    songGrid.appendChild(el('div',{className:'ptitle'},['Song']));
    const realIdx=[];let n=0;song.forEach(r=>{realIdx.push(rowFilled(r)?n++:-1);});
    song.forEach((r,ri)=>{
      const b=el('button',{type:'button',className:'launch grab',title:'Play the song from this row · drag up or down to move it'});
      b.innerHTML=ICON.play;b.dataset.real=realIdx[ri];b.dataset.row=ri;b.setAttribute('aria-label','Play song from row '+(ri+1));
      rowMover(b,ri);songGrid.appendChild(b);
      const cl=rowClips(r);
      tracks.forEach((t,i)=>{
        const c=cl[i],d=el('div',{className:'slot'+(r.scene!=null?' scene':'')});d.dataset.song=ri;d.dataset.row=ri;d.dataset.real=realIdx[ri];d.dataset.has=c?'1':'0';d.dataset.tr=i;
        const cv=el('canvas');d.appendChild(cv);
        d.addEventListener('click',()=>playSongFrom(ri));
        songGrid.appendChild(d);requestAnimationFrame(()=>drawThumb(cv,c,TRACK_HUES[i]));
      });
      const x=el('button',{type:'button',className:'rowx',textContent:'×',title:'Remove this song row'});
      x.addEventListener('click',()=>{song.splice(ri,1);ensureSongTail();pushSong();renderSong();updateSession();});
      songGrid.appendChild(x);
    });
  }
  // song rows: tap the ▶ box to play from there, or drag it up or down to move the row
  function rowMover(node,ri){
    let s0=null;
    node.addEventListener('pointerdown',e=>{s0={y:e.clientY,x:e.clientX,id:e.pointerId,drag:false};busy(true);try{node.setPointerCapture(e.pointerId);}catch(_){}});
    node.addEventListener('pointermove',e=>{
      if(!s0||e.pointerId!==s0.id)return;
      if(e.pointerType==='mouse'&&e.buttons===0){end(e);return;}
      if(!s0.drag&&Math.abs(e.clientY-s0.y)>8){s0.drag=true;ghost.textContent='Row '+(ri+1);ghost.hidden=false;}
      if(s0.drag){ghost.style.left=e.clientX+'px';ghost.style.top=e.clientY+'px';
        songGrid.querySelectorAll('.songrow-over').forEach(n=>n.classList.remove('songrow-over'));
        const tg=rowAt(e.clientX,e.clientY);if(tg!==null)songGrid.querySelectorAll('[data-row="'+tg+'"]').forEach(n=>n.classList.add('songrow-over'));}
    });
    const end=e=>{
      if(!s0||e.pointerId!==s0.id)return;const s=s0;s0=null;ghost.hidden=true;busy(false);
      songGrid.querySelectorAll('.songrow-over').forEach(n=>n.classList.remove('songrow-over'));
      if(!s.drag){if(e.type==='pointerup')playSongFrom(ri);return;}
      const tg=rowAt(e.clientX,e.clientY);if(tg===null||tg===ri)return;
      const [row]=song.splice(ri,1);song.splice(tg,0,row);ensureSongTail();pushSong();renderSong();updateSession();
    };
    node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);
    node.addEventListener('lostpointercapture',e=>{if(s0&&e.pointerId===s0.id&&!s0.drag){s0=null;busy(false);}});
  }
  function rowAt(x,y){const n=document.elementFromPoint(x,y);const r=n&&n.closest?n.closest('[data-row]'):null;return r&&songGrid.contains(r)?+r.dataset.row:null;}
  // drag from a session slot or row button into the song
  function dragSource(node,payload,onTap){
    let st0=null;
    node.addEventListener('pointerdown',e=>{st0={x:e.clientX,y:e.clientY,id:e.pointerId,drag:false,p:payload()};busy(true);try{node.setPointerCapture(e.pointerId);}catch(_){}});
    node.addEventListener('pointermove',e=>{
      if(!st0||e.pointerId!==st0.id)return;
      if(e.pointerType==='mouse'&&e.buttons===0){up(e);return;}
      if(!st0.drag&&st0.p&&Math.hypot(e.clientX-st0.x,e.clientY-st0.y)>10){st0.drag=true;ghost.textContent=st0.p.label;ghost.hidden=false;}
      if(st0.drag){ghost.style.left=e.clientX+'px';ghost.style.top=e.clientY+'px';
        document.querySelectorAll('.slot.over').forEach(n=>n.classList.remove('over'));
        const tg=dropTarget(e.clientX,e.clientY);if(tg)tg.classList.add('over');}
    });
    const up=e=>{
      if(!st0||e.pointerId!==st0.id)return;
      const s=st0;st0=null;ghost.hidden=true;document.querySelectorAll('.slot.over').forEach(n=>n.classList.remove('over'));
      busy(false);
      if(!s.drag){if(e.type==='pointerup')onTap();return;}
      const tg=dropTarget(e.clientX,e.clientY);if(!tg)return;
      const r=song[+tg.dataset.song];
      if(s.p.kind==='scene'){r.scene=s.p.scene;r.clips=[null,null,null,null];}
      else{
        if(r.scene!=null){r.clips=tracks.map(t=>clipOf(t,r.scene)?{scene:r.scene}:null);r.scene=null;}
        r.clips[s.p.tr]={scene:s.p.scene};
      }
      ensureSongTail();pushSong();renderSong();updateSession();
    };
    node.addEventListener('pointerup',up);node.addEventListener('pointercancel',up);
    node.addEventListener('lostpointercapture',e=>{if(st0&&e.pointerId===st0.id&&!st0.drag){st0=null;busy(false);}});
  }
  function dropTarget(x,y){const n=document.elementFromPoint(x,y);const s=n&&n.closest?n.closest('.slot'):null;return s&&s.dataset.song!==undefined?s:null;}
  sessBtn.addEventListener('click',()=>{
    sessOn=!sessOn;sessEl.hidden=!sessOn;wrap.hidden=sessOn;tabsEl.hidden=sessOn;laneCv.hidden=sessOn||folded;$('trackbar').hidden=sessOn;paintIcons();
    if(sessOn)renderSession();else requestAnimationFrame(resize);
  });

  let sessKey='';
  function onStatus(m){
    gotStatus=true;m.recv=performance.now();const was=st.playing;st=m;
    if(was!==m.playing){if(!m.playing){intent=null;songPlaying=false;pendSong=-1;}paintIcons();}
    if(pendSong>=0&&m.song&&m.song.idx===pendSong)pendSong=-1;
    const i=info(view);
    recBtn.classList.toggle('on',i.rec==='on'||i.rec==='closing');recBtn.classList.toggle('waiting',i.rec==='waiting'||i.rec==='closing');
    recBtn.classList.toggle('dub',!!i.recDub);press(recBtn,!!i.rec);
    capBtn.classList.toggle('waiting',!!i.capQ);capBtn.disabled=!m.playing;
    clearBtn.disabled=!editClip(T());if(clearBtn.disabled&&clearArm)disarmClear();
    // remember which clip steps were actually heard on their last pass
    tracks.forEach((t,ti)=>{const f=info(ti),c=editClip(t);if(c&&f.clipId===c.id&&f.cIdx>=0)t.lg[f.cIdx]=f.gate;
      if((f.rec==='on'||f.rec==='closing')&&!f.recOver){if(!t.recBuf||f.recFrom===0&&f.recNew&&f.recNew.length&&t.recBuf.length>f.recNew.length+2)t.recBuf=[];
        if(f.recNew&&f.recNew.length){t.recBuf.length=Math.min(t.recBuf.length,f.recFrom);for(const s of f.recNew)t.recBuf.push(s);}}
      else if(!f.rec)t.recBuf=null;});
    updateTabDots();
    if(sessOn){const k=tracks.map((t,ti)=>{const f=info(ti);return f.clipId+'|'+f.clipQ+'|'+t.edit;}).join()+'|'+(m.song?m.song.idx:-1)+'|'+m.playing+'|'+pendSong;if(k!==sessKey){sessKey=k;updateSession();}}
    const lr=laneInfo().rows;if(lr!==laneRows)computeLayout();
  }

  // ---------- hard reset (from Preferences) ----------
  async function hardReset(){
    gen++;
    try{if(workletNode){workletNode.port.postMessage({type:'stop'});workletNode.port.onmessage=null;workletNode.disconnect();}}catch(_){}
    try{if(window.__keep){window.__keep.onaudioprocess=null;window.__keep.disconnect();window.__keep=null;}}catch(_){}
    const old=actx;actx=null;ready=null;send=null;workletNode=null;usingFallback=false;gotStatus=false;intent=null;
    try{if(old)await old.close();}catch(_){}
    if(mediaEl){try{mediaEl.pause();}catch(_){}}
    ptrs.clear();special.clear();globalOn=false;
    const kinds=['break','reese','kalimba','vox'];
    for(let i=0;i<4;i++){const keep=tracks[i].kind===kinds[i]&&tracks[i].buf&&tracks[i].buf.L.length===loopLen(48000)?tracks[i]:null;tracks[i]=newTrack(i,kinds[i]);if(keep){tracks[i].buf=keep.buf;tracks[i].pk=keep.pk;}}
    view=0;scenes=SCENES;song=[{clips:[null,null,null,null],scene:null}];songPlaying=false;pendSong=-1;
    bpm=124;swing=0;stepped=true;playMode='replace';disarmClear();
    Object.assign(prefs,PREF0,{shown:new Set(ALL_FX)});
    snap.order=snap.mute=false;globe.order=globe.mute=false;gval.order=1;gval.mute=0.5;
    st={playing:false,t:0,len:1,tracks:[],hist:[],song:null,recv:0};
    [globeBtn,recBtn,playBtn].forEach(b=>press(b,false));clearBtn.disabled=true;
    bpmEl.querySelector('b').textContent='124';swingEl.querySelector('b').textContent='0%';
    soundSel.value='break';
    if(sessOn){sessOn=false;sessEl.hidden=true;wrap.hidden=false;tabsEl.hidden=false;$('trackbar').hidden=false;}
    setFold(false);
    setMode();
    sheet.hidden=true;paintIcons();renderTabs();requestAnimationFrame(resize);
    (function pre(){let n=0;const nx=()=>{if(n>=4)return;const t=tracks[n++];if(!t.buf){t.buf=buildLoop(t,48000);t.pk=peaks(t.buf);}setTimeout(nx,10);};setTimeout(nx,0);})();
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
    openSheet([dot,(rowId==='center'?'Filter':d.name)+' · '+LET[t.i]],cardEl=>{
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
    // sequence length: the selected sequence is replaced by a blank one of the new length
    const lw=confirmBox();
    const lenR=radios('p-len',[['1','1 bar'],['2','2 bars']],String(prefs.seqLen),v=>{
      const nv=+v,t=T(),c=editClip(t);
      const apply=()=>{prefs.seqLen=nv;sendPref();if(c)blankSequence(t,nv);computeLayout();};
      if(c&&clipBars(c)!==nv)lw.ask('Replace '+seqName(t)+' with a blank '+nv+'-bar sequence?','Replace',apply,()=>{const i=lenR.querySelector('input[value="'+prefs.seqLen+'"]');if(i)i.checked=true;});
      else{lw.hidden=true;apply();}
    });
    cardEl.appendChild(el('div',{},[el('h3',{},['Sequence length']),lenR,lw]));
    // grid and bar length per track; either change deletes that track's sequences, so it asks first
    const gbox=el('div',{className:'opt'});
    tracks.forEach(t=>{
      const row=el('div',{className:'gridrow'}),w=confirmBox();
      let cols=t.colsQ||t.cols,len=t.len16;
      const lab=el('span',{className:'n',textContent:LET[t.i]});lab.style.color=`hsl(${TRACK_HUES[t.i]} 75% 62%)`;
      const out=el('span',{className:'blen'});
      function tryShape(nc,nl){
        if(nc===cols&&nl===len){w.hidden=true;return;}
        const count=t.slots.filter(Boolean).length,go=()=>{cols=nc;len=nl;setShape(t,nc,nl);paint();};
        if(!count){w.hidden=true;go();return;}
        w.ask('This deletes track '+LET[t.i]+'’s '+count+(count>1?' sequences.':' sequence.'),'Change',go);
      }
      const btns=[16,8].map(n=>{const b=el('button',{type:'button',textContent:'1/'+n});b.dataset.n=n;
        b.addEventListener('click',()=>{const st=16/n;tryShape(n,Math.max(st,Math.round(len/st)*st));});return b;});
      const minus=el('button',{type:'button',textContent:'−',title:'Shorter bar'}),plus=el('button',{type:'button',textContent:'+',title:'Longer bar'});
      minus.addEventListener('click',()=>tryShape(cols,Math.max(16/cols,len-16/cols)));
      plus.addEventListener('click',()=>tryShape(cols,Math.min(16,len+16/cols)));
      function paint(){btns.forEach(b=>press(b,+b.dataset.n===cols));out.textContent=(len*cols/16)+' steps';}
      paint();
      row.appendChild(lab);row.appendChild(el('span',{className:'seg'},btns));
      row.appendChild(el('span',{className:'seg blen-ctl'},[minus,out,plus]));
      gbox.appendChild(row);gbox.appendChild(w);
    });
    cardEl.appendChild(el('div',{},[el('h3',{},['Grid and bar length']),gbox]));
    cardEl.appendChild(el('div',{},[el('h3',{},['Silence slider (random side)']),radios('p-silr',[['mute','Mutes steps; the sequence keeps moving'],['insert','Inserts silent steps; the sequence waits']],prefs.silRnd,v=>{prefs.silRnd=v;sendPref();})]));
    cardEl.appendChild(el('div',{},[el('h3',{},['Pattern slider']),radios('p-silp',[['mute','Mutes steps; the sequence keeps moving'],['insert','Inserts silent steps; the sequence waits']],prefs.silPat,v=>{prefs.silPat=v;sendPref();})]));
    cardEl.appendChild(el('div',{},[el('h3',{},['Late touches']),radios('p-grace',[['0','Always wait for the next slice'],['20','Count touches up to 20 ms late as on time'],['40','Count touches up to 40 ms late as on time'],['70','Count touches up to 70 ms late as on time']],String(prefs.grace),v=>{prefs.grace=+v;sendPref();})]));
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
    cardEl.appendChild(el('div',{},[el('h3',{},['Testing']),rb,el('p',{},['Stops playback, shuts down the audio engine and returns every setting, track, sequence and the song to the start.'])]));
  }));
  // ---------- drawing ----------
  function rr(x,y,w,h,r){g.beginPath();if(g.roundRect)g.roundRect(x,y,w,h,r);else g.rect(x,y,w,h);}
  const cellX=(t,a16)=>HW+a16/16*W();
  const stepHue=(t,s)=>{const k=s.fx&&s.fx.length?s.fx[0].k:null;return k?(t.cfg[k]||{}).hue:null;};
  function laneCell(t,s,x,y,w,h,lit,dim,fs,cont){
    g.globalAlpha=dim?0.28:1;
    const hue=s?stepHue(t,s):null;
    g.fillStyle=!s?'#1c1f25':hue!=null?`hsl(${hue} 50% 34%)`:'#3a3f4a';
    g.fillRect(x+(cont?0:1),y,w-(cont?1:2),h);
    if(s&&s.fx&&s.fx.length>1)s.fx.slice(1,4).forEach((f,q)=>{const hh=(t.cfg[f.k]||{}).hue;g.fillStyle=`hsl(${hh} 70% 60%)`;g.fillRect(x+2+q*4,y+h-4,3,3);});
    if(s){
      const step=16/t.cols,sn=Math.floor(s.a/step)+1,half=s.a%step;
      g.fillStyle='rgba(236,231,220,.85)';g.font=`500 ${Math.min(fs,w<20?8:9)}px ${FONT}`;g.textAlign='center';g.textBaseline='middle';
      g.fillText(String(sn)+(half?'+':''),x+w/2,y+h/2+0.5);
    }
    g.globalAlpha=1;
    if(lit){g.strokeStyle=lit==='rec'?'#ff6b6b':lit==='hold'?'#fff':ACC;g.lineWidth=lit==='hold'?2:1.5;g.strokeRect(x+1,y-1,w-2,h+2);}
  }
  // Which steps the silence strip will mute: a pattern is known in advance; random silence is shown
  // from what happened on the last pass.
  function patDim(t,idx,n,L,live){
    const m=muteFrom(mV(t));
    if(m.bits){if(prefs.silPat!=='mute')return false;const o=orderFrom(oV(t));
      if(o.r>0&&!live)return t.lg[idx]===false;
      const bp=live?idx:(o.mode==='back'?(L-1-idx):idx)%n;return !m.bits[bp%8];}
    if(m.rnd>0)return !live&&prefs.silRnd==='mute'&&t.lg[idx]===false;
    return false;
  }
  function drawLane(fs){
    const d=lanePageInfo(),t=d.t,i=info(view),h=laneRows*LROW+4;
    g.fillStyle='#16181d';rr(0,0,LW,h,7);g.fill();
    g.textBaseline='middle';g.textAlign='center';g.font=`600 ${fs}px ${FONT}`;
    g.fillStyle=d.clip?`hsl(${TRACK_HUES[view]} 75% 62%)`:'#6c7380';
    const recNow=d.clip&&(d.clip.rec||d.over);if(recNow)g.fillStyle='#ff6b6b';
    if(recNow&&d.dub)g.fillStyle='#ffb36b';g.fillText(recNow?'REC':seqName(t),LLAB/2,h/2-(d.pages>1?7:0));
    if(d.pages>1){g.font=`400 ${fs-1}px ${FONT}`;g.fillStyle='#8a8f99';g.fillText((d.page+1)+'/'+d.pages,LLAB/2,h/2+7);}
    else if(!d.clip){g.font=`400 ${fs-1}px ${FONT}`;g.fillStyle='#6c7380';g.fillText('live',LLAB/2,h/2+8);}
    const w=(LW-LLAB)/d.n;
    if(d.clip){
      for(let r=0;r<d.rows;r++)for(let j=0;j<d.n;j++){
        const idx=d.page*d.per+r*d.n+j,s=d.slots[idx];if(idx>=d.slots.length)continue;
        const lit=laneHold&&laneHold.idx===idx&&laneHold.clip===d.clip?'hold':st.playing&&idx===d.playIdx,dim=s.on===false||(!d.clip.rec&&patDim(t,idx,d.n,d.slots.length));
        laneCell(t,s,LLAB+j*w,4+r*LROW,w,LROW-5,lit&&(d.clip.rec||d.over)?'rec':lit,dim,fs,(s.off||0)>0);
      }
    }else{
      // live: the current sequence-length window as it plays, which is exactly what Capture prints
      const H=(st.hist||[]),cur=H.length?H[H.length-1]:null,bp=cur?cur.bp:-1,bn=cur?cur.bn:-1,S=prefs.seqLen,w0=bn-((bn%S)+S)%S;
      const at=new Map();if(st.playing)for(const e of H)if(e.bn>=w0)at.set((e.bn-w0)+':'+e.bp,e);
      for(let r=0;r<d.rows;r++)for(let j=0;j<d.n;j++){
        const s=at.get(r+':'+j)||null,now=st.playing&&bn-w0===r&&j===bp;
        laneCell(t,s,LLAB+j*w,4+r*LROW,w,LROW-5,now,s?!s.on:patDim(t,j,d.n,d.n,true),fs,s&&(s.off||0)>0);
      }
    }
  }
  function drawGlobe(cx,cy,r,col){
    g.strokeStyle=col;g.lineWidth=1.2;g.beginPath();g.arc(cx,cy,r,0,Math.PI*2);g.stroke();
    g.beginPath();g.ellipse?g.ellipse(cx,cy,r*0.45,r,0,0,Math.PI*2):g.arc(cx,cy,r*0.45,0,Math.PI*2);g.stroke();
    g.beginPath();g.moveTo(cx-r,cy);g.lineTo(cx+r,cy);g.stroke();
  }
  // Folded: the lane and both strips collapse into one slim bar showing the sequence; tap it to open.
  const foldBtn=$('fold');
  function setFold(on){folded=on;laneCv.hidden=on||sessOn;press(foldBtn,on);foldBtn.innerHTML=on?ICON.unfold:ICON.fold;
    foldBtn.setAttribute('aria-label',on?'Show sequencer and sliders':'Hide sequencer and sliders');foldBtn.title=foldBtn.getAttribute('aria-label');computeLayout();}
  foldBtn.addEventListener('click',()=>setFold(!folded));
  function drawSlim(fs){
    const t=T(),d=lanePageInfo(),i=info(view),h=SLIM;
    g.fillStyle='#1a1d23';rr(0,0,cssW,h,7);g.fill();
    g.textBaseline='middle';g.textAlign='left';g.font=`600 ${fs}px ${FONT}`;
    const recNow=d.clip&&(d.clip.rec||d.over);
    g.fillStyle=recNow?(d.dub?'#ffb36b':'#ff6b6b'):d.clip?`hsl(${TRACK_HUES[view]} 75% 62%)`:'#6c7380';
    g.fillText(recNow?'REC':d.clip?seqName(t):'LIVE',8,h/2+1);
    const o=orderFrom(oV(t)),m=muteFrom(mV(t));
    const tail=(o.r>0?'RND '+Math.round(o.r*100)+'%':o.mode==='back'?'◀ BACK':'FWD ▶')+(m.rnd>0?' · SIL '+Math.round(m.rnd*100)+'%':m.bits?' · PAT':'')+'  ▾';
    g.textAlign='right';g.fillStyle='#8a8f99';g.font=`500 ${fs-1}px ${FONT}`;g.fillText(tail,cssW-8,h/2+1);
    const x0=44,x1=cssW-8-g.measureText(tail).width-10;
    let cells=[],cur=-1;
    if(d.clip){cells=d.slots;cur=st.playing?d.playIdx:-1;}
    else{const H=st.hist||[],e=H.length?H[H.length-1]:null;cells=new Array(d.n).fill(null);if(e&&st.playing){for(let k=0;k<=e.bp;k++){const x=H[H.length-1-(e.bp-k)];if(x&&x.bp===k)cells[k]=x;}cur=e.bp;}}
    const w=(x1-x0)/Math.max(1,cells.length);
    cells.forEach((s,k)=>{const hu=s?stepHue(t,s):null;g.globalAlpha=s&&s.on===false?0.3:1;
      g.fillStyle=!s?'#262a32':hu!=null?`hsl(${hu} 60% 50%)`:'#5a606e';g.fillRect(x0+k*w+0.5,6,Math.max(1,w-1),h-12);
      if(k===cur){g.globalAlpha=1;g.fillStyle=ACC;g.fillRect(x0+k*w+0.5,h-5,Math.max(1,w-1),2);}});
    g.globalAlpha=1;
  }
  function drawStrips(fs){
    const t=T(),sw=SW();let y0=yOrder(),h=STRIP;
    const box=(y,on)=>{g.fillStyle=on?'#3a3120':'#1a1d23';rr(cssW-26,y,26,h,6);g.fill();g.fillStyle=on?ACC:'#6c7380';g.font=`600 ${fs+1}px ${FONT}`;g.textAlign='center';g.fillText('↺',cssW-13,y+h/2+1);};
    const gbox=(x,y,bh,on)=>{g.fillStyle=on?'#1f2a3a':'#1a1d23';rr(x,y,26,bh,6);g.fill();drawGlobe(x+13,y+bh/2,Math.min(7,bh/2-3),on?'#8fc3ff':'#6c7380');};
    const o=orderFrom(oV(t));
    g.fillStyle='#1a1d23';rr(0,y0,sw,h,7);g.fill();
    const grd=g.createLinearGradient(0,0,sw,0);grd.addColorStop(0,ACCA(0));grd.addColorStop(0.5,ACCA(.3));grd.addColorStop(1,ACCA(0));
    g.fillStyle=grd;g.fillRect(sw*0.06,y0,sw*0.88,h);
    g.textBaseline='middle';g.font=`600 ${fs}px ${FONT}`;
    g.textAlign='left';g.fillStyle=o.mode==='back'&&o.r===0?ACC:'#8a8f99';g.fillText('◀ BACK',8,y0+h/2);
    g.textAlign='center';g.fillStyle=o.r>0.5?ACC:'#8a8f99';g.fillText(o.r>0?'RANDOM '+Math.round(o.r*100)+'%':'RANDOM',sw/2,y0+h/2);
    g.textAlign='right';g.fillStyle=o.mode==='fwd'&&o.r===0?ACC:'#8a8f99';g.fillText('FWD ▶',sw-8,y0+h/2);
    g.fillStyle=ACC;rr(oV(t)*sw-2,y0+3,4,h-6,2);g.fill();
    box(y0,snap.order);
    y0=yMute();const mv=mV(t),m=muteFrom(mv),mid=sw/2;
    g.fillStyle='#1a1d23';rr(0,y0,sw,h,7);g.fill();
    if(mv!==0.5){g.fillStyle='rgba(150,170,255,.18)';const a=Math.min(mid,mv*sw),b=Math.max(mid,mv*sw);g.fillRect(a,y0,b-a,h);}
    g.fillStyle='#3a4050';g.fillRect(mid-0.5,y0+4,1,h-8);
    g.textAlign='left';g.font=`600 ${fs}px ${FONT}`;g.fillStyle=m.rnd>0?'#b8c4ff':'#8a8f99';g.fillText(m.rnd>0?'SILENCE '+Math.round(m.rnd*100)+'%':'◀ SILENCE',8,y0+h/2);
    const bits=m.bits||[1,1,1,1,1,1,1,1],bw=Math.max(4,Math.min(9,(mid-100)/8-2));let bx=mid+8;
    // the square for the step now playing glows softly
    const pq=st.playing&&info(view).barPos>=0?info(view).barPos%8:-1;
    for(let q=0;q<8;q++){const now=q===pq;
      g.fillStyle=bits[q]?(m.bits?(now?'#eef1ff':'#b8c4ff'):(now?'#7d86a0':'#4a5060')):(now?'#343a4c':'#23262e');g.fillRect(bx,y0+h/2-bw/2,bw,bw);
      if(!bits[q]){g.strokeStyle=now?'#8a93b0':'#4a5060';g.lineWidth=1;g.strokeRect(bx+0.5,y0+h/2-bw/2+0.5,bw-1,bw-1);}bx+=bw+2;}
    g.textAlign='right';g.fillStyle=m.bits?'#b8c4ff':'#8a8f99';g.fillText('PATTERN ▶',sw-8,y0+h/2);
    g.fillStyle='#b8c4ff';rr(mv*sw-2,y0+3,4,h-6,2);g.fill();
    box(y0,snap.mute);
  }
  function draw(){
    requestAnimationFrame(draw);
    if(sessOn)return;
    g=gridG;g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle=BG;g.fillRect(0,0,cssW,cssH);
    if('letterSpacing' in g)g.letterSpacing='0.06em';
    const t=T(),i=info(view),cols=t.cols,cw=W()/cols,gap=3;
    const unitH=lay.length?Math.min(...lay.filter(r=>!r.thin).map(r=>r.h)):30,fs=unitH<24?9:10;
    const step=16/cols,curSlice=st.playing&&i.src&&!i.rest?Math.floor(i.a/step):-1;
    const E=entriesOf(t);
    const marks=E.map(e=>({fx:e.fx,a:e.a,n:e.n,raw:e.raw,ts:e.ts,hid:e.hid,glob:e.glob,finger:e.finger}));
    const nowHid=i.src==='touch'&&i.sid?i.sid.slice(1,i.sid.indexOf('#')):null;
    const touch=new Set();for(const p of ptrs.values())if(p.live&&p.tr===view&&p.ri>=0)touch.add(p.ri+':'+p.col);
    const glob=new Map();for(const p of ptrs.values())if(p.live&&p.glob&&p.tr===view&&p.fx&&p.fx!=='dry')glob.set(p.fx,p);
    lay.forEach((r,ri)=>{
      const hue=hueOf(t,r.id);
      g.fillStyle='#1a1d23';rr(0,r.y,HW-4,r.h,5);g.fill();
      g.fillStyle=`hsl(${hue} 60% 55%)`;g.fillRect(4,r.y+4,3,r.h-8);
      g.fillStyle='#6c7380';for(let q=0;q<3;q++)g.fillRect(12,r.y+r.h/2-5+q*4,9,1.5);
      if(r.id==='center'){drawCenter(t,i,r,ri,curSlice,marks,touch,glob,cw,gap,fs,nowHid);return;}
      const k=r.id,c=t.cfg[k],d=FX[k],cn=c.cells.filter(n=>d.params[n]),P=cn.length?d.params[cn[0]]:null,pn=cn[0];
      const rm=marks.filter(m=>m.fx===k),gp=glob.get(k);
      for(let col=0;col<cols;col++){
        let l=13,s=16;if(col===curSlice&&!i.fx.length)l+=3;
        if(gp){l=24;s=48;}
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
      if(gp)lines.push({x0:HW+3,x1:cssW-3,raw:gp.raw});
      // a held finger hides its own cell, so its value is also shown as a faint guide across the row
      if(P)for(const m of rm)if(m.finger){const yy=r.y+r.h*(1-rawToRel(t,k,m.raw));g.setLineDash([3,3]);g.strokeStyle=`hsla(${hue} 85% 72% / .55)`;g.lineWidth=1;g.beginPath();g.moveTo(HW,yy);g.lineTo(cssW,yy);g.stroke();g.setLineDash([]);}
      if(P)for(const L of lines){const yy=r.y+r.h*(1-rawToRel(t,k,L.raw));g.strokeStyle=`hsl(${hue} 85% 72%)`;g.lineWidth=1.5;g.beginPath();g.moveTo(L.x0,yy);g.lineTo(L.x1,yy);g.stroke();}
      const latest=gp||(rm.length?rm.reduce((x,y)=>y.ts>x.ts?y:x):null);
      g.textBaseline='middle';const ty=d.tall||cellBip(t,k)?r.y+Math.min(12,r.h*(1-BAND_HI)/2+1):r.y+r.h/2;
      g.font=`600 ${fs}px ${FONT}`;g.textAlign='left';g.fillStyle=latest?`hsl(${hue} 90% 84%)`:`hsl(${hue} 50% 64%)`;
      g.fillText(d.name.toUpperCase()+(gp?' · ALL':''),HW+8,ty);
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
    for(const p of ptrs.values())if(p.tr===view){g.strokeStyle=p.glob?ACCA(.95):'rgba(255,255,255,.85)';g.lineWidth=2;g.beginPath();g.arc(p.x,p.y,17,0,Math.PI*2);g.stroke();}
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
    if(!audible(t)){g.fillStyle='rgba(17,19,23,.5)';g.fillRect(0,0,cssW,cssH);}
  }
  function drawCenter(t,i,r,ri,curSlice,marks,touch,glob,cw,gap,fs,nowHid){
    const cols=t.cols,bot=r.y+r.h,fm=marks.filter(m=>m.fx==='filter'),dm=marks.filter(m=>m.fx==='dry'),gp=glob.get('filter'),fh=t.cfg.filter.hue;
    for(let col=0;col<cols;col++){g.fillStyle=col===curSlice?'#252931':'#1a1d23';rr(HW+col*cw+gap/2,r.y,cw-gap,r.h,6);g.fill();}
    for(const m of dm){const now=nowHid===m.hid;g.fillStyle=now?'#3a3527':'#2a2822';rr(cellX(t,m.a)+gap/2,r.y,m.n/16*W()-gap,r.h,6);g.fill();}
    for(let col=0;col<cols;col++)if(touch.has(ri+':'+col)){g.fillStyle='#343a46';rr(HW+col*cw+gap/2,r.y,cw-gap,r.h,6);g.fill();}
    const fz=(x0,x1,raw,now)=>{const hp=raw>0;g.fillStyle=hp?`hsla(${fh} 85% 60% / ${now?0.36:0.2})`:`hsla(${(fh+160)%360} 85% 60% / ${now?0.36:0.2})`;
      if(hp)g.fillRect(x0,r.y,x1-x0,r.z1-r.y);else g.fillRect(x0,r.z2,x1-x0,bot-r.z2);};
    for(const s of fm)fz(cellX(t,s.a)+gap/2,cellX(t,s.a+s.n)-gap/2,s.raw,nowHid===s.hid);
    if(gp)fz(HW,cssW,gp.raw,true);
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
      const fl=fm.map(m=>({x0:cellX(t,m.a)+gap/2+3,x1:cellX(t,m.a+m.n)-gap/2-3,raw:m.raw}));if(gp)fl.push({x0:HW+3,x1:cssW-3,raw:gp.raw});
      for(const m of fm)if(m.finger){const hp=m.raw>0,yy=hp?r.z1-(r.z1-r.y)*m.raw:r.z2+(bot-r.z2)*(-m.raw);g.setLineDash([3,3]);g.strokeStyle=hp?`hsla(${fh} 90% 72% / .55)`:`hsla(${(fh+160)%360} 90% 72% / .55)`;g.lineWidth=1;g.beginPath();g.moveTo(HW,yy);g.lineTo(cssW,yy);g.stroke();g.setLineDash([]);}
      for(const L of fl){const hp=L.raw>0,yy=hp?r.z1-(r.z1-r.y)*L.raw:r.z2+(bot-r.z2)*(-L.raw);
        g.strokeStyle=hp?`hsl(${fh} 90% 72%)`:`hsl(${(fh+160)%360} 90% 72%)`;g.lineWidth=1.5;g.beginPath();g.moveTo(L.x0,yy);g.lineTo(L.x1,yy);g.stroke();}
    }
    g.setLineDash([2,4]);g.strokeStyle='#8a8f99';g.lineWidth=1;g.beginPath();g.moveTo(HW,r.z1);g.lineTo(cssW,r.z1);g.moveTo(HW,r.z2);g.lineTo(cssW,r.z2);g.stroke();g.setLineDash([]);
    const latest=gp||(fm.length?fm.reduce((x,y)=>y.ts>x.ts?y:x):null),P=FX.filter.params.cut;
    g.textBaseline='middle';g.font=`600 ${fs}px ${FONT}`;g.textAlign='left';
    const yHp=(r.y+r.z1)/2,yLp=(r.z2+bot)/2;
    g.fillStyle=latest&&latest.raw>0?`hsl(${fh} 90% 80%)`:`hsl(${fh} 40% 58%)`;g.fillText('HIGH-PASS ↑'+(gp&&gp.raw>0?' · ALL':''),HW+8,yHp);
    g.fillStyle=latest&&latest.raw<0?`hsl(${(fh+160)%360} 90% 80%)`:`hsl(${(fh+160)%360} 40% 60%)`;g.fillText('LOW-PASS ↓'+(gp&&gp.raw<0?' · ALL':''),HW+8,yLp);
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
  renderTabs();paintIcons();setMode();setFold(false);
  (function pre(){let n=0;const nx=()=>{if(n>=4)return;const t=tracks[n++];if(!t.buf){t.buf=buildLoop(t,48000);t.pk=peaks(t.buf);}setTimeout(nx,10);};setTimeout(nx,0);})();
  requestAnimationFrame(draw);
})();
