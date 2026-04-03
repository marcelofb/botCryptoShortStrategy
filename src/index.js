require('dotenv').config();
const cron = require('node-cron');
const config = require('../config');
const binance = require('./binance');
const strategy = require('./strategy');
const position = require('./position');
const telegram = require('./telegram');
const history = require('./history');
const { calcShortPnL } = require('./strategy');

// Estado global
let state = null;

/**
 * Ciclo principal: evalúa cada par y envía alertas según corresponda.
 */
async function checkPairs() {
  console.log(`\n[${new Date().toLocaleString('es-ES')}] Ejecutando chequeo...`);

  await Promise.all(config.pairs.map(async (symbol) => {
    try {
      await checkPair(symbol);
    } catch (err) {
      console.error(`Error chequeando ${symbol}:`, err.message);
      // Reintento una vez
      try {
        console.log(`Reintentando ${symbol}...`);
        await new Promise((r) => setTimeout(r, 5000));
        await checkPair(symbol);
      } catch (retryErr) {
        console.error(`Reintento fallido para ${symbol}:`, retryErr.message);
      }
    }
  }));
}

/**
 * Evalúa un par individual.
 */
async function checkPair(symbol) {
  const pos = position.getPosition(state, symbol);

  // Siempre fetch precio y klines de análisis (timeframe configurado)
  const [price, klines] = await Promise.all([
    binance.getPrice(symbol),
    binance.getKlines(symbol, config.indicators.timeframe, config.indicators.klinesLimit),
  ]);

  // Fetch klines 1h adicionales solo si hay posición activa (para momento óptimo de DCA)
  let klines1h = null;
  if (pos.active) {
    try {
      klines1h = await binance.getKlines(symbol, '1h', 50);
    } catch (err) {
      console.warn(`  ⚠️ No se pudo obtener klines 1h para ${symbol}:`, err.message);
    }
  }

  console.log(`  ${symbol}: precio=$${price}, posición=${pos.active ? 'activa' : 'inactiva'}, partes=${pos.partsUsed}/${config.totalParts}`);

  if (!pos.active) {
    // --- No hay posición abierta: buscar señal de entrada ---
    const { shouldOpen, analysis } = strategy.shouldOpenShort(klines);
    if (shouldOpen) {
      console.log(`  🔻 Señal de entrada detectada para ${symbol} (${analysis.strength})`);
      position.openPosition(state, symbol, price);
      await history.logOpen(symbol, price, config.initialParts);
      await telegram.sendEntryAlert(symbol, price, analysis);
    } else {
      const rsiGap = (config.indicators.rsiOverbought - analysis.rsi).toFixed(1);
      const emaGapPercent = (((price - analysis.ema) / analysis.ema) * 100).toFixed(2);
      const emaDiffUSD = (analysis.ema - price).toFixed(4);
      const rsiStatus = analysis.rsi >= config.indicators.rsiOverbought ? '✅ RSI OK' : `❌ RSI ${analysis.rsi} (faltan ${rsiGap} pts para ${config.indicators.rsiOverbought})`;
      const emaStatus = price > analysis.ema
        ? `✅ Precio sobre EMA`
        : `❌ Precio bajo EMA (${Math.abs(emaGapPercent)}% — subir $${emaDiffUSD} para superarla)`;
      console.log(`  ⏳ Sin señal para ${symbol}: ${rsiStatus} | ${emaStatus}`);
    }
  } else {
    // --- Posición activa: evaluar TP, riesgo y DCA ---
    const pnlActual = calcShortPnL(pos.avgPrice, price);
    const pnlCuenta = pnlActual * config.leverage;
    const pnlEmoji = pnlCuenta >= 0 ? '🟢' : '🔴';
    const liqPrice = (pos.avgPrice * (1 + 1 / config.leverage)).toFixed(4);
    console.log(`  ${pnlEmoji} ${symbol} — PnL cuenta: ${pnlCuenta.toFixed(2)}% (precio: ${pnlActual.toFixed(2)}%) | precio: $${price} | avg: $${pos.avgPrice} | partes: ${pos.partsUsed}/${config.totalParts} | liq. est.: $${liqPrice}`);

    // 1. ¿Take Profit alcanzado?
    const tpResult = strategy.shouldTakeProfit(pos, price);
    if (tpResult.shouldTP) {
      console.log(`  ✅ TP alcanzado para ${symbol}: ${tpResult.leveragedPnlPercent.toFixed(2)}% cuenta (${tpResult.pnlPercent.toFixed(2)}% precio)`);
      await history.logClose(symbol, price, pos, tpResult.pnlPercent, tpResult.leveragedPnlPercent);
      await telegram.sendTPAlert(symbol, price, pos, tpResult);
      position.closePosition(state, symbol);
      return; // No evaluar más
    }

    // 2. ¿Riesgo de liquidación?
    const riskResult = strategy.checkLiquidationRisk(pos, price);
    if (riskResult.isRisky) {
      console.log(`  ⚠️ Riesgo de liquidación para ${symbol}: ${riskResult.distancePercent}%`);
      const pnl = calcShortPnL(pos.avgPrice, price);
      await telegram.sendRiskAlert(symbol, price, pos, { ...riskResult, pnlPercent: pnl * config.leverage });
    }

    // 3. ¿DCA necesario?
    const dcaResult = strategy.shouldDCA(pos, price, klines1h);
    if (dcaResult.shouldDCA) {
      const rsiTag = dcaResult.rsi1h !== null ? ` | RSI 1h: ${dcaResult.rsi1h}` : '';
      console.log(`  🔄 DCA para ${symbol}: agregar ${dcaResult.partsToAdd} partes${rsiTag}`);
      const avgBefore = pos.avgPrice;
      position.addEntry(state, symbol, price, dcaResult.partsToAdd);
      // Recargar posición actualizada para la alerta
      const updatedPos = position.getPosition(state, symbol);
      await history.logDCA(symbol, price, dcaResult.partsToAdd, avgBefore, updatedPos.avgPrice, updatedPos.partsUsed);
      await telegram.sendDCAAlert(symbol, price, updatedPos, dcaResult);
    } else if (dcaResult.reason) {
      const rsiTag = dcaResult.rsi1h !== null ? ` (RSI 1h: ${dcaResult.rsi1h})` : '';
      console.log(`  ⏸ DCA bloqueado para ${symbol}: ${dcaResult.reason}${rsiTag}`);
    }
  }
}

