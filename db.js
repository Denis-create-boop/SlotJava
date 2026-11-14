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

`);

const initialGames=[
  ['slot-classic','Слот Классик','/static/images/game-slot.svg',1],
  ['golden-seven','Золотая Семёрка','/static/images/game-seven.svg',2],
  ['lucky-stars','Счастливые Звёзды','/static/images/game-stars.svg',3]
];
const seedGame=db.prepare('INSERT OR IGNORE INTO games(slug,title,image_path,position) VALUES(?,?,?,?)');
db.transaction(()=>{ for(const game of initialGames) seedGame.run(...game); })();

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
module.exports={listGames,gameById,db,hashPassword,verifyPassword,validUsername,validPassword,getUserByName,createUser,countActiveAdmins};
