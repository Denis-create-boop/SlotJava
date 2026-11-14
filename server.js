const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { installGameAdmin } = require('./game-admin');
const { db, verifyPassword, validUsername, validPassword, getUserByName, createUser, countActiveAdmins, listGames, gameById, getGameSettings, getGameAssets, getSymbols, getPayouts, getWallet } = require('./db');

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
function layout(title,body,user,csrf) {
  const menu=user
    ? '<a href="/">Главная</a>'+(user.role==='admin'?'<a href="/admin">Админ-панель</a>':'')+
      '<form method="post" action="/logout" class="inline">'+csrfInput(csrf)+'<button type="submit">Выход</button></form>'
    : '<a href="/login">Войти</a><a href="/register">Регистрация</a>';
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+h(title)+' · SlotJava</title><link rel="stylesheet" href="/static/style.css"></head>'+
    '<body><header><a class="brand" href="/">🎰 SlotJava</a><nav>'+menu+'</nav></header><main>'+body+'</main>'+
    '<footer>SlotJava · браузерная версия в разработке</footer><script src="/static/app.js" defer></script></body></html>';
}
function sendPage(res,title,body,req,status=200) { res.status(status).send(layout(title,body,req.user,req.session?.csrf_token)); }
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
  const cards=games.map(game=>'<article class="game-card"><a class="game-card-link" href="/games/'+encodeURIComponent(game.slug)+'">'+
    '<img loading="lazy" src="'+h(game.image_path)+'" alt="Обложка игры '+h(game.title)+'" width="720" height="450">'+
    '<h2>'+h(game.title)+'</h2></a></article>').join('');
  sendPage(res,'Игры','<section class="games-section"><div class="section-title"><p class="eyebrow">Каталог игр</p><h1>Выберите игру</h1></div>'+
    '<div class="games-grid">'+cards+'</div></section>',req);
});
const spinLimiter=rateLimit({windowMs:60*1000,limit:60,standardHeaders:'draft-7',legacyHeaders:false});
function scoreBoard(cells,symbols,payouts){
  // A symbol wins when it is visible in consecutive reels starting at reel 1.
  // Multiple instances within a reel count only once; rows/paylines do not matter.
  const prizes=new Map(payouts.filter(p=>p.matches>=3&&p.matches<=5)
    .map(p=>[p.symbol_id+':'+p.matches,p.prize]));
  const wins=[];
  let total=0;
  for(const symbol of symbols){
    let reels=0;
    for(let col=0;col<5;col++){
      let found=false;
      for(let row=0;row<4;row++){
        if(cells[row*5+col]===symbol.id){found=true;break;}
      }
      if(!found)break;
      reels++;
    }
    if(reels<3)continue;
    const prize=prizes.get(symbol.id+':'+reels)||0;
    if(prize>0){
      total+=prize;
      wins.push({symbolId:symbol.id,name:symbol.name,reels,prize});
    }
  }
  return {total,wins};
}
function generateSpin(gameId,winFrequency){
  const symbols=getSymbols(gameId),payouts=getPayouts(gameId);
  if(!symbols.length)return {error:'Добавьте хотя бы один символ в админке.'};
  const randomBoard=()=>Array.from({length:20},()=>symbols[crypto.randomInt(symbols.length)].id);
  const wantWin=crypto.randomInt(100)<winFrequency;
  let cells=randomBoard(),evaluation=scoreBoard(cells,symbols,payouts);
  // Try to meet the target win frequency, without faking a payout.
  for(let trial=0;trial<180&&Boolean(evaluation.total)!==wantWin;trial++){
    cells=randomBoard();
    evaluation=scoreBoard(cells,symbols,payouts);
  }
  if(wantWin&&evaluation.total===0&&symbols.length>=2){
    const candidates=payouts.filter(p=>p.prize>0&&p.matches>=3&&p.matches<=5);
    // Inject a paying symbol into one random row of each required reel.
    for(let trial=0;trial<Math.min(candidates.length*8,200)&&evaluation.total===0;trial++){
      const candidateRule=candidates[crypto.randomInt(candidates.length)];
      const others=symbols.filter(item=>item.id!==candidateRule.symbol_id);
      const arranged=Array.from({length:20},()=>others[crypto.randomInt(others.length)].id);
      for(let col=0;col<candidateRule.matches;col++){
        const row=crypto.randomInt(4);
        arranged[row*5+col]=candidateRule.symbol_id;
      }
      const scored=scoreBoard(arranged,symbols,payouts);
      if(scored.total>0){cells=arranged;evaluation=scored;}
    }
  }
  return {cells,total:evaluation.total,wins:evaluation.wins,win:evaluation.total>0};
}
function assetUrl(assets,key,gameId){
  return assets.has(key)?'/game-assets/'+gameId+'/'+key:null;
}
const DEMO_BETS=[10,20,50,100];
const BET_UNIT=10;
function firstGamePage(game,req){
  const assets=new Set(getGameAssets(game.id).map(a=>a.asset_key));
  const url=key=>assetUrl(assets,key,game.id);
  const cssUrl=(key,varName)=>url(key)?' style="'+varName+':url(\''+h(url(key))+'\')"':'';
  const logo=url('logo')?'<img class="slot-logo" src="'+h(url('logo'))+'" alt="'+h(game.title)+'">':'';
  const reelLabels=Array.from({length:5},(_,col)=>'<div class="reel-header">Барабан №'+(col+1)+'</div>').join('');
  const reels=Array.from({length:5},(_,col)=>{
    const reelNumber=col+1;
    const reelBackground=url('reel_'+reelNumber)||url('reels_background');
    const backgroundStyle=reelBackground?'--reel-wall:url(\''+h(reelBackground)+'\');':'';
    const backgrounds=Array.from({length:4},(_,row)=>{
      const n=row*5+reelNumber;
      const image=url('cell_'+n);
      return '<div class="reel-cell-bg"'+(image?' style="--cell-wall:url(\''+h(image)+'\')"':'')+'></div>';
    }).join('');
    return '<div class="reel-column" data-reel="'+col+'" style="'+backgroundStyle+'">'+
      '<div class="reel-window"><div class="reel-backdrops">'+backgrounds+'</div>'+
      '<div class="reel-track" aria-label="Барабан '+reelNumber+'"></div></div></div>';
  }).join('');
  const symbols=getSymbols(game.id).map(symbol=>{
    const image=url('symbol_'+symbol.id)||'';
    return '<span data-symbol-def data-symbol-id="'+symbol.id+'" data-name="'+h(symbol.name)+'" data-image="'+h(image)+'"></span>';
  }).join('');
  const audio=['music','spin_sound','win_sound'].map(key=>url(key)?'<audio preload="none" data-sound="'+key+'" src="'+h(url(key))+'"></audio>':'').join('');
  const wallet=getWallet(req.user.id,game.id);
  return '<div class="slot-game" data-game-id="'+game.id+'"'+cssUrl('background','--slot-wall')+'><a class="back-link" href="/">← К каталогу</a>'+
    '<div class="slot-heading">'+logo+'<h1>'+h(game.title)+'</h1><p>4 ряда × 5 барабанов · демонстрационная игра</p></div>'+
    '<div class="slot-machine"><div class="slot-reels slot-reels-ribbon">'+
    '<div class="reel-labels">'+reelLabels+'</div><div class="reel-columns">'+reels+'</div></div>'+
    '<div class="slot-bottom-bar"><button type="button" id="slot-settings-trigger" class="slot-settings-trigger" aria-label="Настройки игры" title="Настройки">⚙</button><div class="slot-meters">'+
    '<div class="slot-meter"'+cssUrl('bet_panel','--bet-wall')+'><span>Баланс</span><strong id="slot-balance">'+wallet.balance+'</strong></div>'+
    '<button type="button" class="slot-meter slot-bet-button" id="slot-bet-trigger"'+cssUrl('bet_panel','--bet-wall')+'><span>Ставка <span aria-hidden="true">▾</span></span><strong id="slot-bet">'+wallet.bet+'</strong></button>'+
    '<div class="slot-meter"'+cssUrl('win_panel','--win-wall')+'><span>Выигрыш</span><strong id="slot-win">0</strong></div></div>'+
    '<form id="slot-spin-form" method="post" action="/games/'+h(game.slug)+'/spin">'+csrfInput(req.session.csrf_token)+
    '<button id="slot-spin-button" class="spin-round" type="submit" aria-label="Вращать барабаны"><span class="spin-round-icon" aria-hidden="true">↻</span><span>ВРАЩАТЬ</span></button></form></div>'+
    '<p class="slot-message" id="slot-result" role="status" aria-live="polite">Нажмите на круглую кнопку для вращения.</p></div>'+
    '<dialog class="slot-settings-dialog" id="slot-settings-dialog" aria-labelledby="slot-settings-heading">'+
    '<form method="dialog"><button type="submit" class="settings-close" aria-label="Закрыть настройки">×</button></form>'+
    '<h2 id="slot-settings-heading">Настройки игры</h2>'+
    '<label class="sound-toggle"><input type="checkbox" id="slot-sound-toggle" checked> Включить звук</label>'+
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
  if(game.slug==='slot-classic')return sendPage(res,game.title,firstGamePage(game,req),req);
  sendPage(res,game.title,'<section class="panel game-placeholder"><img src="'+h(game.image_path)+'" alt="" width="720" height="450"><h1>'+h(game.title)+'</h1><p>Игра находится в разработке.</p><a class="secondary" href="/">Назад к играм</a></section>',req);
});
app.post('/games/:slug/bet',guarded,spinLimiter,postGuard,(req,res)=>{
  const game=listGames(true).find(item=>item.slug===req.params.slug);
  if(!game||game.slug!=='slot-classic')return res.sendStatus(404);
  const bet=Number(req.body?.bet);
  if(!DEMO_BETS.includes(bet)||String(bet)!==req.body?.bet)return res.status(400).json({error:'Недопустимая ставка'});
  getWallet(req.user.id,game.id);
  db.prepare('UPDATE game_wallets SET bet=? WHERE user_id=? AND game_id=?').run(bet,req.user.id,game.id);
  res.set('Cache-Control','no-store');
  res.json({bet});
});
app.post('/games/:slug/spin',guarded,spinLimiter,postGuard,(req,res)=>{
  const game=listGames(true).find(item=>item.slug===req.params.slug);
  if(!game||game.slug!=='slot-classic')return res.sendStatus(404);
  const result=db.transaction(()=>{
    const wallet=getWallet(req.user.id,game.id);
    if(wallet.balance<wallet.bet)return {error:'Недостаточно тестовых очков для ставки.'};
    const spin=generateSpin(game.id,getGameSettings(game.id)?.win_frequency ?? 25);
    if(spin.error)return spin;
    // Admin-configured prizes are expressed for the base 10-point stake.
    const payout=spin.total*(wallet.bet/BET_UNIT);
    const updatedBalance=wallet.balance-wallet.bet+payout;
    if(!Number.isSafeInteger(updatedBalance)||updatedBalance<0)return {error:'Превышен допустимый баланс.'};
    db.prepare('UPDATE game_wallets SET balance=? WHERE user_id=? AND game_id=?')
      .run(updatedBalance,req.user.id,game.id);
    const wins=spin.wins.map(w=>({...w,prize:w.prize*(wallet.bet/BET_UNIT)}));
    return {...spin,total:payout,wins,balance:updatedBalance,bet:wallet.bet};
  })();
  res.set('Cache-Control','no-store');
  if(result.error)return res.status(400).json({error:result.error});
  res.json(result);
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
  const users=db.prepare('SELECT id,username,role,active,created_at FROM users ORDER BY id').all();
  const csrf=req.session.csrf_token;
  const rows=users.map(user=>{
    const controls=user.id===req.user.id?'<small>Вы</small>':
      '<form method="post" action="/admin/users/'+user.id+'/toggle" class="inline">'+csrfInput(csrf)+
        '<button type="submit">'+(user.active?'Заблокировать':'Разблокировать')+'</button></form> '+
      '<form method="post" action="/admin/users/'+user.id+'/role" class="inline">'+csrfInput(csrf)+
        '<button type="submit">'+(user.role==='admin'?'Снять права':'Сделать админом')+'</button></form>';
    return '<tr><td>'+user.id+'</td><td>'+h(user.username)+'</td><td>'+h(user.role)+'</td><td>'+
      (user.active?'Активен':'Заблокирован')+'</td><td>'+h(user.created_at)+'</td><td>'+controls+'</td></tr>';
  }).join('');
  const gameButtons=listGames().map(game=>'<a class="admin-game-link" href="/admin/games/'+game.id+'">'+
    '<img src="'+h(game.image_path)+'" alt="" width="720" height="450"><span>'+h(game.title)+'</span><small>Настройки игры</small></a>').join('');
  sendPage(res,'Админ-панель','<div class="admin-content"><section class="panel"><h1>Управление играми</h1>'+
    '<p class="hint">Выберите игру, чтобы перейти к её настройкам.</p><div class="admin-games-grid">'+gameButtons+'</div></section>'+
    '<section class="panel"><h2>Управление пользователями</h2><p>Пользователи: '+users.length+
    '</p><div class="table-wrap"><table><thead><tr><th>ID</th><th>Логин</th><th>Роль</th><th>Статус</th><th>Создан</th><th>Действия</th></tr></thead><tbody>'+rows+
    '</tbody></table></div></section></div>',req);
});
installGameAdmin(app,{db,gameById,getGameSettings,getGameAssets,getSymbols,getPayouts,adminOnly,guarded,postGuard,sendPage,h,csrfInput});
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
  if(err?.name==='MulterError')return res.status(err.code==='LIMIT_FILE_SIZE'?413:400).send('Ошибка загрузки: превышен лимит размера файла или количества полей. Вернитесь к настройкам игры.');
  console.error(err);
  res.status(500).send('Ошибка сервера');
});
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
app.listen(PORT,'0.0.0.0',()=>console.log('SlotJava: http://localhost:'+PORT));
