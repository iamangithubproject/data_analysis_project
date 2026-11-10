"""
StockSense AI — Stock Price Prediction
--------------------------------------
Flask backend that retrieves stock data from Yahoo Finance (yfinance),
calculates the 14-period RSI, generates a BUY / HOLD / SELL recommendation,
and projects a next-close forecast using a straight-line trend through the
last 30 closing prices.

Note: the "AI" features use lightweight, explainable techniques
(RSI thresholds + a linear trend fit), not a trained neural network.
"""

import math
import re
import threading
import time
from datetime import datetime
from functools import wraps

import numpy as np
import yfinance as yf
from flask import Flask, Response, jsonify, render_template, request

app = Flask(__name__)

RSI_PERIOD = 14     # standard RSI look-back window
TREND_WINDOW = 30   # closing prices used for the linear-trend forecast
CACHE_TTL = 300     # seconds a symbol's data stays cached in memory
SYMBOL_RE = re.compile(r"^[A-Z0-9._^=-]{1,15}$")

# Simple in-memory cache so the dashboard, table, charts and Stock Assistant
# can share one fetch per symbol instead of hitting Yahoo Finance repeatedly.
_cache: dict = {}
_cache_lock = threading.Lock()


# --------------------------------------------------------------------------
# Cache helpers
# --------------------------------------------------------------------------

def _cache_get(key):
    with _cache_lock:
        entry = _cache.get(key)
        if entry and time.time() - entry[1] < CACHE_TTL:
            return entry[0]
        if entry:
            _cache.pop(key, None)
    return None


def _cache_set(key, value):
    with _cache_lock:
        _cache[key] = (value, time.time())


# --------------------------------------------------------------------------
# Analysis engine (explainable calculations)
# --------------------------------------------------------------------------

def calculate_rsi(closes, period=RSI_PERIOD):
    """Wilder-smoothed Relative Strength Index. Returns None when data is insufficient."""
    closes = closes.dropna().astype(float)
    if len(closes) < period + 1:
        return None
    deltas = closes.diff().dropna()
    avg_gain = deltas.clip(lower=0).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = (-deltas.clip(upper=0)).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    latest = float(rsi.iloc[-1])
    return None if math.isnan(latest) else round(latest, 2)


def forecast_next_close(closes, window=TREND_WINDOW):
    """Fit a straight line through the last `window` closes and project one step ahead."""
    tail = closes.dropna().astype(float).tail(window)
    if len(tail) < 2:
        return None, None
    x = np.arange(len(tail))
    slope, intercept = np.polyfit(x, tail.to_numpy(), 1)
    next_close = float(intercept + slope * len(tail))
    return round(next_close, 2), round(float(slope), 4)


def recommendation_from_rsi(rsi):
    if rsi is None:
        return "HOLD", "Insufficient RSI data for this symbol — defaulting to a neutral stance."
    if rsi < 30:
        return "BUY", f"RSI of {rsi} is below 30, which suggests the stock may be oversold."
    if rsi > 70:
        return "SELL", f"RSI of {rsi} is above 70, which suggests the stock may be overbought."
    return "HOLD", f"RSI of {rsi} sits in the neutral zone (30–70)."


# --------------------------------------------------------------------------
# Data loading
# --------------------------------------------------------------------------

def _clean_symbol(raw):
    symbol = (raw or "").strip().upper()
    if not symbol:
        raise ValueError("Please provide a stock symbol, e.g. AAPL.")
    if not SYMBOL_RE.match(symbol):
        raise ValueError(f"'{raw}' does not look like a valid stock symbol.")
    return symbol


def _safe_info(ticker):
    """Best-effort company info; falls back to fast_info when .info fails."""
    try:
        return ticker.info or {}
    except Exception:
        pass
    try:
        fast = ticker.fast_info
        return {
            "shortName": getattr(ticker, "ticker", None),
            "currency": getattr(fast, "currency", None) or "USD",
            "lastPrice": getattr(fast, "lastPrice", None),
        }
    except Exception:
        return {}


def load_stock_data(symbol):
    """Return cached {'hist': DataFrame, 'info': dict} for a symbol, fetching on miss."""
    cached = _cache_get(symbol)
    if cached is not None:
        return cached

    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="1y", auto_adjust=False)
    if hist is None or hist.empty:
        raise LookupError(
            f"No market data found for '{symbol}'. Double-check the symbol (e.g. AAPL, TSLA, MSFT)."
        )
    hist = hist.sort_index()
    if getattr(hist.index, "tz", None) is not None:
        hist.index = hist.index.tz_localize(None)

    data = {"hist": hist, "info": _safe_info(ticker)}
    _cache_set(symbol, data)
    return data


