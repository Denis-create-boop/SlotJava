'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SPACE_LINES,scoreSpaceLines,expandSpaceWild,resolveSpaceWildBonus}=require('../space-rules');

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
test('losing Wild stays small when it does not play on a paid line',()=>{
  const cells=Array(15).fill(2);
  cells[2]=9;
  const result=expandSpaceWild(cells,9,10,[]);
  assert.deepEqual(result.expandedReels,[]);
  assert.equal(result.cells[2],9);
  assert.equal(result.cells[7],2);
  assert.equal(result.cells[12],2);
});
test('winning Wild expands full reel, preserving the Scatter on it',()=>{
  const cells=Array(15).fill(2);
  cells[0]=1;cells[1]=1;cells[2]=9;cells[7]=10;
  const rules={minimums:[{symbol_id:1,min_reels:3}],multipliers:[
    {symbol_id:1,matches:3,multiplier_milli:5000}]};
  const score=scoreSpaceLines({cells,symbols,bet:100,payouts,
    lines:[[0,0,0,0,0]],wildId:9,scatterId:10,rules});
  assert.equal(score.total,500);
  const expanded=expandSpaceWild(cells,9,10,score.wins);
  assert.deepEqual(expanded.expandedReels,[2]);
  assert.equal(expanded.cells[2],9);
  assert.equal(expanded.cells[7],10);
  assert.equal(expanded.cells[12],9);
  assert.equal(cells[12],2); // do not mutate pre-expansion cells
});
test('Wild on another row does not expand even if a different line wins',()=>{
  const cells=Array(15).fill(2);
  cells[0]=1;cells[1]=1;cells[2]=1;cells[7]=9;
  const rules={minimums:[{symbol_id:1,min_reels:3}],multipliers:[
    {symbol_id:1,matches:3,multiplier_milli:3000}]};
  const score=scoreSpaceLines({cells,symbols,bet:100,payouts,
    lines:[[0,0,0,0,0]],wildId:9,scatterId:10,rules});
  assert.equal(score.total,300);
  const expanded=expandSpaceWild(cells,9,10,score.wins);
  assert.deepEqual(expanded.expandedReels,[]);
  assert.equal(expanded.cells[7],9);
  assert.equal(expanded.cells[2],1);
});
test('Scatter remains a blocker even on the expanded Wild reel',()=>{
  const cells=Array(15).fill(2);
  cells[0]=1;cells[1]=1;cells[2]=9;cells[7]=10;
  const rules={minimums:[{symbol_id:1,min_reels:3}],multipliers:[
    {symbol_id:1,matches:3,multiplier_milli:5000}]};
  const initial=scoreSpaceLines({cells,symbols,bet:100,payouts,
    lines:[[0,0,0,0,0]],wildId:9,scatterId:10,rules});
  const expanded=expandSpaceWild(cells,9,10,initial.wins);
  const blocked=scoreSpaceLines({cells:expanded.cells,symbols,bet:100,payouts,
    lines:[[0,0,1,0,0]],wildId:9,scatterId:10,rules});
  assert.equal(blocked.total,0);
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

test('cascade: a winning first-reel Wild can activate the fourth and then fifth Wild',()=>{
  const cells=Array(15).fill(2);
  // First Wild is on reel 1 top; fourth and fifth Wilds are not on
  // a paying line initially. Their turn comes only after earlier expansion.
  cells[0]=9;cells[3+2*5]=9;cells[4+2*5]=9;
  cells[1]=1;cells[2]=1;
  const lines=[
    [0,0,0,1,1], // initial 3-reel win uses Wild on first reel
    [1,0,0,2,1], // first expansion opens line through fourth Wild
    [1,0,0,1,2]  // fourth expansion opens line through fifth Wild
  ];
  const rules={minimums:[{symbol_id:1,min_reels:3}],
    multipliers:[3,4,5].map(matches=>({
      symbol_id:1,matches,multiplier_milli:matches*1000
    }))};
  const options={cells,symbols,bet:100,payouts,lines,wildId:9,scatterId:10,rules};
  const original=scoreSpaceLines(options);
  assert.equal(original.wins.length,1);
  const result=resolveSpaceWildBonus(options);
  assert.deepEqual(result.expansion.expandedReels,[0,3,4]);
  assert.equal(result.expansion.cells[4],9);
  assert.equal(result.expansion.cells[9],9);
  assert.equal(result.scored.wins.length,3);
  // Every one of the three configured lines now reaches five reels (×5).
  assert.equal(result.scored.total,1500);
});
test('cascade does not expand a Wild outside winning paylines',()=>{
  const cells=Array(15).fill(2);
  cells[0]=9;cells[1]=1;cells[2]=1;cells[14]=9;
  const options={cells,symbols,bet:100,payouts,lines:[[0,0,0,1,1]],
    wildId:9,scatterId:10,rules:{
      minimums:[{symbol_id:1,min_reels:3}],
      multipliers:[{symbol_id:1,matches:3,multiplier_milli:3000}]
    }};
  const result=resolveSpaceWildBonus(options);
  assert.deepEqual(result.expansion.expandedReels,[0]);
  assert.equal(result.expansion.cells[14],9);
  assert.equal(result.expansion.cells[4],2);
});
