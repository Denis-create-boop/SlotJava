'use strict';

// Rules are ordered by SCATTER threshold. The greatest threshold at or below
// the observed count applies. Counts above the final rule keep its award.
function scatterAwardForCount(rules,count){
  if(!Number.isSafeInteger(count)||count<1||!Array.isArray(rules))return 0;
  let bestThreshold=0,spins=0;
  for(const rule of rules){
    const threshold=Number(rule.scatter_count);
    const reward=Number(rule.free_spins);
    if(Number.isSafeInteger(threshold)&&threshold>=1&&threshold<=count&&
      threshold>=bestThreshold&&Number.isSafeInteger(reward)&&reward>=0&&reward<=25){
      bestThreshold=threshold;spins=reward;
    }
  }
  return spins;
}
module.exports={scatterAwardForCount};
