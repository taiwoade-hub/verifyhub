// VerifyHub — event bus. Forwards run events from API-route processes to the
// socket.io mini service (port 3003), which fans them out to browsers via
// rooms (run:{id} and the global feed).

const WS_PUBLISH_URL = process.env.WS_PUBLISH_URL || 'http://127.0.0.1:3004'

export interface BroadcastPayload {
  room: string // e.g. "run:clrxyz123" or "global"
  event: string
  data: unknown
}

export async function broadcast(room: string, event: string, data: unknown): Promise<void> {
  try {
    await fetch(`${WS_PUBLISH_URL}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room, event, data } satisfies BroadcastPayload),
      signal: AbortSignal.timeout(2500),
    })
  } catch {
    // Socket service may not be up during boot; events are persisted to the
    // database anyway, so clients catch up via polling.
  }
}

export async function broadcastRun(runId: string, event: string, data: unknown): Promise<void> {
  await Promise.all([broadcast(`run:${runId}`, event, data), broadcast('global', event, { ...((data as object) || {}), runId })])
}
