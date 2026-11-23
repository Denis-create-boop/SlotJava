'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {playBonusRound}=require('../slot-bonus');

const symbols=[{id:1,name:'Череп'},{id:2,name:'Дьявол'},{id:9,name:'WILD'}];
const noWins=()=>({total:0,wins:[]});
const settings={symbols,payouts:{prices:[],multipliers:[]},bet:10,
  reels:5,rows:4,randomInt:n=>0,scoreBoard:noWins,wildId:9,
  scatterId:10,scatterRules:[],maxRespins:2};

test('Pre-existing sticky Wild stays on the exact cell and freezes on every respin',()=>{
  const spin=playBonusRound({...settings,stickyWildPositions:[6],wildChancePercent:0});
  assert.equal(spin.board[6],9);
  assert.deepEqual(spin.stickyWildPositions,[6]);
  assert.deepEqual(spin.steps[0].frozenCells,[6]);
  assert.equal(spin.steps.length,1);
});
test('100 percent chance locks all free cells as Wild and persists positions',()=>{
  const spin=playBonusRound({...settings,stickyWildPositions:[],wildChancePercent:100});
  assert.equal(spin.stickyWildPositions.length,20);
  assert.ok(spin.board.every(id=>id===9));
  assert.deepEqual(spin.steps[0].frozenCells,Array.from({length:20},(_,i)=>i));
});
test('0 percent chance blocks new Wild without removing existing sticky Wild',()=>{
  const spin=playBonusRound({...settings,stickyWildPositions:[0,17],wildChancePercent:0});
  assert.deepEqual(spin.stickyWildPositions,[0,17]);
  assert.equal(spin.board[0],9);
  assert.equal(spin.board[17],9);
  assert.ok(spin.board.every((id,i)=>id!==9||i===0||i===17));
});
test('Wild chance is separate from ordinary Wild weight',()=>{
  const spin=playBonusRound({...settings,stickyWildPositions:[],wildChancePercent:0});
  assert.equal(spin.stickyWildPositions.length,0);
  assert.ok(spin.board.every(id=>id!==9));
});
