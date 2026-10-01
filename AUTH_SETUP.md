# Username and Password Login

The Flask app stores usernames and password hashes in its local SQLite database (`studytool.db`). On first startup, it creates a demo account:

```text
Username: admin
Password: admin123
```

Set a unique `SECRET_KEY` environment variable before deploying so Flask sessions are protected by a deployment-specific secret. The built-in demo account is intended for local development; change or remove its credentials before exposing an instance publicly.

Run the app locally:

```zsh
pip install -r requirements.txt
export SECRET_KEY="$(openssl rand -hex 32)"
python app.py
```