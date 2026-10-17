// Behaviour tests for the prototype engine. Run: node tests/engine.test.js
// Each test describes a rule the iOS engine must also satisfy; port them to XCTest one for one.
const fs=require('fs'),path=require('path');
const src=f=>fs.readFileSync(path.join(__dirname,'..','src',f),'utf8');
eval(src('engine.js')+src('synth.js')+';global.EFx=engineFactory;global.ML=makeLoop;');
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

// Smooth mode records finger movement as 16 automation points per step; playback follows them in any mode.
{const e=mk();e.msg({type:'stepped',on:false});e.msg({type:'play'});const T=e.tracks[0];
 run(e,steps(e,16)+2);e.msg({type:'rec',tr:0,on:true,id:'t0s0_1'});
 const per=steps(e,1);let raw=0;
 for(let s=0;s<20;s++)for(let q=0;q<per;q++){raw=(raw+0.01)%1;e.msg({type:'touches',tr:0,list:[{id:'h1',a:3,n:1,o:1,fx:{k:'filter',raw:-raw}}]});run(e,1);}
 const cl=e.ev.find(m=>m.type==='clip');const a=cl&&cl.clip.slots[5].fx[0].auto;
 ok('a new recording becomes a sequence at the sequence length',cl&&cl.clip.slots.length===16);
 ok('smooth gestures are stored as automation',!!a&&a.length===16&&Math.abs(a[15]-a[0])>0.05);
 e.msg({type:'rec',tr:0,on:false});e.msg({type:'touches',tr:0,list:[]});e.msg({type:'stepped',on:true});
 run(e,steps(e,16));const seen=new Set();for(let q=0;q<per;q++){run(e,1);seen.add(T.cur.fx[0]?T.cur.fx[0].v.cut.toFixed(3):'-');}
 ok('automation plays back with stepped on',seen.size>3);}

// Recording never stops by itself; FX only decides whether recording over a sequence keeps its slices.
{const e=mk();e.msg({type:'play'});const T=e.tracks[0];run(e,4);
 e.msg({type:'rec',tr:0,on:true,id:'t0s0_1'});run(e,steps(e,40));
 ok('recording keeps going over the new sequence',T.rec&&T.rec.over&&T.clip.slots.length===16&&!e.ev.find(m=>m.type==='overDone'));
 const before=T.clip.slots.map((s,i)=>s.empty?i:s.a).join();   // empty steps play their own position
 e.msg({type:'mode',mode:'combine'});e.msg({type:'fxonly',on:true});
 e.msg({type:'touches',tr:0,list:[{id:'d',a:9,n:1,o:1,fx:null},{id:'p',a:2,n:1,o:2,fx:{k:'pitch',raw:0.8}}]});run(e,steps(e,17));
 ok('FX only + Combine: slices kept, effect added to every step',T.clip.slots.map(s=>s.a).join()===before&&T.clip.slots.every(s=>s.fx.some(f=>f.k==='pitch')));
 e.msg({type:'touches',tr:0,list:[{id:'p2',a:2,n:1,o:3,fx:{k:'pitch',raw:-0.4}}]});run(e,steps(e,17));
 ok('FX only + Combine: an effect already on a step is replaced, not doubled',T.clip.slots.every(s=>s.fx.filter(f=>f.k==='pitch').length===1&&s.fx.find(f=>f.k==='pitch').raw<0));
 e.msg({type:'mode',mode:'replace'});e.msg({type:'fxonly',on:false});e.msg({type:'touches',tr:0,list:[{id:'d2',a:9,n:1,o:4,fx:null}]});run(e,steps(e,17));
 ok('Replace: touched steps replaced by what plays',T.clip.slots.every(s=>s.a===9&&!s.fx.length));
 e.msg({type:'rec',tr:0,on:false});ok('record button stops it',!T.rec&&!!e.ev.find(m=>m.type==='overDone'));}

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

