'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {excludeEgyptWildOnSelectedReels,scoreEgyptSymbolSet}=require('../egypt-bonus');

test('Wild is removed only from reels carrying an active bonus symbol',()=>{
  const wild=90,scatter=91;
  const cells=Array(24).fill(3);
  // Reel 1: selected symbol + Wild; reel 2: only Wild and ordinary symbols;
  // reel 3: second active symbol + Wild; reel 4: scatter + Wild only.
  cells[0]=10;cells[6]=wild;
  cells[1]=wild;
  cells[2]=11;cells[8]=wild;
  cells[3]=scatter;cells[9]=wild;
  const result=excludeEgyptWildOnSelectedReels({
    cells,selectedIds:[10,11],wildId:wild,chooseOrdinary:()=>3
  });
  assert.equal(result[6],3);
  assert.equal(result[1],wild);
  assert.equal(result[8],3);
  assert.equal(result[9],wild);
  assert.equal(result[0],10);
  assert.equal(result[2],11);
  assert.equal(result[3],scatter);
  assert.equal(cells[6],wild); // input is not mutated
});

test('Selected bonus symbol never shares a reel with Wild after filtering',()=>{
  const wild=90,selected=[10,11];
  const cells=Array.from({length:24},(_,index)=>index%3===0?wild:3);
  cells[0]=10;cells[14]=11;
  const result=excludeEgyptWildOnSelectedReels({
    cells,selectedIds:selected,wildId:wild,chooseOrdinary:()=>3
  });
  for(let reel=0;reel<6;reel++){
    const values=Array.from({length:4},(_,row)=>result[row*6+reel]);
    if(values.some(id=>selected.includes(id)))
      assert.ok(!values.includes(wild),'reel '+reel+' still has Wild');
  }
});

test('Wild on a reel without selected symbol still helps the Egyptian bonus payout',()=>{
  const wild=90,selected=10;
  const cells=Array(24).fill(3);
  cells[0]=selected;
  cells[1]=wild;
  cells[2]=selected;
  const filtered=excludeEgyptWildOnSelectedReels({
    cells,selectedIds:[selected],wildId:wild,chooseOrdinary:()=>3
  });
  const round=scoreEgyptSymbolSet({
    cells:filtered,selectedIds:[selected],wildId:wild,bet:100,
    payouts:{prices:[],multipliers:[]},
    linePricesById:{'10:3':200000000},
    lines:[[0,0,0,0,0,0]]
  });
  assert.equal(round.total,200);
  assert.deepEqual(round.symbolWins[0].expandedReels,[0,1,2]);
});

test('Bonus board with no active symbols is unchanged by the restriction',()=>{
  const cells=Array(24).fill(3);cells[0]=90;
  assert.deepEqual(excludeEgyptWildOnSelectedReels({
    cells,selectedIds:[],wildId:90,chooseOrdinary:()=>3
  }),cells);
});
