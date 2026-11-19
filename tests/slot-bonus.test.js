'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scatterOnBoard,freeSpinsFor,playBonusRound}=require('../slot-bonus');

test('scatter awards ten/fifteen/twenty free spins',()=>{
  assert.equal(freeSpinsFor(2),0);
  assert.equal(freeSpinsFor(3),10);
  assert.equal(freeSpinsFor(4),15);
  assert.equal(freeSpinsFor(5),20);
  assert.equal(freeSpinsFor(8),20);
});

test('Scatter probability is configured independently for each reel',()=>{
  const rules=Array.from({length:5},(_,i)=>({
    reel_index:i+1,chance_percent:i<3?100:0,max_symbols:1
  }));
  const placed=scatterOnBoard(Array(20).fill(1),99,rules,4,5,()=>0);
  assert.equal(placed.count,3);
  assert.deepEqual(placed.cells.filter(x=>x===99).length,3);
});

test('winning cells stay frozen while other cells on their reels respin',()=>{
  const symbols=Array.from({length:21},(_,i)=>({id:i+1,name:'S'+(i+1)}));
  const first=Array.from({length:20},(_,i)=>i<3?1:i+2);
  const calls=first.map(id=>id-1).concat(Array(200).fill(1));
  let index=0;
  const randomInt=n=>(calls[index++]||0)%n;
  const scoreBoard=cells=>{
    const firstThree=[cells[0],cells[1],cells[2]].every(id=>id===1);
    return {total:firstThree?20:0,wins:firstThree?[{symbolId:1,reels:3,prize:20}]:[]};
  };
  const outcome=playBonusRound({
    symbols,payouts:{},bet:10,reels:5,rows:4,randomInt,scoreBoard
  });
  assert.ok(outcome.steps.length>=2,'a qualifying chain triggers a respin');
  assert.deepEqual(outcome.steps[0].frozenCells,[0,1,2]);
  for(let step=1;step<outcome.steps.length;step++){
    const previous=outcome.steps[step-1],current=outcome.steps[step];
    for(const position of previous.frozenCells){
      assert.equal(current.cells[position],previous.cells[position],'locked cell unchanged');
    }
  }
  assert.notEqual(outcome.steps[0].cells[5],outcome.steps[1].cells[5],
    'another cell in the same reel rerolls');
  assert.equal(outcome.respins,outcome.steps.length-1);
});
