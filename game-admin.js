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
for(let i=1;i<=5;i++)assetTypes['reel_'+i]={label:'Фон барабана №'+i+' (столбец '+i+')',kind:'image'};
for(let i=1;i<=20;i++)assetTypes['cell_'+i]={label:'Фон ячейки №'+i+' (строка '+(Math.floor((i-1)/5)+1)+', столбец '+((i-1)%5+1)+')',kind:'image'};

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
function installGameAdmin(app,{db,gameById,getGameSettings,getGameAssets,getSymbols,getPayouts,adminOnly,guarded,postGuard,sendPage,h,csrfInput}) {
  function dynamicAsset(id,key) {
    if(assetTypes[key])return assetTypes[key];
    const match=/^symbol_(\d+)$/.exec(key);
    if(!match)return null;
    const symbolId=Number(match[1]);
    if(!Number.isSafeInteger(symbolId)||symbolId<1)return null;
    const row=db.prepare('SELECT id FROM game_symbols WHERE id=? AND game_id=?').get(symbolId,id);
    return row ? {label:'Изображение символа №'+symbolId,kind:'image'} : null;
  }
  function assertOwnSymbol(gameId,symbolId) {
    if(!Number.isSafeInteger(symbolId)||symbolId<1)return false;
    return !!db.prepare('SELECT id FROM game_symbols WHERE id=? AND game_id=?').get(symbolId,gameId);
  }
  function imageBox(id,key,label,assets,csrf) {
    const value=assets.get(key),src='/game-assets/'+id+'/'+key;
    return '<div class="asset-setting"><div class="asset-detail"><strong>'+h(label)+'</strong>'+
      (value?'<img class="asset-preview" src="'+src+'" alt="'+h(label)+'">':'<span class="asset-empty">Не загружено</span>')+'</div>'+
      '<div class="asset-actions"><form method="post" action="/admin/games/'+id+'/assets/'+key+'" enctype="multipart/form-data">'+csrf+
      '<label class="asset-upload-label">Изображение<input type="file" name="asset" accept="image/png,image/jpeg,image/webp,image/gif" required></label>'+
      '<button class="primary" type="submit">Загрузить</button></form>'+
      (value?'<form method="post" action="/admin/games/'+id+'/assets/'+key+'/delete">'+csrf+'<button type="submit">Удалить фон</button></form>':'')+
      '</div></div>';
  }
  function show(req,res,message='',error=false) {
    const id=gameId(req);
    const game=id?gameById(id):null;
    if(!game)return sendPage(res,'Не найдено','<section class="panel"><h1>Игра не найдена</h1><a href="/admin">Вернуться</a></section>',req,404);
    const settings=getGameSettings(id)||{win_frequency:25};
    const assets=new Map(getGameAssets(id).map(asset=>[asset.asset_key,asset]));
    const csrf=csrfInput(req.session.csrf_token);
    const rows=Object.entries(assetTypes).filter(([key])=>!key.startsWith('cell_')).map(([key,meta])=>{
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
    const symbols=getSymbols(id);
    const payouts=getPayouts(id);
    const payoutBySymbol=new Map();
    for(const p of payouts){if(!payoutBySymbol.has(p.symbol_id))payoutBySymbol.set(p.symbol_id,new Map());payoutBySymbol.get(p.symbol_id).set(p.matches,p.coefficient_milli);}
    const symbolItems=symbols.map(symbol=>{
      const costs=payoutBySymbol.get(symbol.id)||new Map();
      const cells=Array.from({length:18},(_,i)=>{
        const count=i+3;
        return '<label class="payout-input">'+count+' символов, ×<input type="number" min="0" max="1000" step="0.001" name="p_'+count+'" value="'+((costs.get(count)||0)/1000).toFixed(3)+'" required></label>';
      }).join('');
      return '<div class="symbol-admin-card"><h3>'+h(symbol.name)+' <small>ID '+symbol.id+'</small></h3>'+
        imageBox(id,'symbol_'+symbol.id,'Картинка: '+symbol.name,assets,csrf)+
        '<form class="symbol-prices-form" method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/payouts">'+csrf+
        '<p class="hint">Символ учитывается на непрерывной цепочке барабанов слева направо, начиная с первого. Минимум 3 барабана. Повторы суммируются только до первого пропуска. Для каждого количества укажите коэффициент, на который умножается текущая ставка: например, ×1.5 при ставке 20 = 30 очков. Ноль — выплаты нет.</p>'+
        '<div class="payout-grid">'+cells+'</div><button class="primary" type="submit">Сохранить цены</button></form>'+
        '<form method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/delete">'+csrf+
        '<button type="submit" class="danger-action">Удалить символ</button></form></div>';
    }).join('');
    const cellSettings=Array.from({length:20},(_,index)=>imageBox(id,'cell_'+(index+1),
      'Ячейка №'+(index+1)+' — строка '+(Math.floor(index/5)+1)+', столбец '+((index%5)+1),assets,csrf)).join('');
    const notice=message?'<p class="'+(error?'error':'success-note')+'" role="status">'+h(message)+'</p>':'';
    sendPage(res,'Настройки: '+game.title,
      '<div class="game-admin-page"><a class="back-link" href="/admin">← К списку игр</a>'+
      '<h1>Настройки: '+h(game.title)+'</h1>'+notice+
      '<section class="panel"><h2>Частота выигрыша</h2>'+
      '<p class="hint">Вероятность выигрышного вращения, от 0 до 100%. Это не RTP и не доля возвращаемых ставок. Для «Первой игры» параметр задаёт целевую частоту вращений с выплатой по коэффициенту от ставки для числа символов в непрерывной цепочке барабанов. Если ни для одного символа не настроена положительная выплата, выигрышей не будет. Денежные ставки пока не используются.</p>'+
      '<form class="win-setting-form" method="post" action="/admin/games/'+id+'/settings">'+csrf+
      '<label for="win_frequency">Частота выигрыша, %</label><div class="win-setting-controls">'+
      '<input id="win_frequency" type="number" min="0" max="100" step="1" name="win_frequency" value="'+h(settings.win_frequency)+'" required>'+
      '<button class="primary" type="submit">Сохранить</button></div></form></section>'+
      '<section class="panel"><h2>Оформление, символы и звук</h2>'+
      '<p class="hint">Поле 4 строки × 5 столбцов. Символы не закреплены за позициями: при каждом вращении алгоритм выбирает символ для каждой ячейки.</p>'+
      '<p class="hint">Изображения: PNG, JPG, WEBP, GIF (до 5 МБ). Звук: MP3, OGG, WAV (до 12 МБ). Каждый файл закрепляется за этой игрой.</p>'+
      '<div class="asset-settings-grid">'+rows+'</div></section>'+
      '<section class="panel"><h2>Фон каждой ячейки (4 × 5)</h2><p class="hint">Номера идут слева направо, сверху вниз. Фон не вращается, изменяется только символ поверх него.</p>'+
      '<div class="asset-settings-grid">'+cellSettings+'</div></section>'+
      '<section class="panel" id="symbols"><h2>Символы и таблица цен</h2><p class="hint">Добавьте любой символ. Он участвует в генерации всех 20 ячеек, независимо от столбца. Для выигрыша символ должен встретиться на первых трёх барабанах. Цепочка продолжается только пока символ есть на следующем барабане; после первого пропуска дальнейшие символы не считаются. Повторы внутри цепочки суммируются. Для каждого количества от 3 до 20 задаётся коэффициент умножения текущей ставки.</p>'+
      '<form method="post" action="/admin/games/'+id+'/symbols" class="new-symbol-form">'+csrf+
      '<label>Название нового символа<input name="name" minlength="1" maxlength="60" required placeholder="Например: Золотая звезда"></label>'+
      '<button class="primary" type="submit">Добавить символ</button></form>'+
      '<div class="symbol-admin-list">'+symbolItems+'</div></section></div>',req,error?400:200);
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
  app.post('/admin/games/:id/symbols',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req);
    if(!id||!gameById(id))return res.sendStatus(404);
    const name=typeof req.body.name==='string'?req.body.name.trim():'';
    if(name.length<1||name.length>60)return show(req,res,'Имя символа должно содержать от 1 до 60 символов.',true);
    if(getSymbols(id).length>=50)return show(req,res,'Лимит — 50 символов на игру.',true);
    const position=db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM game_symbols WHERE game_id=?').get(id).n;
    db.prepare('INSERT INTO game_symbols(game_id,name,position) VALUES(?,?,?)').run(id,name,position);
    res.redirect('/admin/games/'+id+'#symbols');
  });
  app.post('/admin/games/:id/symbols/:symbolId/payouts',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),symbolId=Number(req.params.symbolId);
    if(!id||!gameById(id)||!assertOwnSymbol(id,symbolId))return res.sendStatus(404);
    const prices=[];
    for(let n=3;n<=20;n++){
      const raw=req.body['p_'+n];
      if(typeof raw!=='string'||!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/.test(raw)||Number(raw)>1000)
        return show(req,res,'Коэффициент должен быть от 0 до 1000, с точностью до трёх знаков после запятой.',true);
      prices.push([n,Math.round(Number(raw)*1000)]);
    }
    const put=db.prepare('INSERT INTO symbol_payout_multipliers(symbol_id,matches,coefficient_milli) VALUES(?,?,?) ON CONFLICT(symbol_id,matches) DO UPDATE SET coefficient_milli=excluded.coefficient_milli');
    db.transaction(()=>{for(const [count,price] of prices)put.run(symbolId,count,price);})();
    res.redirect('/admin/games/'+id+'#symbols');
  });
  app.post('/admin/games/:id/symbols/:symbolId/delete',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),symbolId=Number(req.params.symbolId);
    if(!id||!gameById(id)||!assertOwnSymbol(id,symbolId))return res.sendStatus(404);
    const image=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,'symbol_'+symbolId);
    db.transaction(()=>{
      db.prepare('DELETE FROM game_assets WHERE game_id=? AND asset_key=?').run(id,'symbol_'+symbolId);
      db.prepare('DELETE FROM game_symbols WHERE id=? AND game_id=?').run(symbolId,id);
    })();
    if(image)try{fs.unlinkSync(path.join(uploadsDir,image.file_name));}catch{}
    res.redirect('/admin/games/'+id+'#symbols');
  });
  app.post('/admin/games/:id/assets/:key',adminOnly,upload.single('asset'),postGuard,(req,res)=>{
    const id=gameId(req),key=req.params.key,meta=id?dynamicAsset(id,key):null;
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
    if(!id||!gameById(id)||!dynamicAsset(id,key))return res.sendStatus(404);
    const previous=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,key);
    db.prepare('DELETE FROM game_assets WHERE game_id=? AND asset_key=?').run(id,key);
    if(previous)try{fs.unlinkSync(path.join(uploadsDir,previous.file_name));}catch(e){console.warn('Asset removal:',e.code);}
    res.redirect('/admin/games/'+id+'?deleted=1');
  });
  app.get('/game-assets/:id/:key',guarded,(req,res)=>{
    const id=gameId(req),key=req.params.key;
    if(!id||!dynamicAsset(id,key))return res.sendStatus(404);
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