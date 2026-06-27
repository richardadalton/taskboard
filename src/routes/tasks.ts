import { Router } from 'express'
import { db } from '../db.js'
import { broadcast } from '../sse.js'
import { requireAuth } from '../middleware/require-auth.js'
import type { Task } from '../types.js'
import nunjucks from 'nunjucks'

const router = Router()

router.use(requireAuth)

const VALID_STATUSES = ['todo', 'in_progress', 'done'] as const
const VALID_PRIORITIES = ['low', 'normal', 'high'] as const

function parsePriority(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  return (VALID_PRIORITIES as readonly string[]).includes(v) ? v : null
}

function parseDueDate(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? v : null
}

function getTask(id: number): Task | undefined {
  return db
    .prepare<number, Task>(
      `SELECT *,
        CASE WHEN due_date IS NOT NULL AND due_date < date('now') AND status != 'done'
             THEN 1 ELSE 0 END AS is_overdue
       FROM tasks WHERE id = ?`
    )
    .get(id)
}

function membershipRole(boardId: number, userId: number): string | null {
  const row = db
    .prepare<[number, number], { role: string }>(
      'SELECT role FROM board_members WHERE board_id = ? AND user_id = ?'
    )
    .get(boardId, userId)
  return row?.role ?? null
}

function renderTask(task: Task, userId: number, userRole: string): string {
  return nunjucks.render('partials/task-item.njk', {
    task,
    currentUserId: userId,
    userRole,
  })
}

// Re-render two column lists and return them as OOB innerHTML swaps.
// Used for SSE broadcasts when a card moves between columns.
function columnBroadcast(
  boardId: number,
  oldStatus: string,
  newStatus: string,
  userId: number,
  userRole: string
): string {
  function renderColumn(status: string): string {
    const tasks = db
      .prepare<[number, string], Task>(
        `SELECT *,
          CASE WHEN due_date IS NOT NULL AND due_date < date('now') AND status != 'done'
               THEN 1 ELSE 0 END AS is_overdue
         FROM tasks WHERE board_id = ? AND status = ? ORDER BY position ASC`
      )
      .all(boardId, status)

    const items = tasks
      .map(t => nunjucks.render('partials/task-item.njk', { task: t, currentUserId: userId, userRole }))
      .join('')

    return `<ul id="column-${status}-list" hx-swap-oob="innerHTML" class="column-list" data-status="${status}">${items}</ul>`
  }

  return renderColumn(oldStatus) + renderColumn(newStatus)
}

// Clear the new-task slot without a page reload
router.get('/tasks/new-cancel', (_req, res) => {
  res.send('')
})

// New task form fragment
router.get('/tasks/new', (req, res) => {
  const boardId = Number(req.query.boardId)
  if (!membershipRole(boardId, req.user!.id)) return res.status(403).send('Forbidden')
  res.send(nunjucks.render('partials/task-form.njk', { boardId, task: null }))
})

// Create task — always starts in the todo column
router.post('/tasks', (req, res) => {
  const boardId = Number(req.body.board_id)
  const role = membershipRole(boardId, req.user!.id)
  if (!role) return res.status(403).send('Forbidden')

  const title = (req.body.title as string)?.trim()
  if (!title) return res.status(422).send('Title is required')

  const priority = parsePriority(req.body.priority) ?? 'normal'
  const due_date = parseDueDate(req.body.due_date)
  if (req.body.due_date && !due_date) return res.status(422).send('Invalid due date')

  const result = db
    .prepare(
      `INSERT INTO tasks (board_id, title, notes, due_date, priority, status, created_by, position)
       VALUES (@board_id, @title, @notes, @due_date, @priority, 'todo', @created_by,
               COALESCE((SELECT MIN(position) - 1 FROM tasks WHERE board_id = @board_id AND status = 'todo'), 0))`
    )
    .run({
      board_id: boardId,
      title,
      notes: (req.body.notes as string)?.trim() || null,
      due_date,
      priority,
      created_by: req.user!.id,
    })

  const task = getTask(Number(result.lastInsertRowid))!
  const html = renderTask(task, req.user!.id, role)

  broadcast(
    boardId,
    `<li id="task-${task.id}" hx-swap-oob="afterbegin:#column-todo-list" data-task-id="${task.id}">${html.replace(/^<li[^>]*>|<\/li>$/g, '')}</li>`
  )

  res.send(html)
})

