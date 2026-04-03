const config = require('../config');
const { localDateString } = require('./utils');
const { detectRetrace, calcRSI } = require('./indicators');

/**
 * Evalúa si es momento de abrir un short basándose en indicadores técnicos.
 * @param {Array} klines - Velas históricas
 * @returns {{ shouldOpen: boolean, analysis: object }}
 */
function shouldOpenShort(klines) {
  const analysis = detectRetrace(klines, config.indicators);
  // Solo abrir en señales medium o strong
  const shouldOpen = analysis.signal && (analysis.strength === 'strong' || analysis.strength === 'medium');
  return { shouldOpen, analysis };
}

/**
 * Evalúa si hay que hacer DCA (agregar posición) y cuántas partes.
 * Reglas según % negativo vs precio promedio:
 *   - Positivo o 0%: no operar
 *   - Hasta -5%: 3 partes
 *   - Hasta -10%: 4 partes
 *   - Hasta -15%: 5 partes
 *   - Más de -15%: 6 partes
 * Límite: 1 DCA por día por par.
 * Momento óptimo: RSI(14) en 1h > dcaOptimal1hRSI (precio con impulso alcista = mejor entrada short).
 *
 * @param {object} position - Estado de la posición
 * @param {number} currentPrice - Precio actual del par
 * @param {Array|null} klines1h - Velas 1h para evaluar momento óptimo (opcional)
 * @returns {{ shouldDCA: boolean, partsToAdd: number, pnlPercent: number, reason: string, rsi1h: number|null }}
 */
function shouldDCA(position, currentPrice, klines1h = null) {
  if (!position || !position.active) {
    return { shouldDCA: false, partsToAdd: 0, pnlPercent: 0, reason: 'Sin posición activa', rsi1h: null };
  }

  const pnlPercent = calcShortPnL(position.avgPrice, currentPrice);
  const pnlCuenta = Math.round(pnlPercent * config.leverage * 100) / 100;
  const partsRemaining = config.totalParts - position.partsUsed;

  // Límite de 1 DCA por día (incluye el día de apertura)
  const today = localDateString();
  if (position.lastDCADate === today) {
    return { shouldDCA: false, partsToAdd: 0, pnlPercent: pnlCuenta, reason: `Ya se realizó 1 DCA hoy (${today})`, rsi1h: null };
  }

  // Si está en ganancia, no hacer DCA
  if (pnlPercent >= 0) {
    return { shouldDCA: false, partsToAdd: 0, pnlPercent: pnlCuenta, reason: 'Posición en ganancia, no se opera', rsi1h: null };
  }

  // Si no quedan partes, no se puede hacer DCA
  if (partsRemaining <= 0) {
    return { shouldDCA: false, partsToAdd: 0, pnlPercent: pnlCuenta, reason: 'No quedan partes disponibles', rsi1h: null };
  }

  // Momento óptimo: RSI 1h > umbral (precio con impulso alcista = mejor entrada para short)
  // Fallback: si ya pasó la hora límite del día, ejecutar igual independientemente del RSI 1h
  const currentHour = new Date().getHours(); // hora local del sistema
  const fallbackActive = currentHour >= config.dcaFallbackHour;

  let rsi1h = null;
  if (klines1h && klines1h.length > 14) {
    const closes1h = klines1h.map((k) => k.close);
    const rsiValues = calcRSI(closes1h, 14);
    rsi1h = Math.round(rsiValues[rsiValues.length - 1] * 100) / 100;
    if (rsi1h < config.dcaOptimal1hRSI && !fallbackActive) {
      return {
        shouldDCA: false, partsToAdd: 0, pnlPercent: pnlCuenta,
        reason: `Esperando momento óptimo: RSI 1h ${rsi1h} < ${config.dcaOptimal1hRSI} (precio sin impulso alcista)`,
        rsi1h,
      };
    }
  }

  // Determinar partes según reglas de DCA (comparando PnL en cuenta = precio × leverage)
  let partsToAdd = 0;
  for (const rule of config.dcaRules) {
    if (pnlCuenta >= rule.maxLoss) {
      partsToAdd = rule.parts;
      break;
    }
  }

  // No agregar más partes de las disponibles
  partsToAdd = Math.min(partsToAdd, partsRemaining);

  const fallbackNote = fallbackActive && rsi1h !== null && rsi1h < config.dcaOptimal1hRSI ? ' [fallback horario]' : '';
  return {
    shouldDCA: partsToAdd > 0,
    partsToAdd,
    pnlPercent: pnlCuenta,
    reason: `PnL cuenta: ${pnlCuenta.toFixed(2)}% → agregar ${partsToAdd} partes${rsi1h !== null ? ` (RSI 1h: ${rsi1h})` : ''}${fallbackNote}`,
    rsi1h,
  };
}

/**
 * Evalúa si se alcanzó el Take Profit (+15% ganancia en cuenta = 3% bajada de precio a 5x).
 * Para short: ganancia cuando el precio baja respecto al precio promedio de entrada.
 *
 * @param {object} position - Estado de la posición
 * @param {number} currentPrice - Precio actual
 * @returns {{ shouldTP: boolean, pnlPercent: number, leveragedPnlPercent: number, estimatedProfitUSD: number }}
 */
function shouldTakeProfit(position, currentPrice) {
  if (!position || !position.active) {
    return { shouldTP: false, pnlPercent: 0, leveragedPnlPercent: 0, estimatedProfitUSD: 0 };
  }

  const pnlPercent = calcShortPnL(position.avgPrice, currentPrice);
  const leveragedPnlPercent = Math.round(pnlPercent * config.leverage * 100) / 100;
  const investedUSD = position.partsUsed * config.partValue;
  // Con leverage, la ganancia se multiplica
  const estimatedProfitUSD = (pnlPercent / 100) * investedUSD * config.leverage;

  return {
    shouldTP: pnlPercent >= config.takeProfitPercent,
    pnlPercent,
    leveragedPnlPercent,
    estimatedProfitUSD: Math.round(estimatedProfitUSD * 100) / 100,
  };
}

/**
 * Verifica si la posición se acerca al precio de liquidación.
 * Para short a 5x, liquidación estimada ≈ avgPrice × 1.20 (20% arriba del promedio).
 *
 * @param {object} position - Estado de la posición
 * @param {number} currentPrice - Precio actual
 * @returns {{ isRisky: boolean, distancePercent: number, liquidationPrice: number }}
 */
function checkLiquidationRisk(position, currentPrice) {
  if (!position || !position.active) {
    return { isRisky: false, distancePercent: 100, liquidationPrice: 0 };
  }

  // Para short a 5x: liquidación ≈ avgPrice × (1 + 1/leverage) = avgPrice × 1.20
  const liquidationPrice = position.avgPrice * (1 + 1 / config.leverage);
  const distancePercent = ((liquidationPrice - currentPrice) / currentPrice) * 100;

  return {
    isRisky: distancePercent <= config.liquidationAlertPercent,
    distancePercent: Math.round(distancePercent * 100) / 100,
    liquidationPrice: Math.round(liquidationPrice * 100) / 100,
  };
}

/**
 * Calcula el PnL% de un short.
 * Short gana cuando el precio baja: PnL% = ((entryPrice - currentPrice) / entryPrice) × 100
 */
function calcShortPnL(avgPrice, currentPrice) {
  return ((avgPrice - currentPrice) / avgPrice) * 100;
}

module.exports = { shouldOpenShort, shouldDCA, shouldTakeProfit, checkLiquidationRisk, calcShortPnL };
