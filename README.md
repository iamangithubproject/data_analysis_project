# 📈 Stock Price Prediction — StockSense AI

A Flask-based stock analysis web application. It combines the latest available
stock market data (via **yfinance**) with technical analysis — the
**Relative Strength Index (RSI)** — and a simple **trend-based next-close
forecast**, presented through a modern, dark-themed interactive dashboard.

> **Important:** the "AI" features (AI-Powered Analysis, AI Analysis Engine,
> AI Market Insights, AI Says, Stock Assistant) are *AI-style* presentation
> layers on top of **lightweight, explainable techniques** — RSI thresholds and
> a 30-day linear-trend fit. There is **no trained neural network or separate
> ML model** in this project.

---

## ✨ Features

| Category | Features |
|---|---|
| **Analysis** | RSI(14) calculation · BUY / HOLD / SELL recommendation · next-close forecast from a 30-day linear trend · latest price & daily change |
| **Charts** | One-year price history chart · trading-volume chart with the last 30 days highlighted (Chart.js) |
| **Financials** | Market capitalization · trailing P/E · dividend yield · 52-week high/low · average volume · sector & industry |
| **Data** | Historical data table (last 15 sessions) · full one-year CSV export · JSON API |
| **AI-style UX** | AI-Powered Analysis search · AI Analysis Engine loading view · AI Market Insights cards · AI Says recommendation · Stock Assistant Q&A |
| **UI** | Responsive dark-themed dashboard (Bootstrap 5) |

## 🧠 How It Works

1. The user enters a stock symbol (e.g. `AAPL`, `TSLA`, `MSFT`) on the homepage.
2. The frontend calls the Flask stock API.
3. The backend retrieves ~1 year of daily history with **yfinance**.
4. It calculates the latest price and price change vs the previous close.
5. It computes the **14-period RSI** (Wilder smoothing) from the closes.
6. Recommendation from RSI: **< 30 → BUY**, **> 70 → SELL**, **between → HOLD**
   (insufficient data → HOLD with a note).
7. The last **30 closing prices** are fitted with a straight line (NumPy
   `polyfit`) and projected one step ahead to estimate the next trading-day close.
8. Results are returned as JSON and rendered as charts, cards, tables and metrics.

## 🗂 Project Structure

```
stock_market_project/
├── app.py                  # Flask backend: analysis engine + JSON API
├── requirements.txt
├── README.md
├── templates/
│   └── index.html          # StockSense AI dashboard
└── static/
    ├── css/style.css       # Dark theme
    └── js/script.js        # Dashboard logic, Chart.js, Stock Assistant
```

## 🚀 Getting Started

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the app
python app.py

# 3. Open in your browser
# http://127.0.0.1:5000
```

## 🔌 API Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | StockSense AI dashboard |
| `GET /api/stock/<symbol>` | Full analysis JSON: price, change, RSI, recommendation, forecast, financial metrics |
| `GET /api/chart/<symbol>` | One-year dates / closes / volumes (+ last 30-day volume slice) for the charts |
| `GET /api/history/<symbol>` | Recent 15 sessions (OHLCV) for the history table |
| `GET /api/export/<symbol>` | Full one-year history as a CSV download |
| `GET /api/insights/<symbol>?q=...` | Stock Assistant answers (prediction, RSI, recommendation, price, volume, 52-week range, P/E, dividend, profile) |

Example:

```bash
curl "http://127.0.0.1:5000/api/insights/AAPL?q=What%20is%20the%20prediction%3F"
```

## 🛠 Tech Stack

- **Backend:** Python · Flask · yfinance · Pandas · NumPy
- **Frontend:** HTML · CSS · JavaScript · Bootstrap 5 · Chart.js
- **Data source:** Yahoo Finance (via `yfinance`), cached in memory for 5 minutes

## ⚠️ Disclaimer

This project is for **learning and demonstration purposes only**. The forecast
is a simple, transparent trend calculation — it is **not** a guaranteed market
prediction and nothing here is financial advice.
