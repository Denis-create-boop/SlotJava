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

function egyptBonusBoard({symbols,selectedId,reels=6,rows=4,minReels=3,randomInt}){
  if(reels!==6||rows!==4||![2,3].includes(minReels))throw Error('Egypt bonus requires six reels, four rows and a minimum of two or three reels.');
  if(!symbols.some(symbol=>symbol.id===selectedId))throw Error('Egypt bonus symbol is missing.');
  if(typeof randomInt!=='function')throw Error('Missing random number generator.');
  const board=Array.from({length:reels*rows},()=>symbols[randomInt(symbols.length)].id);
  const initialCells=board.slice();
  const landedReels=Array.from({length:reels},(_,reel)=>reel)
    .filter(reel=>Array.from({length:rows},(_,row)=>board[row*reels+reel]).includes(selectedId));
  // Expand only when the chosen symbol qualifies for a winning line.
  const expandedReels=landedReels.length>=minReels?landedReels:[];
  for(const reel of expandedReels)
    for(let row=0;row<rows;row++)board[row*reels+reel]=selectedId;
  return {cells:board,initialCells,expandedReels,landedReels};
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
// Evaluate each persistent selected symbol independently on the ORIGINAL
// settled board. This avoids one expanding symbol erasing another or a SCATTER.
// Display expansions sequentially; the payout is the sum across selected
// symbols and all ten lines, irrespective of adjacent reel positions.
function scoreEgyptSymbolSet({cells,selectedIds,bet,payouts,minReelsById={}}){
  if(!Array.isArray(cells)||cells.length!==24)throw Error('Egypt requires a 6x4 board.');
  const distinct=[...new Set(selectedIds)];
  const symbolWins=[];
  let total=0;
  for(const symbolId of distinct){
    const minimum=Number(minReelsById[symbolId])===2?2:3;
    const landedReels=Array.from({length:6},(_,reel)=>reel).filter(reel=>
      Array.from({length:4},(_,row)=>cells[row*6+reel]).includes(symbolId));
    const price=payouts.prices.find(row=>row.symbol_id===symbolId)?.percent_hundredths||0;
    const milli=payouts.multipliers.find(row=>row.symbol_id===symbolId&&row.reel_count===landedReels.length)?.multiplier_milli??1000;
    const perLine=landedReels.length>=minimum&&price>0&&milli>0
      ?Math.round(bet*price*milli/10000000):0;
    const qualified=landedReels.length>=minimum&&perLine>0;
    const prize=qualified?perLine*EGYPT_LINES.length:0;
    total+=prize;
    if(!Number.isSafeInteger(total)||total<0)throw Error('Egypt bonus prize overflow.');
    symbolWins.push({symbolId,landedReels,expandedReels:qualified?landedReels:[],
      matchedReels:landedReels.length,minReels:minimum,
      lineWins:qualified?EGYPT_LINES.map((rows,i)=>({line:i+1,rows,reels:landedReels})):[],
      perLine,prize});
  }
  return {total,symbolWins};
}
// Choose only a never-before-selected symbol. When all symbols have already
// been chosen, further retriggers still run without duplicating any symbol.
function chooseNewEgyptSymbol(symbols,selectedIds,randomInt){
  const used=new Set(selectedIds);
  const available=symbols.filter(item=>!used.has(item.id));
  return available.length?available[randomInt(available.length)].id:null;
}
function egyptFreeSpinsFor(scatterCount){
  return scatterCount>=6?25:scatterCount===5?20:scatterCount===4?15:scatterCount===3?10:0;
}
module.exports={EGYPT_LINES,egyptBonusBoard,scoreEgyptBonus,egyptFreeSpinsFor,scoreEgyptSymbolSet,chooseNewEgyptSymbol};
