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
    let answered = false;
    // Ctrl+C ya da girişin kapanması (Ctrl+D) kullanıcı oluşturulmadan çıkış demek: hata koduyla bit
    rl.on('SIGINT', () => {
      rl.output.write('\n');
      process.exit(130);
    });
    rl.on('close', () => {
      if (answered) return;
      rl.output.write('\n');
      console.error('İptal edildi, kullanıcı oluşturulmadı.');
      process.exit(1);
    });
    rl.question(question, (answer) => {
      answered = true;
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
    if (!r.updated) console.log(`"${username}" kullanıcısı oluşturuldu.`);
    else console.log(`"${username}" kullanıcısının şifresi güncellendi.${r.sessionsEnded ? ` Açık ${r.sessionsEnded} oturum kapatıldı.` : ''}`);
  } catch (err) {
    console.error('Hata:', err.message);
    process.exit(1);
  }
})();
