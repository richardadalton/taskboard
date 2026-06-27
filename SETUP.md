# Setup

Copy `.env.example` to `.env` and fill in the values below.

---

## SESSION_SECRET

Any long random string. Generate one in your terminal:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output as the value.

---

## Google OAuth (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)

### 1. Create a Google Cloud project

Go to `https://console.cloud.google.com/` and create a new project (or select an existing one).

### 2. Configure the OAuth consent screen

1. In the left sidebar, go to **APIs & Services → OAuth consent screen**.
2. Choose **External** (allows any Google account to sign in) and click **Create**.
3. Fill in the required fields:
   - **App name**: Tasklist (or anything you like)
   - **User support email**: your email
   - **Developer contact email**: your email
4. Click **Save and Continue** through the remaining screens. You don't need to add scopes manually — the app requests `profile` and `email` at runtime.
5. On the **Test users** screen, add your own Google account so you can sign in while the app is in testing mode.
6. Click **Back to Dashboard**.

### 3. Create OAuth credentials

1. Go to **APIs & Services → Credentials**.
2. Click **+ Create Credentials → OAuth client ID**.
3. Set **Application type** to **Web application**.
4. Under **Authorized redirect URIs**, click **Add URI** and enter:
   ```
   http://localhost:3000/auth/google/callback
   ```
5. Click **Create**.
6. Copy the **Client ID** → paste as `GOOGLE_CLIENT_ID`.
7. Copy the **Client Secret** → paste as `GOOGLE_CLIENT_SECRET`.

**For production**, add your production callback URL as a second redirect URI:
```
https://yourdomain.com/auth/google/callback
```
You can have multiple redirect URIs on the same credential — no need to create a separate one. Set `APP_URL=https://yourdomain.com` in your production environment.

### Publishing the app

While in **Testing** mode, only users listed in the **Test users** screen can sign in. To allow anyone to sign in, go back to the OAuth consent screen and click **Publish App**. Google may ask you to complete a verification process if your app requests sensitive scopes (it won't for `profile` and `email`).

---

## Resend (RESEND_API_KEY, INVITE_FROM_EMAIL) — optional

Without these, invitation links are printed to the console instead of emailed. Useful for local development.

1. Sign up at `https://resend.com` (free tier covers 3,000 emails/month).
2. Go to **API Keys → Create API Key**. Copy it → paste as `RESEND_API_KEY`.
3. Go to **Domains → Add Domain**. Verify your domain by adding the DNS records Resend provides.
4. Set `INVITE_FROM_EMAIL` to an address at your verified domain, e.g. `tasklist@yourdomain.com`.

---

## APP_URL

The base URL the app is running at. Used for building invitation links.

- Local: `http://localhost:3000`
- Production: `https://yourdomain.com`

---

## Running the app

```
npm install
npm run dev
```

Then open `http://localhost:3000`.
