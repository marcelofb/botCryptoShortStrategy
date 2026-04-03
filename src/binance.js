const axios = require('axios');

const BASE_URL = 'https://api.binance.com';

/**
 * Obtiene el precio actual de un par.
 * @param {string} symbol - Ej: 'ETHUSDT'
 * @returns {Promise<number>}
 */
async function getPrice(symbol) {
  const { data } = await axios.get(`${BASE_URL}/api/v3/ticker/price`, {
    params: { symbol },
    timeout: 10000,
  });
  return parseFloat(data.price);
}

/**
 * Obtiene velas (klines) históricas.
 * @param {string} symbol - Ej: 'ETHUSDT'
 * @param {string} interval - Ej: '4h', '1h', '1d'
 * @param {number} limit - Cantidad de velas
 * @returns {Promise<Array>} Array de objetos { openTime, open, high, low, close, volume, closeTime }
 */
async function getKlines(symbol, interval, limit = 100) {
  const { data } = await axios.get(`${BASE_URL}/api/v3/klines`, {
    params: { symbol, interval, limit },
    timeout: 10000,
  });
  return data.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}

module.exports = { getPrice, getKlines };
