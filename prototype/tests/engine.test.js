// Behaviour tests for the prototype engine. Run: node tests/engine.test.js
// Each test describes a rule the iOS engine must also satisfy; port them to XCTest one for one.
const fs=require('fs'),path=require('path');
const src=f=>fs.readFileSync(path.join(__dirname,'..','src',f),'utf8');
eval(src('engine.js')+src('synth.js')+';global.EFx=engineFactory;global.ML=makeLoop;');
const EF=EFx(),sr=48000,B=new Float32Array(128),C=new Float32Array(128);
function mk(pref){const e=new EF.Engine(sr);const ev=[];e.post=m=>{if(m.type!=='status')ev.push(m);};
  const lp=ML('break',sr,124);for(let i=0;i<4;i++)e.msg({type:'load',tr:i,L:lp.L,R:lp.R});
  for(const i of [1,2,3])e.msg({type:'tmute',tr:i,on:true});if(pref)e.msg({type:'pref',pref});e.ev=ev;return e;}
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
{const e=mk({seqLen:1});e.msg({type:'stepped',on:false});e.msg({type:'play'});const T=e.tracks[0];
 run(e,steps(e,16)+2);e.msg({type:'rec',tr:0,on:true,id:'t0s0_1'});
 const per=steps(e,1);let raw=0;
 for(let s=0;s<20;s++)for(let q=0;q<per;q++){raw=(raw+0.01)%1;e.msg({type:'touches',tr:0,list:[{id:'h1',a:3,n:1,o:1,fx:{k:'filter',raw:-raw}}]});run(e,1);}
 const cl=e.ev.find(m=>m.type==='clip');const a=cl&&cl.clip.slots[5].fx[0].auto;
 ok('a new recording becomes a sequence at the sequence length',cl&&cl.clip.slots.length===16);
 ok('smooth gestures are stored as automation',!!a&&a.length===16&&Math.abs(a[15]-a[0])>0.05);
 e.msg({type:'rec',tr:0,on:false});e.msg({type:'touches',tr:0,list:[]});e.msg({type:'stepped',on:true});
 run(e,steps(e,16));const seen=new Set();for(let q=0;q<per;q++){run(e,1);seen.add(T.cur.fx[0]?T.cur.fx[0].v.cut.toFixed(3):'-');}
 ok('automation plays back with stepped on',seen.size>3);}

// Recording never stops by itself; Replace / Combine decide what recording over a sequence does.
{const e=mk({seqLen:1});e.msg({type:'play'});const T=e.tracks[0];run(e,4);
 e.msg({type:'rec',tr:0,on:true,id:'t0s0_1'});run(e,steps(e,40));
 ok('recording keeps going over the new sequence',T.rec&&T.rec.over&&T.clip.slots.length===16&&!e.ev.find(m=>m.type==='overDone'));
 const before=T.clip.slots.map(s=>s.a).join();
 e.msg({type:'mode',mode:'combine'});
 e.msg({type:'touches',tr:0,list:[{id:'d',a:9,n:1,o:1,fx:null},{id:'p',a:2,n:1,o:2,fx:{k:'pitch',raw:0.8}}]});run(e,steps(e,17));
 ok('Combine: slices kept, effect added to every step',T.clip.slots.map(s=>s.a).join()===before&&T.clip.slots.every(s=>s.fx.some(f=>f.k==='pitch')));
 e.msg({type:'touches',tr:0,list:[{id:'p2',a:2,n:1,o:3,fx:{k:'pitch',raw:-0.4}}]});run(e,steps(e,17));
 ok('Combine: an effect already on a step is replaced, not doubled',T.clip.slots.every(s=>s.fx.filter(f=>f.k==='pitch').length===1&&s.fx.find(f=>f.k==='pitch').raw<0));
 e.msg({type:'mode',mode:'replace'});e.msg({type:'touches',tr:0,list:[{id:'d2',a:9,n:1,o:4,fx:null}]});run(e,steps(e,17));
 ok('Replace: steps replaced by what plays',T.clip.slots.every(s=>s.a===9&&!s.fx.length));
 e.msg({type:'rec',tr:0,on:false});ok('record button stops it',!T.rec&&!!e.ev.find(m=>m.type==='overDone'));}

// Combine while just playing: the loop keeps running, the effect lands on every slice, waveform taps do nothing.
{const e=mk();e.msg({type:'play'});e.msg({type:'mode',mode:'combine'});const T=e.tracks[0];run(e,steps(e,3));
 e.msg({type:'touches',tr:0,list:[{id:'d',a:9,n:1,o:1,fx:null},{id:'f',a:3,n:1,o:2,fx:{k:'filter',raw:-0.5}}]});
 const seen=[];for(let s=0;s<8;s++){run(e,steps(e,1));seen.push(T.cur.a/e.u+(T.cur.fx.length?'f':''));}
 ok('Combine live play',seen.every(x=>x.endsWith('f'))&&new Set(seen).size===8,seen);}

