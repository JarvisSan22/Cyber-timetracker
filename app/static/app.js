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
document.addEventListener("htmx:load", updateTabTitle);

// --- Charts (Statistics page) ---

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
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
  const grid = hexToRgba(cssVar("--text", "#ffffff"), 0.1);
  const text = cssVar("--muted", "#94a3b8");
  const accent = data.color || cssVar("--accent", "#22c55e");
  Chart.defaults.color = text;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 13;

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
        borderColor: cssVar("--accent-2", "#00f0ff"),
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

// Heatmap: show the most recent weeks first on narrow screens.
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".heatmap-wrap").forEach((el) => { el.scrollLeft = el.scrollWidth; });
});

// Settings > Theme: live preview of presets and color pickers on the whole page.
function inkFor(hex) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? "#000000" : "#ffffff";
}

document.addEventListener("alpine:init", () => {
  window.Alpine.data("themeEditor", (presets, current) => ({
    preset: current,
    pickers() { return this.$root.querySelectorAll("input[type=color][data-key]"); },
    apply() {
      const root = document.documentElement;
      const p = presets[this.preset];
      root.dataset.theme = p.scheme;
      root.dataset.preset = this.preset;
      Object.entries(p.fonts).forEach(([k, v]) => root.style.setProperty(`--${k}`, v));
      this.pickers().forEach((el) => root.style.setProperty(`--${el.dataset.key}`, el.value));
      root.style.setProperty("--accent-ink", inkFor(root.style.getPropertyValue("--accent").trim()));
      root.style.setProperty("--danger-ink", inkFor(root.style.getPropertyValue("--danger").trim()));
    },
    choose(name) {
      this.preset = name;
      this.reset();
    },
    reset() {
      const colors = presets[this.preset].colors;
      this.pickers().forEach((el) => { el.value = colors[el.dataset.key]; });
      this.apply();
    },
  }));
});

// Projects page: /projects#project-3 (the Timer page's ✎ links) opens that project's tags.
function openHashTarget() {
  const target = location.hash.length > 1 && document.getElementById(location.hash.slice(1));
  if (target) {
    target.querySelector("details")?.setAttribute("open", "");
    target.scrollIntoView({ block: "start" });
  }
}
document.addEventListener("DOMContentLoaded", openHashTarget);
window.addEventListener("hashchange", openHashTarget);

// Register the service worker for PWA install / offline shell.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
