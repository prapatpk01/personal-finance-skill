import { readFileSync, writeFileSync, existsSync } from "node:fs"
import type {
  AlertChannel,
  ScheduleEntry,
  Portfolio,
  DividendEntry,
  DividendWithdrawal,
} from "./types.js"

export interface HedgeFundStore {
  version: number
  schedules: ScheduleEntry[]
  alertChannels: AlertChannel[]
  portfolios: Portfolio[]
  dividends: DividendEntry[]
  withdrawals: DividendWithdrawal[]
}

let filePath = process.env.HEDGE_FUND_STATE_FILE ?? "./hedge-fund-state.json"
let _cache: HedgeFundStore | null = null

function makeDefaultPortfolios(): Portfolio[] {
  const now = new Date().toISOString()
  return [
    {
      id: "gambit-alpha",
      name: "Gambit Alpha",
      description: "Active momentum trading — stocks, BTC, tactical cash (SGOV)",
      strategy: "momentum",
      symbols: ["NVDA", "PLTR", "SGOV", "BTCUSD"],
      targetPct: { NVDA: 40, PLTR: 20, SGOV: 30, BTCUSD: 10 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sentinel-global",
      name: "Sentinel Global",
      description: "Passive ETF core — broad market exposure",
      strategy: "passive",
      symbols: ["SPY", "QQQ", "GLD"],
      targetPct: {},
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "agis-diversify",
      name: "Agis Diversify",
      description: "Dividend growth — 5–6% annual yield target, long-term hold",
      strategy: "dividend_growth",
      symbols: ["KO", "ABBV", "ENB", "MO", "O", "MAIN", "ARCC", "GPIQ"],
      targetPct: {},
      notes: "Thai positions (PTTEP.BK, BDMS.BK) held via SET broker — record dividends manually",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "kinetic-income",
      name: "Kinetic Income",
      description: "Covered call ETFs — monthly income generation, 35–40% target allocation",
      strategy: "covered_call",
      symbols: ["GPIQ", "QDVO", "BALI"],
      targetPct: { GPIQ: 50, QDVO: 30, BALI: 20 },
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function makeEmpty(): HedgeFundStore {
  return {
    version: 1,
    schedules: [],
    alertChannels: [],
    portfolios: makeDefaultPortfolios(),
    dividends: [],
    withdrawals: [],
  }
}

export function configureStorePath(path: string): void {
  filePath = path
  _cache = null
}

export function loadStore(): HedgeFundStore {
  if (_cache) return _cache
  try {
    if (existsSync(filePath)) {
      const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<HedgeFundStore>
      _cache = {
        ...makeEmpty(),
        ...parsed,
        portfolios: parsed.portfolios?.length ? parsed.portfolios : makeDefaultPortfolios(),
      }
    } else {
      _cache = makeEmpty()
      saveStore()
    }
  } catch {
    _cache = makeEmpty()
  }
  return _cache
}

export function saveStore(): void {
  if (!_cache) return
  try {
    writeFileSync(filePath, JSON.stringify(_cache, null, 2), "utf-8")
  } catch (err) {
    console.error("[hedge-fund] state persist failed:", err)
  }
}

export function mutate(fn: (store: HedgeFundStore) => void): void {
  const store = loadStore()
  fn(store)
  saveStore()
}
