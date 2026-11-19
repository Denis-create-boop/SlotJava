'use strict';
const LAYOUTS=Object.freeze({
  'slot-classic':Object.freeze({reels:5,rows:4,theme:'classic'}),
  'golden-seven':Object.freeze({reels:6,rows:4,theme:'egypt'}),
  'lucky-stars':Object.freeze({reels:5,rows:3,theme:'space'})
});
function gameLayout(game){return LAYOUTS[typeof game==='string'?game:game?.slug]||LAYOUTS['slot-classic'];}
const playableGame=game=>Boolean(LAYOUTS[typeof game==='string'?game:game?.slug]);
module.exports={gameLayout,playableGame};
