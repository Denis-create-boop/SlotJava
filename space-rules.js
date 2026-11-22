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
function scoreSpaceLines({cells,symbols,bet,payouts,lines=SPACE_LINES,wildId=0,scatterId=0}){
  if(!Array.isArray(cells)||cells.length!==15)throw Error('Space requires 5x3 grid');
  const byId=new Map(symbols.map(s=>[s.id,s]));
  const prices=new Map(payouts.prices.map(p=>[p.symbol_id,p.percent_hundredths]));
  const ratios=new Map(payouts.multipliers.map(p=>[p.symbol_id+':'+p.reel_count,p.multiplier_milli]));
  const wins=[];let total=0;
  for(let index=0;index<lines.length;index++){
    const rows=lines[index];
    if(!Array.isArray(rows)||rows.length!==5||rows.some(row=>!Number.isInteger(row)||row<0||row>2))
      throw Error('Invalid space payline');
    let best=null;
    for(const symbol of symbols){
      if(symbol.id===wildId||symbol.id===scatterId)continue;
      let count=0;
      while(count<5&&[symbol.id,wildId].includes(cells[rows[count]*5+count]))count++;
      if(count<3)continue;
      const price=prices.get(symbol.id)||0,ratio=ratios.get(symbol.id+':'+count)??1000;
      const prize=price>0&&ratio>0?Math.round(bet*count*price*ratio/10000000):0;
      if(!best||prize>best.prize)best={line:index+1,rows:rows.slice(),symbolId:symbol.id,name:symbol.name,reels:count,count,prize};
    }
    if(best?.prize>0){total+=best.prize;wins.push(best);}
  }
  if(!Number.isSafeInteger(total)||total<0)throw Error('Space payout overflow');
  return {total,wins};
}
function expandSpaceWild(cells,wildId,scatterId){
  const reels=[];
  const expanded=cells.slice();
  for(let col=0;col<5;col++){
    if(![0,1,2].some(row=>cells[row*5+col]===wildId))continue;
    // A full-reel image would conceal a Scatter. Leave such columns
    // unexpanded: Scatter must never be substituted, even visually.
    if(scatterId&&[0,1,2].some(row=>cells[row*5+col]===scatterId))continue;
    reels.push(col);
    for(let row=0;row<3;row++)expanded[row*5+col]=wildId;
  }
  return {cells:expanded,expandedReels:reels};
}
module.exports={SPACE_LINES,scoreSpaceLines,expandSpaceWild};
