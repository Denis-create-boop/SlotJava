'use strict';

// Row indices, left-to-right through the five reels (3 visible rows).
const SPACE_LINES=Object.freeze([
  [0,0,0,0,0],[1,1,1,1,1],[2,2,2,2,2],
  [0,1,2,1,0],[2,1,0,1,2],
  [0,0,1,0,0],[2,2,1,2,2],
  [1,0,1,0,1],[1,2,1,2,1],[0,1,1,1,2]
].map(line=>Object.freeze(line)));

// Wild substitutes for ordinary symbols, but can never stand for Scatter.
// Pays exactly once per line: choose the highest paying interpretation,
// rather than counting the same line separately for every ordinary symbol.
function scoreSpaceLines({cells,symbols,bet,payouts,lines=SPACE_LINES,wildId=0,scatterId=0,rules=null}){
  if(!Array.isArray(cells)||cells.length!==15||!Number.isSafeInteger(bet)||bet<0)
    throw Error('Space requires 5x3 grid and a valid bet');
  const ratios=new Map((payouts.multipliers||[]).map(p=>[p.symbol_id+':'+p.reel_count,p.multiplier_milli]));
  const direct=new Map((rules?.multipliers||[]).map(p=>[p.symbol_id+':'+p.matches,p.multiplier_milli]));
  const minimums=new Map((rules?.minimums||[]).map(p=>[p.symbol_id,p.min_reels]));
  const wins=[];let total=0;
  for(let index=0;index<lines.length;index++){
    const rows=lines[index];
    if(!Array.isArray(rows)||rows.length!==5||rows.some(row=>!Number.isInteger(row)||row<0||row>2))
      throw Error('Invalid space payline');
    let best=null;
    for(const symbol of symbols){
      if(symbol.id===wildId||symbol.id===scatterId)continue;
      let count=0;
      while(count<5&&(cells[rows[count]*5+count]===symbol.id||
        (wildId!==0&&cells[rows[count]*5+count]===wildId)))count++;
      if(count<(minimums.get(symbol.id)===2?2:3))continue;
      let prize=0;
      if(rules){
        // One payline pays stake × the multiplier for N consecutive reels.
        // Wild has no own payout and can only substitute the current symbol.
        const milli=direct.get(symbol.id+':'+count)??0;
        if(milli>0)prize=Math.round(bet*milli/1000);
      }else{
        // Backwards compatibility for direct callers still using the old paytable.
        const price=(payouts.prices||[]).find(p=>p.symbol_id===symbol.id)?.percent_hundredths||0;
        const milli=ratios.get(symbol.id+':'+count)??1000;
        if(price>0&&milli>0)prize=Math.round(bet*count*price*milli/10000000);
      }
      if(prize>0&&(!best||prize>best.prize))
        best={line:index+1,rows:rows.slice(),symbolId:symbol.id,name:symbol.name,
          reels:count,count,prize};
    }
    if(best){
      total+=best.prize;
      if(!Number.isSafeInteger(total))throw Error('Space payout overflow');
      wins.push(best);
    }
  }
  return {total,wins};
}
function expandSpaceWild(cells,wildId,scatterId){
  const reels=[];
  const expanded=cells.slice();
  for(let col=0;col<5;col++){
    if(![0,1,2].some(row=>cells[row*5+col]===wildId))continue;
    // The Wild expands to the reel while SCATTER stays unchanged.
    // A Scatter retains its trigger value, blocks substituted paylines
    // through its cell and is drawn above the tall Wild artwork.
    reels.push(col);
    for(let row=0;row<3;row++){
      const pos=row*5+col;
      if(cells[pos]!==scatterId)expanded[pos]=wildId;
    }
  }
  return {cells:expanded,expandedReels:reels};
}
module.exports={SPACE_LINES,scoreSpaceLines,expandSpaceWild};
