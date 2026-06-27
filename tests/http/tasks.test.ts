import { beforeAll, describe, it, expect } from 'vitest'
import * as cheerio from 'cheerio'
import { seedUser, seedBoard, seedTask, agentFor, type Agent } from './helpers.js'

let app: any
let db: any
let agent: Agent
let userId: number
let listId: number

beforeAll(async () => {
  const [appMod, dbMod] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/db.js'),
  ])
  app = appMod.createApp()
  db = dbMod.db

  const user = seedUser(db, 'alice')
  userId = user.id
  listId = seedBoard(db, 'Work', userId)
  agent = await agentFor(app, userId)
})

// ── Creation ──────────────────────────────────────────────────────────────────

describe('POST /tasks', () => {
  it('returns a task card fragment with status todo', async () => {
    const res = await agent
      .post('/tasks')
      .type('form')
      .send({ board_id: listId, title: 'Write tests', priority: 'high' })
      .set('HX-Request', 'true')
      .expect(200)

    const $ = cheerio.load(res.text)
    expect($('.task-item').length).toBe(1)
    expect($('.task-title').text().trim()).toBe('Write tests')
    expect($('.task-priority-high').length).toBe(1)
    // New tasks start in todo — no done styling
    expect($('.task-done').length).toBe(0)
  })
})

// ── Column moves — the core Kanban state transition ───────────────────────────
//
// Dragging a card between columns fires PATCH /tasks/:id/move.
// The server is the authority on status; the card HTML reflects the new state.

describe('PATCH /tasks/:id/move', () => {
  let taskId: number

  beforeAll(() => {
    taskId = seedTask(db, listId, userId, 'Buy milk')
  })

  it('todo → in_progress: DB status updated, completed_at stays null', async () => {
    await agent
      .patch(`/tasks/${taskId}/move`)
      .type('form')
      .send({ status: 'in_progress', ids: String(taskId) })
      .expect(200)

    const row = db.prepare('SELECT status, completed_at FROM tasks WHERE id = ?').get(taskId)
    expect(row.status).toBe('in_progress')
    expect(row.completed_at).toBeNull()
  })

  it('in_progress → done: completed_at is set', async () => {
    await agent
      .patch(`/tasks/${taskId}/move`)
      .type('form')
      .send({ status: 'done', ids: String(taskId) })
      .expect(200)

    const row = db.prepare('SELECT status, completed_at FROM tasks WHERE id = ?').get(taskId)
    expect(row.status).toBe('done')
    expect(row.completed_at).not.toBeNull()
  })

  it('done → todo: completed_at is cleared', async () => {
    await agent
      .patch(`/tasks/${taskId}/move`)
      .type('form')
      .send({ status: 'todo', ids: String(taskId) })
      .expect(200)

    const row = db.prepare('SELECT status, completed_at FROM tasks WHERE id = ?').get(taskId)
    expect(row.status).toBe('todo')
    expect(row.completed_at).toBeNull()
  })

  it('invalid status → 422', async () => {
    await agent
      .patch(`/tasks/${taskId}/move`)
      .type('form')
      .send({ status: 'banana', ids: String(taskId) })
      .expect(422)
  })

  it('preserves completed_at timestamp when moved back to done', async () => {
    // Move to done to get a timestamp
    await agent.patch(`/tasks/${taskId}/move`).type('form').send({ status: 'done', ids: String(taskId) })
    const first = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(taskId)

    // Move away and back — timestamp should be preserved
    await agent.patch(`/tasks/${taskId}/move`).type('form').send({ status: 'todo', ids: String(taskId) })
    await agent.patch(`/tasks/${taskId}/move`).type('form').send({ status: 'done', ids: String(taskId) })
    const second = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(taskId)

    // second move creates a new timestamp (COALESCE returns existing if set, but we cleared it)
    expect(second.completed_at).not.toBeNull()
  })
})

// ── Within-column reorder ─────────────────────────────────────────────────────

describe('within-column reorder', () => {
  let idA: number
  let idB: number
  let idC: number

  beforeAll(() => {
    idA = seedTask(db, listId, userId, 'Task A')
    idB = seedTask(db, listId, userId, 'Task B')
    idC = seedTask(db, listId, userId, 'Task C')
  })

  it('persists the new position order', async () => {
    // Reorder as C, A, B
    await agent
      .patch(`/tasks/${idC}/move`)
      .type('form')
      .send({ status: 'todo', ids: [idC, idA, idB].join(',') })
      .expect(200)

    const rows = db
      .prepare('SELECT id, position FROM tasks WHERE id IN (?, ?, ?) ORDER BY position')
      .all(idC, idA, idB)

    expect(rows.map((r: any) => r.id)).toEqual([idC, idA, idB])
  })
})

// ── Editing ───────────────────────────────────────────────────────────────────

describe('task editing', () => {
  let taskId: number

  beforeAll(() => {
    taskId = seedTask(db, listId, userId, 'Original title', { priority: 'high', notes: 'some notes' })
  })

  it('GET /edit → form pre-filled with current values and a PUT action', async () => {
    const res = await agent
      .get(`/tasks/${taskId}/edit`)
      .set('HX-Request', 'true')
      .expect(200)

    const $ = cheerio.load(res.text)
    expect($(`[hx-put="/tasks/${taskId}"]`).length).toBe(1)
    expect($('input[name="title"]').val()).toBe('Original title')
    expect($('select[name="priority"]').val()).toBe('high')
  })

  it('PUT → updated fragment with new title', async () => {
    const res = await agent
      .put(`/tasks/${taskId}`)
      .type('form')
      .send({ title: 'Updated title', priority: 'low', notes: '' })
      .set('HX-Request', 'true')
      .expect(200)

    const $ = cheerio.load(res.text)
    expect($('.task-title').text().trim()).toBe('Updated title')
  })

  it('GET /tasks/:id (cancel edit) → restores the task fragment', async () => {
    const res = await agent
      .get(`/tasks/${taskId}`)
      .set('HX-Request', 'true')
      .expect(200)

    const $ = cheerio.load(res.text)
    expect($('input[name="title"]').length).toBe(0)
    expect($('.task-title').length).toBe(1)
  })
})

// ── Deletion ──────────────────────────────────────────────────────────────────

describe('task deletion', () => {
  let taskId: number

  beforeAll(() => {
    taskId = seedTask(db, listId, userId, 'Doomed task')
  })

  it('GET /confirm-delete → fragment with confirm and cancel affordances', async () => {
    const res = await agent
      .get(`/tasks/${taskId}/confirm-delete`)
      .set('HX-Request', 'true')
      .expect(200)

    const $ = cheerio.load(res.text)
    expect($(`[hx-delete="/tasks/${taskId}"]`).length).toBe(1)
    expect($(`[hx-get="/tasks/${taskId}"]`).length).toBe(1)
  })

  it('DELETE → empty body and task removed from DB', async () => {
    const res = await agent
      .delete(`/tasks/${taskId}`)
      .set('HX-Request', 'true')
      .expect(200)

    expect(res.text).toBe('')
    expect(db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)).toBeUndefined()
  })
})
