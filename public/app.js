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

  let bigWinTimer=null;
  function hideBigWin(){
    if(bigWinTimer!==null){window.clearTimeout(bigWinTimer);bigWinTimer=null;}
    bigWinOverlay.hidden=true;
    bigWinOverlay.classList.remove('is-visible','is-mega');
    bigWinLabel.textContent='';
  }
  function showBigWin(tier){
    hideBigWin();
    if(tier!=='big'&&tier!=='mega')return;
    bigWinLabel.textContent=tier==='mega'?'Очень крупный выигрыш!':'Крупный выигрыш!';
    bigWinOverlay.classList.toggle('is-mega',tier==='mega');
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
  const bonusPlus=document.getElementById('slot-bonus-plus');
  const bonusFinish=document.getElementById('slot-bonus-finish');
  const bonusFinishTotal=document.getElementById('slot-bonus-finish-total');
  const spinLabel=document.getElementById('slot-spin-label');
  let bonusActive=root.dataset.bonusActive==='1';
  bonusFinish?.querySelector('button')?.addEventListener('click',()=>{bonusFinish.hidden=true;});
  function updateBonus(active,remaining=0,multiplier=2,total=0){
    bonusActive=active;
    root.classList.toggle('is-bonus-active',active);
    if(bonusTop)bonusTop.hidden=!active;
    if(bonusStats)bonusStats.hidden=!active;
    if(bonusMultiplier)bonusMultiplier.textContent='×'+multiplier;
    if(bonusRemaining)bonusRemaining.textContent=String(remaining);
    if(bonusTotal)bonusTotal.textContent=String(total);
    if(spinLabel)spinLabel.textContent=active?'БЕСПЛАТНО':'ВРАЩАТЬ';
    const select=document.getElementById('slot-bet-select');
    if(select)select.disabled=active;
    const saveBet=document.querySelector('#slot-bet-form button[type="submit"]');
    if(saveBet)saveBet.disabled=active;
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
  try {soundEnabled=window.localStorage.getItem('slotjava-sound')!=='off';} catch {}
  soundToggle.checked=soundEnabled;
  soundToggle.addEventListener('change',()=>{
    soundEnabled=soundToggle.checked;
    try {window.localStorage.setItem('slotjava-sound',soundEnabled?'on':'off');} catch {}
    if(!soundEnabled){root.querySelectorAll('audio').forEach(audio=>audio.pause());if(ambientMusicTimer!==null){window.clearInterval(ambientMusicTimer);ambientMusicTimer=null;}updateMusicVolume();}
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
  betForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(spinning||bonusActive){message.textContent='Во время бонусной игры ставка фиксирована.';return;}
    const submit=betForm.querySelector('button[type="submit"]');
    submit.disabled=true;
    try{
      const response=await fetch(betForm.action,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
        body:new URLSearchParams(new FormData(betForm))
      });
      const result=await response.json();
      if(!response.ok||!Number.isSafeInteger(result.bet))throw new Error(result.error||'Ошибка изменения ставки');
      betDisplay.textContent=String(result.bet);
      settingsDialog.close();
      message.textContent='Ставка изменена: '+result.bet+' тестовых очков.';
    }catch(error){message.textContent=error.message;}
    finally{submit.disabled=false;}
  });

  const columns=Array.from(root.querySelectorAll('.reel-column'));
  const reelCount=columns.length;
  const rowCount=Number(root.dataset.rows)||4;
  const definitions=Array.from(document.querySelectorAll('[data-symbol-def]')).map(node=>({
    id:Number(node.dataset.symbolId),
    name:node.dataset.name||'Символ',
    image:node.dataset.image||''
  })).filter(item=>Number.isSafeInteger(item.id));
  const symbols=new Map(definitions.map(item=>[item.id,item]));
  const regularDefinitions=definitions.filter(item=>item.id!==scatterId);
  const sound=name=>root.querySelector('[data-sound="'+name+'"]');
  const classicSounds=root.classList.contains('slot-theme-classic')||root.dataset.scatterId!=='0';
  let audioContext=null;
  let ambientMusicTimer=null;
  let ambientStep=0;
  let ambientGain=null;
  function updateMusicVolume(){
    if(music)music.volume=Math.min(1,musicVolume/100);
    if(ambientGain&&audioContext){
      ambientGain.gain.setTargetAtTime(soundEnabled?musicVolume/100:0,audioContext.currentTime,.12);
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
  function playGeneratedSound(name){
    if(!classicSounds||!soundEnabled||name==='music')return;
    try{
      const ctx=getAudioContext();
      if(!ctx)return;
      if(name==='bonus_sound'){
        // Original short arcade fanfare, distinct from the ordinary win sound.
        const notes=[392,523.25,659.25,783.99,1046.5,1318.5];
        notes.forEach((hz,index)=>synthesizedNote(hz,ctx.currentTime+index*.16,index===5?.85:.33,.10,index===5?'triangle':'sawtooth'));
        synthesizedNote(261.63,ctx.currentTime+.67,1,.042,'triangle');
        synthesizedNote(523.25,ctx.currentTime+.67,1,.06,'triangle');
        return;
      }
      if(name==='win_sound'||name==='big_win_sound'||name==='mega_win_sound'){
        // A gentle, original victory chime with a bright metallic shimmer;
        // it evokes a reward without imitating literal falling coins.
        const isMega=name==='mega_win_sound',isBig=name==='big_win_sound';
        const notes=isMega?[659.25,830.61,987.77,1318.51,1567.98,1975.53]:
          isBig?[587.33,739.99,880,1174.66,1479.98]:
          [659.25,830.61,987.77,1318.51];
        const start=ctx.currentTime+.015;
        notes.forEach((hz,index)=>{
          const at=start+index*(isMega?.115:.135);
          const duration=(index===notes.length-1?(isMega?1.15:.78):.48);
          for(const [ratio,level] of [[1,.046],[2.01,.013],[3.92,.005]]){
            const oscillator=ctx.createOscillator(),gain=ctx.createGain();
            oscillator.type='sine';
            oscillator.frequency.setValueAtTime(hz*ratio,at);
            gain.gain.setValueAtTime(.0001,at);
            gain.gain.exponentialRampToValueAtTime(level*(isMega?1.2:isBig?1.1:1),at+.012);
            gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
            oscillator.connect(gain).connect(ctx.destination);
            oscillator.start(at);oscillator.stop(at+duration+.02);
          }
        });
        return;
      }
      const notes=[220,247,262,294,330,294,262,247];
      notes.forEach((hz,index)=>{
        const osc=ctx.createOscillator(),gain=ctx.createGain();
        const t=ctx.currentTime+index*.075;
        osc.type='sine';osc.frequency.setValueAtTime(hz,t);
        gain.gain.setValueAtTime(.0001,t);
        gain.gain.exponentialRampToValueAtTime(.055,t+.015);
        gain.gain.exponentialRampToValueAtTime(.0001,t+.095);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);osc.stop(t+.11);
      });
    }catch{}
  }

  function play(name){
    if(!soundEnabled)return;
    const audio=sound(name);
    if(!audio){playGeneratedSound(name);return;}
    try{audio.currentTime=0;const p=audio.play();if(p?.catch)p.catch(()=>{});}catch{}
  }
  const music=sound('music');
  if(music)music.loop=true;
  updateMusicVolume();
  const spinningAudio=sound('spin_sound');
  if(spinningAudio){spinningAudio.loop=true;spinningAudio.volume=.8;}
  function startBackgroundMusic(){
    if(!soundEnabled)return;
    if(music){
      if(music.paused)try{const promise=music.play();if(promise?.catch)promise.catch(()=>{});}catch{}
      return;
    }
    if(!classicSounds||ambientMusicTimer!==null)return;
    // Original atmospheric loop: sustained cello-style bass and airy flute.
    // Audio starts after user interaction; sounds are synthesized, not borrowed.
    const ctx=getAudioContext();
    if(!ctx)return;
    if(!ambientGain){
      ambientGain=ctx.createGain();
      ambientGain.gain.value=0;
      ambientGain.connect(ctx.destination);
    }
    updateMusicVolume();
    const harmony=[
      {bass:130.81,chord:[261.63,311.13,392],flute:[523.25,622.25,587.33,523.25]},
      {bass:116.54,chord:[233.08,293.66,349.23],flute:[466.16,523.25,587.33,466.16]},
      {bass:103.83,chord:[207.65,261.63,311.13],flute:[415.30,466.16,523.25,466.16]},
      {bass:116.54,chord:[233.08,293.66,392],flute:[587.33,523.25,466.16,523.25]}
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
      // Long bowed bass, very soft chord pad and spaced breathy flute melody.
      tone(chord.bass,start,4.15,.055,'sawtooth',285,.8);
      tone(chord.bass/2,start,4.15,.035,'sine',220,.8);
      chord.chord.forEach((hz,index)=>tone(hz,start+index*.08,4.12,.032,'triangle',850,1.05));
      // Reduce the repeated breathy "woo" instrument to a few soft accents.
      if(ambientStep%2===0){
        [chord.flute[0],chord.flute[2]].forEach((hz,index)=>
          tone(hz,start+1+index*1.9,1.12,.026,'sine',1250,.32));
      }
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
    tile.className='ribbon-tile'+(id===scatterId?' is-scatter':'');
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
  function animateColumn(col,index,finalIds){
    if(reducedMotion){
      showStatic(col,finalIds);
      return Promise.resolve();
    }
    const track=col.querySelector('.reel-track');
    const view=col.querySelector('.reel-window');
    const rowHeight=view.getBoundingClientRect().height/rowCount;
    const extra=16+index*3;
    // The target items are at the top of the strip; the rest are filler.
    // Sliding the continuous strip DOWN reveals the planned final symbols.
    const strip=finalIds.concat(Array.from({length:extra},sample));
    track.style.transition='none';
    track.replaceChildren(buildStrip(strip));
    track.style.transform='translate3d(0,'+(-extra*rowHeight)+'px,0)';
    void track.offsetHeight;
    return new Promise(resolve=>{
      const delay=index*160;
      const duration=1400+index*170;
      window.setTimeout(()=>{
        track.style.transition='transform '+duration+'ms cubic-bezier(.16,.66,.13,1)';
        track.style.transform='translate3d(0,0,0)';
        window.setTimeout(()=>{
          showStatic(col,finalIds);
          resolve();
        },duration+50);
      },delay);
    });
  }

  function clearWinningGlow(){
    root.querySelectorAll('.ribbon-tile.is-winning').forEach(tile=>{
      tile.classList.remove('is-winning');
      tile.querySelectorAll('.slot-symbol-prize').forEach(label=>label.remove());
      tile.removeAttribute('data-winning-prize');
    });
  }
  function highlightWinningSymbols(wins){
    clearWinningGlow();
    for(const win of wins){
      if(!symbols.has(win.symbolId)||!Number.isInteger(win.reels)||win.reels<3)continue;
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
      window.setTimeout(()=>{
        track.style.transition='transform '+duration+'ms cubic-bezier(.19,.65,.12,1)';
        track.style.transform='translate3d(0,0,0)';
        window.setTimeout(()=>{
          tile.replaceWith(makeTile(target));
          resolve();
        },duration+50);
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
        play('spin_sound');
        await new Promise(resolve=>window.setTimeout(resolve,reducedMotion?70:320));
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
  let spinning=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(spinning||!definitions.length)return;
    if(!bonusActive&&Number(balance.textContent)<Number(betDisplay.textContent)){
      showInsufficientFunds();
      message.textContent='Недостаточно денежных средств для ставки.';
      return;
    }
    spinning=true;
    clearWinningGlow();
    clearBonusLocks();
    hideBigWin();
    startBackgroundMusic();
    button.disabled=true;
    settingsButton.disabled=true;
    betButton.disabled=true;
    message.textContent='Барабаны вращаются…';
    winDisplay.textContent='0';
    play('spin_sound');

    try{
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
      if(result.mode==='bonus'&&Array.isArray(result.steps)){
        await animateBonusSteps(result.steps);
      }else{
        const animations=columns.map((col,index)=>{
          const target=Array.from({length:rowCount},(_,row)=>result.cells[row*reelCount+index]);
          return animateColumn(col,index,target);
        });
        await Promise.all(animations);
      }
      stopSpinSound();
      highlightWinningSymbols(result.mode==='bonus'
        ?(Array.isArray(result.wins)?result.wins.filter(win=>win.prize>0):[])
        :(Array.isArray(result.wins)?result.wins:[]));
      if(result.mode==='bonus'&&result.steps?.length)
        applyBonusLocks(result.steps[result.steps.length-1].frozenCells);
      balance.textContent=String(result.balance);
      betDisplay.textContent=String(result.bet);
      winDisplay.textContent=result.mode==='bonus'&&result.total===0?'—':String(result.total);
      const tier=['none','normal','big','mega'].includes(result.winTier)?result.winTier:'none';
      const tierText=tier==='mega'?'Очень крупный выигрыш':tier==='big'?'Крупный выигрыш':'Выигрыш';
      const matches=Array.isArray(result.wins)?result.wins:[];
      message.textContent=result.total>0?tierText+': '+result.total+' тестовых очков!'
        :matches.length?'Есть совпадения, но выплата за них равна нулю. Проверьте цены символов в админке.'
        :'Без выигрыша. Попробуйте ещё.';
      if(result.mode!=='bonus')showBigWin(tier);
      if(result.mode==='base'&&result.freeSpins>0){
        await celebrateScatter(result.scatterCount,result.freeSpins);
        updateBonus(true,result.freeSpins,2,0);
        message.textContent='SCATTER ×'+result.scatterCount+'! '+result.freeSpins+
          ' бесплатных вращений. Начальный множитель ×2!';
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
          bonusFinish.hidden=false;
        }
      }
      if(result.total>0){
        // Large bonus wins already played their fanfare before multiplication.
        const announcedBonus=result.mode==='bonus'&&(tier==='big'||tier==='mega');
        if(!announcedBonus){
          const soundKey=tier==='mega'?'mega_win_sound':tier==='big'?'big_win_sound':'win_sound';
          play(sound(soundKey)?soundKey:'win_sound');
        }
      }
      startBackgroundMusic();
    }catch(error){
      if(/недостаточно/i.test(error.message))showInsufficientFunds();
      message.textContent=error.message+' При необходимости обновите страницу для сверки баланса.';
    }finally{
      stopSpinSound();
      spinning=false;
      button.disabled=false;
      settingsButton.disabled=false;
      betButton.disabled=bonusActive;
    }
  });
})();
