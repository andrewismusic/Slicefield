
function mtofHz(n){return 440*Math.pow(2,(n-69)/12);}
function polyblep(t,dt){if(t<dt){t/=dt;return t+t-t*t-1;}if(t>1-dt){t=(t-1)/dt;return t*t+t+t+1;}return 0;}

// Each loop is rendered for two bars and the second bar is kept, so tails and filter states wrap seamlessly.
function makeLoop(kind,sr,bpm){
  const len=Math.round(sr*240/bpm/64)*64,N=len*2,s16=len/16;
  const L=new Float32Array(N),R=new Float32Array(N);
  const fn={break:synthBreak,boombap:synthBoomBap,acid:synthAcid,reese:synthReese,dub:synthDub,lead:synthLead,keys:synthKeys,kalimba:synthKalimba,vox:synthVox}[kind]||synthBreak;
  fn(L,R,sr,s16,N);
  return normalize({L:L.slice(len),R:R.slice(len)});
}
function normalize(b,target=0.82){let pk=1e-6;for(let i=0;i<b.L.length;i++){pk=Math.max(pk,Math.abs(b.L[i]),Math.abs(b.R[i]));}const k=target/pk;for(let i=0;i<b.L.length;i++){b.L[i]*=k;b.R[i]*=k;}return b;}

function synthBreak(L,R,sr,s16,N){
  const swing=s=>s%2?s16*0.12:0;
  const put=(start,dur,fn,pl,pr)=>{const n=Math.floor(dur*sr),st=Math.round(start);for(let k=0;k<n;k++){const i=st+k;if(i>=N)break;const v=fn(k/sr);L[i]+=v*pl;R[i]+=v*pr;}};
  const kick=vel=>{let ph=0;return tt=>{const f=50+120*Math.exp(-tt*30);ph+=2*Math.PI*f/sr;const click=tt<0.004?(Math.random()*2-1)*0.4*(1-tt/0.004):0;return Math.tanh((Math.sin(ph)*Math.exp(-tt*8)+click)*1.8)*0.85*vel;};};
  const snare=vel=>{let lp=0,ph=0;return tt=>{const n=Math.random()*2-1;lp+=(n-lp)*0.25;ph+=2*Math.PI*190/sr;return (Math.sin(ph)*Math.exp(-tt*28)*0.45+(n-lp)*Math.exp(-tt*15)*0.75)*vel;};};
  const hat=(vel,open)=>{let lp=0;return tt=>{const n=Math.random()*2-1;lp+=(n-lp)*0.55;return (n-lp)*Math.exp(-tt*(open?13:65))*0.33*vel;};};
  const kicks=[[0,1],[2,0.75],[10,0.9],[11,0.55]];
  const snares=[[4,1],[7,0.3],[9,0.38],[12,1],[14,0.28],[15,0.5]];
  for(let b=0;b<2;b++){
    const o=b*16*s16;
    for(const [s,v] of kicks)put(o+s*s16+swing(s),0.45,kick(v),1,1);
    for(const [s,v] of snares)put(o+s*s16+swing(s),0.3,snare(v),0.95,1);
    for(let s=0;s<16;s++){const open=s===10;put(o+s*s16+swing(s),open?0.3:0.08,hat(open?0.55:(s%2?0.3:0.6),open),0.7,1);}
  }
}

function synthAcid(L,R,sr,s16,N){
  const seq=[[33,1,0],[33,0,0],[45,0,1],[33,0,0],[36,1,0],null,[33,0,0],[43,0,1],[45,1,0],[33,0,0],[33,0,0],[40,0,1],[43,1,0],[33,0,0],[38,0,0],[45,1,1]];
  let ph=0,f=55,tf=55,s0=0,s1=0,env=0,amp=0,acc=0,last=-1;
  const dA=Math.exp(-1/(sr*0.2)),dN=Math.exp(-1/(sr*0.11));
  for(let i=0;i<N;i++){
    const si=Math.floor(i/s16),idx=si%16,frac=i/s16-si,st=seq[idx];
    if(si!==last){last=si;if(st){const prev=seq[(idx+15)%16];tf=mtofHz(st[0]);if(!(prev&&prev[2])){f=tf;env=1;acc=st[1];}}}
    const gate=st&&(frac<0.55||st[2]);
    amp+=((gate?1:0)-amp)*0.004;
    f+=(tf-f)*0.0025;
    const dt=f/sr;ph+=dt;if(ph>=1)ph-=1;const saw=2*ph-1-polyblep(ph,dt);
    env*=acc?dA:dN;
    const fc=Math.min(sr*0.45,260+(acc?2900:1400)*env),g=Math.tan(Math.PI*fc/sr),k=0.22;
    const a1=1/(1+g*(g+k)),a2=g*a1,a3=g*a2,v3=saw-s1,v1=a1*s0+a2*v3,v2=s1+a2*s0+a3*v3;s0=2*v1-s0;s1=2*v2-s1;
    const y=Math.tanh(v2*(acc?2.4:1.7))*amp*0.6;
    L[i]+=y;R[i]+=y;
  }
}

