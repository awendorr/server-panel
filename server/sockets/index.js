const { Server } = require('socket.io');
const { socketAuth, isActive } = require('../middleware/auth');
const { sameOrigin } = require('../middleware/security');
const metricsSocket = require('./metrics');
const pm2Socket = require('./pm2');
const terminalSocket = require('./terminal');
const alertService = require('../services/alertService');

const SESSION_CHECK_MS = 60 * 1000;

function setupSockets(httpServer, sessionMiddleware) {
  const io = new Server(httpServer, {
    serveClient: true,
    allowRequest: (req, cb) => cb(null, sameOrigin(req)),
    maxHttpBufferSize: 1e6,
  });

  // Express oturumunu Socket.IO ile paylaş
  io.engine.use(sessionMiddleware);
  io.use(socketAuth);

  const handlers = [metricsSocket.register(io), pm2Socket.register(io), terminalSocket.register(io)];

  // Uyarılar giriş yapmış tüm panellere gider
  alertService.on('fired', (e) => io.emit('alert:fired', e));
  alertService.on('resolved', (e) => io.emit('alert:resolved', e));

  io.on('connection', (socket) => {
    // Çıkış yapıldığında bu oturumun soketlerini kapatabilmek için
    socket.join(`sess:${socket.request.sessionID}`);
    handlers.forEach((h) => h(socket));
  });

  // Süresi dolan ya da silinen oturumların soketlerini kapat
  setInterval(() => {
    for (const socket of io.of('/').sockets.values()) {
      const sess = socket.request.session;
      if (!sess) { socket.disconnect(true); continue; }
      sess.reload((err) => {
        if (err || !isActive(socket.request.session)) socket.disconnect(true);
      });
    }
  }, SESSION_CHECK_MS).unref();

  return io;
}

module.exports = { setupSockets };
