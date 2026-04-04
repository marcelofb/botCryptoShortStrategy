module.exports = {
  // Pares a monitorear (Binance futures notation)
  pairs: ['ETHUSDT', 'ADAUSDT'],

  // Leverage de la estrategia
  leverage: 5,

  // Capital total por par en USD
  capitalPerPair: 3000,

  // Número de partes en que se divide el capital
  totalParts: 30,

  // Partes extra habilitables mediante comando /extend (por posición, una sola vez)
  extraParts: 30,

  // Valor de cada parte en USD (calculado)
  get partValue() { return this.capitalPerPair / this.totalParts; },

  // Partes para la entrada inicial
  initialParts: 3,

  // Reglas de DCA: % de PnL en cuenta (considerando 5x leverage)
  // Se aplica la primera regla cuyo minPnl <= pnlCuenta (ordenadas de mayor a menor)
  // Ej: +5% cuenta = +1% precio con 5x | -5% cuenta = -1% precio con 5x
  dcaRules: [
    { minPnl:  5,        parts: 1 },  // más de +5% cuenta   → 1 parte
    { minPnl:  0,        parts: 2 },  // hasta +5% cuenta    → 2 partes
    { minPnl: -5,        parts: 3 },  // hasta -5% cuenta    → 3 partes
    { minPnl: -10,       parts: 4 },  // hasta -10% cuenta   → 4 partes
    { minPnl: -15,       parts: 5 },  // hasta -15% cuenta   → 5 partes
    { minPnl: -Infinity, parts: 6 },  // más de -15% cuenta  → 6 partes
  ],

  // Máximo de recargas DCA por día por par
  maxDCAPerDay: 1,

  // RSI mínimo en 1h para considerar que es un buen momento de recarga
  // (precio con impulso alcista reciente = mejor entrada para short)
  dcaOptimal1hRSI: 50,

  // Hora límite local (0-23): si no se ejecutó DCA aún, se ignora el filtro RSI 1h y se ejecuta igual
  // 21 = 21:00 hora local (Argentina), 1h antes del resumen diario a las 22:00
  dcaFallbackHour: 21,

  // Take Profit: cerrar al +15% de ganancia en cuenta (= 3% bajada de precio a 5x leverage)
  takeProfitPercent: 3,

  // Umbral de alerta de riesgo: distancia a liquidación estimada
  liquidationAlertPercent: 5, // alertar si está a menos del 5% de liquidación

  // Indicadores técnicos
  indicators: {
    rsiPeriod: 14,
    rsiOverbought: 70,    // RSI > 70 = señal de entrada para short
    emaPeriod: 20,
    timeframe: '4h',
    klinesLimit: 100,     // velas históricas a consultar
  },

  // Frecuencia de chequeo en formato cron (cada 1 hora)
  checkCron: '0 */1 * * *',

  // Resumen diario a las 22:00
  dailySummaryCron: '0 22 * * *',
};
