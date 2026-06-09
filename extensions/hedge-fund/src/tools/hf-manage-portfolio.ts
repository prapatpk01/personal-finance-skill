import type { Portfolio, PortfolioStrategy, ToolContext, ToolResult } from "../types.js"
import { loadStore, mutate } from "../storage.js"

export const hfManagePortfolioTool = {
  name: "hf_manage_portfolio",
  description:
    "Manage the 4 named portfolios (Gambit Alpha, Sentinel Global, Agis Diversify, Kinetic Income). List, view, add/remove symbols, set target allocations, or create custom portfolios.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "get", "add_symbol", "remove_symbol", "set_target", "update", "create", "delete"],
        description:
          "list — all portfolios | get — one portfolio by id | add_symbol / remove_symbol — manage symbols | set_target — set % allocation | update — rename/description/notes | create — new portfolio | delete — remove portfolio",
      },
      id: {
        type: "string",
        description: "Portfolio ID (gambit-alpha | sentinel-global | agis-diversify | kinetic-income | custom id)",
      },
      symbol: {
        type: "string",
        description: "Ticker symbol for add_symbol / remove_symbol",
      },
      symbols: {
        type: "array",
        items: { type: "string" },
        description: "Symbol list for create",
      },
      target_pct: {
        type: "object",
        description: "Symbol → target allocation % map for set_target (e.g. { GPIQ: 50, QDVO: 30, BALI: 20 })",
        additionalProperties: { type: "number" },
      },
      name: {
        type: "string",
        description: "Portfolio name for create / update",
      },
      description: {
        type: "string",
        description: "Portfolio description for create / update",
      },
      strategy: {
        type: "string",
        enum: ["momentum", "passive", "dividend_growth", "covered_call", "custom"],
        description: "Strategy type for create / update",
      },
      notes: {
        type: "string",
        description: "Free-text notes (e.g. Thai stock positions, external broker info)",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async handler(
    input: {
      action: "list" | "get" | "add_symbol" | "remove_symbol" | "set_target" | "update" | "create" | "delete"
      id?: string
      symbol?: string
      symbols?: string[]
      target_pct?: Record<string, number>
      name?: string
      description?: string
      strategy?: PortfolioStrategy
      notes?: string
    },
    _context: ToolContext
  ): Promise<ToolResult<unknown>> {
    try {
      const store = loadStore()

      switch (input.action) {
        case "list": {
          return {
            success: true,
            data: {
              count: store.portfolios.length,
              portfolios: store.portfolios.map(p => ({
                id: p.id,
                name: p.name,
                strategy: p.strategy,
                symbolCount: p.symbols.length,
                symbols: p.symbols,
              })),
            },
          }
        }

        case "get": {
          if (!input.id) return { success: false, error: "id required for get" }
          const p = store.portfolios.find(x => x.id === input.id)
          if (!p) return { success: false, error: `Portfolio '${input.id}' not found` }
          return { success: true, data: p }
        }

        case "add_symbol": {
          if (!input.id) return { success: false, error: "id required" }
          if (!input.symbol) return { success: false, error: "symbol required" }
          const sym = input.symbol.toUpperCase()
          let portfolio: Portfolio | null = null
          mutate(s => {
            const p = s.portfolios.find(x => x.id === input.id)
            if (!p) return
            if (!p.symbols.includes(sym)) {
              p.symbols.push(sym)
              p.updatedAt = new Date().toISOString()
            }
            portfolio = p
          })
          if (!portfolio) return { success: false, error: `Portfolio '${input.id}' not found` }
          return { success: true, data: { portfolio } }
        }

        case "remove_symbol": {
          if (!input.id) return { success: false, error: "id required" }
          if (!input.symbol) return { success: false, error: "symbol required" }
          const sym = input.symbol.toUpperCase()
          let portfolio: Portfolio | null = null
          mutate(s => {
            const p = s.portfolios.find(x => x.id === input.id)
            if (!p) return
            p.symbols = p.symbols.filter(s => s !== sym)
            p.updatedAt = new Date().toISOString()
            portfolio = p
          })
          if (!portfolio) return { success: false, error: `Portfolio '${input.id}' not found` }
          return { success: true, data: { portfolio } }
        }

        case "set_target": {
          if (!input.id) return { success: false, error: "id required" }
          if (!input.target_pct) return { success: false, error: "target_pct required" }
          const total = Object.values(input.target_pct).reduce((a, b) => a + b, 0)
          if (Math.abs(total - 100) > 0.01 && total !== 0) {
            return { success: false, error: `target_pct must sum to 100 (got ${total.toFixed(1)})` }
          }
          let portfolio: Portfolio | null = null
          mutate(s => {
            const p = s.portfolios.find(x => x.id === input.id)
            if (!p) return
            const normalized: Record<string, number> = {}
            for (const [k, v] of Object.entries(input.target_pct!)) {
              normalized[k.toUpperCase()] = v
            }
            p.targetPct = normalized
            p.updatedAt = new Date().toISOString()
            portfolio = p
          })
          if (!portfolio) return { success: false, error: `Portfolio '${input.id}' not found` }
          return { success: true, data: { portfolio } }
        }

        case "update": {
          if (!input.id) return { success: false, error: "id required" }
          let portfolio: Portfolio | null = null
          mutate(s => {
            const p = s.portfolios.find(x => x.id === input.id)
            if (!p) return
            if (input.name !== undefined) p.name = input.name
            if (input.description !== undefined) p.description = input.description
            if (input.strategy !== undefined) p.strategy = input.strategy
            if (input.notes !== undefined) p.notes = input.notes
            p.updatedAt = new Date().toISOString()
            portfolio = p
          })
          if (!portfolio) return { success: false, error: `Portfolio '${input.id}' not found` }
          return { success: true, data: { portfolio } }
        }

        case "create": {
          if (!input.name) return { success: false, error: "name required for create" }
          const id = input.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
          if (store.portfolios.find(p => p.id === id)) {
            return { success: false, error: `Portfolio id '${id}' already exists` }
          }
          const now = new Date().toISOString()
          const portfolio: Portfolio = {
            id,
            name: input.name,
            description: input.description ?? "",
            strategy: input.strategy ?? "custom",
            symbols: (input.symbols ?? []).map(s => s.toUpperCase()),
            targetPct: {},
            notes: input.notes,
            createdAt: now,
            updatedAt: now,
          }
          mutate(s => { s.portfolios.push(portfolio) })
          return { success: true, data: { portfolio } }
        }

        case "delete": {
          if (!input.id) return { success: false, error: "id required for delete" }
          const protected_ = ["gambit-alpha", "sentinel-global", "agis-diversify", "kinetic-income"]
          if (protected_.includes(input.id)) {
            return { success: false, error: `Cannot delete built-in portfolio '${input.id}'. Use update to modify it.` }
          }
          let removed = false
          mutate(s => {
            const idx = s.portfolios.findIndex(p => p.id === input.id)
            if (idx !== -1) { s.portfolios.splice(idx, 1); removed = true }
          })
          if (!removed) return { success: false, error: `Portfolio '${input.id}' not found` }
          return { success: true, data: { deleted: true, id: input.id } }
        }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
}
