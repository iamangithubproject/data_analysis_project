/* ============================================================
   StockSense AI — dashboard logic
   ============================================================ */

"use strict";

const els = {
  form: document.getElementById("analyze-form"),
  symbolInput: document.getElementById("symbol-input"),
  quickSymbols: document.getElementById("quick-symbols"),
  loading: document.getElementById("loading"),
  loadingStep: document.getElementById("loading-step"),
  errorBox: document.getElementById("error-box"),
  errorMessage: document.getElementById("error-message"),
  results: document.getElementById("results"),
  exportBtn: document.getElementById("export-btn"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  chatMessages: document.getElementById("chat-messages"),
};

const QUICK_SYMBOLS = ["AAPL", "TSLA", "MSFT", "GOOGL", "AMZN", "NVDA", "META"];
const LOADING_STEPS = [
  "Connecting to market data…",
  "Retrieving one year of price history…",
  "Calculating RSI(14)…",
  "Fitting the 30-day linear trend…",
  "Generating AI insights…",
];

let currentSymbol = null;
let priceChart = null;
let volumeChart = null;
let loaderTimer = null;

/* ---------------- Helpers ---------------- */

async function fetchJSON(url) {
  const res = await fetch(url);
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (HTTP ${res.status})`);
  }
  return data;
}

function fmtMoney(value, currency) {
  if (value === null || value === undefined || isNaN(value)) return "—";
  const symbol = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥" }[currency] || "";
  return `${symbol}${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${symbol ? "" : currency || ""}`.trim();
}

function fmtBig(value) {
  if (value === null || value === undefined || isNaN(value)) return "—";
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toLocaleString();
}

function setChangeBadge(el, change, changePct, currency) {
  const cls = change > 0 ? "change-up" : change < 0 ? "change-down" : "change-flat";
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "•";
  const sign = change > 0 ? "+" : "";
  el.className = `stat-sub ${cls}`;
  el.textContent = `${arrow} ${sign}${change.toFixed(2)} (${sign}${changePct.toFixed(2)}%) vs prev close · ${currency}`;
}

const REC_CLASS = { BUY: "rec-buy", SELL: "rec-sell", HOLD: "rec-hold" };
const REC_ICON = { BUY: "bi-arrow-up-circle-fill", SELL: "bi-arrow-down-circle-fill", HOLD: "bi-dash-circle-fill" };

/* ---------------- Loading / errors ---------------- */

function showLoading(on) {
  els.loading.classList.toggle("d-none", !on);
  if (on) {
    els.results.classList.add("d-none");
    hideError();
  }
  const btnSpinner = els.form.querySelector(".btn-spinner");
  const btnLabel = els.form.querySelector(".btn-label");
  btnSpinner.classList.toggle("d-none", !on);
  btnLabel.classList.toggle("d-none", on);
  if (on) {
    let i = 0;
    els.loadingStep.textContent = LOADING_STEPS[0];
    loaderTimer = setInterval(() => {
      i = (i + 1) % LOADING_STEPS.length;
      els.loadingStep.textContent = LOADING_STEPS[i];
    }, 750);
  } else {
    clearInterval(loaderTimer);
  }
}

function showError(message) {
  els.errorMessage.textContent = message;
  els.errorBox.classList.remove("d-none");
}

function hideError() {
  els.errorBox.classList.add("d-none");
}

/* ---------------- Rendering ---------------- */

function renderHeader(a) {
  document.title = `${a.symbol} — StockSense AI`;
  document.getElementById("stock-name").textContent = a.name;
  document.getElementById("stock-symbol").textContent = a.symbol;
  document.getElementById("stock-sector-line").textContent =
    `${a.sector} · ${a.industry}`;
}

function renderStats(a) {
  document.getElementById("stat-price").textContent = fmtMoney(a.latest_price, a.currency);
  setChangeBadge(
    document.getElementById("stat-change"),
    a.change, a.change_pct, a.currency
  );

  // RSI value + gauge marker
  const rsiEl = document.getElementById("stat-rsi");
  const marker = document.getElementById("rsi-marker");
  if (a.rsi === null) {
    rsiEl.textContent = "N/A";
    rsiEl.style.color = "var(--muted)";
    marker.style.left = "50%";
    marker.style.opacity = "0.3";
  } else {
    rsiEl.textContent = a.rsi.toFixed(2);
    rsiEl.style.color = a.rsi < 30 ? "var(--buy)" : a.rsi > 70 ? "var(--sell)" : "var(--text)";
    marker.style.left = `${Math.min(100, Math.max(0, a.rsi))}%`;
    marker.style.opacity = "1";
  }

  // Recommendation
  const recEl = document.getElementById("stat-rec");
  recEl.textContent = a.recommendation;
  recEl.className = `rec-badge ${REC_CLASS[a.recommendation] || "rec-hold"}`;
  document.getElementById("stat-rec-sub").textContent =
    a.rsi === null ? "Insufficient RSI data" : `Based on RSI ${a.rsi}`;

  // Forecast
  document.getElementById("stat-forecast").textContent =
    a.forecast_price === null ? "N/A" : fmtMoney(a.forecast_price, a.currency);
  const diffEl = document.getElementById("stat-forecast-diff");
  if (a.forecast_change_pct === null) {
    diffEl.textContent = "Not enough data for a trend forecast";
    diffEl.className = "stat-sub";
  } else {
    const up = a.forecast_change_pct >= 0;
    diffEl.textContent =
      `${up ? "▲" : "▼"} ${Math.abs(a.forecast_change_pct).toFixed(2)}% vs latest close · 30-day linear trend`;
    diffEl.className = `stat-sub ${up ? "change-up" : "change-down"}`;
  }
}

function renderInsights(a) {
  const recIcon = document.getElementById("insight-rec-icon");
  recIcon.innerHTML = `<i class="bi ${REC_ICON[a.recommendation]}"></i>`;
  recIcon.className = `insight-icon ${REC_CLASS[a.recommendation] || ""}`;

  document.getElementById("insight-rec").textContent = a.recommendation_reason;

  document.getElementById("insight-rsi").textContent =
    a.rsi === null
      ? "Insufficient RSI data for this symbol — stance stays neutral."
      : `RSI(14) is ${a.rsi} — ${a.rsi < 30 ? "oversold territory, momentum may reverse up." :
         a.rsi > 70 ? "overbought territory, momentum may cool down." :
         "in the neutral zone, no strong momentum signal."}`;

  document.getElementById("insight-forecast").textContent =
    a.forecast_price === null
      ? "Not enough recent closes to project the next close."
      : `Projected next close ≈ ${fmtMoney(a.forecast_price, a.currency)} from a straight-line trend of the last 30 closes.`;

  const slopeUp = (a.trend_slope || 0) >= 0;
  document.getElementById("insight-trend").textContent =
    a.trend_slope === null
      ? "Trend could not be computed for this symbol."
      : `The 30-day trend is ${slopeUp ? "rising" : "falling"} (slope ${a.trend_slope} ${a.currency}/day).`;
}

function renderSummary(a) {
  const rows = [
    ["Market Capitalization", a.market_cap ? fmtBig(a.market_cap) : "—"],
    ["P/E Ratio (trailing)", a.pe_ratio ? Number(a.pe_ratio).toFixed(2) : "—"],
    ["Dividend Yield", a.dividend_yield !== null && a.dividend_yield !== undefined ? `${a.dividend_yield}%` : "—"],
    ["52-Week High", fmtMoney(a.week52_high, a.currency)],
    ["52-Week Low", fmtMoney(a.week52_low, a.currency)],
    ["Average Volume", fmtBig(a.avg_volume)],
    ["Sector", a.sector],
    ["Industry", a.industry],
  ];
  document.getElementById("summary-list").innerHTML = rows
    .map(([k, v]) => `<dt class="col-6">${k}</dt><dd class="col-6">${v}</dd>`)
    .join("");
}

function renderHistory(data) {
  const body = document.getElementById("history-body");
  body.innerHTML = data.history
    .map((r) => `
      <tr>
        <td>${r.date}</td>
        <td class="text-end">${r.open.toFixed(2)}</td>
        <td class="text-end text-buy">${r.high.toFixed(2)}</td>
        <td class="text-end text-sell">${r.low.toFixed(2)}</td>
        <td class="text-end fw-semibold">${r.close.toFixed(2)}</td>
        <td class="text-end text-secondary">${fmtBig(r.volume)}</td>
      </tr>`)
    .join("");
}

/* ---------------- Charts ---------------- */

function renderPriceChart(chart) {
  const ctx = document.getElementById("priceChart").getContext("2d");
  if (priceChart) priceChart.destroy();

  const gradient = ctx.createLinearGradient(0, 0, 0, 340);
  gradient.addColorStop(0, "rgba(79, 140, 255, 0.35)");
  gradient.addColorStop(1, "rgba(79, 140, 255, 0.02)");

  priceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: chart.dates,
      datasets: [{
        label: `${chart.symbol} Close`,
        data: chart.prices,
        borderColor: "#4f8cff",
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        backgroundColor: gradient,
        tension: 0.15,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#111a30",
          borderColor: "#1c2742",
          borderWidth: 1,
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => ` Close: ${Number(item.raw).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#8b98b5",
            maxTicksLimit: 10,
            callback: function (value) {
              const label = this.getLabelForValue(value);
              return label ? label.slice(2) : label; // "24-01-01" style short date
            },
          },
        },
        y: {
          grid: { color: "rgba(28, 39, 66, .6)" },
          ticks: { color: "#8b98b5" },
        },
      },
    },
  });
}

