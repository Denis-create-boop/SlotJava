'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {scoreEgyptSymbolSet,egyptWeightedPicker,chooseNewEgyptSymbol}=require('../egypt-bonus');

const regular=[{id:1,name:'Ankh'},{id:2,name:'Pharaoh'}];
const wild={id:9,name:'WILD'};

test('Egyptian bonus Wild remains a reel symbol and expands as the selected symbol',()=>{
  const cells=Array(24).fill(2);
  // Three qualifying reels: Ankh on reels 1, 3 and a Wild on reel 5.
  cells[0]=1; cells[2]=1; cells[4]=wild.id;
  const result=scoreEgyptSymbolSet({
    cells,selectedIds:[1],bet:100,wildId:wild.id,
    minReelsById:{1:3},
    linePricesById:{'1:3':200000000},
    payouts:{prices:[],multipliers:[]},
    lines:[[0,0,0,0,0,0]]
  });
  assert.equal(result.total,200);
  assert.deepEqual(result.symbolWins[0].expandedReels,[0,2,4]);
  assert.equal(result.symbolWins[0].symbolId,1);
  assert.ok(!result.symbolWins.some(item=>item.symbolId===wild.id));
});

test('Egyptian Wild is eligible on reels but excluded from bonus-symbol selection',()=>{
  const weights={1:100,2:100,9:100};
  const reelPool=[...regular,wild];
  const selectionPool=reelPool.filter(symbol=>symbol.id!==wild.id);
  assert.equal(egyptWeightedPicker(reelPool,weights,()=>200),9);
  assert.equal(egyptWeightedPicker(selectionPool,weights,()=>0),1);
  assert.equal(chooseNewEgyptSymbol(selectionPool,[1],()=>0),2);
  assert.equal(chooseNewEgyptSymbol(selectionPool,[1,2],()=>0),null);
});
