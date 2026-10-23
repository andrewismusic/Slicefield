// Behaviour tests for the prototype engine. Run: node tests/engine.test.js
// Each test describes a rule the iOS engine must also satisfy; port them to XCTest one for one.
const fs=require('fs'),path=require('path');
const src=f=>fs.readFileSync(path.join(__dirname,'..','src',f),'utf8');
eval(src('engine.js')+src('synth.js')+';global.EFx=engineFactory;global.ML=synthFactory().makeLoop;');
const EF=EFx(),sr=48000,B=new Float32Array(128),C=new Float32Array(128);
function mk(pref){const e=new EF.Engine(sr);const ev=[];e.post=m=>{if(m.type!=='status')ev.push(m);};
  const lp=ML('break',sr,124);e.msg({type:'load',tr:0,L:lp.L,R:lp.R});if(pref)e.msg({type:'pref',pref});e.ev=ev;return e;}
const run=(e,b)=>{for(let i=0;i<b;i++)e.render(B,C,128);};
const steps=(e,s)=>Math.round(e.len/16*s/128);
let fails=0;const ok=(n,c,x)=>{if(!c)fails++;console.log((c?'PASS ':'FAIL ')+n+(x!==undefined&&!c?'  '+JSON.stringify(x):''));};

// Effect values are resolved from the track's settings at playback, so a scale change re-maps locked steps.
{const e=mk();e.msg({type:'play'});const T=e.tracks[0];
 const clip={id:'c',cols:16,n:16,slots:Array.from({length:16},(_,i)=>({on:true,a:i,off:0,sid:'s'+i,slen:1,fx:[{k:'pitch',raw:0.5}]}))};
 e.msg({type:'launch',tr:0,clip});run(e,steps(e,2));
 const s1=EF.semiQ(T.cur.fx[0].v.semi,T.cur.fx[0].o);
 const c=EF.defCfg('pitch');c.o.scale='oct';c.o.mask=EF.maskOf(EF.SCALES.oct);e.msg({type:'cfg',tr:0,cfg:{pitch:c}});run(e,2);
 ok('scale change re-maps locked steps (+7 chromatic -> +12 octaves)',s1===7&&EF.semiQ(T.cur.fx[0].v.semi,T.cur.fx[0].o)===12,[s1]);}

// Smooth mode captures finger movement as 16 automation points per step; playback follows them in any mode.
{const e=mk();e.msg({type:'stepped',on:false});e.msg({type:'play'});const T=e.tracks[0];
 run(e,steps(e,16)+2);
 const per=steps(e,1);let raw=0;
 for(let s=0;s<20;s++)for(let q=0;q<per;q++){raw=(raw+0.01)%1;e.msg({type:'touches',tr:0,list:[{id:'h1',a:3,n:1,o:1,fx:{k:'filter',raw:-raw}}]});run(e,1);}
 const bar=e.ev.find(m=>m.type==='bar'&&m.touched);const a=bar&&bar.slots[5].fx[0]&&bar.slots[5].fx[0].auto;
 ok('a captured bar is a whole one-bar sequence',bar&&bar.slots.length===16);
 ok('smooth gestures are captured as automation',!!a&&a.length===16&&Math.abs(a[15]-a[0])>0.05);
 e.msg({type:'touches',tr:0,list:[]});e.msg({type:'stepped',on:true});
 e.msg({type:'launch',tr:0,clip:{id:'cap',cols:16,n:16,slots:bar.slots,ord:{perm:null},mute:{bits:null}}});
 run(e,steps(e,20));const seen=new Set();for(let q=0;q<per;q++){run(e,1);seen.add(T.cur.fx[0]?T.cur.fx[0].v.cut.toFixed(3):'-');}
 ok('automation plays back with stepped on',seen.size>3);}

