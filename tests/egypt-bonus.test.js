'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EGYPT_LINES,egyptBonusBoard,scoreEgyptBonus,egyptFreeSpinsFor}=require('../egypt-bonus');
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
