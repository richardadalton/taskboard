import session from 'express-session'
import type { Database } from 'better-sqlite3'

export function createSessionStore(db: Database): session.Store {
  const Store = class extends session.Store {
    get(sid: string, cb: (err: unknown, session?: session.SessionData | null) => void): void {
      try {
        const row = db
          .prepare<[string, number], { sess: string }>(
            'SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?'
          )
          .get(sid, Date.now())
        cb(null, row ? (JSON.parse(row.sess) as session.SessionData) : null)
      } catch (err) {
        cb(err)
      }
    }

    set(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): void {
      try {
        const maxAge = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000
        db.prepare(
          'INSERT OR REPLACE INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)'
        ).run(sid, JSON.stringify(sess), Date.now() + maxAge)
        cb?.()
      } catch (err) {
        cb?.(err)
      }
    }

    destroy(sid: string, cb?: (err?: unknown) => void): void {
      try {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
        cb?.()
      } catch (err) {
        cb?.(err)
      }
    }

    touch(sid: string, sess: session.SessionData, cb?: () => void): void {
      this.set(sid, sess, cb)
    }
  }

  return new Store()
}
