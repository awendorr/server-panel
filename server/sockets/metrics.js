const metricsService = require('../services/metricsService');

function register(io) {
  // Tek bir ölçüm döngüsü; sonucu bağlı tüm panellere yayınla
  metricsService.on('sample', (sample) => {
    io.to('metrics').emit('metrics', sample);
  });

  return (socket) => {
    socket.on('metrics:subscribe', () => {
      socket.join('metrics');
      const latest = metricsService.getLatest();
      if (latest) socket.emit('metrics', latest);
    });
    socket.on('metrics:unsubscribe', () => socket.leave('metrics'));
  };
}

module.exports = { register };