// What you play over a sequence is captured as heard; FX only decides whether touches change its slices.
{const e=mk();e.msg({type:'play'});const T=e.tracks[0];
 const seq={id:'s',cols:16,n:16,ord:{perm:null},mute:{bits:null},slots:Array.from({length:16},(_,i)=>({on:true,a:(i*3)%16,off:0,sid:'s'+i,slen:1,fx:[]}))};
 const lastTouched=()=>e.ev.filter(m=>m.type==='bar'&&m.touched).pop();
 e.msg({type:'launch',tr:0,clip:seq});run(e,steps(e,18));
 e.msg({type:'mode',mode:'combine'});e.msg({type:'fxonly',on:true});
 e.msg({type:'touches',tr:0,list:[{id:'d',a:9,n:1,o:1,fx:null},{id:'p',a:2,n:1,o:2,fx:{k:'pitch',raw:0.8}}]});e.ev.length=0;run(e,steps(e,34));
 let b=lastTouched();
 ok('FX only + Combine: the captured bar keeps the slices, with the effect on every step',b&&b.slots.map(s=>s.a).join()===seq.slots.map(s=>s.a).join()&&b.slots.every(s=>s.fx.some(f=>f.k==='pitch')),b&&b.slots.map(s=>s.a));
 e.msg({type:'mode',mode:'replace'});e.msg({type:'fxonly',on:false});e.msg({type:'touches',tr:0,list:[{id:'d2',a:9,n:1,o:4,fx:null}]});e.ev.length=0;run(e,steps(e,34));
 b=lastTouched();ok('Replace: the captured bar plays the touched slice',b&&b.slots.every(s=>s.a===9&&!s.fx.length));
 e.msg({type:'touches',tr:0,list:[]});e.ev.length=0;run(e,steps(e,34));b=e.ev.filter(m=>m.type==='bar').pop();
 ok('an untouched bar is captured as the sequence plays it, marked untouched',b&&!b.touched&&b.cid==='s'&&b.slots.map(s=>s.a).join()===seq.slots.map(s=>s.a).join());}

// FX only + Combine while just playing: the loop keeps running, the effect lands on every slice, waveform taps do nothing.
{const e=mk();e.msg({type:'play'});e.msg({type:'mode',mode:'combine'});e.msg({type:'fxonly',on:true});const T=e.tracks[0];run(e,steps(e,3));
 e.msg({type:'touches',tr:0,list:[{id:'d',a:9,n:1,o:1,fx:null},{id:'f',a:3,n:1,o:2,fx:{k:'filter',raw:-0.5}}]});
 const seen=[];for(let s=0;s<8;s++){run(e,steps(e,1));seen.push(T.cur.a/e.u+(T.cur.fx.length?'f':''));}
 ok('FX only + Combine live play',seen.every(x=>x.endsWith('f'))&&new Set(seen).size===8,seen);}

// Bar length changes wait for the track's bar line.
{const e=mk();e.msg({type:'play'});const T=e.tracks[0];run(e,steps(e,5));
 e.msg({type:'range',tr:0,s16:0,e16:12,q:true});const n0=T.n;run(e,steps(e,11)+1);
 ok('bar length change lands on the bar line',n0===16&&T.n===12&&T.barPos===0);
 run(e,steps(e,12));ok('12-step bar loops',T.barPos===0);}

// Slice-edge fades: no discontinuities at step boundaries with heavy swing.
{const e=mk();e.msg({type:'swing',s:0.4});e.msg({type:'play'});
 const clip={id:'c',cols:16,n:16,slots:Array.from({length:16},(_,i)=>({on:true,a:(i*7)%16,off:0,sid:'s'+i,slen:1,fx:[]}))};
 e.msg({type:'launch',tr:0,clip});let p1=0,p2=0,worst=0;
 for(let i=0;i<steps(e,64);i++){const t0=e.t;e.render(B,C,128);const sl=e.tracks[0].sl,pair=2*sl,split=Math.round(sl*1.4);
   // the master limiter delays output by e.LA samples; unity gain is ~1.47× the old 0.68 output gain
   for(let j=0;j<128;j++){const v=B[j],t=t0+j-e.LA,m=((t%pair)+pair)%pair,d=Math.abs(v-2*p1+p2);p2=p1;p1=v;if(t>2*e.len&&(m<3||Math.abs(m-split)<3))worst=Math.max(worst,d);}}
 ok('step boundaries are click-free (2nd difference < 0.03)',worst<0.03,worst);}

