'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EGYPT_LINES,egyptBonusBoard,scoreEgyptBonus,egyptFreeSpinsFor,scoreEgyptSymbolSet,chooseNewEgyptSymbol,nextEgyptBonusSeries}=require('../egypt-bonus');
const {scatterOnBoard,freeSpinsFor}=require('../slot-bonus');

test('Egypt uses ten distinct six-reel paylines over four rows',()=>{
  assert.equal(EGYPT_LINES.length,10);
  assert.equal(new Set(EGYPT_LINES.map(line=>line.join(','))).size,10);
  for(const line of EGYPT_LINES){
    assert.equal(line.length,6);
    assert.ok(line.every(row=>Number.isInteger(row)&&row>=0&&row<=3));
  }
});
test('3, 4, >=5 SCATTER award 10, 15, 20 spins',()=>{
  assert.equal(freeSpinsFor(0),0);
  assert.equal(freeSpinsFor(2),0);
  assert.equal(freeSpinsFor(3),10);
  assert.equal(freeSpinsFor(4),15);
  assert.equal(freeSpinsFor(5),20);
  assert.equal(freeSpinsFor(6),20);
});
test('Egypt gives 25 spins for six Scatter without changing classic',()=>{
  assert.equal(egyptFreeSpinsFor(0),0);
  assert.equal(egyptFreeSpinsFor(2),0);
  assert.equal(egyptFreeSpinsFor(3),10);
  assert.equal(egyptFreeSpinsFor(4),15);
  assert.equal(egyptFreeSpinsFor(5),20);
  assert.equal(egyptFreeSpinsFor(6),25);
  assert.equal(freeSpinsFor(6),20); // classic stays unchanged
});
test('one SCATTER at most per Egypt reel',()=>{
  const normal=Array(24).fill(2);
  const rules=Array.from({length:6},(_,i)=>({
    reel_index:i+1,chance_percent:100,max_symbols:1,weight_1:100
  }));
  const placed=scatterOnBoard(normal,99,rules,4,6,()=>0);
  assert.equal(placed.count,6);
  for(let col=0;col<6;col++){
    const occurrences=Array.from({length:4},(_,row)=>placed.cells[row*6+col]).filter(id=>id===99);
    assert.equal(occurrences.length,1);
  }
});
test('selected symbol expands every reel on which it appears',()=>{
  const board=egyptBonusBoard({symbols:[{id:8}],selectedId:8,randomInt:()=>0});
  assert.deepEqual(board.expandedReels,[0,1,2,3,4,5]);
  assert.ok(board.cells.every(id=>id===8));
});
const payouts={prices:[{symbol_id:8,percent_hundredths:1000}],
  multipliers:[{symbol_id:8,reel_count:3,multiplier_milli:1000}]};
function builtBoard(reels){
  const board=Array(24).fill(7);
  for(const col of reels)for(let row=0;row<4;row++)board[row*6+col]=8;
  return board;
}
test('non-adjacent selected reels pay all 10 lines',()=>{
  const score=scoreEgyptBonus({cells:builtBoard([0,2,4]),selectedId:8,
    minReels:3,bet:100,payouts});
  assert.deepEqual(score.expandedReels,[0,2,4]);
  assert.equal(score.lineWins.length,10);
  assert.equal(score.perLine,10);
  assert.equal(score.total,100);
});
test('minimum 2 or 3 expanded reels is configurable per symbol',()=>{
  const cells=builtBoard([1,5]);
  assert.equal(scoreEgyptBonus({cells,selectedId:8,minReels:2,bet:100,payouts}).lineWins.length,10);
  assert.equal(scoreEgyptBonus({cells,selectedId:8,minReels:3,bet:100,payouts}).total,0);
});
test('one expanded reel never wins',()=>{
  const score=scoreEgyptBonus({cells:builtBoard([5]),selectedId:8,
    minReels:2,bet:100,payouts});
  assert.equal(score.total,0);
  assert.deepEqual(score.lineWins,[]);
});

test('selected bonus symbol stays unexpanded when fewer than three reels match',()=>{
  let i=0;
  const board=egyptBonusBoard({
    symbols:[{id:8},{id:7}],selectedId:8,minReels:3,
    randomInt:()=>[0,2].includes((i++)%6)?0:1
  });
  assert.deepEqual(board.landedReels,[0,2]);
  assert.deepEqual(board.expandedReels,[]);
  assert.deepEqual(board.cells,board.initialCells);
});
test('the same two nonadjacent reels expand when configured to pay from two',()=>{
  let i=0;
  const board=egyptBonusBoard({
    symbols:[{id:8},{id:7}],selectedId:8,minReels:2,
    randomInt:()=>[0,2].includes((i++)%6)?0:1
  });
  assert.deepEqual(board.expandedReels,[0,2]);
  for(let row=0;row<4;row++){
    assert.equal(board.cells[row*6],8);
    assert.equal(board.cells[row*6+2],8);
  }
});

