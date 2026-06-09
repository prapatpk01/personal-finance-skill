import { describe, it, expect, beforeEach } from "vitest"
import { calcRSI, calcMACD, calcATR } from "../src/indicators.js"
import { assetClass, CRYPTO_SYMBOLS, isTradableOnAlpaca } from "../src/client.js"
import { hfScheduleCycleTool } from "../src/tools/hf-schedule-cycle.js"
import { hfConfigureAlertsTool } from "../src/tools/hf-configure-alerts.js"
import { hfManagePortfolioTool } from "../src/tools/hf-manage-portfolio.js"
import { hfDividendTrackerTool } from "../src/tools/hf-dividend-tracker.js"
import { configureStorePath } from "../src/storage.js"
import { scheduler } from "../src/scheduler.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSync, existsSync } from "node:fs"

// ── Test helpers ──

function makeCtx() {
  return {
    config: {} as any,
    fundConfig: {
      universe: ["NVDA", "BTCUSD"],
      maxPositionPct: 0.15,
      maxDrawdownPct: 0.10,
      baseNotionalPerTrade: 1000,
    },
  }
}

let testStore: string
let storeSeq = 0

beforeEach(() => {
  testStore = join(tmpdir(), `hf-test-${Date.now()}-${++storeSeq}-${Math.random().toString(36).slice(2, 8)}.json`)
  configureStorePath(testStore)
  scheduler.reset()
  scheduler.init(() => ({} as any), makeCtx().fundConfig)
})

// ── Indicator Tests ──

describe("calcRSI", () => {
  it("returns null when data is insufficient", () => {
    expect(calcRSI([100, 101, 102], 14)).toBeNull()
  })

  it("returns 100 when all periods are gains", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i)
    expect(calcRSI(closes)).toBe(100)
  })

  it("returns 0 when all periods are losses", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i)
    expect(calcRSI(closes)).toBe(0)
  })

  it("returns a value in [0, 100] for mixed data", () => {
    const closes = [100, 102, 101, 105, 103, 107, 104, 108, 105, 109, 106, 107, 105, 108, 110, 109]
    const rsi = calcRSI(closes)
    expect(rsi).not.toBeNull()
    expect(rsi!).toBeGreaterThanOrEqual(0)
    expect(rsi!).toBeLessThanOrEqual(100)
  })

  it("gives higher RSI for consistently rising prices", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i * 2)
    const falling = Array.from({ length: 20 }, (_, i) => 200 - i * 2)
    const rsiRising = calcRSI(rising)!
    const rsiFalling = calcRSI(falling)!
    expect(rsiRising).toBeGreaterThan(rsiFalling)
  })

  it("oversold threshold: RSI < 30 for sharp downtrend", () => {
    const closes = [200, 180, 160, 145, 135, 128, 122, 118, 115, 113, 111, 109, 108, 107, 106]
    const rsi = calcRSI(closes)
    expect(rsi).not.toBeNull()
    expect(rsi!).toBeLessThan(30)
  })
})

describe("calcMACD", () => {
  it("returns null with fewer than 35 data points", () => {
    expect(calcMACD(Array.from({ length: 30 }, (_, i) => 100 + i))).toBeNull()
  })

  it("returns correct shape for sufficient data", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10)
    const result = calcMACD(closes)
    expect(result).not.toBeNull()
    expect(typeof result!.macdLine).toBe("number")
    expect(typeof result!.signalLine).toBe("number")
    expect(result!.histogram).toBeCloseTo(result!.macdLine - result!.signalLine, 8)
  })

  it("histogram = macdLine - signalLine", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5 + Math.random() * 2)
    const result = calcMACD(closes)
    expect(result).not.toBeNull()
    expect(Math.abs(result!.histogram - (result!.macdLine - result!.signalLine))).toBeLessThan(1e-9)
  })
})

