if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

Panel.init().catch((err) => {
  console.error(err);
  Panel.toast('Panel başlatılamadı: ' + err.message, 'error', 0);
});
