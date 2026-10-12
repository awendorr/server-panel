#!/usr/bin/env node
// Kullanım: npm run create-user -- <kullanıcı_adı>
// Kullanıcı varsa şifresi güncellenir. Otomasyon için şifre PANEL_PASSWORD ile de verilebilir.
const readline = require('readline');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(question);
      else if (s.includes('\n') || s.includes('\r')) rl.output.write('\n');
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

(async () => {
  const username = process.argv[2];
  if (!username) {
    console.error('Kullanım: npm run create-user -- <kullanıcı_adı>');
    process.exit(1);
  }
  let password = process.env.PANEL_PASSWORD;
  if (!password) {
    password = await askHidden('Şifre: ');
    const again = await askHidden('Şifre (tekrar): ');
    if (password !== again) {
      console.error('Şifreler eşleşmiyor.');
      process.exit(1);
    }
  }
  const userService = require('../services/userService');
  try {
    const r = await userService.create(username, password);
    console.log(r.updated ? `"${username}" kullanıcısının şifresi güncellendi.` : `"${username}" kullanıcısı oluşturuldu.`);
  } catch (err) {
    console.error('Hata:', err.message);
    process.exit(1);
  }
})();