describe("calcATR", () => {
  it("returns null with insufficient data", () => {
    expect(calcATR([105, 106], [95, 96], [100, 101], 14)).toBeNull()
  })

  it("returns a positive number for valid data", () => {
    const n = 20
    const c = Array.from({ length: n }, (_, i) => 100 + i)
    const h = c.map(v => v + 2)
    const l = c.map(v => v - 2)
    const atr = calcATR(h, l, c)
    expect(atr).not.toBeNull()
    expect(atr!).toBeGreaterThan(0)
  })
})

// ── Asset Classification Tests ──

describe("assetClass", () => {
  it("classifies BTCUSD as crypto", () => {
    expect(assetClass("BTCUSD")).toBe("crypto")
  })

  it("classifies GLD as etf", () => {
    expect(assetClass("GLD")).toBe("etf")
  })

  it("classifies GPIQ as etf", () => {
    expect(assetClass("GPIQ")).toBe("etf")
  })

  it("classifies SGOV as etf", () => {
    expect(assetClass("SGOV")).toBe("etf")
  })

  it("classifies AAPL as equity", () => {
    expect(assetClass("AAPL")).toBe("equity")
  })

  it("classifies PTTEP.BK as thai_equity", () => {
    expect(assetClass("PTTEP.BK")).toBe("thai_equity")
  })

  it("classifies BDMS.BK as thai_equity", () => {
    expect(assetClass("BDMS.BK")).toBe("thai_equity")
  })

  it("classifies all CRYPTO_SYMBOLS as crypto", () => {
    for (const sym of CRYPTO_SYMBOLS) {
      expect(assetClass(sym)).toBe("crypto")
    }
  })

  it("isTradableOnAlpaca returns false for Thai stocks", () => {
    expect(isTradableOnAlpaca("PTTEP.BK")).toBe(false)
    expect(isTradableOnAlpaca("BDMS.BK")).toBe(false)
  })

  it("isTradableOnAlpaca returns true for US equities", () => {
    expect(isTradableOnAlpaca("NVDA")).toBe(true)
    expect(isTradableOnAlpaca("BTCUSD")).toBe(true)
    expect(isTradableOnAlpaca("GLD")).toBe(true)
  })
})

// ── Scheduler Tool Tests ──

describe("hf_schedule_cycle", () => {
  it("list returns empty initially", async () => {
    const result = await hfScheduleCycleTool.handler({ action: "list" }, makeCtx())
    expect(result.success).toBe(true)
    expect((result.data as any).count).toBe(0)
  })

  it("add creates a schedule with correct Bangkok time", async () => {
    const result = await hfScheduleCycleTool.handler(
      { action: "add", time_utc: "01:30", mode: "full_dry_run" },
      makeCtx()
    )
    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.created.timeUtc).toBe("01:30")
    expect(data.created.bangkokTime).toBe("08:30")
    expect(data.created.enabled).toBe(true)
    expect(data.created.id).toMatch(/^sched-/)
  })

  it("list shows added schedule", async () => {
    await hfScheduleCycleTool.handler({ action: "add", time_utc: "02:00", mode: "signals_only" }, makeCtx())
    const result = await hfScheduleCycleTool.handler({ action: "list" }, makeCtx())
    expect((result.data as any).count).toBe(1)
  })

  it("remove deletes a schedule", async () => {
    const add = await hfScheduleCycleTool.handler({ action: "add", time_utc: "03:00" }, makeCtx())
    const id = (add.data as any).created.id
    const rem = await hfScheduleCycleTool.handler({ action: "remove", id }, makeCtx())
    expect(rem.success).toBe(true)
    expect((rem.data as any).removed).toBe(true)
    const list = await hfScheduleCycleTool.handler({ action: "list" }, makeCtx())
    expect((list.data as any).count).toBe(0)
  })

  it("disable + enable toggle enabled flag", async () => {
    const add = await hfScheduleCycleTool.handler({ action: "add", time_utc: "04:00" }, makeCtx())
    const id = (add.data as any).created.id
    const dis = await hfScheduleCycleTool.handler({ action: "disable", id }, makeCtx())
    expect((dis.data as any).updated.enabled).toBe(false)
    const en = await hfScheduleCycleTool.handler({ action: "enable", id }, makeCtx())
    expect((en.data as any).updated.enabled).toBe(true)
  })

  it("add requires time_utc", async () => {
    const result = await hfScheduleCycleTool.handler({ action: "add" }, makeCtx())
    expect(result.success).toBe(false)
  })

  it("Bangkok time wraps correctly at midnight UTC", async () => {
    const result = await hfScheduleCycleTool.handler({ action: "add", time_utc: "20:00" }, makeCtx())
    expect((result.data as any).created.bangkokTime).toBe("03:00")
  })
})

