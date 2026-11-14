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

// Existing wallets retain their balance; add a persisted choice of test stake.
if(!db.pragma('table_info(game_wallets)').some(column=>column.name==='bet')){
  db.exec('ALTER TABLE game_wallets ADD COLUMN bet INTEGER NOT NULL DEFAULT 10 CHECK(bet IN (10,20,50,100))');
}
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
function getLibraryImages(gameId){
  return db.prepare('SELECT id,name,builtin_path,file_name FROM game_image_library WHERE game_id=? ORDER BY id').all(gameId);
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
    WHERE s.game_id=?`).all(gameId);
}
function getWallet(userId,gameId) {
  db.prepare('INSERT OR IGNORE INTO game_wallets(user_id,game_id,balance) VALUES(?,?,1000)').run(userId,gameId);
  return db.prepare('SELECT balance,bet FROM game_wallets WHERE user_id=? AND game_id=?').get(userId,gameId);
}
function getSymbols(gameId){
  return db.prepare('SELECT id,game_id,name,position FROM game_symbols WHERE game_id=? ORDER BY position,id').all(gameId);
}
function getPayouts(gameId){
  return db.prepare('SELECT p.symbol_id,p.matches,p.coefficient_milli FROM symbol_payout_multipliers p JOIN game_symbols s ON s.id=p.symbol_id WHERE s.game_id=? ORDER BY p.symbol_id,p.matches').all(gameId);
}
function getGameSettings(id) {
  return db.prepare('SELECT win_frequency FROM game_settings WHERE game_id=?').get(id);
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
module.exports={getGameBackgroundImages,getLibraryImages,getSymbolImageLinks,getWallet,getSymbols,getPayouts,getGameSettings,getGameAssets,listGames,gameById,db,hashPassword,verifyPassword,validUsername,validPassword,getUserByName,createUser,countActiveAdmins};
