import express from 'express'
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

  nunjucks.configure(path.join(__dirname, '..', 'views'), {
    autoescape: true,
    express: app,
    noCache: true,
  })

  app.use(express.static(path.join(__dirname, '..', 'public')))
  app.use(express.urlencoded({ extended: false }))
  app.use(express.json())

  app.use(
    session({
      store: createSessionStore(db),
      secret: process.env.SESSION_SECRET ?? 'dev-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false,
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
      res.status(500).render('error.njk', { message: err.message })
    }
  )

  return app
}
