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

test('bonus respins can land Scatters without replacing locked symbols',()=>{
  const symbols=[{id:1,name:'A'},{id:2,name:'B'}];
  const reels=5,rows=4;
  // Begin with A on the first three reels, establishing frozen positions.
  const initial=Array.from({length:20},(_,i)=>i<3?1:2);
  let calls=0;
  const randomInt=n=>{
    // Initial board indexes, then 100% Scatter chance succeeds in reel 4;
    // further random data is deterministic.
    if(calls<20)return initial[calls++]-1;
    calls++;
    return 0;
  };
  const scoreBoard=cells=>{
    const win=[cells[0],cells[1],cells[2]].every(id=>id===1);
    return {total:win?8:0,wins:win?[{symbolId:1,reels:3,prize:8}]:[]};
  };
  const rules=Array.from({length:5},(_,i)=>({
    reel_index:i+1,chance_percent:i===3?100:0,max_symbols:1
  }));
  const round=playBonusRound({
    symbols,payouts:{},bet:10,reels,rows,randomInt,scoreBoard,
    scatterId:99,scatterRules:rules,maxRespins:2
  });
  assert.ok(round.scatterCount>=1);
  assert.equal(round.scatterCount,round.steps.reduce((sum,step)=>sum+step.scatterCount,0));
  for(let step=1;step<round.steps.length;step++){
    for(const position of round.steps[step-1].frozenCells){
      assert.equal(round.steps[step].cells[position],round.steps[step-1].cells[position]);
    }
  }
  assert.ok(round.steps.some(step=>step.cells.includes(99)));
});

test('Scatter landing never overwrites a previously frozen cell',()=>{
  const locked=new Set([0,5,10,15]);
  const rules=Array.from({length:5},(_,i)=>({
    reel_index:i+1,chance_percent:100,max_symbols:4
  }));
  const result=scatterOnBoard(Array(20).fill(1),99,rules,4,5,n=>n-1,locked);
  for(const cell of locked)assert.equal(result.cells[cell],1);
  assert.equal(result.count,16);
});
