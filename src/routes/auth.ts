import { Router } from 'express'
import passport from 'passport'

const router = Router()

router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/')
  res.render('login.njk')
})

router.get(
  '/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
)

router.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    const returnTo = req.session.returnTo ?? '/'
    delete req.session.returnTo
    res.redirect(returnTo)
  }
)

router.post('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err)
    res.redirect('/login')
  })
})

export default router
