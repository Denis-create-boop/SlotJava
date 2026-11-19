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
  let soundEnabled=true;
  try {soundEnabled=window.localStorage.getItem('slotjava-sound')!=='off';} catch {}
  soundToggle.checked=soundEnabled;
  soundToggle.addEventListener('change',()=>{
    soundEnabled=soundToggle.checked;
    try {window.localStorage.setItem('slotjava-sound',soundEnabled?'on':'off');} catch {}
    if(!soundEnabled){root.querySelectorAll('audio').forEach(audio=>audio.pause());}
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

  function play(name){
    if(!soundEnabled)return;
    const audio=sound(name);
    if(!audio)return;
    try{audio.currentTime=0;const p=audio.play();if(p?.catch)p.catch(()=>{});}catch{}
  }
  const music=sound('music');
  if(music){music.loop=true;music.volume=.18;}
  const spinningAudio=sound('spin_sound');
  if(spinningAudio)spinningAudio.loop=true;
  function startBackgroundMusic(){
    if(soundEnabled&&music?.paused){
      try{const promise=music.play();if(promise?.catch)promise.catch(()=>{});}catch{}
    }
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
        root.querySelectorAll('.ribbon-tile.is-scatter').forEach(tile=>tile.classList.add('scatter-celebrate'));
        message.textContent='SCATTER в бонусе: +'+step.scatterCount+' к множителю!';
        await new Promise(resolve=>window.setTimeout(resolve,reducedMotion?100:550));
        root.querySelectorAll('.ribbon-tile.scatter-celebrate').forEach(tile=>tile.classList.remove('scatter-celebrate'));
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
    if(!count||!bonusPlus||!bonusMultiplier)return;
    const shownMultiplier=Number(bonusMultiplier.textContent.replace('×',''))||2;
    bonusMultiplier.textContent='×'+(shownMultiplier+count);
    bonusPlus.textContent='+'+count+(cause==='scatter'?' SCATTER!':' ЗА ВЫИГРЫШ');
    bonusPlus.classList.remove('is-pop');
    void bonusPlus.offsetWidth;
    bonusPlus.classList.add('is-pop');
    message.textContent=cause==='scatter'
      ?'SCATTER ×'+count+' — множитель увеличился на +'+count+'!'
      :'Выигрыш увеличил множитель на +'+count+'!';
    await delay(1250);
    bonusPlus.classList.remove('is-pop');
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
    await new Promise(resolve=>window.setTimeout(resolve,reducedMotion?350:1900));
    bonusIntro.hidden=true;
    bonusIntro.classList.remove('is-showing');
    scatterTiles.forEach(tile=>tile.classList.remove('scatter-celebrate'));
  }
  let spinning=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(spinning||!definitions.length)return;
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
      if(!response.ok)throw new Error(result.error||'Ошибка вращения ('+response.status+').');
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
      highlightWinningSymbols(Array.isArray(result.wins)?result.wins:[]);
      if(result.mode==='bonus'&&result.steps?.length)
        applyBonusLocks(result.steps[result.steps.length-1].frozenCells);
      balance.textContent=String(result.balance);
      betDisplay.textContent=String(result.bet);
      winDisplay.textContent=String(result.total);
      const tier=['none','normal','big','mega'].includes(result.winTier)?result.winTier:'none';
      const tierText=tier==='mega'?'Очень крупный выигрыш':tier==='big'?'Крупный выигрыш':'Выигрыш';
      const matches=Array.isArray(result.wins)?result.wins:[];
      message.textContent=result.total>0?tierText+': '+result.total+' тестовых очков!'
        :matches.length?'Есть совпадения, но выплата за них равна нулю. Проверьте цены символов в админке.'
        :'Без выигрыша. Попробуйте ещё.';
      showBigWin(tier);
      if(result.mode==='base'&&result.freeSpins>0){
        await celebrateScatter(result.scatterCount,result.freeSpins);
        updateBonus(true,result.freeSpins,2,0);
        message.textContent='SCATTER ×'+result.scatterCount+'! '+result.freeSpins+
          ' бесплатных вращений. Начальный множитель ×2!';
      }else if(result.mode==='bonus'){
        hideBigWin();
        await showBonusCalculation(result.baseWin,result.bonusMultiplier,result.bonusRoundWin);
        if(result.winIncrease)await animateMultiplierIncrease('win',result.winIncrease);
        if(result.scatterIncrease)await animateMultiplierIncrease('scatter',result.scatterIncrease);
        updateBonus(!result.completedBonus,result.remaining||0,result.nextMultiplier||2,result.bonusWin||0);
        message.textContent=result.completedBonus
          ?'Бонус завершён! Всего выиграно '+result.bonusWin+' очков. Сумма зачислена в баланс.'
          :'Бонус ×'+result.bonusMultiplier+': +'+result.bonusRoundWin+
            ' очков. Осталось вращений: '+result.remaining+'.';
        if(result.completedBonus&&bonusFinish){
          hideBigWin();
          bonusFinishTotal.textContent=String(result.bonusWin);
          bonusFinish.hidden=false;
        }
      }
      if(result.total>0){
        const soundKey=tier==='mega'?'mega_win_sound':tier==='big'?'big_win_sound':'win_sound';
        play(sound(soundKey)?soundKey:'win_sound');
      }
      startBackgroundMusic();
    }catch(error){
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