function renderVolumeChart(chart) {
  const ctx = document.getElementById("volumeChart").getContext("2d");
  if (volumeChart) volumeChart.destroy();

  const n = chart.volumes.length;
  const highlightFrom = Math.max(0, n - 30);
  const colors = chart.volumes.map((_, i) =>
    i >= highlightFrom ? "rgba(34, 211, 238, .85)" : "rgba(79, 140, 255, .28)");

  volumeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: chart.dates,
      datasets: [{
        label: `${chart.symbol} Volume`,
        data: chart.volumes,
        backgroundColor: colors,
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#111a30",
          borderColor: "#1c2742",
          borderWidth: 1,
          callbacks: { label: (item) => ` Volume: ${fmtBig(item.raw)}` },
        },
      },
      scales: {
        x: { display: false },
        y: {
          grid: { color: "rgba(28, 39, 66, .6)" },
          ticks: { color: "#8b98b5", callback: (v) => fmtBig(v) },
        },
      },
    },
  });
}

/* ---------------- Stock Assistant ---------------- */

function addChatMessage(text, who, cls) {
  const div = document.createElement("div");
  div.className = `chat-msg ${who}${cls ? " " + cls : ""}`;
  div.textContent = text;
  els.chatMessages.appendChild(div);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  return div;
}

