import { beforeAll, describe, it, expect } from 'vitest'
import supertest from 'supertest'
import { seedUser, seedBoard, seedMember, seedTask, agentFor, type Agent } from './helpers.js'

let app: any
let db: any

let ownerAgent: Agent
let collaboratorAgent: Agent
let outsiderAgent: Agent

let ownerId: number
let collaboratorId: number
let outsiderId: number
let listId: number
let ownerTaskId: number
let collaboratorTaskId: number

beforeAll(async () => {
  const [appMod, dbMod] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/db.js'),
  ])
  app = appMod.createApp()
  db = dbMod.db

  const owner = seedUser(db, 'owner')
  const collaborator = seedUser(db, 'collaborator')
  const outsider = seedUser(db, 'outsider')
  ownerId = owner.id
  collaboratorId = collaborator.id
  outsiderId = outsider.id

  listId = seedBoard(db, 'Private Board', ownerId)
  seedMember(db, listId, collaboratorId)

  ownerTaskId = seedTask(db, listId, ownerId, 'Owners task')
  collaboratorTaskId = seedTask(db, listId, collaboratorId, 'Collaborators task')

  ownerAgent = await agentFor(app, ownerId)
  collaboratorAgent = await agentFor(app, collaboratorId)
  outsiderAgent = await agentFor(app, outsiderId)
})

// ── Authentication ────────────────────────────────────────────────────────────

describe('unauthenticated requests', () => {
  it('GET / redirects to /login', async () => {
    const res = await supertest(app).get('/').expect(302)
    expect(res.headers.location).toBe('/login')
  })

  it('GET /boards/:id redirects to /login', async () => {
    const res = await supertest(app).get(`/boards/${listId}`).expect(302)
    expect(res.headers.location).toBe('/login')
  })
})

// ── List access ───────────────────────────────────────────────────────────────

describe('list access control', () => {
  it('member (owner) can access the list', async () => {
    await ownerAgent.get(`/boards/${listId}`).expect(200)
  })

  it('member (collaborator) can access the list', async () => {
    await collaboratorAgent.get(`/boards/${listId}`).expect(200)
  })

  it('non-member gets 404', async () => {
    await outsiderAgent.get(`/boards/${listId}`).expect(404)
  })
})

// ── Task access ───────────────────────────────────────────────────────────────

describe('task access control', () => {
  it('non-member cannot create a task', async () => {
    await outsiderAgent
      .post('/tasks')
      .type('form')
      .send({ board_id: listId, title: 'Sneaky task' })
      .expect(403)
  })

  it('non-member cannot move a task', async () => {
    await outsiderAgent
      .patch(`/tasks/${ownerTaskId}/move`)
      .type('form')
      .send({ status: 'in_progress', ids: String(ownerTaskId) })
      .expect(403)
  })

  it('collaborator can move any task in the list', async () => {
    await collaboratorAgent
      .patch(`/tasks/${ownerTaskId}/move`)
      .type('form')
      .send({ status: 'in_progress', ids: String(ownerTaskId) })
      .expect(200)
  })

  it("collaborator cannot delete another member's task", async () => {
    await collaboratorAgent.delete(`/tasks/${ownerTaskId}`).expect(403)
  })

  it('collaborator can delete their own task', async () => {
    await collaboratorAgent.delete(`/tasks/${collaboratorTaskId}`).expect(200)
  })

  it('owner can delete any task', async () => {
    const taskId = seedTask(db, listId, collaboratorId, 'Another task')
    await ownerAgent.delete(`/tasks/${taskId}`).expect(200)
  })
})

// ── List management ───────────────────────────────────────────────────────────

describe('list management access control', () => {
  it('collaborator cannot rename the list', async () => {
    await collaboratorAgent
      .patch(`/boards/${listId}`)
      .type('form')
      .send({ name: 'Hijacked' })
      .expect(403)
  })

  it('collaborator cannot delete the list', async () => {
    await collaboratorAgent.delete(`/boards/${listId}`).expect(403)
  })

  it('outsider cannot delete the list', async () => {
    await outsiderAgent.delete(`/boards/${listId}`).expect(403)
  })

  it('owner can rename the list', async () => {
    await ownerAgent
      .patch(`/boards/${listId}`)
      .type('form')
      .send({ name: 'Legitimately Renamed' })
      .expect(200)
  })
})