// ── Alert Config Tool Tests ──

describe("hf_configure_alerts", () => {
  it("list returns empty initially", async () => {
    const result = await hfConfigureAlertsTool.handler({ action: "list" }, makeCtx())
    expect(result.success).toBe(true)
    expect((result.data as any).count).toBe(0)
  })

  it("add LINE channel succeeds with token", async () => {
    const result = await hfConfigureAlertsTool.handler(
      { action: "add", channel_type: "line", line_token: "test-token-123" },
      makeCtx()
    )
    expect(result.success).toBe(true)
    expect((result.data as any).created.type).toBe("line")
    expect((result.data as any).created.id).toMatch(/^alert-/)
  })

  it("add LINE channel requires line_token", async () => {
    const result = await hfConfigureAlertsTool.handler({ action: "add", channel_type: "line" }, makeCtx())
    expect(result.success).toBe(false)
  })

  it("add Telegram requires both bot_token and chat_id", async () => {
    const missing = await hfConfigureAlertsTool.handler(
      { action: "add", channel_type: "telegram", telegram_bot_token: "bot123" },
      makeCtx()
    )
    expect(missing.success).toBe(false)
  })

  it("add webhook channel succeeds with URL", async () => {
    const result = await hfConfigureAlertsTool.handler(
      { action: "add", channel_type: "webhook", webhook_url: "https://example.com/hook" },
      makeCtx()
    )
    expect(result.success).toBe(true)
    expect((result.data as any).created.type).toBe("webhook")
  })

  it("remove deletes a channel", async () => {
    const add = await hfConfigureAlertsTool.handler(
      { action: "add", channel_type: "webhook", webhook_url: "https://example.com/hook" },
      makeCtx()
    )
    const id = (add.data as any).created.id
    const rem = await hfConfigureAlertsTool.handler({ action: "remove", id }, makeCtx())
    expect(rem.success).toBe(true)
    const list = await hfConfigureAlertsTool.handler({ action: "list" }, makeCtx())
    expect((list.data as any).count).toBe(0)
  })

  it("does not expose tokens in list output", async () => {
    await hfConfigureAlertsTool.handler(
      { action: "add", channel_type: "line", line_token: "secret-token" },
      makeCtx()
    )
    const list = await hfConfigureAlertsTool.handler({ action: "list" }, makeCtx())
    const raw = JSON.stringify((list.data as any).channels)
    expect(raw).not.toContain("secret-token")
  })

  it("events default to all event types when not specified", async () => {
    const result = await hfConfigureAlertsTool.handler(
      { action: "add", channel_type: "webhook", webhook_url: "https://example.com/hook" },
      makeCtx()
    )
    const events = (result.data as any).created.events as string[]
    expect(events).toContain("cycle_complete")
    expect(events).toContain("buy_signal")
    expect(events).toContain("sell_signal")
    expect(events).toContain("trading_halted")
    expect(events).toContain("drawdown_alert")
  })
})

// ── Portfolio Management Tool Tests ──

