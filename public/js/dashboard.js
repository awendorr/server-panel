(function () {
  const { fmt } = Panel;
  const LIVE_POINTS = 150; // 2 sn aralıkla ~5 dakika

  const COLORS = {
    emerald: '#10b981', sky: '#38bdf8', amber: '#f59e0b', rose: '#f43f5e', violet: '#a78bfa', slate: '#94a3b8',
  };

  // Grafik tanımları: canlı örnekten ve geçmiş satırından değer okuma
  const CHARTS = [
    { id: 'cpu', title: 'CPU kullanımı', unit: 'pct', max: 100, series: [
      { label: 'CPU', color: COLORS.emerald, live: (s) => s.cpu.total, hist: (p) => p.cpu },
    ] },
    { id: 'mem', title: 'Bellek', unit: 'pct', max: 100, series: [
      { label: 'RAM', color: COLORS.sky, live: (s) => (s.mem ? (s.mem.used / s.mem.total) * 100 : null), hist: (p) => p.mem },
      { label: 'Swap', color: COLORS.violet, live: (s) => (s.mem && s.mem.swapTotal ? (s.mem.swapUsed / s.mem.swapTotal) * 100 : null), hist: (p) => p.swap },
    ] },
    { id: 'net', title: 'Ağ trafiği', unit: 'rate', series: [
      { label: 'İndirme', color: COLORS.sky, live: (s) => s.net.rxBps, hist: (p) => p.rx },
      { label: 'Yükleme', color: COLORS.amber, live: (s) => s.net.txBps, hist: (p) => p.tx },
    ] },
    { id: 'io', title: 'Disk G/Ç', unit: 'rate', series: [
      { label: 'Okuma', color: COLORS.emerald, live: (s) => s.diskIO.readBps, hist: (p) => p.read },
      { label: 'Yazma', color: COLORS.rose, live: (s) => s.diskIO.writeBps, hist: (p) => p.write },
    ] },
    { id: 'load', title: 'Load average', unit: 'num', series: [
      { label: '1 dk', color: COLORS.amber, live: (s) => s.load[0], hist: (p) => p.load1 },
      { label: '5 dk', color: COLORS.sky, live: (s) => s.load[1], hist: (p) => p.load5 },
      { label: '15 dk', color: COLORS.slate, live: (s) => s.load[2], hist: (p) => p.load15 },
    ] },
    { id: 'temp', title: 'CPU sıcaklığı', unit: 'temp', series: [
      { label: '°C', color: COLORS.rose, live: (s) => s.cpu.temp, hist: (p) => p.temp },
    ] },
  ];

  const RANGES = [
    { id: 'live', label: 'Canlı' },
    { id: '1h', label: '1 saat' },
    { id: '24h', label: '24 saat' },
    { id: '7d', label: '7 gün' },
  ];

  let root = null;
  let socket = null;
  let charts = {};
  let range = 'live';
  let liveBuffer = [];
  let histTimer = null;
  let onMetrics = null;

  function formatValue(unit, v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    if (unit === 'pct') return `${v.toFixed(0)}%`;
    if (unit === 'rate') return fmt.rate(v);
    if (unit === 'temp') return `${v.toFixed(0)}°C`;
    return v.toFixed(2);
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    const hm = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    if (range === '7d') return `${d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })} ${hm}`;
    if (range === 'live') return d.toLocaleTimeString('tr-TR');
    return hm;
  }

  function card(id, title) {
    return `<div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div class="text-xs uppercase tracking-wide text-slate-400">${title}</div>
      <div id="stat-${id}" class="tabular mt-1 text-2xl font-semibold">–</div>
      <div id="stat-${id}-sub" class="tabular mt-1 text-xs text-slate-400 truncate">&nbsp;</div>
    </div>`;
  }

  function template() {
    return `
      <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold">Dashboard</h1>
          <p id="sys-info" class="text-sm text-slate-400">&nbsp;</p>
        </div>
      </div>

      <section class="grid grid-cols-2 gap-3 md:grid-cols-4">
        ${card('cpu', 'CPU')}
        ${card('mem', 'RAM')}
        ${card('swap', 'Swap')}
        ${card('temp', 'Sıcaklık')}
        ${card('load', 'Load avg')}
        ${card('net', 'Ağ')}
        ${card('io', 'Disk G/Ç')}
        ${card('uptime', 'Uptime')}
      </section>

      <section class="mt-6">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-semibold">Grafikler</h2>
          <div id="range-tabs" class="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-1 text-sm">
            ${RANGES.map((r) => `<button data-range="${r.id}" class="range-btn rounded-md px-3 py-1 text-slate-300">${r.label}</button>`).join('')}
          </div>
        </div>
        <div class="grid gap-4 lg:grid-cols-2">
          ${CHARTS.map((c) => `
            <div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div class="mb-2 flex items-center justify-between">
                <h3 class="text-sm font-medium text-slate-300">${c.title}</h3>
                <span id="chart-${c.id}-now" class="tabular text-sm text-slate-400"></span>
              </div>
              <div class="chart-box"><canvas id="chart-${c.id}"></canvas></div>
              <p id="chart-${c.id}-empty" class="hidden -mt-28 mb-24 text-center text-sm text-slate-500">Veri yok</p>
            </div>`).join('')}
        </div>
      </section>

      <section class="mt-6 grid gap-4 lg:grid-cols-2">
        <div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 class="mb-3 text-sm font-medium text-slate-300">Çekirdek bazlı kullanım</h3>
          <div id="cores" class="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2"></div>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 class="mb-3 text-sm font-medium text-slate-300">Disk bölümleri</h3>
          <div id="disks" class="space-y-3"></div>
        </div>
      </section>
    `;
  }

  function createCharts() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(51,65,85,0.5)';
    Chart.defaults.font.family = 'ui-sans-serif, system-ui, sans-serif';

    for (const def of CHARTS) {
      const ctx = root.querySelector(`#chart-${def.id}`);
      charts[def.id] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: def.series.map((s) => ({
            label: s.label,
            data: [],
            borderColor: s.color,
            backgroundColor: s.color + '22',
            fill: def.series.length === 1,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.25,
            spanGaps: true,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: def.series.length > 1, labels: { boxWidth: 10, boxHeight: 10 } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatValue(def.unit, c.parsed.y)}` } },
          },
          scales: {
            x: { ticks: { maxTicksLimit: 6, maxRotation: 0, autoSkip: true }, grid: { display: false } },
            y: {
              beginAtZero: true,
              suggestedMax: def.max,
              max: def.max,
              ticks: { maxTicksLimit: 5, callback: (v) => formatValue(def.unit, v) },
            },
          },
        },
      });
    }
  }

  function setChartData(points, getter) {
    for (const def of CHARTS) {
      const chart = charts[def.id];
      chart.data.labels = points.map((p) => timeLabel(p.ts));
      def.series.forEach((s, i) => { chart.data.datasets[i].data = points.map((p) => s[getter](p) ?? null); });
      const hasData = chart.data.datasets.some((d) => d.data.some((v) => v !== null));
      root.querySelector(`#chart-${def.id}-empty`).classList.toggle('hidden', hasData || points.length === 0);
      chart.update('none');
    }
  }

  function renderLiveCharts() {
    setChartData(liveBuffer, 'live');
  }

  async function loadHistory() {
    try {
      const data = await Panel.api(`/api/metrics/history?range=${range}`);
      if (range === data.range) setChartData(data.points, 'hist');
    } catch (err) {
      Panel.toast('Geçmiş veriler alınamadı: ' + err.message, 'error');
    }
  }

  function setRange(r) {
    range = r;
    root.querySelectorAll('.range-btn').forEach((b) => {
      const on = b.dataset.range === r;
      b.classList.toggle('bg-slate-700', on);
      b.classList.toggle('text-white', on);
    });
    clearInterval(histTimer);
    if (r === 'live') {
      renderLiveCharts();
    } else {
      loadHistory();
      histTimer = setInterval(loadHistory, 60 * 1000);
    }
  }

  function updateStats(s) {
    const set = (id, main, sub) => {
      root.querySelector(`#stat-${id}`).textContent = main;
      if (sub !== undefined) root.querySelector(`#stat-${id}-sub`).textContent = sub;
    };
    document.querySelectorAll('[data-hostname]').forEach((el) => { el.textContent = s.hostname; });
    root.querySelector('#sys-info').textContent = `${s.hostname} · ${s.platform} · ${s.cpuCount} çekirdek`;

    set('cpu', fmt.pct(s.cpu.total, 0), `${s.cpuCount} çekirdek`);
    if (s.mem) {
      set('mem', fmt.pct((s.mem.used / s.mem.total) * 100, 0), `${fmt.bytes(s.mem.used)} / ${fmt.bytes(s.mem.total)}`);
      set('swap', s.mem.swapTotal ? fmt.pct((s.mem.swapUsed / s.mem.swapTotal) * 100, 0) : '–',
        s.mem.swapTotal ? `${fmt.bytes(s.mem.swapUsed)} / ${fmt.bytes(s.mem.swapTotal)}` : 'Swap yok');
    }
    set('temp', s.cpu.temp !== null ? `${s.cpu.temp.toFixed(0)}°C` : '–', s.cpu.temp !== null ? 'CPU paketi' : 'Sensör yok');
    set('load', s.load[0].toFixed(2), `${s.load[1].toFixed(2)} · ${s.load[2].toFixed(2)}`);
    set('net', `↓ ${fmt.rate(s.net.rxBps)}`, `↑ ${fmt.rate(s.net.txBps)}`);
    set('io', `R ${fmt.rate(s.diskIO.readBps)}`, `W ${fmt.rate(s.diskIO.writeBps)}`);
    set('uptime', fmt.duration(s.uptime), new Date(Date.now() - s.uptime * 1000).toLocaleString('tr-TR'));

    for (const def of CHARTS) {
      const vals = def.series.map((x) => formatValue(def.unit, x.live(s)));
      root.querySelector(`#chart-${def.id}-now`).textContent = vals.join(' · ');
    }

    root.querySelector('#cores').innerHTML = s.cpu.cores.map((c, i) => `
      <div class="flex items-center gap-3 text-xs">
        <span class="w-10 text-slate-400">#${i}</span>
        <div class="bar flex-1"><span class="${fmt.levelColor(c)}" style="width:${Math.min(100, c || 0).toFixed(1)}%"></span></div>
        <span class="tabular w-12 text-right">${fmt.pct(c, 0)}</span>
      </div>`).join('');

    root.querySelector('#disks').innerHTML = s.disks.length ? s.disks.map((d) => {
      const p = d.size ? (d.used / d.size) * 100 : 0;
      return `<div>
        <div class="mb-1 flex items-center justify-between gap-2 text-xs">
          <span class="truncate"><span class="font-medium text-slate-200">${fmt.escapeHtml(d.mount)}</span>
            <span class="text-slate-500">${fmt.escapeHtml(d.fs)} · ${fmt.escapeHtml(d.type)}</span></span>
          <span class="tabular shrink-0 text-slate-400">${fmt.bytes(d.used)} / ${fmt.bytes(d.size)} · ${fmt.pct(p, 0)}</span>
        </div>
        <div class="bar"><span class="${fmt.levelColor(p)}" style="width:${p.toFixed(1)}%"></span></div>
      </div>`;
    }).join('') : '<p class="text-sm text-slate-500">Disk bilgisi yok</p>';
  }

  function handleSample(s) {
    liveBuffer.push(s);
    if (liveBuffer.length > LIVE_POINTS) liveBuffer.shift();
    updateStats(s);
    if (range === 'live') renderLiveCharts();
  }

  Panel.register('dashboard', {
    mount(el, sock) {
      root = el;
      socket = sock;
      root.innerHTML = template();
      createCharts();
      root.querySelector('#range-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-range]');
        if (b) setRange(b.dataset.range);
      });
      setRange('live');

      // Canlı tamponu kısa geçmişle doldur, sonra soketten devam et
      Panel.api('/api/metrics/history?range=1h').then((data) => {
        if (!root || liveBuffer.length > 5) return;
        const cutoff = Date.now() - LIVE_POINTS * 2000;
        const old = data.points.filter((p) => p.ts >= cutoff).map(histToSample);
        liveBuffer = old.concat(liveBuffer).slice(-LIVE_POINTS);
        if (range === 'live') renderLiveCharts();
      }).catch(() => {});

      onMetrics = handleSample;
      socket.on('metrics', onMetrics);
      if (socket.connected) socket.emit('metrics:subscribe');
    },
    onReconnect(sock) {
      sock.emit('metrics:subscribe');
    },
    unmount() {
      if (socket && onMetrics) {
        socket.off('metrics', onMetrics);
        socket.emit('metrics:unsubscribe');
      }
      clearInterval(histTimer);
      Object.values(charts).forEach((c) => c.destroy());
      charts = {};
      liveBuffer = [];
      root = null;
    },
  });

  // Geçmiş satırını canlı örnek biçimine çevir (tamponun başını doldurmak için)
  function histToSample(p) {
    return {
      ts: p.ts,
      cpu: { total: p.cpu, temp: p.temp, cores: [] },
      load: [p.load1, p.load5, p.load15],
      mem: p.mem === null ? null : { used: p.mem, total: 100, swapUsed: p.swap, swapTotal: p.swap === null ? 0 : 100 },
      diskIO: { readBps: p.read, writeBps: p.write },
      net: { rxBps: p.rx, txBps: p.tx },
    };
  }
})();
