// Hobby Tracker front-end glue: Alpine timer ticker, tab title, Chart.js setup.

const BASE_TITLE = document.title;

function formatClock(secs) {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// "⏱ 2 running · 0:42:10" in the browser tab so running timers are not forgotten.
function updateTabTitle() {
  const cards = document.querySelectorAll(".timer-card");
  if (!cards.length) {
    document.title = BASE_TITLE;
    return;
  }
  let longest = 0;
  cards.forEach((c) => { longest = Math.max(longest, Number(c.dataset.secs) || 0); });
  document.title = `⏱ ${cards.length} running · ${formatClock(longest)}`;
}

document.addEventListener("alpine:init", () => {
  // One running-timer card. `base` is the elapsed seconds the server computed
  // when it rendered the card; we add local wall-clock time on top so the clock
  // does not depend on the phone's clock matching the server's.
  window.Alpine.data("timerCard", (base, paused) => ({
    secs: base,
    loadedAt: Date.now(),
    handle: null,
    get clock() { return formatClock(this.secs); },
    init() {
      if (paused) return;
      this.handle = setInterval(() => {
        this.secs = base + Math.floor((Date.now() - this.loadedAt) / 1000);
      }, 1000);
    },
    destroy() { clearInterval(this.handle); },
  }));
});

setInterval(updateTabTitle, 1000);
document.addEventListener("DOMContentLoaded", updateTabTitle);
document.addEventListener("htmx:afterSettle", updateTabTitle);

// --- Charts (Statistics page) ---

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hoursLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

function initStatsCharts() {
  const dataEl = document.getElementById("stats-data");
  if (!dataEl || !window.Chart) return;
  const data = JSON.parse(dataEl.textContent);
  const grid = cssVar("--grid", "rgba(255,255,255,0.08)");
  const text = cssVar("--muted", "#94a3b8");
  const accent = data.color || cssVar("--accent", "#22c55e");
  Chart.defaults.color = text;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

  const barEl = document.getElementById("chart-series");
  if (barEl) {
    const datasets = [{
      type: "bar",
      label: "Minutes",
      data: data.series.values,
      backgroundColor: accent,
      borderRadius: 3,
      maxBarThickness: 28,
    }];
    if (data.goal_min && data.series.unit === "day") {
      datasets.push({
        type: "line",
        label: "Daily goal",
        data: data.series.values.map(() => data.goal_min),
        borderColor: "#f59e0b",
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
      });
    }
    new Chart(barEl, {
      data: { labels: data.series.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: datasets.length > 1, labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${hoursLabel(ctx.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: { beginAtZero: true, grid: { color: grid }, ticks: { callback: (v) => (v >= 60 ? `${Math.round(v / 6) / 10} h` : `${v} m`) } },
        },
      },
    });
  }
}

document.addEventListener("DOMContentLoaded", initStatsCharts);

// Register the service worker for PWA install / offline shell.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