// Capture: early in the sequence prints the bars that just finished; in the last quarter it waits for the end.
{const e=mk({seqLen:1});e.msg({type:'play'});const T=e.tracks[0];
 run(e,steps(e,16*2+3));e.msg({type:'capture',tr:0,id:'t0s1_c1'});const c1=e.ev.find(m=>m.type==='clip');
 ok('capture early: previous bar, queued for the next bar',c1&&c1.clip.slots.length===16&&T.clipQ&&T.clipQ.id==='t0s1_c1');
 const e2=mk({seqLen:1});e2.msg({type:'play'});run(e2,steps(e2,16*2+13));e2.msg({type:'capture',tr:0,id:'t0s1_c2'});
 const n0=e2.ev.filter(m=>m.type==='clip').length;run(e2,steps(e2,3)+2);const c2=e2.ev.find(m=>m.type==='clip');
 ok('capture late: waits for the bar line, then plays it',n0===0&&c2&&e2.tracks[0].clip.id==='t0s1_c2');
 ok('captured steps are the bar that played',c2.clip.slots.map(s=>s.a).join()===[...Array(16).keys()].join());
 const e3=mk({seqLen:2});e3.msg({type:'play'});run(e3,steps(e3,16*3+14));e3.msg({type:'capture',tr:0,id:'x'});run(e3,steps(e3,2)+2);
 ok('2-bar capture in the last quarter waits for the 2-bar window end',(e3.ev.find(m=>m.type==='clip')||{clip:{slots:[]}}).clip.slots.length===32);}

// Bar length changes wait for the track's bar line.
{const e=mk();e.msg({type:'play'});const T=e.tracks[0];run(e,steps(e,5));
 e.msg({type:'range',tr:0,s16:0,e16:12,q:true});const n0=T.n;run(e,steps(e,11)+1);
 ok('bar length change lands on the bar line',n0===16&&T.n===12&&T.barPos===0);
 run(e,steps(e,12));ok('12-step bar loops',T.barPos===0);}

// Overwrite of an existing sequence keeps its length.
{const e=mk({seqLen:2});e.msg({type:'play'});const T=e.tracks[0];
 const clip={id:'o',cols:16,n:16,slots:Array.from({length:32},(_,i)=>({on:true,a:0,off:0,sid:'x'+i,slen:1,fx:[]}))};
 e.msg({type:'launch',tr:0,clip});run(e,steps(e,3));
 e.msg({type:'rec',tr:0,on:true,over:clip});e.msg({type:'touches',tr:0,list:[{id:'t',a:9,n:1,o:1,fx:null}]});run(e,steps(e,40));
 ok('recording over a sequence keeps its length',T.clip.slots.length===32&&T.clip.slots.every(s=>s.a===9));}

// Slice-edge fades: no discontinuities at step boundaries with heavy swing.
{const e=mk();e.msg({type:'swing',s:0.4});e.msg({type:'play'});
 const clip={id:'c',cols:16,n:16,slots:Array.from({length:16},(_,i)=>({on:true,a:(i*7)%16,off:0,sid:'s'+i,slen:1,fx:[]}))};
 e.msg({type:'launch',tr:0,clip});let p1=0,p2=0,worst=0;
 for(let i=0;i<steps(e,64);i++){const t0=e.t;e.render(B,C,128);const sl=e.tracks[0].sl,pair=2*sl,split=Math.round(sl*1.4);
   for(let j=0;j<128;j++){const v=B[j],t=t0+j,m=t%pair,d=Math.abs(v-2*p1+p2);p2=p1;p1=v;if(t>2*e.len&&(m<3||Math.abs(m-split)<3))worst=Math.max(worst,d);}}
 ok('step boundaries are click-free (2nd difference < 0.02)',worst<0.02,worst);}

// Every effect renders without NaN.
{const e=mk();e.msg({type:'play'});let nan=false,pk=0;
 for(const k of ['stutter','random','reverse','freeze','crush','pitch','env','filter']){e.msg({type:'touches',tr:0,list:[{id:k,a:2,n:1,o:1,fx:{k,raw:0.7}}]});
  for(let i=0;i<200;i++){e.render(B,C,128);for(const v of B){if(v!==v)nan=true;pk=Math.max(pk,Math.abs(v));}}}
 ok('all effects render',!nan&&pk>0.01);}
console.log(fails?fails+' failed':'all passed');process.exitCode=fails?1:0;
