'use strict';
// One-time, conservative rebuild of the untouched Egyptian starter set.
// Never change custom or uploaded symbols configured by an administrator.
module.exports = function installEgyptSymbols(db) {
  const game=db.prepare("SELECT id FROM games WHERE slug='golden-seven'").get();
  if(!game)return;
  const id=game.id, flag='egypt_symbols_2026_v1';
  db.exec('CREATE TABLE IF NOT EXISTS egypt_setup_flags(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const flagged=db.prepare('SELECT 1 FROM egypt_setup_flags WHERE key=?').get(flag);
  if(flagged)return;
  const old=db.prepare('SELECT id,name FROM game_symbols WHERE game_id=? ORDER BY position,id').all(id);
  const defaults=new Set(['Фараон','Клеопатра','Анубис','Глаз Гора','Скарабей','Анкх',
    'Пирамида','Кобра','Сфинкс','Солнце Ра','Священная кошка','SCATTER']);
  // A user may already have customised the list. Skip rather than delete their work.
  const unchanged=old.length>0&&old.every(s=>defaults.has(s.name)||/^(Фараон|Клеопатра|Анубис|Глаз Гора|Скарабей|Анкх|Пирамида|Кобра|Сфинкс|Солнце Ра|Священная кошка) [2-9]$/.test(s.name));
  const uploaded=old.some(s=>db.prepare('SELECT 1 FROM game_assets WHERE game_id=? AND asset_key=?').get(id,'symbol_'+s.id));
  const customLinkedArt=db.prepare(`SELECT 1 FROM game_symbol_images x
    JOIN game_symbols s ON s.id=x.symbol_id
    JOIN game_image_library l ON l.id=x.library_image_id
    WHERE s.game_id=? AND (
      l.builtin_path IS NULL OR l.builtin_path NOT LIKE '/static/images/egypt/symbols.svg#%'
    ) LIMIT 1`).get(id);
  // Preserve user-chosen artwork. Only the original SVG placeholders are migrated.
  if(!unchanged||uploaded||customLinkedArt)return;
  const requested=[
    ['Фараон','pharaoh',1900],['Анкх','ankh',1600],
    ['Клеопатра','cleopatra',1700],['Анубис','anubis',1800],
    ['10','ten',650],['J','j',750],['Q','q',850],['K','k',950],['A','a',1100],
    ['SCATTER','scarab',0]
  ];
  db.transaction(()=>{
    db.prepare('DELETE FROM game_symbols WHERE game_id=?').run(id);
    const add=db.prepare('INSERT INTO game_symbols(game_id,name,position) VALUES(?,?,?)');
    const art=db.prepare('INSERT OR IGNORE INTO game_image_library(game_id,name,builtin_path) VALUES(?,?,?)');
    const findArt=db.prepare('SELECT id FROM game_image_library WHERE game_id=? AND builtin_path=?');
    const link=db.prepare('INSERT OR IGNORE INTO game_symbol_images(symbol_id,library_image_id) VALUES(?,?)');
    const price=db.prepare('INSERT OR IGNORE INTO symbol_unit_prices(symbol_id,percent_hundredths) VALUES(?,?)');
    const mult=db.prepare('INSERT OR IGNORE INTO symbol_reel_multipliers(symbol_id,reel_count,multiplier_milli) VALUES(?,?,?)');
    let scatterId;
    for(let i=0;i<requested.length;i++){
      const [name,key,pct]=requested[i];
      const symbolId=Number(add.run(id,name,i+1).lastInsertRowid);
      const src='/static/images/egypt/premium-'+key+'.svg';
      art.run(id,name,src);
      const img=findArt.get(id,src);
      if(img)link.run(symbolId,img.id);
      price.run(symbolId,pct);
      for(let reels=3;reels<=6;reels++)mult.run(symbolId,reels,reels===3?1000:reels===4?1500:reels===5?2100:2800);
      if(key==='scarab')scatterId=symbolId;
    }
    db.prepare('INSERT INTO game_scatter_symbols(game_id,symbol_id) VALUES(?,?) ON CONFLICT(game_id) DO UPDATE SET symbol_id=excluded.symbol_id').run(id,scatterId);
    const rule=db.prepare('INSERT OR IGNORE INTO game_scatter_reels(game_id,reel_index,chance_percent,max_symbols) VALUES(?,?,?,?)');
    for(let reel=1;reel<=6;reel++)rule.run(id,reel,8,1);
    db.prepare('INSERT INTO egypt_setup_flags(key,value) VALUES(?,?)').run(flag,'1');
  })();
};
