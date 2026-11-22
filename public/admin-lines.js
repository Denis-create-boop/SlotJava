'use strict';
// Visual editor for Egypt (6x4) and Cosmic Odyssey (5x3).
// The existing row_N select inputs remain the authoritative form payload.
(() => {
  function setup(editor) {
    const reels=Number(editor.dataset.reels),rows=Number(editor.dataset.rows);
    if(!Number.isInteger(reels)||!Number.isInteger(rows)||reels<2||rows<2)return;
    const board=editor.querySelector('.payline-draw-board');
    const polyline=editor.querySelector('.payline-draw-path');
    const selects=Array.from({length:reels},(_,i)=>editor.querySelector('[name="row_'+(i+1)+'"]'));
    if(!board||!polyline||selects.some(select=>!select))return;
    let activeDrag=false;
    const update=()=>{
      const chosen=selects.map(select=>Number(select.value)-1);
      if(chosen.some(row=>!Number.isInteger(row)||row<0||row>=rows))return;
      polyline.setAttribute('points',chosen.map((row,col)=>((col+.5)*100)+','+((row+.5)*100)).join(' '));
      editor.querySelectorAll('.payline-cell').forEach(cell=>{
        const col=Number(cell.dataset.col),row=Number(cell.dataset.row);
        const on=chosen[col]===row;
        cell.classList.toggle('is-selected',on);
        cell.setAttribute('aria-pressed',String(on));
        const glyph=cell.querySelector('.payline-cell-symbol');
        if(glyph)glyph.textContent=on?'●':'·';
      });
    };
    const choose=cell=>{
      if(!cell||!editor.contains(cell))return;
      const col=Number(cell.dataset.col),row=Number(cell.dataset.row);
      if(!selects[col]||row<0||row>=rows)return;
      selects[col].value=String(row+1);
      update();
    };
    board.addEventListener('click',event=>choose(event.target.closest('.payline-cell')));
    // Drag across reel cells to draw a path. Pointer capture is unnecessary,
    // keeping normal click and keyboard navigation usable on touch screens.
    board.addEventListener('pointerdown',event=>{
      if(!event.target.closest('.payline-cell'))return;
      activeDrag=true;
      choose(event.target.closest('.payline-cell'));
    });
    board.addEventListener('pointerover',event=>{
      if(activeDrag)choose(event.target.closest('.payline-cell'));
    });
    window.addEventListener('pointerup',()=>{activeDrag=false;});
    window.addEventListener('pointercancel',()=>{activeDrag=false;});
    selects.forEach(select=>select.addEventListener('change',update));
    update();
  }
  document.querySelectorAll('[data-line-editor]').forEach(setup);
})();
