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
function getWallet(userId,gameId) {
  db.prepare('INSERT OR IGNORE INTO game_wallets(user_id,game_id,balance) VALUES(?,?,1000)').run(userId,gameId);
  return db.prepare('SELECT balance,bet FROM game_wallets WHERE user_id=? AND game_id=?').get(userId,gameId);
}
function getSymbols(gameId){
  return db.prepare('SELECT id,game_id,name,position FROM game_symbols WHERE game_id=? ORDER BY position,id').all(gameId);
}
function getPayouts(gameId){
  return db.prepare('SELECT p.symbol_id,p.matches,p.prize FROM symbol_payouts p JOIN game_symbols s ON s.id=p.symbol_id WHERE s.game_id=? ORDER BY p.symbol_id,p.matches').all(gameId);
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
module.exports={getWallet,getSymbols,getPayouts,getGameSettings,getGameAssets,listGames,gameById,db,hashPassword,verifyPassword,validUsername,validPassword,getUserByName,createUser,countActiveAdmins};
