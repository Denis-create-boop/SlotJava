const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { installGameAdmin } = require('./game-admin');
const { gameLayout, playableGame } = require('./game-layout');
const { db, verifyPassword, validUsername, validPassword, getUserByName, createUser, countActiveAdmins, listGames, gameById, getGameSettings, getGameAssets, getSymbols, getPayouts, getWallet, getLibraryImages, getSymbolImageLinks, getGameBackgroundImages, getScatterSettings, getBonusSession, getEgyptBonusChain } = require('./db');
const { scatterOnBoard,freeSpinsFor,playBonusRound } = require('./slot-bonus');
const { SPACE_LINES,scoreSpaceLines,expandSpaceWild } = require('./space-rules');
const { EGYPT_LINES,egyptWeightedPicker,egyptBonusBoard,scoreEgyptBonus,egyptFreeSpinsFor,scoreEgyptSymbolSet,scoreEgyptBaseLines,nextEgyptBonusSeries } = require('./egypt-bonus');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"],
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use('/static', express.static(path.join(__dirname,'public'), { maxAge: IS_PRODUCTION ? '1h' : 0 }));
const limiter = rateLimit({ windowMs: 15*60*1000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false });
app.use(['/login','/register'], limiter);
app.use('/admin', rateLimit({ windowMs: 15*60*1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

const h = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('hex');
const cookies = req => {
  const result = {};
  for (const entry of (req.headers.cookie || '').split(';')) {
    const index = entry.indexOf('=');
    if (index < 1) continue;
    try { result[entry.slice(0,index).trim()] = decodeURIComponent(entry.slice(index+1).trim()); } catch {}
  }
  return result;
};
const cookieOpt = secure => '; Path=/; HttpOnly; SameSite=Lax' + (secure?'; Secure':'');
function setCookie(res,name,value,seconds,secure) {
  res.append('Set-Cookie', name+'='+encodeURIComponent(value)+'; Max-Age='+seconds+cookieOpt(secure));
}
function clearCookie(res,name,secure) { setCookie(res,name,'',0,secure); }
function safeEqual(a,b) {
  if(typeof a !== 'string' || typeof b !== 'string') return false;
  const x=Buffer.from(a); const y=Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x,y);
}
// Persisted secret survives app restarts, but is ignored by Git.
const secretFile=path.join(__dirname,'data','.csrf-secret');
let csrfSecret;
try {
  csrfSecret=fs.readFileSync(secretFile);
} catch(e) {
  if(e.code!=='ENOENT') throw e;
  try {fs.writeFileSync(secretFile,crypto.randomBytes(32),{mode:0o600,flag:'wx'});} catch(writeError) {
    if(writeError.code!=='EEXIST') throw writeError;
  }
  csrfSecret=fs.readFileSync(secretFile);
}
if(csrfSecret.length!==32) throw new Error('Invalid CSRF secret; restore or regenerate securely');
function issueGuestCsrf() {
  const payload=Date.now().toString(36)+'.'+crypto.randomBytes(16).toString('hex');
  const signature=crypto.createHmac('sha256',csrfSecret).update(payload).digest('hex');
  return payload+'.'+signature;
}
function verifyGuestCsrf(value) {
  if(typeof value!=='string' || !/^[a-z0-9]+\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) return false;
  const pieces=value.split('.');
  const age=Date.now()-parseInt(pieces[0],36);
  if(!Number.isFinite(age) || age<0 || age>60*60*1000) return false;
  const payload=pieces[0]+'.'+pieces[1];
  const signature=crypto.createHmac('sha256',csrfSecret).update(payload).digest('hex');
  return safeEqual(signature,pieces[2]);
}
function safeRequestSource(req) {
  // This check is independent of proxy host/protocol translations.
  const site=req.get('sec-fetch-site');
  return !site || site==='same-origin' || site==='none';
}
app.use((req,res,next) => {
  res.set('Cache-Control', 'no-store');
  const c=cookies(req);
  req.sessionToken=c.slot_session;
  req.session=null; req.user=null;
  if(req.sessionToken && /^[a-f0-9]{64}$/.test(req.sessionToken)){
    const row=db.prepare(`SELECT s.csrf_token,s.expires_at,u.id,u.username,u.role,u.active
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at > ?`).get(sha(req.sessionToken),Date.now());
    if(row && row.active) {req.session=row;req.user=row;}
  }
  next();
});
function csrfInput(value) { return '<input type="hidden" name="_csrf" value="'+h(value)+'">'; }
function csrfFor(req) { return req.session?.csrf_token || issueGuestCsrf(); }
function verifyCsrf(req) {
  if(!safeRequestSource(req)) return false;
  const provided=req.body?._csrf;
  return req.session ? safeEqual(provided,req.session.csrf_token) : verifyGuestCsrf(provided);
}
function guarded(req,res,next) { if(!req.user)return res.redirect('/login'); next(); }
function adminOnly(req,res,next) { if(!req.user)return res.redirect('/login');if(req.user.role!=='admin')return res.status(403).send('Доступ запрещён');next(); }
function postGuard(req,res,next) {
  if(!verifyCsrf(req)) {
    console.warn('CSRF rejected:', {path:req.path, authenticated:!!req.user, fetchSite:req.get('sec-fetch-site')||'unknown'});
    return res.status(403).send('Проверка безопасности формы не пройдена. Обновите страницу и повторите действие.');
  }
  next();
}
function layout(title,body,user,csrf,balanceLabel) {
  const menu=user
    ? '<a href="/">Главная</a>'+(user.role==='admin'?'<a href="/admin">Админ-панель</a>':'')+
      (balanceLabel===null?'':'<span class="header-user-balance" aria-label="Баланс Первой игры"><span>Баланс</span><strong>'+h(balanceLabel)+'</strong></span>')+
      '<form method="post" action="/logout" class="inline">'+csrfInput(csrf)+'<button type="submit">Выход</button></form>'
    : '<a href="/login">Войти</a><a href="/register">Регистрация</a>';
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+h(title)+' · SlotJava</title><link rel="stylesheet" href="/static/style.css?v=space-multiplier-20261122"></head>'+
    '<body><header><a class="brand" href="/">🎰 SlotJava</a><nav>'+menu+'</nav></header><main>'+body+'</main>'+
    '<footer>SlotJava · браузерная версия в разработке · сборка egypt-art-3</footer><script src="/static/app.js?v=space-multiplier-20261122" defer></script></body></html>';
}
function sendPage(res,title,body,req,status=200) {
  let balanceLabel=null;
  if(req.user&&!req.path.startsWith('/games/')){
    balanceLabel=db.prepare('SELECT balance FROM user_balances WHERE user_id=?').get(req.user.id)?.balance??1000;
  }
  res.status(status).send(layout(title,body,req.user,req.session?.csrf_token,balanceLabel));
}
function redirectHomeIfLogged(req,res,next){if(req.user)return res.redirect('/');next();}
function authForm(title,action,req,res,error='') {
  const csrf=csrfFor(req);
  const isRegister=action==='/register';
  sendPage(res,title,'<section class="panel auth"><h1>'+h(title)+'</h1>'+
    (error?'<p class="error" role="alert">'+h(error)+'</p>':'')+
    '<form method="post" action="'+action+'">'+csrfInput(csrf)+
    '<label>Логин<input name="username" autocomplete="username" minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" required></label>'+
    '<label>Пароль<input type="password" name="password" autocomplete="'+(isRegister?'new-password':'current-password')+'" required></label>'+
    (isRegister?'<p class="hint">Логин: 3–30 латинских букв, цифр и _. Пароль: минимум 12 символов.</p>':'')+
    '<button class="primary" type="submit">'+h(title)+'</button></form>'+
    '<p class="hint">'+(isRegister?'<a href="/login">Уже есть аккаунт?</a>':'<a href="/register">Создать аккаунт</a>')+'</p></section>',req,error?400:200);
}
app.get('/',(req,res)=>{
  if(!req.user) {
    return sendPage(res,'Главная','<section class="hero"><p class="eyebrow">Новый проект</p><h1>Добро пожаловать</h1>'+
      '<p>Войдите или зарегистрируйтесь, чтобы перейти к играм.</p>'+
      '<div class="actions"><a class="primary" href="/register">Зарегистрироваться</a><a class="secondary" href="/login">Войти</a></div></section>',req);
  }
  const games=listGames(true);
  const cards=games.map(game=>{
    const logoAssignment=getGameBackgroundImages(game.id).find(image=>image.asset_key==='logo');
    const logoAsset=getGameAssets(game.id).some(asset=>asset.asset_key==='logo');
    const logo=logoAssignment
      ?(logoAssignment.builtin_path||'/game-library/'+game.id+'/'+logoAssignment.library_image_id)
      :logoAsset?'/game-assets/'+game.id+'/logo':null;
    const cardImage=logo||game.image_path;
    return '<article class="game-card'+(logo?' game-card-has-logo':'')+'"><a class="game-card-link" href="/games/'+encodeURIComponent(game.slug)+'">'+
      '<img loading="lazy" src="'+h(cardImage)+'" alt="'+(logo?'Логотип':'Обложка')+' игры '+h(game.title)+'" width="720" height="450">'+
      '<h2>'+h(game.title)+'</h2></a></article>';
  }).join('');
  sendPage(res,'Игры','<section class="games-section"><div class="section-title"><p class="eyebrow">Каталог игр</p><h1>Выберите игру</h1></div>'+
    '<div class="games-grid">'+cards+'</div></section>',req);
});
const spinLimiter=rateLimit({windowMs:60*1000,limit:60,standardHeaders:'draft-7',legacyHeaders:false});
function scoreBoard(cells,symbols,payouts,bet=10,rows=4,egyptMinimums=null,wildId=0){
  // Payout = stake * (symbol price % / 100) * matching occurrences
  //        * multiplier for the last consecutive reel. First 3 mandatory.
  const reelCount=Math.floor(cells.length/rows);
  const priceMap=new Map(payouts.prices.map(p=>[p.symbol_id,p.percent_hundredths]));
  const reelMultipliers=new Map(payouts.multipliers.map(p=>[p.symbol_id+':'+p.reel_count,p.multiplier_milli]));
  const wins=[];
  let total=0;
  for(const symbol of symbols){
    if(symbol.id===wildId)continue;
    let reels=0,count=0;
    for(let col=0;col<reelCount;col++){
      let found=0;
      for(let row=0;row<rows;row++){
        if(cells[row*reelCount+col]===symbol.id||(wildId&&cells[row*reelCount+col]===wildId))found++;
      }
      if(!found)break;
      reels++;
      count+=found;
    }
    const minimum=egyptMinimums?.get(symbol.id)===2?2:3;
    if(reels<minimum)continue;
    const percentHundredths=priceMap.get(symbol.id)||0;
    const multiplierMilli=reelMultipliers.get(symbol.id+':'+reels)??1000;
    const prize=percentHundredths>0&&multiplierMilli>0
      ?Math.round(bet*count*percentHundredths*multiplierMilli/10000000):0;
    // All qualifying left-to-right chains are returned for visual highlights,
    // even when the price is unset, disabled or rounds down to zero.
    // Only positive awards contribute to the wallet and winning frequency.
    total+=prize;
    wins.push({symbolId:symbol.id,name:symbol.name,reels,count,
      percentHundredths,multiplierMilli,prize});
  }
  return {total,wins};
}
function egyptPaylines(gameId){
  return db.prepare('SELECT rows_json FROM egypt_paylines WHERE game_id=? ORDER BY position,id')
    .all(gameId).map(row=>JSON.parse(row.rows_json));
}
function egyptSymbolWeights(gameId){
  return Object.fromEntries(db.prepare(`SELECT w.symbol_id,w.weight
    FROM egypt_symbol_weights w JOIN game_symbols s ON s.id=w.symbol_id
    WHERE s.game_id=?`).all(gameId).map(row=>[row.symbol_id,row.weight]));
}
function wildSymbol(gameId){return db.prepare('SELECT symbol_id FROM game_wild_symbols WHERE game_id=?').get(gameId)?.symbol_id||0;}
function spacePaylines(gameId){return db.prepare('SELECT rows_json FROM space_paylines WHERE game_id=? ORDER BY position,id').all(gameId).map(row=>JSON.parse(row.rows_json));}
function spaceRules(gameId){
  const minimums=db.prepare(`SELECT r.symbol_id,r.min_reels FROM space_symbol_rules r
    JOIN game_symbols s ON s.id=r.symbol_id WHERE s.game_id=?`).all(gameId);
  const multipliers=db.prepare(`SELECT m.symbol_id,m.matches,m.multiplier_milli
    FROM space_symbol_multipliers m JOIN game_symbols s ON s.id=m.symbol_id
    WHERE s.game_id=?`).all(gameId);
  return {minimums,multipliers};
}
function cosmicVisibleSymbols(gameId){
  // Consistent with the admin: only currently available library artwork
  // can produce a normal Cosmic reel symbol.
  const linked=new Set(getSymbolImageLinks(gameId).map(row=>row.symbol_id));
  return getSymbols(gameId).filter(symbol=>linked.has(symbol.id));
}
function cosmicBonusMultiplier(userId,gameId){
  return db.prepare('SELECT value FROM space_bonus_multipliers WHERE user_id=? AND game_id=?')
    .get(userId,gameId)?.value||1;
}
function generateSpin(gameId,winFrequency,bet,layout={reels:5,rows:4}){
  const scatter=getScatterSettings(gameId);
  const wildId=wildSymbol(gameId);
  const game=gameById(gameId);
  const symbols=(game?.slug==='lucky-stars'?cosmicVisibleSymbols(gameId):getSymbols(gameId))
    .filter(symbol=>symbol.id!==scatter?.symbolId);
  const payouts=getPayouts(gameId);
  const egyptMinimums=game?.slug==='golden-seven'
    ?new Map(db.prepare(`SELECT symbol_id,min_reels FROM egypt_symbol_bonus_rules
        WHERE symbol_id IN (SELECT id FROM game_symbols WHERE game_id=?)`).all(gameId)
        .map(rule=>[rule.symbol_id,rule.min_reels])):null;
  const egyptPrices=game?.slug==='golden-seven'
    ?Object.fromEntries(db.prepare(`SELECT p.symbol_id,p.matches,p.percent_millionths
        FROM egypt_line_prices p JOIN game_symbols s ON s.id=p.symbol_id
        WHERE s.game_id=?`).all(gameId)
        .map(rule=>[rule.symbol_id+':'+rule.matches,rule.percent_millionths])):null;
  const lines=egyptPrices?egyptPaylines(gameId):null;
  const evaluate=board=>egyptPrices
    ?scoreEgyptBaseLines({cells:board,symbols,bet,payouts,
        minReelsById:Object.fromEntries(egyptMinimums),linePricesById:egyptPrices,lines,wildId})
    :game?.slug==='lucky-stars'?scoreSpaceLines({cells:board,symbols,bet,payouts,lines:spacePaylines(gameId),wildId,scatterId:scatter?.symbolId||0,rules:spaceRules(gameId)})
    :scoreBoard(board,symbols,payouts,bet,rows,egyptMinimums,wildId);
  if(!symbols.length)return {error:'Добавьте хотя бы один символ в админке.'};
  const reelCount=layout.reels,rows=layout.rows;
  const weighted=egyptPrices?egyptSymbolWeights(gameId):null;
  const availableSymbols=weighted?symbols.filter(symbol=>(weighted[symbol.id]??100)>0):symbols;
  if(!availableSymbols.length)return {error:'У всех символов Египта вес 0. Укажите хотя бы один положительный вес в админке.'};
  const choose=weighted?egyptWeightedPicker(availableSymbols,weighted,n=>crypto.randomInt(n))
    :()=>symbols[crypto.randomInt(symbols.length)].id;
  const randomBoard=()=>Array.from({length:rows*reelCount},choose);
  const wantWin=crypto.randomInt(100)<winFrequency;
  let cells=randomBoard(),evaluation=evaluate(cells);
  for(let trial=0;trial<180&&Boolean(evaluation.total)!==wantWin;trial++){
    cells=randomBoard();evaluation=evaluate(cells);
  }
  if(wantWin&&evaluation.total===0&&symbols.length>=2){
    const reelRules=new Map(payouts.multipliers.map(p=>[p.symbol_id+':'+p.reel_count,p.multiplier_milli]));
    const cosmic=game?.slug==='lucky-stars';
    const cosmicRules=cosmic?spaceRules(gameId):null;
    const cosmicMin=new Map((cosmicRules?.minimums||[]).map(row=>[row.symbol_id,row.min_reels]));
    const cosmicPrices=new Map((cosmicRules?.multipliers||[]).map(row=>[row.symbol_id+':'+row.matches,row.multiplier_milli]));
    const candidates=egyptPrices
      ?availableSymbols.filter(symbol=>symbol.id!==wildId&&Array.from({length:5},(_,i)=>i+2)
          .some(count=>(egyptPrices[symbol.id+':'+count]??0)>0))
          .map(symbol=>({symbol_id:symbol.id}))
      :cosmic
      ?availableSymbols.filter(symbol=>symbol.id!==wildId&&Array.from({length:6-(cosmicMin.get(symbol.id)===2?2:3)},(_,i)=>i+(cosmicMin.get(symbol.id)===2?2:3))
          .some(count=>(cosmicPrices.get(symbol.id+':'+count)||0)>0))
          .map(symbol=>({symbol_id:symbol.id}))
      :payouts.prices.filter(p=>p.symbol_id!==wildId&&p.percent_hundredths>0&&symbols.some(sym=>sym.id===p.symbol_id));
    for(let trial=0;trial<Math.min(candidates.length*30,240)&&evaluation.total===0;trial++){
      const rule=egyptPrices
        ?{symbol_id:egyptWeightedPicker(
          candidates.map(candidate=>({id:candidate.symbol_id})),weighted,n=>crypto.randomInt(n))()}
        :candidates[crypto.randomInt(candidates.length)];
      const others=availableSymbols.filter(item=>item.id!==rule.symbol_id);
      if(!others.length)continue;
      const minReels=cosmicMin?.get(rule.symbol_id)===2||egyptMinimums?.get(rule.symbol_id)===2?2:3;
      const available=egyptPrices?Array.from({length:reelCount-minReels+1},(_,i)=>i+minReels)
        .filter(count=>(egyptPrices[rule.symbol_id+':'+count]??0)>0):cosmic?Array.from({length:reelCount-minReels+1},(_,i)=>i+minReels)
        .filter(count=>(cosmicPrices.get(rule.symbol_id+':'+count)||0)>0):null;
      if(available&&!available.length)continue;
      const activeReels=available
        ?available[crypto.randomInt(available.length)]
        :minReels+crypto.randomInt(reelCount-minReels+1);
      if(!egyptPrices&&!cosmic&&(reelRules.get(rule.symbol_id+':'+activeReels)??1000)<=0)continue;
      const otherChoose=egyptPrices
        ?egyptWeightedPicker(others,weighted,n=>crypto.randomInt(n))
        :()=>others[crypto.randomInt(others.length)].id;
      const arranged=Array.from({length:rows*reelCount},otherChoose);
      const activeLines=egyptPrices?lines:game?.slug==='lucky-stars'?spacePaylines(gameId):null;
      const line=activeLines?.length?crypto.randomInt(activeLines.length):null;
      const egyptPath=line===null?null:activeLines[line];
      for(let col=0;col<activeReels;col++)
        arranged[(egyptPath?egyptPath[col]:crypto.randomInt(rows))*reelCount+col]=rule.symbol_id;
      const scored=evaluate(arranged);
      if(scored.total>0){cells=arranged;evaluation=scored;}
    }
  }
  // Scatter positions are placed only after normal board generation; this
  // decouples the free-spin trigger from regular winning-chain frequency.
  let scatterCount=0;
  if(scatter&&(layout.reels===5||layout.reels===6)){
    const placed=scatterOnBoard(cells,scatter.symbolId,scatter.rules,rows,reelCount,n=>crypto.randomInt(n));
    cells=placed.cells;scatterCount=placed.count;
    evaluation=evaluate(cells);
  }
  return {cells,total:evaluation.total,wins:evaluation.wins,win:evaluation.total>0,scatterCount};
}
function assetUrl(assets,key,gameId){
  return assets.has(key)?'/game-assets/'+gameId+'/'+key:null;
}
const DEMO_BETS=[5,10,15,20,25,30,40,50,75,100,150,200,250,500,750,1000];
function firstGamePage(game,req){
  const assets=new Set(getGameAssets(game.id).map(a=>a.asset_key));
  const libraryBackgrounds=new Map(getGameBackgroundImages(game.id).map(item=>[
    item.asset_key,item.builtin_path||'/game-library/'+game.id+'/'+item.library_image_id
  ]));
  const url=key=>libraryBackgrounds.get(key)||assetUrl(assets,key,game.id);
  const backgroundImage=(key,cls)=>url(key)?'<img class="'+cls+'" src="'+h(url(key))+'" alt="" aria-hidden="true">':'';
  // A reel-field image must not also become the full-screen wallpaper when
  // an administrator selected the same library image for both positions.
  const spacePageImage=game.slug==='lucky-stars'&&url('background')&&url('background')!==url('reels_background')
    ?backgroundImage('background','slot-page-background'):'';

  const {reels:reelCount,rows:rowCount,theme}=gameLayout(game);
  const reels=Array.from({length:reelCount},(_,col)=>{
    const reelNumber=col+1;
    const backgrounds=Array.from({length:rowCount},()=>
      '<div class="reel-cell-bg">'+backgroundImage('cells_background','reel-cell-background-image')+'</div>'
    ).join('');
    return '<div class="reel-column" data-reel="'+col+'">'+
      '<div class="reel-window"><div class="reel-backdrops">'+backgrounds+'</div>'+
      '<div class="reel-track" aria-label="Барабан '+reelNumber+'"></div></div></div>';
  }).join('');
  const chosenImages=new Map(getSymbolImageLinks(game.id).map(item=>[
    item.symbol_id,item.builtin_path||'/game-library/'+game.id+'/'+item.image_id
  ]));
  // Older Egyptian databases can have missing symbol-image links or obsolete
  // symbols.svg#fragment references. Use the actual independent SVG files
  // without overriding uploaded/custom selections or images deleted in admin.
  const egyptDefaultKeys=new Map([
    ['Фараон','pharaoh'],['Клеопатра','cleopatra'],['Анубис','anubis'],
    ['Анкх','ankh'],['10','ten'],['J','j'],['Q','q'],['K','k'],['A','a'],
    ['Скарабей','scarab'],['SCATTER','scarab']
  ]);
  const hiddenEgyptArt=game.slug==='golden-seven'
    ?new Set(db.prepare('SELECT builtin_path FROM game_hidden_builtin_images WHERE game_id=?').all(game.id).map(row=>row.builtin_path))
    :new Set();
  const egyptDefaultArt=(symbol,selected)=>{
    if(game.slug!=='golden-seven')return selected||'';
    // Legacy sprite fragments cannot render independently in an img element.
    const old=/^\/static\/images\/egypt\/symbols\.svg#([a-z]+)$/i.exec(selected||'');
    const supported=new Set(['pharaoh','cleopatra','anubis','ankh','scarab','ten','j','q','k','a']);
    const key=old&&supported.has(old[1])?old[1]:egyptDefaultKeys.get(symbol.name);
    if(!key||(!old&&selected))return selected||'';
    const replacement='/static/images/egypt/premium-'+key+'.svg';
    return hiddenEgyptArt.has(replacement)?'':replacement;
  };
  const symbols=(game.slug==='lucky-stars'?cosmicVisibleSymbols(game.id):getSymbols(game.id)).map(symbol=>{
    const assigned=chosenImages.get(symbol.id);
    const uploaded=url('symbol_'+symbol.id);
    const image=egyptDefaultArt(symbol,assigned||uploaded||'');
    const key=game.slug==='golden-seven'?egyptDefaultKeys.get(symbol.name):null;
    const defaultImage=key?'/static/images/egypt/premium-'+key+'.svg':'';
    const allowedDefault=defaultImage&&!hiddenEgyptArt.has(defaultImage)?defaultImage:'';
    return '<span data-symbol-def data-symbol-id="'+symbol.id+'" data-name="'+h(symbol.name)+'" data-image="'+h(image)+'" data-default-image="'+h(allowedDefault)+'"></span>';
  }).join('');
  const audio=['music','bonus_music','spin_sound','win_sound','big_win_sound','mega_win_sound','bonus_sound'].map(key=>url(key)?'<audio preload="none" data-sound="'+key+'" src="'+h(url(key))+'"></audio>':'').join('');
  const wallet=getWallet(req.user.id,game.id);
  const scatter=getScatterSettings(game.id);
  const bonus=scatter?getBonusSession(req.user.id,game.id):null;
  const bonusVisible=!!bonus;
  const egyptChain=game.slug==='golden-seven'&&bonus?getEgyptBonusChain(req.user.id,game.id):null;
  const egyptSelectedIds=egyptChain?.symbols?.length?egyptChain.symbols:(bonus?.selected_symbol_id?[bonus.selected_symbol_id]:[]);
  const selectedEgypt=game.slug==='golden-seven'?(egyptSelectedIds[egyptSelectedIds.length-1]||0):0;
  const egyptLinesCount=game.slug==='golden-seven'?egyptPaylines(game.id).length:game.slug==='lucky-stars'?spacePaylines(game.id).length:0;
  const egyptScatterOdds=['golden-seven','lucky-stars'].includes(game.slug)&&scatter
    ?Array.from({length:reelCount},(_,i)=>scatter.rules.some(rule=>
      rule.reel_index===i+1&&rule.chance_percent>0&&rule.max_symbols>0)?'1':'0').join(',')
    :'';
  return spacePageImage+
    '<div class="slot-game slot-theme-'+theme+'" data-game-id="'+game.id+'" data-reels="'+reelCount+'" data-rows="'+rowCount+'" data-scatter-id="'+(scatter?.symbolId||0)+'" data-wild-id="'+wildSymbol(game.id)+'" data-space-expanding-wild="'+h(url('space_expanding_wild')||'')+'" data-bonus-active="'+(bonusVisible?'1':'0')+'" data-egypt-selected="'+selectedEgypt+'" data-egypt-symbols="'+h(egyptSelectedIds.join(','))+'" data-egypt-scatter-eligible="'+egyptScatterOdds+'" data-egypt-line-count="'+egyptLinesCount+'" aria-busy="true">'+
    '<div class="slot-loading-screen" id="slot-loading-screen" role="status" aria-live="polite">'+
      '<div class="slot-loading-panel"><span class="slot-loading-glyph" aria-hidden="true">✦</span>'+
      '<strong>ЗАГРУЗКА</strong>'+
      '<div class="slot-loading-progress" aria-hidden="true"><div id="slot-loading-fill"></div></div></div></div>'+
    (game.slug==='lucky-stars'?'':backgroundImage('background','slot-full-background'))+
    (game.slug==='golden-seven'?backgroundImage('egypt_bonus_background','slot-bonus-background'):game.slug==='lucky-stars'?backgroundImage('space_bonus_background','slot-bonus-background'):'')+
    '<a class="back-link game-catalog-link" href="/"><span aria-hidden="true">←</span> К каталогу</a>'+
    '<div class="slot-machine">'+
    (scatter?'<div class="slot-bonus-top" id="slot-bonus-top"'+(bonusVisible?'':' hidden')+'><div class="slot-devil-hug" aria-label="Бонусный множитель"><strong id="slot-bonus-multiplier">×'+(game.slug==='lucky-stars'&&bonus?cosmicBonusMultiplier(req.user.id,game.id):(bonus?.multiplier||2))+'</strong></div><em id="slot-bonus-plus" aria-live="polite"></em></div>':'')+
    (game.slug==='golden-seven'?'<div class="egypt-symbol-strip" id="egypt-symbol-strip"'+(bonusVisible?'':' hidden')+'><strong>СИМВОЛЫ БОНУСА</strong><div class="egypt-symbol-strip-items" id="egypt-symbol-strip-items"></div></div>'+
      '<aside class="egypt-bonus-games" id="egypt-bonus-games"'+(bonusVisible?'':' hidden')+' aria-label="Оставшиеся бонусные игры"><span>БОНУСНЫХ<br>ИГР</span><strong id="egypt-bonus-games-count">'+(bonusVisible?1+(egyptChain?.queue.length||0):0)+'</strong></aside>':'')+
    '<div class="slot-reels slot-reels-ribbon">'+
    backgroundImage('reels_background','slot-reels-background')+
    (game.slug==='slot-classic'&&scatter&&url('bonus_frame')?'<img class="slot-bonus-field-frame" src="'+h(url('bonus_frame'))+'" alt="" aria-hidden="true">':'')+
    '<div class="slot-big-win-overlay" id="slot-big-win-overlay" hidden aria-hidden="true"><strong id="slot-big-win-label"></strong></div>'+
    (game.slug==='golden-seven'?'<div class="egypt-retrigger-announcement" id="egypt-retrigger-announcement" hidden role="status" aria-live="assertive">'+
      '<div class="egypt-retrigger-inner"><span class="egypt-retrigger-stars">✦ ✦ ✦</span>'+
      '<strong>ВЫ ВЫИГРАЛИ БОНУСНУЮ ИГРУ!</strong><b id="egypt-retrigger-award">+10</b>'+
      '<span>БЕСПЛАТНЫХ ВРАЩЕНИЙ</span>'+
      '<small id="egypt-retrigger-details"></small></div></div>':'')+
    (game.slug==='lucky-stars'?'<div class="space-retrigger-announcement" id="space-retrigger-announcement" hidden role="status" aria-live="assertive">'+
      '<div class="space-retrigger-content"><strong>SCATTER ×3+</strong>'+
      '<span>ЕЩЁ БЕСПЛАТНЫЕ ВРАЩЕНИЯ!</span>'+
      '<b id="space-retrigger-award">+10</b>'+
      '<small id="space-retrigger-details"></small></div></div>':'')+
    '<div class="slot-insufficient-overlay" id="slot-insufficient-overlay" hidden role="alert"><strong>НЕДОСТАТОЧНО ДЕНЕЖНЫХ СРЕДСТВ</strong><span>Пополните баланс тестовых очков для продолжения игры</span></div>'+
    (scatter?'<div class="slot-bonus-intro" id="slot-bonus-intro" hidden aria-live="polite"><strong>SCATTER!</strong><span>БОНУСНАЯ ИГРА</span><b><em id="slot-bonus-intro-count">10</em> бесплатных вращений</b><small>'+(game.slug==='golden-seven'?'Сейчас выберем символ для '+egyptLinesCount+' линий':'Начальный множитель ×2')+'</small></div>':'')+
    (scatter?'<div class="slot-bonus-math" id="slot-bonus-math" hidden aria-live="polite"><span id="slot-bonus-math-caption">Выигрыш за спин</span><strong id="slot-bonus-math-base">0</strong><div id="slot-bonus-math-multiply" hidden><em>×</em><b id="slot-bonus-math-factor">2</b></div><div id="slot-bonus-math-result" hidden><small>Итого за спин</small><strong id="slot-bonus-math-total">0</strong></div></div>':'')+
    (scatter?'<div class="slot-bonus-finish" id="slot-bonus-finish" hidden><strong>БОНУС ЗАВЕРШЁН!</strong><span>Выигрыш за бонус: <b id="slot-bonus-finish-total">0</b></span><button type="button" id="slot-bonus-finish-close">Продолжить</button></div>':'')+
    '<div class="reel-columns">'+reels+'</div>'+
    (['golden-seven','lucky-stars'].includes(game.slug)?'<svg class="egypt-payline-overlay" id="egypt-payline-overlay" viewBox="0 0 600 400" preserveAspectRatio="none" aria-label="Десять линий выплат" hidden></svg>':'')+
    (game.slug==='golden-seven'?'<div class="egypt-round-prize" id="egypt-round-prize" hidden role="status" aria-live="polite">'+
      '<span>ВЫИГРЫШ ЗА ВРАЩЕНИЕ</span><strong id="egypt-round-prize-value">—</strong>'+
      '<small>Всего за бонус: <b id="egypt-round-prize-cumulative">'+(bonus?.bonus_win||0)+'</b></small></div>':'')+    '</div>'+

    (game.slug==='golden-seven'?'<div class="egypt-bonus-picker" id="egypt-bonus-picker" hidden><div class="egypt-bonus-picker-title">СИМВОЛ БОНУСНОЙ ИГРЫ</div><div class="egypt-bonus-picker-portrait" id="egypt-bonus-picker-portrait"></div><small>Выбор символа для '+egyptLinesCount+' линий</small></div>'+
    '':'')+

    (scatter?'<div class="slot-bonus-stats" id="slot-bonus-stats"'+(bonusVisible?'':' hidden')+'>'+
      '<span>Бесплатных вращений: <strong id="slot-bonus-remaining">'+(bonus?.remaining||0)+'</strong></span>'+
      (game.slug==='golden-seven'?'':'<span>Выигрыш бонуса: <strong id="slot-bonus-total">'+(bonus?.bonus_win||0)+'</strong></span>')+
      '</div>':'')+

    '<div class="slot-bottom-bar"><button type="button" id="slot-settings-trigger" class="slot-settings-trigger" aria-label="Настройки игры" title="Настройки">⚙</button><div class="slot-meters">'+
    '<div class="slot-meter">'+backgroundImage('bet_panel','slot-meter-background')+'<span>Баланс</span><strong id="slot-balance">'+wallet.balance+'</strong></div>'+
    '<div class="slot-bet-control">'+
      '<button type="button" class="slot-bet-step" id="slot-bet-minus" aria-label="Уменьшить ставку" title="Уменьшить ставку">−</button>'+
      '<button type="button" class="slot-meter slot-bet-button" id="slot-bet-trigger">'+backgroundImage('bet_panel','slot-meter-background')+'<span>Ставка <span aria-hidden="true">▾</span></span><strong id="slot-bet">'+wallet.bet+'</strong></button>'+
      '<button type="button" class="slot-bet-step" id="slot-bet-plus" aria-label="Увеличить ставку" title="Увеличить ставку">+</button></div>'+
    '<div class="slot-meter">'+backgroundImage('win_panel','slot-meter-background')+'<span id="slot-win-caption">'+(game.slug==='golden-seven'&&bonusVisible?'За вращение':'Выигрыш')+'</span><strong id="slot-win">0</strong>'+(game.slug==='golden-seven'?'<small class="egypt-bonus-accumulated" id="egypt-bonus-accumulated"'+(bonusVisible?'':' hidden')+'>Всего за бонус: <b id="egypt-bonus-accumulated-total">'+(bonus?.bonus_win||0)+'</b></small>':'')+'</div></div>'+
    '<form id="slot-spin-form" method="post" action="/games/'+h(game.slug)+'/spin">'+csrfInput(req.session.csrf_token)+
    '<button id="slot-spin-button" class="spin-round" type="submit" aria-label="Вращать барабаны"><span class="spin-round-icon" aria-hidden="true">↻</span><span id="slot-spin-label">'+(bonusVisible?'БЕСПЛАТНО':'ВРАЩАТЬ')+'</span></button></form>'+
    '<button type="button" id="slot-auto-trigger" class="spin-round slot-auto-trigger" aria-label="Автоигра: выбрать количество вращений" title="Автоигра"><span class="spin-round-icon" aria-hidden="true">⟳</span><span id="slot-auto-trigger-label">АВТО</span></button></div>'+
    '<dialog id="slot-auto-dialog" class="slot-settings-dialog slot-auto-dialog" aria-labelledby="slot-auto-dialog-title">'+
    '<form method="dialog"><button type="submit" class="settings-close" aria-label="Закрыть">×</button></form>'+
    '<h2 id="slot-auto-dialog-title">Автоигра</h2><p>Выберите количество автоматических вращений. При запуске бонуса автоигра остановится.</p>'+
    '<div class="slot-auto-dialog-options"><label for="slot-auto-count">Количество вращений</label><select id="slot-auto-count" aria-label="Количество платных автовращений">'+
    [5,10,25,50,100,250].map(n=>'<option value="'+n+'"'+(n===10?' selected':'')+'>'+n+' вращений</option>').join('')+'</select>'+
    '<button type="button" id="slot-auto-start" class="slot-auto-start">▶ Запустить</button>'+
    '<button type="button" id="slot-auto-stop" class="slot-auto-stop" hidden>■ Остановить</button></div></dialog>'+
    '<span id="slot-auto-status" class="slot-auto-status" role="status" aria-live="polite"></span>'+
    '<p class="slot-message" id="slot-result" role="status" aria-live="polite">Нажмите на круглую кнопку для вращения.</p></div>'+
    '<dialog class="slot-settings-dialog" id="slot-settings-dialog" aria-labelledby="slot-settings-heading">'+
    '<form method="dialog"><button type="submit" class="settings-close" aria-label="Закрыть настройки">×</button></form>'+
    '<h2 id="slot-settings-heading">Настройки игры</h2>'+
    '<label class="sound-toggle"><input type="checkbox" id="slot-sound-toggle" checked> Включить звук</label>'+

    '<label class="music-volume-control" for="slot-music-volume">Громкость фоновой музыки <output id="slot-music-volume-value">65%</output></label>'+
    '<input type="range" id="slot-music-volume" min="0" max="100" step="1" value="65" aria-label="Громкость фоновой музыки">'+
    '<form method="post" id="slot-bet-form" action="/games/'+h(game.slug)+'/bet">'+csrfInput(req.session.csrf_token)+
    '<label for="slot-bet-select">Ставка за вращение</label><select id="slot-bet-select" name="bet">'+
    DEMO_BETS.map(bet=>'<option value="'+bet+'"'+(wallet.bet===bet?' selected':'')+'>'+bet+' очков</option>').join('')+
    '</select><button class="primary" type="submit">Применить ставку</button></form>'+
    '<p class="hint">Очки тестовые, без реальных денег. Изменение ставки сохраняется в вашем профиле этой игры.</p></dialog>'+
    '<div class="slot-symbol-data" hidden>'+symbols+'</div>'+audio+'</div>';
}
app.get('/games/:slug',guarded,(req,res)=>{
  const game=listGames(true).find(item=>item.slug===req.params.slug);
  if(!game)return sendPage(res,'Не найдено','<section class="panel"><h1>Игра не найдена</h1><a href="/">Все игры</a></section>',req,404);
  if(playableGame(game))return sendPage(res,game.title,firstGamePage(game,req),req);
  sendPage(res,game.title,'<section class="panel game-placeholder"><img src="'+h(game.image_path)+'" alt="" width="720" height="450"><h1>'+h(game.title)+'</h1><p>Игра находится в разработке.</p><a class="secondary" href="/">Назад к играм</a></section>',req);
});
app.post('/games/:slug/bet',guarded,spinLimiter,postGuard,(req,res)=>{
  const game=listGames(true).find(item=>item.slug===req.params.slug);
  if(!game||!playableGame(game))return res.sendStatus(404);
  const bet=Number(req.body?.bet);
  if(!DEMO_BETS.includes(bet)||String(bet)!==req.body?.bet)return res.status(400).json({error:'Недопустимая ставка'});
  if(['slot-classic','golden-seven'].includes(game.slug)&&getBonusSession(req.user.id,game.id))
    return res.status(409).json({error:'Нельзя менять ставку во время бесплатных вращений.'});
  getWallet(req.user.id,game.id);
  db.prepare('UPDATE game_wallets SET bet=? WHERE user_id=? AND game_id=?').run(bet,req.user.id,game.id);
  res.set('Cache-Control','no-store');
  res.json({bet});
});
app.post('/games/:slug/spin',guarded,spinLimiter,postGuard,(req,res)=>{
  try{
  const game=listGames(true).find(item=>item.slug===req.params.slug);
  if(!game||!playableGame(game))return res.sendStatus(404);
  const result=db.transaction(()=>{
    const wallet=getWallet(req.user.id,game.id);
    const settings=getGameSettings(game.id);
    const layout=gameLayout(game);
    const scatter=getScatterSettings(game.id);
    const active=scatter?getBonusSession(req.user.id,game.id):null;
    if(active&&game.slug==='lucky-stars'){
      const wildId=wildSymbol(game.id);
      const generated=generateSpin(game.id,settings?.win_frequency??25,active.bet,layout);
      if(generated.error)return generated;
      const preExpansionCells=generated.cells.slice();
      const expansion=expandSpaceWild(preExpansionCells,wildId,scatter.symbolId);
      const symbols=cosmicVisibleSymbols(game.id).filter(symbol=>symbol.id!==scatter.symbolId);
      const scored=scoreSpaceLines({cells:expansion.cells,symbols,bet:active.bet,
        payouts:getPayouts(game.id),lines:spacePaylines(game.id),wildId,scatterId:scatter.symbolId,rules:spaceRules(game.id)});
      // Apply the current X to this spin, then increment it by one.
      const currentMultiplier=cosmicBonusMultiplier(req.user.id,game.id);
      const nextMultiplier=Math.min(1000000,currentMultiplier+1);
      const bonusRoundWin=scored.total*currentMultiplier;
      if(!Number.isSafeInteger(bonusRoundWin)||bonusRoundWin<0)
        return {error:'Превышен размер бонусного выигрыша.'};
      const accumulated=active.bonus_win+bonusRoundWin;
      if(!Number.isSafeInteger(accumulated)||accumulated<0)
        return {error:'Превышен размер бонусного выигрыша.'};
      const retriggerSpins=egyptFreeSpinsFor(generated.scatterCount);
      if(retriggerSpins){
        const seq=db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM space_bonus_pending WHERE user_id=? AND game_id=?')
          .get(req.user.id,game.id).seq;
        db.prepare('INSERT INTO space_bonus_pending(user_id,game_id,seq,spins) VALUES(?,?,?,?)')
          .run(req.user.id,game.id,seq,retriggerSpins);
      }
      let remaining=active.remaining-1,completedBonus=false;
      let nextBalance=wallet.balance;
      if(remaining===0){
        const next=db.prepare('SELECT seq,spins FROM space_bonus_pending WHERE user_id=? AND game_id=? ORDER BY seq LIMIT 1')
          .get(req.user.id,game.id);
        if(next){
          remaining=next.spins;
          db.prepare('DELETE FROM space_bonus_pending WHERE user_id=? AND game_id=? AND seq=?')
            .run(req.user.id,game.id,next.seq);
        }else{
          completedBonus=true;
          nextBalance=wallet.balance+accumulated;
          if(!Number.isSafeInteger(nextBalance)||nextBalance<0)
            return {error:'Превышен допустимый баланс.'};
          db.prepare('UPDATE user_balances SET balance=? WHERE user_id=?').run(nextBalance,req.user.id);
          db.prepare('DELETE FROM game_bonus_sessions WHERE user_id=? AND game_id=?').run(req.user.id,game.id);
          db.prepare('DELETE FROM space_bonus_multipliers WHERE user_id=? AND game_id=?').run(req.user.id,game.id);
        }
      }
      if(!completedBonus){
        db.prepare('UPDATE game_bonus_sessions SET remaining=?,bonus_win=? WHERE user_id=? AND game_id=?')
          .run(remaining,accumulated,req.user.id,game.id);
        db.prepare(`INSERT INTO space_bonus_multipliers(user_id,game_id,value) VALUES(?,?,?)
          ON CONFLICT(user_id,game_id) DO UPDATE SET value=excluded.value`)
          .run(req.user.id,game.id,nextMultiplier);
      }
      const bigThreshold=settings?.big_win_multiplier_milli??5000;
      const megaThreshold=settings?.mega_win_multiplier_milli??15000;
      const tier=bonusRoundWin*1000>=active.bet*megaThreshold?'mega'
        :bonusRoundWin*1000>=active.bet*bigThreshold?'big':bonusRoundWin>0?'normal':'none';
      const pendingSpins=db.prepare('SELECT COALESCE(SUM(spins),0) AS total FROM space_bonus_pending WHERE user_id=? AND game_id=?')
        .get(req.user.id,game.id).total;
      return {mode:'space-bonus',cells:expansion.cells,preExpansionCells,
        expandedReels:expansion.expandedReels,wins:scored.wins,
        total:bonusRoundWin,baseWin:scored.total,bonusRoundWin,
        bonusWin:accumulated,remaining,remainingTotal:remaining+pendingSpins,
        pendingSpins,completedBonus,
        scatterCount:generated.scatterCount,retriggerSpins,
        bonusMultiplier:currentMultiplier,nextMultiplier,
        balance:nextBalance,bet:active.bet,winTier:tier};
    }
    if(active&&game.slug==='golden-seven'){
      const regular=getSymbols(game.id).filter(symbol=>symbol.id!==scatter.symbolId);
      if(!regular.length)return {error:'В Египте нет обычных символов для бонуса.'};
      const weights=egyptSymbolWeights(game.id);
      const enabled=regular.filter(symbol=>symbol.id!==wildSymbol(game.id)&&(weights[symbol.id]??100)>0);
      if(!enabled.length)return {error:'У всех символов Египта вес 0. Укажите хотя бы один положительный вес в админке.'};
      const choose=egyptWeightedPicker(regular.filter(symbol=>(weights[symbol.id]??100)>0),weights,n=>crypto.randomInt(n));
      let chain=getEgyptBonusChain(req.user.id,game.id);
      if(!chain){
        // Migrate in-progress bonuses from older releases without forfeiting
        // their accumulated winnings or selected symbol.
        const initial=enabled.some(s=>s.id===active.selected_symbol_id)
          ?active.selected_symbol_id:enabled[crypto.randomInt(enabled.length)].id;
        db.prepare('UPDATE game_bonus_sessions SET selected_symbol_id=? WHERE user_id=? AND game_id=?')
          .run(initial,req.user.id,game.id);
        db.prepare(`INSERT INTO egypt_bonus_chains(user_id,game_id,symbols_json,current_total)
          VALUES(?,?,?,?)`).run(req.user.id,game.id,JSON.stringify([initial]),active.remaining);
        chain=getEgyptBonusChain(req.user.id,game.id);
      }
      const selected=chain.symbols.filter(id=>enabled.some(symbol=>symbol.id===id));
      if(!selected.length){
        const chosen=egyptWeightedPicker(enabled,weights,n=>crypto.randomInt(n))();
        selected.push(chosen);
        db.prepare('UPDATE egypt_bonus_chains SET symbols_json=? WHERE user_id=? AND game_id=?')
          .run(JSON.stringify(selected),req.user.id,game.id);
      }
      // Generate one settled 6x4 board including up to one SCATTER per reel.
      // Every selected symbol is scored on this unexpanded board independently.
      const initialBoard=Array.from({length:layout.rows*layout.reels},choose);
      const scatterPlacement=scatterOnBoard(initialBoard,scatter.symbolId,scatter.rules,
        layout.rows,layout.reels,n=>crypto.randomInt(n));
      const minRows=db.prepare(`SELECT symbol_id,min_reels FROM egypt_symbol_bonus_rules
        WHERE symbol_id IN (SELECT id FROM game_symbols WHERE game_id=?)`).all(game.id);
      const minimum=Object.fromEntries(minRows.map(row=>[row.symbol_id,row.min_reels]));
      const linePrices=Object.fromEntries(db.prepare(`SELECT p.symbol_id,p.matches,p.percent_millionths
        FROM egypt_line_prices p JOIN game_symbols s ON s.id=p.symbol_id
        WHERE s.game_id=?`).all(game.id)
        .map(row=>[row.symbol_id+':'+row.matches,row.percent_millionths]));
      const round=scoreEgyptSymbolSet({cells:scatterPlacement.cells,
        selectedIds:selected,bet:active.bet,payouts:getPayouts(game.id),
        minReelsById:minimum,linePricesById:linePrices,lines:egyptPaylines(game.id),wildId:wildSymbol(game.id)});
      const accumulated=active.bonus_win+round.total;
      if(!Number.isSafeInteger(accumulated)||accumulated<0)
        return {error:'Превышен допустимый выигрыш бонуса.'};
      const retriggerSpins=egyptFreeSpinsFor(scatterPlacement.count);
      if(retriggerSpins){
        const nextOrder=db.prepare(`SELECT COALESCE(MAX(queue_order),0)+1 AS n
          FROM egypt_bonus_pending WHERE user_id=? AND game_id=?`)
          .get(req.user.id,game.id).n;
        db.prepare(`INSERT INTO egypt_bonus_pending(user_id,game_id,queue_order,free_spins,scatter_count)
          VALUES(?,?,?,?,?)`).run(req.user.id,game.id,nextOrder,retriggerSpins,scatterPlacement.count);
        db.prepare(`UPDATE egypt_bonus_chains SET retrigger_count=retrigger_count+1
          WHERE user_id=? AND game_id=?`).run(req.user.id,game.id);
      }
      const playedCurrent=chain.played_current+1;
      const playedTotal=chain.played_total+1;
      const remaining=active.remaining-1;
      let selectedNow=selected.slice(),transition=null,finished=false;
      let currentTotal=chain.current_total,seriesNumber=chain.series_number;
      let playedSeries=playedCurrent,nextRemaining=remaining,balanceAfter=wallet.balance;
      const queue=db.prepare(`SELECT queue_order,free_spins,scatter_count FROM egypt_bonus_pending
        WHERE user_id=? AND game_id=? ORDER BY queue_order`).all(req.user.id,game.id);
      const nextState=nextEgyptBonusSeries({remaining,queue,selectedIds:selected,
        symbols:enabled,randomInt:n=>crypto.randomInt(n)});
      if(nextState.kind==='transition'){
        // First series ends silently; all winnings stay pending. Next series
        // starts with one extra never-used symbol, if any are left to choose.
        const next=nextState.next;
        db.prepare(`DELETE FROM egypt_bonus_pending
          WHERE user_id=? AND game_id=? AND queue_order=?`)
          .run(req.user.id,game.id,next.queue_order);
        const added=nextState.newSymbolId;
        selectedNow=nextState.selectedIds;
        nextRemaining=next.free_spins;
        currentTotal=next.free_spins;
        playedSeries=0;
        seriesNumber++;
        transition={newSymbolId:added,freeSpins:next.free_spins,
          seriesNumber,scatterCount:next.scatter_count};
      }else if(nextState.kind==='complete'){
        // Only the FINAL bonus in the full retrigger chain credits the wallet.
        balanceAfter+=accumulated;
        if(!Number.isSafeInteger(balanceAfter)||balanceAfter<0)
          return {error:'Превышен допустимый баланс.'};
        db.prepare('UPDATE user_balances SET balance=? WHERE user_id=?')
          .run(balanceAfter,req.user.id);
        db.prepare('DELETE FROM game_bonus_sessions WHERE user_id=? AND game_id=?')
          .run(req.user.id,game.id);
        finished=true;
      }
      if(!finished){
        db.prepare(`UPDATE game_bonus_sessions SET remaining=?,bonus_win=?,selected_symbol_id=?
          WHERE user_id=? AND game_id=?`)
          .run(nextRemaining,accumulated,selectedNow[selectedNow.length-1],req.user.id,game.id);
        db.prepare(`UPDATE egypt_bonus_chains SET symbols_json=?,played_current=?,
          played_total=?,current_total=?,series_number=?
          WHERE user_id=? AND game_id=?`)
          .run(JSON.stringify(selectedNow),playedSeries,playedTotal,
            currentTotal,seriesNumber,req.user.id,game.id);
      }
      const queued=db.prepare(`SELECT free_spins,scatter_count FROM egypt_bonus_pending
        WHERE user_id=? AND game_id=? ORDER BY queue_order`).all(req.user.id,game.id);
      const big=settings?.big_win_multiplier_milli??5000;
      const mega=settings?.mega_win_multiplier_milli??15000;
      const winTier=round.total>0&&round.total*1000>=active.bet*mega?'mega'
        :round.total>0&&round.total*1000>=active.bet*big?'big'
        :round.total>0?'normal':'none';
      return {mode:'egypt-bonus',cells:scatterPlacement.cells,
        selectedSymbolIds:selected,activeSymbolIds:selectedNow,
        symbolWins:round.symbolWins,
        scatterCount:scatterPlacement.count,scatterPositions:scatterPlacement.positions,
        retriggerSpins,transition,
        total:round.total,baseWin:round.total,bonusRoundWin:round.total,
        bonusWin:accumulated,remaining:nextRemaining,
        played:playedSeries,playedTotal,currentTotal,seriesNumber,
        remainingTotal:nextRemaining+queued.reduce((sum,item)=>sum+item.free_spins,0),
        retriggerCount:chain.retrigger_count+(retriggerSpins?1:0),
        pendingBonuses:queued.length,
        completedBonus:finished,balance:balanceAfter,bet:active.bet,winTier,wins:[]};
    }
    if(active){
      // Free spins are transacted atomically and have a separate pending
      // balance. No credits can be applied before the final free spin.
      const symbols=getSymbols(game.id).filter(symbol=>symbol.id!==scatter.symbolId);
      const round=playBonusRound({
        symbols,payouts:getPayouts(game.id),bet:active.bet,
        reels:layout.reels,rows:layout.rows,
        randomInt:n=>crypto.randomInt(n),scoreBoard:(cells,symbols,payouts,bet,rows)=>scoreBoard(cells,symbols,payouts,bet,rows,null,wildSymbol(game.id)),
        scatterId:scatter.symbolId,scatterRules:scatter.rules,wildId:wildSymbol(game.id)
      });
      // Scatter raises the multiplier immediately during this free spin,
      // before its award is calculated. The ordinary win +1 applies AFTER.
      let roundMultiplier=active.multiplier;
      const steps=round.steps.map(step=>{
        const applied=Math.min(step.scatterCount,Math.max(0,100-roundMultiplier));
        roundMultiplier+=applied;
        return {...step,scatterIncrease:applied,multiplierAfterScatter:roundMultiplier};
      });
      const scatterIncrease=roundMultiplier-active.multiplier;
      const award=round.total*roundMultiplier;
      const accumulated=active.bonus_win+award;
      if(!Number.isSafeInteger(award)||!Number.isSafeInteger(accumulated)||accumulated<0)
        return {error:'Превышен допустимый размер бонусного выигрыша.'};
      const remaining=active.remaining-1;
      const winIncrease=round.total>0?1:0;
      const appliedWinIncrease=Math.min(winIncrease,Math.max(0,100-roundMultiplier));
      const nextMultiplier=roundMultiplier+appliedWinIncrease;
      let nextBalance=wallet.balance,completed=false;
      if(remaining===0){
        nextBalance=wallet.balance+accumulated;
        if(!Number.isSafeInteger(nextBalance)||nextBalance<0)
          return {error:'Превышен допустимый баланс.'};
        db.prepare('UPDATE user_balances SET balance=? WHERE user_id=?')
          .run(nextBalance,req.user.id);
        db.prepare('DELETE FROM game_bonus_sessions WHERE user_id=? AND game_id=?')
          .run(req.user.id,game.id);
        completed=true;
      }else{
        db.prepare(`UPDATE game_bonus_sessions SET remaining=?,multiplier=?,bonus_win=?
          WHERE user_id=? AND game_id=?`)
          .run(remaining,nextMultiplier,accumulated,req.user.id,game.id);
      }
      const bigThreshold=settings?.big_win_multiplier_milli??5000;
      const megaThreshold=settings?.mega_win_multiplier_milli??15000;
      const winTier=award>0&&award*1000>=active.bet*megaThreshold?'mega'
        :award>0&&award*1000>=active.bet*bigThreshold?'big'
        :award>0?'normal':'none';
      return {
        mode:'bonus',cells:round.board,steps,
        total:award,baseWin:round.total,
        wins:round.wins.map(win=>({...win,prize:win.prize*roundMultiplier})),
        balance:nextBalance,bet:active.bet,winTier,
        bonusRoundWin:award,bonusWin:accumulated,
        bonusMultiplier:roundMultiplier,scatterCount:round.scatterCount,
        scatterIncrease,winIncrease:appliedWinIncrease,
        nextMultiplier,remaining,completedBonus:completed
      };
    }
    if(wallet.balance<wallet.bet)return {error:'Недостаточно денежных средств для ставки.'};
    const spin=generateSpin(game.id,settings?.win_frequency ?? 25,wallet.bet,layout);
    if(spin.error)return spin;
    const payout=spin.total;
    const updatedBalance=wallet.balance-wallet.bet+payout;
    if(!Number.isSafeInteger(updatedBalance)||updatedBalance<0)
      return {error:'Превышен допустимый баланс.'};
    db.prepare('UPDATE user_balances SET balance=? WHERE user_id=?')
      .run(updatedBalance,req.user.id);
    const bigThreshold=settings?.big_win_multiplier_milli??5000;
    const megaThreshold=settings?.mega_win_multiplier_milli??15000;
    const winTier=payout>0&&payout*1000>=wallet.bet*megaThreshold?'mega'
      :payout>0&&payout*1000>=wallet.bet*bigThreshold?'big'
      :payout>0?'normal':'none';
    const egyptTrigger=game.slug==='golden-seven'&&spin.scatterCount>=3;
    const freeSpins=scatter?(['golden-seven','lucky-stars'].includes(game.slug)?egyptFreeSpinsFor(spin.scatterCount):freeSpinsFor(spin.scatterCount)):0;
    let selectedEgypt=0;
    if(freeSpins){
      if(game.slug==='golden-seven'){
        const options=getSymbols(game.id).filter(symbol=>symbol.id!==scatter.symbolId&&symbol.id!==wildSymbol(game.id));
        const weights=egyptSymbolWeights(game.id);
        const eligible=options.filter(symbol=>(weights[symbol.id]??100)>0);
        if(!eligible.length)return {error:'Нет символов Египта с положительным весом.'};
        selectedEgypt=egyptWeightedPicker(eligible,weights,n=>crypto.randomInt(n))();
        db.prepare(`INSERT INTO game_bonus_sessions(user_id,game_id,remaining,multiplier,bonus_win,bet,selected_symbol_id)
          VALUES(?,?,?,2,0,?,?)`).run(req.user.id,game.id,freeSpins,wallet.bet,selectedEgypt);
        db.prepare(`INSERT INTO egypt_bonus_chains(user_id,game_id,symbols_json,current_total)
          VALUES(?,?,?,?)`).run(req.user.id,game.id,JSON.stringify([selectedEgypt]),freeSpins);
      }else{
        db.prepare(`INSERT INTO game_bonus_sessions(user_id,game_id,remaining,multiplier,bonus_win,bet)
          VALUES(?,?,?,2,0,?)`).run(req.user.id,game.id,freeSpins,wallet.bet);
        if(game.slug==='lucky-stars')
          db.prepare(`INSERT INTO space_bonus_multipliers(user_id,game_id,value) VALUES(?,?,1)
            ON CONFLICT(user_id,game_id) DO UPDATE SET value=1`).run(req.user.id,game.id);
      }
    }
    return {...spin,mode:'base',total:payout,balance:updatedBalance,bet:wallet.bet,
      winTier,freeSpins,egyptTrigger,selectedSymbolId:selectedEgypt,
      bonusMultiplier:freeSpins?(['golden-seven','lucky-stars'].includes(game.slug)?1:2):null,
      bonusWin:freeSpins?0:null,remaining:freeSpins};
  })();
  res.set('Cache-Control','no-store');
  if(result.error)return res.status(400).json({error:result.error});
  res.json(result);
  }catch(error){
    const issueId=crypto.randomBytes(4).toString('hex');
    console.error('Slot spin error ['+issueId+']:',error);
    res.set('Cache-Control','no-store');
    // Detailed error text is visible only to an authenticated admin in development.
    // This helps diagnose database migration and payout errors without exposing
    // internals to regular players or changing balances after a failed transaction.
    const details=!IS_PRODUCTION&&req.user?.role==='admin'
      ?' ['+issueId+'] '+String(error?.code||error?.name||'Error')+': '+String(error?.message||'Неизвестная ошибка').slice(0,300)
      :' Код: '+issueId+'.';
    res.status(500).json({error:'Ошибка сервера при вращении.'+details});
  }
});
app.get('/register',redirectHomeIfLogged,(req,res)=>authForm('Регистрация','/register',req,res));
app.post('/register',postGuard,(req,res)=>{
  const {username,password}=req.body;
  if(!validUsername(username)||!validPassword(password)) return authForm('Регистрация','/register',req,res,'Проверьте логин и пароль.');
  try {createUser(username,password,'user');}
  catch(e){if(e.code?.startsWith('SQLITE_CONSTRAINT'))return authForm('Регистрация','/register',req,res,'Такой логин уже занят.');throw e;}
  login(req,res,getUserByName(username));
});
app.get('/login',redirectHomeIfLogged,(req,res)=>authForm('Вход','/login',req,res));
app.post('/login',postGuard,(req,res)=>{
  const {username,password}=req.body;
  const user=typeof username==='string'?getUserByName(username):null;
  if(!user||!user.active||typeof password!=='string'||!verifyPassword(password,user.password_hash)) return authForm('Вход','/login',req,res,'Неверный логин или пароль.');
  login(req,res,user);
});
function login(req,res,user){
  const raw=token();
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)')
    .run(sha(raw),user.id,token(),Date.now()+7*24*60*60*1000);
  setCookie(res,'slot_session',raw,7*24*60*60,req.secure);
  clearCookie(res,'slot_guest_csrf',req.secure);
  res.redirect(user.role==='admin'?'/admin':'/');
}
app.post('/logout',postGuard,(req,res)=>{
  if(req.sessionToken)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(req.sessionToken));
  clearCookie(res,'slot_session',req.secure);
  res.redirect('/');
});
app.get('/admin',adminOnly,(req,res)=>{
  const users=db.prepare(`SELECT u.id,u.username,u.role,u.active,u.created_at,
    COALESCE(b.balance,1000) AS balance FROM users u
    LEFT JOIN user_balances b ON b.user_id=u.id ORDER BY u.id`).all();
  const csrf=req.session.csrf_token;
  const rows=users.map(user=>{
    const controls=user.id===req.user.id?'<small>Вы</small>':
      '<form method="post" action="/admin/users/'+user.id+'/toggle" class="inline">'+csrfInput(csrf)+
        '<button type="submit">'+(user.active?'Заблокировать':'Разблокировать')+'</button></form> '+
      '<form method="post" action="/admin/users/'+user.id+'/role" class="inline">'+csrfInput(csrf)+
        '<button type="submit">'+(user.role==='admin'?'Снять права':'Сделать админом')+'</button></form>';
    const balanceForm='<form method="post" action="/admin/users/'+user.id+'/balance" class="inline">'+csrfInput(csrf)+
      '<input type="number" name="balance" min="0" max="1000000000" step="1" value="'+user.balance+
      '" aria-label="Баланс пользователя '+h(user.username)+'" required> '+
      '<button type="submit">Сохранить</button></form>';
    return '<tr><td>'+user.id+'</td><td>'+h(user.username)+'</td><td>'+h(user.role)+'</td><td>'+
      (user.active?'Активен':'Заблокирован')+'</td><td>'+h(user.created_at)+'</td><td>'+balanceForm+
      '</td><td>'+controls+'</td></tr>';
  }).join('');
  const gameButtons=listGames().map(game=>{
    const assigned=getGameBackgroundImages(game.id).find(image=>image.asset_key==='logo');
    const uploaded=getGameAssets(game.id).some(asset=>asset.asset_key==='logo');
    const logo=assigned
      ?(assigned.builtin_path||'/game-library/'+game.id+'/'+assigned.library_image_id)
      :uploaded?'/game-assets/'+game.id+'/logo':null;
    return '<a class="admin-game-link'+(logo?' admin-game-has-logo':'')+'" href="/admin/games/'+game.id+'">'+
      '<img src="'+h(logo||game.image_path)+'" alt="'+(logo?'Логотип':'Обложка')+' игры '+h(game.title)+'" width="720" height="450">'+
      '<span>'+h(game.title)+'</span><small>Настройки игры</small></a>';
  }).join('');
  sendPage(res,'Админ-панель','<div class="admin-content"><section class="panel"><h1>Управление играми</h1>'+
    '<p class="hint">Выберите игру, чтобы перейти к её настройкам.</p><div class="admin-games-grid">'+gameButtons+'</div></section>'+
    '<section class="panel"><h2>Управление пользователями</h2><p>Пользователи: '+users.length+
    '</p><div class="table-wrap"><table><thead><tr><th>ID</th><th>Логин</th><th>Роль</th><th>Статус</th><th>Создан</th><th>Общий баланс</th><th>Действия</th></tr></thead><tbody>'+rows+
    '</tbody></table></div></section></div>',req);
});
installGameAdmin(app,{db,gameById,getGameSettings,getGameAssets,getSymbols,getPayouts,getLibraryImages,getSymbolImageLinks,getGameBackgroundImages,getScatterSettings,adminOnly,guarded,postGuard,sendPage,h,csrfInput});
app.post('/admin/users/:id/balance',adminOnly,postGuard,(req,res)=>{
  const id=Number(req.params.id),raw=String(req.body?.balance??'');
  if(!Number.isSafeInteger(id)||id<1||!db.prepare('SELECT 1 FROM users WHERE id=?').get(id))
    return res.sendStatus(404);
  if(!/^(0|[1-9][0-9]*)$/.test(raw))return res.status(400).send('Баланс должен быть целым неотрицательным числом.');
  const amount=Number(raw);
  if(!Number.isSafeInteger(amount)||amount>1000000000)
    return res.status(400).send('Баланс должен быть от 0 до 1 000 000 000.');
  db.prepare('INSERT INTO user_balances(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance')
    .run(id,amount);
  res.redirect('/admin');
});
app.post('/admin/users/:id/toggle',adminOnly,postGuard,(req,res)=>{
  const id=Number(req.params.id);
  const user=Number.isSafeInteger(id)?db.prepare('SELECT id,role,active FROM users WHERE id=?').get(id):null;
  if(!user)return res.sendStatus(404);
  if(user.id===req.user.id)return res.status(400).send('Нельзя заблокировать себя');
  if(user.role==='admin'&&user.active&&countActiveAdmins()<=1)return res.status(400).send('Нельзя заблокировать последнего администратора');
  db.prepare('UPDATE users SET active=? WHERE id=?').run(user.active?0:1,id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  res.redirect('/admin');
});
app.post('/admin/users/:id/role',adminOnly,postGuard,(req,res)=>{
  const id=Number(req.params.id);
  const user=Number.isSafeInteger(id)?db.prepare('SELECT id,role,active FROM users WHERE id=?').get(id):null;
  if(!user)return res.sendStatus(404);
  if(user.id===req.user.id)return res.status(400).send('Нельзя менять свою роль');
  if(user.role==='admin'&&user.active&&countActiveAdmins()<=1)return res.status(400).send('Нельзя снять права последнего администратора');
  db.prepare("UPDATE users SET role=? WHERE id=?").run(user.role==='admin'?'user':'admin',id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  res.redirect('/admin');
});
app.use((req,res)=>sendPage(res,'Не найдено','<section class="panel"><h1>Страница не найдена</h1><a href="/">На главную</a></section>',req,404));
app.use((err,req,res,next)=>{
  if(req.path.startsWith('/games/')&&req.method==='POST'){
    console.error('Slot API error:',err);
    return res.status(500).json({error:'Ошибка сервера при вращении. Проверьте терминал сервера и обновите страницу.'});
  }
  if(err?.name==='MulterError')return res.status(err.code==='LIMIT_FILE_SIZE'?413:400).send('Ошибка загрузки: превышен лимит размера файла или количества полей. Вернитесь к настройкам игры.');
  console.error(err);
  res.status(500).send('Ошибка сервера');
});
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
app.listen(PORT,'0.0.0.0',()=>console.log('SlotJava: http://localhost:'+PORT));
