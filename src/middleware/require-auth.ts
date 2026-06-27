import type { Request, Response, NextFunction } from 'express'

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) return next()

  // Only store returnTo for top-level page navigations — not for htmx fragment
  // requests, asset requests (anything with a file extension), or non-GET methods.
  const isPageNav =
    req.method === 'GET' &&
    !req.headers['hx-request'] &&
    !/\.\w+$/.test(req.path)

  if (isPageNav) req.session.returnTo = req.originalUrl

  res.redirect('/login')
}
