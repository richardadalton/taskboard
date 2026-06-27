import { Router } from 'express'
import { db } from '../db.js'
import { addClient } from '../sse.js'
import { requireAuth } from '../middleware/require-auth.js'

const router = Router()

router.use(requireAuth)

router.get('/sse', (req, res) => {
  const boardId = Number(req.query.boardId)
  if (!boardId) return res.status(400).send('boardId required')

  const membership = db
    .prepare<[number, number], { role: string }>(
      'SELECT role FROM board_members WHERE board_id = ? AND user_id = ?'
    )
    .get(boardId, req.user!.id)

  if (!membership) return res.status(403).send('Forbidden')

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Heartbeat every 30s to survive proxies that close idle connections
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000)

  const remove = addClient(res, boardId)
  req.on('close', () => {
    clearInterval(heartbeat)
    remove()
  })
})

export default router
