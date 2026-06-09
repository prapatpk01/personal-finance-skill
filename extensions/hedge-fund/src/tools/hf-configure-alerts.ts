import type { AlertChannel, AlertChannelType, AlertEventType, ToolContext, ToolResult } from "../types.js"
import { scheduler } from "../scheduler.js"
import { dispatchAlert } from "../alerts.js"

const ALL_EVENTS: AlertEventType[] = [
  "cycle_complete",
  "buy_signal",
  "sell_signal",
  "trading_halted",
  "drawdown_alert",
]

export const hfConfigureAlertsTool = {
  name: "hf_configure_alerts",
  description:
    "Configure push notification channels for hedge fund alerts. Supports LINE Notify (Thailand), Telegram Bot, and generic webhooks (Slack, Discord). Use action='test' to verify a channel.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "remove", "list", "test"],
        description:
          "add — register a channel | remove — delete by id | list — show all (tokens hidden) | test — send test message",
      },
      id: {
        type: "string",
        description: "Channel ID — required for remove and test",
      },
      channel_type: {
        type: "string",
        enum: ["line", "telegram", "webhook"],
        description: "line — LINE Notify (popular in Thailand) | telegram — Telegram Bot | webhook — Slack / Discord / custom",
      },
      line_token: {
        type: "string",
        description: "LINE Notify token from notify.line.me — required for line channel",
      },
      telegram_bot_token: {
        type: "string",
        description: "Telegram Bot API token from @BotFather — required for telegram channel",
      },
      telegram_chat_id: {
        type: "string",
        description: "Telegram chat or channel ID — required for telegram channel",
      },
      webhook_url: {
        type: "string",
        description: "Webhook POST URL — required for webhook channel",
      },
      events: {
        type: "array",
        items: {
          type: "string",
          enum: ["cycle_complete", "buy_signal", "sell_signal", "trading_halted", "drawdown_alert"],
        },
        description: "Events to notify on (default: all events)",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async handler(
    input: {
      action: "add" | "remove" | "list" | "test"
      id?: string
      channel_type?: AlertChannelType
      line_token?: string
      telegram_bot_token?: string
      telegram_chat_id?: string
      webhook_url?: string
      events?: AlertEventType[]
    },
    _context: ToolContext
  ): Promise<ToolResult<unknown>> {
    try {
      const channels = [...scheduler.getAlertChannels()]

      switch (input.action) {
        case "list": {
          return {
            success: true,
            data: {
              count: channels.length,
              channels: channels.map(ch => ({
                id: ch.id,
                type: ch.type,
                events: ch.events,
                configured:
                  ch.type === "line"
                    ? !!ch.lineToken
                    : ch.type === "telegram"
                      ? !!(ch.telegramBotToken && ch.telegramChatId)
                      : !!ch.webhookUrl,
              })),
            },
          }
        }

        case "add": {
          if (!input.channel_type) return { success: false, error: "channel_type required for add" }
          const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
          const events: AlertEventType[] = input.events ?? ALL_EVENTS
          let channel: AlertChannel

          if (input.channel_type === "line") {
            if (!input.line_token) return { success: false, error: "line_token required for LINE channel" }
            channel = { id, type: "line", lineToken: input.line_token, events }
          } else if (input.channel_type === "telegram") {
            if (!input.telegram_bot_token || !input.telegram_chat_id) {
              return { success: false, error: "telegram_bot_token and telegram_chat_id required" }
            }
            channel = {
              id,
              type: "telegram",
              telegramBotToken: input.telegram_bot_token,
              telegramChatId: input.telegram_chat_id,
              events,
            }
          } else {
            if (!input.webhook_url) return { success: false, error: "webhook_url required for webhook channel" }
            channel = { id, type: "webhook", webhookUrl: input.webhook_url, events }
          }

          scheduler.setAlertChannels([...channels, channel])
          return {
            success: true,
            data: {
              created: { id: channel.id, type: channel.type, events: channel.events },
              tip: `Run action='test' with id='${id}' to verify the channel works`,
            },
          }
        }

        case "remove": {
          if (!input.id) return { success: false, error: "id required for remove" }
          const filtered = channels.filter(ch => ch.id !== input.id)
          if (filtered.length === channels.length) return { success: false, error: `Channel ${input.id} not found` }
          scheduler.setAlertChannels(filtered)
          return { success: true, data: { removed: true, id: input.id } }
        }

        case "test": {
          if (!input.id) return { success: false, error: "id required for test" }
          const ch = channels.find(c => c.id === input.id)
          if (!ch) return { success: false, error: `Channel ${input.id} not found` }
          const result = await dispatchAlert([ch], {
            eventType: "cycle_complete",
            summary: "Test notification — Office Hedge Fund is connected",
            details: `Channel ${input.id} (${ch.type}) working correctly`,
          })
          return {
            success: result.errors.length === 0,
            data: { sent: result.sent, errors: result.errors },
          }
        }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
}
