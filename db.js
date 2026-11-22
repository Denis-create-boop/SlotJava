const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'slotjava.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  image_path TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS game_settings (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  win_frequency INTEGER NOT NULL DEFAULT 25 CHECK(win_frequency BETWEEN 0 AND 100)
);
CREATE TABLE IF NOT EXISTS game_symbols (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS game_symbols_order_idx ON game_symbols(game_id,position,id);
CREATE TABLE IF NOT EXISTS symbol_payouts (
  symbol_id INTEGER NOT NULL REFERENCES game_symbols(id) ON DELETE CASCADE,
  matches INTEGER NOT NULL CHECK(matches BETWEEN 1 AND 20),
  prize INTEGER NOT NULL DEFAULT 0 CHECK(prize BETWEEN 0 AND 1000000000),
  PRIMARY KEY(symbol_id,matches)
);
CREATE TABLE IF NOT EXISTS game_wallets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 1000 CHECK(balance >= 0),
  PRIMARY KEY(user_id,game_id)
);
CREATE TABLE IF NOT EXISTS game_image_library (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  builtin_path TEXT,
  file_name TEXT,
  UNIQUE(game_id,builtin_path),
  CHECK((builtin_path IS NULL) != (file_name IS NULL))
);
CREATE TABLE IF NOT EXISTS game_symbol_images (
  symbol_id INTEGER PRIMARY KEY REFERENCES game_symbols(id) ON DELETE CASCADE,
  library_image_id INTEGER NOT NULL REFERENCES game_image_library(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS game_background_images (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  asset_key TEXT NOT NULL,
  library_image_id INTEGER NOT NULL REFERENCES game_image_library(id) ON DELETE RESTRICT,
  PRIMARY KEY(game_id,asset_key)
);
CREATE TABLE IF NOT EXISTS game_assets (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  asset_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  PRIMARY KEY(game_id, asset_key)
);
`);

// When the admin labels were swapped, images stored as field_background
// were shown in the "Фон барабанов" section but could be hidden under reels_background.
// Migrate them to the shared 20-cell background once, without copying/deleting files.
// Never overwrite a background already configured in the new setting.
db.transaction(()=>{
  const from='field_background',to='cells_background';
  const gamesWithLegacy=db.prepare(`
    SELECT game_id FROM game_assets WHERE asset_key=?
    UNION SELECT game_id FROM game_background_images WHERE asset_key=?`).all(from,from);
  const hasFile=db.prepare('SELECT 1 FROM game_assets WHERE game_id=? AND asset_key=?');
  const hasLink=db.prepare('SELECT 1 FROM game_background_images WHERE game_id=? AND asset_key=?');
  const moveFile=db.prepare('UPDATE game_assets SET asset_key=? WHERE game_id=? AND asset_key=?');
  const moveLink=db.prepare('UPDATE game_background_images SET asset_key=? WHERE game_id=? AND asset_key=?');
  for(const {game_id} of gamesWithLegacy){
    if(hasFile.get(game_id,to)||hasLink.get(game_id,to))continue;
    moveFile.run(to,game_id,from);
    moveLink.run(to,game_id,from);
  }
})();
// Big-win thresholds are stored as thousandths of the stake multiplier.
// Defaults: 5x and 15x. Existing databases are migrated without changing payouts.
const gameSettingColumns=db.pragma('table_info(game_settings)').map(column=>column.name);
if(!gameSettingColumns.includes('big_win_multiplier_milli')){
  db.exec('ALTER TABLE game_settings ADD COLUMN big_win_multiplier_milli INTEGER NOT NULL DEFAULT 5000');
}
if(!gameSettingColumns.includes('mega_win_multiplier_milli')){
  db.exec('ALTER TABLE game_settings ADD COLUMN mega_win_multiplier_milli INTEGER NOT NULL DEFAULT 15000');
}
// Existing wallets retain their balance; add a persisted choice of test stake.
if(!db.pragma('table_info(game_wallets)').some(column=>column.name==='bet')){
  db.exec('ALTER TABLE game_wallets ADD COLUMN bet INTEGER NOT NULL DEFAULT 10');
}
// Old SQLite CHECK(bet IN (...)) prevents larger and smaller stakes.
// Rebuild only the local per-game stake table once to remove the obsolete constraint.
const currentWalletSchema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='game_wallets'").get()?.sql||'';
// SQLite may preserve legacy CHECK syntax with column quotes or parentheses.
// Match the restricted bet list itself rather than one formatting variant.
if(/["'`\[]?bet["'`\]]?\s+IN\s*\(/i.test(currentWalletSchema)){
  db.transaction(()=>{
    db.exec(`
      CREATE TABLE game_wallets_new(
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        balance INTEGER NOT NULL DEFAULT 1000 CHECK(balance>=0),
        bet INTEGER NOT NULL DEFAULT 10 CHECK(bet BETWEEN 1 AND 1000),
        PRIMARY KEY(user_id,game_id)
      );
      INSERT INTO game_wallets_new(user_id,game_id,balance,bet)
      SELECT user_id,game_id,balance,bet FROM game_wallets;
      DROP TABLE game_wallets;
      ALTER TABLE game_wallets_new RENAME TO game_wallets;
    `);
  })();
}
// Previously selected stakes of 1 or 2 are no longer available.
db.prepare('UPDATE game_wallets SET bet=5 WHERE bet<5').run();
db.exec(`
 CREATE TABLE IF NOT EXISTS user_balances (
   user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
   balance INTEGER NOT NULL DEFAULT 1000 CHECK(balance>=0)
 );
`);
// Preserve the already played first-game balance as the single source of truth.
// Do not add the separate default 1000 credits granted to other games.
db.prepare(`INSERT OR IGNORE INTO user_balances(user_id,balance)
  SELECT u.id,COALESCE(
    (SELECT w.balance FROM game_wallets w JOIN games g ON g.id=w.game_id
      WHERE w.user_id=u.id AND g.slug='slot-classic'),
    (SELECT w.balance FROM game_wallets w WHERE w.user_id=u.id ORDER BY w.game_id LIMIT 1),
    1000)
  FROM users u`).run();
// Migration for earlier test databases whose payout range started at 2.
const payoutSchema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='symbol_payouts'").get()?.sql||'';
if(/BETWEEN\s+2\s+AND\s+20/i.test(payoutSchema)){
  db.transaction(()=>{
    db.exec(`
      CREATE TABLE symbol_payouts_new(
        symbol_id INTEGER NOT NULL REFERENCES game_symbols(id) ON DELETE CASCADE,
        matches INTEGER NOT NULL CHECK(matches BETWEEN 1 AND 20),
        prize INTEGER NOT NULL DEFAULT 0 CHECK(prize BETWEEN 0 AND 1000000000),
        PRIMARY KEY(symbol_id,matches)
      );
      INSERT INTO symbol_payouts_new(symbol_id,matches,prize)
      SELECT symbol_id,matches,prize FROM symbol_payouts;
      DROP TABLE symbol_payouts;
      ALTER TABLE symbol_payouts_new RENAME TO symbol_payouts;
    `);
  })();
}
const initialGames=[
  ['slot-classic','Первая игра','/static/images/game-slot.svg',1],
  ['golden-seven','Золотая Семёрка','/static/images/game-seven.svg',2],
  ['lucky-stars','Счастливые Звёзды','/static/images/game-stars.svg',3]
];
const seedGame=db.prepare('INSERT OR IGNORE INTO games(slug,title,image_path,position) VALUES(?,?,?,?)');
db.transaction(()=>{ for(const game of initialGames) seedGame.run(...game); })();

db.prepare("UPDATE games SET title='Первая игра' WHERE slug='slot-classic' AND title='Слот Классик'").run();
// Set thematic names only while the cards retain their original demo titles.
db.prepare("UPDATE games SET title='Древний Египет' WHERE slug='golden-seven' AND title='Золотая Семёрка'").run();
db.prepare("UPDATE games SET title='Космическая одиссея' WHERE slug='lucky-stars' AND title='Счастливые Звёзды'").run();
const seedSettings=db.prepare('INSERT OR IGNORE INTO game_settings(game_id) VALUES(?)');
db.transaction(()=>{ for(const game of db.prepare('SELECT id FROM games').all()) seedSettings.run(game.id); })();
const firstGame=db.prepare("SELECT id FROM games WHERE slug='slot-classic'").get();
if(firstGame){
  const hasSymbols=db.prepare('SELECT COUNT(*) AS total FROM game_symbols WHERE game_id=?').get(firstGame.id).total;
  if(!hasSymbols){
    const insert=db.prepare('INSERT INTO game_symbols(game_id,name,position) VALUES(?,?,?)');
    db.transaction(()=>{ for(let i=1;i<=12;i++)insert.run(firstGame.id,'Символ №'+i,i); })();
  }
}
// One-time demo prize setup for the first game. Never reinsert after a user edits prices.
db.exec(`CREATE TABLE IF NOT EXISTS demo_setup_flags (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
if(firstGame){
  db.transaction(()=>{
    const flag='first_game_sample_payouts_v1';
    const done=db.prepare('SELECT 1 FROM demo_setup_flags WHERE name=?').get(flag);
    if(done)return;
    const hasPositive=db.prepare(`SELECT 1 FROM symbol_payouts p
      JOIN game_symbols s ON s.id=p.symbol_id
      WHERE s.game_id=? AND p.matches BETWEEN 3 AND 5 AND p.prize>0 LIMIT 1`).get(firstGame.id);
    if(!hasPositive){
      const demoSymbols=db.prepare('SELECT id FROM game_symbols WHERE game_id=? ORDER BY position,id LIMIT 3').all(firstGame.id);
      const samplePrices=[[20,50,120],[15,40,100],[10,30,80]];
      const insert=db.prepare('INSERT OR IGNORE INTO symbol_payouts(symbol_id,matches,prize) VALUES(?,?,?)');
      demoSymbols.forEach((symbol,index)=>{
        for(let reels=3;reels<=5;reels++)insert.run(symbol.id,reels,samplePrices[index][reels-3]);
      });
    }
    db.prepare('INSERT INTO demo_setup_flags(name) VALUES(?)').run(flag);
  })();
}
// Percent-based payouts, separate from legacy fixed-credit table for reversible migration.
db.exec(`
  CREATE TABLE IF NOT EXISTS symbol_payout_percentages (
    symbol_id INTEGER NOT NULL REFERENCES game_symbols(id) ON DELETE CASCADE,
    matches INTEGER NOT NULL CHECK(matches BETWEEN 3 AND 20),
    percent INTEGER NOT NULL DEFAULT 0 CHECK(percent BETWEEN 0 AND 10000000000),
    PRIMARY KEY(symbol_id,matches)
  );
`);
db.transaction(()=>{
  const flag='symbol_payout_percentages_migrated_v1';
  if(db.prepare('SELECT 1 FROM demo_setup_flags WHERE name=?').get(flag))return;
  // Previously one "prize" was the number of credits at the 10-credit base bet.
  // Preserve its monetary equivalent: legacy prize 15 => 150% => 15 at stake 10.
  db.prepare(`INSERT OR IGNORE INTO symbol_payout_percentages(symbol_id,matches,percent)
    SELECT symbol_id,matches,prize*10 FROM symbol_payouts WHERE matches BETWEEN 3 AND 20`).run();
  db.prepare('INSERT INTO demo_setup_flags(name) VALUES(?)').run(flag);
})();
// Convert each former percentage to a multiplier with three decimal places.
// Stored as thousandths to avoid floating-point persistence errors.
// Example: 150% -> 1.500x -> coefficient_milli 1500.
db.exec(`
  CREATE TABLE IF NOT EXISTS symbol_payout_multipliers (
    symbol_id INTEGER NOT NULL REFERENCES game_symbols(id) ON DELETE CASCADE,
    matches INTEGER NOT NULL CHECK(matches BETWEEN 3 AND 20),
    coefficient_milli INTEGER NOT NULL DEFAULT 0 CHECK(coefficient_milli BETWEEN 0 AND 1000000),
    PRIMARY KEY(symbol_id,matches)
  );
`);
db.transaction(()=>{
  const flag='symbol_payout_multipliers_migrated_v1';
  if(db.prepare('SELECT 1 FROM demo_setup_flags WHERE name=?').get(flag))return;
  db.prepare(`INSERT OR IGNORE INTO symbol_payout_multipliers(symbol_id,matches,coefficient_milli)
    SELECT symbol_id,matches,percent*10 FROM symbol_payout_percentages
    WHERE matches BETWEEN 3 AND 20 AND percent BETWEEN 0 AND 100000`).run();
  db.prepare('INSERT INTO demo_setup_flags(name) VALUES(?)').run(flag);
})();
// New symbol pricing: a percentage of the stake for ONE occurrence,
// multiplied by the number of occurrences in an uninterrupted reel chain.
// Reel multipliers are indexed by the last consecutive reel (3,4,5,...).
// Former per-count coefficient settings are kept intact for historical rollback.
db.exec(`
  CREATE TABLE IF NOT EXISTS symbol_unit_prices (
    symbol_id INTEGER PRIMARY KEY REFERENCES game_symbols(id) ON DELETE CASCADE,
    percent_hundredths INTEGER NOT NULL DEFAULT 0 CHECK(percent_hundredths BETWEEN 0 AND 1000000)
  );
  CREATE TABLE IF NOT EXISTS symbol_reel_multipliers (
    symbol_id INTEGER NOT NULL REFERENCES game_symbols(id) ON DELETE CASCADE,
    reel_count INTEGER NOT NULL CHECK(reel_count BETWEEN 3 AND 20),
    multiplier_milli INTEGER NOT NULL DEFAULT 1000 CHECK(multiplier_milli BETWEEN 0 AND 1000000),
    PRIMARY KEY(symbol_id,reel_count)
  );
`);
// One-time conversion uses the oldest available non-zero rule to suggest a
// per-occurrence price: coefficient-at-N / N. This cannot preserve the old
// per-count paytable exactly; it never overwrites a subsequently edited price.
db.transaction(()=>{
  const flag='symbol_unit_prices_migrated_v1';
  if(db.prepare('SELECT 1 FROM demo_setup_flags WHERE name=?').get(flag))return;
  const current=db.prepare(`SELECT s.id AS symbol_id,
    (SELECT coefficient_milli*1.0/matches FROM symbol_payout_multipliers p
      WHERE p.symbol_id=s.id AND p.coefficient_milli>0
      ORDER BY matches LIMIT 1) AS unit_coefficient_milli
    FROM game_symbols s`).all();
  const add=db.prepare('INSERT OR IGNORE INTO symbol_unit_prices(symbol_id,percent_hundredths) VALUES(?,?)');
  for(const row of current){
    const percentHundredths=row.unit_coefficient_milli==null?0:
      Math.min(1000000,Math.round(row.unit_coefficient_milli*10));
    add.run(row.symbol_id,percentHundredths);
  }
  db.prepare('INSERT INTO demo_setup_flags(name) VALUES(?)').run(flag);
})();
const starterImages=[
  ['A','/static/images/symbols/premium-letters.svg#a'],['Q','/static/images/symbols/premium-letters.svg#q'],
  ['J','/static/images/symbols/premium-letters.svg#j'],['K','/static/images/symbols/premium-letters.svg#k'],
  ['10','/static/images/symbols/premium-letters.svg#ten'],['9','/static/images/symbols/premium-letters.svg#nine'],
  ['Череп','/static/images/symbols/skull.svg'],['Меч','/static/images/symbols/sword.svg'],
  ['Змея над чашей','/static/images/symbols/snake-cup.svg'],['Дьявол','/static/images/symbols/devil.svg']
];
// Keep library image IDs (and symbol assignments) when upgrading the artwork.
if(firstGame){
  const upgradeArt=db.prepare('UPDATE game_image_library SET builtin_path=? WHERE game_id=? AND builtin_path=?');
  db.transaction(()=>{
    upgradeArt.run('/static/images/symbols/premium-letters.svg#a',firstGame.id,'/static/images/symbols/a.svg');
    upgradeArt.run('/static/images/symbols/premium-letters.svg#q',firstGame.id,'/static/images/symbols/q.svg');
    upgradeArt.run('/static/images/symbols/premium-letters.svg#j',firstGame.id,'/static/images/symbols/j.svg');
    upgradeArt.run('/static/images/symbols/premium-letters.svg#k',firstGame.id,'/static/images/symbols/k.svg');
    upgradeArt.run('/static/images/symbols/premium-letters.svg#ten',firstGame.id,'/static/images/symbols/10.svg');
    upgradeArt.run('/static/images/symbols/premium-letters.svg#nine',firstGame.id,'/static/images/symbols/9.svg');
  })();
}
if(firstGame){
  const addImage=db.prepare('INSERT OR IGNORE INTO game_image_library(game_id,name,builtin_path) VALUES(?,?,?)');
  db.transaction(()=>{for(const row of starterImages)addImage.run(firstGame.id,...row);})();
}
// Apply starter art only to untouched placeholder symbols, once per database.
if(firstGame){
  db.transaction(()=>{
    const flag='first_game_starter_symbol_library_links_v1';
    if(db.prepare('SELECT 1 FROM demo_setup_flags WHERE name=?').get(flag))return;
    const placeholders=db.prepare('SELECT id,name,position FROM game_symbols WHERE game_id=? ORDER BY position,id').all(firstGame.id);
    const selectImage=db.prepare('SELECT id FROM game_image_library WHERE game_id=? AND builtin_path=?');
    const hasAsset=db.prepare('SELECT 1 FROM game_assets WHERE game_id=? AND asset_key=?');
    const link=db.prepare('INSERT OR IGNORE INTO game_symbol_images(symbol_id,library_image_id) VALUES(?,?)');
    const rename=db.prepare('UPDATE game_symbols SET name=? WHERE id=? AND name=?');
    for(let index=0;index<Math.min(10,placeholders.length);index++){
      const symbol=placeholders[index];
      if(symbol.name!=='Символ №'+symbol.position)continue;
      if(hasAsset.get(firstGame.id,'symbol_'+symbol.id))continue;
      const entry=starterImages[index];
      const image=selectImage.get(firstGame.id,entry[1]);
      if(!image)continue;
      link.run(symbol.id,image.id);
      rename.run(entry[0],symbol.id,symbol.name);
    }
    db.prepare('INSERT INTO demo_setup_flags(name) VALUES(?)').run(flag);
  })();
}
// Clean up only untouched demo placeholders without art or payout rules.
if(firstGame){
  const placeholders=db.prepare('SELECT id,name,position FROM game_symbols WHERE game_id=? AND position IN (11,12)').all(firstGame.id);
  for(const symbol of placeholders){
    if(symbol.name!=='Символ №'+symbol.position)continue;
    if(db.prepare('SELECT 1 FROM game_symbol_images WHERE symbol_id=?').get(symbol.id))continue;
    if(db.prepare('SELECT 1 FROM game_assets WHERE game_id=? AND asset_key=?').get(firstGame.id,'symbol_'+symbol.id))continue;
    if(db.prepare('SELECT 1 FROM symbol_payout_multipliers WHERE symbol_id=? AND coefficient_milli>0').get(symbol.id))continue;
    if(db.prepare('SELECT 1 FROM symbol_payout_percentages WHERE symbol_id=? AND percent>0').get(symbol.id))continue;
    if(db.prepare('SELECT 1 FROM symbol_payouts WHERE symbol_id=? AND prize>0').get(symbol.id))continue;
    db.prepare('DELETE FROM game_symbols WHERE id=? AND game_id=?').run(symbol.id,firstGame.id);
  }
}
// First-run content for playable games 2 and 3. Existing game records,
// custom symbols, prices and uploaded backgrounds are not overwritten.
const themedGames=[
  {
    slug:'golden-seven',folder:'egypt',
    symbols:[
      ['Фараон','pharaoh'],['Клеопатра','cleopatra'],['Анубис','anubis'],
      ['Глаз Гора','horus'],['Скарабей','scarab'],['Анкх','ankh'],
      ['Пирамида','pyramid'],['Кобра','cobra'],['Сфинкс','sphinx'],
      ['Солнце Ра','ra'],['Священная кошка','cat']
    ]
  },
  {
    slug:'lucky-stars',folder:'space',
    symbols:[
      ['Ракета','rocket'],['Сатурн','saturn'],['Астронавт','astronaut'],
      ['Галактика','galaxy'],['Луна','moon'],['Спутник','satellite'],
      ['Комета','comet'],['Звезда','star'],['НЛО','ufo'],['Земля','earth']
    ]
  }
];
db.transaction(()=>{
  const selectGame=db.prepare('SELECT id FROM games WHERE slug=?');
  const countSymbols=db.prepare('SELECT COUNT(*) AS count FROM game_symbols WHERE game_id=?');
  const insSymbol=db.prepare('INSERT INTO game_symbols(game_id,name,position) VALUES(?,?,?)');
  const selectSymbol=db.prepare('SELECT id FROM game_symbols WHERE game_id=? AND position=?');
  const insertArt=db.prepare('INSERT OR IGNORE INTO game_image_library(game_id,name,builtin_path) VALUES(?,?,?)');
  const selectArt=db.prepare('SELECT id FROM game_image_library WHERE game_id=? AND builtin_path=?');
  const assignSymbol=db.prepare('INSERT OR IGNORE INTO game_symbol_images(symbol_id,library_image_id) VALUES(?,?)');
  const assignBackground=db.prepare('INSERT OR IGNORE INTO game_background_images(game_id,asset_key,library_image_id) VALUES(?,?,?)');
  const existingUpload=db.prepare('SELECT 1 FROM game_assets WHERE game_id=? AND asset_key=?');
  const seedPrice=db.prepare('INSERT OR IGNORE INTO symbol_unit_prices(symbol_id,percent_hundredths) VALUES(?,?)');
  const seedMultiplier=db.prepare('INSERT OR IGNORE INTO symbol_reel_multipliers(symbol_id,reel_count,multiplier_milli) VALUES(?,?,?)');
  const classicCount=firstGame?countSymbols.get(firstGame.id).count:10;
  for(const item of themedGames){
    const game=selectGame.get(item.slug);if(!game)continue;
    const isEgypt=item.slug==='golden-seven';
    const desiredCount=isEgypt?classicCount+1:item.symbols.length;
    const empty=countSymbols.get(game.id).count===0;
    if(empty){
      for(let n=0;n<desiredCount;n++){
        const entry=item.symbols[n%item.symbols.length];
        const title=n<item.symbols.length?entry[0]:entry[0]+' '+(Math.floor(n/item.symbols.length)+1);
        insSymbol.run(game.id,title,n+1);
      }
    }
    const assets=[
      ['background','Фон игры','background.svg'],
      ['reels_background','Общий фон игрового поля','field.svg'],
      ['cells_background','Фон ячеек','cell.svg'],
      ['logo','Логотип игры','logo.svg']
    ];
    for(const [key,name,file] of assets){
      const src='/static/images/'+item.folder+'/'+file;
      insertArt.run(game.id,name,src);
      const art=selectArt.get(game.id,src);
      if(art&&!existingUpload.get(game.id,key))assignBackground.run(game.id,key,art.id);
    }
    // Images in each game's own folder; symbols may be reassigned by admin.
    for(const [idx,entry] of item.symbols.entries()){
      const src='/static/images/'+item.folder+'/symbols.svg#'+entry[1];
      insertArt.run(game.id,entry[0],src);
      const art=selectArt.get(game.id,src);
      if(empty&&art){
        const symbol=selectSymbol.get(game.id,idx+1);
        if(symbol)assignSymbol.run(symbol.id,art.id);
      }
    }
    if(empty){
      const created=db.prepare('SELECT id,position FROM game_symbols WHERE game_id=? ORDER BY position,id').all(game.id);
      for(const symbol of created){
        const artEntry=item.symbols[(symbol.position-1)%item.symbols.length];
        const image=selectArt.get(game.id,'/static/images/'+item.folder+'/symbols.svg#'+artEntry[1]);
        if(image)assignSymbol.run(symbol.id,image.id);
        seedPrice.run(symbol.id,1100+(symbol.position%5)*350);
        for(let reel=3;reel<=(isEgypt?6:5);reel++)
          seedMultiplier.run(symbol.id,reel,reel===3?1000:reel===4?1400:reel===5?1800:2200);
      }
    }
  }
})();
// Scatter is a special symbol only for the original 5x4 game. The symbol and
// its artwork are created once after other games are seeded, so Egypt still
// gets exactly one more regular symbol than the original game had.
db.exec(`
  CREATE TABLE IF NOT EXISTS game_scatter_symbols (
    game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    symbol_id INTEGER NOT NULL UNIQUE REFERENCES game_symbols(id) ON DELETE RESTRICT
  );
  CREATE TABLE IF NOT EXISTS game_scatter_reels (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    reel_index INTEGER NOT NULL CHECK(reel_index BETWEEN 1 AND 20),
    chance_percent INTEGER NOT NULL CHECK(chance_percent BETWEEN 0 AND 100),
    max_symbols INTEGER NOT NULL CHECK(max_symbols BETWEEN 0 AND 4),
    PRIMARY KEY(game_id,reel_index)
  );
  CREATE TABLE IF NOT EXISTS game_bonus_sessions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    remaining INTEGER NOT NULL CHECK(remaining BETWEEN 1 AND 20),
    multiplier INTEGER NOT NULL CHECK(multiplier BETWEEN 2 AND 100),
    bonus_win INTEGER NOT NULL DEFAULT 0 CHECK(bonus_win >= 0),
    bet INTEGER NOT NULL CHECK(bet BETWEEN 1 AND 1000),
    PRIMARY KEY(user_id,game_id)
  );
`);
// Old installations can also retain a restricted stake list in BONUS sessions.
// At high bets, creating the bonus then fails and rolls back the entire paid
// spin. Rebuild the table in place while preserving active sessions, multipliers,
// remaining spins and accumulated bonus winnings.
const bonusSchema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='game_bonus_sessions'").get()?.sql||'';
if(/["'`\[]?bet["'`\]]?\s+IN\s*\(/i.test(bonusSchema)){
  db.transaction(()=>{
    db.exec(`
      CREATE TABLE game_bonus_sessions_new (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        remaining INTEGER NOT NULL CHECK(remaining BETWEEN 1 AND 20),
        multiplier INTEGER NOT NULL CHECK(multiplier BETWEEN 2 AND 100),
        bonus_win INTEGER NOT NULL DEFAULT 0 CHECK(bonus_win >= 0),
        bet INTEGER NOT NULL CHECK(bet BETWEEN 1 AND 1000),
        PRIMARY KEY(user_id,game_id)
      );
      INSERT INTO game_bonus_sessions_new(user_id,game_id,remaining,multiplier,bonus_win,bet)
      SELECT user_id,game_id,remaining,multiplier,bonus_win,bet FROM game_bonus_sessions;
      DROP TABLE game_bonus_sessions;
      ALTER TABLE game_bonus_sessions_new RENAME TO game_bonus_sessions;
    `);
  })();
}
// Probability weights for exactly 1..4 Scatter on each reel.
// Weights are normalized at spin time; existing per-reel trigger chances stay unchanged.
for(const [column,defaultWeight] of [['weight_1',65],['weight_2',23],['weight_3',8],['weight_4',4]]){
  if(!db.pragma('table_info(game_scatter_reels)').some(item=>item.name===column))
    db.exec('ALTER TABLE game_scatter_reels ADD COLUMN '+column+
      ' INTEGER NOT NULL DEFAULT '+defaultWeight+' CHECK('+column+' BETWEEN 0 AND 100)');
}
if(firstGame){
  db.transaction(()=>{
    const find=db.prepare('SELECT symbol_id FROM game_scatter_symbols WHERE game_id=?').get(firstGame.id);
    let symbolId=find?.symbol_id;
    if(!symbolId){
      const existing=db.prepare("SELECT id FROM game_symbols WHERE game_id=? AND name='SCATTER' ORDER BY id LIMIT 1").get(firstGame.id);
      symbolId=existing?.id??db.prepare('INSERT INTO game_symbols(game_id,name,position) VALUES(?,?,?)')
        .run(firstGame.id,'SCATTER',db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM game_symbols WHERE game_id=?').get(firstGame.id).n).lastInsertRowid;
      db.prepare('INSERT INTO game_scatter_symbols(game_id,symbol_id) VALUES(?,?)').run(firstGame.id,symbolId);
    }
    const art='/static/images/symbols/scatter.svg';
    db.prepare('INSERT OR IGNORE INTO game_image_library(game_id,name,builtin_path) VALUES(?,?,?)').run(firstGame.id,'SCATTER — бонус',art);
    const image=db.prepare('SELECT id FROM game_image_library WHERE game_id=? AND builtin_path=?').get(firstGame.id,art);
    db.prepare('INSERT OR IGNORE INTO game_symbol_images(symbol_id,library_image_id) VALUES(?,?)').run(symbolId,image.id);
    // Scatter never pays as a normal chain.
    db.prepare('INSERT OR IGNORE INTO symbol_unit_prices(symbol_id,percent_hundredths) VALUES(?,0)').run(symbolId);
    const addRule=db.prepare('INSERT OR IGNORE INTO game_scatter_reels(game_id,reel_index,chance_percent,max_symbols) VALUES(?,?,?,?)');
    for(let i=1;i<=5;i++)addRule.run(firstGame.id,i,12,1);
  })();
}
// Egyptian starter artwork and scatters are installed without touching the other games.
require('./egypt-setup')(db);
function getScatterSettings(gameId){
  const symbol=db.prepare('SELECT symbol_id FROM game_scatter_symbols WHERE game_id=?').get(gameId);
  if(!symbol)return null;
  return {symbolId:symbol.symbol_id,rules:db.prepare('SELECT reel_index,chance_percent,max_symbols,weight_1,weight_2,weight_3,weight_4 FROM game_scatter_reels WHERE game_id=? ORDER BY reel_index').all(gameId)};
}
function getBonusSession(userId,gameId){
  return db.prepare('SELECT remaining,multiplier,bonus_win,bet FROM game_bonus_sessions WHERE user_id=? AND game_id=?').get(userId,gameId)||null;
}
function getLibraryImages(gameId){
  return db.prepare(`SELECT l.id,l.name,l.builtin_path,l.file_name FROM game_image_library l
    WHERE l.game_id=? AND NOT EXISTS (SELECT 1 FROM game_hidden_builtin_images h
      WHERE h.game_id=l.game_id AND h.builtin_path=l.builtin_path)
    ORDER BY l.id`).all(gameId);
}
function getGameBackgroundImages(gameId){
  return db.prepare(`SELECT b.asset_key,b.library_image_id,l.name,l.builtin_path,l.file_name
    FROM game_background_images b
    JOIN game_image_library l ON l.id=b.library_image_id AND l.game_id=b.game_id
    WHERE b.game_id=?`).all(gameId);
}
function getSymbolImageLinks(gameId){
  return db.prepare(`SELECT s.id AS symbol_id,l.id AS image_id,l.name,l.builtin_path,l.file_name
    FROM game_symbol_images x JOIN game_symbols s ON s.id=x.symbol_id
    JOIN game_image_library l ON l.id=x.library_image_id AND l.game_id=s.game_id
    WHERE s.game_id=? AND NOT EXISTS (SELECT 1 FROM game_hidden_builtin_images h
      WHERE h.game_id=s.game_id AND h.builtin_path=l.builtin_path)`).all(gameId);
}
function getWallet(userId,gameId) {
  db.prepare('INSERT OR IGNORE INTO game_wallets(user_id,game_id,balance) VALUES(?,?,1000)').run(userId,gameId);
  db.prepare('INSERT OR IGNORE INTO user_balances(user_id,balance) VALUES(?,1000)').run(userId);
  return db.prepare(`SELECT b.balance,w.bet FROM game_wallets w
    JOIN user_balances b ON b.user_id=w.user_id
    WHERE w.user_id=? AND w.game_id=?`).get(userId,gameId);
}
function getSymbols(gameId){
  return db.prepare('SELECT id,game_id,name,position FROM game_symbols WHERE game_id=? ORDER BY position,id').all(gameId);
}
function getPayouts(gameId){
  const prices=db.prepare(`SELECT s.id AS symbol_id,COALESCE(p.percent_hundredths,0) AS percent_hundredths
    FROM game_symbols s LEFT JOIN symbol_unit_prices p ON p.symbol_id=s.id
    WHERE s.game_id=? ORDER BY s.position,s.id`).all(gameId);
  const multipliers=db.prepare(`SELECT r.symbol_id,r.reel_count,r.multiplier_milli
    FROM symbol_reel_multipliers r JOIN game_symbols s ON s.id=r.symbol_id
    WHERE s.game_id=? ORDER BY r.symbol_id,r.reel_count`).all(gameId);
  return {prices,multipliers};
}
function getGameSettings(id) {
  return db.prepare('SELECT win_frequency,big_win_multiplier_milli,mega_win_multiplier_milli FROM game_settings WHERE game_id=?').get(id);
}
function getGameAssets(id) {
  return db.prepare('SELECT asset_key,file_name,media_type FROM game_assets WHERE game_id=?').all(id);
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return salt.toString('hex') + ':' + key.toString('hex');
}
function verifyPassword(password, encoded) {
  const [salt, saved] = String(encoded).split(':');
  if (!salt || !saved || !/^[a-f0-9]{128}$/.test(saved)) return false;
  const computed = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(computed, Buffer.from(saved, 'hex'));
}
function validUsername(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_]{3,30}$/.test(name);
}
function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password,'utf8') <= 256;
}
function getUserByName(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}
function createUser(username,password,role='user') {
  return db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run(username,hashPassword(password),role);
}
function countActiveAdmins() {
  return db.prepare("SELECT COUNT(*) AS total FROM users WHERE role='admin' AND active=1").get().total;
}
function listGames(onlyEnabled=false) {
  return db.prepare('SELECT id,slug,title,image_path,enabled FROM games '+(onlyEnabled?'WHERE enabled=1 ':'')+'ORDER BY position,id').all();
}
function gameById(id) {
  return db.prepare('SELECT id,slug,title,image_path,enabled FROM games WHERE id=?').get(id);
}
module.exports={getScatterSettings,getBonusSession,getGameBackgroundImages,getLibraryImages,getSymbolImageLinks,getWallet,getSymbols,getPayouts,getGameSettings,getGameAssets,listGames,gameById,db,hashPassword,verifyPassword,validUsername,validPassword,getUserByName,createUser,countActiveAdmins};
