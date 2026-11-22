const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { gameLayout } = require('./game-layout');
const { EGYPT_LINES } = require('./egypt-bonus');

const uploadsDir=path.join(__dirname,'data','game-uploads');
fs.mkdirSync(uploadsDir,{recursive:true,mode:0o700});

const assetTypes={
  background:{label:'Фон игрового окна',kind:'image'},
  field_background:{label:'Общий фон поля с барабанами',kind:'image'},
  cells_background:{label:'Общий фон всех ячеек с символами',kind:'image'},
  logo:{label:'Логотип игры',kind:'image'},
  bonus_frame:{label:'Демон, обхватывающий игровое поле (только в бонусе)',kind:'image'},
  reels_background:{label:'Общий фон игрового поля',kind:'image'},
  bet_panel:{label:'Фон панели ставок',kind:'image'},
  win_panel:{label:'Фон панели выигрыша',kind:'image'},
  music:{label:'Фоновая музыка (обычная игра)',kind:'audio'},
  bonus_music:{label:'Музыка бонусной игры (только «Дорога в АД»)',kind:'audio'},
  spin_sound:{label:'Звук вращения барабанов',kind:'audio'},
  win_sound:{label:'Звук выигрыша',kind:'audio'},
  big_win_sound:{label:'Звук крупного выигрыша',kind:'audio'},
  mega_win_sound:{label:'Звук очень крупного выигрыша',kind:'audio'},
  bonus_sound:{label:'Фанфары запуска бонусной игры',kind:'audio'},
};
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
function installGameAdmin(app,{db,gameById,getGameSettings,getGameAssets,getSymbols,getPayouts,getLibraryImages,getSymbolImageLinks,getGameBackgroundImages,getScatterSettings,adminOnly,guarded,postGuard,sendPage,h,csrfInput}) {
  // Display labels are optional per-game overrides; functional route keys stay fixed.
  db.exec(`CREATE TABLE IF NOT EXISTS game_admin_menu_labels (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    tab_key TEXT NOT NULL,
    label TEXT NOT NULL,
    PRIMARY KEY(game_id,tab_key)
  )`);
  // Built-in images cannot be removed from the Git repository at runtime.
  // Remember which ones an administrator deleted/replaced so seeders cannot show them again.
  db.exec(`CREATE TABLE IF NOT EXISTS game_hidden_builtin_images (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    builtin_path TEXT NOT NULL,
    PRIMARY KEY(game_id,builtin_path)
  )`);
  const hideBuiltIn=db.prepare('INSERT OR IGNORE INTO game_hidden_builtin_images(game_id,builtin_path) VALUES(?,?)');
  const menuGroups=[
    {key:'appearance',label:'Управление фонами',items:['background','reels','cells','panels','library']},
    {key:'sounds',label:'Управление звуками',items:['audio']},
    {key:'gameplay',label:'Настройки игры',items:['symbols','frequency','scatter']},
    {key:'general',label:'Общие настройки',items:['name','menu-labels']}
  ];
  const defaultMenuLabel='Названия кнопок';
  const allowedMenuKeys=new Set([...menuGroups.map(group=>group.key),...menuGroups.flatMap(group=>group.items)]);
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
  function isBackgroundAsset(key) {
    return !!assetTypes[key] && assetTypes[key].kind==='image';
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
    return db.prepare(`SELECT l.id,l.name,l.builtin_path,l.file_name FROM game_image_library l
      WHERE l.game_id=? AND l.id=? AND NOT EXISTS (
        SELECT 1 FROM game_hidden_builtin_images h
        WHERE h.game_id=l.game_id AND h.builtin_path=l.builtin_path)`)
      .get(gameId,imageId);
  }
  function assetTab(key){
    if(key==='background'||key==='logo'||key==='bonus_frame')return 'background';
    if(key==='reels_background'||/^reel_[1-5]$/.test(key))return 'reels';
    if(key==='field_background'||key==='cells_background'||/^cell_(?:[1-9]|1\d|20)$/.test(key))return 'cells';
    if(key==='bet_panel'||key==='win_panel')return 'panels';
    if(['music','bonus_music','spin_sound','win_sound','big_win_sound','mega_win_sound','bonus_sound'].includes(key))return 'audio';
    if(/^symbol_\d+$/.test(key))return 'symbols';
    return 'overview';
  }
  function sectionUrl(id,tab){
    return '/admin/games/'+id+'?tab='+tab;
  }
  function show(req,res,message='',error=false,forcedTab=null) {
    const id=gameId(req);
    const game=id?gameById(id):null;
    if(!game)return sendPage(res,'Не найдено','<section class="panel"><h1>Игра не найдена</h1><a href="/admin">Вернуться</a></section>',req,404);
    const layout=gameLayout(game);
    const settings=getGameSettings(id)||{win_frequency:25};
    const scatter=['slot-classic','golden-seven'].includes(game.slug)?getScatterSettings(id):null;
    const assets=new Map(getGameAssets(id).map(asset=>[asset.asset_key,asset]));
    const assignedBackgrounds=new Map(getGameBackgroundImages(id).map(item=>[item.asset_key,item]));
    const libraryImages=getLibraryImages(id);
    const csrf=csrfInput(req.session.csrf_token);
    const renderAssetRow=([key,meta])=>{
      const value=assets.get(key);
      const assigned=assignedBackgrounds.get(key);
      const src=assigned ? (assigned.builtin_path||'/game-library/'+id+'/'+assigned.library_image_id) : '/game-assets/'+id+'/'+key;
      const preview=(assigned||value) ? (meta.kind==='image'
        ? '<img class="asset-preview" src="'+h(src)+'" alt="'+h(meta.label)+'">'
        : '<audio controls preload="none" src="'+src+'"></audio>') : '<span class="asset-empty">Файл не выбран</span>';
      const selector=isBackgroundAsset(key)?
        '<form method="post" class="library-background-picker" action="/admin/games/'+id+'/backgrounds/'+key+'">'+csrf+
        '<label>Выбрать из папки изображений<select name="image_id" required><option value="">Выберите картинку</option>'+
        libraryImages.map(image=>'<option value="'+image.id+'"'+(assigned?.library_image_id===image.id?' selected':'')+'>'+h(image.name)+'</option>').join('')+
        '</select></label><button class="primary" type="submit">'+(key==='logo'?'Применить логотип':'Применить фон')+'</button></form>':'';
      return '<div class="asset-setting"><div class="asset-detail"><strong>'+h(meta.label)+'</strong>'+preview+
        (assigned?'<small>Применено из папки изображений: '+h(assigned.name)+'</small>':
         value?'<small>Применён загруженный файл</small>':'<small>Фон пока не задан</small>')+
        '</div><div class="asset-actions">'+selector+
        '<form method="post" action="/admin/games/'+id+'/assets/'+key+'" enctype="multipart/form-data">'+csrf+
        '<label class="asset-upload-label">Или загрузить новый файл<input type="file" name="asset" accept="'+(meta.kind==='image'?'image/png,image/jpeg,image/webp,image/gif':'audio/mpeg,audio/ogg,audio/wav')+'" required></label>'+
        '<button class="primary" type="submit">Загрузить и применить</button></form>'+
        (assigned||value?'<form method="post" action="/admin/games/'+id+'/assets/'+key+'/delete">'+csrf+'<button type="submit">Убрать</button></form>':'')+
        '</div></div>';
    };
    const rowsFor=keys=>keys.map(key=>renderAssetRow([key,assetTypes[key]])).join('');
    const symbols=getSymbols(id);
    const payouts=getPayouts(id);
    const unitPrices=new Map(payouts.prices.map(row=>[row.symbol_id,row.percent_hundredths]));
    const egyptLineMultipliers=game.slug==='golden-seven'
      ?new Map(db.prepare(`SELECT m.symbol_id,m.matches,m.multiplier_milli
          FROM egypt_line_multipliers m JOIN game_symbols s ON s.id=m.symbol_id
          WHERE s.game_id=?`).all(id)
          .map(row=>[row.symbol_id+':'+row.matches,row.multiplier_milli]))
      :new Map();
    const multipliersBySymbol=new Map();
    for(const row of payouts.multipliers){
      if(!multipliersBySymbol.has(row.symbol_id))multipliersBySymbol.set(row.symbol_id,new Map());
      multipliersBySymbol.get(row.symbol_id).set(row.reel_count,row.multiplier_milli);
    }
    const linked=new Map(getSymbolImageLinks(id).map(item=>[item.symbol_id,item.image_id]));
    const libraryCards=libraryImages.map(image=>{
      const src=libraryUrl(id,image);
      const linkedCount=Array.from(linked.values()).filter(imageId=>imageId===image.id).length+
        Array.from(assignedBackgrounds.values()).filter(item=>item.library_image_id===image.id).length;
      const quickAssign=([key,label])=>'<form method="post" action="/admin/games/'+id+'/backgrounds/'+key+'">'+csrf+
        '<input type="hidden" name="image_id" value="'+image.id+'">'+
        '<button type="submit"'+(assignedBackgrounds.get(key)?.library_image_id===image.id?' disabled':'')+'>'+label+
        (assignedBackgrounds.get(key)?.library_image_id===image.id?' ✓':'')+'</button></form>';
      return '<div class="library-image-card"><img src="'+h(src)+'" alt="'+h(image.name)+'" loading="lazy">'+
        '<strong>'+h(image.name)+'</strong>'+
        '<div class="library-quick-actions">'+
        quickAssign(['background','Фон игры'])+quickAssign(['reels_background','Фон игрового поля'])+quickAssign(['cells_background','Фон барабанов'])+
        '</div>'+
        '<form method="post" action="/admin/games/'+id+'/library/'+image.id+'/replace" enctype="multipart/form-data">'+csrf+
          '<label class="asset-upload-label">Заменить картинку<input type="file" name="asset" accept="image/png,image/jpeg,image/webp,image/gif" required></label>'+
          '<button type="submit">Заменить</button></form>'+
        '<form method="post" action="/admin/games/'+id+'/library/'+image.id+'/delete">'+csrf+
          '<button type="submit" class="danger-action" title="Удаление снимет картинку с '+linkedCount+' назначений">Удалить</button></form>'+
        '</div>';
    }).join('');
    const egyptBonusRules=new Map(game.slug==='golden-seven'
      ?db.prepare(`SELECT s.id AS symbol_id,COALESCE(r.min_reels,3) AS min_reels,
          r.line_percent_hundredths
        FROM game_symbols s LEFT JOIN egypt_symbol_bonus_rules r ON r.symbol_id=s.id
        WHERE s.game_id=?`).all(id).map(row=>[row.symbol_id,row]):[]);
    const symbolItems=symbols.map(symbol=>{
      const isScatter=scatter&&symbol.id===scatter.symbolId;
      const unitPrice=((unitPrices.get(symbol.id)||0)/100).toFixed(2);
      const multipliers=multipliersBySymbol.get(symbol.id)||new Map();
      const reelInputs=Array.from({length:game.slug==='golden-seven'?5:layout.reels-2},(_,i)=>{
        const reel=i+(game.slug==='golden-seven'?2:3);
        const ratio=game.slug==='golden-seven'
          ?(egyptLineMultipliers.get(symbol.id+':'+reel)??multipliers.get(reel)??1000)
          :(multipliers.get(reel)??1000);
        const label=game.slug==='golden-seven'
          ?'На линии '+reel+' символов подряд, ×'
          :'Цепочка до барабана №'+reel+', ×';
        return '<label class="payout-input">'+label+
          '<input type="number" min="0" max="1000" step="0.001" name="r_'+reel+'" value="'+(ratio/1000).toFixed(3)+'" required></label>';
      }).join('');
      const selected=linked.get(symbol.id)||0;
      const options=libraryImages.map(image=>'<option value="'+image.id+'"'+(image.id===selected?' selected':'')+'>'+h(image.name)+'</option>').join('');
      const chosen=libraryImages.find(image=>image.id===selected);
      const preview=chosen?'<img class="asset-preview" src="'+h(libraryUrl(id,chosen))+'" alt="'+h(chosen.name)+'">':'';
      return '<details class="symbol-admin-card"><summary class="symbol-admin-summary"><span>'+h(symbol.name)+' <small>ID '+symbol.id+'</small></span><span class="symbol-expand-hint">Настроить <span aria-hidden="true">▾</span></span></summary>'+
        '<div class="symbol-library-picker">'+preview+
        '<form method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/image">'+csrf+
        '<label>Картинка из папки игры<select name="image_id" required><option value="">Выберите изображение</option>'+options+'</select></label>'+
        '<button class="primary" type="submit">Применить картинку</button></form></div>'+
        (!chosen&&assets.has('symbol_'+symbol.id)?'<p class="hint">Пока используется ранее загруженная картинка символа. Выберите изображение из папки для замены.</p>':'')+
        (game.slug==='golden-seven'&&!isScatter?'<form method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/egypt-min-reels">'+csrf+
        '<label>Бонус Египта: выбранный символ играет от <select name="min_reels">'+
        '<option value="2"'+(egyptBonusRules.get(symbol.id)?.min_reels===2?' selected':'')+'>2 барабанов</option>'+
        '<option value="3"'+(egyptBonusRules.get(symbol.id)?.min_reels!==2?' selected':'')+'>3 барабанов</option>'+
        '</select></label>'+
        '<label>Выплата ЗА ОДНУ бонусную линию, % от ставки'+
        '<input type="number" name="line_percent" min="0" max="10000" step="0.01" '+
        'value="'+((egyptBonusRules.get(symbol.id)?.line_percent_hundredths??unitPrices.get(symbol.id)??0)/100).toFixed(2)+'" required></label>'+
        '<p class="hint">10 линий. Ставка 100, выплата 10% и коэффициент ×2 за три барабана = 20 очков за линию, всего 200. Коэффициенты для 2–6 символов настраиваются ниже в этом же символе.</p>'+
        '<button class="primary" type="submit">Сохранить бонусные выплаты</button></form>':'')+
        (isScatter?'<p class="hint"><strong>SCATTER</strong> запускает бесплатные вращения, но не оплачивается как обычная цепочка. Вероятности и лимиты задаются в разделе «Бонусная игра».</p>':'<form class="symbol-prices-form" method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/payouts">'+csrf+
        '<p class="hint">'+(game.slug==='golden-seven'?'Египет: вся игра рассчитывается по 10 линиям. В обычной игре совпадения считаются подряд с первого барабана на каждой линии. В бонусе выбранный символ расширяется и платит по тем же десяти линиям, даже если барабаны не соседние. Для 2, 3, 4, 5 и 6 совпадений задаётся отдельный коэффициент. Минимум 2 или 3 устанавливается выше.':'Цена одного символа — процент от ставки. Выигрыш начинается, если символ есть на каждом из барабанов 1, 2 и 3. Считаются все его копии в непрерывной цепочке слева направо. На результат дополнительно умножается только коэффициент последнего барабана цепочки, не все коэффициенты сразу.')+'</p>'+
        '<label>'+(game.slug==='golden-seven'?'Цена одной выигрышной линии, % от ставки':'Цена одного символа, % от ставки')+
        '<input type="number" min="0" max="10000" step="0.01" name="unit_percent" value="'+unitPrice+'" required></label>'+
        '<p class="hint">'+(game.slug==='golden-seven'?'Например, ставка 100, цена линии 10%, 3 символа на линии, ×2 = 20 очков за эту линию. По 10 линиям выплаты суммируются. Для двух символов установленный минимум должен быть 2; ×0 отключает соответствующую длину. Бонус имеет отдельную цену линии, но использует эти же коэффициенты.':'Например, ставка 20, цена символа 10%, 6 символов на первых трёх барабанах, ×3 = 20 × 10% × 6 × 3 = 36 очков. При цепочке до барабана №4 используется только его множитель. ×0 отключает выплату для этой длины цепочки.')+'</p>'+
        '<div class="payout-grid">'+reelInputs+'</div><button class="primary" type="submit">Сохранить цену и множители</button></form>')+
        (isScatter?'':'<form method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/delete">'+csrf+
        '<button type="submit" class="danger-action">Удалить символ</button></form>')+'</details>';
    }).join('');
    const tabs=[
      ['name','Название игры','Название в каталоге и админке','image'],
      ['background','Изменение фона','Фон игрового окна и логотип','image'],
      ['reels','Фон игрового поля','Общий фон за пятью столбцами','columns'],
      ['cells','Фон барабанов','Фон каждой ячейки под символом','grid'],
      ['panels','Панели ставок и выигрыша','Оформление нижних панелей','wallet'],
      ['audio','Музыка и звуки','Музыка, вращение и выигрыш','music'],
      ['library','Папка изображений','Загрузка и хранение картинок','folder'],
      ['symbols','Символы и коэффициенты','Символы и таблица выплат','star'],
      ['frequency','Частота и размеры выигрыша','Вероятность и пороги крупного выигрыша','percent']
      ,...(scatter?[['scatter','Бонусная игра SCATTER','Шанс и лимит Scatter на каждом барабане','star']]:[]),
      ['menu-labels',defaultMenuLabel,'Переименование разделов и кнопок','image']
    ];
    const validTabs=new Set(tabs.map(tab=>tab[0]));
    const activeTab=forcedTab&&validTabs.has(forcedTab)?forcedTab:(typeof req.query.tab==='string'&&validTabs.has(req.query.tab)?req.query.tab:'overview');
    const savedLabels=new Map(db.prepare('SELECT tab_key,label FROM game_admin_menu_labels WHERE game_id=?').all(id).map(row=>[row.tab_key,row.label]));
    const defaultTabs=new Map(tabs.map(tab=>[tab[0],tab]));
    const menuLabel=(key,defaultLabel)=>savedLabels.get(key)||defaultLabel;
    const tabButtons=menuGroups.map(group=>{
      const items=group.items.filter(key=>defaultTabs.has(key));
      const selected=items.includes(activeTab);
      const links=items.map(key=>{
        const [_,title,description,icon]=defaultTabs.get(key);
        return '<a class="game-admin-submenu-link'+(activeTab===key?' is-active':'')+'" href="/admin/games/'+id+'?tab='+key+'"'+
          (activeTab===key?' aria-current="page"':'')+'>'+
          '<span>'+h(menuLabel(key,title))+'</span><small>'+h(description)+'</small></a>';
      }).join('');
      return '<details class="game-admin-menu-group"'+(selected?' open':'')+'><summary>'+
        '<strong>'+h(menuLabel(group.key,group.label))+'</strong><span aria-hidden="true">▾</span></summary>'+
        '<div class="game-admin-submenu">'+links+'</div></details>';
    }).join('');
    const panelStart=(title)=>'<section class="panel game-admin-selected" id="'+activeTab+'"><h2>'+title+'</h2>';
    let panel='';
    if(activeTab==='menu-labels'){
      const allLabels=[...menuGroups.map(group=>[group.key,group.label]),
        ...tabs.filter(tab=>tab[0]!=='menu-labels').map(tab=>[tab[0],tab[1]]),
        ['menu-labels',defaultMenuLabel]];
      const fields=allLabels.map(([key,defaultLabel])=>
        '<label class="game-admin-rename-label">'+h(defaultLabel)+
        '<input type="text" name="'+key+'" maxlength="60" value="'+h(menuLabel(key,defaultLabel))+'" required></label>').join('');
      panel=panelStart('Переименование кнопок')+
        '<p class="hint">Названия сохраняются отдельно для этой игры. Изменение названия не затрагивает сами настройки и ссылки.</p>'+
        '<form method="post" action="/admin/games/'+id+'/menu-labels">'+csrf+
        '<div class="game-admin-rename-grid">'+fields+'</div>'+
        '<button class="primary" type="submit">Сохранить названия</button></form></section>';
    }
    if(activeTab==='name')panel=panelStart('Название игры')+
      '<p class="hint">Название отображается в каталоге игр и на карточке админки. Ссылка на игру и настройки при переименовании сохраняются.</p>'+
      '<form method="post" class="game-title-form" action="/admin/games/'+id+'/title">'+csrf+
      '<label for="game_title">Название игры<input id="game_title" type="text" name="title" minlength="1" maxlength="80" value="'+h(game.title)+'" required></label>'+
      '<button class="primary" type="submit">Сохранить название</button></form></section>';
    if(activeTab==='background')panel=panelStart('Изменение фона')+
      '<p class="hint">Изменяйте фон, логотип и прозрачную картинку демона, обхватывающего поле. Демон показывается только во время бонусной игры первой игры; используйте PNG с прозрачным центром.</p><div class="asset-settings-grid">'+
      rowsFor(game.slug==='slot-classic'?['background','logo','bonus_frame']:['background','logo'])+'</div></section>';
    if(activeTab==='reels')panel=panelStart('Фон игрового поля')+
      '<p class="hint">Одна картинка заполняет всё игровое поле за пятью барабанами. Фон ячеек с символами настраивается отдельно в разделе «Фон барабанов».</p>'+
      '<div class="asset-settings-grid">'+rowsFor(['reels_background'])+'</div></section>';
    if(activeTab==='cells')panel=panelStart('Фон барабанов')+
      '<p class="hint">Одна картинка повторяется внутри каждой из ' + (layout.reels*layout.rows) + ' ячеек, непосредственно за вращающимися символами. Выберите фон из папки или загрузите новый.</p>'+
      '<div class="asset-settings-grid">'+rowsFor(['cells_background'])+'</div></section>';
    if(activeTab==='panels')panel=panelStart('Панели ставок и выигрыша')+
      '<p class="hint">Оформление областей баланса, ставки и выигрыша.</p><div class="asset-settings-grid">'+
      rowsFor(['bet_panel','win_panel'])+'</div></section>';
    if(activeTab==='audio')panel=panelStart('Музыка и звуки')+
      '<p class="hint">Загрузите музыку, звуки вращения, выигрыша и фанфары SCATTER. Для Первой игры музыка и фанфары также доступны по умолчанию без загрузки файлов. Форматы MP3, OGG, WAV до 12 МБ. Звуки зависят от коэффициента итогового выигрыша.</p>'+
      '<div class="asset-settings-grid">'+rowsFor(game.slug==='slot-classic'?['music','bonus_music','spin_sound','win_sound','big_win_sound','mega_win_sound','bonus_sound']:['music','spin_sound','win_sound','big_win_sound','mega_win_sound','bonus_sound'])+'</div></section>';
    if(activeTab==='frequency')panel=panelStart('Частота и размеры выигрышей')+
      '<p class="hint">Целевой процент выигрышных вращений от 0 до 100. Это не RTP и не доля возвращаемых ставок. При отсутствии положительных коэффициентов выигрышей не будет.</p>'+
      '<form class="win-setting-form" method="post" action="/admin/games/'+id+'/settings?tab=frequency">'+csrf+
      '<label for="win_frequency">Частота выигрыша, %</label><div class="win-setting-controls">'+
      '<input id="win_frequency" type="number" min="0" max="100" step="1" name="win_frequency" value="'+h(settings.win_frequency)+'" required></div>'+
      '<div class="win-threshold-grid">'+
      '<label for="big_win_multiplier">Крупный выигрыш (× от ставки)<input id="big_win_multiplier" type="number" min="1" max="1000" step="0.001" name="big_win_multiplier" value="'+(settings.big_win_multiplier_milli/1000).toFixed(3)+'" required></label>'+
      '<label for="mega_win_multiplier">Очень крупный выигрыш (× от ставки)<input id="mega_win_multiplier" type="number" min="1" max="1000" step="0.001" name="mega_win_multiplier" value="'+(settings.mega_win_multiplier_milli/1000).toFixed(3)+'" required></label></div>'+
      '<p class="hint">Например: при ставке 20 пороги ×5 и ×15 означают 100 и 300 очков. Очень крупный должен быть больше крупного. Считается общий выигрыш одного вращения, а не отдельного символа.</p>'+
      '<button class="primary" type="submit">Сохранить настройки</button></form></section>';
    if(activeTab==='library')panel=panelStart('Папка изображений игры')+
      '<p class="hint">Картинки сохраняются в библиотеке именно этой игры. После загрузки их можно выбирать для символов. PNG, JPG, WEBP, GIF до 5 МБ.</p>'+
      '<form class="library-upload" method="post" action="/admin/games/'+id+'/library?tab=library" enctype="multipart/form-data">'+csrf+
      '<label>Название картинки<input name="name" maxlength="80" required placeholder="Например: Череп"></label>'+
      '<label>Файл<input type="file" name="asset" accept="image/png,image/jpeg,image/webp,image/gif" required></label>'+
      '<button class="primary" type="submit">Добавить в папку</button></form>'+
      '<div class="library-images">'+libraryCards+'</div></section>';
    const egyptLinePreview=game.slug==='golden-seven'
      ?'<div class="egypt-lines-gallery">'+EGYPT_LINES.map((rows,index)=>{
        const points=rows.map((row,col)=>(30+col*60)+','+(25+row*45)).join(' ');
        return '<div class="egypt-line-card"><strong>Линия '+(index+1)+'</strong>'+
          '<svg viewBox="0 0 360 185" role="img" aria-label="Линия '+(index+1)+'">'+
          Array.from({length:6},(_,col)=>'<line x1="'+(30+col*60)+'" y1="8" x2="'+(30+col*60)+'" y2="172" stroke="#8d7450" stroke-width="1"/>').join('')+
          '<polyline points="'+points+'" fill="none" stroke="#ffd775" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'+
          rows.map((row,col)=>'<circle cx="'+(30+col*60)+'" cy="'+(25+row*45)+'" r="6" fill="#fff2ad"/>').join('')+
          '</svg></div>';
      }).join('')+'</div>':'';
    if(activeTab==='scatter'&&scatter){
      const ruleByReel=new Map(scatter.rules.map(rule=>[rule.reel_index,rule]));
      const inputs=Array.from({length:layout.reels},(_,i)=>{
        const reel=i+1,rule=ruleByReel.get(reel)||{chance_percent:0,max_symbols:0};
        const countWeights=Array.from({length:layout.rows},(_,index)=>{
          const count=index+1;
          return '<label>Ровно '+count+' Scatter — вес<input type="number" min="0" max="100" step="1" name="weight_'+reel+'_'+count+'" value="'+(rule['weight_'+count]??0)+'" required></label>';
        }).join('');
        if(game.slug==='golden-seven')
          return '<div class="scatter-rule"><strong>Барабан №'+reel+'</strong>'+
            '<label>Шанс одного SCATTER, %<input type="number" min="0" max="100" step="1" name="chance_'+reel+'" value="'+rule.chance_percent+'" required></label>'+
            '<input type="hidden" name="max_'+reel+'" value="1">'+
            Array.from({length:4},(_,n)=>'<input type="hidden" name="weight_'+reel+'_'+(n+1)+'" value="'+(n===0?100:0)+'">').join('')+
            '<small>На этом барабане максимум один SCATTER</small></div>';
        return '<div class="scatter-rule"><strong>Барабан №'+reel+'</strong>'+
          '<label>Шанс появления Scatter, %<input type="number" min="0" max="100" step="1" name="chance_'+reel+'" value="'+rule.chance_percent+'" required></label>'+
          '<label>Максимум Scatter на барабане<input type="number" min="0" max="'+layout.rows+'" step="1" name="max_'+reel+'" value="'+rule.max_symbols+'" required></label>'+
          '<div class="scatter-count-weights">'+countWeights+'</div></div>';
      }).join('');
      panel=panelStart('Настройки бонусной игры SCATTER')+
        '<p class="hint">'+(game.slug==='golden-seven'
          ?'Задайте шанс SCATTER отдельно для каждого из шести барабанов. На одном барабане может быть только один SCATTER.'
          :'Сначала срабатывает общий шанс барабана, затем выбирается количество Scatter по указанным весам. Например, веса 30, 20 и 70 для одного, двух и трёх Scatter означают пропорции 25%, 16,7% и 58,3% среди появлений. Сумма весов может быть любой. Веса количества выше указанного максимума игнорируются.')+'</p>'+
        '<p class="hint">'+(game.slug==='golden-seven'?'Египет: 3 SCATTER — 10 вращений, 4 — 15, 5 — 20, 6 — 25. Максимум один SCATTER на барабан. Перед бонусом случайно выбирается символ. Он расширяется на весь барабан, где выпал, и выигрывает на 10 линиях при наличии на 2 или 3 любых барабанах (по настройке символа). Множителя первой игры здесь нет.':'3 Scatter — 10 бесплатных вращений; 4 — 15; 5 и более — 20. Бонусный множитель начинается с ×2 и увеличивается на +1 после выигрышного бесплатного вращения. Выигрыш накапливается отдельно и зачисляется только после завершения бонуса.')+'</p>'+
        (game.slug==='golden-seven'?'<h3>Десять линий бонусной игры</h3>'+egyptLinePreview+
          '<p class="hint">Выбранный символ расширяется на каждый барабан, где выпал, поэтому любая из этих 10 линий учитывает все такие барабаны, даже несоседние.</p>':'')+
        '<form method="post" action="/admin/games/'+id+'/scatter" class="scatter-settings-form">'+csrf+
        '<div class="scatter-rule-grid">'+inputs+'</div><button class="primary" type="submit">Сохранить настройки Scatter</button></form></section>';
    }
    if(activeTab==='symbols')panel=panelStart('Символы и коэффициенты')+
      '<p class="hint">Для каждого символа установите цену одной копии в процентах от ставки и множитель по длине непрерывной цепочки барабанов. Выплата начинается с трёх последовательных барабанов слева направо.</p>'+
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
  app.post('/admin/games/:id/menu-labels',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),game=id?gameById(id):null;
    if(!game)return res.sendStatus(404);
    const changes=[];
    for(const key of allowedMenuKeys){
      const label=req.body?.[key];
      if(typeof label!=='string'||!label.trim()||label.trim().length>60)
        return show(req,res,'Каждое название должно содержать от 1 до 60 символов.',true,'menu-labels');
      changes.push([key,label.trim()]);
    }
    const upsert=db.prepare(`INSERT INTO game_admin_menu_labels(game_id,tab_key,label)
      VALUES(?,?,?) ON CONFLICT(game_id,tab_key) DO UPDATE SET label=excluded.label`);
    db.transaction(()=>{for(const [key,label] of changes)upsert.run(id,key,label);})();
    res.redirect(sectionUrl(id,'menu-labels')+'&saved=1');
  });
  app.get('/admin/games/:id',adminOnly,(req,res)=>show(req,res));
  app.post('/admin/games/:id/scatter',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),game=id?gameById(id):null;
    if(!game||!['slot-classic','golden-seven'].includes(game.slug)||!getScatterSettings(id))return res.sendStatus(404);
    const changes=[];
    for(let reel=1;reel<=gameLayout(game).reels;reel++){
      const chance=req.body?.['chance_'+reel],max=req.body?.['max_'+reel];
      const weights=Array.from({length:4},(_,index)=>req.body?.['weight_'+reel+'_'+(index+1)]);
      const validNumber=value=>typeof value==='string'&&/^(?:100|[1-9]?[0-9])$/.test(value);
      if(!validNumber(chance)||typeof max!=='string'||!/^[0-4]$/.test(max)||
         !weights.every(validNumber))
        return show(req,res,'Укажите для каждого барабана шанс 0–100, максимум 0–4 и веса количества 0–100.',true,'scatter');
      changes.push([Number(chance),Number(max),...weights.map(Number),id,reel]);
    }
    const update=db.prepare(`UPDATE game_scatter_reels SET
      chance_percent=?,max_symbols=?,weight_1=?,weight_2=?,weight_3=?,weight_4=?
      WHERE game_id=? AND reel_index=?`);
    if(game.slug==='golden-seven'){
      for(const row of changes){
        row[1]=1;row[2]=100;row[3]=0;row[4]=0;row[5]=0;
      }
    }
    db.transaction(()=>{for(const row of changes)update.run(...row);})();
    res.redirect(sectionUrl(id,'scatter')+'&saved=1');
  });
  app.post('/admin/games/:id/title',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req);
    if(!id||!gameById(id))return res.sendStatus(404);
    const raw=req.body?.title;
    const title=typeof raw==='string'?raw.trim():'';
    if(!title||title.length>80||/[\x00-\x1f\x7f]/.test(title))
      return show(req,res,'Название должно содержать от 1 до 80 символов без управляющих знаков.',true,'name');
    db.prepare('UPDATE games SET title=? WHERE id=?').run(title,id);
    res.redirect(sectionUrl(id,'name')+'&saved=1');
  });
  app.post('/admin/games/:id/settings',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req);
    if(!id||!gameById(id))return res.sendStatus(404);
    const value=req.body?.win_frequency;
    if(typeof value!=='string'||!/^(100|[1-9]?\d)$/.test(value))
      return show(req,res,'Частота выигрышей должна быть целым числом от 0 до 100.',true,'frequency');
    const toMilli=raw=>{
      if(typeof raw!=='string'||!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/.test(raw))return null;
      const number=Number(raw);
      if(!Number.isFinite(number)||number<1||number>1000)return null;
      return Math.round(number*1000);
    };
    const big=toMilli(req.body?.big_win_multiplier);
    const mega=toMilli(req.body?.mega_win_multiplier);
    if(big===null||mega===null||mega<=big)
      return show(req,res,'Коэффициенты: от ×1 до ×1000, максимум три знака после запятой. Очень крупный выигрыш должен быть больше крупного.',true,'frequency');
    db.prepare(`UPDATE game_settings SET win_frequency=?,big_win_multiplier_milli=?,mega_win_multiplier_milli=? WHERE game_id=?`)
      .run(Number(value),big,mega,id);
    res.redirect(sectionUrl(id,'frequency')+'&saved=1');
  });
  app.post('/admin/games/:id/symbols',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req);
    if(!id||!gameById(id))return res.sendStatus(404);
    const name=typeof req.body.name==='string'?req.body.name.trim():'';
    if(name.length<1||name.length>60)return show(req,res,'Имя символа должно содержать от 1 до 60 символов.',true,'symbols');
    if(getSymbols(id).length>=50)return show(req,res,'Лимит — 50 символов на игру.',true,'symbols');
    const position=db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM game_symbols WHERE game_id=?').get(id).n;
    db.prepare('INSERT INTO game_symbols(game_id,name,position) VALUES(?,?,?)').run(id,name,position);
    res.redirect(sectionUrl(id,'symbols'));
  });
  app.post('/admin/games/:id/symbols/:symbolId/egypt-min-reels',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),symbolId=Number(req.params.symbolId),game=id?gameById(id):null;
    if(!game||game.slug!=='golden-seven'||!assertOwnSymbol(id,symbolId))return res.sendStatus(404);
    if(getScatterSettings(id)?.symbolId===symbolId)return res.sendStatus(403);
    const minimum=Number(req.body?.min_reels);
    if(![2,3].includes(minimum))return show(req,res,'Укажите 2 или 3 барабана.',true,'symbols');
    const raw=req.body?.line_percent;
    if(typeof raw!=='string'||!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(raw)||Number(raw)>10000)
      return show(req,res,'Выплата за одну линию должна быть от 0 до 10000% с точностью до 0.01%.',true,'symbols');
    const linePercent=Math.round(Number(raw)*100);
    db.prepare(`INSERT INTO egypt_symbol_bonus_rules(symbol_id,min_reels,line_percent_hundredths) VALUES(?,?,?)
      ON CONFLICT(symbol_id) DO UPDATE SET min_reels=excluded.min_reels,
      line_percent_hundredths=excluded.line_percent_hundredths`).run(symbolId,minimum,linePercent);
    res.redirect(sectionUrl(id,'symbols')+'&saved=1');
  });
  app.post('/admin/games/:id/library',adminOnly,upload.single('asset'),postGuard,(req,res)=>{
    const id=gameId(req),name=typeof req.body.name==='string'?req.body.name.trim():'';
    if(!id||!gameById(id))return res.sendStatus(404);
    if(!name||name.length>80)return show(req,res,'Укажите название изображения до 80 символов.',true,'library');
    if(!req.file?.buffer?.length)return show(req,res,'Выберите изображение.',true,'library');
    const type=fileType(req.file.buffer);
    if(!type||type.kind!=='image'||req.file.size>5*1024*1024)
      return show(req,res,'Допустимы только PNG, JPG, WEBP и GIF до 5 МБ.',true,'library');
    const fileName=crypto.randomBytes(24).toString('hex')+'.'+type.ext;
    const fullPath=path.join(uploadsDir,fileName);
    fs.writeFileSync(fullPath,req.file.buffer,{flag:'wx',mode:0o600});
    try{
      db.prepare('INSERT INTO game_image_library(game_id,name,file_name) VALUES(?,?,?)').run(id,name,fileName);
    }catch(e){fs.unlinkSync(fullPath);throw e;}
    res.redirect(sectionUrl(id,'library'));
  });
  app.post('/admin/games/:id/library/:imageId/replace',adminOnly,upload.single('asset'),postGuard,(req,res)=>{
    const id=gameId(req),imageId=Number(req.params.imageId);
    if(!id||!gameById(id)||!Number.isSafeInteger(imageId)||imageId<=0)return res.sendStatus(404);
    const row=ownedLibraryImage(id,imageId);
    if(!row)return res.sendStatus(404);
    if(!req.file?.buffer?.length)return show(req,res,'Выберите изображение для замены.',true,'library');
    const type=fileType(req.file.buffer);
    if(!type||type.kind!=='image'||req.file.size>5*1024*1024)
      return show(req,res,'Допустимы только PNG, JPG, WEBP и GIF до 5 МБ.',true,'library');
    const name=crypto.randomBytes(24).toString('hex')+'.'+type.ext;
    fs.writeFileSync(path.join(uploadsDir,name),req.file.buffer,{flag:'wx',mode:0o600});
    try{
      db.transaction(()=>{
        if(row.builtin_path)hideBuiltIn.run(id,row.builtin_path);
        db.prepare('UPDATE game_image_library SET builtin_path=NULL,file_name=? WHERE id=? AND game_id=?')
          .run(name,imageId,id);
      })();
    }catch(e){try{fs.unlinkSync(path.join(uploadsDir,name));}catch{}throw e;}
    if(row.file_name)try{fs.unlinkSync(path.join(uploadsDir,row.file_name));}catch(e){console.warn('Replaced library image cleanup:',e.code);}
    res.redirect(sectionUrl(id,'library')+'&replaced=1');
  });
  app.post('/admin/games/:id/library/:imageId/delete',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),imageId=Number(req.params.imageId);
    if(!id||!gameById(id)||!Number.isSafeInteger(imageId)||imageId<=0)return res.sendStatus(404);
    const row=ownedLibraryImage(id,imageId);
    if(!row)return res.sendStatus(404);
    db.transaction(()=>{
      if(row.builtin_path)hideBuiltIn.run(id,row.builtin_path);
      db.prepare('DELETE FROM game_symbol_images WHERE library_image_id=?').run(imageId);
      db.prepare('DELETE FROM game_background_images WHERE game_id=? AND library_image_id=?').run(id,imageId);
      db.prepare('DELETE FROM game_image_library WHERE game_id=? AND id=?').run(id,imageId);
    })();
    if(row.file_name)try{fs.unlinkSync(path.join(uploadsDir,row.file_name));}catch(e){console.warn('Library image cleanup:',e.code);}
    res.redirect(sectionUrl(id,'library')+'&deleted=1');
  });
  app.post('/admin/games/:id/symbols/:symbolId/image',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),symbolId=Number(req.params.symbolId),imageId=Number(req.body.image_id);
    if(!id||!gameById(id)||!assertOwnSymbol(id,symbolId)||!Number.isSafeInteger(imageId)||!ownedLibraryImage(id,imageId))
      return res.sendStatus(404);
    const previous=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,'symbol_'+symbolId);
    db.transaction(()=>{
      db.prepare('INSERT INTO game_symbol_images(symbol_id,library_image_id) VALUES(?,?) ON CONFLICT(symbol_id) DO UPDATE SET library_image_id=excluded.library_image_id').run(symbolId,imageId);
      db.prepare('DELETE FROM game_assets WHERE game_id=? AND asset_key=?').run(id,'symbol_'+symbolId);
    })();
    if(previous)try{fs.unlinkSync(path.join(uploadsDir,previous.file_name));}catch(e){console.warn('Old symbol art cleanup:',e.code);}
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
    const game=gameById(id);
    if(!game||!assertOwnSymbol(id,symbolId))return res.sendStatus(404);
    if(getScatterSettings(id)?.symbolId===symbolId)return res.sendStatus(403);
    const percentage=req.body?.unit_percent;
    if(typeof percentage!=='string'||!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(percentage)||Number(percentage)>10000)
      return show(req,res,'Цена одного символа должна быть от 0 до 10000% с точностью до 0.01%.',true,'symbols');
    const unit=Math.round(Number(percentage)*100);
    const entries=[];
    for(let reel=game.slug==='golden-seven'?2:3;reel<=gameLayout(game).reels;reel++){
      const raw=req.body?.['r_'+reel];
      if(typeof raw!=='string'||!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/.test(raw)||Number(raw)>1000)
        return show(req,res,'Множитель барабана должен быть от ×0 до ×1000 с точностью до 0.001.',true,'symbols');
      entries.push([reel,Math.round(Number(raw)*1000)]);
    }
    const putPrice=db.prepare(`INSERT INTO symbol_unit_prices(symbol_id,percent_hundredths) VALUES(?,?)
      ON CONFLICT(symbol_id) DO UPDATE SET percent_hundredths=excluded.percent_hundredths`);
    const putReel=db.prepare(`INSERT INTO symbol_reel_multipliers(symbol_id,reel_count,multiplier_milli) VALUES(?,?,?)
      ON CONFLICT(symbol_id,reel_count) DO UPDATE SET multiplier_milli=excluded.multiplier_milli`);
    const putEgyptLine=db.prepare(`INSERT INTO egypt_line_multipliers(symbol_id,matches,multiplier_milli) VALUES(?,?,?)
      ON CONFLICT(symbol_id,matches) DO UPDATE SET multiplier_milli=excluded.multiplier_milli`);
    db.transaction(()=>{
      putPrice.run(symbolId,unit);
      for(const [reel,ratio] of entries){
        if(game.slug==='golden-seven'){
          putEgyptLine.run(symbolId,reel,ratio);
          if(reel>=3)putReel.run(symbolId,reel,ratio);
        }else putReel.run(symbolId,reel,ratio);
      }
    })();
    res.redirect(sectionUrl(id,'symbols'));
  });
  app.post('/admin/games/:id/symbols/:symbolId/delete',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),symbolId=Number(req.params.symbolId);
    if(!id||!gameById(id)||!assertOwnSymbol(id,symbolId))return res.sendStatus(404);
    if(getScatterSettings(id)?.symbolId===symbolId)return res.sendStatus(403);
    const image=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,'symbol_'+symbolId);
    db.transaction(()=>{
      db.prepare('DELETE FROM game_assets WHERE game_id=? AND asset_key=?').run(id,'symbol_'+symbolId);
      db.prepare('DELETE FROM game_symbols WHERE id=? AND game_id=?').run(symbolId,id);
    })();
    if(image)try{fs.unlinkSync(path.join(uploadsDir,image.file_name));}catch{}
    res.redirect(sectionUrl(id,'symbols'));
  });
  app.post('/admin/games/:id/backgrounds/:key',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),key=req.params.key;
    if(!id||!gameById(id)||!isBackgroundAsset(key))return res.sendStatus(404);
    const imageId=Number(req.body?.image_id);
    if(!Number.isSafeInteger(imageId)||imageId<=0||!ownedLibraryImage(id,imageId))
      return show(req,res,'Выберите изображение из папки этой игры.',true,assetTab(key));
    db.prepare(`INSERT INTO game_background_images(game_id,asset_key,library_image_id)
      VALUES(?,?,?) ON CONFLICT(game_id,asset_key) DO UPDATE SET library_image_id=excluded.library_image_id`)
      .run(id,key,imageId);
    res.redirect(sectionUrl(id,assetTab(key))+'&applied=1');
  });
  app.post('/admin/games/:id/assets/:key',adminOnly,upload.single('asset'),postGuard,(req,res)=>{
    const id=gameId(req),key=req.params.key,meta=id?dynamicAsset(id,key):null;
    if(!id||!gameById(id)||!meta)return res.sendStatus(404);
    if(!req.file||!req.file.buffer?.length)return show(req,res,'Выберите файл для загрузки.',true,assetTab(key));
    const type=fileType(req.file.buffer);
    if(!type||type.kind!==meta.kind)return show(req,res,'Неподдерживаемый формат файла.',true,assetTab(key));
    if(meta.kind==='image'&&req.file.size>5*1024*1024)return show(req,res,'Изображение должно быть не больше 5 МБ.',true,assetTab(key));
    const name=crypto.randomBytes(24).toString('hex')+'.'+type.ext;
    const fullPath=path.join(uploadsDir,name);
    fs.writeFileSync(fullPath,req.file.buffer,{flag:'wx',mode:0o600});
    try {
      const previous=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,key);
      db.prepare('INSERT INTO game_assets(game_id,asset_key,file_name,media_type) VALUES(?,?,?,?) ON CONFLICT(game_id,asset_key) DO UPDATE SET file_name=excluded.file_name,media_type=excluded.media_type').run(id,key,name,type.type);
      if(isBackgroundAsset(key))db.prepare('DELETE FROM game_background_images WHERE game_id=? AND asset_key=?').run(id,key);
      if(previous)try{fs.unlinkSync(path.join(uploadsDir,previous.file_name));}catch(e){console.warn('Old game asset cleanup:',e.code);}
    }catch(e){try{fs.unlinkSync(fullPath);}catch{}throw e;}
    res.redirect(sectionUrl(id,assetTab(key))+'&uploaded=1');
  });
  app.post('/admin/games/:id/assets/:key/delete',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),key=req.params.key;
    if(!id||!gameById(id)||!dynamicAsset(id,key))return res.sendStatus(404);
    const previous=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,key);
    if(isBackgroundAsset(key))db.prepare('DELETE FROM game_background_images WHERE game_id=? AND asset_key=?').run(id,key);
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