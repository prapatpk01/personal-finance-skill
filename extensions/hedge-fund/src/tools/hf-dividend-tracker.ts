import type { DividendEntry, DividendWithdrawal, Currency, ToolContext, ToolResult } from "../types.js"
import { loadStore, mutate } from "../storage.js"

function uid(): string {
  return `div-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function withdrawalUid(): string {
  return `wdraw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export const hfDividendTrackerTool = {
  name: "hf_dividend_tracker",
  description:
    "Track dividend income per portfolio and enforce the withdrawal policy: withdrawals only from dividend income — never from principal or capital gains. Actions: record_dividend, record_withdrawal, summary, check_withdrawal, list.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["record_dividend", "record_withdrawal", "summary", "check_withdrawal", "list"],
        description:
          "record_dividend — log a received dividend | record_withdrawal — log a withdrawal | summary — income vs withdrawals per portfolio | check_withdrawal — validate a planned withdrawal against policy | list — raw dividend entries",
      },
      portfolio_id: {
        type: "string",
        description: "Portfolio ID filter (agis-diversify, kinetic-income, etc.)",
      },
      symbol: {
        type: "string",
        description: "Ticker symbol (required for record_dividend)",
      },
      ex_date: {
        type: "string",
        description: "Ex-dividend date YYYY-MM-DD",
      },
      pay_date: {
        type: "string",
        description: "Payment date YYYY-MM-DD (required for record_dividend)",
      },
      per_share: {
        type: "number",
        description: "Dividend per share",
      },
      shares: {
        type: "number",
        description: "Number of shares held",
      },
      amount: {
        type: "number",
        description: "Total amount for record_withdrawal or check_withdrawal",
      },
      currency: {
        type: "string",
        enum: ["USD", "THB"],
        description: "Currency (default: USD)",
      },
      date: {
        type: "string",
        description: "Date YYYY-MM-DD for record_withdrawal",
      },
      note: {
        type: "string",
        description: "Note for record_withdrawal",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async handler(
    input: {
      action: "record_dividend" | "record_withdrawal" | "summary" | "check_withdrawal" | "list"
      portfolio_id?: string
      symbol?: string
      ex_date?: string
      pay_date?: string
      per_share?: number
      shares?: number
      amount?: number
      currency?: Currency
      date?: string
      note?: string
    },
    _context: ToolContext
  ): Promise<ToolResult<unknown>> {
    try {
      const store = loadStore()
      const currency: Currency = input.currency ?? "USD"

      switch (input.action) {
        case "record_dividend": {
          if (!input.portfolio_id) return { success: false, error: "portfolio_id required" }
          if (!input.symbol) return { success: false, error: "symbol required" }
          if (!input.pay_date) return { success: false, error: "pay_date required" }
          if (input.per_share === undefined) return { success: false, error: "per_share required" }
          if (input.shares === undefined) return { success: false, error: "shares required" }

          const entry: DividendEntry = {
            id: uid(),
            portfolioId: input.portfolio_id,
            symbol: input.symbol.toUpperCase(),
            exDate: input.ex_date ?? input.pay_date,
            payDate: input.pay_date,
            perShare: input.per_share,
            shares: input.shares,
            totalAmount: +(input.per_share * input.shares).toFixed(4),
            currency,
            recordedAt: new Date().toISOString(),
          }
          mutate(s => { s.dividends.push(entry) })
          return { success: true, data: { recorded: entry } }
        }

        case "record_withdrawal": {
          if (input.amount === undefined) return { success: false, error: "amount required" }
          if (!input.date) return { success: false, error: "date required (YYYY-MM-DD)" }

          // Policy check before recording
          const check = policyCheck(store.dividends, store.withdrawals, input.portfolio_id ?? null, input.amount, currency)
          if (!check.allowed) {
            return {
              success: false,
              error: `Policy violation: ${check.reason}. Available: ${check.available.toFixed(2)} ${currency}`,
            }
          }

          const w: DividendWithdrawal = {
            id: withdrawalUid(),
            portfolioId: input.portfolio_id ?? null,
            amount: input.amount,
            currency,
            date: input.date,
            note: input.note ?? "",
            recordedAt: new Date().toISOString(),
          }
          mutate(s => { s.withdrawals.push(w) })
          return {
            success: true,
            data: {
              recorded: w,
              remainingAvailable: +(check.available - input.amount).toFixed(2),
              policy: "Withdrawal recorded from dividend income only — principal untouched",
            },
          }
        }

        case "check_withdrawal": {
          if (input.amount === undefined) return { success: false, error: "amount required" }
          const check = policyCheck(store.dividends, store.withdrawals, input.portfolio_id ?? null, input.amount, currency)
          return {
            success: true,
            data: {
              allowed: check.allowed,
              requestedAmount: input.amount,
              available: check.available,
              shortfall: check.allowed ? 0 : +(input.amount - check.available).toFixed(2),
              reason: check.reason,
              currency,
            },
          }
        }

        case "summary": {
          const portfolios = store.portfolios
          const summaries = portfolios
            .filter(p => !input.portfolio_id || p.id === input.portfolio_id)
            .map(p => {
              const divs = store.dividends.filter(d => d.portfolioId === p.id && d.currency === "USD")
              const wdraws = store.withdrawals.filter(
                w => (w.portfolioId === p.id || w.portfolioId === null) && w.currency === "USD"
              )
              const totalDivs = divs.reduce((a, d) => a + d.totalAmount, 0)
              const totalWithdrawn = wdraws.reduce((a, w) => a + w.amount, 0)
              const ytd = ytdAmount(divs)
              return {
                portfolioId: p.id,
                portfolioName: p.name,
                totalDividendsUSD: +totalDivs.toFixed(2),
                totalWithdrawnUSD: +totalWithdrawn.toFixed(2),
                availableUSD: +(totalDivs - totalWithdrawn).toFixed(2),
                ytdUSD: +ytd.toFixed(2),
                entryCount: divs.length,
              }
            })

          const globalTotal = summaries.reduce((a, s) => a + s.totalDividendsUSD, 0)
          const globalAvailable = summaries.reduce((a, s) => a + s.availableUSD, 0)

          return {
            success: true,
            data: {
              portfolios: summaries,
              totalDividendsUSD: +globalTotal.toFixed(2),
              availableForWithdrawalUSD: +globalAvailable.toFixed(2),
              policy: "Withdrawals are only allowed from dividend income — never from principal or capital gains",
            },
          }
        }

        case "list": {
          const divs = store.dividends
            .filter(d => !input.portfolio_id || d.portfolioId === input.portfolio_id)
            .sort((a, b) => b.payDate.localeCompare(a.payDate))
          return { success: true, data: { count: divs.length, entries: divs } }
        }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
}

function ytdAmount(divs: DividendEntry[]): number {
  const year = new Date().getFullYear().toString()
  return divs
    .filter(d => d.payDate.startsWith(year))
    .reduce((a, d) => a + d.totalAmount, 0)
}

function policyCheck(
  divs: DividendEntry[],
  withdrawals: DividendWithdrawal[],
  portfolioId: string | null,
  amount: number,
  currency: Currency
): { allowed: boolean; available: number; reason: string } {
  const totalDivs = divs
    .filter(d => (!portfolioId || d.portfolioId === portfolioId) && d.currency === currency)
    .reduce((a, d) => a + d.totalAmount, 0)

  const totalWithdrawn = withdrawals
    .filter(w => (!portfolioId || w.portfolioId === portfolioId || w.portfolioId === null) && w.currency === currency)
    .reduce((a, w) => a + w.amount, 0)

  const available = totalDivs - totalWithdrawn

  if (amount > available) {
    return {
      allowed: false,
      available,
      reason: `Withdrawal ${amount} exceeds available dividend balance ${available.toFixed(2)} ${currency}`,
    }
  }
  return { allowed: true, available, reason: "Within dividend balance" }
}