test('several chosen symbols pay separately on nonadjacent reels',()=>{
  const board=Array(24).fill(7);
  for(const col of [0,2,4])board[col]=8;
  for(const col of [1,5])board[6+col]=9;
  board[3*6+3]=99; // a retrigger SCATTER does not count as selected art
  const result=scoreEgyptSymbolSet({
    cells:board,selectedIds:[8,9],bet:100,minReelsById:{8:3,9:2},
    payouts:{prices:[
      {symbol_id:8,percent_hundredths:1000},
      {symbol_id:9,percent_hundredths:1000}],multipliers:[]}
  });
  assert.equal(result.symbolWins.length,2);
  assert.equal(result.symbolWins[0].prize,100);
  assert.equal(result.symbolWins[1].prize,100);
  assert.equal(result.symbolWins[0].lineWins.length,10);
  assert.equal(result.symbolWins[1].lineWins.length,10);
  assert.equal(result.total,200);
});
test('nonwinning selected symbol never expands on a zero-prize line',()=>{
  const board=Array(24).fill(7);
  board[1]=8;board[3]=8;
  const result=scoreEgyptSymbolSet({
    cells:board,selectedIds:[8],bet:100,minReelsById:{8:3},
    payouts:{prices:[{symbol_id:8,percent_hundredths:1000}],multipliers:[]}
  });
  assert.equal(result.total,0);
  assert.deepEqual(result.symbolWins[0].expandedReels,[]);
});
test('retrigger FIFO activates a new symbol and only completes when queue is empty',()=>{
  const symbols=[{id:1},{id:2},{id:3}];
  const queue=[{queue_order:1,free_spins:10},{queue_order:2,free_spins:15}];
  const first=nextEgyptBonusSeries({
    remaining:0,queue,selectedIds:[1],symbols,randomInt:()=>0
  });
  assert.equal(first.kind,'transition');
  assert.equal(first.next.free_spins,10);
  assert.deepEqual(first.selectedIds,[1,2]);
  const during=nextEgyptBonusSeries({
    remaining:4,queue:queue.slice(1),selectedIds:first.selectedIds,symbols,randomInt:()=>0
  });
  assert.equal(during.kind,'continue');
  const second=nextEgyptBonusSeries({
    remaining:0,queue:queue.slice(1),selectedIds:first.selectedIds,symbols,randomInt:()=>0
  });
  assert.equal(second.next.free_spins,15);
  assert.deepEqual(second.selectedIds,[1,2,3]);
  const final=nextEgyptBonusSeries({
    remaining:0,queue:[],selectedIds:second.selectedIds,symbols,randomInt:()=>0
  });
  assert.equal(final.kind,'complete');
});
test('unlimited retriggers do not duplicate a symbol after all were selected',()=>{
  const symbols=[{id:1},{id:2}];
  assert.equal(chooseNewEgyptSymbol(symbols,[1,2],()=>0),null);
  const extra=nextEgyptBonusSeries({
    remaining:0,queue:[{free_spins:25}],selectedIds:[1,2],symbols,randomInt:()=>0
  });
  assert.equal(extra.kind,'transition');
  assert.equal(extra.newSymbolId,null);
  assert.deepEqual(extra.selectedIds,[1,2]);
  assert.equal(extra.next.free_spins,25);
});

test('Egypt admin bonus price is applied separately to each of 10 lines',()=>{
  const cells=Array(24).fill(7);
  for(const reel of [0,2,4])cells[reel]=8;
  const result=scoreEgyptSymbolSet({
    cells,selectedIds:[8],bet:100,
    payouts:{prices:[{symbol_id:8,percent_hundredths:1000}],multipliers:[]},
    minReelsById:{8:3},linePercentById:{8:2500}
  });
  assert.equal(result.symbolWins[0].perLine,25);
  assert.equal(result.symbolWins[0].lineWins.length,10);
  assert.equal(result.symbolWins[0].prize,250);
  assert.equal(result.total,250);
});
test('Two selected symbols have separate admin payouts and both earn ten lines',()=>{
  const cells=Array(24).fill(7);
  for(const reel of [0,2,4])cells[reel]=8;
  for(const reel of [1,3,5])cells[6+reel]=9;
  const result=scoreEgyptSymbolSet({
    cells,selectedIds:[8,9],bet:100,
    payouts:{prices:[{symbol_id:8,percent_hundredths:1000},
      {symbol_id:9,percent_hundredths:1000}],multipliers:[]},
    minReelsById:{8:3,9:3},linePercentById:{8:2500,9:500}
  });
  assert.deepEqual(result.symbolWins.map(item=>item.perLine),[25,5]);
  assert.deepEqual(result.symbolWins.map(item=>item.prize),[250,50]);
  assert.equal(result.total,300);
});
test('Unset bonus line payout defaults to existing ordinary symbol price',()=>{
  const cells=Array(24).fill(7);
  for(const reel of [0,2,4])cells[reel]=8;
  const result=scoreEgyptSymbolSet({
    cells,selectedIds:[8],bet:100,
    payouts:{prices:[{symbol_id:8,percent_hundredths:1000}],multipliers:[]},
    minReelsById:{8:3},linePercentById:{8:null}
  });
  assert.equal(result.symbolWins[0].perLine,10);
  assert.equal(result.total,100);
});
