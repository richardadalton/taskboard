import { Router } from 'express'
import passport from 'passport'

const router = Router()

router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/')
  res.render('login.njk')
})

router.get('/auth/google', (req, res, next) => {
  // Passport regenerates the session on login, which wipes session data including
  // returnTo. Wrap regenerate to carry returnTo across into the new session.
  const returnTo = req.session.returnTo
  if (returnTo) {
    const orig = req.session.regenerate.bind(req.session)
    ;(req.session as any).regenerate = (cb: (err?: Error) => void) => {
      orig((err?: Error) => {
        if (!err) req.session.returnTo = returnTo
        cb(err)
      })
    }
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next)
})

router.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    const returnTo = req.session.returnTo ?? '/'
    delete req.session.returnTo
    const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
    res.redirect(safeReturnTo)
  }
)

router.post('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err)
    res.redirect('/login')
  })
})

export default router