function synthLead(L,R,sr,s16,N){
  const mel=[[69,2],[72,2],[76,3],[74,1],[72,2],[71,2],[67,2],[69,2]];
  const at=[];let s=0;for(const [n,d] of mel){for(let k=0;k<d;k++)at.push({n,start:s,end:s+d});s+=d;}
  const det=[Math.pow(2,-0.12/12),1,Math.pow(2,0.12/12)],ph=[0,0.33,0.66];
  let f=mtofHz(69),tf=f,fenv=0,amp=0,since=0,lastStart=-1,sl0=0,sl1=0,sr0=0,sr1=0;
  const fd=Math.exp(-1/(sr*0.35));
  for(let i=0;i<N;i++){
    const si=Math.floor(i/s16),e=at[si%16],bar=Math.floor(si/16),start=bar*16+e.start,end=bar*16+e.end;
    if(start!==lastStart){lastStart=start;tf=mtofHz(e.n);fenv=1;since=0;}
    const gate=i/s16<end-0.3;
    amp+=((gate?1:0)-amp)*(gate?0.004:0.0007);
    f+=(tf-f)*0.004;since++;
    const vib=since>sr*0.15?Math.sin(2*Math.PI*5.5*since/sr)*0.15:0,fv=f*Math.pow(2,vib/12);
    const o=[0,0,0];
    for(let v=0;v<3;v++){const dt=fv*det[v]/sr;ph[v]+=dt;if(ph[v]>=1)ph[v]-=1;o[v]=2*ph[v]-1-polyblep(ph[v],dt);}
    fenv*=fd;
    const fc=Math.min(sr*0.45,500+3200*fenv),g=Math.tan(Math.PI*fc/sr),k=0.7,a1=1/(1+g*(g+k)),a2=g*a1,a3=g*a2;
    const xl=o[0]+o[1]*0.6,xr=o[2]+o[1]*0.6;
    let v3=xl-sl1,v1=a1*sl0+a2*v3,v2=sl1+a2*sl0+a3*v3;sl0=2*v1-sl0;sl1=2*v2-sl1;const yl=v2;
    v3=xr-sr1;v1=a1*sr0+a2*v3;v2=sr1+a2*sr0+a3*v3;sr0=2*v1-sr0;sr1=2*v2-sr1;const yr=v2;
    L[i]+=yl*amp*0.3;R[i]+=yr*amp*0.3;
  }
}
function resample(buf,len){const out=new Float32Array(len),r=buf.length/len;for(let i=0;i<len;i++){const x=i*r,k=Math.floor(x),f=x-k,a=buf[k]||0,b=buf[Math.min(buf.length-1,k+1)]||0;out[i]=a+(b-a)*f;}return out;}

// ---- extra demo loops ----
function svfLP(){let a=0,b=0;return (x,fc,sr,k)=>{const g=Math.tan(Math.PI*Math.min(fc,sr*0.45)/sr),a1=1/(1+g*(g+k)),a2=g*a1,a3=g*a2,v3=x-b,v1=a1*a+a2*v3,v2=b+a2*a+a3*v3;a=2*v1-a;b=2*v2-b;return v2;};}
function bandpass(f,q,sr){const w=2*Math.PI*f/sr,al=Math.sin(w)/(2*q),a0=1+al,b0=al/a0,a1=-2*Math.cos(w)/a0,a2=(1-al)/a0;let x1=0,x2=0,y1=0,y2=0;
  return x=>{const y=b0*x-b0*x2-a1*y1-a2*y2;x2=x1;x1=x;y2=y1;y1=y;return y;};}

