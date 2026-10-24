function engineFactory(){
  const DIV=[4,8,16,32,64,128];
  const DT=[1,2,3,4,6,8],DLAB=['1/16','1/8','3/16','1/4','3/8','1/2']; // delay times in sixteenths
  const AUTO=16; // automation points recorded per step in smooth mode
  const step=(v,n)=>Math.min(n-1,Math.max(0,Math.floor(v*n)));
  const semi=v=>v===0?0:Math.sign(v)*Math.min(12,Math.floor(Math.abs(v)*12)+1);
  const stMs=v=>250*Math.pow(8/250,v);
  const rvSec=v=>0.3*Math.pow(30,v);   // reverb decay time (RT60): 0.3 s … 9 s
  const RVL=[1427,1693,1949,2203];      // reverb line lengths at 48 kHz (prime, about 30–46 ms)
  const envMs=v=>3*Math.pow(100,v/0.985);
  const lpHz=v=>18000*Math.pow(180/18000,v), hpHz=v=>25*Math.pow(5000/25,v), crHz=v=>500*Math.pow(32,v);
  const fmtHz=f=>f>=1000?(f/1000).toFixed(f>=10000?0:1)+' kHz':Math.round(f)+' Hz';
  const sgn=v=>(v>0?'+':v<0?'−':'±')+Math.abs(v);
  const pct=v=>Math.round(v*100)+'%';
  const NOTES=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
  const SCALES={chrom:[0,1,2,3,4,5,6,7,8,9,10,11],major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],pmaj:[0,2,4,7,9],pmin:[0,3,5,7,10],oct5:[0,7],oct:[0]};
  const SCALE_CHOICES=[['chrom','Chromatic'],['major','Major'],['minor','Natural minor'],['pmaj','Major pentatonic'],['pmin','Minor pentatonic'],['oct5','Octaves and fifths'],['oct','Octaves'],['custom','Custom']];
  const maskOf=list=>{const m=new Array(12).fill(false);list.forEach(i=>m[i]=true);return m;};
  // Pitch quantised to a scale: the cell's travel is spread over just the allowed notes.
  function scaleNotes(mask,dir){const out=[];for(let s=1;s<=12;s++){const pc=dir>0?s%12:(12-s%12)%12;if(!mask||mask[pc])out.push(dir*s);}return out;}
  function semiQ(v,o){
    const mask=o&&o.mask;if(!mask)return semi(v);
    if(v===0)return 0;const L=scaleNotes(mask,v>0?1:-1);if(!L.length)return 0;
    return L[Math.min(L.length-1,Math.floor(Math.abs(v)*L.length))];
  }
  const semiLab=(v,o)=>{const s=semiQ(v,o);return sgn(s)+' st'+(s?' · '+NOTES[((s%12)+12)%12]:'');};
  // Effect schema. Values are normalised 0..1 (bipolar ones −1..1). `cells` lists the parameters
  // the cell's height controls by default.
  const FX={
    stutter:{name:'Stutter',hue:8,cells:['len'],
      params:{len:{name:'Length',def:0.5,lab:(v,o)=>o&&o.mode==='ms'?Math.round(stMs(v))+' ms':'1/'+DIV[step(v,6)],steps:o=>o&&o.mode==='ms'?0:6}},
      opts:{mode:{name:'Timing',def:'grid',choices:[['grid','Note values'],['ms','Milliseconds']]}}},
    random:{name:'Random slice',hue:44,cells:['chance'],
      params:{chance:{name:'Chance',def:1,lab:pct},
              spread:{name:'Spread',def:1,lab:v=>v>=0.999?'any':'±'+(1+Math.round(v*14))}}},
    pitch:{name:'Pitch',hue:318,cells:['semi'],tall:true,
      opts:{scale:{name:'Scale',def:'oct5',choices:SCALE_CHOICES}},
      params:{semi:{name:'Pitch',def:0,bip:true,lab:semiLab}}},
    reverse:{name:'Reverse',hue:166,cells:[],params:{}},
    env:{name:'Decay',hue:90,cells:['dec'],
      params:{dec:{name:'Decay',def:1,lab:v=>v>=0.985?'full':Math.round(envMs(v))+' ms'}}},
    freeze:{name:'Freeze',hue:190,cells:['semi'],
      opts:{scale:{name:'Scale',def:'chrom',choices:SCALE_CHOICES}},
      params:{semi:{name:'Pitch',def:0,bip:true,lab:semiLab}}},
    crush:{name:'Crush',hue:262,cells:['rate'],
      params:{rate:{name:'Rate',def:0.5,lab:v=>fmtHz(crHz(v))}}},
    // a send: touched steps feed a tempo-synced ping-pong delay whose echoes carry on across later steps
    // Tails: 'ring' lets echoes carry on; 'cut' silences them at the next step without the effect.
    delay:{name:'Delay',hue:130,cells:['send'],
      opts:{tails:{name:'Tails',def:'ring',choices:[['ring','Always ring out'],['cut','Cut at the next step without delay']]}},
      params:{send:{name:'Send',def:1,lab:pct},
              time:{name:'Time',def:(2+0.5)/6,lab:v=>DLAB[step(v,6)]},
              fb:{name:'Feedback',def:0.55,lab:pct}}},
    // a small feedback-delay-network reverb (four lines, Hadamard mixing, damped): the step's dry level and
    // how much of it goes into the reverb (wet); its tail is cut at the next step without reverb by default
    reverb:{name:'Reverb',hue:214,cells:['wet'],
      opts:{tails:{name:'Tails',def:'cut',choices:[['cut','Cut at the next step without reverb'],['ring','Always ring out']]}},
      params:{wet:{name:'Wet',def:1,lab:pct},
              dry:{name:'Dry',def:1,lab:pct},
              size:{name:'Size',def:0.5,lab:v=>rvSec(v).toFixed(1)+' s'},
              tone:{name:'Tone',def:0.6,lab:pct}}},
    filter:{name:'Filter',hue:40,cells:['cut'],
      params:{cut:{name:'Cutoff',def:0,bip:true,lab:v=>v>0?'HP '+fmtHz(hpHz(v)):v<0?'LP '+fmtHz(lpHz(-v)):'off'},
              res:{name:'Resonance',def:0.7,lab:pct}}}
  };
  // Per-track effect settings. A touch stores only its raw cell position; the value it plays is
  // worked out from these settings every time, so changing them changes recorded sequences too.
  function defCfg(k){
    const d=FX[k],c={cells:d.cells.slice(),lo:{},hi:{},x:{},o:{}};
    for(const n in d.params){const P=d.params[n];c.x[n]=P.def;c.lo[n]=P.bip?-1:0;c.hi[n]=1;}
    if(d.opts)for(const n in d.opts)c.o[n]=d.opts[n].def;
    if(c.o.scale)c.o.mask=maskOf(SCALES[c.o.scale]);
    return c;
  }
  function allCfg(){const o={};for(const k in FX)o[k]=defCfg(k);return o;}
  function rowBip(c,k){const P=FX[k].params;for(const n of c.cells)if(P[n]&&P[n].bip)return true;return false;}
  // Unipolar parameters span bottom→top of the cell; bipolar ones grow outward from the centre band.
  function resolveInto(v,c,k,raw){
    const P=FX[k].params,bip=rowBip(c,k);
    for(const n in P){
      if(c.cells.indexOf(n)>=0){
        const lo=c.lo[n],hi=c.hi[n];
        if(P[n].bip)v[n]=raw>0?raw*hi:raw<0?-raw*lo:0;
        else v[n]=bip?lo+(raw+1)/2*(hi-lo):lo+raw*(hi-lo);
      }else v[n]=c.x[n];
    }
    return v;
  }
  const resolve=(c,k,raw)=>resolveInto({},c,k,raw);
  const emptyStep=i=>({empty:true,on:true,a:0,off:0,sid:'E'+i,slen:1,fx:[]});

  const ss=x=>x*x*(3-2*x); // smoothstep: fades without a corner at either end
  // ORDER and SKIP: every slider position is one fixed pattern; nothing about them is random at playback.
  // The far right (v >= DEAD) is the default: forward order, nothing skipped. Moving left, the patterns
  // change more: next to the default zone one or two steps move (or go quiet), at the far left the bar is
  // scrambled (or mostly quiet). There are PATN patterns across the throw, each different.
  const DEAD=0.96,PATN=2048;
  const patIndex=v=>v>=DEAD?-1:Math.min(PATN-1,Math.floor((DEAD-v)/DEAD*PATN));
  function patRng(i,salt){let a=(Math.imul(i+1,0x9E3779B1)^salt)|0;
    return ()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  // a step order for an n-step bar: perm[position] = the step (or loop slice) played there
  function orderPattern(v,n){
    const i=patIndex(v);if(i<0)return null;
    const L=(i+1)/PATN,R=patRng(i,0x0D2E),p=[];for(let j=0;j<n;j++)p.push(j);
    const ops=1+Math.floor(L*L*n*1.5),reach=Math.max(1,Math.round(L*(n-1)));
    for(let o=0,tries=0;o<ops||(tries<8&&p.every((x,j)=>x===j));o++,tries+=o>=ops?1:0){
      const u=R(),a=Math.floor(R()*n),d=1+Math.floor(R()*reach),b=(a+(R()<0.5?-d:d)+4*n)%n;
      if(u<0.15+0.35*L)p[b]=p[a];                                   // a slice repeats
      else if(u<0.85){const x=p[a];p[a]=p[b];p[b]=x;}               // two swap
      else{let lo=Math.min(a,b),hi=Math.max(a,b);while(lo<hi){const x=p[lo];p[lo]=p[hi];p[hi]=x;lo++;hi--;}}   // a run plays backwards
    }
    return p;
  }
  // which steps of an n-step bar play (1) or are skipped (0)
  function skipPattern(v,n){
    const i=patIndex(v);if(i<0)return null;
    const L=(i+1)/PATN,R=patRng(i,0x5C1F),bits=new Array(n).fill(1),m=Math.max(1,Math.round(1+L*(n*0.75-1)));
    const per=Math.max(1,n/16);   // weights favour off-beats near the default, so the first skips feel like a groove
    const w=bits.map((_,j)=>{const q=Math.round(j/per);return q===0?0.05+0.6*L:q%4===0?0.4+0.6*L:q%2===0?1:1.5;});
    for(let k=0;k<m;k++){let tot=0;w.forEach((x,j)=>{if(bits[j])tot+=x;});let r=R()*tot;
      for(let j=0;j<n;j++){if(!bits[j])continue;r-=w[j];if(r<=0){bits[j]=0;break;}}}
    return bits;
  }
  // A-weighting filter (IEC 61672) by the bilinear transform: two 20.6 Hz poles, one 107.7 Hz, one 737.9 Hz and
  // two 12.2 kHz poles, as three biquads. Used only to measure loudness (Crush's compensation).
  function aWeight(sr){
    const T=1/sr,w=f=>2*sr*Math.tan(Math.PI*f/sr),pw=[w(20.598997),w(107.65265),w(737.86223),w(12194.217)];
    // analog H(s) = k·s^4 / ((s+p1)^2 (s+p2)(s+p3)(s+p4)^2); split into (s^2/(s+p1)^2), (s^2/((s+p2)(s+p3))), (1/(s+p4)^2)
    const bl=(b0,b1,b2,a0,a1,a2)=>{const c=2*sr,c2=c*c,A0=a0*c2+a1*c+a2;
      return [(b0*c2+b1*c+b2)/A0,(2*b2-2*b0*c2)/A0,(b0*c2-b1*c+b2)/A0,(2*a2-2*a0*c2)/A0,(a0*c2-a1*c+a2)/A0];};
    const S=[bl(1,0,0,1,2*pw[0],pw[0]*pw[0]),bl(1,0,0,1,pw[1]+pw[2],pw[1]*pw[2]),bl(0,0,1,1,2*pw[3],pw[3]*pw[3])];
    // normalise to 0 dB at 1 kHz
    const at=f=>{const z=Math.PI*2*f/sr;let g=1;for(const q of S){const re=x=>x[0]+x[1]*Math.cos(z)+x[2]*Math.cos(2*z),im=x=>-(x[1]*Math.sin(z)+x[2]*Math.sin(2*z));
      const nr=re(q),ni=im(q),dr=1+q[3]*Math.cos(z)+q[4]*Math.cos(2*z),di=-(q[3]*Math.sin(z)+q[4]*Math.sin(2*z));g*=Math.hypot(nr,ni)/Math.hypot(dr,di);}return g;};
    const k=1/at(1000),st=new Float64Array(6);
    return {run(x){x*=k;for(let i=0;i<3;i++){const q=S[i],y=q[0]*x+st[2*i];st[2*i]=q[1]*x-q[3]*y+st[2*i+1];st[2*i+1]=q[2]*x-q[4]*y;x=y;}return x;},reset(){st.fill(0);}};
  }
  function rdM(b,m,pos){const i=Math.floor(pos),f=pos-i;const a=b[i&m];return a+(b[(i+1)&m]-a)*f;}
  function rdW(b,n,pos){pos=((pos%n)+n)%n;const i=Math.floor(pos),f=pos-i,j=i+1>=n?0:i+1;return b[i]+(b[j]-b[i])*f;}
  function softclip(x){if(!(x<8&&x>-8))return x>=8?1:(x<=-8?-1:0);const a=Math.abs(x);if(a<0.8)return x;return (x<0?-1:1)*(0.8+0.2*Math.tanh((a-0.8)/0.2));}

  // One track: its loop, grid, touches, clip and effect state.
  // At every grid step the track decides what plays: looping touches take turns; otherwise the clip's
  // step (in play order); otherwise the raw loop (in play order). What plays is what gets recorded.
  class Track{
    constructor(E,i){
      this.E=E;this.i=i;this.L=null;this.R=null;this.cols=16;this.sl=0;this.s16=0;this.e16=16;
      this.vol=1;this.muted=false;this.tg=1;this.cfg=allCfg();this.cfgV=0;
      // ORDER and SKIP: the plain loop's own patterns, a clip's stored ones, and a live (unpinned) override
      this.ord={perm:null};this.mute={bits:null};this.muteQ=null;this.ordLive=null;this.muteLive=null;
      this.lp=-1;this.rec=null;this.recW=null;
      this.gate=true;this.gG=1;this.rest=false;
      this.touches=[];this.rotLast=null;this.rotLastO=-1;this.anch=null;
      this.clip=null;this.clipQ=undefined;this.cpos=-1;this.songSilent=false;this.launchNow=null;
      this.hist=[];this.barPos=-1;this.barN=-1;this.bsnap=null;
      this.cur=null;this.tlS=0;this.first=true;this.sidC=0;this.k=0;this.newStep=false;
      this.rp=0;this.rdir=1;this.xp=0;this.xdir=1;this.xf=0;this.xstep=1/96;
      this.dcL=0;this.dcR=0;this.lastL=0;this.lastR=0;
      this.rN=1<<14;this.rm=this.rN-1;this.rL=new Float32Array(this.rN);this.rR=new Float32Array(this.rN);
      this.pPh=0;this.pSem=0;this.pMix=0;this.hadPitch=false;
      this.gr=[];this.gNext=0;this.cAcc=1;this.cl=0;this.cr=0;this.fs=new Float64Array(4);
      // Filter: the resonant peak is level-matched the same way (A-weighted, only ever turned down)
      this.hadFilt=false;this.fEi=0;this.fEo=0;this.fG=1;this.fAi=aWeight(E.sr);this.fAo=aWeight(E.sr);
      // the field: effect settings (cfg) and signal order (rank: effect -> place, top to bottom). A sequence
      // played from the Clips list carries its own (the field it was captured on).
      this.rank=null;
      this.hadCrush=false;this.cEi=0;this.cEo=0;this.cG=1;this.cK=1-Math.exp(-1/(0.08*E.sr));
      this.cAi=aWeight(E.sr);this.cAo=aWeight(E.sr);
      this.dN=1<<17;this.dm=this.dN-1;this.dL=new Float32Array(this.dN);this.dR=new Float32Array(this.dN);this.dW=0;this.dWet=1;
      // reverb: four delay lines (one buffer each, lengths scaled to the rate), two input allpasses
      const rk=E.sr/48000;this.rvLen=RVL.map(x=>Math.round(x*rk));this.rvN=1<<Math.ceil(Math.log2(Math.max(...this.rvLen)+2));this.rvM=this.rvN-1;
      this.rvB=this.rvLen.map(()=>new Float32Array(this.rvN));this.rvLp=new Float64Array(4);this.rvG=new Float64Array(4);this.rvW=0;
      this.apLen=[Math.round(142*rk),Math.round(379*rk)];this.apB=this.apLen.map(n=>new Float32Array(n));this.apI=[0,0];
      this.rSend=0;this.rWet=1;this.rDry=1;this.rDamp=0.5;this.rKey=-1;
      // the loop this track plays: base (from 'load') unless the playing sequence names one of the engine's loops
      this.base=null;
      this.dSend=0;this.dTime=0;this.dFb=0.55;this.dTv=0;this.dlp1=0;this.dlp2=0;
    }
    get ordE(){return this.ordLive||(this.clip&&this.clip.ord)||this.ord;}
    get muteE(){return this.muteLive||(this.clip&&this.clip.mute)||this.mute;}
    // the Random slice effect is the only chance left at playback; capture writes down what it picked
    rnd(){return Math.random();}
    get s(){return Math.round(this.s16*this.cols/16);}
    get e(){return Math.max(this.s+1,Math.round(this.e16*this.cols/16));}
    get n(){return this.e-this.s;}
    setGrid(n){
      const old=this.cols;this.cols=n;
      if(this.E.len)this.sl=Math.floor(this.E.len/n);
      this.tlS=Math.round(this.tlS*n/old);this.clampTl();
      if(this.barPos>=0)this.barPos=Math.round(this.barPos*n/old)%this.n;
    }
    applyGrid(n){
      this.setGrid(n);this.first=true;this.barPos=0;this.cpos=-1;this.hist=[];
      this.E.emit({type:'grid',tr:this.i,n});
    }
    clampTl(){const s=this.s,n=this.n;if(this.tlS<s||this.tlS>=s+n)this.tlS=s+((((this.tlS-s)%n)+n)%n);}
    reset(){
      this.cur=null;this.first=true;this.tlS=this.s;this.rotLast=null;this.anch=null;this.gr.length=0;this.dcL=this.dcR=0;
      this.xf=0;this.rp=-1;this.rdir=1;this.hist=[];this.barPos=-1;this.barN=-1;this.cpos=-1;this.bsnap=null;
      this.lp=-1;this.recW=null;this.dL.fill(0);this.dR.fill(0);this.dSend=0;this.dlp1=this.dlp2=0;this.dWet=1;
      this.rvB.forEach(b=>b.fill(0));this.apB.forEach(b=>b.fill(0));this.rvLp.fill(0);this.rSend=0;this.rWet=1;
    }
    // A sequence may name a loop the engine holds (`loop` key, see 'loopBuf'); otherwise the track's own plays.
    setClip(c){
      this.clip=c||null;this.cfgV++;const b=(c&&c.loop&&this.E.bufs.get(c.loop))||this.base;
      if(b&&b.L.length===this.E.len){this.L=b.L;this.R=b.R;}
    }
    mkE(f){return {k:f.k,raw:f.raw,auto:f.auto||null,tid:f.tid||null,live:null,v:{},o:null,rv:NaN,cv:-1,ref:null};}
    // the raw cell position an effect plays at this moment: recorded automation, a moving finger, or a held value
    raw(e,t,c){
      if(e.auto){const p=(t-c.stepT)*AUTO/this.sl;if(p<=0)return e.auto[0];const i=Math.floor(p);if(i>=AUTO-1)return e.auto[AUTO-1];return e.auto[i]+(e.auto[i+1]-e.auto[i])*(p-i);}
      if(!this.E.stepped&&e.live!=null)return e.live;
      return e.raw;
    }
    res(e,raw){
      if(raw!==e.rv||e.cv!==this.cfgV){const c=this.cfgOf(e.k);resolveInto(e.v,c,e.k,raw);e.o=c.o;e.rv=raw;e.cv=this.cfgV;}
    }
    // effect settings and signal order: the playing sequence's own field, else the track's
    cfgOf(k){const c=this.clip&&this.clip.cfg;return (c&&c[k])||this.cfg[k];}
    get rankE(){return (this.clip&&this.clip.rank)||this.rank;}
    relink(){
      const c=this.cur;if(!c)return;
      for(const e of c.fx){if(!e.tid)continue;const t=this.touches.find(x=>x.id===e.tid);let f=null;
        if(t&&t.fx)for(let j=0;j<t.fx.length;j++)if(t.fx[j].k===e.k){f=t.fx[j];break;}
        e.live=f?f.raw:null;}
    }
    // ORDER: a sequence position plays the step (or loop slice) its pattern names, bar by bar
    mapPos(pos,len){
      const p=this.ordE.perm;if(!p)return pos;
      const n=p.length,j=pos-pos%n+p[pos%n];return j<len?j:pos;
    }
    // touched slices take turns in the order they were pressed
    pickTouch(L){
      const i=L.findIndex(x=>x.id===this.rotLast);
      const nx=i>=0?L[(i+1)%L.length]:(L.find(x=>x.o>this.rotLastO)||L[0]);
      this.rotLast=nx.id;this.rotLastO=nx.o;return nx;
    }
    silenced(){
      const m=this.muteE;
      return {on:!!m.bits&&!m.bits[this.barPos%m.bits.length]};
    }
    snapshot(){
      const c=this.cur;
      return {tlS:this.tlS,lp:this.lp,first:this.first,rotLast:this.rotLast,rotLastO:this.rotLastO,cpos:this.cpos,anch:this.anch,
        hist:this.hist.length,cur:c,left:c?c.left:0,off:c?c.off:0,gate:this.gate,rest:this.rest,hadPitch:this.hadPitch};
    }
    restore(s){
      this.tlS=s.tlS;this.lp=s.lp;this.first=s.first;this.rotLast=s.rotLast;this.rotLastO=s.rotLastO;this.cpos=s.cpos;this.anch=s.anch;
      this.hist.length=Math.min(this.hist.length,s.hist);
      this.cur=s.cur;if(s.cur){s.cur.left=s.left;s.cur.off=s.off;}this.gate=s.gate;this.rest=s.rest;this.hadPitch=s.hadPitch;
    }
    // close off the automation recorded during the step that just ended
    finalize(){
      const c=this.cur;
      if(c&&c.recRefs){
        for(const e of c.fx){const f=e.ref;if(!f)continue;e.ref=null;
          const a=f.auto,last=f.last===undefined?-1:f.last;delete f.last;
          if(last<0){delete f.auto;continue;}
          for(let i=last+1;i<AUTO;i++)a[i]=a[last];
          let flat=true;for(let i=1;i<AUTO;i++)if(Math.abs(a[i]-a[0])>1e-4){flat=false;break;}
          if(flat){f.raw=a[0];delete f.auto;}else f.raw=a[0];
        }
        c.recRefs=false;
      }
      // a step written by recording is handed to the app once it has ended (its automation is complete)
      if(this.recW){const w=this.recW;this.recW=null;this.E.emit({type:'clipStep',tr:this.i,id:w.id,idx:w.idx,bn:w.bn,slot:w.slot});}
    }
    newTake(){const n=this.clip?this.clip.slots.length:this.n;this.take={slots:Array.from({length:n},(_,i)=>emptyStep(i))};}
    boundary(t,k){
      const E=this.E;
      this.finalize();
      this.k=k;
      const n=this.n;
      this.barPos=this.barPos<0?0:(this.barPos+1)%n;
      if(this.barPos===0)this.barN++;
      if(this.launchNow){const L=this.launchNow;this.launchNow=null;this.setClip(L.clip);this.songSilent=L.silent;this.clipQ=undefined;this.cpos=-1;this.barPos=0;}
      if(this.muteQ){this.mute=this.muteQ;this.muteQ=null;}
      const bar=this.barPos===0;
      // a take: the bar that just ended, as recording into a blank sequence would have written it
      if(bar&&this.take&&this.barN>0){const tk=this.take;this.E.emit({type:'take',tr:this.i,bn:this.barN-1,n:tk.slots.length,slots:tk.slots});this.newTake();}
      if(bar&&this.gridQ){const g=this.gridQ;this.gridQ=0;this.applyGrid(g);}
      if(bar&&this.rangeQ){const q=this.rangeQ;this.rangeQ=null;this.s16=q.s16;this.e16=q.e16;this.clampTl();this.first=true;this.cpos=-1;this.hist=[];}
      if(bar&&this.clipQ!==undefined){
        this.setClip(this.clipQ);this.clipQ=undefined;this.cpos=-1;this.songSilent=false;
      }
      this.bsnap=this.snapshot();this.bsnap.t=t;this.bsnap.k=k;
      this.decide(t,k);
    }
    decide(t,k){
      const E=this.E,u=E.u,sl=this.sl,pref=E.pref;
      const c=this.cur;if(c)c.left--;
      const clip=this.clip&&this.clip.slots.length?this.clip:null;
      // Two independent switches decide what touches do:
      //   FX only off: touched slices take turns.      FX only on: the sequence (or loop) keeps its slices.
      //   Replace: each step plays one touch's effect. Combine: every held effect stacks on each step;
      //            when one effect is held twice, the most recent touch's value wins.
      const combine=E.mode==='combine',fxOnly=E.fxOnly;
      const loopT=fxOnly&&combine?[]:this.touches,applied=combine?this.touches.filter(x=>x.fx):[];
      const pre={tlS:this.tlS,lp:this.lp,first:this.first,rotLast:this.rotLast,rotLastO:this.rotLastO,cpos:this.cpos};
      // advance the underlying sequence positions; ORDER maps each position to the step (or slice) it plays
      let slot=null,cIdx=-1;
      if(clip){this.cpos=this.cpos<0?0:(this.cpos+1)%clip.slots.length;cIdx=this.mapPos(this.cpos,clip.slots.length);slot=clip.slots[cIdx];}
      this.lp=this.first||this.lp<0?0:(this.lp+1)%this.n;this.first=false;
      this.tlS=this.s+this.mapPos(this.lp,this.n);
      const cont=c&&c.left>0;
      let base=null;
      if(cont){}
      else if(loopT.length&&!fxOnly){
        const x=this.pickTouch(loopT);
        // Combine: the touched slice plays with the step's own effects, and every held effect stacks on them
        const own=combine&&slot&&!slot.empty?slot.fx||[]:[];
        base={src:'touch',sid:'T'+x.id+'#'+(++this.sidC),a:x.a*u,dur:Math.max(1,Math.round(x.n*u/sl)),slen:x.n*u,fx:x.fx&&!combine?x.fx.map(f=>({tid:x.id,k:f.k,raw:f.raw})):own,off:0,on:true,picked:true};
      }
      else if(this.songSilent){base={src:'rest',sid:'R'+(++this.sidC),a:this.tlS*sl,dur:1,slen:sl,fx:[],off:0,on:false};}
      else if(slot&&slot.empty){
        // an empty step plays the loop's own slice for its position (switched off, or with the preference
        // for touches only, it is silent)
        const pos=this.s+(cIdx%this.n),bg=slot.on===false||pref.fill===false;
        base={src:bg?'rest':'loop',sid:'E'+(++this.sidC),a:pos*sl,dur:1,slen:sl,fx:[],off:0,on:!bg,empty:true};
      }
      else if(slot){
        if(c&&c.src==='clip'&&c.sid===slot.sid&&(slot.off||0)>0&&slot.off===c.off+1){
          c.off=slot.off;base=null;
          for(const f of slot.fx||[]){const e=c.fx.find(x=>x.k===f.k&&!x.tid);if(e){e.auto=f.auto||null;e.raw=f.raw;}}
        }
        else base={src:'clip',sid:slot.sid,a:slot.a*u,dur:1,slen:(slot.slen||1)*sl,fx:slot.fx||[],off:slot.off||0,on:slot.on!==false,clip:true};
      }
      else if(pref.fill===false)base={src:'rest',sid:'L'+(++this.sidC),a:this.tlS*sl,dur:1,slen:sl,fx:[],off:0,on:false,empty:true};
      else base={src:'loop',sid:'L'+(++this.sidC),a:this.tlS*sl,dur:1,slen:sl,fx:[],off:0,on:true};
      // FX only + Replace: the step keeps its slice and takes the next touch's effect in place of its own
      if(base&&fxOnly&&!combine&&loopT.length&&(base.src!=='rest'||base.empty)){
        const x=this.pickTouch(loopT);base.fx=x.fx?x.fx.map(f=>({tid:x.id,k:f.k,raw:f.raw})):[];base.picked=true;
      }
      // SKIP mutes a step in place; as GAP it inserts a rest and the sequence waits. A touched step is
      // never skipped unless the preference says SKIP applies to touches too.
      const touched=!!(base&&base.picked)||applied.length>0;
      const sil=cont||(touched&&pref.touchWin)?{on:false}:this.silenced();
      const insert=sil.on&&((clip&&clip.silPat)||pref.silPat)==='insert';   // a sequence may carry its own SKIP/GAP mode
      if(insert)Object.assign(this,pre);
      this.rest=insert;
      if(base){
        const F=base.fx.map(f=>this.mkE(f));
        const add=x=>{for(const q of x.fx){const f=this.mkE({k:q.k,raw:q.raw,tid:x.id});const j=F.findIndex(e=>e.k===f.k);if(j>=0)F[j]=f;else F.push(f);}};
        applied.forEach(add);
        // signal order: the field's, top to bottom (effects it doesn't hold go last, as they came)
        const rk=this.rankE;if(rk&&F.length>1)F.sort((a,b)=>(a.k in rk?rk[a.k]:99)-(b.k in rk?rk[b.k]:99));
        for(const e of F)this.res(e,e.auto?e.auto[0]:e.raw);
        // FX only + Combine: a held stutter or freeze keeps repeating the slice it began on
        const anc=fxOnly&&applied.find(x=>x.fx.some(f=>f.k==='stutter'||f.k==='freeze'));
        if(anc){if(!this.anch||this.anch.id!==anc.id)this.anch={id:anc.id,a:base.a,slen:base.slen};base.a=this.anch.a;base.slen=this.anch.slen;}
        else this.anch=null;
        const st=F.find(e=>e.k==='stutter');
        if(st){const rep=st.o.mode==='ms'?E.sr*stMs(st.v.len)/1000:E.len/DIV[step(st.v.len,6)];if(!base.clip&&rep>base.dur*sl)base.dur=Math.ceil(rep/sl-1e-6);if(rep>base.slen)base.slen=rep;}
        if(base.empty&&F.length){base.src='clip';base.on=true;}   // an effect played on an empty step makes it heard
        const nc={src:base.src,sid:base.sid,a:base.a,fx:F,left:base.dur,dur:base.dur,slen:base.slen,startT:t-base.off*sl,k0:k-base.off,off:base.off,on:base.on,rPick:-1,fc:base.a,stepT:t,ai:-1,recRefs:false,touched:!!base.picked||applied.length>0};
        if(insert&&base.picked){this.rotLast=pre.rotLast;this.rotLastO=pre.rotLastO;}
        this.cur=nc;this.relink();this.startStep(nc);
        if(!c||c.sid!==nc.sid)this.newStep=true;
      }
      const cc=this.cur;cc.stepT=t;cc.ai=-1;
      this.gate=!insert&&cc.on!==false&&!sil.on;
      this.cIdx=insert?-1:cIdx;
      // what is heard this step, as raw touch data; in smooth mode moving fingers are recorded as automation
      const smooth=!E.stepped;let refs=false;
      const fx=cc.fx.map(e=>{
        const f={k:e.k,raw:e.auto?e.auto[0]:(smooth&&e.live!=null?e.live:e.raw)};
        if(e.auto)f.auto=e.auto;
        else if(smooth&&e.tid){f.auto=new Array(AUTO).fill(f.raw);e.ref=f;refs=true;}
        return f;
      });
      cc.recRefs=refs;
      // pa: the slice actually heard (after a random-slice jump); capture writes it into the step
      this.hist.push({bp:this.barPos,bn:this.barN,ci:this.cIdx,on:this.gate,a:cc.a/u,off:k-cc.k0,sid:cc.sid,slen:cc.slen/sl,fx,
        pa:(cc.rPick>=0?cc.rPick:cc.a)/u,tch:!insert&&!!cc.touched});
      if(this.hist.length>96)this.hist.splice(0,32);
      // Recording writes the steps you touch into the sequence, in place; untouched steps are left alone.
      //   FX only off: the step becomes what was heard (slice, on/off, effects).
      //   FX only on:  the step keeps its slice and on/off and takes the effects heard (an empty step
      //                becomes its loop slice).
      // a take keeps each bar's touched steps apart from the sequence (the game: 16 bars, 16 clips)
      const tk=this.take;
      if(tk&&this.cIdx>=0&&this.cIdx<tk.slots.length&&!insert){
        tk.slots[this.cIdx]=cc.touched?{on:cc.on!==false,a:cc.a/u,off:k-cc.k0,sid:cc.sid,slen:cc.slen/sl,fx}:emptyStep(this.cIdx);
      }
      const r=this.rec;
      if(r&&clip&&clip.id===r.id&&this.cIdx>=0&&!insert&&cc.touched){
        const old=clip.slots[this.cIdx],u2=cc.a/u;
        const s=fxOnly?Object.assign({},old.empty?{on:true,a:u2,off:0,sid:'X'+(++this.sidC),slen:1}:old,{fx}):
          {on:cc.on!==false,a:u2,off:k-cc.k0,sid:cc.sid,slen:cc.slen/sl,fx};
        delete s.empty;
        this.recW={id:r.id,idx:this.cIdx,bn:this.barN,slot:s,old};clip.slots[this.cIdx]=s;
      }
    }
    // A touch (or a release) that lands just after a step started counts for that step: the step is decided
    // again as if it had been on time. Its slice keeps its place in time, so nothing restarts. The window is
    // the grace time plus the device's output latency (the step was heard that much later than it was made).
    regrace(){
      const E=this.E,b=this.bsnap;
      if(!b||!E.playing||E.pref.grace<=0)return;
      if(E.t-b.t>(E.pref.grace+(E.pref.lat||0))*E.sr/1000||E.t<b.t)return;
      if(b.cur&&b.left>1)return;
      if(this.recW){const w=this.recW;this.recW=null;if(this.clip&&this.clip.id===w.id)this.clip.slots[w.idx]=w.old;}
      this.restore(b);this.decide(b.t,b.k);
    }
    startStep(c){
      let pitch=false,crush=false,filt=false;
      for(const e of c.fx){
        if(e.k==='stutter'&&e.o.mode==='ms')e.rep=Math.max(64,Math.round(this.E.sr*stMs(e.v.len)/1000));
        else if(e.k==='random'){
          if(this.rnd()<e.v.chance){
            const s=this.s,n=this.n,base=Math.round(c.a/this.sl),sp=e.v.spread>=0.999?n:1+Math.round(e.v.spread*14);
            let p=base;for(let tries=0;tries<6&&p===base;tries++)p=sp>=n?s+Math.floor(this.rnd()*n):s+((((base-s+Math.round((this.rnd()*2-1)*sp))%n)+n)%n);
            c.rPick=p*this.sl;
          }
        }
        else if(e.k==='pitch'){pitch=true;if(!this.hadPitch){const s0=semiQ(e.v.semi,e.o);this.pSem=s0;this.pMix=s0!==0?1:0;}}
        else if(e.k==='crush'){this.cAcc=1;if(!this.hadCrush){this.cEi=this.cEo=0;this.cG=1;this.cAi.reset();this.cAo.reset();}crush=true;}
        else if(e.k==='filter'){if(!this.hadFilt){this.fEi=this.fEo=0;this.fG=1;this.fAi.reset();this.fAo.reset();}filt=true;}
      }
      c.fc=c.rPick>=0?c.rPick:c.a;
      this.hadPitch=pitch;this.hadCrush=crush;this.hadFilt=filt;
    }
    render(oL,oR,i0,i1,t0,swing){
      if(!this.L||!this.sl||this.L.length!==this.E.len)return;
      const E=this.E,len=E.len,L=this.L,R=this.R,sr=E.sr,rm=this.rm,sl=this.sl,pair=2*sl,split=Math.round(sl*(1+swing));
      // With swing, a slice ends before the next (delayed) step starts, so the gap is faded in and out
      // more gently: the fades grow with the swing amount (out up to 7.5 ms, in up to 4.5 ms at 50%).
      const FD=E.fd,FO=swing>0?Math.round(FD+swing*0.012*sr):FD,FI=swing>0?Math.round(FD+swing*0.006*sr):FD,swung=swing>0;
      for(let i=i0;i<i1;i++){
        const t=t0+i,m=t%pair;
        if(m===0)this.boundary(t,Math.floor(t/pair)*2);
        else if(m===split)this.boundary(t,Math.floor(t/pair)*2+1);
        const c=this.cur;if(!c)continue;
        const el=t-c.startT,F=c.fx;
        for(let j=0;j<F.length;j++){const e=F[j];this.res(e,this.raw(e,t,c));}
        if(c.recRefs){const ai=Math.floor((t-c.stepT)*AUTO/sl);
          if(ai!==c.ai&&ai>=0&&ai<AUTO){c.ai=ai;for(let j=0;j<F.length;j++){const e=F[j];if(e.ref){e.ref.auto[ai]=e.live!=null?e.live:e.raw;e.ref.last=ai;}}}}
        let tau=el,dir=1,rnd=false,frz=null,rg=1,stRep=0;
        for(let j=F.length-1;j>=0;j--){
          const e=F[j];
          switch(e.k){
            case 'stutter':{
              let rep;
              if(e.o.mode==='ms'){if(el>0&&el%e.rep===0)e.rep=Math.max(64,Math.round(sr*stMs(e.v.len)/1000));rep=e.rep;}
              else rep=len/DIV[step(e.v.len,6)];
              const ri=Math.floor(tau/rep);tau-=ri*rep;stRep=rep;
              // a tiny fade at each repeat's edges
              if(rep>4*FD){const a=tau<FD?tau/FD:rep-tau<FD?(rep-tau)/FD:1;rg*=a;}
              break;}
            case 'reverse':{const ch=Math.max(64,Math.round(c.slen)),c0=Math.floor(tau/ch)*ch;tau=c0+ch-1-(tau-c0);dir=-dir;break;}
            case 'random':rnd=true;break;
            case 'freeze':frz=e;break;
          }
        }
        const envT=stRep&&!frz?el%stRep:el;
        let l,r;
        if(frz){
          const v=frz.v,glen=Math.round(0.0303*sr);
          if(--this.gNext<=0){
            this.gNext=Math.max(16,Math.round(glen/12));
            this.gr.push({s:c.fc+Math.random()*0.02*sr,k:0,n:glen,r:Math.pow(2,semiQ(v.semi,frz.o)/12)});
          }
          let fl=0,fr=0;
          for(let j=this.gr.length-1;j>=0;j--){
            const gg=this.gr[j],w=0.5-0.5*Math.cos(6.283185307*gg.k/gg.n),pp=gg.s+gg.k*gg.r;
            fl+=rdW(L,len,pp)*w;fr+=rdW(R,len,pp)*w;
            if(++gg.k>=gg.n)this.gr.splice(j,1);
          }
          l=fl*0.38;r=fr*0.38;   // level-matched to the dry slice (was 0.28, about 3 dB quieter)this.rp=Math.floor(c.fc)%len;this.rdir=1;
        }else{
          let srcPos=(rnd&&c.rPick>=0?c.rPick:c.a)+tau;
          srcPos=((srcPos%len)+len)%len;
          let ex=this.rp+this.rdir;ex=ex<0?ex+len:ex>=len?ex-len:ex;
          if(srcPos!==ex){this.xp=ex;this.xdir=this.rdir;this.xf=1;}
          l=L[srcPos];r=R[srcPos];
          if(this.xf>0){
            const a=this.xf;l+=(L[this.xp]-l)*a;r+=(R[this.xp]-r)*a;
            let nx=this.xp+this.xdir;this.xp=nx<0?nx+len:nx>=len?nx-len:nx;this.xf-=this.xstep;
          }
          this.rp=srcPos;this.rdir=dir;
        }
        // past the slice end: silent (its edge fade has already reached zero); a plain loop step fades out
        if(!frz&&el>=c.slen){if(c.src!=='loop'||swung)rg=0;else{const f=1-(el-c.slen)/96;rg*=f>0?f:0;}}
        if(c.src!=='loop'||swung){
          const toNext=m<split?split-m:pair-m;
          if(c.left<=1&&toNext<=FO){rg*=ss(toNext/FO);this.fadeAt=t+toNext;}
          if(!frz&&c.slen-el<=FO&&c.slen-el>0)rg*=ss((c.slen-el)/FO);
        }
        // after a faded ending, the next step fades in
        const se=t-c.stepT;if(se<FI&&c.stepT===this.fadeAt)rg*=ss(se/FI);
        l*=rg;r*=rg;
        let ring=false;
        for(let j=0;j<F.length;j++){
          const e=F[j],k=e.k,v=e.v;
          if(k==='pitch'){
            this.rL[t&rm]=l;this.rR[t&rm]=r;ring=true;
            const tg=semiQ(v.semi,e.o);this.pSem+=(tg-this.pSem)*0.0015;
            this.pMix+=((tg!==0?1:0)-this.pMix)*0.004;
            if(this.pMix>1e-4){
              const Wn=Math.round(0.03*sr),ratio=Math.pow(2,this.pSem/12);
              this.pPh+=(1-ratio)/Wn;this.pPh-=Math.floor(this.pPh);
              const p1=this.pPh,p2=(p1+0.5)%1,g1=1-Math.abs(2*p1-1),g2=1-g1,d1=t-1-p1*Wn,d2=t-1-p2*Wn;
              const a1=rdM(this.rL,rm,d1)*g1+rdM(this.rL,rm,d2)*g2,a2=rdM(this.rR,rm,d1)*g1+rdM(this.rR,rm,d2)*g2;
              l+=(a1-l)*this.pMix;r+=(a2-r)*this.pMix;
            }
          }
          else if(k==='env'){
            if(v.dec<0.985){const g=Math.exp(-envT/(envMs(v.dec)*sr/1000))*(envT<32?envT/32:1);l*=g;r*=g;}
          }
          else if(k==='crush'){
            e.sr_=e.sr_===undefined?v.rate:e.sr_+(v.rate-e.sr_)*0.002;
            this.cAcc+=crHz(e.sr_)/sr;
            if(this.cAcc>=1){this.cAcc-=Math.floor(this.cAcc);this.cl=l;this.cr=r;}
            // Loudness compensation: the aliasing moves energy to where the ear is most sensitive, so the
            // input and output are compared A-weighted (about 80 ms envelopes) and the output is only ever
            // turned down to match.
            const pi=this.cAi.run(l+r),po=this.cAo.run(this.cl+this.cr);
            this.cEi+=(pi*pi-this.cEi)*this.cK;this.cEo+=(po*po-this.cEo)*this.cK;
            const cg=this.cEo>this.cEi+1e-12?Math.max(0.3,Math.sqrt(this.cEi/this.cEo)):1;
            this.cG+=(cg-this.cG)*0.003;
            l=this.cl*this.cG;r=this.cr*this.cG;
          }
          else if(k==='filter'){
            e.sc=e.sc===undefined?v.cut:e.sc+(v.cut-e.sc)*0.002;
            const pp=e.sc;if(Math.abs(pp)<1e-4)continue;
            const hp=pp>0,fc=Math.min(hp?hpHz(pp):lpHz(-pp),sr*0.45);
            const g=Math.tan(Math.PI*fc/sr),kk=2-1.9*v.res,a1=1/(1+g*(g+kk)),a2=g*a1,a3=g*a2,s=this.fs;
            let v3=l-s[1],v1=a1*s[0]+a2*v3,v2=s[1]+a2*s[0]+a3*v3;s[0]=2*v1-s[0];s[1]=2*v2-s[1];
            const yl=hp?l-kk*v1-v2:v2;
            v3=r-s[3];v1=a1*s[2]+a2*v3;v2=s[3]+a2*s[2]+a3*v3;s[2]=2*v1-s[2];s[3]=2*v2-s[3];
            const yr=hp?r-kk*v1-v2:v2;
            // Level-matching: the resonant peak can make the step louder than it went in. Input and output are
            // compared A-weighted (80 ms) and the output only ever turned down (a plain cut never is).
            const fi=this.fAi.run(l+r),fo=this.fAo.run(yl+yr);
            this.fEi+=(fi*fi-this.fEi)*this.cK;this.fEo+=(fo*fo-this.fEo)*this.cK;
            const fg=this.fEo>this.fEi+1e-12?Math.max(0.3,Math.sqrt(this.fEi/this.fEo)):1;   // (silence in, silence out: no change)
            this.fG+=(fg-this.fG)*0.003;
            l=yl*this.fG;r=yr*this.fG;
          }
        }
        if(!ring){this.rL[t&rm]=l;this.rR[t&rm]=r;}
        this.gG+=((this.gate?1:0)-this.gG)*0.01;
        this.tg+=((this.muted?0:1)-this.tg)*0.003;
        let ol=l*this.gG,or=r*this.gG;
        if(ol!==ol||or!==or){ol=or=0;this.lastL=this.lastR=this.dcL=this.dcR=0;this.fs.fill(0);this.dL.fill(0);this.dR.fill(0);this.dlp1=this.dlp2=0;this.rvB.forEach(b=>b.fill(0));this.apB.forEach(b=>b.fill(0));this.rvLp.fill(0);this.cl=this.cr=0;this.xf=0;this.pMix=0;this.gr.length=0;this.rL.fill(0);this.rR.fill(0);}
        if(this.newStep){this.newStep=false;this.dcL=this.lastL-ol;this.dcR=this.lastR-or;}
        ol+=this.dcL;or+=this.dcR;this.dcL*=0.992;this.dcR*=0.992;
        this.lastL=ol;this.lastR=or;
        // delay send: ping-pong, darkened a little on each repeat; the tail keeps going after the step ends
        // With tails set to cut, a step without the effect fades its echoes out in a few ms and stops
        // feeding them back, so the buffer empties and nothing old comes back with the next delayed step.
        const dry=ol+or;
        let rv=null;for(let j=0;j<F.length;j++)if(F[j].k==='reverb'){rv=F[j].v;break;}
        this.rDry+=((rv?rv.dry:1)-this.rDry)*0.004;ol*=this.rDry;or*=this.rDry;   // reverb's dry level: the step itself, before any echoes
        {let dv=null;for(let j=0;j<F.length;j++)if(F[j].k==='delay'){dv=F[j].v;break;}
          if(dv){this.dTv=len*DT[step(dv.time,6)]/16;this.dFb=Math.min(0.95,dv.fb);}
          this.dSend+=((dv&&this.gate?dv.send:0)-this.dSend)*0.004;
          const cut=!dv&&this.cfgOf('delay').o.tails==='cut';this.dWet+=((cut?0:1)-this.dWet)*0.005;
          if(this.dTv>0){
            if(this.dTime<=0)this.dTime=this.dTv;else this.dTime+=(this.dTv-this.dTime)*0.0005;
            const w=this.dW,dm=this.dm,rp=w-this.dTime,wl=rdM(this.dL,dm,rp),wr=rdM(this.dR,dm,rp),fb=cut?0:this.dFb;
            this.dlp1+=(wl-this.dlp1)*0.35;this.dlp2+=(wr-this.dlp2)*0.35;
            this.dL[w&dm]=dry*0.5*this.dSend+this.dlp2*fb;this.dR[w&dm]=this.dlp1*fb;this.dW=(w+1)&dm;
            ol+=wl*this.dWet;or+=wr*this.dWet;
          }}
        // reverb send: a four-line feedback delay network after two diffusing allpasses
        {if(rv){const key=rv.size*1000+rv.tone;if(key!==this.rKey){this.rKey=key;const T60=rvSec(rv.size)*sr;
            for(let q=0;q<4;q++)this.rvG[q]=Math.pow(10,-3*this.rvLen[q]/T60);this.rDamp=0.12+0.85*rv.tone;}}
          this.rSend+=((rv&&this.gate?rv.wet:0)-this.rSend)*0.004;
          const cut=!rv&&this.cfgOf('reverb').o.tails==='cut';this.rWet+=((cut?0:1)-this.rWet)*0.005;
          let x=dry*0.5*this.rSend;
          for(let q=0;q<2;q++){const b=this.apB[q],i=this.apI[q],d=b[i],y=d-0.6*x;b[i]=x+0.6*y;this.apI[q]=i+1>=b.length?0:i+1;x=y;}
          const B=this.rvB,M=this.rvM,w=this.rvW,lp=this.rvLp,dmp=this.rDamp;
          for(let q=0;q<4;q++){lp[q]+=(B[q][(w-this.rvLen[q])&M]-lp[q])*dmp;}
          const a=lp[0],b=lp[1],c=lp[2],d=lp[3],fk=cut?0:0.5;
          B[0][w]=x+(a+b+c+d)*fk*this.rvG[0];B[1][w]=x+(a-b+c-d)*fk*this.rvG[1];
          B[2][w]=x+(a+b-c-d)*fk*this.rvG[2];B[3][w]=x+(a-b-c+d)*fk*this.rvG[3];this.rvW=(w+1)&M;
          ol+=(a+c)*0.45*this.rWet;or+=(b+d)*0.45*this.rWet;
        }
        const gv=this.vol*this.tg;oL[i]+=ol*gv;oR[i]+=or*gv;
      }
    }
    info(){
      const c=this.cur,u=this.E.u;
      return {cols:this.cols,n:this.n,s:this.s,barPos:this.barPos,barN:this.barN,src:c?c.src:null,sid:c?c.sid:null,a:c?c.a/u:0,rest:this.rest,
        pos:this.rp/u,fx:c?c.fx.map(e=>e.k):[],gate:this.gate,clipId:this.clip?this.clip.id:null,cIdx:this.cIdx,
        clipQ:this.clipQ===undefined?undefined:(this.clipQ?this.clipQ.id:null),songSilent:this.songSilent,
        lp:this.lp};
    }
  }

  class Engine{
    // nTracks: the app uses one; more are kept possible for hosts that run several side by side
    constructor(sr,nTracks){
      this.sr=sr;this.len=0;this.u=0;this.t=0;this.playing=false;this.g=0;this.swing=0;this.stepped=false;
      this.pref={silPat:'mute',grace:40,lat:0,touchWin:true,fill:true};this.mode='replace';this.fxOnly=false;this.fd=Math.round(0.0015*sr);
      this.tracks=Array.from({length:nTracks||1},(_,i)=>new Track(this,i));this.view=0;this.song=null;
      this.bufs=new Map();
      this.sc=0;this.post=null;this.vol=1;this.mixL=null;this.mixR=null;this.peak=0;
      // safety limiter (untouched audio passes at unity): 1.5 ms look-ahead, ceiling −1 dBFS, 80 ms release
      this.LA=Math.max(1,Math.round(0.0015*sr));this.laL=new Float32Array(this.LA);this.laR=new Float32Array(this.LA);this.laI=0;
      this.lg=1;this.lSlope=0;this.lFloor=1;this.lHold=0;this.lRel=1-Math.exp(-1/(0.08*sr));this.ceil=Math.pow(10,-1/20);this.lim=0;
      // the last 8 bars of output, for "export what you just heard"
      this.ringL=null;this.ringR=null;
    }
    emit(m){if(this.post)this.post(m);}
    start(){this.t=0;this.playing=true;for(const tr of this.tracks)tr.reset();}
    stop(){this.playing=false;this.song=null;for(const tr of this.tracks){tr.gridQ=0;tr.finalize();tr.songSilent=false;tr.launchNow=null;}}
    msg(d){
      const T=d.tr!==undefined?this.tracks[d.tr]:null;
      switch(d.type){
        case 'loadAll':{d.bufs.forEach((b,i)=>{if(b&&this.tracks[i]){this.tracks[i].L=b.L;this.tracks[i].R=b.R;}});this.msg({type:'load',tr:0,L:d.bufs[0]?d.bufs[0].L:this.tracks[0].L,R:d.bufs[0]?d.bufs[0].R:this.tracks[0].R});break;}
        case 'load':{
          const old=this.len;T.base={L:d.L,R:d.R};
          if(!(T.clip&&T.clip.loop&&this.bufs.has(T.clip.loop))){T.L=d.L;T.R=d.R;}
          if(d.L.length!==this.len){
            this.len=d.L.length;this.u=Math.floor(this.len/16);
            if(old){const k=this.len/old;this.t=Math.round(this.t*k);if(this.song)this.song.nextT=Math.round(this.song.nextT*k);
              for(const tr of this.tracks){if(tr.cur){tr.cur.startT=Math.round(tr.cur.startT*k);tr.cur.stepT=Math.round(tr.cur.stepT*k);tr.cur.a=Math.round(tr.cur.a*k);tr.cur.fc=Math.round(tr.cur.fc*k);if(tr.cur.rPick>=0)tr.cur.rPick=Math.round(tr.cur.rPick*k);tr.cur.slen*=k;}tr.bsnap=null;}}
          }
          for(const tr of this.tracks)tr.sl=Math.floor(this.len/tr.cols);
          if(!this.ringL||this.ringL.length!==8*this.len){this.ringL=new Float32Array(8*this.len);this.ringR=new Float32Array(8*this.len);}
          break;}
        // a loop sequences can name by key (the Clips list plays clips made on different loops)
        case 'loopBuf':this.bufs.set(d.key,{L:d.L,R:d.R});for(const tr of this.tracks)if(tr.clip&&tr.clip.loop===d.key)tr.setClip(tr.clip);break;
        case 'play':if(!this.playing)this.start();break;
        case 'stop':this.stop();break;
        // a touch's fx: the effects its cell (or overlapping cells) drive, [{k, raw}], or null for a dry touch
        case 'touches':{T.touches=(d.list||[]).map(x=>x.fx&&!Array.isArray(x.fx)?Object.assign({},x,{fx:[x.fx]}):x.fx&&!x.fx.length?Object.assign({},x,{fx:null}):x);
          T.relink();const sig=T.touches.map(x=>x.id+':'+x.a+':'+(x.fx?x.fx.map(f=>f.k).join('+'):'-')).join();if(sig!==T.tsig){T.tsig=sig;T.regrace();}break;}
        case 'cfg':T.cfg=Object.assign({},T.cfg,d.cfg);T.cfgV++;break;
        // the field's signal order, top to bottom: [effect keys]
        case 'field':{const r={};(d.order||[]).forEach((k,i)=>{r[k]=i;});T.rank=d.order?r:null;break;}
        case 'grid':if(this.playing&&d.q){T.gridQ=d.n;}else{T.gridQ=0;T.applyGrid(d.n);}T.bsnap=null;break;
        case 'range':if(this.playing&&d.q)T.rangeQ={s16:d.s16,e16:d.e16};else{T.rangeQ=null;T.s16=d.s16;T.e16=d.e16;T.clampTl();if(T.barPos>=T.n)T.barPos%=T.n;}T.bsnap=null;break;
        case 'mode':this.mode=d.mode==='combine'?'combine':'replace';break;
        case 'fxonly':this.fxOnly=!!d.on;break;
        // patterns come from orderPattern / skipPattern (the app sends them with the slider position)
        case 'order':T.ord={perm:d.perm||null};break;
        case 'mute':T.muteQ={bits:d.bits||null};break;
        case 'live':if('ord' in d)T.ordLive=d.ord||null;if('mute' in d)T.muteLive=d.mute||null;break;
        case 'grab':{   // the last `bars` whole bars that played, ending at the most recent bar line
          if(!this.ringL||!this.len)break;const N=this.ringL.length,end=Math.floor(this.t/this.len)*this.len,
            n=Math.min(d.bars*this.len,end,N),L=new Float32Array(n),R=new Float32Array(n);
          for(let i=0;i<n;i++){const j=((end-n+i)%N+N)%N;L[i]=this.ringL[j];R[i]=this.ringR[j];}
          this.emit({type:'grabbed',L,R,sr:this.sr,id:d.id});break;}
        case 'tmute':T.muted=!!d.on;break;
        case 'tvol':T.vol=Math.max(0,Math.min(2,d.v));break;
        case 'swing':this.swing=Math.max(0,Math.min(0.5,d.s||0));break;
        case 'stepped':this.stepped=!!d.on;break;
        case 'pref':Object.assign(this.pref,d.pref);break;
        case 'view':this.view=d.tr;break;
        // Launching a sequence never starts playback. While playing it takes over at the next bar line, or
        // at once with now:true (a blank sequence made from the plain loop picks up where the loop is).
        case 'launch':{
          if(!this.playing||d.now){T.setClip(d.clip);T.clipQ=undefined;T.songSilent=false;if(d.now&&this.playing)T.cpos=T.lp;}
          else T.clipQ=d.clip||null;
          this.song=null;
          break;}
        // record: touched steps are written into the sequence with this id while it plays
        case 'rec':T.rec=d.on&&d.id?{id:d.id}:null;break;
        // take: from the next bar line, each bar's touched steps are handed over (as 'take') when it ends
        case 'take':if(d.on)T.newTake();else T.take=null;break;
        case 'clipEdit':{for(const tr of this.tracks){if(tr.clip&&tr.clip.id===d.clip.id)tr.clip=d.clip;if(tr.clipQ&&tr.clipQ.id===d.clip.id)tr.clipQ=d.clip;}
          if(this.song)for(const row of this.song.rows)row.clips=row.clips.map(c=>c&&c.id===d.clip.id?d.clip:c);break;}
        case 'song':{
          const rows=d.rows||[];
          if(!rows.length){this.song=null;break;}
          // once: play to the end of the list, then stop (from past the end: stop at the next bar line)
          const first=Math.max(0,Math.min(rows.length,d.from||0)),once=!!d.once;
          if(!this.playing){this.start();this.song={rows,idx:Math.min(first,rows.length-1)-1,nextT:0,once};}
          else this.song={rows,idx:first-1,nextT:Math.ceil(this.t/this.len)*this.len,once};
          break;}
        // new rows for the list while it plays; idx: the row now playing in the new list (−1: none, so the
        // first row is next); once (optional): whether it stops after the last row
        case 'songRows':{if(this.song){this.song.rows=d.rows;if(d.idx!=null)this.song.idx=d.idx;if(d.once!=null)this.song.once=!!d.once;if(this.song.idx>=d.rows.length)this.song.idx=d.rows.length-1;}break;}
        case 'songStop':{if(this.song){this.song=null;for(const tr of this.tracks){tr.clipQ=null;}}break;}
      }
    }
    songStep(){
      const S=this.song;
      if(S.once&&S.idx+1>=S.rows.length){this.stop();this.emit({type:'songEnd'});return;}
      S.idx=(S.idx+1)%S.rows.length;const row=S.rows[S.idx];
      this.tracks.forEach((tr,i)=>{const c=(row.clips&&row.clips[i])||null;tr.launchNow={clip:c,silent:!c};});
      S.nextT+=Math.max(1,row.bars)*this.len;
      this.emit({type:'songRow',idx:S.idx});
    }
    render(oL,oR,n){
      if(!this.len||(!this.playing&&this.g<=0)){oL.fill(0);if(oR!==oL)oR.fill(0);this.status(n);return;}
      if(!this.mixL||this.mixL.length<n){this.mixL=new Float32Array(n);this.mixR=new Float32Array(n);}
      const mL=this.mixL,mR=this.mixR;mL.fill(0,0,n);mR.fill(0,0,n);
      let i=0;
      while(i<n){
        let end=n;
        if(this.song&&this.playing){
          const at=this.song.nextT-this.t;
          if(at<=i){this.songStep();continue;}
          if(at<n)end=at;
        }
        for(const tr of this.tracks)tr.render(mL,mR,i,end,this.t,this.swing);
        i=end;
      }
      const gs=1/(0.004*this.sr);
      for(let j=0;j<n;j++){
        if(this.playing){if(this.g<1)this.g=Math.min(1,this.g+gs);}else if(this.g>0)this.g=Math.max(0,this.g-gs);
        const xl=mL[j]*this.g*this.vol,xr=mR[j]*this.g*this.vol;
        // look-ahead limiter: the gain ramps down early enough to meet each peak exactly when it comes out
        const pk=Math.max(xl<0?-xl:xl,xr<0?-xr:xr),req=pk>this.ceil?this.ceil/pk:1;
        if(req<1){if(req<this.lFloor){this.lFloor=req;this.lSlope=Math.max(this.lSlope,(this.lg-req)/this.LA);}this.lHold=Math.max(this.lHold,this.LA+32);}
        if(this.lg>this.lFloor){this.lg-=this.lSlope;if(this.lg<=this.lFloor){this.lg=this.lFloor;this.lSlope=0;}}
        else if(this.lHold>0)this.lHold--;
        else{this.lg+=(1-this.lg)*this.lRel;this.lFloor=this.lg;this.lSlope=0;}
        const li=this.laI,dl=this.laL[li],dr=this.laR[li];this.laL[li]=xl;this.laR[li]=xr;this.laI=li+1>=this.LA?0:li+1;
        let yl=dl*this.lg,yr=dr*this.lg;yl=yl>1?1:yl<-1?-1:yl;yr=yr>1?1:yr<-1?-1:yr;
        if(this.lg<0.999)this.lim=1;
        oL[j]=yl;oR[j]=yr;const a=Math.max(yl<0?-yl:yl,yr<0?-yr:yr);if(a>this.peak)this.peak=a;
        if(this.ringL&&this.playing){const N=this.ringL.length,q=(this.t+j)%N;this.ringL[q]=yl;this.ringR[q]=yr;}
      }
      this.t+=n;
      this.status(n);
    }
    status(n){
      this.sc+=n;if(this.sc<768)return;this.sc=0;
      if(!this.post)return;
      const v=this.tracks[this.view];
      const lvl=this.peak,lim=this.lim;this.peak=0;this.lim=0;
      this.post({type:'status',lvl,lim,playing:this.playing,t:this.t,len:this.len,tracks:this.tracks.map(tr=>tr.info()),
        hist:v.hist.slice(-Math.min(64,v.n*2+2)),song:this.song?{idx:this.song.idx,left:(this.song.nextT-this.t)/this.len}:null});
    }
  }
  // Offline render (export): runs a fresh engine faster than real time and returns the master output.
  function bounce(e,samples){
    const L=new Float32Array(samples),R=new Float32Array(samples),BL=128,bl=new Float32Array(BL),br=new Float32Array(BL);
    const post=e.post;e.post=null;
    for(let t=0;t<samples;t+=BL){const n=Math.min(BL,samples-t);e.render(bl,br,BL);L.set(n<BL?bl.subarray(0,n):bl,t);R.set(n<BL?br.subarray(0,n):br,t);}
    e.post=post;return {L,R};
  }
  // a sequence's signal order in engine form (see the 'field' message)
  const rankOf=order=>{const r={};(order||[]).forEach((k,i)=>{r[k]=i;});return r;};
  return {Engine,bounce,rankOf,orderPattern,skipPattern,DEAD,PATN,emptyStep,DT,FX,semi,semiQ,scaleNotes,SCALES,maskOf,NOTES,stMs,DIV,step,defCfg,allCfg,resolve,rowBip,AUTO};
}
