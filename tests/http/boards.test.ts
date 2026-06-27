import { beforeAll, describe, it, expect } from 'vitest'
import * as cheerio from 'cheerio'
import { seedUser, seedBoard, seedMember, agentFor, type Agent } from './helpers.js'

let app: any
let db: any
let ownerAgent: Agent
let collaboratorAgent: Agent
let ownerId: number
let collaboratorId: number
let boardId: number

beforeAll(async () => {
  const [appMod, dbMod] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/db.js'),
  ])
  app = appMod.createApp()
  db = dbMod.db

  const owner = seedUser(db, 'owner')
  const collaborator = seedUser(db, 'collaborator')
  ownerId = owner.id
  collaboratorId = collaborator.id

  boardId = seedBoard(db, 'Shared Board', ownerId)
  seedMember(db, boardId, collaboratorId)

  ownerAgent = await agentFor(app, ownerId)
  collaboratorAgent = await agentFor(app, collaboratorId)
})

// ── Home page ─────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('shows the boards the user is a member of', async () => {
    const res = await ownerAgent.get('/').expect(200)
    expect(res.text).toContain('Shared Board')
  })

  it('shows the Shared badge for collaborators', async () => {
    const res = await collaboratorAgent.get('/').expect(200)
    const $ = cheerio.load(res.text)
    expect($('.board-card-badge').text().trim()).toBe('Shared')
  })
})

// ── Board creation ────────────────────────────────────────────────────────────

describe('POST /boards', () => {
  it('htmx request returns a board-item fragment', async () => {
    const res = await ownerAgent
      .post('/boards')
      .type('form')
      .send({ name: 'New Board' })
      .set('HX-Request', 'true')
      .expect(200)

    const $ = cheerio.load(res.text)
    expect($('.board-card').length).toBe(1)
    expect($('.board-card-name').text().trim()).toBe('New Board')
  })
})

// ── Role-based affordances ────────────────────────────────────────────────────
//
// The server decides which controls to render based on the requesting user's role.
// Both owner and collaborator hit the same route — what comes back differs.

describe('GET /boards/:id role-based affordances', () => {
  it('owner sees rename and delete controls', async () => {
    const res = await ownerAgent.get(`/boards/${boardId}`).expect(200)
    const $ = cheerio.load(res.text)
    expect($('[hx-get$="/edit"]').length).toBeGreaterThan(0)
    expect($('[hx-get$="/confirm-delete"]').length).toBeGreaterThan(0)
    expect($('button:contains("Leave board")').length).toBe(0)
  })

  it('collaborator sees leave control, not rename or delete', async () => {
    const res = await collaboratorAgent.get(`/boards/${boardId}`).expect(200)
    const $ = cheerio.load(res.text)
    expect($('[hx-post$="/leave"]').length).toBe(1)
    expect($('[hx-get$="/edit"]').length).toBe(0)
    expect($('[hx-get$="/confirm-delete"]').length).toBe(0)
  })
})

// ── Rename ────────────────────────────────────────────────────────────────────

describe('board rename', () => {
  it('GET /boards/:id/edit → pre-filled rename form', async () => {
    const res = await ownerAgent.get(`/boards/${boardId}/edit`).expect(200)
    const $ = cheerio.load(res.text)
    expect($(`[hx-patch="/boards/${boardId}"]`).length).toBe(1)
    expect($('input[name="name"]').val()).toBe('Shared Board')
  })

  it('PATCH /boards/:id → updated header fragment with new name', async () => {
    const res = await ownerAgent
      .patch(`/boards/${boardId}`)
      .type('form')
      .send({ name: 'Renamed Board' })
      .set('HX-Request', 'true')
      .expect(200)

    const $ = cheerio.load(res.text)
    expect($('.board-name').text().trim()).toBe('Renamed Board')
  })
})

// ── Deletion ──────────────────────────────────────────────────────────────────

describe('board deletion', () => {
  let tempBoardId: number

  beforeAll(() => {
    tempBoardId = seedBoard(db, 'Temp Board', ownerId)
  })

  it('GET /confirm-delete → confirm fragment', async () => {
    const res = await ownerAgent.get(`/boards/${tempBoardId}/confirm-delete`).expect(200)
    const $ = cheerio.load(res.text)
    expect($(`[hx-delete="/boards/${tempBoardId}"]`).length).toBe(1)
  })

  it('DELETE without confirm_name → 422', async () => {
    await ownerAgent
      .delete(`/boards/${tempBoardId}?confirm_name=Wrong+Name`)
      .set('HX-Request', 'true')
      .expect(422)
  })

  it('DELETE with correct confirm_name → empty body with HX-Redirect to home', async () => {
    const res = await ownerAgent
      .delete(`/boards/${tempBoardId}?confirm_name=Temp+Board`)
      .set('HX-Request', 'true')
      .expect(200)

    expect(res.text).toBe('')
    expect(res.headers['hx-redirect']).toBe('/')
    expect(db.prepare('SELECT id FROM boards WHERE id = ?').get(tempBoardId)).toBeUndefined()
  })
})
