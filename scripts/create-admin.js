const readline = require('node:readline');
const { db, hashPassword, validUsername, validPassword, getUserByName } = require('../db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = question => new Promise(resolve => rl.question(question,resolve));
(async()=>{
  try {
    const username=(await ask('Имя администратора [admin]: ')).trim() || 'admin';
    if(!validUsername(username))throw new Error('Логин: 3–30 латинских букв, цифр и _');
    const password=await ask('Пароль администратора (будет виден в терминале): ');
    if(!validPassword(password))throw new Error('Пароль должен содержать хотя бы 5 символов и не более 256 байт');
    if(getUserByName(username))throw new Error('Аккаунт уже существует. Новый пароль через этот скрипт не устанавливается.');
    db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,'admin')").run(username,hashPassword(password));
    console.log('Администратор создан. Смените тестовый пароль перед публичным запуском.');
  } catch(e) {
    console.error(e.message);
    process.exitCode=1;
  } finally {rl.close();db.close();}
})();
