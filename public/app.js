// Five continuous reel strips. The server is authoritative for spins, awards and balance.
(() => {
  'use strict';
  const root=document.querySelector('.slot-game');
  if(!root)return;

  const form=document.getElementById('slot-spin-form');
  const button=document.getElementById('slot-spin-button');
  const message=document.getElementById('slot-result');
  const balance=document.getElementById('slot-balance');
  const winDisplay=document.getElementById('slot-win');
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
    if(spinning)return;
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
  const definitions=Array.from(document.querySelectorAll('[data-symbol-def]')).map(node=>({
    id:Number(node.dataset.symbolId),
    name:node.dataset.name||'Символ',
    image:node.dataset.image||''
  })).filter(item=>Number.isSafeInteger(item.id));
  const symbols=new Map(definitions.map(item=>[item.id,item]));
  const sound=name=>root.querySelector('[data-sound="'+name+'"]');

  function play(name){
    if(!soundEnabled)return;
    const audio=sound(name);
    if(!audio)return;
    try{audio.currentTime=0;const p=audio.play();if(p?.catch)p.catch(()=>{});}catch{}
  }
  const music=sound('music');
  if(music){music.loop=true;music.volume=.18;}

  function sample(){
    return definitions[Math.floor(Math.random()*definitions.length)].id;
  }
  function makeTile(id){
    const symbol=symbols.get(id);
    const tile=document.createElement('div');
    tile.className='ribbon-tile';
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
    columns.forEach(col=>showStatic(col,Array.from({length:4},sample)));
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
    const rowHeight=view.getBoundingClientRect().height/4;
    const extra=16+index*3;
    // The four target items are at the top of the strip; the remainder are
    // filler. Sliding the whole strip DOWN reveals the four target items.
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
    root.querySelectorAll('.ribbon-tile.is-winning').forEach(tile=>tile.classList.remove('is-winning'));
  }
  function highlightWinningSymbols(wins){
    clearWinningGlow();
    for(const win of wins){
      if(!symbols.has(win.symbolId)||!Number.isInteger(win.count))continue;
      for(let col=0;col<columns.length;col++){
        columns[col].querySelectorAll('.ribbon-tile').forEach(tile=>{
          if(Number(tile.dataset.symbolId)===win.symbolId)tile.classList.add('is-winning');
        });
      }
    }
  }

  let spinning=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(spinning||!definitions.length)return;
    spinning=true;
    clearWinningGlow();
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
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Ошибка вращения ('+response.status+').');
      if(!Array.isArray(result.cells)||result.cells.length!==20||
          !result.cells.every(id=>symbols.has(id))||
          !Number.isSafeInteger(result.total)||result.total<0||
          !Number.isSafeInteger(result.balance)||result.balance<0){
        throw new Error('Некорректный ответ игрового сервера.');
      }
      const animations=columns.map((col,index)=>{
        const target=Array.from({length:4},(_,row)=>result.cells[row*5+index]);
        return animateColumn(col,index,target);
      });
      await Promise.all(animations);
      highlightWinningSymbols(Array.isArray(result.wins)?result.wins:[]);
      balance.textContent=String(result.balance);
      betDisplay.textContent=String(result.bet);
      winDisplay.textContent=String(result.total);
      message.textContent=result.total>0?'Выигрыш: '+result.total+' тестовых очков!':'Без выигрыша. Попробуйте ещё.';
      if(result.total>0)play('win_sound');
      if(music?.paused)play('music');
    }catch(error){
      message.textContent=error.message+' При необходимости обновите страницу для сверки баланса.';
    }finally{
      spinning=false;
      button.disabled=false;
      settingsButton.disabled=false;
      betButton.disabled=false;
    }
  });
})();
