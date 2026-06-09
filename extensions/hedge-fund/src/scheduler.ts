import type { ScheduleEntry, CycleMode, HedgeFundConfig, FundConfig, AlertChannel } from "./types.js"
import { hfRunDailyCycleTool } from "./tools/hf-run-daily-cycle.js"
import { dispatchAlert } from "./alerts.js"

export class HedgeFundScheduler {
  private entries = new Map<string, ScheduleEntry>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private alertChannels: AlertChannel[] = []
  private getConfig: (() => HedgeFundConfig) | null = null
  private fundConfig: FundConfig | null = null

  init(getConfig: () => HedgeFundConfig, fundConfig: FundConfig): void {
    this.getConfig = getConfig
    this.fundConfig = fundConfig
  }

  setAlertChannels(channels: AlertChannel[]): void {
    this.alertChannels = channels
  }

  getAlertChannels(): readonly AlertChannel[] {
    return this.alertChannels
  }

  addEntry(entry: Omit<ScheduleEntry, "id" | "createdAt" | "lastRunAt" | "nextRunAt">): ScheduleEntry {
    const id = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const full: ScheduleEntry = {
      ...entry,
      id,
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      nextRunAt: this.calcNextRun(entry.timeUtc),
    }
    this.entries.set(id, full)
    if (entry.enabled) this.arm(full)
    return full
  }

  removeEntry(id: string): boolean {
    this.disarm(id)
    return this.entries.delete(id)
  }

  setEnabled(id: string, enabled: boolean): ScheduleEntry | null {
    const entry = this.entries.get(id)
    if (!entry) return null
    const updated = { ...entry, enabled }
    this.entries.set(id, updated)
    if (enabled) this.arm(updated)
    else this.disarm(id)
    return updated
  }

  listEntries(): readonly ScheduleEntry[] {
    return Array.from(this.entries.values())
  }

  private calcNextRun(timeUtc: string): string {
    const [hh, mm] = timeUtc.split(":").map(Number)
    const now = new Date()
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0))
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
    return next.toISOString()
  }

  private arm(entry: ScheduleEntry): void {
    this.disarm(entry.id)
    const delay = new Date(entry.nextRunAt).getTime() - Date.now()
    if (delay < 0) return
    const t = setTimeout(() => { this.fire(entry.id).catch(console.error) }, delay)
    this.timers.set(entry.id, t)
  }

  private disarm(id: string): void {
    const t = this.timers.get(id)
    if (t !== undefined) { clearTimeout(t); this.timers.delete(id) }
  }

  private async fire(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || !entry.enabled || !this.getConfig || !this.fundConfig) return

    const context = { config: this.getConfig(), fundConfig: this.fundConfig }
    const result = await hfRunDailyCycleTool.handler(
      { mode: entry.mode, symbols: entry.symbols ?? undefined },
      context
    )

    const now = new Date().toISOString()
    const updated = { ...entry, lastRunAt: now, nextRunAt: this.calcNextRun(entry.timeUtc) }
    this.entries.set(id, updated)
    this.arm(updated)

    if (!result.success || !result.data || this.alertChannels.length === 0) return
    const report = result.data

    await dispatchAlert(this.alertChannels, {
      eventType: "cycle_complete",
      summary: report.summary,
      details: report.execution
        ? `Orders: ${report.execution.successCount}/${report.execution.trades.length} | Notional: $${report.execution.totalNotional.toFixed(2)}`
        : undefined,
    })

    if (report.signals) {
      const buys = report.signals.signals.filter(s => s.direction === "BUY" && s.strength === "STRONG")
      const sells = report.signals.signals.filter(s => s.direction === "SELL" && s.strength === "STRONG")

      if (buys.length > 0) {
        await dispatchAlert(this.alertChannels, {
          eventType: "buy_signal",
          summary: `STRONG BUY: ${buys.map(s => s.symbol).join(", ")}`,
          details: buys.map(s => `${s.symbol} — confidence ${s.confidence}%\n${s.reasons.join(", ")}`).join("\n"),
        })
      }
      if (sells.length > 0) {
        await dispatchAlert(this.alertChannels, {
          eventType: "sell_signal",
          summary: `STRONG SELL: ${sells.map(s => s.symbol).join(", ")}`,
          details: sells.map(s => `${s.symbol} — confidence ${s.confidence}%\n${s.reasons.join(", ")}`).join("\n"),
        })
      }
    }

    if (report.risk?.tradingHalted) {
      await dispatchAlert(this.alertChannels, {
        eventType: "trading_halted",
        summary: `Trading HALTED`,
        details: report.risk.haltReason ?? undefined,
      })
    }
  }
}

export const scheduler = new HedgeFundScheduler()