async function askAssistant(question) {
  if (!currentSymbol) {
    addChatMessage("Please analyze a stock first, then ask me about it.", "assistant");
    return;
  }
  const q = question.trim();
  if (!q) return;
  addChatMessage(q, "user");
  els.chatInput.value = "";

  const typing = addChatMessage("Thinking…", "assistant", "typing");
  try {
    const data = await fetchJSON(
      `/api/insights/${encodeURIComponent(currentSymbol)}?q=${encodeURIComponent(q)}`
    );
    typing.textContent = data.answer;
    typing.classList.remove("typing");
  } catch (err) {
    typing.textContent = `Sorry, something went wrong: ${err.message}`;
    typing.classList.remove("typing");
  }
}

function greetAssistant(a) {
  els.chatMessages.innerHTML = "";
  addChatMessage(
    `Analysis complete for ${a.name} (${a.symbol}). Current signal: ${a.recommendation}. ` +
    `Ask me about the prediction, RSI, recommendation, price, volume, 52-week range, P/E, dividend or company profile.`,
    "assistant"
  );
}

/* ---------------- Main flow ---------------- */

async function analyze(symbol) {
  currentSymbol = null;
  hideError();
  showLoading(true);
  try {
    const enc = encodeURIComponent(symbol);
    const [analysis, chart, history] = await Promise.all([
      fetchJSON(`/api/stock/${enc}`),
      fetchJSON(`/api/chart/${enc}`),
      fetchJSON(`/api/history/${enc}`),
    ]);
    currentSymbol = symbol;
    renderHeader(analysis);
    renderStats(analysis);
    renderInsights(analysis);
    renderSummary(analysis);
    renderHistory(history);
    renderPriceChart(chart);
    renderVolumeChart(chart);
    els.results.classList.remove("d-none");
    els.results.scrollIntoView({ behavior: "smooth", block: "start" });
    greetAssistant(analysis);
  } catch (err) {
    showError(err.message);
  } finally {
    showLoading(false);
  }
}

/* ---------------- Event wiring ---------------- */

QUICK_SYMBOLS.forEach((sym) => {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.textContent = sym;
  chip.addEventListener("click", () => {
    els.symbolInput.value = sym;
    analyze(sym);
  });
  els.quickSymbols.appendChild(chip);
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const symbol = els.symbolInput.value.trim().toUpperCase();
  if (!symbol) {
    showError("Please enter a stock symbol, e.g. AAPL.");
    return;
  }
  analyze(symbol);
});

els.exportBtn.addEventListener("click", () => {
  if (currentSymbol) window.location.href = `/api/export/${encodeURIComponent(currentSymbol)}`;
});

els.chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  askAssistant(els.chatInput.value);
});

document.querySelectorAll(".btn-quick-q").forEach((btn) =>
  btn.addEventListener("click", () => askAssistant(btn.dataset.q))
);
