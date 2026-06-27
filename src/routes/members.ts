import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { Resend } from 'resend'
import rateLimit from 'express-rate-limit'
import { db } from '../db.js'
import { disconnectUser } from '../sse.js'
import { requireAuth } from '../middleware/require-auth.js'
import type { Board, Invitation, BoardMember } from '../types.js'
import nunjucks from 'nunjucks'

const router = Router()

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

// Accept invitation — show confirmation page (public: no auth required)
router.get('/invitations/:token', (req, res) => {
  const inv = db
    .prepare<string, Invitation & { board_name: string }>(
      `SELECT i.*, b.name AS board_name
       FROM invitations i JOIN boards b ON b.id = i.board_id
       WHERE i.token = ? AND i.accepted_at IS NULL AND i.expires_at > datetime('now')`
    )
    .get(req.params.token)

  if (!inv) return res.status(404).render('invite-invalid.njk')

  if (!req.isAuthenticated()) {
    req.session.returnTo = req.originalUrl
    return res.render('accept-invite.njk', { inv, user: null })
  }

  const alreadyMember = db
    .prepare<[number, number], { count: number }>(
      'SELECT count(*) as count FROM board_members WHERE board_id = ? AND user_id = ?'
    )
    .get(inv.board_id, req.user!.id)

  res.render('accept-invite.njk', { inv, user: req.user, alreadyMember: (alreadyMember?.count ?? 0) > 0 })
})

router.use(requireAuth)

const inviteRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => String(req.user!.id),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'Too many invitations sent — please wait before trying again.',
})

// Invite form fragment — owner only
router.get('/boards/:id/invite', (req, res) => {
  const boardId = Number(req.params.id)
  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)

  if (!board || board.owner_id !== req.user!.id) return res.status(403).send('Forbidden')

  res.send(nunjucks.render('partials/invite-form.njk', { boardId }))
})

// Cancel invite form — restore the "Invite someone" button
router.get('/boards/:id/invite-cancel', (req, res) => {
  const boardId = Number(req.params.id)
  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board || board.owner_id !== req.user!.id) return res.status(403).send('Forbidden')
  res.send(`<button class="btn btn-secondary"
             hx-get="/boards/${boardId}/invite"
             hx-target="#invite-area"
             hx-swap="innerHTML">Invite someone</button>`)
})

// Send invitation
router.post('/boards/:id/invite', inviteRateLimit, async (req, res) => {
  const boardId = Number(req.params.id)
  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)

  if (!board || board.owner_id !== req.user!.id) return res.status(403).send('Forbidden')

  const email = (req.body.email as string)?.trim().toLowerCase()
  if (!email) return res.status(422).send('Email is required')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(422).send('Invalid email address')

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const token = uuidv4()

  db.prepare(
    `INSERT INTO invitations (board_id, email, token, invited_by, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(boardId, email, token, req.user!.id, expiresAt)

  const inviteUrl = `${process.env.APP_URL ?? 'http://localhost:3000'}/invitations/${token}`

  if (resend) {
    await resend.emails.send({
      from: process.env.INVITE_FROM_EMAIL ?? 'taskboard@example.com',
      to: email,
      subject: `${req.user!.username} invited you to "${board.name}"`,
      html: `
        <p>${req.user!.username} has invited you to collaborate on the board <strong>${board.name}</strong>.</p>
        <p><a href="${inviteUrl}">Accept invitation</a></p>
        <p>This link expires in 7 days.</p>
      `,
    })
  } else {
    console.log(`[dev] Invite link for ${email}: ${inviteUrl}`)
  }

  res.send(nunjucks.render('partials/invite-sent.njk', { email, inviteUrl }))
})

// Accept invitation — process
router.post('/invitations/:token', (req, res) => {
  const inv = db
    .prepare<string, Invitation>(
      `SELECT * FROM invitations
       WHERE token = ? AND accepted_at IS NULL AND expires_at > datetime('now')`
    )
    .get(req.params.token)

  if (!inv) return res.status(404).render('invite-invalid.njk')

  const userId = req.user!.id

  db.prepare(
    `INSERT OR IGNORE INTO board_members (board_id, user_id, role) VALUES (?, ?, 'collaborator')`
  ).run(inv.board_id, userId)

  db.prepare("UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?").run(inv.id)

  res.redirect(`/boards/${inv.board_id}`)
})

// Remove a member — owner only
router.delete('/boards/:id/members/:userId', (req, res) => {
  const boardId = Number(req.params.id)
  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)

  if (!board || board.owner_id !== req.user!.id) return res.status(403).send('Forbidden')

  const targetId = Number(req.params.userId)
  if (targetId === req.user!.id) return res.status(422).send("Can't remove yourself")

  db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(boardId, targetId)
  disconnectUser(boardId, targetId)

  const members = db
    .prepare<number, BoardMember>(
      `SELECT bm.*, u.username, u.avatar_url
       FROM board_members bm JOIN users u ON u.id = bm.user_id
       WHERE bm.board_id = ?
       ORDER BY bm.role DESC, u.username ASC`
    )
    .all(boardId)

  res.send(nunjucks.render('partials/member-list.njk', { members, boardId, user: req.user }))
})

// Leave a board — collaborator only
router.post('/boards/:id/leave', (req, res) => {
  const boardId = Number(req.params.id)
  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)

  if (!board) return res.status(404).send('Not found')
  if (board.owner_id === req.user!.id) return res.status(422).send("Owner can't leave — delete the board instead")

  db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(boardId, req.user!.id)

  res.redirect('/')
})

export default router
