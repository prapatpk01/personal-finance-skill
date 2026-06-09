import type { CycleMode, ToolContext, ToolResult } from "../types.js"
import { scheduler } from "../scheduler.js"

function bangkokTime(timeUtc: string): string {
  const [hh, mm] = timeUtc.split(":").map(Number)
  return `${String((hh + 7) % 24).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

export const hfScheduleCycleTool = {
  name: "hf_schedule_cycle",
  description:
    "Manage automated daily hedge fund cycles. Schedules run in the cloud — no laptop needed. Add, remove, enable, disable, or list scheduled daily runs.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "remove", "list", "enable", "disable"],
        description:
          "add — create a new daily schedule | remove — delete by id | list — show all | enable/disable — toggle by id",
      },
      id: {
        type: "string",
        description: "Schedule ID — required for remove, enable, disable",
      },
      time_utc: {
        type: "string",
        description:
          "Daily run time in UTC HH:MM (Bangkok = UTC+7: to run at 08:30 BKK use '01:30')",
        pattern: "^\\d{2}:\\d{2}$",
      },
      mode: {
        type: "string",
        enum: ["research_only", "signals_only", "full_dry_run", "full"],
        description: "Cycle mode — full requires confirm:true on hf_run_daily_cycle for live orders",
        default: "full_dry_run",
      },
      symbols: {
        type: "array",
        items: { type: "string" },
        description: "Override trading universe for this schedule (default: use current fundConfig.universe)",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async handler(
    input: {
      action: "add" | "remove" | "list" | "enable" | "disable"
      id?: string
      time_utc?: string
      mode?: CycleMode
      symbols?: string[]
    },
    _context: ToolContext
  ): Promise<ToolResult<unknown>> {
    try {
      switch (input.action) {
        case "list": {
          const entries = scheduler.listEntries()
          return {
            success: true,
            data: {
              count: entries.length,
              schedules: entries.map(e => ({
                ...e,
                bangkokTime: bangkokTime(e.timeUtc),
              })),
              note: "Bangkok = UTC+7",
            },
          }
        }

        case "add": {
          if (!input.time_utc) return { success: false, error: "time_utc required for add (e.g. '01:30')" }
          const entry = scheduler.addEntry({
            timeUtc: input.time_utc,
            mode: input.mode ?? "full_dry_run",
            symbols: input.symbols ?? null,
            enabled: true,
          })
          return {
            success: true,
            data: {
              created: { ...entry, bangkokTime: bangkokTime(entry.timeUtc) },
              note: `Runs daily at ${input.time_utc} UTC = ${bangkokTime(input.time_utc)} Bangkok time`,
            },
          }
        }

        case "remove": {
          if (!input.id) return { success: false, error: "id required for remove" }
          const removed = scheduler.removeEntry(input.id)
          return { success: true, data: { removed, id: input.id } }
        }

        case "enable":
        case "disable": {
          if (!input.id) return { success: false, error: `id required for ${input.action}` }
          const updated = scheduler.setEnabled(input.id, input.action === "enable")
          if (!updated) return { success: false, error: `Schedule ${input.id} not found` }
          return { success: true, data: { updated: { ...updated, bangkokTime: bangkokTime(updated.timeUtc) } } }
        }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
}
