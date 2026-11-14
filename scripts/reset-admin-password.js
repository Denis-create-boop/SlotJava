const readline = require('node:readline');
const { db, hashPassword, validPassword, getUserByName } = require('../db');

const rl = readline.createInterface({input: process.stdin,output:process.stdout,terminal:true});
const ask = q => new Promise(resolve => rl.question(q,resolve));
(async () => {
  try {
    const username=(await ask('Логин администратора [admin]: ')).trim() || 'admin';
    const user=getUserByName(username);
    if(!user || user.role!=='admin') throw new Error('Администратор не найден');
    const password=await ask('Новый пароль (отображается в терминале; используйте приватный терминал): ');
    if(!validPassword(password)) throw new Error('Новый пароль: минимум 12 символов, максимум 256 байт');
    db.transaction(()=>{
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    })();
    console.log('Пароль изменён, все предыдущие сеансы завершены.');
  } catch(e){ console.error(e.message); process.exitCode=1; }
  finally {rl.close();db.close();}
})();
