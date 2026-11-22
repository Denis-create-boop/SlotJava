'use strict';

// The paid spin is generated first; Scatter probabilities are independent of
// base-game winning frequency. Each reel has its own trigger probability and
// maximum number of Scatter cells when the trigger succeeds.
function scatterOnBoard(board,scatterId,rules,rows,reels,randomInt,locked=new Set()){
  const cells=board.slice();
  let count=0;
  const positionsLanded=[];
  for(let col=0;col<reels;col++){
    const rule=rules.find(r=>r.reel_index===col+1);
    const chance=Math.max(0,Math.min(100,Number(rule?.chance_percent)||0));
    const positions=Array.from({length:rows},(_,row)=>row)
      .filter(row=>!locked.has(row*reels+col));
    const max=Math.max(0,Math.min(positions.length,Number(rule?.max_symbols)||0));
    if(!max||randomInt(100)>=chance)continue;
    // Relative weights determine the exact number of new Scatter symbols.
    // A 30/20/70 configuration is weighted 30:20:70, not 120% probability.
    const weights=Array.from({length:max},(_,i)=>{
      const raw=Number(rule?.['weight_'+(i+1)]);
      return Number.isFinite(raw)&&raw>=0?Math.floor(raw):0;
    });
    const totalWeight=weights.reduce((total,value)=>total+value,0);
    if(totalWeight===0)continue;
    const choice=randomInt(totalWeight);
    let subtotal=0,number=1;
    for(let i=0;i<weights.length;i++){
      subtotal+=weights[i];
      if(choice<subtotal){number=i+1;break;}
    }
    for(let n=0;n<number;n++){
      const pick=n+randomInt(positions.length-n);
      [positions[n],positions[pick]]=[positions[pick],positions[n]];
      const index=positions[n]*reels+col;
      cells[index]=scatterId;
      positionsLanded.push(index);
      count++;
    }
  }
  return {cells,count,positions:positionsLanded};
}
function freeSpinsFor(count){return count>=5?20:count===4?15:count===3?10:0;}
function randomBoard(symbols,reels,rows,randomInt){
  return Array.from({length:reels*rows},()=>symbols[randomInt(symbols.length)].id);
}
function winningCells(board,wins,reels,rows,wildId=0){
  const indices=new Set();
  for(const win of wins){
    if(win.reels<3)continue; // Matches freeze even if their configured price is zero.
    for(let col=0;col<Math.min(reels,win.reels);col++)
      for(let row=0;row<rows;row++){
        const pos=row*reels+col;
        if(board[pos]===win.symbolId||(wildId&&board[pos]===wildId))indices.add(pos);
      }
  }
  return indices;
}
// A bonus round spends exactly ONE free spin, regardless of respin count.
// Lock winning CELLS, not entire columns. Every other cell on every reel
// rolls again, even if another cell on that same reel is already locked.
function playBonusRound({symbols,payouts,bet,reels=5,rows=4,randomInt,scoreBoard,maxRespins=16,scatterId=0,scatterRules=[],wildId=0}){
  if(!symbols.length)throw Error('Нет игровых символов');
  const frozenCells=new Set(),steps=[];
  const applyScatter=board=>scatterId
    ?scatterOnBoard(board,scatterId,scatterRules,rows,reels,randomInt,frozenCells)
    :{cells:board,count:0,positions:[]};
  let landed=applyScatter(randomBoard(symbols,reels,rows,randomInt));
  let board=landed.cells;
  let scatterCount=0;
  let respins=0;
  while(true){
    scatterCount+=landed.count;
    const evaluated=scoreBoard(board,symbols,payouts,bet,rows);
    const active=winningCells(board,evaluated.wins,reels,rows,wildId);
    const newCells=[];
    for(const pos of active){
      if(!frozenCells.has(pos)){frozenCells.add(pos);newCells.push(pos);}
    }
    steps.push({
      cells:board.slice(),
      frozenCells:[...frozenCells].sort((a,b)=>a-b),
      newCells:newCells.sort((a,b)=>a-b),
      scatterCount:landed.count,
      scatterPositions:landed.positions||[],
      wins:evaluated.wins
    });
    if(!newCells.length||frozenCells.size===reels*rows||respins>=maxRespins)break;
    const next=board.slice();
    for(let pos=0;pos<next.length;pos++){
      if(!frozenCells.has(pos))next[pos]=symbols[randomInt(symbols.length)].id;
    }
    landed=applyScatter(next);
    board=landed.cells;
    respins++;
  }
  const result=scoreBoard(board,symbols,payouts,bet,rows);
  return {steps,board,total:result.total,wins:result.wins,respins,scatterCount};
}
module.exports={scatterOnBoard,freeSpinsFor,playBonusRound,winningCells};
