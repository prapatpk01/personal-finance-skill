import type { AlertChannel, AlertPayload } from "./types.js"

async function sendLine(token: string, message: string): Promise<void> {
  const res = await fetch("https://notify-api.line.me/api/notify", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ message }),
  })
  if (!res.ok) throw new Error(`LINE Notify ${res.status}: ${await res.text()}`)
}

async function sendTelegram(botToken: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  })
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`)
}

async function sendWebhook(url: string, payload: AlertPayload): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "office-hedge-fund", ...payload }),
  })
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${await res.text()}`)
}

export async function dispatchAlert(
  channels: readonly AlertChannel[],
  payload: AlertPayload
): Promise<{ sent: number; errors: string[] }> {
  const eligible = channels.filter(ch => ch.events.includes(payload.eventType))
  const errors: string[] = []
  let sent = 0

  const message = `\n🏦 Office Hedge Fund\n[${payload.eventType}] ${payload.summary}${payload.details ? `\n${payload.details}` : ""}`

  await Promise.allSettled(
    eligible.map(async ch => {
      try {
        if (ch.type === "line" && ch.lineToken) {
          await sendLine(ch.lineToken, message)
        } else if (ch.type === "telegram" && ch.telegramBotToken && ch.telegramChatId) {
          await sendTelegram(ch.telegramBotToken, ch.telegramChatId, message)
        } else if (ch.type === "webhook" && ch.webhookUrl) {
          await sendWebhook(ch.webhookUrl, payload)
        }
        sent++
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    })
  )

  return { sent, errors }
}
