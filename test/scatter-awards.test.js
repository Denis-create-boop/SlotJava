'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {scatterAwardForCount}=require('../scatter-awards');

test('Configured rewards for three, four, five scatters',()=>{
  const awards=[{scatter_count:3,free_spins:10},{scatter_count:4,free_spins:15},{scatter_count:5,free_spins:20}];
  assert.equal(scatterAwardForCount(awards,2),0);
  assert.equal(scatterAwardForCount(awards,3),10);
  assert.equal(scatterAwardForCount(awards,4),15);
  assert.equal(scatterAwardForCount(awards,5),20);
  assert.equal(scatterAwardForCount(awards,6),20);
  assert.equal(scatterAwardForCount(awards,7),20);
  assert.equal(scatterAwardForCount(awards,100),20);
});
test('Edited and deleted thresholds use greatest matching count',()=>{
  const awards=[{scatter_count:5,free_spins:18},{scatter_count:3,free_spins:6}];
  assert.equal(scatterAwardForCount(awards,4),6);
  assert.equal(scatterAwardForCount(awards,5),18);
  assert.equal(scatterAwardForCount(awards,9),18);
});
test('Award of zero suppresses bonus and empty table gives no bonus',()=>{
  assert.equal(scatterAwardForCount([],7),0);
  assert.equal(scatterAwardForCount([{scatter_count:3,free_spins:10},{scatter_count:5,free_spins:0}],5),0);
  assert.equal(scatterAwardForCount([{scatter_count:3,free_spins:10},{scatter_count:5,free_spins:0}],10),0);
});
