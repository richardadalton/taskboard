import supertest from 'supertest'
import type { Express } from 'express'

export type Agent = ReturnType<typeof supertest.agent>

export function seedUser(db: any, username: string) {
  const r = db
    .prepare('INSERT INTO users (oauth_id, username, email, avatar_url) VALUES (?, ?, ?, ?)')
    .run(`oauth-${username}`, username, `${username}@test.com`, null)
  return { id: Number(r.lastInsertRowid), username }
}

export function seedBoard(db: any, name: string, ownerId: number): number {
  const r = db.prepare('INSERT INTO boards (name, owner_id) VALUES (?, ?)').run(name, ownerId)
  const boardId = Number(r.lastInsertRowid)
  db.prepare('INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, ?)').run(
    boardId, ownerId, 'owner'
  )
  return boardId
}

export function seedMember(db: any, boardId: number, userId: number): void {
  db.prepare('INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, ?)').run(
    boardId, userId, 'collaborator'
  )
}

export function seedTask(
  db: any,
  boardId: number,
  createdBy: number,
  title: string,
  overrides: Record<string, unknown> = {}
): number {
  const r = db
    .prepare(
      `INSERT INTO tasks (board_id, title, priority, created_by, position)
       VALUES (@board_id, @title, @priority, @created_by, 0)`
    )
    .run({ board_id: boardId, title, priority: 'normal', created_by: createdBy, ...overrides })
  return Number(r.lastInsertRowid)
}

export async function agentFor(app: Express, userId: number): Promise<Agent> {
  const agent = supertest.agent(app)
  await agent.post('/_test/login').send({ userId }).expect(200)
  return agent
}