describe("hf_manage_portfolio", () => {
  it("list returns the 4 default portfolios", async () => {
    const result = await hfManagePortfolioTool.handler({ action: "list" }, makeCtx())
    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.count).toBe(4)
    const ids = data.portfolios.map((p: any) => p.id)
    expect(ids).toContain("gambit-alpha")
    expect(ids).toContain("sentinel-global")
    expect(ids).toContain("agis-diversify")
    expect(ids).toContain("kinetic-income")
  })

  it("get returns a specific portfolio", async () => {
    const result = await hfManagePortfolioTool.handler({ action: "get", id: "gambit-alpha" }, makeCtx())
    expect(result.success).toBe(true)
    expect((result.data as any).id).toBe("gambit-alpha")
    expect((result.data as any).strategy).toBe("momentum")
  })

  it("get returns error for unknown id", async () => {
    const result = await hfManagePortfolioTool.handler({ action: "get", id: "nonexistent" }, makeCtx())
    expect(result.success).toBe(false)
  })

  it("add_symbol adds a symbol to portfolio", async () => {
    const result = await hfManagePortfolioTool.handler(
      { action: "add_symbol", id: "agis-diversify", symbol: "abbv" },
      makeCtx()
    )
    expect(result.success).toBe(true)
    const portfolio = (result.data as any).portfolio
    expect(portfolio.symbols).toContain("ABBV")
  })

  it("add_symbol is idempotent (no duplicates)", async () => {
    await hfManagePortfolioTool.handler({ action: "add_symbol", id: "agis-diversify", symbol: "KO" }, makeCtx())
    await hfManagePortfolioTool.handler({ action: "add_symbol", id: "agis-diversify", symbol: "KO" }, makeCtx())
    const get = await hfManagePortfolioTool.handler({ action: "get", id: "agis-diversify" }, makeCtx())
    const koCount = ((get.data as any).symbols as string[]).filter(s => s === "KO").length
    expect(koCount).toBe(1)
  })

  it("remove_symbol removes a symbol", async () => {
    await hfManagePortfolioTool.handler({ action: "add_symbol", id: "agis-diversify", symbol: "MO" }, makeCtx())
    const result = await hfManagePortfolioTool.handler(
      { action: "remove_symbol", id: "agis-diversify", symbol: "MO" },
      makeCtx()
    )
    expect(result.success).toBe(true)
    expect((result.data as any).portfolio.symbols).not.toContain("MO")
  })

  it("set_target validates sum to 100", async () => {
    const bad = await hfManagePortfolioTool.handler(
      { action: "set_target", id: "kinetic-income", target_pct: { GPIQ: 60, QDVO: 30 } },
      makeCtx()
    )
    expect(bad.success).toBe(false)

    const good = await hfManagePortfolioTool.handler(
      { action: "set_target", id: "kinetic-income", target_pct: { GPIQ: 50, QDVO: 30, BALI: 20 } },
      makeCtx()
    )
    expect(good.success).toBe(true)
    expect((good.data as any).portfolio.targetPct.GPIQ).toBe(50)
  })

  it("create makes a new portfolio and delete removes it", async () => {
    const created = await hfManagePortfolioTool.handler(
      { action: "create", name: "Test Portfolio", strategy: "custom", symbols: ["AAPL", "MSFT"] },
      makeCtx()
    )
    expect(created.success).toBe(true)
    const id = (created.data as any).portfolio.id

    const del = await hfManagePortfolioTool.handler({ action: "delete", id }, makeCtx())
    expect(del.success).toBe(true)
  })

  it("cannot delete built-in portfolios", async () => {
    const result = await hfManagePortfolioTool.handler({ action: "delete", id: "gambit-alpha" }, makeCtx())
    expect(result.success).toBe(false)
    expect((result.error as string)).toContain("built-in")
  })
})

// ── Dividend Tracker Tool Tests ──