// Task item fragment (cancel on edit form)
router.get('/tasks/:id', (req, res) => {
  const task = getTask(Number(req.params.id))
  if (!task) return res.status(404).send('Not found')

  const role = membershipRole(task.board_id, req.user!.id)
  if (!role) return res.status(403).send('Forbidden')

  res.send(renderTask(task, req.user!.id, role))
})

// Edit form fragment
router.get('/tasks/:id/edit', (req, res) => {
  const task = getTask(Number(req.params.id))
  if (!task) return res.status(404).send('Not found')

  const role = membershipRole(task.board_id, req.user!.id)
  if (!role) return res.status(403).send('Forbidden')

  res.send(nunjucks.render('partials/task-form.njk', { boardId: task.board_id, task }))
})

// Update task fields
router.put('/tasks/:id', (req, res) => {
  const task = getTask(Number(req.params.id))
  if (!task) return res.status(404).send('Not found')

  const role = membershipRole(task.board_id, req.user!.id)
  if (!role) return res.status(403).send('Forbidden')

  const title = (req.body.title as string)?.trim()
  if (!title) return res.status(422).send('Title is required')

  const priority = parsePriority(req.body.priority) ?? 'normal'
  const due_date = parseDueDate(req.body.due_date)
  if (req.body.due_date && !due_date) return res.status(422).send('Invalid due date')

  db.prepare(
    `UPDATE tasks SET title = @title, notes = @notes, due_date = @due_date, priority = @priority
     WHERE id = @id`
  ).run({
    id: task.id,
    title,
    notes: (req.body.notes as string)?.trim() || null,
    due_date,
    priority,
  })

  const updated = getTask(task.id)!
  const html = renderTask(updated, req.user!.id, role)
  broadcast(task.board_id, `${html.replace(/<li /, '<li hx-swap-oob="true" ')}`)
  res.send(html)
})

// Move task to a different column and/or reorder within the column.
// Called by SortableJS on drag-end; the client passes the new status and the
// ordered IDs of every card now in the destination column.
router.patch('/tasks/:id/move', (req, res) => {
  const task = getTask(Number(req.params.id))
  if (!task) return res.status(404).send('Not found')

  const role = membershipRole(task.board_id, req.user!.id)
  if (!role) return res.status(403).send('Forbidden')

  const newStatus = req.body.status as string
  if (!(VALID_STATUSES as readonly string[]).includes(newStatus)) {
    return res.status(422).send('Invalid status')
  }

  const ids = (req.body.ids as string || '')
    .split(',')
    .map(Number)
    .filter(Boolean)

  db.transaction(() => {
    // Persist ordering for every card now in the destination column
    const updatePos = db.prepare('UPDATE tasks SET position = ? WHERE id = ? AND board_id = ?')
    ids.forEach((id, i) => updatePos.run(i, id, task.board_id))

    // Update status and keep completed_at in sync
    if (newStatus === 'done') {
      db.prepare(
        `UPDATE tasks SET status = ?,
          completed_at = COALESCE(completed_at, datetime('now'))
         WHERE id = ?`
      ).run(newStatus, task.id)
    } else {
      db.prepare('UPDATE tasks SET status = ?, completed_at = NULL WHERE id = ?')
        .run(newStatus, task.id)
    }
  })()

  // Broadcast column moves: re-render both affected columns in full and push
  // via OOB innerHTML swap. This avoids the delete+insert race that caused
  // cards to vanish for the client who initiated the drag.
  if (task.status !== newStatus) {
    broadcast(task.board_id, columnBroadcast(task.board_id, task.status, newStatus, req.user!.id, role))
  }

  res.send('')
})

// Confirm-delete fragment — inline confirmation without a JS dialog
router.get('/tasks/:id/confirm-delete', (req, res) => {
  const task = getTask(Number(req.params.id))
  if (!task) return res.status(404).send('Not found')
  if (!membershipRole(task.board_id, req.user!.id)) return res.status(403).send('Forbidden')

  res.send(nunjucks.render('partials/task-confirm-delete.njk', { task }))
})

// Delete task
router.delete('/tasks/:id', (req, res) => {
  const task = getTask(Number(req.params.id))
  if (!task) return res.status(404).send('Not found')

  const role = membershipRole(task.board_id, req.user!.id)
  if (!role) return res.status(403).send('Forbidden')

  if (task.created_by !== req.user!.id && role !== 'owner') {
    return res.status(403).send('Forbidden')
  }

  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id)

  broadcast(task.board_id, `<li id="task-${task.id}" hx-swap-oob="delete"></li>`)
  res.send('')
})

export default router
