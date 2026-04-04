const fs = require('fs');
const path = require('path');
const config = require('../config');
const { localDateString, localISOString } = require('./utils');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');

/**
 * Carga el estado de posiciones desde disco.
 * @returns {object} { positions: { ETHUSDT: {...}, ADAUSDT: {...} } }
 */
function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { positions: {} };
  }
}

/**
 * Guarda el estado de posiciones en disco de forma asíncrona (no bloquea el event loop).
 * @param {object} state
 * @returns {Promise<void>}
 */
async function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Obtiene la posición de un par, o crea una vacía.
 * @param {object} state
 * @param {string} symbol
 * @returns {object}
 */
function getPosition(state, symbol) {
  if (!state.positions[symbol]) {
    state.positions[symbol] = createEmptyPosition(symbol);
  }
  return state.positions[symbol];
}

/**
 * Crea una posición vacía.
 */
function createEmptyPosition(symbol) {
  return {
    symbol,
    active: false,
    entries: [],       // [{ price, parts, date }]
    partsUsed: 0,
    avgPrice: 0,
    totalInvested: 0,  // USD invertido (sin leverage)
    lastDCADate: null, // Fecha del último DCA (YYYY-MM-DD) para limitar 1 por día
    extraPartsEnabled: false, // true cuando se activó el pool extra con /extend
  };
}

/**
 * Abre una posición con la entrada inicial.
 * @param {object} state
 * @param {string} symbol
 * @param {number} price - Precio actual de entrada
 * @param {number} parts - Partes a usar (default: initialParts del config)
 * @returns {object} Posición actualizada
 */
function openPosition(state, symbol, price, parts = config.initialParts) {
  const position = getPosition(state, symbol);

  if (position.active) {
    return position; // Ya está activa, no re-abrir
  }

  position.active = true;
  position.entries = [{ price, parts, date: localISOString() }];
  position.partsUsed = parts;
  position.avgPrice = price;
  position.totalInvested = parts * config.partValue;
  // Registrar que se realizó una entrada hoy para evitar DCA el mismo día
  position.lastDCADate = localDateString();

  saveState(state);
  return position;
}

/**
 * Agrega una entrada DCA a una posición activa.
 * @param {object} state
 * @param {string} symbol
 * @param {number} price - Precio actual
 * @param {number} parts - Partes a agregar
 * @returns {object} Posición actualizada
 */
function addEntry(state, symbol, price, parts) {
  const position = getPosition(state, symbol);

  if (!position.active) {
    return position;
  }

  position.entries.push({ price, parts, date: localISOString() });
  position.partsUsed += parts;
  position.totalInvested = position.partsUsed * config.partValue;
  position.avgPrice = calcAvgPrice(position.entries);
  position.lastDCADate = localDateString(); // YYYY-MM-DD

  saveState(state);
  return position;
}

/**
 * Cierra una posición (TP alcanzado o cierre manual).
 * @param {object} state
 * @param {string} symbol
 * @returns {object} Posición cerrada
 */
function closePosition(state, symbol) {
  const position = getPosition(state, symbol);
  const closedPosition = { ...position };

  // Resetear la posición
  state.positions[symbol] = createEmptyPosition(symbol);
  saveState(state);

  return closedPosition;
}

/**
 * Calcula el precio promedio ponderado por partes.
 * @param {Array} entries - [{ price, parts }]
 * @returns {number}
 */
function calcAvgPrice(entries) {
  let totalValue = 0;
  let totalParts = 0;
  for (const entry of entries) {
    totalValue += entry.price * entry.parts;
    totalParts += entry.parts;
  }
  return totalParts > 0 ? totalValue / totalParts : 0;
}

module.exports = { loadState, saveState, getPosition, openPosition, addEntry, closePosition, calcAvgPrice, enableExtraParts };

/**
 * Activa el pool de partes extra para una posición en curso.
 * Solo se puede activar si: posición activa, partes base agotadas, y aún no activado.
 * @param {object} state
 * @param {string} symbol
 * @returns {{ ok: boolean, reason: string }}
 */
async function enableExtraParts(state, symbol) {
  const pos = getPosition(state, symbol);

  if (!pos.active) {
    return { ok: false, reason: `No hay posición activa para ${symbol}.` };
  }
  if (pos.extraPartsEnabled) {
    return { ok: false, reason: `El pool extra ya fue activado para ${symbol}.` };
  }
  if (pos.partsUsed < config.totalParts) {
    const remaining = config.totalParts - pos.partsUsed;
    return { ok: false, reason: `Aún quedan ${remaining} partes base disponibles en ${symbol}. El pool extra se habilita solo cuando se agotan las ${config.totalParts}.` };
  }

  pos.extraPartsEnabled = true;
  await saveState(state);
  return { ok: true, reason: '' };
}