/**
 * Genera y envía resumen diario de todas las posiciones.
 */
async function sendDailySummary() {
  console.log(`\n[${new Date().toLocaleString('es-ES')}] Enviando resumen diario...`);

  const summaries = [];

  for (const symbol of config.pairs) {
    const pos = position.getPosition(state, symbol);
    let currentPrice = 0;
    try {
      currentPrice = await binance.getPrice(symbol);
    } catch (err) {
      console.error(`Error obteniendo precio de ${symbol}:`, err.message);
    }

    if (pos.active) {
      const pnlPercent = calcShortPnL(pos.avgPrice, currentPrice);
      const liquidationPrice = pos.avgPrice * (1 + 1 / config.leverage);
      summaries.push({
        symbol,
        active: true,
        currentPrice,
        avgPrice: pos.avgPrice,
        pnlPercent: Math.round(pnlPercent * config.leverage * 100) / 100,
        partsUsed: pos.partsUsed,
        totalInvested: pos.totalInvested,
        liquidationPrice: Math.round(liquidationPrice * 100) / 100,
      });
    } else {
      summaries.push({ symbol, active: false, currentPrice });
    }
  }

  await telegram.sendDailySummary(summaries);
}

/**
 * Punto de entrada principal.
 */
async function main() {
  console.log('🤖 Crypto Alert Bot — Short 5x');
  console.log(`📌 Pares: ${config.pairs.join(', ')}`);
  console.log(`⏰ Chequeo: ${config.checkCron}`);
  console.log(`📋 Resumen diario: ${config.dailySummaryCron}`);
  console.log('');

  // Cargar estado persistido
  state = position.loadState();
  console.log('📂 Estado cargado desde disco');
  for (const symbol of config.pairs) {
    const pos = position.getPosition(state, symbol);
    console.log(`  ${symbol}: ${pos.active ? 'activa' : 'inactiva'} (${pos.partsUsed} partes)`);
  }

  // Inicializar Telegram
  telegram.init();
  await telegram.sendStartup();

  // Chequeo inicial al arrancar
  await checkPairs();
  // Cron: chequeo según `config.checkCron` (por defecto cada 1 hora)
  cron.schedule(config.checkCron, async () => {
    try {
      await checkPairs();
    } catch (err) {
      console.error('Error en chequeo programado:', err.message);
    }
  });

  // Cron: resumen diario a las 22:00
  cron.schedule(config.dailySummaryCron, async () => {
    try {
      await sendDailySummary();
    } catch (err) {
      console.error('Error en resumen diario:', err.message);
    }
  });

  console.log('\n✅ Bot corriendo. Presiona Ctrl+C para detener.');
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