def build_analysis(symbol):
    data = load_stock_data(symbol)
    hist, info = data["hist"], data["info"]

    closes = hist["Close"]
    rsi = calculate_rsi(closes)
    recommendation, reason = recommendation_from_rsi(rsi)
    forecast, slope = forecast_next_close(closes)

    last_close = float(closes.iloc[-1])
    prev_close = float(closes.iloc[-2]) if len(closes) > 1 else last_close
    change = last_close - prev_close
    change_pct = (change / prev_close * 100) if prev_close else 0.0

    # Prefer computing the yield from the annual dividend rate and price — the
    # units are unambiguous — and fall back to dividendYield, which yfinance has
    # returned both as a fraction (0.0044 = 0.44%) and already in percent (0.44).
    div_rate = info.get("trailingAnnualDividendRate")
    if div_rate and last_close:
        dividend = div_rate / last_close * 100
    else:
        dividend = info.get("dividendYield")
        if isinstance(dividend, (int, float)) and 0 < dividend < 0.02:
            dividend *= 100

    return {
        "symbol": symbol,
        "name": info.get("shortName") or info.get("longName") or symbol,
        "currency": info.get("currency") or info.get("financialCurrency") or "USD",
        "latest_price": round(last_close, 2),
        "change": round(change, 2),
        "change_pct": round(change_pct, 2),
        "rsi": rsi,
        "recommendation": recommendation,
        "recommendation_reason": reason,
        "forecast_price": forecast,
        "forecast_change_pct": round((forecast - last_close) / last_close * 100, 2) if forecast else None,
        "trend_slope": slope,
        "market_cap": info.get("marketCap"),
        "pe_ratio": info.get("trailingPE"),
        "dividend_yield": round(dividend, 2) if isinstance(dividend, (int, float)) else None,
        "week52_high": info.get("fiftyTwoWeekHigh"),
        "week52_low": info.get("fiftyTwoWeekLow"),
        "avg_volume": info.get("averageVolume") or info.get("averageDailyVolume10Day"),
        "sector": info.get("sector") or "—",
        "industry": info.get("industry") or "—",
        "data_points": int(len(hist)),
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


# --------------------------------------------------------------------------
# Stock Assistant (rule-based Q&A over the calculated analysis)
# --------------------------------------------------------------------------

INSIGHT_TOPICS = ("the price prediction, RSI, BUY/HOLD/SELL recommendation, price, "
                  "volume, 52-week range, P/E ratio, dividend or company profile")


def build_insight(symbol, question):
    a = build_analysis(symbol)  # served from cache after the first call
    q = (question or "").strip().lower()
    cur = a["currency"] or "USD"

    def money(v):
        return f"{cur} {v:,.2f}"

    base = f"{a['name']} ({symbol}) — latest close {money(a['latest_price'])}. "

    if not q:
        return (base + f"AI recommendation: {a['recommendation']}. "
                f"You can ask me about {INSIGHT_TOPICS}.")

    if any(k in q for k in ("predict", "forecast", "tomorrow", "next", "trend")):
        if a["forecast_price"] is None:
            return "There is not enough recent price history to compute a forecast for this symbol."
        diff = a["forecast_change_pct"] or 0
        direction = "up" if diff >= 0 else "down"
        return (f"Based on a straight-line trend through the last {TREND_WINDOW} closes, the projected "
                f"next closing price for {symbol} is about {money(a['forecast_price'])} — roughly "
                f"{abs(diff):.2f}% {direction} from the latest close of {money(a['latest_price'])}. "
                "This is a simple trend estimate, not a guarantee.")

    if "rsi" in q or "momentum" in q or "overbought" in q or "oversold" in q:
        if a["rsi"] is None:
            return ("Insufficient data to calculate the RSI for this symbol, "
                    "so the stance stays neutral (HOLD).")
        zone = "oversold" if a["rsi"] < 30 else "overbought" if a["rsi"] > 70 else "neutral"
        return (f"The {RSI_PERIOD}-period RSI for {symbol} is {a['rsi']}, which is {zone}. "
                "Rules: below 30 = oversold (BUY), above 70 = overbought (SELL), in between = HOLD.")

    if any(k in q for k in ("buy", "sell", "hold", "recommend", "advice", "should i")):
        return (f"AI says: {a['recommendation']} for {symbol}. {a['recommendation_reason']} "
                "This is an educational signal from RSI thresholds, not financial advice.")

    if "market cap" in q or "capitalization" in q or "cap" in q:
        if a["market_cap"]:
            return f"The market capitalisation of {symbol} is about {a['market_cap']:,}."
        return "Market capitalisation data is not available for this symbol right now."

    if "volume" in q:
        if a["avg_volume"]:
            return (f"{symbol} trades about {a['avg_volume']:,} shares per day on average. "
                    "The volume chart on the dashboard highlights the last 30 sessions.")
        return "Average volume data is not available for this symbol right now."

    if "52" in q or "week" in q or "range" in q or "high" in q or "low" in q:
        hi, lo = a["week52_high"], a["week52_low"]
        if hi and lo:
            return f"Over the past 52 weeks {symbol} ranged from {money(lo)} to {money(hi)}."
        return "52-week high/low data is not available for this symbol right now."

    if "pe" in q or "valuation" in q or "ratio" in q:
        pe = a["pe_ratio"]
        if pe:
            return f"The trailing P/E ratio of {symbol} is {pe:.2f}."
        return ("Trailing P/E data is not available for this symbol "
                "(it may be unprofitable or the data is missing).")

    if "dividend" in q or "yield" in q:
        dy = a["dividend_yield"]
        if dy:
            return f"{symbol} offers a dividend yield of about {dy}%."
        return "No dividend yield data is available for this symbol (it may not pay a dividend)."

    if "sector" in q or "industry" in q or "company" in q or "about" in q or "profile" in q:
        return f"{a['name']} operates in the {a['sector']} sector — {a['industry']}."

    if "price" in q or "trading" in q or "worth" in q or "current" in q or "change" in q:
        sign = "+" if a["change"] >= 0 else ""
        return (f"{symbol} last closed at {money(a['latest_price'])} "
                f"({sign}{a['change']:.2f}, {sign}{a['change_pct']:.2f}% vs the previous close).")

    return (base + f"Sorry, I can only answer questions about {INSIGHT_TOPICS}.")


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


def _json_error(message, status):
    return jsonify({"error": message}), status


def api_errors(fn):
    """Map analysis errors to proper HTTP status codes for the JSON API."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ValueError as exc:
            return _json_error(str(exc), 400)
        except LookupError as exc:
            return _json_error(str(exc), 404)
        except Exception as exc:
            return _json_error(f"Market data error: {exc}", 502)
    return wrapper


@app.route("/api/stock/<symbol>")
@api_errors
def api_stock(symbol):
    return jsonify(build_analysis(_clean_symbol(symbol)))


@app.route("/api/chart/<symbol>")
@api_errors
def api_chart(symbol):
    symbol = _clean_symbol(symbol)
    hist = load_stock_data(symbol)["hist"]
    dates = hist.index.strftime("%Y-%m-%d").tolist()
    prices = [round(float(v), 2) for v in hist["Close"]]
    volumes = [int(v) for v in hist["Volume"]]
    return jsonify({
        "symbol": symbol,
        "dates": dates,
        "prices": prices,
        "volumes": volumes,
        # Latest 30 sessions, rendered highlighted on the volume chart.
        "volume_30d": {"dates": dates[-TREND_WINDOW:], "volumes": volumes[-TREND_WINDOW:]},
    })


@app.route("/api/history/<symbol>")
@api_errors
def api_history(symbol):
    symbol = _clean_symbol(symbol)
    hist = load_stock_data(symbol)["hist"].tail(15).iloc[::-1]
    rows = [
        {
            "date": idx.strftime("%Y-%m-%d"),
            "open": round(float(row["Open"]), 2),
            "high": round(float(row["High"]), 2),
            "low": round(float(row["Low"]), 2),
            "close": round(float(row["Close"]), 2),
            "volume": int(row["Volume"]),
        }
        for idx, row in hist.iterrows()
    ]
    return jsonify({"symbol": symbol, "history": rows})


@app.route("/api/export/<symbol>")
@api_errors
def api_export(symbol):
    symbol = _clean_symbol(symbol)
    hist = load_stock_data(symbol)["hist"].copy()
    hist.index.name = "Date"
    csv = hist.to_csv()
    return Response(
        csv,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={symbol}_1y_history.csv"},
    )


@app.route("/api/insights/<symbol>")
@api_errors
def api_insights(symbol):
    symbol = _clean_symbol(symbol)
    question = request.args.get("q", "")
    return jsonify({
        "symbol": symbol,
        "question": question,
        "answer": build_insight(symbol, question),
    })


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
