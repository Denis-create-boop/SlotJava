'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SPACE_LINES,scoreSpaceLines,expandSpaceWild}=require('../space-rules');

const symbols=[{id:1,name:'Crystal'},{id:2,name:'Meteor'},{id:9,name:'WILD'}];
const payouts={
  prices:[{symbol_id:1,percent_hundredths:10000},{symbol_id:2,percent_hundredths:5000},{symbol_id:9,percent_hundredths:0}],
  multipliers:[{symbol_id:1,reel_count:3,multiplier_milli:1000},
    {symbol_id:1,reel_count:4,multiplier_milli:1000},
    {symbol_id:1,reel_count:5,multiplier_milli:1000}]
};
function check(cells){return scoreSpaceLines({cells,symbols,bet:100,payouts,lines:SPACE_LINES,wildId:9,scatterId:10});}
test('ten editable cosmic paylines on 5x3 grid',()=>{
  assert.equal(SPACE_LINES.length,10);
  for(const line of SPACE_LINES){
    assert.equal(line.length,5);
    assert.ok(line.every(row=>row>=0&&row<3));
  }
});
test('wild substitutes for normal symbols and pays a line only once',()=>{
  const cells=Array(15).fill(2);
  cells[0]=1;cells[1]=9;cells[2]=1;cells[3]=2;cells[4]=2;
  const result=scoreSpaceLines({cells,symbols,bet:100,payouts,lines:[[0,0,0,0,0]],wildId:9,scatterId:10});
  assert.equal(result.total,300);
  assert.equal(result.wins.length,1);
  assert.equal(result.wins[0].symbolId,1);
});
test('scatter blocks a wild payline',()=>{
  const cells=Array(15).fill(2);
  cells[0]=1;cells[1]=9;cells[2]=10;
  const result=scoreSpaceLines({cells,symbols,bet:100,payouts,lines:[[0,0,0,0,0]],wildId:9,scatterId:10});
  assert.equal(result.total,0);
});
test('wild fills all three positions of exactly one reel',()=>{
  const cells=Array(15).fill(2);
  cells[2]=9;
  const result=expandSpaceWild(cells,9,10);
  assert.deepEqual(result.expandedReels,[2]);
  assert.deepEqual([result.cells[2],result.cells[7],result.cells[12]],[9,9,9]);
});
test('scatter on a wild reel prevents visual replacement',()=>{
  const cells=Array(15).fill(2);
  cells[2]=9;cells[7]=10;
  const result=expandSpaceWild(cells,9,10);
  assert.deepEqual(result.expandedReels,[]);
  assert.equal(result.cells[7],10);
});

test('Sun — WILD — Sun pays using the Sun price, not a Wild price',()=>{
  const cells=Array(15).fill(2);
  cells[0]=1;cells[1]=9;cells[2]=1;
  const result=scoreSpaceLines({
    cells,
    symbols:[{id:1,name:'Sun'},{id:2,name:'Meteor'},{id:9,name:'WILD'}],
    bet:100,
    payouts:{
      prices:[{symbol_id:1,percent_hundredths:10000},
        {symbol_id:2,percent_hundredths:0},
        {symbol_id:9,percent_hundredths:999999}],
      multipliers:[{symbol_id:1,reel_count:3,multiplier_milli:1000},
        {symbol_id:9,reel_count:3,multiplier_milli:100000}]
    },
    lines:[[0,0,0,0,0]],
    wildId:9,scatterId:10
  });
  assert.equal(result.total,300);
  assert.equal(result.wins.length,1);
  assert.equal(result.wins[0].name,'Sun');
  assert.equal(result.wins[0].count,3);
});

test('Cosmic direct paytable: two matching reels can pay stake x2.5',()=>{
  const cells=Array(15).fill(2);
  cells[0]=1;cells[1]=9;cells[2]=2;
  const result=scoreSpaceLines({cells,symbols,bet:100,payouts,lines:[[0,0,0,0,0]],
    wildId:9,scatterId:10,rules:{
      minimums:[{symbol_id:1,min_reels:2}],
      multipliers:[{symbol_id:1,matches:2,multiplier_milli:2500}]
    }});
  assert.equal(result.total,250);
  assert.equal(result.wins[0].count,2);
});
test('Cosmic 3-reel minimum blocks two, then pays direct x4 for three',()=>{
  const cells=Array(15).fill(2);
  cells[0]=1;cells[1]=9;
  const rules={minimums:[{symbol_id:1,min_reels:3}],multipliers:[
    {symbol_id:1,matches:2,multiplier_milli:9000},
    {symbol_id:1,matches:3,multiplier_milli:4000}
  ]};
  const line=[[0,0,0,0,0]];
  const input={cells,symbols,bet:100,payouts,lines:line,wildId:9,scatterId:10,rules};
  assert.equal(scoreSpaceLines(input).total,0);
  cells[2]=1;
  assert.equal(scoreSpaceLines(input).total,400);
});
test('Cosmic five matching reels pays one direct x10, not multiplied per copy',()=>{
  const cells=Array(15).fill(2);for(let col=0;col<5;col++)cells[col]=col===2?9:1;
  const result=scoreSpaceLines({cells,symbols,bet:75,payouts,lines:[[0,0,0,0,0]],
    wildId:9,scatterId:10,rules:{minimums:[{symbol_id:1,min_reels:2}],
      multipliers:[{symbol_id:1,matches:5,multiplier_milli:10000}]}});
  assert.equal(result.total,750);
  assert.equal(result.wins.length,1);
});
