// Visual animation only; the server selects symbols and computes payouts.
(() => {
  'use strict';
  const root=document.querySelector('.slot-game');
  if(!root)return;
  const form=document.getElementById('slot-spin-form');
  const button=document.getElementById('slot-spin-button');
  const status=document.getElementById('slot-result');
  const cells=Array.from(root.querySelectorAll('.slot-symbol'));
  const symbolList=Array.from(root.querySelectorAll('.slot-legend-item')).map(item=>{
    const id=Number(item.dataset.symbolId);
    const img=item.querySelector('img');
    return {id,name:item.querySelector('span:last-child')?.textContent||('Символ '+id),image:img?.getAttribute('src')||null};
  });
  const symbols=new Map(symbolList.map(item=>[item.id,item]));
  const sound=name=>root.querySelector('[data-sound="'+name+'"]');
  function play(name){
    const audio=sound(name);
    if(!audio)return;
    try{audio.currentTime=0;const p=audio.play();if(p?.catch)p.catch(()=>{});}catch{}
  }
  const background=sound('music');
  if(background){background.loop=true;background.volume=.2;}
  function renderCell(cell,id){
    const symbol=symbols.get(id);
    const previous=cell.querySelector('.slot-cell-content');
    if(previous)previous.remove();
    const visual=document.createElement('div');visual.className='slot-cell-content';
    if(symbol?.image){
      const img=document.createElement('img');img.src=symbol.image;img.alt=symbol.name;visual.append(img);
    }else{
      const span=document.createElement('span');span.className='symbol-placeholder';
      span.textContent=symbol?.name||String(id);visual.append(span);
    }
    const caption=document.createElement('small');caption.textContent=symbol?.name||('Символ '+id);
    visual.append(caption);
    cell.querySelector('.symbol-placeholder')?.remove();
    cell.querySelector('small')?.remove();
    cell.append(visual);
  }
  let busy=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    if(!symbolList.length){status.textContent='Добавьте символы в админке.';return;}
    busy=true;button.disabled=true;status.textContent='Барабаны вращаются…';
    root.classList.add('slot-spinning');
    play('spin_sound');
    const animation=window.setInterval(()=>{
      cells.forEach(cell=>renderCell(cell,symbolList[Math.floor(Math.random()*symbolList.length)].id));
    },85);
    try{
      const response=await fetch(form.action,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
        body:new URLSearchParams(new FormData(form))
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Ошибка вращения ('+response.status+').');
      if(!Array.isArray(result.cells)||result.cells.length!==20||!result.cells.every(id=>symbols.has(id)))
        throw new Error('Некорректный ответ сервера');
      await new Promise(resolve=>setTimeout(resolve,850));
      window.clearInterval(animation);
      cells.forEach((cell,index)=>renderCell(cell,result.cells[Number(cell.dataset.index)??index]));
      const description=(result.wins||[]).map(win=>win.name+': '+win.count+' шт. = '+win.prize).join('; ');
      status.textContent=result.total>0?'Выигрыш: '+result.total+' очков! '+description:'Без выигрыша. Попробуйте ещё.';
      if(result.total>0)play('win_sound');
      if(background?.paused)play('music');
    }catch(error){
      window.clearInterval(animation);
      status.textContent=error.message+' Попробуйте ещё или обновите страницу.';
    }finally{root.classList.remove('slot-spinning');button.disabled=false;busy=false;}
  });
})();
