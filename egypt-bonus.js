'use strict';

// Fixed 6-reel x 4-row Ancient Egypt paylines, zero-based row numbers.
// Each path selects exactly one cell per reel; visible from left to right.
const EGYPT_LINES=Object.freeze([
  [0,0,0,0,0,0],
  [1,1,1,1,1,1],
  [2,2,2,2,2,2],
  [3,3,3,3,3,3],
  [0,1,2,3,2,1],
  [3,2,1,0,1,2],
  [0,0,1,1,2,2],
  [3,3,2,2,1,1],
  [1,0,1,2,3,2],
  [2,3,2,1,0,1],
].map(line=>Object.freeze(line)));

function egyptBonusBoard({symbols,selectedId,reels=6,rows=4,randomInt}){
  if(reels!==6||rows!==4)throw Error('Egypt bonus requires 6 reels and 4 rows.');
  if(!symbols.some(symbol=>symbol.id===selectedId))throw Error('Egypt bonus symbol is missing.');
  if(typeof randomInt!=='function')throw Error('Missing random number generator.');
  const board=Array.from({length:reels*rows},()=>symbols[randomInt(symbols.length)].id);
  const initialCells=board.slice();
  const expandedReels=[];
  for(let reel=0;reel<reels;reel++){
    if(Array.from({length:rows},(_,row)=>board[row*reels+reel]).includes(selectedId)){
      expandedReels.push(reel);
      for(let row=0;row<rows;row++)board[row*reels+reel]=selectedId;
    }
  }
  return {cells:board,initialCells,expandedReels};
}

function scoreEgyptBonus({cells,selectedId,minReels=3,bet,payouts}){
  if(cells.length!==24||![2,3].includes(minReels))throw Error('Invalid Egyptian bonus grid/rule.');
  const reelCount=6;
  const expandedReels=Array.from({length:6},(_,reel)=>reel)
    .filter(reel=>Array.from({length:4},(_,row)=>cells[row*6+reel]).every(id=>id===selectedId));
  const matchedReels=expandedReels.length;
  const price=payouts.prices.find(row=>row.symbol_id===selectedId)?.percent_hundredths||0;
  const milli=payouts.multipliers.find(row=>row.symbol_id===selectedId&&row.reel_count===matchedReels)?.multiplier_milli??1000;
  // All ten paylines are active. On an expanded reel, every line intersects
  // the selected symbol, even when other expanded reels are non-adjacent.
  const lineWins=matchedReels>=minReels?EGYPT_LINES.map((positions,index)=>({
    line:index+1,rows:positions.slice(),reels:expandedReels.slice()
  })):[];
  const perLine=price>0&&milli>0?Math.round(bet*price*milli/10000000):0;
  const total=perLine*lineWins.length;
  if(!Number.isSafeInteger(total)||total<0)throw Error('Bonus payout overflow.');
  return {total,lineWins,expandedReels,matchedReels,perLine,
    percentHundredths:price,multiplierMilli:milli};
}
function egyptFreeSpinsFor(scatterCount){
  return scatterCount>=6?25:scatterCount===5?20:scatterCount===4?15:scatterCount===3?10:0;
}
module.exports={EGYPT_LINES,egyptBonusBoard,scoreEgyptBonus,egyptFreeSpinsFor};
