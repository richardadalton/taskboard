import passport from 'passport'
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20'
import { db } from './db.js'
import type { User } from './types.js'

export function configurePassport(): void {
  const clientID = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientID || !clientSecret) {
    console.warn('[auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google OAuth disabled')
  } else {
    passport.use(
      new GoogleStrategy(
        {
          clientID,
          clientSecret,
          callbackURL: `${process.env.APP_URL ?? 'http://localhost:3000'}/auth/google/callback`,
        },
        (_accessToken: string, _refreshToken: string, profile: Profile, done) => {
          try {
            const email = profile.emails?.[0]?.value ?? null
            const avatarUrl = profile.photos?.[0]?.value ?? null
            const username = profile.displayName || profile.name?.givenName || email || profile.id

            db.prepare(`
              INSERT INTO users (oauth_id, username, email, avatar_url)
              VALUES (@oauth_id, @username, @email, @avatar_url)
              ON CONFLICT (oauth_id) DO UPDATE SET
                username   = excluded.username,
                email      = excluded.email,
                avatar_url = excluded.avatar_url
            `).run({ oauth_id: profile.id, username, email, avatar_url: avatarUrl })

            const user = db
              .prepare<string, User>('SELECT * FROM users WHERE oauth_id = ?')
              .get(profile.id)

            done(null, user ?? false)
          } catch (err) {
            done(err as Error)
          }
        }
      )
    )
  }

  passport.serializeUser((user, done) => {
    done(null, (user as Express.User).id)
  })

  passport.deserializeUser((id: number, done) => {
    try {
      const user = db.prepare<number, User>('SELECT * FROM users WHERE id = ?').get(id)
      done(null, user ?? false)
    } catch (err) {
      done(err)
    }
  })
}