// Combine (FX only off): touched slices take turns, and every held effect plays on each of them.
{const e=mk();e.msg({type:'play'});e.msg({type:'mode',mode:'combine'});const T=e.tracks[0];run(e,steps(e,3));
 e.msg({type:'touches',tr:0,list:[{id:'a',a:2,n:1,o:1,fx:{k:'pitch',raw:0.5}},{id:'b',a:9,n:1,o:2,fx:{k:'crush',raw:0.3}},{id:'c',a:5,n:1,o:3,fx:{k:'pitch',raw:-0.5}}]});
 const seen=[];for(let s=0;s<6;s++){run(e,steps(e,1));seen.push(T.cur.a/e.u+':'+T.cur.fx.map(f=>f.k+(f.k==='pitch'?(f.raw<0?'-':'+'):'')).sort().join(','));}
 ok('Combine: slices rotate, all effects stack, latest touch of an effect wins',new Set(seen.map(x=>x.split(':')[0])).size===3&&seen.every(x=>x.endsWith(':crush,pitch-')),seen);}

// FX only + Replace: the sequence keeps its slices, each step takes the next touch's effect in turn.
{const e=mk();e.msg({type:'play'});e.msg({type:'fxonly',on:true});const T=e.tracks[0];
 const clip={id:'q',cols:16,n:16,slots:Array.from({length:16},(_,i)=>({on:true,a:(i*5)%16,off:0,sid:'q'+i,slen:1,fx:[{k:'env',raw:0.2}]}))};
 e.msg({type:'launch',tr:0,clip});run(e,steps(e,3));
 e.msg({type:'touches',tr:0,list:[{id:'a',a:2,n:1,o:1,fx:{k:'pitch',raw:0.5}},{id:'b',a:9,n:1,o:2,fx:null}]});
 const seen=[];for(let s=0;s<6;s++){run(e,steps(e,1));seen.push([T.cur.a/e.u,clip.slots[T.cpos].a,T.cur.fx.map(f=>f.k).join()]);}
 ok('FX only + Replace: slices from the sequence, effects alternate (a dry tap removes them)',seen.every(x=>x[0]===x[1])&&seen.map(x=>x[2]).join('|')==='pitch||pitch||pitch|'||seen.map(x=>x[2]).join('|')==='|pitch||pitch||pitch',seen);}

// Swing: nothing of the next slice leaks into the swing gap after a slice ends.
{const e=mk();e.msg({type:'swing',s:0.4});e.msg({type:'play'});run(e,steps(e,16));
 const T=e.tracks[0],b=new Float32Array(1),c=new Float32Array(1);let leak=0;const gap=[];
 for(let i=0;i<e.len+e.LA;i++){e.render(b,c,1);const el=e.t-1-T.cur.startT;gap.push(T.cur.left<=1&&el>=T.cur.slen);if(i>=e.LA&&gap[i-e.LA])leak=Math.max(leak,Math.abs(b[0]));}
 ok('swing gap is silent',leak<1e-3,leak);}

// Empty steps play the loop's own slice for their position; switched off, they are silent.
{const e=mk();e.msg({type:'play'});const T=e.tracks[0];
 const slots=Array.from({length:16},(_,i)=>i%4===0?{on:true,a:9,off:0,sid:'s'+i,slen:1,fx:[]}:EF.emptyStep(i));
 const clip={id:'bg',cols:16,n:16,slots};e.msg({type:'launch',tr:0,clip});
 const seen=[];for(let s=0;s<16;s++){run(e,steps(e,1));seen.push(T.cur.a/e.u+(T.gate?'':'x'));}
 ok('empty steps play the loop slice at their position',seen.slice(1).every((x,j)=>(j+1)%4===0?x==='9':x===String(j+1)),seen);
 e.msg({type:'clipEdit',clip:Object.assign({},clip,{slots:slots.map(s=>s.empty?Object.assign({},s,{on:false}):s)})});const g=[];for(let s=0;s<16;s++){run(e,steps(e,1));g.push(T.gate?1:0);}
 ok('an empty step switched off is silent',g.slice(1).every((x,j)=>(j+1)%4===0?x===1:x===0),g);}

