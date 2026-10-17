function engineFactory(){
  const DIV=[4,8,16,32,64,128];
  const DT=[1,2,3,4,6,8],DLAB=['1/16','1/8','3/16','1/4','3/8','1/2']; // delay times in sixteenths
  const AUTO=16; // automation points recorded per step in smooth mode
  const step=(v,n)=>Math.min(n-1,Math.max(0,Math.floor(v*n)));
  const semi=v=>v===0?0:Math.sign(v)*Math.min(12,Math.floor(Math.abs(v)*12)+1);
  const stMs=v=>250*Math.pow(8/250,v);
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
      opts:{scale:{name:'Scale',def:'chrom',choices:SCALE_CHOICES}},
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
    delay:{name:'Delay',hue:130,cells:['send'],
      params:{send:{name:'Send',def:1,lab:pct},
              time:{name:'Time',def:(2+0.5)/6,lab:v=>DLAB[step(v,6)]},
              fb:{name:'Feedback',def:0.55,lab:pct}}},
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
  // Seeded randomness: a clip's random choices (play order, silence, random slice) come from its seed and the
  // pass number within its variation cycle, so the same cycle repeats exactly, live and in exports.
  function seedMix(seed,pass){let h=(seed^Math.imul(pass+1,0x9E3779B1))|0;h=Math.imul(h^h>>>16,0x85EBCA6B);h=Math.imul(h^h>>>13,0xC2B2AE35);return (h^h>>>16)|0;}
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
      // play order and silence: the plain loop's own settings, a clip's stored ones, and a live (unpinned) override
      this.ord={mode:'fwd',r:0};this.mute={rnd:0,bits:null};this.muteQ=null;this.ordLive=null;this.muteLive=null;
      this.seed=1;this.varLen=0;this.rs=0;this.rsOn=false;this.cBar=-1;this.cCtx=undefined;
      this.gate=true;this.gG=1;this.rest=false;
      this.touches=[];this.rotLast=null;this.rotLastO=-1;this.anch=null;
      this.clip=null;this.clipQ=undefined;this.cpos=-1;this.songSilent=false;this.launchNow=null;
      this.rec=null;this.hist=[];this.barPos=-1;this.barN=-1;this.bsnap=null;this.recPend=null;
      this.cur=null;this.tlS=0;this.first=true;this.sidC=0;this.k=0;this.newStep=false;
      this.rp=0;this.rdir=1;this.xp=0;this.xdir=1;this.xf=0;this.xstep=1/96;
      this.dcL=0;this.dcR=0;this.lastL=0;this.lastR=0;
      this.rN=1<<14;this.rm=this.rN-1;this.rL=new Float32Array(this.rN);this.rR=new Float32Array(this.rN);
      this.pPh=0;this.pSem=0;this.pMix=0;this.hadPitch=false;
      this.gr=[];this.gNext=0;this.cAcc=1;this.cl=0;this.cr=0;this.fs=new Float64Array(4);
      this.dN=1<<17;this.dm=this.dN-1;this.dL=new Float32Array(this.dN);this.dR=new Float32Array(this.dN);this.dW=0;
      this.dSend=0;this.dTime=0;this.dFb=0.55;this.dTv=0;this.dlp1=0;this.dlp2=0;
    }
    get ordE(){return this.ordLive||(this.clip&&this.clip.ord)||this.ord;}
    get muteE(){return this.muteLive||(this.clip&&this.clip.mute)||this.mute;}
    // musical randomness: seeded per pass when the context repeats, otherwise truly random
    rnd(){
      if(!this.rsOn)return Math.random();
      let a=this.rs=(this.rs+0x6D2B79F5)|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;
    }
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
      this.xf=0;this.rp=-1;this.rdir=1;this.hist=[];this.barPos=-1;this.barN=-1;this.cpos=-1;this.bsnap=null;this.recPend=null;
      this.cBar=-1;this.cCtx=undefined;this.dL.fill(0);this.dR.fill(0);this.dSend=0;this.dlp1=this.dlp2=0;
    }
    mkE(f){return {k:f.k,raw:f.raw,auto:f.auto||null,tid:f.tid||null,live:null,v:{},o:null,rv:NaN,cv:-1,ref:null};}
    // the raw cell position an effect plays at this moment: recorded automation, a moving finger, or a held value
    raw(e,t,c){
      if(e.auto){const p=(t-c.stepT)*AUTO/this.sl;if(p<=0)return e.auto[0];const i=Math.floor(p);if(i>=AUTO-1)return e.auto[AUTO-1];return e.auto[i]+(e.auto[i+1]-e.auto[i])*(p-i);}
      if(!this.E.stepped&&e.live!=null)return e.live;
      return e.raw;
    }
    res(e,raw){
      if(raw!==e.rv||e.cv!==this.cfgV){const c=this.cfg[e.k];resolveInto(e.v,c,e.k,raw);e.o=c.o;e.rv=raw;e.cv=this.cfgV;}
    }
    relink(){
      const c=this.cur;if(!c)return;
      for(const e of c.fx){if(!e.tid)continue;const t=this.touches.find(x=>x.id===e.tid);e.live=t&&t.fx&&t.fx.k===e.k?t.fx.raw:null;}
    }
    stepOrder(cur,n){ // next index in 0..n-1 following play order
      const o=this.ordE;
      if(cur<0)return o.mode==='back'?n-1:0;
      if(this.rnd()<o.r)return Math.floor(this.rnd()*n);
      return o.mode==='back'?(cur-1+n)%n:(cur+1)%n;
    }
    pickTouch(L){
      const o=this.ordE;let nx;
      if(Math.random()<o.r)nx=L[Math.floor(Math.random()*L.length)];
      else{
        const i=L.findIndex(x=>x.id===this.rotLast);
        if(o.mode==='back'){
          if(i>0)nx=L[i-1];else if(i===0)nx=L[L.length-1];
          else{nx=null;for(const x of L)if(x.o<this.rotLastO)nx=x;nx=nx||L[L.length-1];}
        }else{
          if(i>=0)nx=L[(i+1)%L.length];
          else{nx=L.find(x=>x.o>this.rotLastO)||L[0];}
        }
      }
      this.rotLast=nx.id;this.rotLastO=nx.o;return nx;
    }
    silenced(){
      const m=this.muteE;
      if(m.bits)return {on:!m.bits[this.barPos%m.bits.length],kind:'pat'};
      return {on:m.rnd>0&&this.rnd()<m.rnd,kind:'rnd'};
    }
    snapshot(){
      const c=this.cur,r=this.rec;
      return {tlS:this.tlS,first:this.first,rotLast:this.rotLast,rotLastO:this.rotLastO,cpos:this.cpos,anch:this.anch,rs:this.rs,
        hist:this.hist.length,rec:r?r.slots.length:-1,cur:c,left:c?c.left:0,off:c?c.off:0,gate:this.gate,rest:this.rest,hadPitch:this.hadPitch};
    }
    restore(s){
      this.tlS=s.tlS;this.first=s.first;this.rotLast=s.rotLast;this.rotLastO=s.rotLastO;this.cpos=s.cpos;this.anch=s.anch;this.rs=s.rs;
      this.hist.length=Math.min(this.hist.length,s.hist);if(this.rec&&s.rec>=0)this.rec.slots.length=Math.min(this.rec.slots.length,s.rec);
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
      if(this.recPend){const p=this.recPend;this.recPend=null;this.E.emit({type:'clipStep',tr:this.i,id:p.id,idx:p.idx,slot:p.slot});}
    }
    boundary(t,k){
      const E=this.E;
      this.finalize();
      this.k=k;
      const n=this.n;
      this.barPos=this.barPos<0?0:(this.barPos+1)%n;
      if(this.barPos===0)this.barN++;
      if(this.launchNow){const L=this.launchNow;this.launchNow=null;this.clip=L.clip;this.songSilent=L.silent;this.clipQ=undefined;this.cpos=-1;this.barPos=0;}
      if(this.muteQ){this.mute=this.muteQ;this.muteQ=null;}
      const bar=this.barPos===0;
      if(bar&&this.gridQ){const g=this.gridQ;this.gridQ=0;this.applyGrid(g);}
      if(bar&&this.rangeQ){const q=this.rangeQ;this.rangeQ=null;this.s16=q.s16;this.e16=q.e16;this.clampTl();this.first=true;this.cpos=-1;this.hist=[];}
      if(this.rec){
        const r=this.rec;
        if(r.wait&&bar&&!r.over)r.wait=false;
        if(r.closing&&bar)this.finishRec();
        else if(!r.over&&!r.wait&&bar&&r.slots.length>=r.L){
          // a new recording that reaches the sequence length becomes the sequence and keeps recording over
          // it (replacing or combining, following the mode) until record is pressed again
          r.slots.length=r.L;this.finishRec();
          this.rec={id:r.id,over:true,wait:false,closing:false,slots:[]};
        }
      }
      if(bar&&this.clipQ!==undefined){
        this.clip=this.clipQ;this.clipQ=undefined;this.cpos=-1;this.songSilent=false;
      }
      if(bar){
        // each bar of a repeating variation cycle starts from the same random numbers, so the cycle repeats
        const c=this.clip,id=c?c.id:null;
        if(id!==this.cCtx){this.cCtx=id;this.cBar=-1;}
        this.cBar++;
        const vl=c&&c.varLen!==undefined?c.varLen:this.varLen,sd=c&&c.seed!==undefined?c.seed:this.seed;
        // a cycle is the clip's length times the variation length; positions restart with each cycle
        const cb=c&&c.slots?Math.max(1,Math.ceil(c.slots.length/(c.n||this.n))):1;
        if(vl>0){const pass=this.cBar%(cb*vl);if(pass===0){this.cpos=-1;this.first=true;}this.rs=seedMix(sd,pass);this.rsOn=true;}
        else this.rsOn=false;
      }
      this.bsnap=this.snapshot();this.bsnap.t=t;this.bsnap.k=k;
      this.decide(t,k);
    }
    finishRec(){
      const r=this.rec;this.rec=null;
      if(!r.slots.length)return;
      const clip={id:r.id,cols:this.cols,n:this.n,slots:r.slots};
      this.E.emit({type:'clip',tr:this.i,clip});
      this.clip=clip;this.clipQ=undefined;this.cpos=-1;this.songSilent=false;
    }
    decide(t,k){
      const E=this.E,u=E.u,sl=this.sl,pref=E.pref;
      const c=this.cur;if(c)c.left--;
      const clip=this.clip&&this.clip.slots.length?this.clip:null;
      // Two independent switches decide what touches do:
      //   FX only off: touched slices take turns.      FX only on: the sequence (or loop) keeps its slices.
      //   Replace: each step plays one touch's effect. Combine: every held effect stacks on each step;
      //            when one effect is held twice, the most recent touch's value wins.
      const r=this.rec,combine=E.mode==='combine',fxOnly=E.fxOnly,dub=!!(r&&r.over&&!r.wait&&fxOnly&&clip&&clip.id===r.id);
      const loopT=fxOnly&&combine?[]:this.touches,applied=combine?this.touches.filter(x=>x.fx):[];
      const pre={tlS:this.tlS,first:this.first,rotLast:this.rotLast,rotLastO:this.rotLastO,cpos:this.cpos};
      // advance the underlying sequence positions
      let slot=null,cIdx=-1;
      if(clip){cIdx=this.cpos=this.stepOrder(this.cpos,clip.slots.length);slot=clip.slots[cIdx];}
      if(this.first){this.first=false;this.tlS=this.s+(this.ord.mode==='back'?this.n-1:0);}
      else this.tlS=this.s+this.stepOrder(this.tlS-this.s,this.n);
      const cont=c&&c.left>0;
      let base=null;
      if(cont){}
      else if(loopT.length&&!fxOnly){
        const x=this.pickTouch(loopT);
        base={src:'touch',sid:'T'+x.id+'#'+(++this.sidC),a:x.a*u,dur:Math.max(1,Math.round(x.n*u/sl)),slen:x.n*u,fx:x.fx&&!combine?[{tid:x.id,k:x.fx.k,raw:x.fx.raw}]:[],off:0,on:true,picked:true};
      }
      else if(this.songSilent){base={src:'rest',sid:'R'+(++this.sidC),a:this.tlS*sl,dur:1,slen:sl,fx:[],off:0,on:false};}
      else if(slot&&slot.empty){
        // an empty step plays the clip's background: the loop's own slice for this position, or silence
        const pos=this.s+(cIdx%this.n),bg=clip.bg==='silence'||slot.on===false;
        base={src:bg?'rest':'loop',sid:'E'+(++this.sidC),a:pos*sl,dur:1,slen:sl,fx:[],off:0,on:!bg,empty:true};
      }
      else if(slot){
        if(c&&c.src==='clip'&&c.sid===slot.sid&&(slot.off||0)>0&&slot.off===c.off+1){
          c.off=slot.off;base=null;
          for(const f of slot.fx||[]){const e=c.fx.find(x=>x.k===f.k&&!x.tid);if(e){e.auto=f.auto||null;e.raw=f.raw;}}
        }
        else base={src:'clip',sid:slot.sid,a:slot.a*u,dur:1,slen:(slot.slen||1)*sl,fx:slot.fx||[],off:slot.off||0,on:slot.on!==false,clip:true};
      }
      else base={src:'loop',sid:'L'+(++this.sidC),a:this.tlS*sl,dur:1,slen:sl,fx:[],off:0,on:true};
      // FX only + Replace: the step keeps its slice and takes the next touch's effect in place of its own
      if(base&&fxOnly&&!combine&&loopT.length&&(base.src!=='rest'||base.empty)){
        const x=this.pickTouch(loopT);base.fx=x.fx?[{tid:x.id,k:x.fx.k,raw:x.fx.raw}]:[];base.picked=true;
      }
      // silence: muted in place, or inserted as a rest that holds the sequence back
      const sil=cont?{on:false}:this.silenced();
      const insert=sil.on&&(sil.kind==='pat'?pref.silPat:pref.silRnd)==='insert';
      if(insert)Object.assign(this,pre);
      this.rest=insert;
      if(base){
        const F=base.fx.map(f=>this.mkE(f));
        const add=x=>{const f=this.mkE({k:x.fx.k,raw:x.fx.raw,tid:x.id});const j=F.findIndex(e=>e.k===f.k);if(j>=0)F[j]=f;else F.push(f);};
        applied.forEach(add);
        for(const e of F)this.res(e,e.auto?e.auto[0]:e.raw);
        // FX only + Combine: a held stutter or freeze keeps repeating the slice it began on
        const anc=fxOnly&&applied.find(x=>x.fx.k==='stutter'||x.fx.k==='freeze');
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
      // pa: the slice actually heard (after a random-slice jump), used when printing a clip to steps
      const rec={on:this.gate,a:cc.a/u,off:k-cc.k0,sid:cc.sid,slen:cc.slen/sl,fx,pa:(cc.rPick>=0?cc.rPick:cc.a)/u,tch:!insert&&!!cc.touched};
      this.hist.push(Object.assign({bp:this.barPos,bn:this.barN,ci:this.cIdx},rec));
      if(this.hist.length>96)this.hist.splice(0,32);
      if(r){
        // Recording writes only the steps you touch. Silence, play order and randomness belong to the clip
        // (printing bakes them), so a touched step is written as on; untouched steps are left alone.
        const take=()=>({on:cc.on!==false,a:rec.a,off:rec.off,sid:rec.sid,slen:rec.slen,fx});
        if(r.over){
          if(r.wait&&clip&&clip.id===r.id)r.wait=false;
          if(!r.wait&&clip&&clip.id===r.id&&this.cIdx>=0&&rec.tch){
            const old=clip.slots[this.cIdx];
            // FX only: the step keeps its slice and on/off and takes the effects heard; an empty step becomes
            // its background slice
            const s=dub?Object.assign({},old.empty?{on:true,a:rec.a,off:0,sid:'X'+(++this.sidC),slen:1}:old,{fx,empty:undefined}):take();
            if(s.empty===undefined)delete s.empty;
            clip.slots[this.cIdx]=s;E.emit({type:'clipStep',tr:this.i,id:r.id,idx:this.cIdx,slot:s});this.recPend={id:r.id,idx:this.cIdx,slot:s};
          }
        }else if(!r.wait)r.slots.push(rec.tch?take():emptyStep(this.sidC++));
      }
    }
    // a touch that lands just after a slice started is treated as if it was on time
    regrace(){
      const E=this.E,b=this.bsnap;
      if(!b||!E.playing||E.pref.grace<=0)return;
      if(E.t-b.t>E.pref.grace*E.sr/1000||E.t<b.t)return;
      if(b.cur&&b.left>1)return;
      this.recPend=null;
      this.restore(b);this.decide(b.t,b.k);
    }
    startStep(c){
      let pitch=false;
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
        else if(e.k==='crush')this.cAcc=1;
      }
      c.fc=c.rPick>=0?c.rPick:c.a;
      this.hadPitch=pitch;
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
            l=this.cl;r=this.cr;
          }
          else if(k==='filter'){
            e.sc=e.sc===undefined?v.cut:e.sc+(v.cut-e.sc)*0.002;
            const pp=e.sc;if(Math.abs(pp)<1e-4)continue;
            const hp=pp>0,fc=Math.min(hp?hpHz(pp):lpHz(-pp),sr*0.45);
            const g=Math.tan(Math.PI*fc/sr),kk=2-1.9*v.res,a1=1/(1+g*(g+kk)),a2=g*a1,a3=g*a2,s=this.fs;
            let v3=l-s[1],v1=a1*s[0]+a2*v3,v2=s[1]+a2*s[0]+a3*v3;s[0]=2*v1-s[0];s[1]=2*v2-s[1];
            const yl=hp?l-kk*v1-v2:v2;
            v3=r-s[3];v1=a1*s[2]+a2*v3;v2=s[3]+a2*s[2]+a3*v3;s[2]=2*v1-s[2];s[3]=2*v2-s[3];
            r=hp?r-kk*v1-v2:v2;l=yl;
          }
        }
        if(!ring){this.rL[t&rm]=l;this.rR[t&rm]=r;}
        this.gG+=((this.gate?1:0)-this.gG)*0.01;
        this.tg+=((this.muted?0:1)-this.tg)*0.003;
        let ol=l*this.gG,or=r*this.gG;
        if(ol!==ol||or!==or){ol=or=0;this.lastL=this.lastR=this.dcL=this.dcR=0;this.fs.fill(0);this.dL.fill(0);this.dR.fill(0);this.dlp1=this.dlp2=0;this.cl=this.cr=0;this.xf=0;this.pMix=0;this.gr.length=0;this.rL.fill(0);this.rR.fill(0);}
        if(this.newStep){this.newStep=false;this.dcL=this.lastL-ol;this.dcR=this.lastR-or;}
        ol+=this.dcL;or+=this.dcR;this.dcL*=0.992;this.dcR*=0.992;
        this.lastL=ol;this.lastR=or;
        // delay send: ping-pong, darkened a little on each repeat; the tail keeps going after the step ends
        {let dv=null;for(let j=0;j<F.length;j++)if(F[j].k==='delay'){dv=F[j].v;break;}
          if(dv){this.dTv=len*DT[step(dv.time,6)]/16;this.dFb=Math.min(0.95,dv.fb);}
          this.dSend+=((dv&&this.gate?dv.send:0)-this.dSend)*0.004;
          if(this.dTv>0){
            if(this.dTime<=0)this.dTime=this.dTv;else this.dTime+=(this.dTv-this.dTime)*0.0005;
            const w=this.dW,dm=this.dm,rp=w-this.dTime,wl=rdM(this.dL,dm,rp),wr=rdM(this.dR,dm,rp);
            this.dlp1+=(wl-this.dlp1)*0.35;this.dlp2+=(wr-this.dlp2)*0.35;
            this.dL[w&dm]=(ol+or)*0.5*this.dSend+this.dlp2*this.dFb;this.dR[w&dm]=this.dlp1*this.dFb;this.dW=(w+1)&dm;
            ol+=wl;or+=wr;
          }}
        const gv=this.vol*this.tg;oL[i]+=ol*gv;oR[i]+=or*gv;
      }
    }
    recFeed(r){const from=r.sent||0;r.sent=r.slots.length;return r.slots.slice(from);}
    info(){
      const c=this.cur,u=this.E.u,r=this.rec;
      return {cols:this.cols,n:this.n,s:this.s,barPos:this.barPos,barN:this.barN,src:c?c.src:null,sid:c?c.sid:null,a:c?c.a/u:0,rest:this.rest,
        pos:this.rp/u,fx:c?c.fx.map(e=>e.k):[],gate:this.gate,clipId:this.clip?this.clip.id:null,cIdx:this.cIdx,
        clipQ:this.clipQ===undefined?undefined:(this.clipQ?this.clipQ.id:null),songSilent:this.songSilent,
        rec:r?(r.closing?'closing':r.wait?'waiting':'on'):null,recOver:!!(r&&r.over),recDub:!!(r&&r.over&&this.E.fxOnly),recSteps:r?r.slots.length:0,recId:r?r.id:null,
        recFrom:r?(r.sent||0):0,recNew:r&&!r.over?this.recFeed(r):null};
    }
  }

  class Engine{
    // nTracks: the app uses one; more are kept possible for hosts that run several side by side
    constructor(sr,nTracks){
      this.sr=sr;this.len=0;this.u=0;this.t=0;this.playing=false;this.g=0;this.swing=0;this.stepped=false;
      this.pref={silRnd:'mute',silPat:'mute',grace:40};this.mode='replace';this.fxOnly=false;this.fd=Math.round(0.0015*sr);
      this.tracks=Array.from({length:nTracks||1},(_,i)=>new Track(this,i));this.view=0;this.song=null;
      this.sc=0;this.post=null;this.vol=1;this.mixL=null;this.mixR=null;this.peak=0;
      // safety limiter (untouched audio passes at unity): 1.5 ms look-ahead, ceiling −1 dBFS, 80 ms release
      this.LA=Math.max(1,Math.round(0.0015*sr));this.laL=new Float32Array(this.LA);this.laR=new Float32Array(this.LA);this.laI=0;
      this.lg=1;this.lSlope=0;this.lFloor=1;this.lHold=0;this.lRel=1-Math.exp(-1/(0.08*sr));this.ceil=Math.pow(10,-1/20);this.lim=0;
      // the last 8 bars of output, for "export what you just heard"
      this.ringL=null;this.ringR=null;
    }
    emit(m){if(this.post)this.post(m);}
    start(){this.t=0;this.playing=true;for(const tr of this.tracks)tr.reset();}
    msg(d){
      const T=d.tr!==undefined?this.tracks[d.tr]:null;
      switch(d.type){
        case 'loadAll':{d.bufs.forEach((b,i)=>{if(b&&this.tracks[i]){this.tracks[i].L=b.L;this.tracks[i].R=b.R;}});this.msg({type:'load',tr:0,L:d.bufs[0]?d.bufs[0].L:this.tracks[0].L,R:d.bufs[0]?d.bufs[0].R:this.tracks[0].R});break;}
        case 'load':{
          const old=this.len;T.L=d.L;T.R=d.R;
          if(d.L.length!==this.len){
            this.len=d.L.length;this.u=Math.floor(this.len/16);
            if(old){const k=this.len/old;this.t=Math.round(this.t*k);if(this.song)this.song.nextT=Math.round(this.song.nextT*k);
              for(const tr of this.tracks){if(tr.cur){tr.cur.startT=Math.round(tr.cur.startT*k);tr.cur.stepT=Math.round(tr.cur.stepT*k);tr.cur.a=Math.round(tr.cur.a*k);tr.cur.fc=Math.round(tr.cur.fc*k);if(tr.cur.rPick>=0)tr.cur.rPick=Math.round(tr.cur.rPick*k);tr.cur.slen*=k;}tr.bsnap=null;}}
          }
          for(const tr of this.tracks)tr.sl=Math.floor(this.len/tr.cols);
          if(!this.ringL||this.ringL.length!==8*this.len){this.ringL=new Float32Array(8*this.len);this.ringR=new Float32Array(8*this.len);}
          break;}
        case 'play':if(!this.playing)this.start();break;
        case 'stop':this.playing=false;this.song=null;for(const tr of this.tracks){tr.gridQ=0;tr.finalize();tr.rec=null;tr.songSilent=false;tr.launchNow=null;}break;
        case 'touches':{T.touches=d.list||[];T.relink();const sig=T.touches.map(x=>x.id+':'+x.a+':'+(x.fx?x.fx.k:'-')).join();if(sig!==T.tsig){T.tsig=sig;T.regrace();}break;}
        case 'cfg':T.cfg=Object.assign({},T.cfg,d.cfg);T.cfgV++;break;
        case 'grid':if(this.playing&&d.q){T.gridQ=d.n;}else{T.gridQ=0;T.applyGrid(d.n);}T.bsnap=null;break;
        case 'range':if(this.playing&&d.q)T.rangeQ={s16:d.s16,e16:d.e16};else{T.rangeQ=null;T.s16=d.s16;T.e16=d.e16;T.clampTl();if(T.barPos>=T.n)T.barPos%=T.n;}T.bsnap=null;break;
        case 'mode':this.mode=d.mode==='combine'?'combine':'replace';break;
        case 'fxonly':this.fxOnly=!!d.on;break;
        case 'order':T.ord={mode:d.mode,r:d.r||0};break;
        case 'mute':T.muteQ={rnd:d.rnd||0,bits:d.bits||null};break;
        case 'live':if('ord' in d)T.ordLive=d.ord||null;if('mute' in d)T.muteLive=d.mute||null;break;
        case 'rand':T.seed=d.seed|0;T.varLen=d.varLen|0;break;
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
        case 'rec':{
          if(d.on&&d.over){
            // record over an existing sequence in place: it keeps its length
            if(!this.playing)this.start();
            const r={id:d.over.id,over:true,wait:true,closing:false,slots:[]};
            if(!(T.clip&&T.clip.id===d.over.id))T.clipQ=d.over;
            T.rec=r;
          }else if(d.on){
            if(!this.playing)this.start();
            const n=T.n,bp=T.barPos;
            const r={id:d.id,wait:false,closing:false,slots:[],L:n};   // sequences are one bar
            if(bp<0){}                                     // not started yet: begins on the first step
            else if(bp/n<0.5){r.slots=T.hist.slice(-(bp+1)).map((x,j)=>x.tch?{on:true,a:x.a,off:x.off,sid:x.sid,slen:x.slen,fx:x.fx}:emptyStep('h'+j));}
            else r.wait=true;
            T.rec=r;
          }else if(T.rec&&T.rec.over){
            const id=T.rec.id;T.rec=null;this.emit({type:'overDone',tr:d.tr,id});
          }else if(T.rec){
            const r=T.rec,n=T.n,bp=T.barPos;
            if(r.wait){T.rec=null;break;}
            if(bp/n<0.5&&r.slots.length>bp+1){r.slots.length-=bp+1;T.finishRec();}
            else r.closing=true;
          }
          break;}
        case 'launch':{
          if(!this.playing){this.start();T.clip=d.clip||null;T.clipQ=undefined;T.songSilent=false;}
          else T.clipQ=d.clip||null;
          this.song=null;
          break;}
        case 'clipEdit':{for(const tr of this.tracks){if(tr.clip&&tr.clip.id===d.clip.id)tr.clip=d.clip;if(tr.clipQ&&tr.clipQ.id===d.clip.id)tr.clipQ=d.clip;}
          if(this.song)for(const row of this.song.rows)row.clips=row.clips.map(c=>c&&c.id===d.clip.id?d.clip:c);break;}
        case 'song':{
          const rows=d.rows||[];
          if(!rows.length){this.song=null;break;}
          const first=Math.max(0,Math.min(rows.length-1,d.from||0));
          if(!this.playing){this.start();this.song={rows,idx:first-1,nextT:0};}
          else this.song={rows,idx:first-1,nextT:Math.ceil(this.t/this.len)*this.len};
          break;}
        case 'songRows':{if(this.song){this.song.rows=d.rows;if(this.song.idx>=d.rows.length)this.song.idx=d.rows.length-1;}break;}
        case 'songStop':{if(this.song){this.song=null;for(const tr of this.tracks){tr.clipQ=null;}}break;}
      }
    }
    songStep(){
      const S=this.song;S.idx=(S.idx+1)%S.rows.length;const row=S.rows[S.idx];
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
  return {Engine,bounce,seedMix,emptyStep,DT,FX,semi,semiQ,scaleNotes,SCALES,maskOf,NOTES,stMs,DIV,step,defCfg,allCfg,resolve,rowBip,AUTO};
}
