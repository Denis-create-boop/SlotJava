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
// Main Egyptian slot: ten fixed paylines, checked LEFT TO RIGHT. A line
// counts a symbol at most once per reel. Other positions on the same reel
// are irrelevant. Each line uses its own 2..6 match coefficient.
function scoreEgyptBaseLines({cells,symbols,bet,payouts,minReelsById={},lineMultipliersById={}}){
  if(!Array.isArray(cells)||cells.length!==24||!Number.isSafeInteger(bet)||bet<0)
    throw Error('Invalid Egyptian base spin.');
  const byId=new Map(symbols.map(item=>[item.id,item]));
  const prices=new Map(payouts.prices.map(row=>[row.symbol_id,row.percent_hundredths]));
  const wins=[];
  let total=0;
  for(let lineIndex=0;lineIndex<EGYPT_LINES.length;lineIndex++){
    const rows=EGYPT_LINES[lineIndex];
    const symbolId=cells[rows[0]*6];
    const symbol=byId.get(symbolId);
    if(!symbol)continue;
    let count=0;
    while(count<6&&cells[rows[count]*6+count]===symbolId)count++;
    const minimum=Number(minReelsById[symbolId])===2?2:3;
    if(count<minimum)continue;
    const percentHundredths=prices.get(symbolId)||0;
    const multiplierMilli=lineMultipliersById[symbolId+':'+count]??
      payouts.multipliers.find(row=>row.symbol_id===symbolId&&row.reel_count===count)?.multiplier_milli??1000;
    const prize=percentHundredths>0&&multiplierMilli>0
      ?Math.round(bet*percentHundredths*multiplierMilli/10000000):0;
    if(prize<=0)continue;
    total+=prize;
    if(!Number.isSafeInteger(total))throw Error('Egypt line win overflow.');
    wins.push({line:lineIndex+1,rows:rows.slice(),symbolId,name:symbol.name,
      reels:count,count,percentHundredths,multiplierMilli,prize});
  }
  return {total,wins};
}
// Evaluate each persistent selected symbol independently on the ORIGINAL
// settled board. This avoids one expanding symbol erasing another or a SCATTER.
// Display expansions sequentially; the payout is the sum across selected
// symbols and all ten lines, irrespective of adjacent reel positions.
function scoreEgyptSymbolSet({cells,selectedIds,bet,payouts,minReelsById={},linePercentById={},lineMultipliersById={}}){
  if(!Array.isArray(cells)||cells.length!==24)throw Error('Egypt requires a 6x4 board.');
  const distinct=[...new Set(selectedIds)];
  const symbolWins=[];
  let total=0;
  for(const symbolId of distinct){
    const minimum=Number(minReelsById[symbolId])===2?2:3;
    const landedReels=Array.from({length:6},(_,reel)=>reel).filter(reel=>
      Array.from({length:4},(_,row)=>cells[row*6+reel]).includes(symbolId));
    const price=payouts.prices.find(row=>row.symbol_id===symbolId)?.percent_hundredths||0;
    const configuredLinePrice=linePercentById[symbolId];
    const linePrice=configuredLinePrice===null||configuredLinePrice===undefined?price:configuredLinePrice;
    const milli=lineMultipliersById[symbolId+':'+landedReels.length]??
      payouts.multipliers.find(row=>row.symbol_id===symbolId&&row.reel_count===landedReels.length)?.multiplier_milli??1000;
    const perLine=landedReels.length>=minimum&&linePrice>0&&milli>0
      ?Math.round(bet*linePrice*milli/10000000):0;
    const qualified=landedReels.length>=minimum&&perLine>0;
    const prize=qualified?perLine*EGYPT_LINES.length:0;
    total+=prize;
    if(!Number.isSafeInteger(total)||total<0)throw Error('Egypt bonus prize overflow.');
    symbolWins.push({symbolId,landedReels,expandedReels:qualified?landedReels:[],
      matchedReels:landedReels.length,minReels:minimum,
      lineWins:qualified?EGYPT_LINES.map((rows,i)=>({line:i+1,rows,reels:landedReels})):[],
      perLine,prize,linePercentHundredths:linePrice});
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
// Decide how a completed free-spin series continues. A retrigger is always
// a new queued series, never an immediate addition to current remaining spins.
function nextEgyptBonusSeries({remaining,queue,selectedIds,symbols,randomInt}){
  if(remaining>0)return {kind:'continue'};
  if(!queue.length)return {kind:'complete'};
  const next=queue[0];
  const newSymbolId=chooseNewEgyptSymbol(symbols,selectedIds,randomInt);
  return {kind:'transition',next,newSymbolId,
    selectedIds:newSymbolId===null?selectedIds.slice():[...selectedIds,newSymbolId]};
}
function egyptFreeSpinsFor(scatterCount){
  return scatterCount>=6?25:scatterCount===5?20:scatterCount===4?15:scatterCount===3?10:0;
}
module.exports={EGYPT_LINES,egyptBonusBoard,scoreEgyptBonus,scoreEgyptBaseLines,egyptFreeSpinsFor,scoreEgyptSymbolSet,chooseNewEgyptSymbol,nextEgyptBonusSeries};
