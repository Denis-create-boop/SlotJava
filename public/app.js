// Variable-size continuous reel strips; the server decides wins and balance.
(() => {
  'use strict';
  const root=document.querySelector('.slot-game');
  if(!root)return;

  const form=document.getElementById('slot-spin-form');
  const button=document.getElementById('slot-spin-button');
  const message=document.getElementById('slot-result');
  const balance=document.getElementById('slot-balance');
  const winDisplay=document.getElementById('slot-win');
  const bigWinOverlay=document.getElementById('slot-big-win-overlay');
  const bigWinLabel=document.getElementById('slot-big-win-label');
  const insufficientOverlay=document.getElementById('slot-insufficient-overlay');
  let insufficientTimer=null;
  function showInsufficientFunds(){
    if(!insufficientOverlay)return;
    if(insufficientTimer!==null)window.clearTimeout(insufficientTimer);
    insufficientOverlay.hidden=false;
    insufficientTimer=window.setTimeout(()=>{insufficientOverlay.hidden=true;insufficientTimer=null;},3900);
  }

  const bigWinHome=bigWinOverlay?.parentElement;
  let bigWinTimer=null;
  function hideBigWin(){
    if(bigWinTimer!==null){window.clearTimeout(bigWinTimer);bigWinTimer=null;}
    bigWinOverlay.hidden=true;
    bigWinOverlay.classList.remove('is-visible','is-mega','is-egypt-mega');
    bigWinLabel.textContent='';
    if(bigWinHome&&bigWinOverlay.parentElement!==bigWinHome)
      bigWinHome.append(bigWinOverlay);
  }
  function showBigWin(tier){
    hideBigWin();
    if(tier!=='big'&&tier!=='mega')return;
    bigWinLabel.textContent=tier==='mega'?'ОЧЕНЬ КРУПНЫЙ ВЫИГРЫШ!':'КРУПНЫЙ ВЫИГРЫШ!';
    bigWinOverlay.classList.toggle('is-mega',tier==='mega');
    if(root.classList.contains('slot-theme-egypt')&&tier==='mega'){
      document.body.append(bigWinOverlay);
      bigWinOverlay.classList.add('is-egypt-mega');
    }
    bigWinOverlay.hidden=false;
    bigWinOverlay.classList.add('is-visible');
    bigWinTimer=window.setTimeout(hideBigWin,3800);
  }
  const scatterId=Number(root.dataset.scatterId)||0;
  const bonusTop=document.getElementById('slot-bonus-top');
  const bonusStats=document.getElementById('slot-bonus-stats');
  const bonusMultiplier=document.getElementById('slot-bonus-multiplier');
  const bonusRemaining=document.getElementById('slot-bonus-remaining');
  const bonusTotal=document.getElementById('slot-bonus-total');
  const egyptGamesBadge=document.getElementById('egypt-bonus-games');
  const egyptGamesCount=document.getElementById('egypt-bonus-games-count');
  const winCaption=document.getElementById('slot-win-caption');
  const egyptAccumulated=document.getElementById('egypt-bonus-accumulated');
  const egyptAccumulatedTotal=document.getElementById('egypt-bonus-accumulated-total');
  const egyptRoundPrize=document.getElementById('egypt-round-prize');
  const egyptRoundPrizeValue=document.getElementById('egypt-round-prize-value');
  const egyptRoundPrizeCumulative=document.getElementById('egypt-round-prize-cumulative');
  function showEgyptRoundPrize(amount,total){
    if(!egyptRoundPrize)return;
    if(!(amount>0)){
      egyptRoundPrize.hidden=true;
      egyptRoundPrize.classList.remove('is-revealing');
      return;
    }
    if(egyptRoundPrizeValue)egyptRoundPrizeValue.textContent='+'+amount;
    if(egyptRoundPrizeCumulative)egyptRoundPrizeCumulative.textContent=String(total);
    egyptRoundPrize.hidden=false;
    egyptRoundPrize.classList.remove('is-revealing');
    void egyptRoundPrize.offsetWidth;
    egyptRoundPrize.classList.add('is-revealing');
  }
  const bonusPlus=document.getElementById('slot-bonus-plus');
  const bonusFinish=document.getElementById('slot-bonus-finish');
  const bonusFinishTotal=document.getElementById('slot-bonus-finish-total');
  const spinLabel=document.getElementById('slot-spin-label');
  let bonusActive=root.dataset.bonusActive==='1';
  let audioReady=false;
  bonusFinish?.querySelector('button')?.addEventListener('click',()=>{bonusFinish.hidden=true;});
  function updateBonus(active,remaining=0,multiplier=2,total=0){
    const bonusMusicChanged=bonusActive!==active;
    bonusActive=active;
    root.classList.toggle('is-bonus-active',active);
    if(bonusTop)bonusTop.hidden=!active;
    if(bonusStats)bonusStats.hidden=!active;
    if(egyptGamesBadge)egyptGamesBadge.hidden=!active;
    if(root.classList.contains('slot-theme-egypt')){
      if(!active&&egyptRoundPrize)egyptRoundPrize.hidden=true;
      if(winCaption)winCaption.textContent=active?'За вращение':'Выигрыш';
      if(egyptAccumulated)egyptAccumulated.hidden=!active;
      if(egyptAccumulatedTotal)egyptAccumulatedTotal.textContent=String(total);
    }
    if(bonusMultiplier)bonusMultiplier.textContent='×'+multiplier;
    if(bonusRemaining)bonusRemaining.textContent=String(remaining);
    if(bonusTotal)bonusTotal.textContent=String(total);
    if(spinLabel)spinLabel.textContent=active?'БЕСПЛАТНО':'ВРАЩАТЬ';
    const select=document.getElementById('slot-bet-select');
    if(select)select.disabled=active;
    for(const id of ['slot-bet-minus','slot-bet-plus']){
      const step=document.getElementById(id);
      if(step)step.disabled=active;
    }
    const saveBet=document.querySelector('#slot-bet-form button[type="submit"]');
    if(saveBet)saveBet.disabled=active;
    if(audioReady&&bonusMusicChanged)startBackgroundMusic();
  }
  updateBonus(bonusActive,
    Number(bonusRemaining?.textContent)||0,
    Number(bonusMultiplier?.textContent?.replace('×',''))||2,
    Number(bonusTotal?.textContent)||0);
  function incrementBonusMultiplier(){
    if(!bonusPlus||!bonusMultiplier)return;
    bonusPlus.textContent='+1';
    bonusPlus.classList.remove('is-pop');
    void bonusPlus.offsetWidth;
    bonusPlus.classList.add('is-pop');
    window.setTimeout(()=>bonusPlus.classList.remove('is-pop'),1000);
  }
  const betDisplay=document.getElementById('slot-bet');
  const settingsButton=document.getElementById('slot-settings-trigger');
  const betButton=document.getElementById('slot-bet-trigger');
  const settingsDialog=document.getElementById('slot-settings-dialog');
  const betForm=document.getElementById('slot-bet-form');
  const soundToggle=document.getElementById('slot-sound-toggle');
  const musicVolumeControl=document.getElementById('slot-music-volume');
  const musicVolumeValue=document.getElementById('slot-music-volume-value');
  let musicVolume=65;
  try {
    const savedVolume=Number(window.localStorage.getItem('slotjava-music-volume'));
    if(window.localStorage.getItem('slotjava-music-volume')!==null&&Number.isFinite(savedVolume))
      musicVolume=Math.max(0,Math.min(100,Math.round(savedVolume)));
  } catch {}
  if(musicVolumeControl){
    musicVolumeControl.value=String(musicVolume);
    if(musicVolumeValue)musicVolumeValue.textContent=musicVolume+'%';
    musicVolumeControl.addEventListener('input',()=>{
      musicVolume=Math.max(0,Math.min(100,Number(musicVolumeControl.value)||0));
      if(musicVolumeValue)musicVolumeValue.textContent=musicVolume+'%';
      try{window.localStorage.setItem('slotjava-music-volume',String(musicVolume));}catch{}
      updateMusicVolume();
    });
  }
  let soundEnabled=true;
  // Administrator-selected soundtracks play automatically when available.
  // Users can adjust general sound and volume, but not select the music source.
  try {
    soundEnabled=window.localStorage.getItem('slotjava-sound')!=='off';
  } catch {}
  soundToggle.checked=soundEnabled;
  soundToggle.addEventListener('change',()=>{
    soundEnabled=soundToggle.checked;
    try {window.localStorage.setItem('slotjava-sound',soundEnabled?'on':'off');} catch {}
    if(!soundEnabled){stopEgyptSpinMotor();root.querySelectorAll('audio').forEach(audio=>audio.pause());if(ambientMusicTimer!==null){window.clearInterval(ambientMusicTimer);ambientMusicTimer=null;}updateMusicVolume();}
    else startBackgroundMusic();
  });
  function openSettings(){
    if(spinning)return;
    if(typeof settingsDialog.showModal==='function')settingsDialog.showModal();
    else settingsDialog.setAttribute('open','');
  }
  settingsButton.addEventListener('click',openSettings);
  betButton.addEventListener('click',openSettings);
  settingsDialog.addEventListener('click',event=>{
    if(event.target===settingsDialog)settingsDialog.close();
  });
  const betMinus=document.getElementById('slot-bet-minus');
  const betPlus=document.getElementById('slot-bet-plus');
  const betSelect=document.getElementById('slot-bet-select');
  let savingBet=false;
  function updateBetSteps(){
    const options=Array.from(betSelect?.options||[]).map(option=>Number(option.value));
    const index=options.indexOf(Number(betDisplay.textContent));
    const locked=savingBet||spinning||bonusActive||autoRunning;
    if(betMinus)betMinus.disabled=locked||index<=0;
    if(betPlus)betPlus.disabled=locked||index<0||index>=options.length-1;
  }
  async function saveBet(nextBet,closeDialog=false){
    if(savingBet||spinning||bonusActive||autoRunning){
      if(bonusActive)message.textContent='Во время бонусной игры ставка фиксирована.';
      return;
    }
    const options=Array.from(betSelect.options).map(option=>Number(option.value));
    if(!options.includes(nextBet))return;
    savingBet=true;
    const submit=betForm.querySelector('button[type="submit"]');
    if(submit)submit.disabled=true;
    updateBetSteps();
    try{
      // Reuse the existing form data including the CSRF token, but explicitly
      // send the target bet even when changing it with the side buttons.
      const body=new URLSearchParams(new FormData(betForm));
      body.set('bet',String(nextBet));
      const response=await fetch(betForm.action,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
        body
      });
      const result=await response.json();
      if(!response.ok||!Number.isSafeInteger(result.bet))
        throw new Error(result.error||'Ошибка изменения ставки');
      betDisplay.textContent=String(result.bet);
      betSelect.value=String(result.bet);
      if(closeDialog&&settingsDialog.open)settingsDialog.close();
      message.textContent='Ставка изменена: '+result.bet+' тестовых очков.';
    }catch(error){
      betSelect.value=betDisplay.textContent;
      message.textContent=error.message;
    }finally{
      savingBet=false;
      if(submit)submit.disabled=bonusActive;
      updateBetSteps();
    }
  }
  betForm.addEventListener('submit',event=>{
    event.preventDefault();
    saveBet(Number(betSelect.value),true);
  });
  for(const [button,delta] of [[betMinus,-1],[betPlus,1]]){
    button?.addEventListener('click',()=>{
      const options=Array.from(betSelect.options).map(option=>Number(option.value));
      const index=options.indexOf(Number(betDisplay.textContent));
      const next=options[index+delta];
      if(next!==undefined)saveBet(next);
    });
  }
  // Initialize after the spin/autoplay state declarations below.

  const columns=Array.from(root.querySelectorAll('.reel-column'));
  const reelCount=columns.length;
  const rowCount=Number(root.dataset.rows)||4;
  const isEgypt=root.classList.contains('slot-theme-egypt');
  const isSpace=root.classList.contains('slot-theme-space');
  const wildId=Number(root.dataset.wildId)||0;
  // All symbols selected in the current Egyptian bonus are visibly framed
  // on their reel tiles (not just in the legend above the game).
  const egyptPlayingIds=new Set((root.dataset.egyptSymbols||'').split(',')
    .map(Number).filter(Number.isSafeInteger));
  let egyptFocusedSymbolId=0;
  let egyptReelsHighlightReady=false;
  const egyptPlayedSymbolIds=new Set();
  function setEgyptFocus(id=0){
    egyptFocusedSymbolId=id;
    const presenting=bonusActive&&egyptReelsHighlightReady;
    for(const tile of root.querySelectorAll('.reel-window .ribbon-tile')){
      const tileId=Number(tile.dataset.symbolId);
      const active=presenting&&egyptPlayingIds.has(tileId);
      tile.classList.toggle('is-egypt-bonus-symbol',active);
      tile.classList.toggle('is-egypt-focus',active&&tileId===id);
      // While ONE symbol pays, all other selected symbols step into the
      // background. Between payouts, only completed symbols stay muted.
      const muted=active&&(id>0?tileId!==id:egyptPlayedSymbolIds.has(tileId));
      tile.classList.toggle('is-egypt-inactive',muted);
      tile.classList.toggle('is-egypt-landed',active&&!muted&&tileId!==id);
    }
  }
  const egyptStarterArt=new Set([
    'Фараон','Клеопатра','Анубис','Анкх','10','J','Q','K','A','Скарабей','SCATTER'
  ]);
  const definitions=Array.from(document.querySelectorAll('[data-symbol-def]')).map(node=>{
    const name=node.dataset.name||'Символ';
    const defaultImage=node.dataset.defaultImage||'';
    let image=node.dataset.image||'';
    // Only repair missing/legacy starter art explicitly allowed by the server.
    // Keep administrator-selected images and deliberately deleted art intact.
    const legacy=image.startsWith('/static/images/egypt/symbols.svg#');
    if(isEgypt&&defaultImage&&(!image||legacy)){
      image=defaultImage;
      if(!node.dataset.image)console.warn('[SlotJava] Egyptian image link missing, using starter artwork:',name);
    }
    return {id:Number(node.dataset.symbolId),name,image,defaultImage};
  }).filter(item=>Number.isSafeInteger(item.id));
  if(isEgypt){
    console.info('[SlotJava] Egypt artwork check v3; symbols:',definitions.map(({id,name,image})=>({id,name,image})));
    if(definitions.some(item=>egyptStarterArt.has(item.name)&&!item.image)){
      console.warn('[SlotJava] Egyptian image links missing in server-rendered definitions.');
    }
  }
  // Load and decode images before revealing the game field. The overlay is
  // server-rendered, so it appears immediately, before this script starts.
  const loadingScreen=document.getElementById('slot-loading-screen');
  const loadingFill=document.getElementById('slot-loading-fill');
  async function preloadGameImages(){
    if(!loadingScreen)return;
    const paths=new Set();
    const include=url=>{
      if(!url||url==='none'||url.startsWith('data:'))return;
      try{
        const full=new URL(url,window.location.href);
        if(full.origin===window.location.origin)paths.add(full.href);
      }catch(error){console.warn('Invalid game image URL:',url,error);}
    };
    for(const symbol of definitions)include(symbol.image);
    root.querySelectorAll('img[src]').forEach(img=>include(img.getAttribute('src')));
    // Also preload decorative images injected through CSS backgrounds.
    // The computed styles include per-cell backgrounds set in the admin.
    const nodes=[root,...root.querySelectorAll('*')];
    for(const node of nodes){
      const bg=window.getComputedStyle(node).backgroundImage;
      if(!bg||bg==='none')continue;
      const matches=bg.matchAll(/url\(["']?([^"')]+)["']?\)/g);
      for(const match of matches)include(match[1]);
    }
    const urls=[...paths];
    const total=urls.length;
    if(!total){
      loadingScreen.hidden=true;
      root.removeAttribute('aria-busy');
      return;
    }
    let done=0,failed=0,timedOut=false;
    const update=()=>{
      const percent=Math.round(done/total*100);
      if(loadingFill)loadingFill.style.width=percent+'%';
    };
    update();
    const tasks=urls.map(url=>new Promise(resolve=>{
      const img=new Image();
      let settled=false;
      const finish=ok=>{
        if(settled)return;
        settled=true;
        if(!ok)failed++;
        done++;
        update();
        resolve();
      };
      img.onload=()=>{
        if(typeof img.decode==='function'){
          img.decode().then(()=>finish(true),()=>finish(false));
        }else finish(true);
      };
      img.onerror=()=>finish(false);
      img.src=url;
      if(img.complete){
        if(img.naturalWidth>0)img.onload();
        else if(img.naturalWidth===0)img.onerror();
      }
    }));
    // Broken or stalled assets must never leave an unclosable overlay.
    await Promise.race([
      Promise.all(tasks),
      new Promise(resolve=>window.setTimeout(()=>{timedOut=true;resolve();},20000))
    ]);
    if(timedOut||failed){
      console.warn('[SlotJava] Image preload incomplete', {failed,done,total,timedOut});
      await new Promise(resolve=>window.setTimeout(resolve,900));
    }
    loadingScreen.classList.add('is-ready');
    await new Promise(resolve=>window.setTimeout(resolve,300));
    loadingScreen.hidden=true;
    root.removeAttribute('aria-busy');
  }
  // Start asynchronously; regular game setup continues behind the overlay.
  void preloadGameImages().catch(error=>{
    console.error('[SlotJava] Image preload failed:',error);
    if(loadingScreen)loadingScreen.hidden=true;
    root.removeAttribute('aria-busy');
  });

  const symbols=new Map(definitions.map(item=>[item.id,item]));
  const regularDefinitions=definitions.filter(item=>item.id!==scatterId);
  const sound=name=>root.querySelector('[data-sound="'+name+'"]');
  const classicSounds=root.classList.contains('slot-theme-classic')||root.dataset.scatterId!=='0';
  const egyptSounds=root.classList.contains('slot-theme-egypt');
  let audioContext=null;
  let ambientMusicTimer=null;
  let ambientStep=0;
  let ambientGain=null;
  function updateMusicVolume(){
    if(music)music.volume=Math.min(1,musicVolume/100);
    if(bonusMusic)bonusMusic.volume=Math.min(1,musicVolume/100);
    if(ambientGain&&audioContext){
      ambientGain.gain.setTargetAtTime(soundEnabled&&!useUploadedMusic?musicVolume/100:0,audioContext.currentTime,.12);
    }
  }
  function getAudioContext(){
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return null;
    audioContext??=new AudioCtx();
    if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
    return audioContext;
  }
  function synthesizedNote(hz,at,duration,volume=.035,type='sine'){
    const ctx=getAudioContext();
    if(!ctx)return;
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type=type;
    osc.frequency.setValueAtTime(hz,at);
    gain.gain.setValueAtTime(.0001,at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),at+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);osc.stop(at+duration+.02);
  }
  // Original rock stingers for the classic slot; do not affect uploaded sound assets.
  function playGeneratedSound(name){
    if((!classicSounds&&!egyptSounds)||!soundEnabled||name==='music')return;
    if(egyptSounds){
      const ctx=getAudioContext();
      if(!ctx)return;
      const t=ctx.currentTime+.01;
      const hit=(hz,at,duration,level=.07,wave='triangle')=>{
        const osc=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
        osc.type=wave;osc.frequency.value=hz;
        filter.type='lowpass';filter.frequency.value=1400;
        gain.gain.setValueAtTime(.0001,at);
        gain.gain.exponentialRampToValueAtTime(level,at+.012);
        gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
        osc.connect(filter).connect(gain).connect(ctx.destination);
        osc.start(at);osc.stop(at+duration+.01);
      };
      if(name==='bonus_sound'){
        [0,.14,.28,.42,.56,.7].forEach((offset,i)=>hit(i%2?145:98,t+offset,.18,.065,'sawtooth'));
        [220,261.63,329.63,440].forEach((hz,i)=>hit(hz,t+.45+i*.15,.45,.045));
      }else if(name==='win_sound'||name==='big_win_sound'||name==='mega_win_sound'){
        // Clearly audible ascending win fanfare, distinct from temple music.
        const extended=name==='mega_win_sound'?6:name==='big_win_sound'?5:4;
        [293.66,392,493.88,587.33,783.99,987.77].slice(0,extended)
          .forEach((hz,i)=>hit(hz,t+i*.115,i===extended-1?.82:.26,.105,'triangle'));
        hit(110,t,.32,.115,'sawtooth');
      }else{hit(123.47,t,.15,.055);hit(185,t+.12,.18,.05);}
      return;
    }
    try{
      const ctx=getAudioContext();
      if(!ctx)return;
      const t0=ctx.currentTime+.015;
      function guitar(frequency,offset,duration=.25,level=.065){
        const at=t0+offset;
        // Fifth + octave: a compact power chord, with soft-clipped harmonics.
        const tone=ctx.createGain(),filter=ctx.createBiquadFilter(),drive=ctx.createWaveShaper();
        filter.type='lowpass';filter.frequency.value=2200;filter.Q.value=.6;
        const curve=new Float32Array(1024);
        for(let i=0;i<curve.length;i++){
          const x=(i/(curve.length-1))*2-1;
          curve[i]=Math.tanh(x*3.4)/Math.tanh(3.4);
        }
        drive.curve=curve;drive.oversample='2x';
        tone.gain.setValueAtTime(.0001,at);
        tone.gain.exponentialRampToValueAtTime(level,at+.012);
        tone.gain.exponentialRampToValueAtTime(Math.max(.0002,level*.24),at+duration*.55);
        tone.gain.exponentialRampToValueAtTime(.0001,at+duration);
        drive.connect(filter).connect(tone).connect(ctx.destination);
        for(const [ratio,amount] of [[1,.23],[1.5,.16],[2,.10]]){
          const osc=ctx.createOscillator(),mix=ctx.createGain();
          osc.type='sawtooth';osc.frequency.setValueAtTime(frequency*ratio,at);
          mix.gain.value=amount;
          osc.connect(mix).connect(drive);
          osc.start(at);osc.stop(at+duration+.025);
        }
      }
      function kick(offset,level=.13){
        const at=t0+offset,osc=ctx.createOscillator(),amp=ctx.createGain();
        osc.type='sine';
        osc.frequency.setValueAtTime(145,at);
        osc.frequency.exponentialRampToValueAtTime(48,at+.13);
        amp.gain.setValueAtTime(.0001,at);
        amp.gain.exponentialRampToValueAtTime(level,at+.009);
        amp.gain.exponentialRampToValueAtTime(.0001,at+.19);
        osc.connect(amp).connect(ctx.destination);
        osc.start(at);osc.stop(at+.2);
      }
      function snare(offset,level=.065){
        const at=t0+offset,duration=.13;
        const sampleCount=Math.floor(ctx.sampleRate*duration);
        const buffer=ctx.createBuffer(1,sampleCount,ctx.sampleRate);
        const samples=buffer.getChannelData(0);
        for(let i=0;i<sampleCount;i++)samples[i]=Math.random()*2-1;
        const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),amp=ctx.createGain();
        noise.buffer=buffer;
        filter.type='highpass';filter.frequency.value=950;
        amp.gain.setValueAtTime(level,at);
        amp.gain.exponentialRampToValueAtTime(.0001,at+duration);
        noise.connect(filter).connect(amp).connect(ctx.destination);
        noise.start(at);noise.stop(at+duration);
      }
      if(name==='bonus_sound'){
        // Urgent two-bar rock fill before free spins begin.
        [0,.18,.36,.54,.72,.90].forEach((offset,i)=>{
          if(i%2===0)kick(offset,.13);
          else snare(offset,.075);
        });
        guitar(82.41,0,.32,.060);     // low E power chord
        guitar(98,.36,.32,.065);      // G
        guitar(110,.72,.65,.082);     // A, sustained resolution
        kick(.72,.16);snare(.90,.09);
        return;
      }
      if(name==='win_sound'||name==='big_win_sound'||name==='mega_win_sound'){
        const big=name!=='win_sound',mega=name==='mega_win_sound';
        const notes=mega?[110,130.81,146.83,164.81,220]:
          big?[110,130.81,146.83,164.81]:
          [110,146.83,164.81];
        const step=mega?.135:.16;
        notes.forEach((hz,i)=>guitar(hz,i*step,i===notes.length-1?(mega?.9:big?.7:.46):.24,mega?.078:big?.071:.055));
        kick(0,big?.115:.08);
        if(big)snare(step*2,.07);
        if(mega){kick(step*4,.13);snare(step*3,.08);}
        return;
      }
      // For other generated events retain a modest low chime.
      synthesizedNote(220,t0,.18,.024,'triangle');
    }catch(error){
      console.warn('Rock sound unavailable:',error);
    }
  }

  // Original double "BOOM—BOOM" impact for the Egyptian mega-win.
  // Works without any uploaded audio; respects the sound toggle.
  function playEgyptMegaBoom(){
    if(!soundEnabled||!root.classList.contains('slot-theme-egypt'))return;
    try{
      const ctx=getAudioContext();
      if(!ctx)return;
      for(const offset of [0,.42]){
        const at=ctx.currentTime+.02+offset;
        const bass=ctx.createOscillator(),volume=ctx.createGain();
        bass.type='sine';
        bass.frequency.setValueAtTime(130,at);
        bass.frequency.exponentialRampToValueAtTime(32,at+.38);
        volume.gain.setValueAtTime(.0001,at);
        volume.gain.exponentialRampToValueAtTime(.22,at+.016);
        volume.gain.exponentialRampToValueAtTime(.0001,at+.55);
        bass.connect(volume).connect(ctx.destination);
        bass.start(at);bass.stop(at+.56);
        const duration=.35,buffer=ctx.createBuffer(1,Math.floor(ctx.sampleRate*duration),ctx.sampleRate);
        const data=buffer.getChannelData(0);
        for(let i=0;i<data.length;i++)
          data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,2);
        const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
        noise.buffer=buffer;filter.type='lowpass';filter.frequency.value=380;
        gain.gain.setValueAtTime(.0001,at);
        gain.gain.exponentialRampToValueAtTime(.12,at+.012);
        gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
        noise.connect(filter).connect(gain).connect(ctx.destination);
        noise.start(at);noise.stop(at+duration);
      }
    }catch(error){console.warn('Mega boom unavailable:',error);}
  }
  // Built-in Egyptian reel motor (continuous until the final reel stops).
  // Files uploaded in the admin still take priority if available.
  let egyptSpinMotor=null;
  function startEgyptSpinMotor(){
    if(!soundEnabled||!egyptSounds||egyptSpinMotor)return;
    const ctx=getAudioContext();
    if(!ctx)return;
    try{
      const size=2*ctx.sampleRate;
      const buffer=ctx.createBuffer(1,size,ctx.sampleRate);
      const noiseData=buffer.getChannelData(0);
      for(let i=0;i<size;i++)noiseData[i]=(Math.random()*2-1)*.55;
      const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),
        motor=ctx.createOscillator(),harmonic=ctx.createOscillator(),
        master=ctx.createGain(),noiseGain=ctx.createGain(),
        motorGain=ctx.createGain(),harmonicGain=ctx.createGain();
      noise.buffer=buffer;noise.loop=true;
      filter.type='lowpass';filter.frequency.value=490;filter.Q.value=.6;
      noiseGain.gain.value=.11;
      motor.type='sawtooth';motor.frequency.value=85;
      motorGain.gain.value=.027;
      harmonic.type='sine';harmonic.frequency.value=133;
      harmonicGain.gain.value=.025;
      master.gain.setValueAtTime(.0001,ctx.currentTime);
      master.gain.linearRampToValueAtTime(.46,ctx.currentTime+.25);
      noise.connect(filter).connect(noiseGain).connect(master);
      motor.connect(motorGain).connect(master);
      harmonic.connect(harmonicGain).connect(master);
      master.connect(ctx.destination);
      const start=ctx.currentTime+.015;
      noise.start(start);motor.start(start);harmonic.start(start);
      egyptSpinMotor={sources:[noise,motor,harmonic],master,ctx};
    }catch(error){
      console.warn('Egypt reel motor sound unavailable:',error);
      egyptSpinMotor=null;
    }
  }
  function stopEgyptSpinMotor(){
    const active=egyptSpinMotor;
    if(!active)return;
    egyptSpinMotor=null;
    const t=active.ctx.currentTime;
    active.master.gain.cancelScheduledValues(t);
    active.master.gain.setTargetAtTime(0,t,.11);
    for(const source of active.sources){
      try{source.stop(t+.48);}catch{}
    }
  }
  function play(name){
    if(!soundEnabled)return;
    const audio=sound(name);
    if(name==='spin_sound'&&egyptSounds){
      // Even with no uploaded file, rolling audio keeps playing for the full
      // spin, rather than the short stinger that used to fire once.
      if(!audio){startEgyptSpinMotor();return;}
    }
    if(!audio){playGeneratedSound(name);return;}
    try{
      audio.currentTime=0;
      const playback=audio.play();
      if(playback?.catch)playback.catch(error=>{
        console.warn('Uploaded sound failed, using synthesized fallback:',name,error);
        if(name==='spin_sound'&&egyptSounds)startEgyptSpinMotor();
        else playGeneratedSound(name);
      });
    }catch(error){
      if(name==='spin_sound'&&egyptSounds)startEgyptSpinMotor();
      else playGeneratedSound(name);
    }
  }
  const music=sound('music');
  const bonusMusic=sound('bonus_music');
  if(music)music.loop=true;
  if(bonusMusic)bonusMusic.loop=true;
  audioReady=true;
  updateMusicVolume();
  const spinningAudio=sound('spin_sound');
  if(spinningAudio){spinningAudio.loop=true;spinningAudio.volume=.8;}
  function startBackgroundMusic(){
    if(!soundEnabled)return;
    const chosenMusic=bonusActive&&bonusMusic?bonusMusic:music;
    if(chosenMusic){
      if(music&&music!==chosenMusic&&!music.paused){music.pause();music.currentTime=0;}
      if(bonusMusic&&bonusMusic!==chosenMusic&&!bonusMusic.paused){bonusMusic.pause();bonusMusic.currentTime=0;}
      if(ambientMusicTimer!==null){window.clearInterval(ambientMusicTimer);ambientMusicTimer=null;}
      if(ambientGain&&audioContext)ambientGain.gain.setTargetAtTime(0,audioContext.currentTime,.12);
      if(chosenMusic.paused)try{const promise=chosenMusic.play();if(promise?.catch)promise.catch(()=>{});}catch{}
      return;
    }
    if(music&&!music.paused)music.pause();
    if(bonusMusic&&!bonusMusic.paused)bonusMusic.pause();
    if(egyptSounds){
      if(ambientMusicTimer!==null)return;
      const ctx=getAudioContext();if(!ctx)return;
      if(!ambientGain){
        ambientGain=ctx.createGain();
        ambientGain.gain.value=0;
        ambientGain.connect(ctx.destination);
      }
      updateMusicVolume();
      // Original temple soundtrack: pentatonic reed, plucked strings and low frame drum.
      const note=(hz,at,duration,volume,wave='triangle',cutoff=1300)=>{
        const osc=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
        osc.type=wave;osc.frequency.setValueAtTime(hz,at);
        filter.type='lowpass';filter.frequency.value=cutoff;
        gain.gain.setValueAtTime(.0001,at);
        gain.gain.linearRampToValueAtTime(volume,at+.035);
        gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
        osc.connect(filter).connect(gain).connect(ambientGain);
        osc.start(at);osc.stop(at+duration+.03);
      };
      const phrases=[
        [293.66,349.23,392,440,392,349.23],
        [261.63,293.66,349.23,392,349.23,293.66],
        [220,261.63,293.66,349.23,293.66,261.63],
        [246.94,293.66,349.23,392,349.23,293.66]
      ];
      const playTemple=()=>{
        if(!soundEnabled)return;
        const t=ctx.currentTime+.05,melody=phrases[ambientStep%phrases.length];
        const bass=[73.42,65.41,55,61.74][ambientStep%4];
        note(bass,t,3.8,.065,'sine',260);
        melody.forEach((hz,i)=>{
          note(hz,t+i*.58,.48,.037,'triangle',1250);
          if(i%2===0)note(hz/2,t+i*.58,.3,.022,'sawtooth',450);
        });
        [0,.9,1.8,2.7].forEach((offset,i)=>{
          note(90,t+offset,.18,i===0?.085:.06,'sine',180);
          if(i===1||i===3)note(170,t+offset+.14,.12,.026,'triangle',550);
        });
        ambientStep++;
      };
      playTemple();
      ambientMusicTimer=window.setInterval(playTemple,3800);
      return;
    }
    if(!classicSounds||ambientMusicTimer!==null)return;
    // Updated built-in soundtrack: dark minor-key bass, chords and guitar.
    // Audio starts after user interaction; sounds are synthesized, not borrowed.
    const ctx=getAudioContext();
    if(!ctx)return;
    if(!ambientGain){
      ambientGain=ctx.createGain();
      ambientGain.gain.value=0;
      ambientGain.connect(ctx.destination);
    }
    updateMusicVolume();
    // Original dark minor-key rock ambience; custom admin music overrides it.
    const harmony=[
      {bass:110.00,chord:[220,261.63,329.63]},
      {bass:98.00,chord:[196,233.08,293.66]},
      {bass:87.31,chord:[174.61,220,261.63]},
      {bass:98.00,chord:[196,246.94,293.66]}
    ];
    const tone=(hz,at,duration,level,wave,cutoff,attack=.25)=>{
      const osc=ctx.createOscillator(),envelope=ctx.createGain(),filter=ctx.createBiquadFilter();
      osc.type=wave;osc.frequency.setValueAtTime(hz,at);
      filter.type='lowpass';filter.frequency.value=cutoff;
      envelope.gain.setValueAtTime(.0001,at);
      envelope.gain.linearRampToValueAtTime(level,at+attack);
      envelope.gain.setTargetAtTime(.0001,at+duration-.45,.23);
      osc.connect(filter).connect(envelope).connect(ambientGain);
      osc.start(at);osc.stop(at+duration+.1);
    };
    // Gentle, low-volume distorted power-chord riff behind the ambient layers.
    const guitarPluck=(hz,at,duration=.34)=>{
      const osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),
        drive=ctx.createWaveShaper(),envelope=ctx.createGain();
      const curve=new Float32Array(256);
      for(let i=0;i<curve.length;i++){
        const x=i*2/(curve.length-1)-1;
        curve[i]=Math.tanh(x*2.7);
      }
      drive.curve=curve;drive.oversample='2x';
      osc.type='sawtooth';osc.frequency.setValueAtTime(hz,at);
      filter.type='lowpass';filter.frequency.value=1420;
      envelope.gain.setValueAtTime(.0001,at);
      envelope.gain.linearRampToValueAtTime(.060,at+.11);
      envelope.gain.setValueAtTime(.052,at+Math.max(.12,duration-.29));
      envelope.gain.exponentialRampToValueAtTime(.0001,at+duration);
      osc.connect(drive).connect(filter).connect(envelope).connect(ambientGain);
      osc.start(at);osc.stop(at+duration+.02);
    };
    const playMeasure=()=>{
      if(!soundEnabled)return;
      const chord=harmony[ambientStep%harmony.length];
      const start=ctx.currentTime+.05;
      // Deep bass and restrained minor chords under the guitar rhythm.
      tone(chord.bass,start,4.15,.055,'sawtooth',285,.8);
      tone(chord.bass/2,start,4.15,.035,'sine',220,.8);
      chord.chord.forEach((hz,index)=>tone(hz,start+index*.08,4.12,.032,'triangle',850,1.05));
      // Sparse low percussive pulses replace the former high flute melody.
      [0,1.04,2.08,3.12].forEach((offset,index)=>{
        tone(chord.bass/2,start+offset,.34,index===0?.10:.065,'sine',210,.018);
        if(index===1||index===3)tone(chord.bass*2,start+offset+.14,.28,.013,'triangle',440,.025);
      });
      // Longer connected guitar notes, overlapping rather than sharp staccato.
      const riff=[0,1.06,2.13,3.15];
      riff.forEach((offset,index)=>{
        const root=chord.bass*(index===2?2:1);
        const duration=index===3?1.02:1.27;
        guitarPluck(root,start+offset,duration);
        guitarPluck(root*1.5,start+offset+.04,duration);
        guitarPluck(root*2,start+offset+.09,duration*.9);
      });
      // Rare, original synthesized devil-like howl during ordinary play only.
      if(!bonusActive&&ambientStep>2&&Math.random()<.055){
        const at=start+1.2;
        const howl=ctx.createOscillator(),filter=ctx.createBiquadFilter(),
          voiceGain=ctx.createGain();
        howl.type='sawtooth';
        howl.frequency.setValueAtTime(155,at);
        howl.frequency.exponentialRampToValueAtTime(235,at+.62);
        howl.frequency.exponentialRampToValueAtTime(110,at+1.55);
        filter.type='lowpass';filter.frequency.setValueAtTime(540,at);
        filter.frequency.linearRampToValueAtTime(1050,at+.55);
        filter.frequency.linearRampToValueAtTime(400,at+1.55);
        voiceGain.gain.setValueAtTime(.0001,at);
        voiceGain.gain.linearRampToValueAtTime(.16,at+.28);
        voiceGain.gain.setValueAtTime(.13,at+1);
        voiceGain.gain.exponentialRampToValueAtTime(.0001,at+1.7);
        howl.connect(filter).connect(voiceGain).connect(ambientGain);
        howl.start(at);howl.stop(at+1.75);
      }
      ambientStep++;
    };
    playMeasure();
    ambientMusicTimer=window.setInterval(playMeasure,4150);
  }
  function stopSpinSound(){
    stopEgyptSpinMotor();
    const reelSound=sound('spin_sound');
    if(reelSound){reelSound.pause();reelSound.currentTime=0;}
  }

  function sample(){
    const pool=regularDefinitions.length?regularDefinitions:definitions;
    return pool[Math.floor(Math.random()*pool.length)].id;
  }
  function makeTile(id){
    const symbol=symbols.get(id);
    const tile=document.createElement('div');
    const egyptSelected=isEgypt&&bonusActive&&egyptReelsHighlightReady&&egyptPlayingIds.has(id);
    const egyptFocused=egyptSelected&&egyptFocusedSymbolId===id;
    const egyptMuted=egyptSelected&&!egyptFocused&&
      (egyptFocusedSymbolId>0||egyptPlayedSymbolIds.has(id));
    tile.className='ribbon-tile'+(id===scatterId?' is-scatter':'')+
      (egyptSelected?' is-egypt-bonus-symbol':'')+
      (egyptFocused?' is-egypt-focus':'')+
      (egyptMuted?' is-egypt-inactive':'')+
      (egyptSelected&&!egyptMuted&&!egyptFocused?' is-egypt-landed':'');
    tile.dataset.symbolId=String(id);
    tile.setAttribute('aria-label',symbol?.name||'Символ '+id);
    if(symbol?.image){
      const img=document.createElement('img');
      img.src=symbol.image;
      img.alt='';
      img.draggable=false;
      tile.append(img);
    }else{
      const text=document.createElement('span');
      text.className='ribbon-symbol-fallback';
      text.textContent=symbol?.name||String(id);
      tile.append(text);
    }
    return tile;
  }
  function buildStrip(ids){
    const fragment=document.createDocumentFragment();
    ids.forEach(id=>fragment.append(makeTile(id)));
    return fragment;
  }
  function showStatic(col,ids){
    const track=col.querySelector('.reel-track');
    track.style.transition='none';
    track.style.transform='translate3d(0,0,0)';
    track.replaceChildren(buildStrip(ids));
  }

  if(definitions.length){
    columns.forEach(col=>showStatic(col,Array.from({length:rowCount},sample)));
  }else{
    message.textContent='В игре пока нет символов. Добавьте их через админку.';
    button.disabled=true;
  }

  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // One request per spin. Quick stop only short-circuits the reel animation;
  // the already-authoritative server result and all payout handling remain.
  let quickStopRequested=false;
  let reelMotionActive=false;
  const finishReelAnimations=new Set();
  function quickStopReels(){
    if(!spinning||quickStopRequested)return;
    quickStopRequested=true;
    reelMotionActive=false;
    if(spinLabel)spinLabel.textContent='СТОП';
    button.disabled=true;
    button.setAttribute('aria-label','Барабаны останавливаются');
    stopSpinSound();
    for(const finish of Array.from(finishReelAnimations))finish();
  }
  function setSpinButton(spinningNow){
    if(spinningNow){
      button.disabled=false;
      button.setAttribute('aria-label','Остановить вращение барабанов');
      if(spinLabel)spinLabel.textContent='СТОП';
      button.classList.add('is-spin-stoppable');
    }else{
      button.disabled=false;
      button.setAttribute('aria-label','Вращать барабаны');
      if(spinLabel)spinLabel.textContent=bonusActive?'БЕСПЛАТНО':'ВРАЩАТЬ';
      button.classList.remove('is-spin-stoppable');
    }
  }
  function animateColumn(col,index,finalIds,options={}){
    if(reducedMotion){
      showStatic(col,finalIds);
      return Promise.resolve();
    }
    const track=col.querySelector('.reel-track');
    const view=col.querySelector('.reel-window');
    const rowHeight=view.getBoundingClientRect().height/rowCount;
    // A suspense reel needs a longer REAL symbol strip so it can spin at
    // constant high speed until its own turn to brake. Later reels get more
    // tiles rather than stretching a short animation over more seconds.
    const suspense=options.suspense;
    const accelAt=suspense?.accelerateAt??0;
    const brakeAt=suspense?.brakeAt??0;
    const delay=options.delay??index*160;
    const cruiseCells=suspense?Math.max(6,Math.ceil((accelAt-delay)*.0055)):0;
    const fastCells=suspense?Math.max(6,Math.ceil((brakeAt-accelAt)*.014)):0;
    const brakeCells=suspense?6:0;
    const extra=suspense?cruiseCells+fastCells+brakeCells-rowCount:16+index*3;
    // Keep the ACTUAL four visible tile nodes as the tail of the moving
    // ribbon. At the negative starting offset those same nodes occupy the
    // exact screen positions they occupied before the player pressed SPIN.
    // As the ribbon moves down, they leave naturally; new tiles follow them.
    const oldTiles=Array.from(track.children).slice(0,rowCount);
    const existing=oldTiles.length===rowCount
      ?oldTiles:Array.from({length:rowCount},()=>makeTile(sample()));
    const middle=Array.from({length:extra},sample);
    // Wild spins on the same moving ribbon as every other ordinary tile.
    if(isSpace&&wildId&&symbols.has(wildId)&&middle.length)
      middle[Math.floor(middle.length/2)]=wildId;
    const incoming=buildStrip(finalIds.concat(middle));
    track.style.transition='none';
    track.replaceChildren(incoming,...existing);
    const startY=-(extra+rowCount)*rowHeight;
    track.style.transform='translate3d(0,'+startY+'px,0)';
    void track.offsetHeight;
    return new Promise(resolve=>{
      const duration=options.duration??(1400+index*170);
      let startTimer=null,endTimer=null,completed=false,motion=null;
      const finish=()=>{
        if(completed)return;
        completed=true;
        if(startTimer!==null)window.clearTimeout(startTimer);
        if(endTimer!==null)window.clearTimeout(endTimer);
        if(motion){motion.cancel();motion=null;}
        finishReelAnimations.delete(finish);
        // Skip the transition and show the EXACT server-selected cells.
        track.style.transition='none';
        track.style.transform='translate3d(0,0,0)';
        track.replaceChildren(...Array.from(track.children).slice(0,rowCount));
        resolve();
      };
      finishReelAnimations.add(finish);
      if(quickStopRequested){finish();return;}
      startTimer=window.setTimeout(()=>{
        if(quickStopRequested){finish();return;}
        if(suspense&&typeof track.animate==='function'){
          // All waiting reels accelerate at the SAME moment. The first one
          // starts braking while the others still travel at identical FAST
          // speed; the next brakes only after the previous reel has stopped.
          const accelerateOffset=(accelAt-delay)/duration;
          const brakeOffset=(brakeAt-delay)/duration;
          const at=cells=>'translate3d(0,'+(-cells*rowHeight)+'px,0)';
          motion=track.animate([
            {offset:0,transform:at(cruiseCells+fastCells+brakeCells),easing:'linear'},
            {offset:accelerateOffset,transform:at(fastCells+brakeCells),easing:'linear'},
            {offset:brakeOffset,transform:at(brakeCells),easing:'cubic-bezier(.12,.72,.18,1)'},
            {offset:1,transform:at(0)}
          ],{duration,fill:'forwards',easing:'linear'});
        }else{
          track.style.transition='transform '+duration+'ms cubic-bezier(.16,.66,.13,1)';
          track.style.transform='translate3d(0,0,0)';
        }
        endTimer=window.setTimeout(finish,duration+50);
      },delay);
    });
  }

  // Egypt SCATTER anticipation: use the server-settled result to determine
  // when the second SCATTER is approaching its stop. This changes ONLY the
  // visual schedule: winning odds and the final cells never change.
  async function animateEgyptScatterSuspense(cells){
    reelMotionActive=true;
    if(quickStopRequested){
      columns.forEach((col,index)=>showStatic(col,
        Array.from({length:rowCount},(_,row)=>cells[row*reelCount+index])));
      reelMotionActive=false;
      return;
    }
    const scatterReels=columns.map((_,reel)=>reel)
      .filter(reel=>Array.from({length:rowCount},(_,row)=>cells[row*reelCount+reel]).includes(scatterId));
    const secondScatter=scatterId&&scatterReels.length>=2?scatterReels[1]:-1;
    // ALL still-moving reels to the right keep spinning, even when their
    // configured Scatter probability is zero. Their odds are unchanged.
    const waitingReels=secondScatter>=0
      ?columns.map((_,i)=>i).filter(i=>i>secondScatter):[];
    const anticipation=waitingReels.length>0&&!reducedMotion;
    const overlays=new Map();
    // After the second landed SCATTER all eligible reels accelerate together.
    // Each reel begins braking only AFTER the previous reel has finished.
    const baseDelay=index=>index*220;
    const baseDuration=index=>1750+index*230;
    const secondStop=anticipation
      ?baseDelay(secondScatter)+baseDuration(secondScatter)+50:0;
    const accelerateAt=secondStop+70;
    const brakeDuration=950;
    const firstBrakeAt=accelerateAt+1250;
    const plans=columns.map((_,index)=>{
      const delay=baseDelay(index);
      if(!anticipation||!waitingReels.includes(index))
        return {delay,duration:baseDuration(index)};
      const turn=waitingReels.indexOf(index);
      const brakeAt=firstBrakeAt+turn*(brakeDuration+160);
      return {delay,duration:brakeAt-delay+brakeDuration,
        suspense:{accelerateAt,brakeAt}};
    });
    const startSuspense=()=>{
      if(quickStopRequested)return;
      for(const index of waitingReels){
        if(overlays.has(index))continue;
        const col=columns[index],view=col.querySelector('.reel-window');
        if(!view)continue;
        const veil=document.createElement('div');
        veil.className='egypt-suspense-veil';
        veil.setAttribute('aria-hidden','true');
        // No duplicate/fake symbol strip: the real animated reel below this
        // translucent fire veil already contains the FINAL server-settled
        // symbols and eases into their exact landing positions.
        view.append(veil);
        col.classList.add('egypt-suspense-reel');
        overlays.set(index,veil);
      }
      if(overlays.size){
        message.textContent='ДВА SCATTER! Сможет ли следующий барабан запустить бонус?';
        play('bonus_sound');
      }
    };
    let triggerTimer=null;
    if(anticipation){
      // The second Scatter must be visibly settled before all remaining
      // reels glow and accelerate at exactly the same moment.
      triggerTimer=window.setTimeout(startSuspense,secondStop+60);
    }
    const stopSuspense=async(index)=>{
      const veil=overlays.get(index);
      if(!veil)return;
      // The actual reel has just settled naturally into the planned
      // symbols. Only the translucent fire overlay fades out.
      columns[index].classList.add('egypt-suspense-ending');
      veil.classList.add('is-fading');
      if(!quickStopRequested)await new Promise(resolve=>window.setTimeout(resolve,380));
      veil.remove();
      overlays.delete(index);
      columns[index].classList.remove('egypt-suspense-reel','egypt-suspense-ending');
    };
    try{
      await Promise.all(columns.map(async(col,index)=>{
        const target=Array.from({length:rowCount},(_,row)=>cells[row*reelCount+index]);
        await animateColumn(col,index,target,plans[index]);
        // As soon as an individual reel stops, illuminate every selected
        // bonus symbol on THAT reel. Other reels may still be spinning.
        if(isEgypt&&bonusActive){
          // The ribbon tiles are already illuminated by makeTile. Preserve
          // that appearance on the final static cells as the reel stops.
          setEgyptFocus(0);
        }
        if(overlays.has(index))await stopSuspense(index);
      }));
    }finally{
      if(triggerTimer!==null)window.clearTimeout(triggerTimer);
      for(const [index,veil] of overlays){
        veil.remove();
        columns[index].classList.remove('egypt-suspense-reel','egypt-suspense-ending');
      }
      reelMotionActive=false;
    }
  }

  // Cosmic Scatter suspense: starts ONLY after two Scatter have actually
  // landed on consecutive stopping reels, and only if reels remain to the
  // right. The outcome is predetermined on the server and never changed here.
  async function animateSpaceScatterSuspense(cells){
    const scatterReels=columns.map((_,index)=>index).filter(index=>
      Array.from({length:rowCount},(_,row)=>cells[row*reelCount+index]).includes(scatterId));
    const second=scatterId&&scatterReels.length>=2?scatterReels[1]:-1;
    const waiting=second>=0?columns.map((_,index)=>index).filter(index=>index>second):[];
    const suspense=waiting.length>0&&!reducedMotion;
    const baseDelay=index=>index*145;
    const baseDuration=index=>1450+index*170;
    const secondStop=suspense?baseDelay(second)+baseDuration(second)+50:0;
    const overlays=new Map();
    const accelerateAt=secondStop+70;
    const brakingDuration=950;
    const firstBrakeAt=accelerateAt+1250;
    const plans=columns.map((_,index)=>{
      const delay=baseDelay(index);
      if(!suspense||index<=second)return {delay,duration:baseDuration(index)};
      const turn=index-second-1;
      // Critical: next reel does not BEGIN braking until the previous one
      // is completely stopped. Others keep their same accelerated velocity.
      const brakeAt=firstBrakeAt+turn*(brakingDuration+160);
      return {
        delay,duration:brakeAt-delay+brakingDuration,
        suspense:{accelerateAt,brakeAt}
      };
    });
    const lightRemaining=()=>{
      if(quickStopRequested)return;
      for(const index of waiting){
        const column=columns[index],view=column.querySelector('.reel-window');
        if(!view||overlays.has(index))continue;
        const glow=document.createElement('div');
        glow.className='space-scatter-suspense-glow';
        glow.setAttribute('aria-hidden','true');
        view.append(glow);
        column.classList.add('space-scatter-anticipation-reel');
        overlays.set(index,glow);
      }
      if(overlays.size){
        message.textContent='ДВА SCATTER! Оставшиеся барабаны ускоряются — будет ли третий?';
        play('bonus_sound');
      }
    };
    const finishGlow=async index=>{
      const glow=overlays.get(index);
      if(!glow)return;
      glow.classList.add('is-finishing');
      columns[index].classList.add('space-scatter-anticipation-stopping');
      if(!quickStopRequested)await delay(250);
      glow.remove();
      overlays.delete(index);
      columns[index].classList.remove('space-scatter-anticipation-reel','space-scatter-anticipation-stopping');
    };
    let timer=null;
    if(suspense)timer=window.setTimeout(lightRemaining,secondStop+60);
    try{
      await Promise.all(columns.map(async(column,index)=>{
        const finalIds=Array.from({length:rowCount},(_,row)=>cells[row*reelCount+index]);
        await animateColumn(column,index,finalIds,plans[index]);
        await finishGlow(index);
      }));
    }finally{
      if(timer!==null)window.clearTimeout(timer);
      for(const [index,glow] of overlays){
        glow.remove();
        columns[index].classList.remove('space-scatter-anticipation-reel','space-scatter-anticipation-stopping');
      }
    }
  }

  function clearWinningGlow(){
    root.querySelectorAll('.ribbon-tile.is-winning').forEach(tile=>{
      tile.classList.remove('is-winning','is-winning-wild');
      tile.querySelectorAll('.slot-symbol-prize').forEach(label=>label.remove());
      tile.removeAttribute('data-winning-prize');
    });
  }
  function highlightWinningSymbols(wins){
    clearWinningGlow();
    if(isEgypt){
      // In the base Egyptian game only the cells ON the ten defined
      // paylines may be highlighted; no extra copies on a reel count.
      for(const win of wins){
        if(!Number.isInteger(win.line)||!Array.isArray(win.rows)||win.prize<=0)continue;
        for(let reel=0;reel<Math.min(reelCount,win.reels);reel++){
          const row=win.rows[reel];
          if(!Number.isInteger(row)||row<0||row>=rowCount)continue;
          const tile=columns[reel].querySelector('.reel-track')?.children[row];
          if(!tile)continue;
          const landedId=Number(tile.dataset.symbolId);
          // WILD on a paying Egyptian line replaces the winning symbol,
          // so it grows and glows just like that symbol. Other WILD tiles
          // (outside the scored positions) must remain unchanged.
          if(landedId!==win.symbolId&&!(wildId&&landedId===wildId))continue;
          tile.style.setProperty('--win-delay',(reel*.13)+'s');
          tile.classList.add('is-winning');
          tile.classList.toggle('is-winning-wild',landedId===wildId);
        }
      }
      return;
    }
    for(const win of wins){
      if(!symbols.has(win.symbolId)||!Number.isInteger(win.reels)||win.reels<(isEgypt?2:3))continue;
      const chainLength=Math.min(columns.length,win.reels);
      let prizeTile=null;
      for(let col=0;col<chainLength;col++){
        const matching=Array.from(columns[col].querySelectorAll('.ribbon-tile'))
          .filter(tile=>Number(tile.dataset.symbolId)===win.symbolId);
        for(const tile of matching){
          tile.style.setProperty('--win-delay',(col*.18)+'s');
          tile.classList.add('is-winning');
        }
        // Show one prize label per matching symbol type, on its final reel.
        // The label is a sibling of the animated image and does not spin.
        if(col===chainLength-1&&matching.length)prizeTile=matching[0];
      }
      if(prizeTile&&Number.isSafeInteger(win.prize)&&win.prize>=0){
        const label=document.createElement('span');
        label.className='slot-symbol-prize';
        label.textContent='+'+win.prize;
        label.title='Выигрыш за '+(win.name||'символ')+': '+win.prize+' очков';
        prizeTile.dataset.winningPrize=String(win.prize);
        prizeTile.append(label);
      }
    }
  }

  function clearBonusLocks(){
    root.querySelectorAll('.ribbon-tile.bonus-locked').forEach(tile=>tile.classList.remove('bonus-locked'));
  }
  function applyBonusLocks(indices){
    clearBonusLocks();
    for(const index of indices||[]){
      if(!Number.isSafeInteger(index)||index<0||index>=reelCount*rowCount)continue;
      const col=index%reelCount,row=Math.floor(index/reelCount);
      const tile=columns[col]?.querySelectorAll('.ribbon-tile')[row];
      if(tile)tile.classList.add('bonus-locked');
    }
  }
  // Every unfrozen CELL has its own vertical symbol ribbon. Locked cells
  // remain in place, even when their other neighbours on the same reel spin.
  function makeBonusMiniSymbol(id){
    const tile=makeTile(id);
    tile.className='bonus-mini-symbol';
    return tile;
  }
  function animateBonusCell(tile,target,stagger=0){
    if(reducedMotion){
      tile.replaceWith(makeTile(target));
      return Promise.resolve();
    }
    const reel=document.createElement('div');
    reel.className='bonus-mini-reel';
    const track=document.createElement('div');
    track.className='bonus-mini-track';
    reel.append(track);
    // Display the target at the top of a moving vertical symbol strip.
    const fillers=6+Math.min(2,stagger);
    track.append(makeBonusMiniSymbol(target));
    for(let n=0;n<fillers;n++)track.append(makeBonusMiniSymbol(sample()));
    const viewHeight=tile.getBoundingClientRect().height;
    tile.classList.add('bonus-cell-spinning');
    tile.replaceChildren(reel);
    track.style.transition='none';
    track.style.transform='translate3d(0,'+(-fillers*viewHeight)+'px,0)';
    void track.offsetHeight;
    return new Promise(resolve=>{
      const duration=1420+stagger*135;
      let startTimer=null,endTimer=null,completed=false;
      const finish=()=>{
        if(completed)return;
        completed=true;
        if(startTimer!==null)window.clearTimeout(startTimer);
        if(endTimer!==null)window.clearTimeout(endTimer);
        finishReelAnimations.delete(finish);
        tile.replaceWith(makeTile(target));
        resolve();
      };
      finishReelAnimations.add(finish);
      if(quickStopRequested){finish();return;}
      startTimer=window.setTimeout(()=>{
        if(quickStopRequested){finish();return;}
        track.style.transition='transform '+duration+'ms cubic-bezier(.19,.65,.12,1)';
        track.style.transform='translate3d(0,0,0)';
        endTimer=window.setTimeout(finish,duration+50);
      },stagger*80);
    });
  }
  async function animateBonusSteps(steps){
    let locked=new Set();
    for(let i=0;i<steps.length;i++){
      const step=steps[i];
      if(!Array.isArray(step.cells)||step.cells.length!==reelCount*rowCount)
        throw new Error('Некорректное поле бонусной игры.');
      const animations=[];
      for(let col=0;col<reelCount;col++){
        const track=columns[col].querySelector('.reel-track');
        track.style.transition='none';
        track.style.transform='translate3d(0,0,0)';
        for(let row=0;row<rowCount;row++){
          const pos=row*reelCount+col;
          if(locked.has(pos))continue;
          const prior=track.children[row];
          const tile=makeTile(prior&&Number(prior.dataset.symbolId)||sample());
          if(prior)prior.replaceWith(tile);
          else track.append(tile);
          animations.push(animateBonusCell(tile,step.cells[pos],col%3));
        }
      }
      await Promise.all(animations);
      applyBonusLocks(step.frozenCells);
      locked=new Set(step.frozenCells);
      if(step.scatterCount>0){
        const increase=Number(step.scatterIncrease)||0;
        // Highlight each NEW Scatter separately, in the exact landing order.
        // Never highlight an old Scatter still visible from a previous respin.
        const landed=Array.isArray(step.scatterPositions)?step.scatterPositions:[];
        for(let n=0;n<increase;n++){
          const index=landed[n];
          const col=Number.isInteger(index)?index%reelCount:-1;
          const row=Number.isInteger(index)?Math.floor(index/reelCount):-1;
          const tile=col>=0?columns[col]?.querySelector('.reel-track')?.children[row]:null;
          if(tile&&Number(tile.dataset.symbolId)===scatterId){
            tile.classList.remove('scatter-celebrate');
            void tile.offsetWidth;
            tile.classList.add('scatter-celebrate');
          }
          play('win_sound');
          await animateMultiplierIncrease('scatter',1);
          if(tile)tile.classList.remove('scatter-celebrate');
        }
      }
      if(i<steps.length-1){
        stopSpinSound();
        message.textContent='Респин! Выигравшие ячейки замерли, остальные вращаются.';
        if(!quickStopRequested){
          play('spin_sound');
          await new Promise(resolve=>window.setTimeout(resolve,reducedMotion?70:320));
        }
      }
    }
  }
  const bonusMath=document.getElementById('slot-bonus-math');
  const bonusMathBase=document.getElementById('slot-bonus-math-base');
  const bonusMathFactor=document.getElementById('slot-bonus-math-factor');
  const bonusMathTotal=document.getElementById('slot-bonus-math-total');
  const bonusMathMultiply=document.getElementById('slot-bonus-math-multiply');
  const bonusMathResult=document.getElementById('slot-bonus-math-result');
  const delay=ms=>new Promise(resolve=>window.setTimeout(resolve,reducedMotion?Math.min(ms,150):ms));
  async function showBonusWinIntro(tier){
    if(tier!=='big'&&tier!=='mega')return;
    showBigWin(tier);
    message.textContent=tier==='mega'?'Очень крупный выигрыш!':'Крупный выигрыш!';
    play(tier==='mega'?'mega_win_sound':'big_win_sound');
    await delay(3000);
    hideBigWin();
  }
  async function showBonusCalculation(base,factor,total){
    if(!bonusMath)return;
    bonusMathBase.textContent=String(base);
    bonusMathFactor.textContent=String(factor);
    bonusMathTotal.textContent=String(total);
    bonusMathMultiply.hidden=true;
    bonusMathResult.hidden=true;
    bonusMath.hidden=false;
    await delay(820);
    bonusMathMultiply.hidden=false;
    bonusMathMultiply.classList.remove('is-revealing');
    void bonusMathMultiply.offsetWidth;
    bonusMathMultiply.classList.add('is-revealing');
    await delay(850);
    bonusMathResult.hidden=false;
    bonusMathResult.classList.remove('is-revealing');
    void bonusMathResult.offsetWidth;
    bonusMathResult.classList.add('is-revealing');
    await delay(1450);
    bonusMath.hidden=true;
  }
  async function animateMultiplierIncrease(cause,count){
    if(!count||!bonusMultiplier)return;
    const shownMultiplier=Number(bonusMultiplier.textContent.replace('×',''))||2;
    bonusMultiplier.textContent='×'+(shownMultiplier+count);
    if(bonusPlus){
      bonusPlus.textContent='+'+count+(cause==='scatter'?' SCATTER!':' ЗА ВЫИГРЫШ');
      bonusPlus.classList.remove('is-pop');
      void bonusPlus.offsetWidth;
      bonusPlus.classList.add('is-pop');
    }
    message.textContent=cause==='scatter'
      ?'SCATTER ×'+count+' — множитель увеличился на +'+count+'!'
      :'Выигрыш увеличил множитель на +'+count+'!';
    await delay(1250);
    if(bonusPlus)bonusPlus.classList.remove('is-pop');
  }
  async function animateCosmicMultiplierAdvance(current,next){
    if(!bonusMultiplier||next<=current)return;
    bonusMultiplier.textContent='×'+next;
    bonusMultiplier.classList.remove('space-multiplier-level-up');
    void bonusMultiplier.offsetWidth;
    bonusMultiplier.classList.add('space-multiplier-level-up');
    if(bonusPlus){
      bonusPlus.textContent='+'+(next-current)+' ЗА ВРАЩЕНИЕ';
      bonusPlus.classList.remove('is-pop');
      void bonusPlus.offsetWidth;
      bonusPlus.classList.add('is-pop');
    }
    await delay(reducedMotion?100:950);
    bonusMultiplier.classList.remove('space-multiplier-level-up');
    if(bonusPlus)bonusPlus.classList.remove('is-pop');
  }
  async function announceSpaceRetrigger(result){
    const extra=Number(result.retriggerSpins)||0;
    if(!extra)return;
    const panel=document.getElementById('space-retrigger-announcement');
    const count=document.getElementById('space-retrigger-award');
    const detail=document.getElementById('space-retrigger-details');
    const scatterTiles=Array.from(root.querySelectorAll('.reel-track .ribbon-tile'))
      .filter(tile=>Number(tile.dataset.symbolId)===scatterId);
    scatterTiles.forEach(tile=>tile.classList.add('scatter-celebrate'));
    if(panel){
      if(count)count.textContent='+'+extra;
      if(detail)detail.textContent=result.scatterCount+' SCATTER · Всего доступно: '+
        (result.remainingTotal??result.remaining)+' бесплатных вращений';
      panel.hidden=false;
      panel.classList.remove('is-showing');
      void panel.offsetWidth;
      panel.classList.add('is-showing');
    }
    message.textContent=result.scatterCount+' SCATTER! +'+extra+
      ' дополнительных бесплатных вращений!';
    play('bonus_sound');
    await delay(reducedMotion?450:2250);
    if(panel){
      panel.hidden=true;
      panel.classList.remove('is-showing');
    }
    scatterTiles.forEach(tile=>tile.classList.remove('scatter-celebrate'));
  }
  const egyptRetriggerOverlay=document.getElementById('egypt-retrigger-announcement');
  const egyptRetriggerAward=document.getElementById('egypt-retrigger-award');
  const egyptRetriggerDetails=document.getElementById('egypt-retrigger-details');
  async function announceEgyptRetrigger(result){
    if(!result.retriggerSpins)return;
    if(egyptRetriggerOverlay){
      egyptRetriggerAward.textContent='+'+result.retriggerSpins;
      egyptRetriggerDetails.textContent=result.scatterCount+' SCATTER · Ретриггер №'+
        result.retriggerCount+' · В очереди бонусов: '+result.pendingBonuses;
      egyptRetriggerOverlay.hidden=false;
      egyptRetriggerOverlay.classList.remove('is-showing');
      void egyptRetriggerOverlay.offsetWidth;
      egyptRetriggerOverlay.classList.add('is-showing');
    }
    message.textContent='Вы выиграли ещё одну бонусную игру! +'+result.retriggerSpins+
      ' бесплатных вращений. Продолжайте текущую бонусную игру.';
    play('bonus_sound');
    await delay(reducedMotion?1300:2750);
    if(egyptRetriggerOverlay){
      egyptRetriggerOverlay.hidden=true;
      egyptRetriggerOverlay.classList.remove('is-showing');
    }
  }
  const bonusIntro=document.getElementById('slot-bonus-intro');
  const bonusIntroCount=document.getElementById('slot-bonus-intro-count');
  async function celebrateScatter(count,freeSpins){
    if(!bonusIntro)return;
    const scatterTiles=Array.from(root.querySelectorAll('.ribbon-tile'))
      .filter(tile=>Number(tile.dataset.symbolId)===scatterId);
    scatterTiles.forEach(tile=>tile.classList.add('scatter-celebrate'));
    if(bonusIntroCount)bonusIntroCount.textContent=String(freeSpins);
    bonusIntro.hidden=false;
    bonusIntro.classList.remove('is-showing');
    void bonusIntro.offsetWidth;
    bonusIntro.classList.add('is-showing');
    message.textContent='SCATTER ×'+count+'! '+freeSpins+' бесплатных вращений!';
    stopSpinSound();
    play('bonus_sound');
    await new Promise(resolve=>window.setTimeout(resolve,reducedMotion?350:1900));
    bonusIntro.hidden=true;
    bonusIntro.classList.remove('is-showing');
    scatterTiles.forEach(tile=>tile.classList.remove('scatter-celebrate'));
  }
  // All Egyptian bonus symbols remain active across queued retriggers.
  const egyptSymbolStrip=document.getElementById('egypt-symbol-strip');
  const egyptSymbolStripItems=document.getElementById('egypt-symbol-strip-items');
  const egyptSelectedLabel=document.getElementById('egypt-selected-label');
  const egyptSelectedPortrait=document.getElementById('egypt-selected-portrait');
  const egyptSelectedName=document.getElementById('egypt-selected-name');
  const egyptPicker=document.getElementById('egypt-bonus-picker');
  const egyptPickerPortrait=document.getElementById('egypt-bonus-picker-portrait');
  const egyptPickerName=document.getElementById('egypt-bonus-picker-name');
  const egyptLinesOverlay=document.getElementById('egypt-payline-overlay');
  const egyptCounterPlayed=document.getElementById('egypt-bonus-played');
  const egyptCounterSeriesTotal=document.getElementById('egypt-bonus-series-total');
  const egyptCounterSeries=document.getElementById('egypt-bonus-series');
  const egyptCounterPlayedTotal=document.getElementById('egypt-bonus-played-total');
  const egyptCounterRemainingTotal=document.getElementById('egypt-bonus-remaining-total');
  const egyptCounterRetriggers=document.getElementById('egypt-bonus-retriggers');
  const egyptCounterQueue=document.getElementById('egypt-bonus-queue');
  const egyptPaths=[
    [0,0,0,0,0,0],[1,1,1,1,1,1],[2,2,2,2,2,2],[3,3,3,3,3,3],
    [0,1,2,3,2,1],[3,2,1,0,1,2],[0,0,1,1,2,2],[3,3,2,2,1,1],
    [1,0,1,2,3,2],[2,3,2,1,0,1]
  ];
  let egyptActiveIds=(root.dataset.egyptSymbols||'').split(',')
    .map(Number).filter(id=>id>0&&id!==wildId&&symbols.has(id));
  let egyptChosenId=Number(root.dataset.egyptSelected)||0;
  if(egyptChosenId===wildId)egyptChosenId=0;
  if(egyptChosenId&&!egyptActiveIds.includes(egyptChosenId))egyptActiveIds.push(egyptChosenId);
  function setEgyptCounters(state){
    if(egyptGamesCount){
      const pending=Number.isSafeInteger(state.pendingBonuses)?state.pendingBonuses:0;
      egyptGamesCount.textContent=String(Math.max(0,(bonusActive?1:0)+pending));
    }
    const fields=[
      [egyptCounterPlayed,state.played],
      [egyptCounterPlayedTotal,state.playedTotal],
      [egyptCounterRemainingTotal,state.remainingTotal],
      [egyptCounterSeriesTotal,state.currentTotal],
      [egyptCounterSeries,state.seriesNumber],
      [egyptCounterRetriggers,state.retriggerCount],
      [egyptCounterQueue,state.pendingBonuses]
    ];
    for(const [element,value] of fields)
      if(element&&Number.isSafeInteger(value))element.textContent=String(value);
  }
  function paintEgyptSelection(focusId=0){
    if(!isEgypt)return;
    egyptPlayingIds.clear();
    for(const id of egyptActiveIds)if(id!==wildId)egyptPlayingIds.add(id);
    setEgyptFocus(focusId);
    if(egyptSymbolStrip)egyptSymbolStrip.hidden=!bonusActive;
    if(egyptSymbolStripItems){
      const tiles=regularDefinitions.filter(symbol=>symbol.id!==wildId).map(symbol=>{
        const card=document.createElement('div');
        card.className='egypt-symbol-strip-item';
        const selected=egyptActiveIds.includes(symbol.id);
        // Every selected symbol stays brightly lit in the top ribbon; focus
        // only determines which reel symbols glow most during payout.
        const bright=selected;
        card.classList.toggle('is-active',bright);
        card.classList.toggle('is-selected',false);
        card.classList.toggle('is-dimmed',!selected);
        card.setAttribute('aria-label',symbol.name+(selected?' — выбран для бонуса':' — не выбран'));
        card.append(makeTile(symbol.id));
        const title=document.createElement('small');
        title.textContent=symbol.name;
        card.append(title);
        return card;
      });
      egyptSymbolStripItems.replaceChildren(...tiles);
    }
    if(!egyptSelectedLabel)return;
    const item=symbols.get(focusId||egyptChosenId);
    egyptSelectedLabel.hidden=!bonusActive||!item;
    if(item){
      if(egyptSelectedName)egyptSelectedName.textContent=item.name;
      if(egyptSelectedPortrait)egyptSelectedPortrait.replaceChildren(makeTile(item.id));
    }else{
      if(egyptSelectedPortrait)egyptSelectedPortrait.replaceChildren();
      if(egyptSelectedName)egyptSelectedName.textContent='';
    }
  }
  paintEgyptSelection();
  async function animateEgyptSelection(id){
    if(!id||id===wildId||!egyptPicker||!egyptPickerPortrait)return;
    const pool=regularDefinitions.filter(item=>item.id!==wildId&&!egyptActiveIds.includes(item.id));
    if(!pool.length)return;
    egyptPicker.hidden=false;
    const render=item=>{
      egyptPickerPortrait.replaceChildren(makeTile(item.id));
    };
    // Cycle ONLY through unselected symbols; the old bonus symbols cannot be
    // picked again. The server has already selected a random available ID.
    for(let frame=0;frame<27&&!reducedMotion;frame++){
      render(pool[frame%pool.length]);
      await delay(frame<19?90:120+(frame-19)*17);
    }
    render(symbols.get(id)||pool[0]);
    await delay(1100);
    egyptPicker.hidden=true;
    egyptChosenId=id;
    if(!egyptActiveIds.includes(id))egyptActiveIds.push(id);
    paintEgyptSelection();
  }
  // Render one continuous image over all three cells of the expanded reel.
  function clearSpaceWild(){
    root.querySelectorAll('.space-expanded-wild').forEach(element=>element.remove());
    columns.forEach(column=>column.classList.remove('space-wild-reel'));
  }
  async function paintSpaceWild(reels){
    clearSpaceWild();
    const wild=symbols.get(wildId);
    if(!wild||!Array.isArray(reels))return;
    for(const reel of reels){
      const column=columns[reel],window=column?.querySelector('.reel-window');
      if(!window)continue;
      const tile=document.createElement('div');
      tile.className='space-expanded-wild';
      tile.setAttribute('role','img');
      tile.setAttribute('aria-label','Wild на весь барабан');
      const tallImage=root.dataset.spaceExpandingWild||wild.image;
      if(tallImage){
        const img=document.createElement('img');
        img.src=tallImage;img.alt='';img.draggable=false;
        tile.append(img);
      }else tile.textContent='WILD';
      // Scatter is never substituted. Keep the original scatter cell
      // fully visible above the tall Wild image, at its actual row.
      const landed=Array.from(column.querySelector('.reel-track')?.children||[])
        .slice(0,rowCount);
      landed.forEach((cell,row)=>{
        if(Number(cell.dataset.symbolId)!==scatterId)return;
        const overlay=document.createElement('div');
        overlay.className='space-wild-scatter-overlay';
        overlay.style.top=(row*100/rowCount)+'%';
        overlay.style.height=(100/rowCount)+'%';
        overlay.setAttribute('aria-hidden','true');
        overlay.append(makeTile(scatterId));
        tile.append(overlay);
      });
      window.append(tile);
      column.classList.add('space-wild-reel');
      await delay(reducedMotion?30:220);
    }
  }
  function clearEgyptLines(){
    if(egyptLinesOverlay){egyptLinesOverlay.hidden=true;egyptLinesOverlay.replaceChildren();}
    columns.forEach(col=>col.classList.remove('egypt-expanded-reel'));
  }
  async function animateEgyptExpansion(result){
    const wins=Array.isArray(result.symbolWins)?result.symbolWins:[];
    if(!wins.length)return;
    const resetBoard=()=>{
      clearEgyptLines();
      columns.forEach((col,index)=>{
        const cells=Array.from({length:rowCount},(_,row)=>result.cells[row*reelCount+index]);
        showStatic(col,cells);
        col.classList.remove('egypt-expanding-reel','egypt-expanded-reel');
      });
    };
    const activeIds=Array.isArray(result.selectedSymbolIds)?result.selectedSymbolIds:[];
    let shown=0;
    for(const item of wins){
      shown++;
      resetBoard();
      if(item.prize<=0||!item.expandedReels?.length){
        // Symbols without a payable line remain softly marked only in the
        // upper ribbon; no bright focus or named announcement is shown.
        continue;
      }
      paintEgyptSelection(item.symbolId);
      const name=symbols.get(item.symbolId)?.name||'Символ';
      message.textContent='Выигрышный символ '+shown+' из '+activeIds.length+
        ': '+item.matchedReels+' барабанов.';
      await delay(reducedMotion?120:450);
      for(const reel of item.expandedReels){
        const col=columns[reel];
        if(!col)continue;
        col.classList.remove('egypt-expanding-reel');
        // A landed Wild can substitute the currently winning bonus symbol.
        // Grow the WILD artwork itself on such reels instead of erasing it
        // behind the chosen symbol's picture. This does NOT select Wild as
        // a separate bonus symbol or grant it an independent prize.
        const hasWild=wildId&&Array.from({length:rowCount},(_,row)=>
          result.cells[row*reelCount+reel]).includes(wildId);
        showStatic(col,Array(rowCount).fill(hasWild?wildId:item.symbolId));
        void col.offsetWidth;
        col.classList.add('egypt-expanding-reel');
        play('win_sound');
        await delay(reducedMotion?80:240);
      }
      await paintEgyptLines(item);
      message.textContent=name+': '+item.lineWins.length+' линий × '+item.perLine+
        ' очков = +'+item.prize+' очков.';
      await delay(reducedMotion?150:900);
      egyptPlayedSymbolIds.add(item.symbolId);
      resetBoard();
      setEgyptFocus(0); // completed symbol dims; all yet-to-play symbols remain gold
      await delay(reducedMotion?80:350);
    }
    resetBoard();
    paintEgyptSelection(); // keep completed symbols muted until the next spin
  }

  async function paintEgyptLines(result){
    clearEgyptLines();
    if(!result.lineWins?.length)return;
    // Use a dedicated canvas in document.body. It is explicitly positioned
    // above all reels and game backgrounds, avoiding SVG viewBox/CSS clipping.
    const canvas=document.createElement('canvas');
    canvas.className='egypt-lines-canvas';
    canvas.setAttribute('aria-hidden','true');
    document.body.append(canvas);
    const ctx=canvas.getContext('2d');
    if(!ctx){canvas.remove();return;}
    const ratio=window.devicePixelRatio||1;
    const width=window.innerWidth,height=window.innerHeight;
    canvas.width=Math.round(width*ratio);
    canvas.height=Math.round(height*ratio);
    ctx.scale(ratio,ratio);
    const coords=columns.map(col=>col.querySelector('.reel-window').getBoundingClientRect());
    for(const reel of result.expandedReels||[]){
      if(Number.isInteger(reel)&&reel>=0&&reel<columns.length)
        columns[reel].classList.add('egypt-expanded-reel');
    }
    const position=(col,row)=>{
      const box=coords[col];
      return [box.left+box.width/2,box.top+(row+.5)*box.height/rowCount];
    };
    const label=document.createElement('div');
    label.className='egypt-line-award';
    document.body.append(label);
    try{
      for(const win of result.lineWins){
        const rows=Array.isArray(win.rows)&&win.rows.length===reelCount
          ?win.rows:egyptPaths[win.line-1];
        if(!rows)continue;
        ctx.clearRect(0,0,width,height);
        ctx.beginPath();
        rows.forEach((row,col)=>{
          const [x,y]=position(col,row);
          if(col===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        });
        ctx.lineCap='round';ctx.lineJoin='round';
        ctx.strokeStyle='#28100b';ctx.lineWidth=8;ctx.stroke();
        ctx.strokeStyle=win.line%2?'#ffe667':'#6df5ff';
        ctx.lineWidth=4;ctx.shadowColor='#ffce56';ctx.shadowBlur=15;ctx.stroke();
        ctx.shadowBlur=0;
        const linePrize=win.prize??result.perLine;
        const linesCount=Number(root.dataset.egyptLineCount)||egyptPaths.length;
        label.textContent='ЛИНИЯ '+win.line+' / '+linesCount+'  ·  +'+linePrize+' очков';
        label.style.left=Math.max(8,Math.min(width-260,coords[0].left+8))+'px';
        label.style.top=Math.max(10,coords[0].top-52)+'px';
        const name=symbols.get(win.symbolId??result.symbolId)?.name||'Символ';
        message.textContent=name+': линия '+win.line+' из '+linesCount+' · +'+linePrize+' очков';
        await delay(reducedMotion?140:420);
      }
    }finally{
      label.remove();
      canvas.remove();
      clearEgyptLines();
    }
  }
  // Autoplay always uses the existing server-validated spin endpoint.
  // Counts paid spins only; bonus/free spins do not consume the selected quota.
  const autoCount=document.getElementById('slot-auto-count');
  const autoStart=document.getElementById('slot-auto-start');
  const autoStop=document.getElementById('slot-auto-stop');
  const autoStatus=document.getElementById('slot-auto-status');
  const autoTrigger=document.getElementById('slot-auto-trigger');
  const autoDialog=document.getElementById('slot-auto-dialog');
  const autoTriggerLabel=document.getElementById('slot-auto-trigger-label');
  let autoRunning=false;
  let autoRemaining=0;
  let autoTimer=null;
  let autoDispatching=false;
  function paintAutoplay(){
    if(!autoStart||!autoStop||!autoCount)return;
    autoStart.hidden=autoRunning;
    autoStop.hidden=!autoRunning;
    if(autoTrigger)autoTrigger.classList.toggle('is-auto-running',autoRunning);
    if(autoTriggerLabel)autoTriggerLabel.textContent=autoRunning?'СТОП':'АВТО';
    autoCount.disabled=autoRunning;
    updateBetSteps();
    if(autoRunning)autoStatus.textContent='Осталось платных вращений: '+autoRemaining+(bonusActive?' · бонусные вращения бесплатно':'');
  }
  function stopAutoplay(reason='Автоигра остановлена.'){
    autoRunning=false;
    if(autoTimer!==null){window.clearTimeout(autoTimer);autoTimer=null;}
    if(autoStatus)autoStatus.textContent=reason;
    paintAutoplay();
    if(autoDialog?.open)autoDialog.close();
    if(!spinning){button.disabled=false;settingsButton.disabled=false;betButton.disabled=bonusActive;}
  }
  function scheduleAutoplay(){
    if(!autoRunning||spinning)return;
    if(bonusActive){stopAutoplay('Автоигра остановлена: началась бонусная игра.');return;}
    if(!bonusActive&&autoRemaining<=0){stopAutoplay('Выбранные вращения завершены.');return;}
    if(!bonusActive&&Number(balance.textContent)<Number(betDisplay.textContent)){
      showInsufficientFunds();
      stopAutoplay('Автоигра остановлена: недостаточно средств.');
      return;
    }
    paintAutoplay();
    autoTimer=window.setTimeout(()=>{
      autoTimer=null;
      if(!autoRunning||spinning)return;
      autoDispatching=true;
      try{form.requestSubmit(button);}finally{autoDispatching=false;}
    },1000);
  }
  if(autoTrigger&&autoDialog){
    autoTrigger.addEventListener('click',()=>{
      if(autoRunning){stopAutoplay('Автоигра остановлена пользователем.');return;}
      if(spinning)return;
      if(bonusActive){if(autoStatus)autoStatus.textContent='Автоигра недоступна во время бонуса.';return;}
      if(typeof autoDialog.showModal==='function')autoDialog.showModal();
      else autoDialog.setAttribute('open','');
    });
    autoDialog.addEventListener('click',event=>{if(event.target===autoDialog)autoDialog.close();});
  }
  if(autoStart&&autoStop&&autoCount){
    autoStart.addEventListener('click',()=>{
      if(spinning||autoRunning||!definitions.length)return;
      if(bonusActive){autoStatus.textContent='Во время бонусной игры автоигра недоступна.';return;}
      const count=Number(autoCount.value);
      if(!Number.isSafeInteger(count)||count<1||count>250)return;
      autoRemaining=count;
      autoRunning=true;
      if(autoDialog?.open)autoDialog.close();
      if(bonusFinish)bonusFinish.hidden=true;
      paintAutoplay();
      scheduleAutoplay();
    });
    autoStop.addEventListener('click',()=>stopAutoplay('Автоигра остановлена пользователем.'));
  }
  let spinning=false;
  updateBetSteps();
  // Click again during motion: settle the same server-determined spin.
  button.addEventListener('click',event=>{
    if(!spinning||quickStopRequested)return;
    event.preventDefault();
    quickStopReels();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(spinning){
      if(!quickStopRequested&&!autoDispatching)quickStopReels();
      return;
    }
    if(!definitions.length)return;
    if(autoRunning&&!autoDispatching)return;
    if(!bonusActive&&Number(balance.textContent)<Number(betDisplay.textContent)){
      showInsufficientFunds();
      message.textContent='Недостаточно денежных средств для ставки.';
      if(autoRunning)stopAutoplay('Автоигра остановлена: недостаточно средств.');
      return;
    }
    spinning=true;
    quickStopRequested=false;
    updateBetSteps();
    if(isEgypt){
      egyptPlayedSymbolIds.clear(); // new spin: every bonus symbol starts bright
      // makeTile builds the animated ribbon as well as the final cells.
      // Highlight selected symbols IN the moving ribbon, not after landing.
      egyptReelsHighlightReady=bonusActive;
      setEgyptFocus(0);
    }
    clearSpaceWild();
    clearWinningGlow();
    clearBonusLocks();
    if(isEgypt){
      clearEgyptLines();
      if(egyptRoundPrize)egyptRoundPrize.hidden=true;
    }
    hideBigWin();
    setSpinButton(true);
    settingsButton.disabled=true;
    betButton.disabled=true;
    message.textContent='Барабаны вращаются…';
    winDisplay.textContent='0';
    try{
      // Audio must never prevent a spin or leave its button locked.
      try {startBackgroundMusic();} catch(error) {console.warn('Background audio unavailable:',error);}
      try {play('spin_sound');} catch(error) {console.warn('Spin audio unavailable:',error);}
      const response=await fetch(form.action,{
        method:'POST',
        credentials:'same-origin',
        headers:{
          'Content-Type':'application/x-www-form-urlencoded',
          'Accept':'application/json'
        },
        body:new URLSearchParams(new FormData(form))
      });
      const responseText=await response.text();
      let result;
      try{result=JSON.parse(responseText);}
      catch{
        throw new Error('Сервер вернул ошибку '+response.status+' вместо результата вращения. Подробности смотрите в терминале npm start.');
      }
      if(!response.ok){
        if(typeof result.error==='string'&&/недостаточно/i.test(result.error))showInsufficientFunds();
        throw new Error(result.error||'Ошибка вращения ('+response.status+').');
      }
      if(!Array.isArray(result.cells)||result.cells.length!==rowCount*reelCount||
          !result.cells.every(id=>symbols.has(id))||
          !Number.isSafeInteger(result.total)||result.total<0||
          !Number.isSafeInteger(result.balance)||result.balance<0){
        throw new Error('Некорректный ответ игрового сервера.');
      }
      // Decrement only a paid spin, never a free bonus spin.
      if(autoRunning&&result.mode==='base')autoRemaining=Math.max(0,autoRemaining-1);
      if(autoRunning)paintAutoplay();
      if(result.mode==='bonus'&&Array.isArray(result.steps)){
        await animateBonusSteps(result.steps);
        button.disabled=true;
        button.classList.remove('is-spin-stoppable');
      }else if(isEgypt&&(result.mode==='base'||result.mode==='egypt-bonus')){
        // Bonus SCATTER can retrigger. It needs the same two-SCATTER
        // anticipation as a normal Egyptian spin.
        await animateEgyptScatterSuspense(result.cells);
        button.disabled=true;
        button.classList.remove('is-spin-stoppable');
        if(result.mode==='egypt-bonus'){
          stopSpinSound();
          egyptReelsHighlightReady=true;
          paintEgyptSelection(); // ALL selected symbols glow upon landing
          await delay(reducedMotion?100:320);
          await animateEgyptExpansion(result);
        }else if(result.mode==='base'&&Array.isArray(result.wins)){
          stopSpinSound();
          await paintEgyptLines({lineWins:result.wins.filter(win=>win.prize>0)});
        }
      }else{
        const startingCells=result.mode==='space-bonus'&&
          Array.isArray(result.preExpansionCells)&&result.preExpansionCells.length===rowCount*reelCount
          ?result.preExpansionCells
          :result.mode==='egypt-bonus'&&
          Array.isArray(result.preExpansionCells)&&result.preExpansionCells.length===rowCount*reelCount
          ?result.preExpansionCells:result.cells;
        if(isSpace&&(result.mode==='base'||result.mode==='space-bonus')){
          // Scatters appear as reels land; Wild keeps spinning behind them.
          // In bonus mode use the cells BEFORE tall-Wild expansion.
          await animateSpaceScatterSuspense(startingCells);
        }else{
          const animations=columns.map((col,index)=>{
            const target=Array.from({length:rowCount},(_,row)=>startingCells[row*reelCount+index]);
            return animateColumn(col,index,target);
          });
          await Promise.all(animations);
        }
        button.disabled=true;
        button.classList.remove('is-spin-stoppable');
        if(result.mode==='egypt-bonus'){
          stopSpinSound();
          await animateEgyptExpansion(result);
        }
        if(result.mode==='space-bonus'){
          stopSpinSound();
          columns.forEach((column,index)=>showStatic(column,
            Array.from({length:rowCount},(_,row)=>result.cells[row*reelCount+index])));
          await paintSpaceWild(result.expandedReels);
          if(result.wins?.length)await paintEgyptLines({lineWins:result.wins});
        }
        if(isSpace&&result.mode==='base'&&result.wins?.length)
          await paintEgyptLines({lineWins:result.wins});
      }
      stopSpinSound();
      // The reels are settled; reward/bonus presentation must not be
      // interpreted as another stop or a second paid spin.
      button.disabled=true;
      button.classList.remove('is-spin-stoppable');
      if(result.mode!=='egypt-bonus'){
        highlightWinningSymbols(result.mode==='bonus'
          ?(Array.isArray(result.wins)?result.wins.filter(win=>win.prize>0):[])
          :(Array.isArray(result.wins)?result.wins:[]));
      }
      if(result.mode==='bonus'&&result.steps?.length)
        applyBonusLocks(result.steps[result.steps.length-1].frozenCells);
      balance.textContent=String(result.balance);
      betDisplay.textContent=String(result.bet);
      winDisplay.textContent=result.mode!=='base'&&result.total===0?'—':String(result.total);
      if(result.mode==='egypt-bonus'){
        winDisplay.textContent=result.total>0?'+'+result.total:'';
        winDisplay.classList.remove('egypt-spin-win-pop');
        void winDisplay.offsetWidth;
        if(result.total>0)winDisplay.classList.add('egypt-spin-win-pop');
      }
      const tier=['none','normal','big','mega'].includes(result.winTier)?result.winTier:'none';
      const tierText=tier==='mega'?'Очень крупный выигрыш':tier==='big'?'Крупный выигрыш':'Выигрыш';
      const matches=Array.isArray(result.wins)?result.wins:[];
      message.textContent=result.total>0?tierText+': '+result.total+' тестовых очков!'
        :matches.length?'Есть совпадения, но выплата за них равна нулю. Проверьте цены символов в админке.'
        :'Без выигрыша. Попробуйте ещё.';
      if(result.mode==='base'){
        showBigWin(tier);
        if(isEgypt&&tier==='mega')playEgyptMegaBoom();
      }
      if(result.mode==='base'&&result.freeSpins>0){
        // Bonus activation ends autoplay immediately; free spins are manual.
        if(autoRunning)stopAutoplay('Автоигра завершена: выпала бонусная игра. Бесплатные вращения запускаются вручную.');
        await celebrateScatter(result.scatterCount,result.freeSpins);
        if(isEgypt){
          await animateEgyptSelection(Number(result.selectedSymbolId));
          updateBonus(true,result.freeSpins,1,0);
          egyptReelsHighlightReady=true;
          setEgyptCounters({played:0,playedTotal:0,remainingTotal:result.freeSpins,
            currentTotal:result.freeSpins,seriesNumber:1,
            retriggerCount:0,pendingBonuses:0});
          paintEgyptSelection();
          winDisplay.textContent='';
          message.textContent='Бонусная игра! '+result.freeSpins+' бесплатных вращений. Выбранный символ подсвечен сверху.';
        }else if(isSpace){
          updateBonus(true,result.freeSpins,1,0);
          message.textContent='SCATTER ×'+result.scatterCount+'! '+result.freeSpins+
            ' бесплатных вращений. Wild расширяется на весь барабан!';
        }else{
          updateBonus(true,result.freeSpins,2,0);
          message.textContent='SCATTER ×'+result.scatterCount+'! '+result.freeSpins+
            ' бесплатных вращений. Начальный множитель ×2!';
        }
      }else if(result.mode==='space-bonus'){
        const xBefore=Number(result.bonusMultiplier)||1;
        const xAfter=Number(result.nextMultiplier)||xBefore+1;
        // The finished spin pays with X-before. Show the new multiplier only
        // AFTER the reel stopped, and visibly announce +1 even on zero wins.
        updateBonus(true,result.remainingTotal??result.remaining??0,xBefore,result.bonusWin||0);
        winDisplay.textContent=result.total>0?'+'+result.total:'';
        message.textContent=result.total>0
          ?'Выигрыш: '+result.baseWin+' × '+xBefore+' = '+result.bonusRoundWin+'.'
          :'Вращение завершено. Множитель повышается на +1!';
        await animateCosmicMultiplierAdvance(xBefore,xAfter);
        if(result.retriggerSpins)await announceSpaceRetrigger(result);
        if(result.completedBonus){
          updateBonus(false,0,xAfter,result.bonusWin||0);
          if(bonusFinish){
            bonusFinishTotal.textContent=String(result.bonusWin);
            bonusFinish.hidden=false;
          }
          message.textContent='Космический бонус завершён. Всего выиграно '+result.bonusWin+' очков.';
        }else{
          updateBonus(true,result.remainingTotal??result.remaining??0,xAfter,result.bonusWin||0);
          message.textContent=result.total>0
            ?'Бонус: +'+result.total+' очков. Всего: '+result.bonusWin+'. Осталось: '+(result.remainingTotal??result.remaining)+'.'
            :'Осталось бесплатных вращений: '+(result.remainingTotal??result.remaining)+'.';
        }
      }else if(result.mode==='egypt-bonus'){
        if(tier==='big'||tier==='mega'){
          // The configured admin thresholds apply to each FREE spin too.
          // Celebrate only after its selected symbols and 10-line awards
          // have been presented, before the retrigger/next-series notice.
          showBigWin(tier);
          play(tier==='mega'?'mega_win_sound':'big_win_sound');
          if(tier==='mega')playEgyptMegaBoom();
          await delay(tier==='mega'?3700:2200);
          hideBigWin();
        }
        egyptActiveIds=(result.selectedSymbolIds||egyptActiveIds).filter(id=>id!==wildId&&symbols.has(id));
        if(egyptActiveIds.length)egyptChosenId=egyptActiveIds[egyptActiveIds.length-1];
        updateBonus(!result.completedBonus,result.remaining||0,1,result.bonusWin||0);
        // updateBonus only updates the cumulative prize; the main win meter
        // always displays the current spin award, including zero as a dash.
        winDisplay.textContent=result.total>0?'+'+result.total:'';
        showEgyptRoundPrize(result.total,result.bonusWin);
        setEgyptCounters(result);
        paintEgyptSelection();
        if(result.retriggerSpins)await announceEgyptRetrigger(result);
        if(result.transition){
          clearEgyptLines();
          message.textContent='Бонусная серия №'+result.seriesNumber+
            '! Следующие '+result.transition.freeSpins+' вращений. Общий выигрыш: '+result.bonusWin+'.';
          if(result.transition.newSymbolId){
            await animateEgyptSelection(result.transition.newSymbolId);
          }else{
            message.textContent+=' Все символы уже выбраны — продолжают играть вместе.';
            await delay(1100);
          }
          egyptActiveIds=(result.activeSymbolIds||egyptActiveIds).filter(id=>id!==wildId&&symbols.has(id));
          paintEgyptSelection();
        }
        if(result.completedBonus&&bonusFinish){
          clearEgyptLines();
          hideBigWin();
          bonusFinishTotal.textContent=String(result.bonusWin);
          bonusFinish.hidden=false;
          message.textContent='Вся цепочка бонусов завершена: '+result.playedTotal+
            ' бесплатных вращений и '+result.bonusWin+' очков! Выигрыш зачислен в баланс.';
        }else if(!result.transition&&!result.retriggerSpins){
          message.textContent=result.total>0
            ?'За вращение: +'+result.total+' очков. Всего в бонусе: '+result.bonusWin+
              '. Осталось: '+result.remaining+'.'
            :'Осталось бесплатных вращений: '+result.remaining+'.';
        }
      }else if(result.mode==='bonus'){
        // The tier is based on the final multiplied award, supplied by the server.
        // Announce a large bonus win first, and only then reveal its calculation.
        if(result.baseWin>0){
          await showBonusWinIntro(tier);
          await showBonusCalculation(result.baseWin,result.bonusMultiplier,result.bonusRoundWin);
        }
        if(result.winIncrease)await animateMultiplierIncrease('win',result.winIncrease);
        updateBonus(!result.completedBonus,result.remaining||0,result.nextMultiplier||2,result.bonusWin||0);
        message.textContent=result.completedBonus
          ?'Бонус завершён! Всего выиграно '+result.bonusWin+' очков. Сумма зачислена в баланс.'
          :result.baseWin>0
            ?'Бонус ×'+result.bonusMultiplier+': +'+result.bonusRoundWin+
              ' очков. Осталось вращений: '+result.remaining+'.'
            :'Без выигрыша. Осталось бесплатных вращений: '+result.remaining+'.';
        if(result.completedBonus&&bonusFinish){
          hideBigWin();
          bonusFinishTotal.textContent=String(result.bonusWin);
          bonusFinish.hidden=autoRunning;
        }
      }
      if(result.total>0){
        // Large bonus wins already played their fanfare before multiplication.
        const announcedBonus=(result.mode==='bonus'||result.mode==='egypt-bonus')&&
          (tier==='big'||tier==='mega');
        if(!announcedBonus){
          const soundKey=tier==='mega'?'mega_win_sound':tier==='big'?'big_win_sound':'win_sound';
          play(sound(soundKey)?soundKey:'win_sound');
        }
      }
      try {startBackgroundMusic();} catch(error) {console.warn('Background audio unavailable:',error);}
    }catch(error){
      if(autoRunning)stopAutoplay('Автоигра остановлена из-за ошибки.');
      if(/недостаточно/i.test(error.message))showInsufficientFunds();
      message.textContent=error.message+' При необходимости обновите страницу для сверки баланса.';
    }finally{
      try {stopSpinSound();} catch(error) {console.warn('Spin audio stop failed:',error);}
      spinning=false;
      quickStopRequested=false;
      updateBetSteps();
      setSpinButton(false);
      settingsButton.disabled=false;
      betButton.disabled=bonusActive;
      if(autoRunning)scheduleAutoplay();
    }
  });
})();