function synthBoomBap(L,R,sr,s16,N){
  const sw=s=>s%2?s16*0.3:0;
  const put=(start,dur,fn,pl,pr)=>{const n=Math.floor(dur*sr),st=Math.round(start);for(let k=0;k<n&&st+k<N;k++){const v=fn(k/sr);L[st+k]+=v*pl;R[st+k]+=v*pr;}};
  const kick=v=>{let ph=0;return t=>{ph+=2*Math.PI*(45+70*Math.exp(-t*22))/sr;return Math.tanh(Math.sin(ph)*Math.exp(-t*5)*2.2)*0.9*v;};};
  const snare=v=>{let lp=0,ph=0;return t=>{const n=Math.random()*2-1;lp+=(n-lp)*0.18;ph+=2*Math.PI*170/sr;return (Math.sin(ph)*Math.exp(-t*20)*0.5+lp*Math.exp(-t*9)*1.4)*v;};};
  const hat=v=>{let lp=0;return t=>{const n=Math.random()*2-1;lp+=(n-lp)*0.6;return (n-lp)*Math.exp(-t*45)*0.28*v;};};
  for(let b=0;b<2;b++){
    const o=b*16*s16;
    for(const [s,v] of [[0,1],[3,0.5],[7,0.8],[10,0.95]])put(o+s*s16+sw(s),0.6,kick(v),1,1);
    for(const s of [4,12])put(o+s*s16+sw(s),0.35,snare(1),1,0.95);
    put(o+15*s16+sw(15),0.2,snare(0.25),1,1);
    for(let s=0;s<16;s+=2)put(o+s*s16+sw(s),0.07,hat(s%4?0.6:1),0.8,1);
    for(let s=1;s<16;s+=2)put(o+s*s16+sw(s),0.06,hat(0.35),1,0.8);
  }
  // a low upright-ish bass and vinyl crackle
  const lp=svfLP();let ph=0;const notes=[[0,40],[7,43],[10,38]];
  for(let i=0;i<N;i++){
    const st=(i/s16)%16;let n=40;for(const [s,m] of notes)if(st>=s)n=m;
    const since=(st-[...notes].reverse().find(x=>st>=x[0])[0])*s16/sr;
    ph+=mtofHz(n)/sr;ph-=Math.floor(ph);
    const y=lp(Math.sin(2*Math.PI*ph)+0.3*Math.sin(4*Math.PI*ph),400,sr,1)*Math.exp(-since*3)*0.45;
    L[i]+=y;R[i]+=y;
    if(Math.random()<0.0009){const c=(Math.random()*2-1)*0.15;L[i]+=c;R[i]+=c*0.7;}
    const hiss=(Math.random()*2-1)*0.004;L[i]+=hiss;R[i]+=hiss;
  }
}

function synthReese(L,R,sr,s16,N){
  const seq=[[0,28],[6,28],[8,31],[12,26],[14,33]];
  const lpL=svfLP(),lpR=svfLP();const ph=[0,0,0,0];let sub=0,f=mtofHz(28);
  const det=[Math.pow(2,-0.28/12),Math.pow(2,0.28/12),Math.pow(2,-0.11/12),Math.pow(2,0.13/12)];
  for(let i=0;i<N;i++){
    const st=(i/s16)%16;let n=28;for(const [s,m] of seq)if(st>=s)n=m;
    f+=(mtofHz(n)-f)*0.0015;
    const o=[];for(let v=0;v<4;v++){const dt=f*det[v]/sr;ph[v]+=dt;if(ph[v]>=1)ph[v]-=1;o[v]=2*ph[v]-1-polyblep(ph[v],dt);}
    sub+=f/sr;sub-=Math.floor(sub);
    const lfo=0.5+0.5*Math.sin(2*Math.PI*i/(N/4));
    const fc=220+900*lfo*lfo;
    const yl=Math.tanh(lpL(o[0]+o[2]*0.7,fc,sr,0.5)*1.6),yr=Math.tanh(lpR(o[1]+o[3]*0.7,fc,sr,0.5)*1.6);
    const s=Math.sin(2*Math.PI*sub)*0.55;
    L[i]+=yl*0.4+s;R[i]+=yr*0.4+s;
  }
  // a tight two-step beat on top
  const put=(start,dur,fn)=>{const n=Math.floor(dur*sr),st=Math.round(start);for(let k=0;k<n&&st+k<N;k++){const v=fn(k/sr);L[st+k]+=v;R[st+k]+=v;}};
  const kick=()=>{let p=0;return t=>{p+=2*Math.PI*(50+140*Math.exp(-t*40))/sr;return Math.sin(p)*Math.exp(-t*12)*0.8;};};
  const snare=()=>{let lp=0;return t=>{const n=Math.random()*2-1;lp+=(n-lp)*0.35;return (n-lp*0.5)*Math.exp(-t*22)*0.5;};};
  for(let b=0;b<2;b++){const o=b*16*s16;for(const s of [0,10])put(o+s*s16,0.3,kick());for(const s of [4,12])put(o+s*s16,0.25,snare());}
}

