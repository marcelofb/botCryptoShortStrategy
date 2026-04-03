const { RSI, EMA } = require('technicalindicators');

/**
 * Calcula RSI sobre un array de precios de cierre.
 * @param {number[]} closes
 * @param {number} period
 * @returns {number[]}
 */
function calcRSI(closes, period = 14) {
  return RSI.calculate({ values: closes, period });
}

/**
 * Calcula EMA sobre un array de precios de cierre.
 * @param {number[]} closes
 * @param {number} period
 * @returns {number[]}
 */
function calcEMA(closes, period = 20) {
  return EMA.calculate({ values: closes, period });
}

/**
 * Detecta si hay un retroceso alcista (bueno para abrir short).
 * Señal: RSI > 70 (sobrecompra) Y precio por encima de EMA20.
 * Esto indica un rebote/retroceso en tendencia bajista → oportunidad de short.
 *
 * @param {Array} klines - Velas de Binance
 * @param {object} config - { rsiPeriod, rsiOverbought, emaPeriod }
 * @returns {{ signal: boolean, rsi: number, ema: number, price: number, strength: string }}
 */
function detectRetrace(klines, config) {
  const closes = klines.map((k) => k.close);
  const { rsiPeriod = 14, rsiOverbought = 70, emaPeriod = 20 } = config;

  const rsiValues = calcRSI(closes, rsiPeriod);
  const emaValues = calcEMA(closes, emaPeriod);

  const currentRSI = rsiValues[rsiValues.length - 1];
  const previousRSI = rsiValues[rsiValues.length - 2];
  const currentEMA = emaValues[emaValues.length - 1];
  const currentPrice = closes[closes.length - 1];

  const rsiOverboughtNow = currentRSI >= rsiOverbought;
  const priceAboveEMA = currentPrice > currentEMA;

  // Señal fuerte: RSI sobrecomprado + precio por encima de EMA
  // Señal media: solo RSI sobrecomprado
  // Sin señal: RSI normal
  let signal = false;
  let strength = 'none';

  if (rsiOverboughtNow && priceAboveEMA) {
    signal = true;
    strength = 'strong';
  } else if (rsiOverboughtNow) {
    signal = true;
    strength = 'medium';
  }

  return {
    signal,
    strength,
    rsi: Math.round(currentRSI * 100) / 100,
    previousRSI: Math.round(previousRSI * 100) / 100,
    ema: Math.round(currentEMA * 100) / 100,
    price: currentPrice,
    priceAboveEMA,
  };
}

module.exports = { calcRSI, calcEMA, detectRetrace };
