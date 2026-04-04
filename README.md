# Crypto Alert Bot — Short 5x ETH/ADA

Bot de alertas por Telegram para seguir una estrategia de short a 5x leverage en ETH y ADA.  
**No ejecuta órdenes**: solo analiza el mercado y envía alertas para que vos decidas cuándo operar.

---

## ¿Qué hace?

Cada hora el bot consulta la API pública de Binance, analiza indicadores técnicos y envía alertas a Telegram cuando corresponde:

| Alerta | Cuándo se dispara |
|---|---|
| 📉 **Entrada** | RSI 4h ≥ 40, con precio sobre EMA20 (señal fuerte) o sin ella (señal media) |
| 🔄 **DCA** | PnL positivo hasta +5% (señal de recarga leve) o negativo según reglas de pérdida (−5/−10/−15%/más) |
| ✅ **Take Profit** | PnL acumulado ≥ +15% |
| ⚠️ **Riesgo** | Precio a menos del 5% del precio de liquidación estimado |
| 📋 **Resumen diario** | Todos los días a las 22:00 (hora local) |

Cuando no hay señal, el bot reporta el estado de RSI y EMA en consola para diagnóstico.

---

## Estrategia

- **Capital:** $3.000 por par → 30 partes (valor por parte calculado en `config.js` = $100)
- **Entrada inicial:** 3 partes al detectar señal de entrada (RSI 4h ≥ 70)
- **DCA:** máximo 1 recarga por día por par, en el momento óptimo (RSI 1h ≥ 50)
  - PnL más de +5% → 1 parte
  - PnL hasta +5% → 2 partes
  - PnL hasta −5% → 3 partes
  - PnL hasta −10% → 4 partes
  - PnL hasta −15% → 5 partes
  - PnL más de −15% → 6 partes
- **Fallback DCA:** si a las 21:00 no se ejecutó recarga y la posición está negativa, se ejecuta igual (ignorando filtro RSI 1h)
- **Take Profit:** +15% de ganancia en cuenta (= 3% bajada de precio a 5x leverage)
- **Stop Loss:** sin SL (estrategia con liquidación como límite)
- **Liquidación estimada:** `avgPrice × 1.20` (short 5x)

---

## Stack tecnológico

| Componente | Tecnología |
|---|---|
| Runtime | Node.js v20+ |
| API de mercado | Binance REST API pública (sin API key) |
| Indicadores | `technicalindicators` — RSI(14), EMA(20) |
| Alertas | `node-telegram-bot-api` |
| Scheduling | `node-cron` |
| HTTP | `axios` — requests a Binance API |
| Persistencia | JSON local (`data/state.json`, `data/history.json`) |
| Config | `dotenv` |

---

## Estructura del proyecto

```
crypto-alert-bot/
├── src/
│   ├── index.js        # Punto de entrada, cron jobs, orquestación
│   ├── strategy.js     # Lógica de entrada, DCA, TP, riesgo
│   ├── indicators.js   # RSI, EMA, detección de retroceso
│   ├── position.js     # Estado de posiciones, persistencia
│   ├── binance.js      # Wrapper API Binance
│   ├── telegram.js     # Mensajes y alertas Telegram
│   ├── history.js      # Registro histórico de operaciones
│   └── utils.js        # Formateo USD, %, precios
├── data/
│   ├── state.json      # Estado persistido de posiciones activas
│   └── history.json    # Historial de operaciones cerradas
├── config.js           # Parámetros de la estrategia
├── .env                # Credenciales Telegram (no commitear)
├── .env.example        # Plantilla para el archivo .env
├── .nvmrc              # Versión de Node requerida (20.20.2)
├── package.json
└── README.md
```

---

## Configuración

### 1. Clonar e instalar dependencias

```bash
cd crypto-alert-bot
npm install
```

### 2. Crear el archivo `.env`

```bash
cp .env.example .env   # o crear manualmente
```

Completar con los datos del bot de Telegram:

```env
TELEGRAM_BOT_TOKEN=tu_token_aqui
TELEGRAM_CHAT_ID=tu_chat_id_aqui
```

> **Cómo obtener el token:** hablar con [@BotFather](https://t.me/BotFather) en Telegram → `/newbot`.  
> **Cómo obtener el chat ID:** enviar un mensaje al bot y visitar `https://api.telegram.org/bot<TOKEN>/getUpdates`.

### 3. Ajustar parámetros (opcional)

Editar `config.js` para modificar pares, capital, reglas de DCA, timeframes, etc.

---

## Ejecución

```bash
npm start
```

En Windows con nvm-windows, si el PATH no está configurado:

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm start
```

El bot imprime en consola el estado de cada par en cada chequeo y envía alertas a Telegram cuando corresponde.

---

## Parámetros configurables en `config.js`

| Parámetro | Valor por defecto | Descripción |
|---|---|---|
| `pairs` | `['ETHUSDT', 'ADAUSDT']` | Pares a monitorear |
| `leverage` | `5` | Leverage de la estrategia |
| `capitalPerPair` | `3000` | Capital total por par en USD |
| `totalParts` | `30` | Partes totales de capital |
| `initialParts` | `3` | Partes en la entrada inicial |
| `dcaRules` | `[{minPnl:5,parts:1},{minPnl:0,parts:2},{minPnl:-5,parts:3},{minPnl:-10,parts:4},{minPnl:-15,parts:5},{minPnl:-Infinity,parts:6}]` | Reglas DCA: PnL en % cuenta → partes a agregar |
| `maxDCAPerDay` | `1` | Máximo recargas DCA por día por par |
| `takeProfitPercent` | `3` | % bajada de precio para TP (= 15% cuenta a 5x) |
| `dcaOptimal1hRSI` | `50` | RSI mínimo 1h para DCA |
| `dcaFallbackHour` | `21` | Hora local del fallback DCA |
| `liquidationAlertPercent` | `5` | % distancia a liquidación para alerta |
| `checkCron` | `'0 */1 * * *'` | Frecuencia de chequeo (cron) |
| `dailySummaryCron` | `'0 22 * * *'` | Hora del resumen diario (cron) |

### Detalle de indicadores (`config.js.indicators`)

| Parámetro | Valor por defecto | Descripción |
|---|---|---|
| `rsiPeriod` | `14` | Periodo RSI utilizado |
| `rsiOverbought` | `70` | Umbral RSI para señal de entrada (4h) |
| `emaPeriod` | `20` | Periodo EMA utilizado |
| `timeframe` | `'4h'` | Timeframe para el análisis principal |
| `klinesLimit` | `100` | Número de velas históricas a consultar |
