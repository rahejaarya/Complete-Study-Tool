# Better Auth Setup

The Flask app runs on port 8000 and the Better Auth service runs on port 3001. Both processes need the Google OAuth credentials. Google returns to Better Auth; Better Auth then redirects back to the Flask app.

## Google OAuth

Create a Google OAuth client with application type **Web application**. For local development, add this authorized redirect URI:

```text
http://localhost:3001/api/auth/callback/google
```

For production, use the public Better Auth URL with `/api/auth/callback/google` appended. Configure the OAuth consent screen and add your Google account as a test user while the app is in testing mode.

## Run Locally

Install the Node dependencies and create the Better Auth tables:

```zsh
npm install
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
npm run migrate
```

Run Better Auth in one terminal:

```zsh
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export BETTER_AUTH_SECRET="your-generated-secret"
npm start
```

Run Flask in another terminal:

```zsh
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export BETTER_AUTH_SECRET="your-generated-secret"
export SECRET_KEY="$(openssl rand -hex 32)"
python app.py
```

Use the same `BETTER_AUTH_SECRET` in both terminals. Keep all secrets out of source control. The existing Flask demo username/password login remains available; Google users and sessions are stored in `better-auth.db`.

For deployments, set `BETTER_AUTH_URL` to the public base URL used by Google, `FLASK_APP_URL` to the public Flask origin, and `BETTER_AUTH_INTERNAL_URL` in Flask to the Node service's internal address when it differs from `BETTER_AUTH_URL`. If Better Auth and Flask use different subdomains, set `BETTER_AUTH_COOKIE_DOMAIN` to their shared parent domain (for example, `example.com`) so the browser sends the Better Auth session cookie to Flask too. Keep both services on HTTPS in production.