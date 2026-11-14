// SlotJava: browser animation only. Results are generated on the server.
(() => {
  'use strict';
  const root=document.querySelector('.slot-game');
  if(!root)return;
  const form=document.getElementById('slot-spin-form');
  const button=document.getElementById('slot-spin-button');
  const status=document.getElementById('slot-result');
  const cells=Array.from(root.querySelectorAll('.slot-symbol'));
  const symbolImages=new Map();
  root.querySelectorAll('.slot-legend-item').forEach((item,index)=>{
    const img=item.querySelector('img');
    if(img) symbolImages.set(index+1,img.getAttribute('src'));
  });
  const sound=name=>root.querySelector('[data-sound="'+name+'"]');
  function play(name){
    const audio=sound(name);if(!audio)return;
    try{audio.currentTime=0;const promise=audio.play();if(promise?.catch)promise.catch(()=>{});}catch{}
  }
  const background=sound('music');
  if(background){background.loop=true; background.volume=.2;}
  function renderCell(cell,n){
    const image=symbolImages.get(n);
    cell.innerHTML='';
    if(image){
      const img=document.createElement('img');img.src=image;img.alt='Символ №'+n;img.loading='eager';cell.append(img);
    }else{
      const span=document.createElement('span');span.className='symbol-placeholder';span.textContent=String(n);cell.append(span);
    }
    const caption=document.createElement('small');caption.textContent='Символ №'+n;cell.append(caption);
  }
  let busy=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    busy=true;button.disabled=true;status.textContent='Барабаны вращаются…';
    root.classList.add('slot-spinning');
    play('spin_sound');
    let result;
    const animation=window.setInterval(()=>{
      cells.forEach(cell=>renderCell(cell,Math.floor(Math.random()*12)+1));
    },85);
    try{
      const response=await fetch(form.action,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
        body:new URLSearchParams(new FormData(form))
      });
      if(!response.ok)throw new Error('Не удалось выполнить вращение ('+response.status+').');
      result=await response.json();
      if(!Array.isArray(result.columns)||result.columns.length!==3)throw new Error('Некорректный ответ сервера');
      await new Promise(resolve=>setTimeout(resolve,900));
      window.clearInterval(animation);
      cells.forEach(cell=>{
        const col=Number(cell.dataset.reel),row=Number(cell.dataset.row);
        const n=result.columns[col]?.[row];
        renderCell(cell,Number.isInteger(n)&&n>=1&&n<=12?n:1);
      });
      status.textContent=result.win?'Выигрышная линия!':'Без выигрыша. Попробуйте ещё.';
      if(result.win)play('win_sound');
      if(background?.paused)play('music');
    }catch(error){
      window.clearInterval(animation);
      status.textContent=error.message+' Обновите страницу.';
    }finally{
      root.classList.remove('slot-spinning');button.disabled=false;busy=false;
    }
  });
})();
