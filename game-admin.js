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
function installGameAdmin(app,{db,gameById,getGameSettings,getGameAssets,getSymbols,getPayouts,getLibraryImages,getSymbolImageLinks,adminOnly,guarded,postGuard,sendPage,h,csrfInput}) {
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
  function libraryUrl(gameId,image){
    return image.builtin_path||'/game-library/'+gameId+'/'+image.id;
  }
  function ownedLibraryImage(gameId,imageId){
    return db.prepare('SELECT id,name,builtin_path,file_name FROM game_image_library WHERE game_id=? AND id=?')
      .get(gameId,imageId);
  }
  function assetTab(key){
    if(key==='background'||key==='logo')return 'background';
    if(key==='reels_background'||/^reel_[1-5]$/.test(key))return 'reels';
    if(/^cell_(?:[1-9]|1\d|20)$/.test(key))return 'cells';
    if(key==='bet_panel'||key==='win_panel')return 'panels';
    if(key==='music'||key==='spin_sound'||key==='win_sound')return 'audio';
    if(/^symbol_\d+$/.test(key))return 'symbols';
    return 'overview';
  }
  function sectionUrl(id,tab){
    return '/admin/games/'+id+'?tab='+tab;
  }
  function show(req,res,message='',error=false) {
    const id=gameId(req);
    const game=id?gameById(id):null;
    if(!game)return sendPage(res,'Не найдено','<section class="panel"><h1>Игра не найдена</h1><a href="/admin">Вернуться</a></section>',req,404);
    const settings=getGameSettings(id)||{win_frequency:25};
    const assets=new Map(getGameAssets(id).map(asset=>[asset.asset_key,asset]));
    const csrf=csrfInput(req.session.csrf_token);
    const renderAssetRow=([key,meta])=>{
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
    };
    const rowsFor=keys=>keys.map(key=>renderAssetRow([key,assetTypes[key]])).join('');
    const symbols=getSymbols(id);
    const payouts=getPayouts(id);
    const payoutBySymbol=new Map();
    for(const p of payouts){if(!payoutBySymbol.has(p.symbol_id))payoutBySymbol.set(p.symbol_id,new Map());payoutBySymbol.get(p.symbol_id).set(p.matches,p.coefficient_milli);}
    const libraryImages=getLibraryImages(id);
    const linked=new Map(getSymbolImageLinks(id).map(item=>[item.symbol_id,item.image_id]));
    const libraryCards=libraryImages.map(image=>{
      const src=libraryUrl(id,image);
      const linkedCount=Array.from(linked.values()).filter(imageId=>imageId===image.id).length;
      return '<div class="library-image-card"><img src="'+h(src)+'" alt="'+h(image.name)+'" loading="lazy">'+
        '<strong>'+h(image.name)+'</strong>'+
        (image.file_name?'<form method="post" action="/admin/games/'+id+'/library/'+image.id+'/delete">'+csrf+
          '<button type="submit"'+(linkedCount?' disabled title="Сначала отвяжите изображение от символов"':'')+'>Удалить</button></form>':
          '<small>Стандартная иллюстрация</small>')+'</div>';
    }).join('');
    const symbolItems=symbols.map(symbol=>{
      const costs=payoutBySymbol.get(symbol.id)||new Map();
      const cells=Array.from({length:18},(_,i)=>{
        const count=i+3;
        return '<label class="payout-input">'+count+' символов, ×<input type="number" min="0" max="1000" step="0.001" name="p_'+count+'" value="'+((costs.get(count)||0)/1000).toFixed(3)+'" required></label>';
      }).join('');
      const selected=linked.get(symbol.id)||0;
      const options=libraryImages.map(image=>'<option value="'+image.id+'"'+(image.id===selected?' selected':'')+'>'+h(image.name)+'</option>').join('');
      const chosen=libraryImages.find(image=>image.id===selected);
      const preview=chosen?'<img class="asset-preview" src="'+h(libraryUrl(id,chosen))+'" alt="'+h(chosen.name)+'">':'';
      return '<div class="symbol-admin-card"><h3>'+h(symbol.name)+' <small>ID '+symbol.id+'</small></h3>'+
        '<div class="symbol-library-picker">'+preview+
        '<form method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/image">'+csrf+
        '<label>Картинка из папки игры<select name="image_id" required><option value="">Выберите изображение</option>'+options+'</select></label>'+
        '<button class="primary" type="submit">Применить картинку</button></form></div>'+
        (!chosen&&assets.has('symbol_'+symbol.id)?'<p class="hint">Пока используется ранее загруженная картинка символа. Выберите изображение из папки для замены.</p>':'')+
        '<form class="symbol-prices-form" method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/payouts">'+csrf+
        '<p class="hint">Символ учитывается на непрерывной цепочке барабанов слева направо, начиная с первого. Минимум 3 барабана. Повторы суммируются только до первого пропуска. Для каждого количества укажите коэффициент, на который умножается текущая ставка: например, ×1.5 при ставке 20 = 30 очков. Ноль — выплаты нет.</p>'+
        '<div class="payout-grid">'+cells+'</div><button class="primary" type="submit">Сохранить цены</button></form>'+
        '<form method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/delete">'+csrf+
        '<button type="submit" class="danger-action">Удалить символ</button></form></div>';
    }).join('');
    const cellSettings=Array.from({length:20},(_,index)=>imageBox(id,'cell_'+(index+1),
      'Ячейка №'+(index+1)+' — строка '+(Math.floor(index/5)+1)+', столбец '+((index%5)+1),assets,csrf)).join('');
    const tabs=[
      ['background','Изменение фона','Фон игрового окна и логотип','image'],
      ['reels','Фон барабанов','Общий фон и 5 барабанов','columns'],
      ['cells','Фон игрового поля','Фон каждой из 20 ячеек','grid'],
      ['panels','Панели ставок и выигрыша','Оформление нижних панелей','wallet'],
      ['audio','Музыка и звуки','Музыка, вращение и выигрыш','music'],
      ['library','Папка изображений','Загрузка и хранение картинок','folder'],
      ['symbols','Символы и коэффициенты','Символы и таблица выплат','star'],
      ['frequency','Частота выигрыша','Вероятность выигрышных вращений','percent']
    ];
    const validTabs=new Set(tabs.map(tab=>tab[0]));
    const activeTab=typeof req.query.tab==='string'&&validTabs.has(req.query.tab)?req.query.tab:'overview';
    const tabButtons=tabs.map(([key,title,description,icon])=>
      '<a class="game-admin-menu-button'+(activeTab===key?' is-active':'')+'" href="/admin/games/'+id+'?tab='+key+'"'+
      (activeTab===key?' aria-current="page"':'')+'>'+
      '<span class="game-admin-menu-icon" aria-hidden="true">'+
      ({image:'▧',columns:'▥',grid:'▦',wallet:'▣',music:'♫',folder:'▤',star:'★',percent:'%'}[icon])+
      '</span><span><strong>'+title+'</strong><small>'+description+'</small></span></a>').join('');
    const panelStart=(title)=>'<section class="panel game-admin-selected" id="'+activeTab+'"><h2>'+title+'</h2>';
    let panel='';
    if(activeTab==='background')panel=panelStart('Изменение фона')+
      '<p class="hint">Изменяйте фон игрового окна и логотип игры.</p><div class="asset-settings-grid">'+
      rowsFor(['background','logo'])+'</div></section>';
    if(activeTab==='reels')panel=panelStart('Фон барабанов')+
      '<p class="hint">Выберите общий фон барабанов или отдельный фон каждого из пяти столбцов.</p>'+
      '<div class="asset-settings-grid">'+rowsFor(['reels_background','reel_1','reel_2','reel_3','reel_4','reel_5'])+'</div></section>';
    if(activeTab==='cells')panel=panelStart('Фон игрового поля')+
      '<p class="hint">Двадцать ячеек: нумерация слева направо, сверху вниз. Символы вращаются поверх фона.</p>'+
      '<div class="asset-settings-grid">'+cellSettings+'</div></section>';
    if(activeTab==='panels')panel=panelStart('Панели ставок и выигрыша')+
      '<p class="hint">Оформление областей баланса, ставки и выигрыша.</p><div class="asset-settings-grid">'+
      rowsFor(['bet_panel','win_panel'])+'</div></section>';
    if(activeTab==='audio')panel=panelStart('Музыка и звуки')+
      '<p class="hint">Добавьте фоновую музыку и звуки вращения и выигрыша. Форматы MP3, OGG, WAV до 12 МБ.</p>'+
      '<div class="asset-settings-grid">'+rowsFor(['music','spin_sound','win_sound'])+'</div></section>';
    if(activeTab==='frequency')panel=panelStart('Частота выигрыша')+
      '<p class="hint">Целевой процент выигрышных вращений от 0 до 100. Это не RTP и не доля возвращаемых ставок. При отсутствии положительных коэффициентов выигрышей не будет.</p>'+
      '<form class="win-setting-form" method="post" action="/admin/games/'+id+'/settings?tab=frequency">'+csrf+
      '<label for="win_frequency">Частота выигрыша, %</label><div class="win-setting-controls">'+
      '<input id="win_frequency" type="number" min="0" max="100" step="1" name="win_frequency" value="'+h(settings.win_frequency)+'" required>'+
      '<button class="primary" type="submit">Сохранить</button></div></form></section>';
    if(activeTab==='library')panel=panelStart('Папка изображений игры')+
      '<p class="hint">Картинки сохраняются в библиотеке именно этой игры. После загрузки их можно выбирать для символов. PNG, JPG, WEBP, GIF до 5 МБ.</p>'+
      '<form class="library-upload" method="post" action="/admin/games/'+id+'/library?tab=library" enctype="multipart/form-data">'+csrf+
      '<label>Название картинки<input name="name" maxlength="80" required placeholder="Например: Череп"></label>'+
      '<label>Файл<input type="file" name="asset" accept="image/png,image/jpeg,image/webp,image/gif" required></label>'+
      '<button class="primary" type="submit">Добавить в папку</button></form>'+
      '<div class="library-images">'+libraryCards+'</div></section>';
    if(activeTab==='symbols')panel=panelStart('Символы и коэффициенты')+
      '<p class="hint">Для каждого символа выберите картинку из папки игры и задайте коэффициент выплаты за 3–20 появлений. Выигрышная цепочка должна начинаться на первых трёх барабанах и прерывается при первом пропуске.</p>'+
      '<form method="post" action="/admin/games/'+id+'/symbols?tab=symbols" class="new-symbol-form">'+csrf+
      '<label>Название нового символа<input name="name" minlength="1" maxlength="60" required placeholder="Например: Золотая звезда"></label>'+
      '<button class="primary" type="submit">Добавить символ</button></form>'+
      '<div class="symbol-admin-list">'+symbolItems+'</div></section>';
    const notice=message?'<p class="'+(error?'error':'success-note')+'" role="status">'+h(message)+'</p>':'';
    sendPage(res,'Настройки: '+game.title,
      '<div class="game-admin-page"><a class="back-link" href="/admin">← К списку игр</a>'+
      '<h1>Настройки: '+h(game.title)+'</h1>'+notice+
      '<nav class="game-admin-menu" aria-label="Разделы настроек игры">'+tabButtons+'</nav>'+
      (panel || '<section class="panel game-admin-intro"><h2>Управление игрой</h2>'+
      '<p class="hint">Выберите нужный раздел кнопкой выше. Настройки, файлы и коэффициенты сохраняются отдельно для каждой игры.</p></section>')+
      '</div>',req,error?400:200);
  }
  app.get('/admin/games/:id',adminOnly,(req,res)=>show(req,res));
  app.post('/admin/games/:id/settings',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req);
    if(!id||!gameById(id))return res.sendStatus(404);
    const value=req.body.win_frequency;
    if(typeof value!=='string'||!/^(100|[1-9]?\d)$/.test(value))return show({...req,query:{...req.query,tab:'frequency'}},res,'Введите целое число от 0 до 100.',true);
    db.prepare('INSERT INTO game_settings(game_id,win_frequency) VALUES(?,?) ON CONFLICT(game_id) DO UPDATE SET win_frequency=excluded.win_frequency').run(id,Number(value));
    res.redirect(sectionUrl(id,'frequency')+'&saved=1');
  });
  app.post('/admin/games/:id/symbols',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req);
    if(!id||!gameById(id))return res.sendStatus(404);
    const name=typeof req.body.name==='string'?req.body.name.trim():'';
    if(name.length<1||name.length>60)return show({...req,query:{...req.query,tab:'symbols'}},res,'Имя символа должно содержать от 1 до 60 символов.',true);
    if(getSymbols(id).length>=50)return show({...req,query:{...req.query,tab:'symbols'}},res,'Лимит — 50 символов на игру.',true);
    const position=db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM game_symbols WHERE game_id=?').get(id).n;
    db.prepare('INSERT INTO game_symbols(game_id,name,position) VALUES(?,?,?)').run(id,name,position);
    res.redirect(sectionUrl(id,'symbols'));
  });
  app.post('/admin/games/:id/library',adminOnly,upload.single('asset'),postGuard,(req,res)=>{
    const id=gameId(req),name=typeof req.body.name==='string'?req.body.name.trim():'';
    if(!id||!gameById(id))return res.sendStatus(404);
    if(!name||name.length>80)return show({...req,query:{...req.query,tab:'library'}},res,'Укажите название изображения до 80 символов.',true);
    if(!req.file?.buffer?.length)return show({...req,query:{...req.query,tab:'library'}},res,'Выберите изображение.',true);
    const type=fileType(req.file.buffer);
    if(!type||type.kind!=='image'||req.file.size>5*1024*1024)
      return show({...req,query:{...req.query,tab:'library'}},res,'Допустимы только PNG, JPG, WEBP и GIF до 5 МБ.',true);
    const fileName=crypto.randomBytes(24).toString('hex')+'.'+type.ext;
    const fullPath=path.join(uploadsDir,fileName);
    fs.writeFileSync(fullPath,req.file.buffer,{flag:'wx',mode:0o600});
    try{
      db.prepare('INSERT INTO game_image_library(game_id,name,file_name) VALUES(?,?,?)').run(id,name,fileName);
    }catch(e){fs.unlinkSync(fullPath);throw e;}
    res.redirect(sectionUrl(id,'library'));
  });
  app.post('/admin/games/:id/library/:imageId/delete',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),imageId=Number(req.params.imageId);
    if(!id||!gameById(id)||!Number.isSafeInteger(imageId))return res.sendStatus(404);
    const row=ownedLibraryImage(id,imageId);
    if(!row||!row.file_name)return res.sendStatus(404);
    const inUse=db.prepare('SELECT 1 FROM game_symbol_images WHERE library_image_id=?').get(imageId);
    if(inUse)return show({...req,query:{...req.query,tab:'library'}},res,'Изображение используется символом. Сначала выберите для него другую картинку.',true);
    db.prepare('DELETE FROM game_image_library WHERE game_id=? AND id=?').run(id,imageId);
    try{fs.unlinkSync(path.join(uploadsDir,row.file_name));}catch(e){console.warn('Library image cleanup:',e.code);}
    res.redirect(sectionUrl(id,'library'));
  });
  app.post('/admin/games/:id/symbols/:symbolId/image',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),symbolId=Number(req.params.symbolId),imageId=Number(req.body.image_id);
    if(!id||!gameById(id)||!assertOwnSymbol(id,symbolId)||!Number.isSafeInteger(imageId)||!ownedLibraryImage(id,imageId))
      return res.sendStatus(404);
    db.prepare('INSERT INTO game_symbol_images(symbol_id,library_image_id) VALUES(?,?) ON CONFLICT(symbol_id) DO UPDATE SET library_image_id=excluded.library_image_id').run(symbolId,imageId);
    res.redirect(sectionUrl(id,'symbols'));
  });
  app.get('/game-library/:id/:imageId',guarded,(req,res)=>{
    const id=gameId(req),imageId=Number(req.params.imageId);
    if(!id||!Number.isSafeInteger(imageId)||!gameById(id))return res.sendStatus(404);
    const image=ownedLibraryImage(id,imageId);
    if(!image)return res.sendStatus(404);
    if(image.builtin_path)return res.redirect(image.builtin_path);
    if(!/^[a-f0-9]{48}\.(png|jpg|webp|gif)$/.test(image.file_name||''))return res.sendStatus(404);
    const type={png:'image/png',jpg:'image/jpeg',webp:'image/webp',gif:'image/gif'}[path.extname(image.file_name).slice(1)];
    res.set('Content-Type',type);
    res.set('X-Content-Type-Options','nosniff');
    res.sendFile(path.join(uploadsDir,image.file_name),err=>{if(err&&!res.headersSent)res.sendStatus(404);});
  });
  app.post('/admin/games/:id/symbols/:symbolId/payouts',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),symbolId=Number(req.params.symbolId);
    if(!id||!gameById(id)||!assertOwnSymbol(id,symbolId))return res.sendStatus(404);
    const prices=[];
    for(let n=3;n<=20;n++){
      const raw=req.body['p_'+n];
      if(typeof raw!=='string'||!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/.test(raw)||Number(raw)>1000)
        return show({...req,query:{...req.query,tab:'symbols'}},res,'Коэффициент должен быть от 0 до 1000, с точностью до трёх знаков после запятой.',true);
      prices.push([n,Math.round(Number(raw)*1000)]);
    }
    const put=db.prepare('INSERT INTO symbol_payout_multipliers(symbol_id,matches,coefficient_milli) VALUES(?,?,?) ON CONFLICT(symbol_id,matches) DO UPDATE SET coefficient_milli=excluded.coefficient_milli');
    db.transaction(()=>{for(const [count,price] of prices)put.run(symbolId,count,price);})();
    res.redirect(sectionUrl(id,'symbols'));
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
    res.redirect(sectionUrl(id,'symbols'));
  });
  app.post('/admin/games/:id/assets/:key',adminOnly,upload.single('asset'),postGuard,(req,res)=>{
    const id=gameId(req),key=req.params.key,meta=id?dynamicAsset(id,key):null;
    if(!id||!gameById(id)||!meta)return res.sendStatus(404);
    if(!req.file||!req.file.buffer?.length)return show({...req,query:{...req.query,tab:assetTab(key)}},res,'Выберите файл для загрузки.',true);
    const type=fileType(req.file.buffer);
    if(!type||type.kind!==meta.kind)return show({...req,query:{...req.query,tab:assetTab(key)}},res,'Неподдерживаемый формат файла.',true);
    if(meta.kind==='image'&&req.file.size>5*1024*1024)return show({...req,query:{...req.query,tab:assetTab(key)}},res,'Изображение должно быть не больше 5 МБ.',true);
    const name=crypto.randomBytes(24).toString('hex')+'.'+type.ext;
    const fullPath=path.join(uploadsDir,name);
    fs.writeFileSync(fullPath,req.file.buffer,{flag:'wx',mode:0o600});
    try {
      const previous=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,key);
      db.prepare('INSERT INTO game_assets(game_id,asset_key,file_name,media_type) VALUES(?,?,?,?) ON CONFLICT(game_id,asset_key) DO UPDATE SET file_name=excluded.file_name,media_type=excluded.media_type').run(id,key,name,type.type);
      if(previous)try{fs.unlinkSync(path.join(uploadsDir,previous.file_name));}catch(e){console.warn('Old game asset cleanup:',e.code);}
    }catch(e){try{fs.unlinkSync(fullPath);}catch{}throw e;}
    res.redirect(sectionUrl(id,assetTab(key))+'&uploaded=1');
  });
  app.post('/admin/games/:id/assets/:key/delete',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),key=req.params.key;
    if(!id||!gameById(id)||!dynamicAsset(id,key))return res.sendStatus(404);
    const previous=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,key);
    db.prepare('DELETE FROM game_assets WHERE game_id=? AND asset_key=?').run(id,key);
    if(previous)try{fs.unlinkSync(path.join(uploadsDir,previous.file_name));}catch(e){console.warn('Asset removal:',e.code);}
    res.redirect(sectionUrl(id,assetTab(key))+'&deleted=1');
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