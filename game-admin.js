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
  egypt_bonus_background:{label:'Фон бонусной игры «Египет»',kind:'image'},
  space_bonus_background:{label:'Фон бонусной игры «Космическая одиссея»',kind:'image'},
  space_expanding_wild:{label:'Космос: один высокий WILD на три ячейки',kind:'image'},
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
    {key:'gameplay',label:'Настройки игры',items:['symbols','lines','frequency','scatter']},
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
    if(key==='background'||key==='logo'||key==='bonus_frame'||key==='egypt_bonus_background'||key==='space_bonus_background')return 'background';
    if(key==='space_expanding_wild')return 'symbols';
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
    const scatter=getScatterSettings(id);
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
    const egyptLinePrices=game.slug==='golden-seven'
      ?new Map(db.prepare(`SELECT p.symbol_id,p.matches,p.percent_millionths
          FROM egypt_line_prices p JOIN game_symbols s ON s.id=p.symbol_id
          WHERE s.game_id=?`).all(id)
          .map(row=>[row.symbol_id+':'+row.matches,row.percent_millionths]))
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
        '<form method="post" action="/admin/games/'+id+'/library/'+image.id+'/rename" class="library-rename-form">'+csrf+
          '<label>Название картинки<input type="text" name="name" minlength="1" maxlength="80" value="'+h(image.name)+'" required></label>'+
          '<button type="submit">Переименовать</button></form>'+
        '<div class="library-quick-actions">'+
        quickAssign(['background','Фон игры'])+quickAssign(['reels_background','Фон игрового поля'])+quickAssign(['cells_background','Фон барабанов'])+
        (game.slug==='lucky-stars'?quickAssign(['space_bonus_background','Фон космической бонуски']):'')+
        (game.slug==='lucky-stars'?quickAssign(['space_expanding_wild','На весь барабан WILD']):'')+
        '</div>'+
        '<form method="post" action="/admin/games/'+id+'/library/'+image.id+'/replace" enctype="multipart/form-data">'+csrf+
          '<label class="asset-upload-label">Заменить картинку<input type="file" name="asset" accept="image/png,image/jpeg,image/webp,image/gif" required></label>'+
          '<button type="submit">Заменить</button></form>'+
        '<form method="post" action="/admin/games/'+id+'/library/'+image.id+'/delete">'+csrf+
          '<button type="submit" class="danger-action" title="Удаление снимет картинку с '+linkedCount+' назначений">Удалить</button></form>'+
        '</div>';
    }).join('');
    const egyptWeights=game.slug==='golden-seven'
      ?new Map(db.prepare(`SELECT w.symbol_id,w.weight FROM egypt_symbol_weights w
        JOIN game_symbols s ON s.id=w.symbol_id WHERE s.game_id=?`).all(id)
          .map(row=>[row.symbol_id,row.weight])):new Map();
    const egyptBonusRules=new Map(game.slug==='golden-seven'
      ?db.prepare(`SELECT s.id AS symbol_id,COALESCE(r.min_reels,3) AS min_reels
        FROM game_symbols s LEFT JOIN egypt_symbol_bonus_rules r ON r.symbol_id=s.id
        WHERE s.game_id=?`).all(id).map(row=>[row.symbol_id,row]):[]);
    const symbolItems=symbols.map(symbol=>{
      const isScatter=scatter&&symbol.id===scatter.symbolId;
      const isWild=!!db.prepare('SELECT 1 FROM game_wild_symbols WHERE game_id=? AND symbol_id=?').get(id,symbol.id);
      const unitPrice=((unitPrices.get(symbol.id)||0)/100).toFixed(2);
      const multipliers=multipliersBySymbol.get(symbol.id)||new Map();
      const reelInputs=Array.from({length:game.slug==='golden-seven'?5:layout.reels-2},(_,i)=>{
        const reel=i+(game.slug==='golden-seven'?2:3);
        if(game.slug==='golden-seven'){
          const price=egyptLinePrices.get(symbol.id+':'+reel)??0;
          return '<label class="payout-input">За '+reel+' символа(ов) на линии, × от ставки'+
            '<input type="number" min="0" max="10000" step="0.00000001" name="r_'+reel+'" value="'+(price/100000000).toFixed(8)+'" required></label>';
        }
        const ratio=multipliers.get(reel)??1000;
        return '<label class="payout-input">Цепочка до барабана №'+reel+', ×'+
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
        (game.slug==='golden-seven'&&!isScatter?'<form method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/egypt-weight">'+csrf+
        '<label>Частота появления символа (вес 0–10000)'+
        '<input type="number" name="weight" min="0" max="10000" step="1" value="'+(egyptWeights.get(symbol.id)??100)+'" required></label>'+
        '<p class="hint">Вес действует на всех 6 барабанах, в обычных и бесплатных вращениях. 100 — обычная частота, 200 — вдвое чаще относительно символа с весом 100, 0 — не выпадает случайно. SCATTER настраивается отдельно.</p>'+
        '<button class="primary" type="submit">Сохранить частоту символа</button></form>':'')+
        (game.slug==='golden-seven'&&!isScatter?'<form method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/egypt-min-reels">'+csrf+
        '<label>Минимум совпадений (обычная игра и бонус) <select name="min_reels">'+
        '<option value="2"'+(egyptBonusRules.get(symbol.id)?.min_reels===2?' selected':'')+'>2 барабанов</option>'+
        '<option value="3"'+(egyptBonusRules.get(symbol.id)?.min_reels!==2?' selected':'')+'>3 барабанов</option>'+
        '</select></label>'+
        '<p class="hint">Для обычной игры и бонуса действует одна таблица выплат ниже. Различается только правило совпадений: подряд слева направо в обычной игре и на любых барабанах с расширением в бонусе. Все 10 выигрышных линий оплачиваются отдельно.</p>'+
        '<button class="primary" type="submit">Сохранить минимум совпадений</button></form>':'')+
        (isWild?'<p class="hint"><strong>WILD</strong> заменяет обычные символы, но не SCATTER.</p>':'')+
        (isScatter?'<p class="hint"><strong>SCATTER</strong> запускает бесплатные вращения, но не оплачивается как обычная цепочка. Вероятности и лимиты задаются в разделе «Бонусная игра».</p>':'<form class="symbol-prices-form" method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/payouts">'+csrf+
        '<p class="hint">'+(game.slug==='golden-seven'?'Египет: одна таблица выплат для обычной и бонусной игры. Задайте самостоятельную цену за 2, 3, 4, 5 и 6 совпавших барабанов. В обычной игре совпадения подряд слева направо на одной из 10 линий. В бонусе выбранный символ расширяется и совпавшие барабаны могут быть несоседними. Каждая выигрышная линия оплачивается отдельно.':'Цена одного символа — процент от ставки. Выигрыш начинается, если символ есть на каждом из барабанов 1, 2 и 3. Считаются все его копии в непрерывной цепочке слева направо. На результат дополнительно умножается только коэффициент последнего барабана цепочки, не все коэффициенты сразу.')+'</p>'+
        (game.slug==='golden-seven'?'':'<label>Цена одного символа, % от ставки<input type="number" min="0" max="10000" step="0.01" name="unit_percent" value="'+unitPrice+'" required></label>')+
        '<p class="hint">'+(game.slug==='golden-seven'?'Пример: ставка 100, за 3 совпавших символа указан множитель ×2 — это 200 очков за одну выигрышную линию. Если сыграли все настроенные линии — всего 2000 очков. ×0 отключает выплату за соответствующее количество символов.':'Например, ставка 20, цена символа 10%, 6 символов на первых трёх барабанах, ×3 = 20 × 10% × 6 × 3 = 36 очков. При цепочке до барабана №4 используется только его множитель. ×0 отключает выплату для этой длины цепочки.')+'</p>'+
        '<div class="payout-grid">'+reelInputs+'</div><button class="primary" type="submit">'+(game.slug==='golden-seven'?'Сохранить выплаты за 2–6 символов':'Сохранить цену и множители')+'</button></form>')+
        (isScatter||isWild?'':'<form method="post" action="/admin/games/'+id+'/symbols/'+symbol.id+'/delete">'+csrf+
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
      ...(['golden-seven','lucky-stars'].includes(game.slug)?[['lines','Линии выигрыша','Добавить, изменить или удалить линии','columns']]:[]),
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
      '<p class="hint">'+(['golden-seven','lucky-stars'].includes(game.slug)?'Настройте основной фон и отдельный фон бонусной игры. Бонусный фон автоматически появляется при бесплатных вращениях; выбирайте изображение из папки или загружайте PNG, JPG, WEBP или GIF.':'Изменяйте фон, логотип и прозрачную картинку демона, обхватывающего поле. Демон показывается только во время бонусной игры первой игры; используйте PNG с прозрачным центром.')+'</p><div class="asset-settings-grid">'+
      rowsFor(game.slug==='slot-classic'?['background','logo','bonus_frame']:game.slug==='golden-seven'?['background','egypt_bonus_background','logo']:game.slug==='lucky-stars'?['background','space_bonus_background','logo']:['background','logo'])+'</div>'+spaceMoveBackground+'</section>';
    const spaceMoveBackground=game.slug==='lucky-stars'&&(assignedBackgrounds.has('background')||assets.has('background'))?
      '<form method="post" action="/admin/games/'+id+'/move-background-to-reels">'+csrf+
      '<p class="hint">Если рамка с пятью барабанами появилась на весь экран, перенеси её в фон игрового поля. Общий фон после переноса можно установить отдельно.</p>'+
      '<button class="primary" type="submit">Перенести общий фон в фон игрового поля</button></form>':'';
    if(activeTab==='reels')panel=panelStart('Фон игрового поля')+
      '<p class="hint">Одна картинка заполняет всё игровое поле за пятью барабанами. Фон ячеек с символами настраивается отдельно в разделе «Фон барабанов».</p>'+
      '<div class="asset-settings-grid">'+rowsFor(['reels_background'])+'</div>'+spaceMoveBackground+'</section>';
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
    const egyptLineEntries=['golden-seven','lucky-stars'].includes(game.slug)
      ?db.prepare('SELECT id,position,rows_json FROM '+(game.slug==='lucky-stars'?'space_paylines':'egypt_paylines')+' WHERE game_id=? ORDER BY position,id')
          .all(id).map(row=>({id:row.id,rows:JSON.parse(row.rows_json)})):[];
    const linePreview=(rows,index)=>'<div class="egypt-line-card"><strong>Линия '+(index+1)+'</strong>'+
      '<svg viewBox="0 0 360 185" role="img" aria-label="Линия '+(index+1)+'">'+
      Array.from({length:layout.reels},(_,col)=>'<line x1="'+(30+col*(300/(layout.reels-1)))+'" y1="8" x2="'+(30+col*(300/(layout.reels-1)))+'" y2="172" stroke="#8d7450" stroke-width="1"/>').join('')+
      '<polyline points="'+rows.map((row,col)=>(30+col*(300/(layout.reels-1)))+','+(25+row*(layout.rows===3?66:45))).join(' ')+
        '" fill="none" stroke="#ffd775" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'+
      rows.map((row,col)=>'<circle cx="'+(30+col*(300/(layout.reels-1)))+'" cy="'+(25+row*(layout.rows===3?66:45))+'" r="6" fill="#fff2ad"/>').join('')+
      '</svg></div>';
    const egyptLinePreview='<div class="egypt-lines-gallery">'+
      egyptLineEntries.map((item,index)=>linePreview(item.rows,index)).join('')+'</div>';
    const lineFields=(rows)=>'<div class="payline-drawing" data-line-editor data-reels="'+layout.reels+'" data-rows="'+layout.rows+'">'+
      '<div class="payline-draw-board" role="group" aria-label="Нарисовать линию выплат">'+
      '<svg class="payline-draw-overlay" viewBox="0 0 '+(layout.reels*100)+' '+(layout.rows*100)+'" preserveAspectRatio="none" aria-hidden="true"><polyline class="payline-draw-path" fill="none" stroke="#ffdf77" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
      Array.from({length:layout.rows},(_,row)=>Array.from({length:layout.reels},(_,col)=>
        '<button type="button" class="payline-cell'+(rows[col]===row?' is-selected':'')+'" data-col="'+col+'" data-row="'+row+'" aria-label="Барабан '+(col+1)+', строка '+(row+1)+'" aria-pressed="'+(rows[col]===row)+'">'+
        '<span class="payline-cell-symbol">'+(rows[col]===row?'●':'·')+'</span></button>').join('')).join('')+
      '</div><p class="hint">Нажимай на клетки: по одной на каждом барабане. Линия рисуется сразу, затем нажми «Сохранить».</p>'+
      '<div class="payout-grid">'+Array.from({length:layout.reels},(_,index)=>
      '<label>Барабан '+(index+1)+
      '<select name="row_'+(index+1)+'" required>'+
      Array.from({length:layout.rows},(_,row)=>
        '<option value="'+(row+1)+'"'+(rows[index]===row?' selected':'')+'>Строка '+(row+1)+'</option>').join('')+
      '</select></label>').join('')+'</div></div>';
    if(activeTab==='lines'&&['golden-seven','lucky-stars'].includes(game.slug)){
      const editor=egyptLineEntries.map((item,index)=>
        '<div class="egypt-line-editor"><h3>Линия '+(index+1)+'</h3>'+
        linePreview(item.rows,index)+
        '<form method="post" action="/admin/games/'+id+'/egypt-lines/'+item.id+'/save">'+csrf+
        lineFields(item.rows)+
        '<button class="primary" type="submit">Сохранить линию</button></form>'+
        (egyptLineEntries.length>1?
          '<form method="post" action="/admin/games/'+id+'/egypt-lines/'+item.id+'/delete">'+csrf+
          '<button type="submit" class="danger-action">Удалить линию</button></form>':'')+
        '</div>').join('');
      panel=panelStart(game.slug==='lucky-stars'?'Линии выигрыша Космоса':'Линии выигрыша Египта')+
        '<p class="hint">Линия проходит через одну ячейку каждого барабана. Выбери строку от 1 до '+layout.rows+' для каждого барабана. Эти линии действуют в обычной и бонусной игре. Выплата начисляется за каждую сыгравшую линию отдельно. Допускается от 1 до 50 различных линий.</p>'+
        '<div class="egypt-line-editors">'+editor+'</div>'+
        '<h3>Добавить линию</h3>'+
        '<form method="post" action="/admin/games/'+id+'/egypt-lines/add">'+csrf+
        lineFields(Array(layout.reels).fill(0))+
        '<button class="primary" type="submit">Добавить линию</button></form></section>'+
        '<script src="/static/admin-lines.js?v=2" defer></script>';
    }
    if(activeTab==='scatter'&&scatter){
      const ruleByReel=new Map(scatter.rules.map(rule=>[rule.reel_index,rule]));
      const inputs=Array.from({length:layout.reels},(_,i)=>{
        const reel=i+1,rule=ruleByReel.get(reel)||{chance_percent:0,max_symbols:0};
        const countWeights=Array.from({length:layout.rows},(_,index)=>{
          const count=index+1;
          return '<label>Ровно '+count+' Scatter — вес<input type="number" min="0" max="100" step="1" name="weight_'+reel+'_'+count+'" value="'+(rule['weight_'+count]??0)+'" required></label>';
        }).join('');
        if(['golden-seven','lucky-stars'].includes(game.slug))
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
        '<p class="hint">'+(['golden-seven','lucky-stars'].includes(game.slug)
          ?'Задайте шанс SCATTER отдельно для каждого барабана. На одном барабане может быть только один SCATTER.'
          :'Сначала срабатывает общий шанс барабана, затем выбирается количество Scatter по указанным весам. Например, веса 30, 20 и 70 для одного, двух и трёх Scatter означают пропорции 25%, 16,7% и 58,3% среди появлений. Сумма весов может быть любой. Веса количества выше указанного максимума игнорируются.')+'</p>'+
        '<p class="hint">'+(game.slug==='lucky-stars'?'Космос: 3 SCATTER — 10 вращений, 4 — 15, 5 — 20. В бонусе WILD расширяется до одной высокой картинки на весь барабан (3 ячейки); каждый выигрыш считается по редактируемым линиям. SCATTER никогда не заменяется WILD. Повторные SCATTER запускают дополнительные серии.' :game.slug==='golden-seven'?'Египет: 3 SCATTER — 10 вращений, 4 — 15, 5 — 20, 6 — 25. Перед бонусом случайно выбирается символ, который расширяется на барабан при выпадении. Нет множителя первой игры.':'3 Scatter — 10 бесплатных вращений; 4 — 15; 5 и более — 20. Бонусный множитель начинается с ×2 и увеличивается на +1 после выигрышного бесплатного вращения. Выигрыш накапливается отдельно и зачисляется только после завершения бонуса.')+'</p>'+
        (['golden-seven','lucky-stars'].includes(game.slug)?'<h3>Линии бонусной игры ('+egyptLineEntries.length+')</h3>'+egyptLinePreview+
          '<p class="hint">Выбранный символ расширяется на каждый барабан, где выпал, поэтому каждая из настроенных линий учитывает все такие барабаны, даже несоседние.</p>':'')+
        '<form method="post" action="/admin/games/'+id+'/scatter" class="scatter-settings-form">'+csrf+
        '<div class="scatter-rule-grid">'+inputs+'</div><button class="primary" type="submit">Сохранить настройки Scatter</button></form></section>';
    }
    if(activeTab==='symbols')panel=panelStart('Символы и коэффициенты')+
      '<p class="hint">'+(game.slug==='golden-seven'?'Установите множитель ставки для 2–6 символов на линии и относительный вес их выпадения. Линии можно создавать и редактировать отдельно в разделе «Линии выигрыша».':'Для каждого символа установите цену одной копии в процентах от ставки и множитель по длине непрерывной цепочки барабанов. Выплата начинается с трёх последовательных барабанов слева направо.')+'</p>'+
      '<form method="post" action="/admin/games/'+id+'/symbols?tab=symbols" class="new-symbol-form">'+csrf+
      '<label>Название нового символа<input name="name" minlength="1" maxlength="60" required placeholder="Например: Золотая звезда"></label>'+
      '<button class="primary" type="submit">Добавить символ</button></form>'+
      (game.slug==='lucky-stars'?'<p><a class="primary" href="/admin/games/'+id+'?tab=lines">Редактировать 10 линий выигрыша →</a></p>':'')+
      '<div class="symbol-admin-list">'+symbolItems+'</div>'+
      (game.slug==='lucky-stars'?'<h3>Расширяющийся WILD: одна картинка на 3 ячейки</h3><p class="hint">Для выбора из папки используйте кнопку «На весь барабан WILD» в разделе изображений. Можно также загрузить отдельный вертикальный файл ниже.</p><div class="asset-settings-grid">'+rowsFor(['space_expanding_wild'])+'</div>':'')+'</section>';
    const notice=message?'<p class="'+(error?'error':'success-note')+'" role="status">'+h(message)+'</p>':'';
    sendPage(res,'Настройки: '+game.title,
      '<div class="game-admin-page"><a class="back-link" href="/admin">← К списку игр</a>'+
      '<h1>Настройки: '+h(game.title)+'</h1>'+notice+
      '<nav class="game-admin-menu" aria-label="Разделы настроек игры">'+tabButtons+'</nav>'+
      (panel || '<section class="panel game-admin-intro"><h2>Управление игрой</h2>'+
      '<p class="hint">Выберите нужный раздел кнопкой выше. Настройки, файлы и коэффициенты сохраняются отдельно для каждой игры.</p>'+
      (game.slug==='lucky-stars'?'<p><a class="primary" href="/admin/games/'+id+'?tab=lines">Рисовать и изменять линии выигрыша (Космос)</a></p>':'')+'</section>')+
      '</div>',req,error?400:200);
  }
  app.post('/admin/games/:id/menu-labels',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),game=id?gameById(id):null;
    if(!game)return res.sendStatus(404);
    const changes=[];
    for(const key of allowedMenuKeys){
      if(key==='lines'&&!['golden-seven','lucky-stars'].includes(game.slug))continue;
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
  function egyptLineInput(req){
    const layout=gameLayout(gameById(gameId(req)));
    const fields=Array.from({length:layout.reels},(_,i)=>req.body?.['row_'+(i+1)]);
    return fields.every(value=>typeof value==='string'&&Number(value)>=1&&Number(value)<=layout.rows&&Number.isInteger(Number(value)))
      ?fields.map(value=>Number(value)-1):null;
  }
  function egyptLinesGame(req){
    const id=gameId(req),game=id?gameById(id):null;
    return ['golden-seven','lucky-stars'].includes(game?.slug)?id:null;
  }
  app.post('/admin/games/:id/egypt-lines/add',adminOnly,postGuard,(req,res)=>{
    const id=egyptLinesGame(req);
    if(!id)return res.sendStatus(404);
    const rows=egyptLineInput(req);
    if(!rows)return show(req,res,'Выберите строку от 1 до 4 на каждом барабане.',true,'lines');
    const table=gameById(id).slug==='lucky-stars'?'space_paylines':'egypt_paylines';
    const entries=db.prepare('SELECT rows_json FROM '+table+' WHERE game_id=?').all(id);
    if(entries.length>=50)return show(req,res,'Максимум 50 линий.',true,'lines');
    const json=JSON.stringify(rows);
    if(entries.some(item=>item.rows_json===json))
      return show(req,res,'Такая линия уже существует.',true,'lines');
    const position=db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM '+table+' WHERE game_id=?').get(id).n;
    db.prepare('INSERT INTO '+table+'(game_id,position,rows_json) VALUES(?,?,?)').run(id,position,json);
    res.redirect(sectionUrl(id,'lines')+'&saved=1');
  });
  app.post('/admin/games/:id/egypt-lines/:lineId/save',adminOnly,postGuard,(req,res)=>{
    const id=egyptLinesGame(req),lineId=Number(req.params.lineId);
    if(!id||!Number.isSafeInteger(lineId)||lineId<1)return res.sendStatus(404);
    const table=gameById(id).slug==='lucky-stars'?'space_paylines':'egypt_paylines';
    const own=db.prepare('SELECT id FROM '+table+' WHERE id=? AND game_id=?').get(lineId,id);
    if(!own)return res.sendStatus(404);
    const rows=egyptLineInput(req);
    if(!rows)return show(req,res,'Выберите строку от 1 до 4 на каждом барабане.',true,'lines');
    const json=JSON.stringify(rows);
    const duplicate=db.prepare('SELECT id FROM '+table+' WHERE game_id=? AND rows_json=? AND id!=?').get(id,json,lineId);
    if(duplicate)return show(req,res,'Такая линия уже существует.',true,'lines');
    db.prepare('UPDATE '+table+' SET rows_json=? WHERE id=? AND game_id=?').run(json,lineId,id);
    res.redirect(sectionUrl(id,'lines')+'&saved=1');
  });
  app.post('/admin/games/:id/egypt-lines/:lineId/delete',adminOnly,postGuard,(req,res)=>{
    const id=egyptLinesGame(req),lineId=Number(req.params.lineId);
    if(!id||!Number.isSafeInteger(lineId)||lineId<1)return res.sendStatus(404);
    const table=gameById(id).slug==='lucky-stars'?'space_paylines':'egypt_paylines';
    const deleted=db.transaction(()=>{
      const count=db.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE game_id=?').get(id).n;
      if(count<=1)return false;
      return db.prepare('DELETE FROM '+table+' WHERE id=? AND game_id=?').run(lineId,id).changes>0;
    })();
    if(!deleted)return show(req,res,'Нельзя удалить последнюю линию или линия не найдена.',true,'lines');
    res.redirect(sectionUrl(id,'lines')+'&saved=1');
  });
  app.post('/admin/games/:id/scatter',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),game=id?gameById(id):null;
    if(!game||!['slot-classic','golden-seven','lucky-stars'].includes(game.slug)||!getScatterSettings(id))return res.sendStatus(404);
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
    if(['golden-seven','lucky-stars'].includes(game.slug)){
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
  app.post('/admin/games/:id/symbols/:symbolId/egypt-weight',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),symbolId=Number(req.params.symbolId),game=id?gameById(id):null;
    if(!game||game.slug!=='golden-seven'||!assertOwnSymbol(id,symbolId))return res.sendStatus(404);
    if(getScatterSettings(id)?.symbolId===symbolId)return res.sendStatus(403);
    const raw=req.body?.weight;
    if(typeof raw!=='string'||!/^(?:0|[1-9][0-9]{0,3}|10000)$/.test(raw)||Number(raw)>10000)
      return show(req,res,'Вес должен быть целым числом от 0 до 10000.',true,'symbols');
    const weight=Number(raw);
    const current=db.prepare(`SELECT COUNT(*) AS n FROM game_symbols s
      LEFT JOIN egypt_symbol_weights w ON w.symbol_id=s.id
      WHERE s.game_id=? AND s.id!=? AND s.id!=? AND COALESCE(w.weight,100)>0`)
      .get(id,symbolId,getScatterSettings(id)?.symbolId||0).n;
    if(weight===0&&current===0)
      return show(req,res,'Хотя бы у одного обычного символа вес должен быть больше нуля.',true,'symbols');
    db.prepare(`INSERT INTO egypt_symbol_weights(symbol_id,weight) VALUES(?,?)
      ON CONFLICT(symbol_id) DO UPDATE SET weight=excluded.weight`).run(symbolId,weight);
    res.redirect(sectionUrl(id,'symbols')+'&saved=1');
  });
  app.post('/admin/games/:id/symbols/:symbolId/egypt-min-reels',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),symbolId=Number(req.params.symbolId),game=id?gameById(id):null;
    if(!game||game.slug!=='golden-seven'||!assertOwnSymbol(id,symbolId))return res.sendStatus(404);
    if(getScatterSettings(id)?.symbolId===symbolId)return res.sendStatus(403);
    const minimum=Number(req.body?.min_reels);
    if(![2,3].includes(minimum))return show(req,res,'Укажите 2 или 3 барабана.',true,'symbols');
    db.prepare(`INSERT INTO egypt_symbol_bonus_rules(symbol_id,min_reels) VALUES(?,?)
      ON CONFLICT(symbol_id) DO UPDATE SET min_reels=excluded.min_reels`).run(symbolId,minimum);
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
  app.post('/admin/games/:id/library/:imageId/rename',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),imageId=Number(req.params.imageId);
    if(!id||!gameById(id)||!Number.isSafeInteger(imageId)||imageId<=0||!ownedLibraryImage(id,imageId))
      return res.sendStatus(404);
    const name=typeof req.body?.name==='string'?req.body.name.trim():'';
    if(!name||name.length>80)return show(req,res,'Название изображения: от 1 до 80 символов.',true,'library');
    db.prepare('UPDATE game_image_library SET name=? WHERE game_id=? AND id=?')
      .run(name,id,imageId);
    res.redirect(sectionUrl(id,'library')+'&renamed=1');
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
    if(game.slug==='golden-seven'){
      const entries=[];
      for(let count=2;count<=6;count++){
        const raw=req.body?.['r_'+count];
        if(typeof raw!=='string'||!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,8})?$/.test(raw)||Number(raw)>10000)
          return show(req,res,'Множитель за 2–6 символов должен быть от ×0 до ×10000 с точностью до 0.00000001.',true,'symbols');
        // Stored as micro-percent (legacy column name); 1× = 100000000.
        entries.push([count,Math.round(Number(raw)*100000000)]);
      }
      const setPrice=db.prepare(`INSERT INTO egypt_line_prices(symbol_id,matches,percent_millionths) VALUES(?,?,?)
        ON CONFLICT(symbol_id,matches) DO UPDATE SET percent_millionths=excluded.percent_millionths`);
      db.transaction(()=>{for(const [count,price] of entries)setPrice.run(symbolId,count,price);})();
      return res.redirect(sectionUrl(id,'symbols'));
    }
    const percentage=req.body?.unit_percent;
    if(typeof percentage!=='string'||!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(percentage)||Number(percentage)>10000)
      return show(req,res,'Цена одного символа должна быть от 0 до 10000% с точностью до 0.01%.',true,'symbols');
    const unit=Math.round(Number(percentage)*100);
    const entries=[];
    for(let reel=3;reel<=gameLayout(game).reels;reel++){
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
    if(getScatterSettings(id)?.symbolId===symbolId||db.prepare('SELECT 1 FROM game_wild_symbols WHERE game_id=? AND symbol_id=?').get(id,symbolId))return res.sendStatus(403);
    const image=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,'symbol_'+symbolId);
    db.transaction(()=>{
      db.prepare('DELETE FROM game_assets WHERE game_id=? AND asset_key=?').run(id,'symbol_'+symbolId);
      db.prepare('DELETE FROM game_symbols WHERE id=? AND game_id=?').run(symbolId,id);
    })();
    if(image)try{fs.unlinkSync(path.join(uploadsDir,image.file_name));}catch{}
    res.redirect(sectionUrl(id,'symbols'));
  });
  // Move artwork accidentally selected as wallpaper to the reel-frame slot.
  app.post('/admin/games/:id/move-background-to-reels',adminOnly,postGuard,(req,res)=>{
    const id=gameId(req),game=id?gameById(id):null;
    if(game?.slug!=='lucky-stars')return res.sendStatus(404);
    const library=db.prepare('SELECT library_image_id FROM game_background_images WHERE game_id=? AND asset_key=?').get(id,'background');
    const uploaded=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,'background');
    if(!library&&!uploaded)return show(req,res,'Общий фон не назначен.',true,'background');
    const oldReelUpload=db.prepare('SELECT file_name FROM game_assets WHERE game_id=? AND asset_key=?').get(id,'reels_background');
    db.transaction(()=>{
      db.prepare('DELETE FROM game_background_images WHERE game_id=? AND asset_key IN (?,?)')
        .run(id,'background','reels_background');
      db.prepare('DELETE FROM game_assets WHERE game_id=? AND asset_key=?').run(id,'reels_background');
      if(library){
        db.prepare('INSERT INTO game_background_images(game_id,asset_key,library_image_id) VALUES(?,?,?)')
          .run(id,'reels_background',library.library_image_id);
        db.prepare('DELETE FROM game_assets WHERE game_id=? AND asset_key=?').run(id,'background');
      }else{
        db.prepare('UPDATE game_assets SET asset_key=? WHERE game_id=? AND asset_key=?')
          .run('reels_background',id,'background');
      }
    })();
    if(oldReelUpload&&oldReelUpload.file_name!==uploaded?.file_name)
      try{fs.unlinkSync(path.join(uploadsDir,oldReelUpload.file_name));}catch(e){console.warn('Old reel art cleanup:',e.code);}
    if(library&&uploaded)
      try{fs.unlinkSync(path.join(uploadsDir,uploaded.file_name));}catch(e){console.warn('Old wallpaper cleanup:',e.code);}
    res.redirect(sectionUrl(id,'reels')+'&moved=1');
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