function synthDub(L,R,sr,s16,N){
  const chords=[[50,53,57,60],[48,52,55,58]];
  const W=new Float32Array(N);
  for(let b=0;b<2;b++)for(const s of [2,6,10,14]){
    const ch=chords[s<8?0:1],st=Math.round((b*16+s)*s16),n=Math.floor(0.18*sr);
    const ph=ch.map(()=>Math.random());const lp=svfLP();
    for(let k=0;k<n&&st+k<N;k++){
      let x=0;for(let v=0;v<ch.length;v++){const dt=mtofHz(ch[v])/sr;ph[v]+=dt;if(ph[v]>=1)ph[v]-=1;x+=2*ph[v]-1-polyblep(ph[v],dt);}
      const env=Math.exp(-k/sr*18);W[st+k]+=lp(x*0.25,600+3500*env,sr,0.9)*env;
    }
  }
  const d=Math.round(3*s16),M=new Float32Array(N),Rr=new Float32Array(N);
  for(let i=0;i<N;i++){M[i]=W[i];Rr[i]=W[i];}
  for(let i=d;i<N;i++){M[i]+=Rr[i-d]*0.55;Rr[i]+=M[i-d]*0.5;}
  for(let i=0;i<N;i++){L[i]+=M[i]*0.8;R[i]+=Rr[i]*0.8;}
  // sub bass: D . . D . . A . | C . . C . . G .
  const bl=[[0,38],[3,38],[6,45],[8,36],[11,36],[14,43]];let ph=0;
  for(let i=0;i<N;i++){
    const st=(i/s16)%16;let cur=bl[0];for(const x of bl)if(st>=x[0])cur=x;
    const since=st-cur[0],gate=since<2.4?1:0;
    ph+=mtofHz(cur[1])/sr;ph-=Math.floor(ph);
    const y=Math.sin(2*Math.PI*ph)*0.6*gate*Math.min(1,since*s16/(0.005*sr));
    L[i]+=y;R[i]+=y;
  }
  // rimshot on 3, kick on 1
  for(let b=0;b<2;b++){
    let st=Math.round((b*16+8)*s16);for(let k=0;k<0.04*sr;k++){const v=Math.sin(2*Math.PI*1700*k/sr)*Math.exp(-k/sr*90)*0.5;L[st+k]+=v;R[st+k]+=v;}
    st=Math.round(b*16*s16);let p=0;for(let k=0;k<0.4*sr;k++){p+=2*Math.PI*(48+90*Math.exp(-k/sr*30))/sr;const v=Math.sin(p)*Math.exp(-k/sr*7)*0.8;L[st+k]+=v;R[st+k]+=v;}
  }
}

const KEYS_SIN=(()=>{const t=new Float32Array(4096);for(let i=0;i<4096;i++)t[i]=Math.sin(2*Math.PI*i/4096);return t;})();
function synthKeys(L,R,sr,s16,N){
  // FM electric piano, jazzy voicings, auto-pan tremolo
  const hits=[[0,[53,57,60,64,67],1],[3,[53,57,60,64,67],0.5],[6,[52,55,59,62],0.8],[8,[50,53,57,60,64],0.9],[11,[50,53,57,60,64],0.45],[14,[55,59,62,65],0.7]];
  // Both bars are identical, so render one and fold its tails into the kept second bar.
  for(let b=0;b<1;b++)for(const [s,ch,vel] of hits){
    const st=Math.round((b*16+s)*s16),n=Math.min(N-st,Math.floor(1.0*sr));
    for(const m of ch){
      const f=mtofHz(m),pan=0.5+((m%5)-2)*0.08,dp=f/sr,tn=Math.round(0.1*sr);let pc=0,pt=0;
      const S=KEYS_SIN,SM=4095,dI=Math.exp(-6/sr),dA=Math.exp(-2.2/sr),dT=Math.exp(-60/sr);let eI=2.2,eA=1,eT=0.25;
      for(let k=0;k<n;k++){
        pc+=dp;pc-=Math.floor(pc);eI*=dI;eA*=dA;
        let tine=0;if(k<tn){pt+=dp*14;pt-=Math.floor(pt);tine=S[(pt*4096)&SM]*eT;eT*=dT;}
        let mp=pc+(eI+0.25)*S[(pc*4096)&SM]/(2*Math.PI);mp-=Math.floor(mp);
        const v=(S[(mp*4096)&SM]+tine)*eA*0.11*vel*Math.min(1,k/sr*800);
        L[st+k]+=v*(1-pan);R[st+k]+=v*pan;
      }
    }
  }
  const half=N/2;for(let i=0;i<half;i++){L[i+half]+=L[i];R[i+half]+=R[i];}
  for(let i=0;i<N;i++){const tr=Math.sin(2*Math.PI*i/(s16*6))*0.25;L[i]*=1+tr;R[i]*=1-tr;}
}

