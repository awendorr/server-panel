const pm2Service = require('../services/pm2Service');

const LIST_INTERVAL_MS = 2000;

function register(io) {
  let timer = null;

  // Liste yalnızca PM2 sayfasını açık tutan biri varsa yayınlanır
  async function broadcastList() {
    const room = io.sockets.adapter.rooms.get('pm2');
    if (!room || room.size === 0) {
      clearInterval(timer);
      timer = null;
      return;
    }
    try {
      io.to('pm2').emit('pm2:list', await pm2Service.list());
    } catch (err) {
      io.to('pm2').emit('pm2:error', 'PM2 ile bağlantı kurulamadı: ' + err.message);
    }
  }

  pm2Service.on('log', (entry) => {
    io.to(`pm2log:${entry.id}`).emit('pm2:log', entry);
  });

  return (socket) => {
    socket.on('pm2:subscribe', () => {
      socket.join('pm2');
      pm2Service.startBus();
      broadcastList();
      if (!timer) timer = setInterval(broadcastList, LIST_INTERVAL_MS);
    });
    socket.on('pm2:unsubscribe', () => socket.leave('pm2'));

    // Bir sürecin canlı loglarını izle (aynı anda tek süreç)
    socket.on('pm2:logs:subscribe', (id) => {
      for (const r of socket.rooms) if (r.startsWith('pm2log:')) socket.leave(r);
      if (Number.isInteger(id) && id >= 0) socket.join(`pm2log:${id}`);
    });
    socket.on('pm2:logs:unsubscribe', () => {
      for (const r of socket.rooms) if (r.startsWith('pm2log:')) socket.leave(r);
    });
  };
}

module.exports = { register };