describe("hf_dividend_tracker", () => {
  it("summary returns empty state initially", async () => {
    const result = await hfDividendTrackerTool.handler({ action: "summary" }, makeCtx())
    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.totalDividendsUSD).toBe(0)
    expect(data.availableForWithdrawalUSD).toBe(0)
  })

  it("record_dividend stores an entry", async () => {
    const result = await hfDividendTrackerTool.handler(
      {
        action: "record_dividend",
        portfolio_id: "agis-diversify",
        symbol: "KO",
        pay_date: "2026-03-01",
        per_share: 0.485,
        shares: 100,
        currency: "USD",
      },
      makeCtx()
    )
    expect(result.success).toBe(true)
    expect((result.data as any).recorded.totalAmount).toBeCloseTo(48.5, 2)
  })

  it("summary reflects recorded dividends", async () => {
    await hfDividendTrackerTool.handler(
      {
        action: "record_dividend",
        portfolio_id: "agis-diversify",
        symbol: "O",
        pay_date: "2026-02-15",
        per_share: 0.263,
        shares: 50,
        currency: "USD",
      },
      makeCtx()
    )
    const result = await hfDividendTrackerTool.handler({ action: "summary", portfolio_id: "agis-diversify" }, makeCtx())
    const portfolio = (result.data as any).portfolios[0]
    expect(portfolio.totalDividendsUSD).toBeCloseTo(13.15, 2)
    expect(portfolio.availableUSD).toBeCloseTo(13.15, 2)
  })

  it("check_withdrawal allows amount within balance", async () => {
    await hfDividendTrackerTool.handler(
      {
        action: "record_dividend",
        portfolio_id: "kinetic-income",
        symbol: "GPIQ",
        pay_date: "2026-03-01",
        per_share: 0.42,
        shares: 200,
        currency: "USD",
      },
      makeCtx()
    )
    const check = await hfDividendTrackerTool.handler(
      { action: "check_withdrawal", portfolio_id: "kinetic-income", amount: 50, currency: "USD" },
      makeCtx()
    )
    expect((check.data as any).allowed).toBe(true)
    expect((check.data as any).available).toBeCloseTo(84, 0)
  })

  it("check_withdrawal blocks amount exceeding balance", async () => {
    const check = await hfDividendTrackerTool.handler(
      { action: "check_withdrawal", portfolio_id: "agis-diversify", amount: 999, currency: "USD" },
      makeCtx()
    )
    expect((check.data as any).allowed).toBe(false)
    expect((check.data as any).shortfall).toBeGreaterThan(0)
  })

  it("record_withdrawal enforces policy and reduces available balance", async () => {
    await hfDividendTrackerTool.handler(
      {
        action: "record_dividend",
        portfolio_id: "agis-diversify",
        symbol: "ABBV",
        pay_date: "2026-03-01",
        per_share: 1.64,
        shares: 30,
        currency: "USD",
      },
      makeCtx()
    )
    const withdraw = await hfDividendTrackerTool.handler(
      {
        action: "record_withdrawal",
        portfolio_id: "agis-diversify",
        amount: 20,
        date: "2026-03-15",
        note: "Monthly expense",
        currency: "USD",
      },
      makeCtx()
    )
    expect(withdraw.success).toBe(true)
    expect((withdraw.data as any).remainingAvailable).toBeCloseTo(49.2 - 20, 0)
  })

  it("record_withdrawal blocks over-withdrawal (policy enforcement)", async () => {
    const result = await hfDividendTrackerTool.handler(
      {
        action: "record_withdrawal",
        portfolio_id: "agis-diversify",
        amount: 10000,
        date: "2026-03-15",
        note: "Should be blocked",
        currency: "USD",
      },
      makeCtx()
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain("Policy violation")
  })

  it("list returns all dividend entries", async () => {
    await hfDividendTrackerTool.handler(
      {
        action: "record_dividend",
        portfolio_id: "agis-diversify",
        symbol: "ENB",
        pay_date: "2026-03-01",
        per_share: 0.915,
        shares: 100,
        currency: "USD",
      },
      makeCtx()
    )
    const list = await hfDividendTrackerTool.handler({ action: "list" }, makeCtx())
    expect((list.data as any).count).toBeGreaterThanOrEqual(1)
  })
})