function synthKalimba(L,R,sr,s16,N){
  // Karplus–Strong plucks on a pentatonic arpeggio
  const notes=[69,72,76,79,81,79,76,72,74,76,81,84,81,76,74,72];
  const vel=[1,0.6,0.8,0.6,1,0.5,0.7,0.5,0.9,0.6,0.8,0.7,1,0.5,0.7,0.5];
  for(let b=0;b<2;b++)for(let s=0;s<16;s++){
    const f=mtofHz(notes[s]),P=Math.max(2,Math.round(sr/f)),buf=new Float32Array(P);
    let lp=0;for(let k=0;k<P;k++){lp+=((Math.random()*2-1)-lp)*0.5;buf[k]=lp;}
    const st=Math.round((b*16+s)*s16),n=Math.min(N-st,Math.floor(1.5*sr)),pan=s%2?0.7:0.3;let idx=0,body=0;
    for(let k=0;k<n;k++){
      const j=(idx+1)%P,y=buf[idx];buf[idx]=(buf[idx]+buf[j])*0.5*0.9965;idx=j;
      body+=(y-body)*0.25;
      const v=(y*0.6+body*0.5)*vel[s]*0.5;
      L[st+k]+=v*(1-pan);R[st+k]+=v*pan;
    }
  }
  // soft shaker
  for(let i=0;i<N;i++){const ph=(i/s16)%2,e=Math.exp(-ph*s16/sr*40)*(Math.floor(i/s16)%2?0.6:1);const n=(Math.random()*2-1)*e*0.04;L[i]+=n;R[i]+=n;}
}

function synthVox(L,R,sr,s16,N){
  // formant-synthesized vocal chops: a pulse train through three vowel formants
  const V={a:[730,1090,2440],e:[530,1840,2480],i:[270,2290,3010],o:[570,840,2410],u:[300,870,2240]};
  const chops=[[0,2,64,'a'],[2,1,67,'o'],[3,2,69,'e'],[6,2,67,'a'],[8,3,72,'i'],[11,1,69,'o'],[12,2,67,'u'],[14,2,64,'a']];
  for(let b=0;b<2;b++)for(const [s,d,m,v] of chops){
    const st=Math.round((b*16+s)*s16),n=Math.min(N-st,Math.round(d*s16*0.92)),fm=V[v];
    const bp=fm.map((f,j)=>bandpass(f,[7,9,11][j],sr)),gain=[1,0.7,0.4];
    let ph=0,lpN=0;
    for(let k=0;k<n;k++){
      const t=k/sr,f=mtofHz(m)*Math.pow(2,(t>0.08?Math.sin(2*Math.PI*5.2*t)*0.25:0)/12);
      ph+=f/sr;let src=0;if(ph>=1){ph-=1;src=1;}
      lpN+=((Math.random()*2-1)-lpN)*0.3;src+=lpN*0.03;
      let y=0;for(let j=0;j<3;j++)y+=bp[j](src)*gain[j];
      const env=Math.min(1,k/(0.01*sr))*Math.min(1,(n-k)/(0.03*sr));
      const out=y*env*1.6;
      L[st+k]+=out;R[st+k]+=out*0.9;
    }
  }
  // gentle kick + clap underneath
  for(let b=0;b<2;b++){
    for(const s of [0,8]){const st=Math.round((b*16+s)*s16);let p=0;for(let k=0;k<0.35*sr;k++){p+=2*Math.PI*(50+110*Math.exp(-k/sr*35))/sr;const v=Math.sin(p)*Math.exp(-k/sr*9)*0.6;L[st+k]+=v;R[st+k]+=v;}}
    for(const s of [4,12]){const st=Math.round((b*16+s)*s16);let lp=0;for(let k=0;k<0.2*sr;k++){const n=Math.random()*2-1;lp+=(n-lp)*0.5;const tt=k/sr,e=(tt<0.03?Math.exp(-(tt%0.01)*300):0)+Math.exp(-tt*25)*0.6;const v=(n-lp)*e*0.25;L[st+k]+=v;R[st+k]+=v;}}
  }
}
