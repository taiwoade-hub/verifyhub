// VerifyHub — socket.io mini service.
//  - Port 3003: socket.io server (browser-facing through the Caddy gateway,
//    clients connect with io("/?XTransformPort=3003"), socket.io path "/").
//  - Port 3004: internal HTTP API used by Next.js API routes to publish
//    events (server-to-server, never browser-facing).

import { Server } from 'socket.io'
import { createServer } from 'http'

const WS_PORT = 3003
const PUB_PORT = 3004

const pubServer = createServer((req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.url === '/health') {
    send(200, { ok: true, service: 'verifyhub-ws', ts: Date.now() })
    return
  }
  if (req.url === '/publish' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        const { room, event, data } = JSON.parse(body)
        if (!room || !event) throw new Error('room and event are required')
        io.to(room).emit(event, data)
        send(200, { ok: true, room, event })
      } catch (err) {
        send(400, { ok: false, error: String(err) })
      }
    })
    return
  }
  send(404, { ok: false, error: 'not found' })
})

pubServer.listen(PUB_PORT, '127.0.0.1', () => {
  console.log(`[verifyhub-ws] publish API listening on 127.0.0.1:${PUB_PORT}`)
})

const io = new Server(WS_PORT, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  path: '/',
  transports: ['websocket', 'polling'],
})

io.on('connection', (socket) => {
  socket.emit('hello', { service: 'verifyhub-ws', ts: Date.now() })
  socket.on('join:run', (runId: string) => {
    if (typeof runId !== 'string' || runId.length > 64) return
    void socket.join(`run:${runId}`)
    socket.emit('joined', { room: `run:${runId}` })
  })
  socket.on('join:global', () => {
    void socket.join('global')
    socket.emit('joined', { room: 'global' })
  })
  socket.on('leave:run', (runId: string) => {
    if (typeof runId !== 'string') return
    void socket.leave(`run:${runId}`)
  })
})

console.log(`[verifyhub-ws] socket.io listening on :${WS_PORT}`)