// Overwrite of an existing sequence keeps its length (here an older 2-bar one).
{const e=mk();e.msg({type:'play'});const T=e.tracks[0];
 const clip={id:'o',cols:16,n:16,slots:Array.from({length:32},(_,i)=>({on:true,a:0,off:0,sid:'x'+i,slen:1,fx:[]}))};
 e.msg({type:'launch',tr:0,clip});run(e,steps(e,3));
 e.msg({type:'rec',tr:0,on:true,over:clip});e.msg({type:'touches',tr:0,list:[{id:'t',a:9,n:1,o:1,fx:null}]});run(e,steps(e,40));
 ok('recording over a sequence keeps its length',T.clip.slots.length===32&&T.clip.slots.every(s=>s.a===9));}

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

// Empty steps play the clip's background: the loop's slice for their position, or silence.
{const e=mk();e.msg({type:'play'});const T=e.tracks[0];
 const slots=Array.from({length:16},(_,i)=>i%4===0?{on:true,a:9,off:0,sid:'s'+i,slen:1,fx:[]}:EF.emptyStep(i));
 const clip={id:'bg',cols:16,n:16,slots};e.msg({type:'launch',tr:0,clip});
 const seen=[];for(let s=0;s<16;s++){run(e,steps(e,1));seen.push(T.cur.a/e.u+(T.gate?'':'x'));}
 ok('empty steps play the loop slice at their position',seen.slice(1).every((x,j)=>(j+1)%4===0?x==='9':x===String(j+1)),seen);
 e.msg({type:'clipEdit',clip:Object.assign({},clip,{bg:'silence'})});const g=[];for(let s=0;s<16;s++){run(e,steps(e,1));g.push(T.gate?1:0);}
 ok('silence background mutes empty steps',g.slice(1).every((x,j)=>(j+1)%4===0?x===1:x===0),g);}

// Recording writes only touched steps; untouched ones stay empty.
{const e=mk();e.msg({type:'play'});const T=e.tracks[0];run(e,4);
 e.msg({type:'rec',tr:0,on:true,id:'t0s0_1'});run(e,steps(e,4));
 e.msg({type:'touches',tr:0,list:[{id:'a',a:7,n:1,o:1,fx:{k:'pitch',raw:0.5}}]});run(e,steps(e,2));e.msg({type:'touches',tr:0,list:[]});run(e,steps(e,14));
 const cl=e.ev.find(m=>m.type==='clip');const sl=cl?cl.clip.slots:[];
 ok('recording keeps untouched steps empty',sl.length===16&&sl.filter(x=>!x.empty).length>=2&&sl.filter(x=>!x.empty).every(x=>x.a===7)&&sl.filter(x=>x.empty).length>=12,sl.map(x=>x.empty?'.':x.a).join(' '));}

// Repeating randomness: with a variation length, random play order, silence and random slices repeat exactly.
function orderRun(varLen,bars){const e=mk();const T=e.tracks[0];e.msg({type:'order',tr:0,mode:'fwd',r:0.7});e.msg({type:'mute',tr:0,rnd:0.3});
 e.msg({type:'rand',tr:0,seed:42,varLen});e.msg({type:'play'});const out=[];
 for(let b=0;b<bars;b++){const row=[];for(let s=0;s<16;s++){run(e,steps(e,1));row.push(T.cur.a/e.u+(T.gate?'':'x'));}out.push(row.join(' '));}return out;}
{const r1=orderRun(1,4),r2=orderRun(2,6),r0=orderRun(0,4);
 ok('variation length 1: every bar is the same random bar',r1.slice(1).every(x=>x===r1[1])&&r1[1]!==[...Array(16).keys()].join(' '),r1);
 ok('variation length 2: bars repeat in pairs',r2[2]===r2[4]&&r2[3]===r2[5]&&r2[2]!==r2[3],r2);
 ok('variation length never: bars differ',new Set(r0.slice(1)).size>1,r0);}

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
