'use strict';

// The paid spin is generated first; Scatter probabilities are independent of
// base-game winning frequency. Each reel has its own trigger probability and
// maximum number of Scatter cells when the trigger succeeds.
function scatterOnBoard(board,scatterId,rules,rows,reels,randomInt){
  const cells=board.slice();
  let count=0;
  for(let col=0;col<reels;col++){
    const rule=rules.find(r=>r.reel_index===col+1);
    const chance=Math.max(0,Math.min(100,Number(rule?.chance_percent)||0));
    const max=Math.max(0,Math.min(rows,Number(rule?.max_symbols)||0));
    if(!max||randomInt(100)>=chance)continue;
    const number=1+randomInt(max);
    const positions=Array.from({length:rows},(_,row)=>row);
    for(let n=0;n<number;n++){
      const pick=n+randomInt(rows-n);
      [positions[n],positions[pick]]=[positions[pick],positions[n]];
      cells[positions[n]*reels+col]=scatterId;
      count++;
    }
  }
  return {cells,count};
}
function freeSpinsFor(count){return count>=5?20:count===4?15:count===3?10:0;}
function randomBoard(symbols,reels,rows,randomInt){
  return Array.from({length:reels*rows},()=>symbols[randomInt(symbols.length)].id);
}
function winningCells(board,wins,reels,rows){
  const indices=new Set();
  for(const win of wins){
    if(win.reels<3)continue; // Matches freeze even if their configured price is zero.
    for(let col=0;col<Math.min(reels,win.reels);col++)
      for(let row=0;row<rows;row++){
        const pos=row*reels+col;
        if(board[pos]===win.symbolId)indices.add(pos);
      }
  }
  return indices;
}
// A bonus round spends exactly ONE free spin, regardless of respin count.
// Lock winning CELLS, not entire columns. Every other cell on every reel
// rolls again, even if another cell on that same reel is already locked.
function playBonusRound({symbols,payouts,bet,reels=5,rows=4,randomInt,scoreBoard,maxRespins=16}){
  if(!symbols.length)throw Error('Нет игровых символов');
  let board=randomBoard(symbols,reels,rows,randomInt);
  const frozenCells=new Set(),steps=[];
  let respins=0;
  while(true){
    const evaluated=scoreBoard(board,symbols,payouts,bet,rows);
    const active=winningCells(board,evaluated.wins,reels,rows);
    const newCells=[];
    for(const pos of active){
      if(!frozenCells.has(pos)){frozenCells.add(pos);newCells.push(pos);}
    }
    steps.push({
      cells:board.slice(),
      frozenCells:[...frozenCells].sort((a,b)=>a-b),
      newCells:newCells.sort((a,b)=>a-b),
      wins:evaluated.wins
    });
    if(!newCells.length||frozenCells.size===reels*rows||respins>=maxRespins)break;
    const next=board.slice();
    for(let pos=0;pos<next.length;pos++){
      if(!frozenCells.has(pos))next[pos]=symbols[randomInt(symbols.length)].id;
    }
    board=next;
    respins++;
  }
  const result=scoreBoard(board,symbols,payouts,bet,rows);
  return {steps,board,total:result.total,wins:result.wins,respins};
}
module.exports={scatterOnBoard,freeSpinsFor,playBonusRound,winningCells};
