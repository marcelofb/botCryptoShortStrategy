const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const { formatUSD, formatPercent, formatPrice } = require('./utils');

let bot = null;
let chatIds = [];

/**
 * Inicializa el bot de Telegram.
 */
function init() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const rawChatIds = process.env.TELEGRAM_CHAT_ID;

  if (!token || token === 'TU_TOKEN_AQUI') {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN no configurado en .env');
    return;
  }
  if (!rawChatIds || rawChatIds === 'TU_CHAT_ID_AQUI') {
    console.warn('⚠️  TELEGRAM_CHAT_ID no configurado en .env');
    return;
  }

  chatIds = rawChatIds.split(',').map((id) => id.trim()).filter(Boolean);
  bot = new TelegramBot(token, { polling: true });
  console.log(`✅ Telegram bot inicializado (${chatIds.length} destinatario${chatIds.length > 1 ? 's' : ''})`);
}

/**
 * Envía un mensaje por Telegram con formato Markdown a todos los destinatarios.
 */
async function send(text) {
  if (!bot || chatIds.length === 0) {
    console.log('[Telegram desactivado]', text);
    return;
  }
  for (const id of chatIds) {
    try {
      await bot.sendMessage(id, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(`Error enviando mensaje Telegram a ${id}:`, err.message);
    }
  }
}

/**
 * Alerta de entrada inicial (señal de short detectada).
 */
async function sendEntryAlert(symbol, price, analysis) {
  const strengthEmoji = { strong: '🔴🔴🔴', medium: '🔴🔴', weak: '🔴' };
  const text = `
🔻 *SEÑAL DE SHORT — ${symbol}*
${strengthEmoji[analysis.strength] || '🔴'} Fuerza: *${analysis.strength.toUpperCase()}*

📊 Precio actual: *${formatPrice(price)}*
📈 RSI(14): *${analysis.rsi}* ${analysis.rsi >= config.indicators.rsiOverbought ? '(sobrecompra ⚠️)' : ''}
📉 EMA(20): *${formatPrice(analysis.ema)}*
${analysis.priceAboveEMA ? '⬆️ Precio SOBRE EMA' : '⬇️ Precio bajo EMA'}

💰 Entrada sugerida: *${config.initialParts} partes* (${formatUSD(config.initialParts * config.partValue)})
📋 Apalancamiento: *${config.leverage}x*
  `.trim();

  await send(text);
}

/**
 * Alerta de DCA / momento de recargar.
 */
async function sendDCAAlert(symbol, price, position, dcaResult) {
  const text = `
🔄 *RECARGA DCA — ${symbol}*

📊 Precio actual: *${formatPrice(price)}*
📊 Precio promedio: *${formatPrice(position.avgPrice)}*
📉 PnL: *${formatPercent(dcaResult.pnlPercent)}*

➕ Agregar: *${dcaResult.partsToAdd} partes* (${formatUSD(dcaResult.partsToAdd * config.partValue)})
📦 Partes usadas: *${position.partsUsed}/${config.totalParts}*
📦 Partes restantes: *${config.totalParts - position.partsUsed}*
💵 Total invertido: *${formatUSD(position.totalInvested)}*
  `.trim();

  await send(text);
}

/**
 * Alerta de Take Profit alcanzado.
 */
async function sendTPAlert(symbol, price, position, tpResult) {
  const text = `
✅ *TAKE PROFIT — ${symbol}*

🎯 PnL alcanzado: *${formatPercent(tpResult.leveragedPnlPercent)}* (cuenta)
💵 Ganancia estimada: *${formatUSD(tpResult.estimatedProfitUSD)}*

📊 Precio actual: *${formatPrice(price)}*
📊 Precio promedio: *${formatPrice(position.avgPrice)}*
📦 Partes usadas: *${position.partsUsed}/${config.totalParts}*
💰 Total invertido: *${formatUSD(position.totalInvested)}*

🟢 Se recomienda CERRAR la posición.
  `.trim();

  await send(text);
}

/**
 * Alerta de riesgo alto (cerca de liquidación).
 */
async function sendRiskAlert(symbol, price, position, riskResult) {
  const text = `
⚠️ *ALERTA DE RIESGO — ${symbol}*

🚨 Distancia a liquidación: *${formatPercent(riskResult.distancePercent)}*
💀 Precio de liquidación estimado: *${formatPrice(riskResult.liquidationPrice)}*

📊 Precio actual: *${formatPrice(price)}*
📊 Precio promedio: *${formatPrice(position.avgPrice)}*
📉 PnL: *${formatPercent(riskResult.pnlPercent || 0)}*
📦 Partes usadas: *${position.partsUsed}/${config.totalParts}*

⚠️ Evalúa si conviene mantener la posición.
  `.trim();

  await send(text);
}

/**
 * Resumen diario del estado de todas las posiciones.
 */
async function sendDailySummary(positionsSummary) {
  let text = `📋 *RESUMEN DIARIO — ${new Date().toLocaleDateString('es-ES')}*\n\n`;

  for (const summary of positionsSummary) {
    const statusEmoji = summary.active ? '🟢' : '⚪';
    text += `${statusEmoji} *${summary.symbol}*\n`;

    if (summary.active) {
      text += `  📊 Precio actual: ${formatPrice(summary.currentPrice)}\n`;
      text += `  📊 Precio promedio: ${formatPrice(summary.avgPrice)}\n`;
      text += `  📉 PnL: ${formatPercent(summary.pnlPercent)}\n`;
      text += `  📦 Partes: ${summary.partsUsed}/${config.totalParts}\n`;
      text += `  💵 Invertido: ${formatUSD(summary.totalInvested)}\n`;
      text += `  💀 Liquidación: ${formatPrice(summary.liquidationPrice)}\n`;
    } else {
      text += `  Sin posición activa\n`;
    }
    text += '\n';
  }

  await send(text.trim());
}

/**
 * Reporte de chequeo sin señal: muestra indicadores actuales y cuánto falta para disparar la entrada.
 */
async function sendNoSignalReport(symbol, price, analysis) {
  const rsiTarget = config.indicators.rsiOverbought;
  const rsiGap = rsiTarget - analysis.rsi;
  const emaGapPercent = ((price - analysis.ema) / analysis.ema) * 100;

  const rsiOk = analysis.rsi >= rsiTarget;
  const emaOk = price > analysis.ema;

  const rsiLine = rsiOk
    ? `✅ RSI: *${analysis.rsi}* (sobrecompra ✔)`
    : `❌ RSI: *${analysis.rsi}* — faltan *${rsiGap.toFixed(1)} puntos* para llegar a ${rsiTarget}`;

  const emaLine = emaOk
    ? `✅ Precio SOBRE EMA: *${formatPrice(price)}* > *${formatPrice(analysis.ema)}* (+${Math.abs(emaGapPercent).toFixed(2)}%)`
    : `❌ Precio BAJO EMA: *${formatPrice(price)}* < *${formatPrice(analysis.ema)}* (${emaGapPercent.toFixed(2)}%, necesita subir *${formatUSD(Math.abs(price - analysis.ema))}*)`;

  const text = `
🔍 *CHEQUEO SIN SEÑAL — ${symbol}*

${rsiLine}
${emaLine}

📊 Precio actual: *${formatPrice(price)}*
📊 EMA(${config.indicators.emaPeriod}): *${formatPrice(analysis.ema)}*
📈 RSI(${config.indicators.rsiPeriod}) anterior: *${analysis.previousRSI}*

⏳ Sin condiciones para abrir short.
  `.trim();

  await send(text);
}

/**
 * Mensaje de inicio del bot.
 */
async function sendStartup() {
  const text = `
🤖 *Bot de Alertas Crypto iniciado*

📌 Pares: ${config.pairs.join(', ')}
⏰ Chequeo: cada 1 hora
📋 Resumen diario: 22:00
📊 Estrategia: Short ${config.leverage}x con DCA
🎯 TP: ${config.takeProfitPercent * config.leverage}% (cuenta)
  `.trim();

  await send(text);
}

module.exports = { init, send, sendEntryAlert, sendDCAAlert, sendTPAlert, sendRiskAlert, sendDailySummary, sendStartup, sendNoSignalReport, onCommand, sendExtendOk, sendExtendError };

/**
 * Registra un handler para mensajes/comandos entrantes.
 * Solo acepta mensajes de chat IDs autorizados.
 * @param {function} handler - fn(msg) llamado por cada mensaje recibido
 */
function onCommand(handler) {
  if (!bot) return;
  bot.on('message', (msg) => {
    const fromId = String(msg.chat.id);
    if (!chatIds.includes(fromId)) return; // ignorar mensajes de desconocidos
    handler(msg);
  });
}

/**
 * Confirma la activación del pool extra para un par.
 */
async function sendExtendOk(symbol, pos) {
  const totalAllowed = config.totalParts + config.extraParts;
  const remaining = totalAllowed - pos.partsUsed;
  const text = `
✅ *POOL EXTRA ACTIVADO — ${symbol}*

📦 Partes base agotadas: *${config.totalParts}/${config.totalParts}*
➕ Partes extra disponibles: *${config.extraParts}*
📦 Total ahora disponible: *${totalAllowed}* (restantes: *${remaining}*)
💵 Capital extra: *${formatUSD(config.extraParts * config.partValue)}*

El DCA seguirá operando normalmente con las partes extra.
  `.trim();
  await send(text);
}

/**
 * Informa por qué no se pudo activar el pool extra.
 */
async function sendExtendError(reason) {
  await send(`❌ *No se pudo activar el pool extra*\n\n${reason}`);
}
