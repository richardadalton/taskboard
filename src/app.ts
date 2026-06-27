import express from 'express'
import helmet from 'helmet'
import session from 'express-session'
import passport from 'passport'
import nunjucks from 'nunjucks'
import path from 'path'

import { db } from './db.js'
import { createSessionStore } from './session-store.js'
import { configurePassport } from './auth.js'

import authRoutes from './routes/auth.js'
import boardRoutes from './routes/boards.js'
import taskRoutes from './routes/tasks.js'
import memberRoutes from './routes/members.js'
import sseRoutes from './routes/sse.js'

export function createApp(): express.Express {
  const app = express()

  // Trust the X-Forwarded-Proto header from nginx so express-session sees the
  // connection as HTTPS and sets the secure session cookie correctly.
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          // htmx 2.0.4
          "'sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+'",
          // htmx-ext-sse 2.2.2
          "'sha384-fw+eTlCc7suMV/1w/7fr2/PmwElUIt5i82bi+qTiLXvjRXZ2/FkiTNA/w0MhXnGI'",
          // SortableJS 1.15.6
          "'sha384-HZZ/fukV+9G8gwTNjN7zQDG0Sp7MsZy5DDN6VfY3Be7V9dvQpEpR2jF2HlyFUUjU'",
        ],
        imgSrc: ["'self'", 'https://lh3.googleusercontent.com'],
      },
    },
  }))

  nunjucks.configure(path.join(__dirname, '..', 'views'), {
    autoescape: true,
    express: app,
    noCache: true,
  })

  app.use(express.static(path.join(__dirname, '..', 'public')))
  app.use(express.urlencoded({ extended: false }))
  app.use(express.json())

  const sessionSecret = process.env.SESSION_SECRET
  if (!sessionSecret && process.env.NODE_ENV !== 'test') {
    throw new Error('SESSION_SECRET environment variable is required')
  }

  app.use(
    session({
      store: createSessionStore(db),
      secret: sessionSecret ?? 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  )

  configurePassport()
  app.use(passport.initialize())
  app.use(passport.session())

  // Bypass OAuth in tests — creates a real session for an existing user
  if (process.env.NODE_ENV === 'test') {
    app.post('/_test/login', (req, res, next) => {
      const user = db
        .prepare<number, Express.User>('SELECT * FROM users WHERE id = ?')
        .get(Number(req.body.userId))
      if (!user) return res.status(404).send('User not found')
      req.login(user, (err) => {
        if (err) return next(err)
        res.json({ ok: true })
      })
    })
  }

  app.use(authRoutes)
  app.use(boardRoutes)
  app.use(taskRoutes)
  app.use(memberRoutes)
  app.use(sseRoutes)

  app.use((_req, res) => res.status(404).render('404.njk'))

  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(err)
      const message = process.env.NODE_ENV === 'production' ? 'Something went wrong.' : err.message
      res.status(500).render('error.njk', { message })
    }
  )

  return app
}
