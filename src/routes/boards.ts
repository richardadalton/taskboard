import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth } from '../middleware/require-auth.js'
import type { Board, Task, BoardMember } from '../types.js'
import nunjucks from 'nunjucks'

const router = Router()

router.use(requireAuth)

// Home — all boards for the current user
router.get('/', (req, res) => {
  const boards = db
    .prepare<number, Board & { role: string; task_count: number }>(
      `SELECT b.*, bm.role,
        (SELECT COUNT(*) FROM tasks t WHERE t.board_id = b.id AND t.status != 'done') AS task_count
       FROM boards b
       JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = ?
       ORDER BY b.created_at DESC`
    )
    .all(req.user!.id)

  res.render('home.njk', { boards, user: req.user })
})

// New board form fragment — must come before /boards/:id
router.get('/boards/new', (_req, res) => {
  res.send(nunjucks.render('partials/new-board-form.njk', {}))
})

// Full board page
router.get('/boards/:id', (req, res) => {
  const boardId = Number(req.params.id)
  const userId = req.user!.id

  const membership = db
    .prepare<[number, number], { role: string }>(
      'SELECT role FROM board_members WHERE board_id = ? AND user_id = ?'
    )
    .get(boardId, userId)

  if (!membership) return res.status(404).render('404.njk')

  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board) return res.status(404).render('404.njk')

  const allTasks = db
    .prepare<number, Task>(
      `SELECT *,
        CASE WHEN due_date IS NOT NULL AND due_date < date('now') AND status != 'done'
             THEN 1 ELSE 0 END AS is_overdue
       FROM tasks WHERE board_id = ?
       ORDER BY position ASC, created_at DESC`
    )
    .all(boardId)

  const todoTasks = allTasks.filter(t => t.status === 'todo')
  const inProgressTasks = allTasks.filter(t => t.status === 'in_progress')
  const doneTasks = allTasks.filter(t => t.status === 'done')

  const members = db
    .prepare<number, BoardMember>(
      `SELECT bm.*, u.username, u.avatar_url
       FROM board_members bm
       JOIN users u ON u.id = bm.user_id
       WHERE bm.board_id = ?
       ORDER BY bm.role DESC, u.username ASC`
    )
    .all(boardId)

  res.render('board.njk', {
    board,
    todoTasks,
    inProgressTasks,
    doneTasks,
    members,
    userRole: membership.role,
    user: req.user,
  })
})

// Create board
router.post('/boards', (req, res) => {
  const name = (req.body.name as string)?.trim()
  if (!name) return res.status(422).send('Name is required')

  const result = db.prepare('INSERT INTO boards (name, owner_id) VALUES (?, ?)').run(name, req.user!.id)
  const boardId = Number(result.lastInsertRowid)
  db.prepare('INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, ?)').run(boardId, req.user!.id, 'owner')

  if (req.headers['hx-request']) {
    const board = db
      .prepare<[number, number], Board & { role: string; task_count: number }>(
        `SELECT b.*, bm.role, 0 AS task_count
         FROM boards b JOIN board_members bm ON bm.board_id = b.id
         WHERE b.id = ? AND bm.user_id = ?`
      )
      .get(boardId, req.user!.id)!

    return res.send(nunjucks.render('partials/board-item.njk', { board }))
  }

  res.redirect('/')
})

// Board header fragment — used by cancel buttons in rename/confirm-delete flows
router.get('/boards/:id/header', (req, res) => {
  const boardId = Number(req.params.id)
  const membership = db
    .prepare<[number, number], { role: string }>(
      'SELECT role FROM board_members WHERE board_id = ? AND user_id = ?'
    )
    .get(boardId, req.user!.id)
  if (!membership) return res.status(403).send('Forbidden')
  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board) return res.status(404).send('Not found')
  res.send(nunjucks.render('partials/board-header.njk', { board, userRole: membership.role, user: req.user }))
})

// Rename form fragment
router.get('/boards/:id/edit', (req, res) => {
  const boardId = Number(req.params.id)
  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board || board.owner_id !== req.user!.id) return res.status(403).send('Forbidden')
  res.send(nunjucks.render('partials/board-rename-form.njk', { board }))
})

// Delete confirmation fragment
router.get('/boards/:id/confirm-delete', (req, res) => {
  const boardId = Number(req.params.id)
  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board || board.owner_id !== req.user!.id) return res.status(403).send('Forbidden')
  res.send(nunjucks.render('partials/board-confirm-delete.njk', { board }))
})

// Rename board — owner only
router.patch('/boards/:id', (req, res) => {
  const boardId = Number(req.params.id)
  const name = (req.body.name as string)?.trim()
  if (!name) return res.status(422).send('Name is required')

  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board || board.owner_id !== req.user!.id) return res.status(403).send('Forbidden')

  db.prepare('UPDATE boards SET name = ? WHERE id = ?').run(name, boardId)
  const updated = { ...board, name }

  res.send(
    nunjucks.render('partials/board-header.njk', {
      board: updated,
      userRole: 'owner',
      user: req.user,
    })
  )
})

// Delete board — owner only
router.delete('/boards/:id', (req, res) => {
  const boardId = Number(req.params.id)
  const board = db.prepare<number, Board>('SELECT * FROM boards WHERE id = ?').get(boardId)
  if (!board || board.owner_id !== req.user!.id) return res.status(403).send('Forbidden')

  const confirmName = (req.query.confirm_name as string)?.trim()
  if (confirmName !== board.name) return res.status(422).send('Board name does not match')

  db.prepare('DELETE FROM boards WHERE id = ?').run(boardId)
  res.setHeader('HX-Redirect', '/')
  res.send('')
})

// Search tasks within a board
router.get('/boards/:id/search', (req, res) => {
  const boardId = Number(req.params.id)
  const q = `%${req.query.q ?? ''}%`

  const membership = db
    .prepare<[number, number], { role: string }>(
      'SELECT role FROM board_members WHERE board_id = ? AND user_id = ?'
    )
    .get(boardId, req.user!.id)

  if (!membership) return res.status(403).send('Forbidden')

  const allTasks = db
    .prepare<[number, string, string], Task>(
      `SELECT *,
        CASE WHEN due_date IS NOT NULL AND due_date < date('now') AND status != 'done'
             THEN 1 ELSE 0 END AS is_overdue
       FROM tasks
       WHERE board_id = ? AND (title LIKE ? OR notes LIKE ?)
       ORDER BY position ASC, created_at DESC`
    )
    .all(boardId, q, q)

  res.send(
    nunjucks.render('partials/kanban-board.njk', {
      todoTasks: allTasks.filter(t => t.status === 'todo'),
      inProgressTasks: allTasks.filter(t => t.status === 'in_progress'),
      doneTasks: allTasks.filter(t => t.status === 'done'),
      boardId,
      userRole: membership.role,
      user: req.user,
    })
  )
})

export default router
