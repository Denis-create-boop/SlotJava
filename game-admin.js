const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const uploadsDir=path.join(__dirname,'data','game-uploads');
fs.mkdirSync(uploadsDir,{recursive:true,mode:0o700});

const assetTypes={
  background:{label:'Фон игрового окна',kind:'image'},
  logo:{label:'Логотип игры',kind:'image'},
  reels_background:{label:'Фон барабанов',kind:'image'},
  bet_panel:{label:'Фон панели ставок',kind:'image'},
  win_panel:{label:'Фон панели выигрыша',kind:'image'},
  music:{label:'Фоновая музыка',kind:'audio'},
  spin_sound:{label:'Звук вращения барабанов',kind:'audio'},
  win_sound:{label:'Звук выигрыша',kind:'audio'},
};
for(let i=1;i<=12;i++)assetTypes['symbol_'+i]={label:'Символ №'+i+' (для всех барабанов)',kind:'image'};

const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:12*1024*1024,files:1,fields:3,parts:4,fieldSize:1024},
});
function fileType(buffer) {
  if(buffer.length>=8 && buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return {ext:'png',type:'image/png',kind:'image'};
  if(buffer.length>=3 && buffer.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))return {ext:'jpg',type:'image/jpeg',kind:'image'};
  if(buffer.length>=6 && ['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6)))return {ext:'gif',type:'image/gif',kind:'image'};
  if(buffer.length>=12 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP')return {ext:'webp',type:'image/webp',kind:'image'};
  if(buffer.length>=12 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WAVE')return {ext:'wav',type:'audio/wav',kind:'audio'};
  if(buffer.length>=4 && buffer.toString('ascii',0,4)==='OggS')return {ext:'ogg',type:'audio/ogg',kind:'audio'};
  if(buffer.length>=3 && buffer.toString('ascii',0,3)==='ID3')return {ext:'mp3',type:'audio/mpeg',kind:'audio'};
  if(buffer.length>=2 && buffer[0]===0xff && (buffer[1]&0xe0)===0xe0)return {ext:'mp3',type:'audio/mpeg',kind:'audio'};
  return null;
}
function gameId(req) {
  const id=Number(req.params.id);
  return Number.isSafeInteger(id) && id>0 ? id : null;
}
function installGameAdmin(app,{db,gameById,getGameSettings,getGameAssets,adminOnly,guarded,postGuard,sendPage,h,csrfInput}) {
  function show(req,res,message='',error=false) {
    const id=gameId(req);
    const game=id?gameById(id):null;
    if(!game)return sendPage(res,'Не найдено','<section class="panel"><h1>Игра не найдена</h1><a href="/admin">Вернуться</a></section>',req,404);
    const settings=getGameSettings(id)||{win_frequency:25};
    const assets=new Map(getGameAssets(id).map(asset=>[asset.asset_key,asset]));
    const csrf=csrfInput(req.session.csrf_token);
    const rows=Object.entries(assetTypes).map(([key,meta])=>{
      const value=assets.get(key);
      const src='/game-assets/'+id+'/'+key;
      const preview=value ? (meta.kind==='image'
        ? '<img class="asset-preview" src="'+src+'" alt="'+h(meta.label)+'">'
        : '<audio controls preload="none" src="'+src+'"></audio>') : '<span class="asset-empty">Файл не загружен</span>';
      return '<div class="asset-setting"><div class="asset-detail"><strong>'+h(meta.label)+'</strong>'+preview+'</div>'+
        '<div class="asset-actions"><form method="post" action="/admin/games/'+id+'/assets/'+key+'" enctype="multipart/form-data">'+csrf+
        '<label class="asset-upload-label">Выбрать файл <input type="file" name="asset" accept="'+(meta.kind==='image'?'image/png,image/jpeg,image/webp,image/gif':'audio/mpeg,audio/ogg,audio/wav')+'" required></label>'+
        '<button class="primary" type="submit">Загрузить</button></form>'+
        (value?'<form method="post" action="/admin/games/'+id+'/assets/'+key+'/delete">'+csrf+'<button type="submit">Удалить</button></form>':'')+
        '</div></div>';
    }).join('');
    const notice=message?'<p class="'+(error?'error':'success-note')+'" role="status">'+h(message)+'</p>':'';
    sendPage(res,'Настройки: '+game.title,
      '<div class="game-admin-page"><a class="back-link" href="/admin">← К списку игр</a>'+
      '<h1>Настройки: '+h(game.title)+'</h1>'+notice+
      '<section class="panel"><h2>Частота выигрыша</h2>'+
      '<p class="hint">Вероятность выигрышного вращения, от 0 до 100%. Это не RTP и не доля возвращаемых ставок. Для «Первой игры» параметр уже управляет вероятностью совпадения трёх символов на средней линии. Денежные ставки пока не используются.</p>'+
      '<form class="win-setting-form" method="post" action="/admin/games/'+id+'/settings">'+csrf+
      '<label for="win_frequency">Частота выигрыша, %</label><div class="win-setting-controls">'+
      '<input id="win_frequency" type="number" min="0" max="100" step="1" name="win_frequency" value="'+h(settings.win_frequency)+'" required>'+
      '<button class="primary" type="submit">Сохранить</button></div></form></section>'+
      '<section class="panel"><h2>Оформление, символы и звук</h2>'+
      '<p class="hint"><strong>Барабан №1</strong> — слева, <strong>№2</strong> — по центру, <strong>№3</strong> — справа. Поля «Символ №1» … «Символ №12» задают 12 видов картинок, которые появляются на любом из трёх барабанов. Номера символов видны и в самой игре.</p>'+
      '<p class="hint">Изображения: PNG, JPG, WEBP, GIF (до 5 МБ). Звук: MP3, OGG, WAV (до 12 МБ). Каждый файл закрепляется за этой игрой.</p>'+
      '<div class="asset-settings-grid">'+rows+'</div></section></div>',req,error?400:200);
  }
  app.get('/admin/games/:id',adminOnly,(req,res)=>show(req,res));
  app.post('/admin/games/:id/settings',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req);
    if(!id||!gameById(id))return res.sendStatus(404);
    const value=req.body.win_frequency;
    if(typeof value!=='string'||!/^(100|[1-9]?\d)$/.test(value))return show(req,res,'Введите целое число от 0 до 100.',true);
    db.prepare('INSERT INTO game_settings(game_id,win_frequency) VALUES(?,?) ON CONFLICT(game_id) DO UPDATE SET win_frequency=excluded.win_frequency').run(id,Number(value));
    res.redirect('/admin/games/'+id+'?saved=1');
  });
  app.post('/admin/games/:id/assets/:key',adminOnly,upload.single('asset'),postGuard,(req,res)=>{
    const id=gameId(req),key=req.params.key,meta=assetTypes[key];
    if(!id||!gameById(id)||!meta)return res.sendStatus(404);
    if(!req.file||!req.file.buffer?.length)return show(req,res,'Выберите файл для загрузки.',true);
    const type=fileType(req.file.buffer);
    if(!type||type.kind!==meta.kind)return show(req,res,'Неподдерживаемый формат файла.',true);
    if(meta.kind==='image'&&req.file.size>5*1024*1024)return show(req,res,'Изображение должно быть не больше 5 МБ.',true);
    const name=crypto.randomBytes(24).toString('hex')+'.'+type.ext;
    const fullPath=path.join(uploadsDir,name);
    fs.writeFileSync(fullPath,req.file.buffer,{flag:'wx',mode:0o600});
    try {
      const previous=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,key);
      db.prepare('INSERT INTO game_assets(game_id,asset_key,file_name,media_type) VALUES(?,?,?,?) ON CONFLICT(game_id,asset_key) DO UPDATE SET file_name=excluded.file_name,media_type=excluded.media_type').run(id,key,name,type.type);
      if(previous)try{fs.unlinkSync(path.join(uploadsDir,previous.file_name));}catch(e){console.warn('Old game asset cleanup:',e.code);}
    }catch(e){try{fs.unlinkSync(fullPath);}catch{}throw e;}
    res.redirect('/admin/games/'+id+'?uploaded=1');
  });
  app.post('/admin/games/:id/assets/:key/delete',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),key=req.params.key;
    if(!id||!gameById(id)||!assetTypes[key])return res.sendStatus(404);
    const previous=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,key);
    db.prepare('DELETE FROM game_assets WHERE game_id=? AND asset_key=?').run(id,key);
    if(previous)try{fs.unlinkSync(path.join(uploadsDir,previous.file_name));}catch(e){console.warn('Asset removal:',e.code);}
    res.redirect('/admin/games/'+id+'?deleted=1');
  });
  app.get('/game-assets/:id/:key',guarded,(req,res)=>{
    const id=gameId(req),key=req.params.key;
    if(!id||!assetTypes[key])return res.sendStatus(404);
    const game=gameById(id);
    if(!game||(!game.enabled&&req.user.role!=='admin'))return res.sendStatus(404);
    const row=db.prepare('SELECT file_name,media_type FROM game_assets WHERE game_id=? AND asset_key=?').get(id,key);
    if(!row)return res.sendStatus(404);
    // Filenames are generated on the server; never accept user-provided paths.
    if(!/^[a-f0-9]{48}\.(png|jpg|webp|gif|wav|ogg|mp3)$/.test(row.file_name))return res.sendStatus(404);
    res.set('Content-Type',row.media_type);
    res.set('X-Content-Type-Options','nosniff');
    res.sendFile(path.join(uploadsDir,row.file_name),err=>{if(err&&!res.headersSent)res.sendStatus(404);});
  });
}
module.exports={installGameAdmin};