// ORDER and SKIP are fixed patterns: every bar plays the same, and capture writes them into the steps.
{const e=mk();const perm=EF.orderPattern(0.3,16),bits=EF.skipPattern(0.5,16);
 e.msg({type:'order',tr:0,perm});e.msg({type:'mute',tr:0,bits});e.msg({type:'play'});run(e,steps(e,16*4+1));
 const bars=e.ev.filter(m=>m.type==='bar'),key=b=>b.slots.map(s=>s.a+(s.on?'':'x')).join(' ');
 ok('a bar is captured at every bar line',bars.length===4,bars.length);
 ok('ORDER and SKIP repeat exactly, bar after bar',bars.every(b=>key(b)===key(bars[0])),bars.map(key));
 ok('captured steps follow the patterns',bars[0].slots.every((s,i)=>s.a===perm[i]&&s.on===!!bits[i]),key(bars[0]));
 ok('the far right of each slider is the default',EF.orderPattern(1,16)===null&&EF.skipPattern(EF.DEAD,16)===null&&EF.orderPattern(EF.DEAD-0.001,16)!==null);
 const pats=new Set(),sk=new Set();for(let i=0;i<EF.PATN;i++){const v=(i+0.5)/EF.PATN*EF.DEAD;pats.add(EF.orderPattern(v,16).join());sk.add(EF.skipPattern(v,16).join());}
 ok('more than a thousand different patterns on each slider',pats.size>1000&&sk.size>1000,[pats.size,sk.size]);}

// GAP (SKIP set to insert rests): a skipped step waits, and the sequence carries on after it.
{const e=mk({silPat:'insert'});const bits=new Array(16).fill(1);bits[2]=bits[3]=0;
 e.msg({type:'mute',tr:0,bits});e.msg({type:'play'});run(e,steps(e,16)+1);
 const b=e.ev.find(m=>m.type==='bar'),heard=b.slots.filter(s=>s.on).map(s=>s.a);
 ok('GAP: slices after a gap are not lost',heard.join()===[0,1,2,3,4,5,6,7,8,9,10,11,12,13].join(),heard);}

// Touches play through SKIP by default; a preference applies SKIP to them too.
{const e=mk();const T=e.tracks[0];const bits=new Array(16).fill(0);bits[0]=1;
 e.msg({type:'mute',tr:0,bits});e.msg({type:'play'});run(e,steps(e,3));
 e.msg({type:'touches',tr:0,list:[{id:'a',a:5,n:1,o:1,fx:null}]});const g=[];for(let s=0;s<5;s++){run(e,steps(e,1));g.push(T.gate?1:0);}
 ok('touches play through SKIP',g.every(x=>x===1),g);
 e.msg({type:'pref',pref:{touchWin:false}});const g2=[];for(let s=0;s<5;s++){run(e,steps(e,1));g2.push(T.gate?1:0);}
 ok('…unless SKIP is set to apply to touches',g2.every(x=>x===0),g2);}

