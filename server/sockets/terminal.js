const terminal = require('../services/terminalService');
const audit = require('../services/auditService');

function register() {
  return (socket) => {
    socket.on('term:open', (opts, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const t = terminal.open(socket.id, opts || {},
          (id, data) => socket.emit('term:data', { id, data }),
          (id, code) => {
            socket.emit('term:exit', { id, code });
            audit.log(socket, 'terminal.exit', { target: id, details: { code } });
          });
        audit.log(socket, 'terminal.open', { target: t.id, details: { shell: t.shell, pid: t.pid } });
        ack({ ok: true, id: t.id, shell: t.shell });
      } catch (err) {
        audit.log(socket, 'terminal.open', { details: { error: err.message }, success: false });
        ack({ ok: false, error: err.message });
      }
    });

    socket.on('term:input', (msg) => {
      if (msg && typeof msg.id === 'string') terminal.write(msg.id, socket.id, msg.data);
    });

    socket.on('term:resize', (msg) => {
      if (msg && typeof msg.id === 'string') terminal.resize(msg.id, socket.id, msg.cols, msg.rows);
    });

    socket.on('term:close', (msg) => {
      if (msg && typeof msg.id === 'string' && terminal.close(msg.id, socket.id)) {
        audit.log(socket, 'terminal.close', { target: msg.id });
      }
    });

    // Bağlantı kopunca (çıkış, sekme kapama) tüm kabuklar sonlandırılır
    socket.on('disconnect', () => {
      for (const t of terminal.closeAllFor(socket.id)) {
        audit.log(socket, 'terminal.close', { target: t.id, details: { reason: 'disconnect' } });
      }
    });
  };
}

module.exports = { register };
