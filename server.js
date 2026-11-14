const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { db, verifyPassword, validUsername, validPassword, getUserByName, createUser, countActiveAdmins, listGames, gameById } = require('./db');

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
app.get('/games/:slug',guarded,(req,res)=>{
  const slug=req.params.slug;
  const game=listGames(true).find(item=>item.slug===slug);
  if(!game) return sendPage(res,'Не найдено','<section class="panel"><h1>Игра не найдена</h1><a href="/">Все игры</a></section>',req,404);
  sendPage(res,game.title,'<section class="panel game-placeholder"><img src="'+h(game.image_path)+'" alt="" width="720" height="450"><h1>'+h(game.title)+'</h1><p>Игра находится в разработке.</p><a class="secondary" href="/">Назад к играм</a></section>',req);
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
app.get('/admin/games/:id',adminOnly,(req,res)=>{
  const id=Number(req.params.id);
  const game=Number.isSafeInteger(id)&&id>0?gameById(id):null;
  if(!game)return sendPage(res,'Не найдено','<section class="panel"><h1>Игра не найдена</h1><a href="/admin">К списку игр</a></section>',req,404);
  sendPage(res,'Настройки: '+game.title,
    '<section class="panel game-settings"><a class="back-link" href="/admin">← Вернуться в админку</a>'+
    '<h1>'+h(game.title)+'</h1><img src="'+h(game.image_path)+'" alt="Обложка игры" width="720" height="450">'+
    '<p class="hint">Это страница управления выбранной игрой. Настройки и функции добавим позже.</p></section>',req);
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
app.use((err,req,res,next)=>{console.error(err);res.status(500).send('Ошибка сервера');});
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
app.listen(PORT,'0.0.0.0',()=>console.log('SlotJava: http://localhost:'+PORT));