// A touch just after a step starts counts for that step, and its slice keeps its place in time.
// The window is the grace time plus the output latency the device reports.
{function lateTouch(ms,lat){const e=mk({grace:40,lat});const T=e.tracks[0];e.msg({type:'play'});run(e,steps(e,4)+1);
   const b0=T.bsnap.t;while(T.bsnap.t===b0)run(e,1);const t0=T.bsnap.t;while(e.t-t0<ms*sr/1000)run(e,1);
   e.msg({type:'touches',tr:0,list:[{id:'x',a:11,n:1,o:1,fx:{k:'pitch',raw:0.5}}]});
   return {hit:T.cur.a/e.u===11&&T.cur.fx.length===1,start:T.cur.startT===t0};}
 const a=lateTouch(30,0),b=lateTouch(70,0),c=lateTouch(70,50);
 ok('a touch 30 ms late plays on the step that just started, in time',a.hit&&a.start,a);
 ok('a touch 70 ms late waits for the next step',!b.hit,b);
 ok('…unless the device reports 50 ms of output latency',c.hit&&c.start,c);
 const e=mk({grace:40});const T=e.tracks[0];e.msg({type:'play'});e.msg({type:'mode',mode:'combine'});e.msg({type:'fxonly',on:true});
 e.msg({type:'touches',tr:0,list:[{id:'f',a:3,n:1,o:1,fx:{k:'crush',raw:0.4}}]});run(e,steps(e,3)+1);
 const b0=T.bsnap.t;while(T.bsnap.t===b0)run(e,1);const t0=T.bsnap.t;while(e.t-t0<20*sr/1000)run(e,1);
 const had=T.cur.fx.length;e.msg({type:'touches',tr:0,list:[]});
 ok('a release just after a step starts takes the effect off that step',had===1&&T.cur.fx.length===0&&T.cur.startT===t0,[had,T.cur.fx.length]);}

// Delay: a touched step sends into the delay, and the echoes keep sounding after the touch ends.
{const e=mk();e.msg({type:'play'});const T=e.tracks[0];run(e,steps(e,2));
 const quiet={id:'q',cols:16,n:16,slots:Array.from({length:16},(_,i)=>({on:false,a:i,off:0,sid:'q'+i,slen:1,fx:[]}))};
 quiet.slots[0]={on:true,a:0,off:0,sid:'k',slen:1,fx:[{k:'delay',raw:1}]};
 e.msg({type:'launch',tr:0,clip:quiet});run(e,steps(e,16));let pk=0;
 for(let i=0;i<steps(e,8);i++){e.render(B,C,128);if(T.cIdx>=3)for(const v of B)pk=Math.max(pk,Math.abs(v));}
 ok('delay tail sounds over silent steps',pk>0.02,pk);}

// Master: untouched audio passes at unity (delayed by the limiter look-ahead); peaks stay under the ceiling.
{const e=new EF.Engine(sr);const len=Math.round(sr*240/124/64)*64,L=new Float32Array(len);for(let i=0;i<len;i++)L[i]=0.5*Math.sin(2*Math.PI*37*i/len);  // loops seamlessly
 e.msg({type:'load',tr:0,L,R:L});e.msg({type:'play'});const o=EF.bounce(e,len*2).L;let err=0;
 for(let i=len;i<2*len-e.LA;i++)err=Math.max(err,Math.abs(o[i+e.LA]-L[i%len]));
 ok('plain loop plays at unity gain',err<2e-3,err);   // within about one sample of the sine's slope
 const H=new Float32Array(len);for(let i=0;i<len;i++)H[i]=1.6*Math.sin(i*0.03);const e2=new EF.Engine(sr);e2.msg({type:'load',tr:0,L:H,R:H});e2.msg({type:'play'});
 const o2=EF.bounce(e2,len*2).L;let pk=0;for(const v of o2)pk=Math.max(pk,Math.abs(v));ok('limiter holds peaks at −1 dBFS',pk<=e2.ceil+1e-6,pk);}

// "Export what you just heard": the last whole bars of output come back.
{const e=mk();let got=null;e.post=m=>{if(m.type==='grabbed')got=m;};e.msg({type:'play'});run(e,steps(e,16*3+5));
 e.msg({type:'grab',bars:2});ok('grab returns the last 2 whole bars',got&&got.L.length===2*e.len&&got.L.some(v=>v!==0));}

// Every effect renders without NaN.
{const e=mk();e.msg({type:'play'});let nan=false,pk=0;
 for(const k of ['stutter','random','reverse','freeze','crush','pitch','env','filter','delay']){e.msg({type:'touches',tr:0,list:[{id:k,a:2,n:1,o:1,fx:{k,raw:0.7}}]});
  for(let i=0;i<200;i++){e.render(B,C,128);for(const v of B){if(v!==v)nan=true;pk=Math.max(pk,Math.abs(v));}}}
 ok('all effects render',!nan&&pk>0.01);}
console.log(fails?fails+' failed':'all passed');process.exitCode=fails?1:0;
