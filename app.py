import json
import os
import secrets
import sqlite3
from functools import wraps
from urllib.parse import urlparse

from flask import Flask, redirect, render_template, request, session, url_for, jsonify
from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.flask_client import OAuth
from werkzeug.security import check_password_hash, generate_password_hash

from static.ai import ask_ai

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "studytool-dev-secret-key")
app.config["DATABASE"] = os.path.join(app.root_path, "studytool.db")
app.config["GOOGLE_CLIENT_ID"] = os.environ.get("GOOGLE_CLIENT_ID")
app.config["GOOGLE_CLIENT_SECRET"] = os.environ.get("GOOGLE_CLIENT_SECRET")

oauth = OAuth(app)
google = oauth.register(
    name="google",
    client_id=app.config["GOOGLE_CLIENT_ID"],
    client_secret=app.config["GOOGLE_CLIENT_SECRET"],
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def get_db():
    conn = sqlite3.connect(app.config["DATABASE"])
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            google_sub TEXT
        )
        """
    )

    user_columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()
    }
    if "google_sub" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub)"
    )

    existing_user = conn.execute(
        "SELECT COUNT(*) AS count FROM users WHERE username = ?",
        ("admin",),
    ).fetchone()

    if existing_user["count"] == 0:
        conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            ("admin", generate_password_hash("admin123")),
        )

    conn.commit()
    conn.close()


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped_view


def safe_next_url(target):
    if not target:
        return url_for("home")

    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc or not target.startswith("/"):
        return url_for("home")
    return target


def load_resources():
    json_path = os.path.join(app.root_path, "data", "resources.json")
    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        conn = get_db()
        user = conn.execute(
            "SELECT * FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        conn.close()

        if user and check_password_hash(user["password_hash"], password):
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            next_url = safe_next_url(request.args.get("next"))
            return redirect(next_url)

        error = "Invalid username or password."

    return render_template(
        "login.html",
        error=error,
        google_login_enabled=bool(
            app.config.get("GOOGLE_CLIENT_ID") and app.config.get("GOOGLE_CLIENT_SECRET")
        ),
    )


@app.route("/auth/google")
def google_login():
    if not app.config.get("GOOGLE_CLIENT_ID") or not app.config.get("GOOGLE_CLIENT_SECRET"):
        return render_template(
            "login.html",
            error="Google sign-in is not configured on this server.",
            google_login_enabled=False,
        ), 503

    session["login_next"] = safe_next_url(request.args.get("next"))
    callback_url = url_for("google_callback", _external=True)
    return google.authorize_redirect(callback_url)


@app.route("/auth/google/callback")
def google_callback():
    if not app.config.get("GOOGLE_CLIENT_ID") or not app.config.get("GOOGLE_CLIENT_SECRET"):
        return redirect(url_for("login"))

    try:
        token = google.authorize_access_token()
    except OAuthError:
        return render_template(
            "login.html", error="Google sign-in could not be completed."
        ), 400

    profile = token.get("userinfo", {})
    email = profile.get("email", "").strip().lower()
    google_sub = profile.get("sub")
    if not email or not google_sub or not profile.get("email_verified"):
        return render_template(
            "login.html", error="Google did not provide a verified email address."
        ), 400

    conn = get_db()
    user = conn.execute(
        "SELECT * FROM users WHERE google_sub = ?", (google_sub,)
    ).fetchone()
    if user is None:
        user = conn.execute(
            "SELECT * FROM users WHERE username = ?", (email,)
        ).fetchone()

        if user and user["google_sub"]:
            conn.close()
            return render_template(
                "login.html", error="This account is linked to a different Google account."
            ), 403

        if user:
            conn.execute(
                "UPDATE users SET google_sub = ? WHERE id = ?",
                (google_sub, user["id"]),
            )
        else:
            cursor = conn.execute(
                "INSERT INTO users (username, password_hash, google_sub) VALUES (?, ?, ?)",
                (email, generate_password_hash(secrets.token_urlsafe(32)), google_sub),
            )
            user = conn.execute(
                "SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()

    conn.commit()
    conn.close()

    next_url = safe_next_url(session.pop("login_next", None))
    session.clear()
    session["user_id"] = user["id"]
    session["username"] = user["username"]
    return redirect(next_url)

@app.route("/api/ai", methods=["POST"])
@login_required
def ai_chat():
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data received."}), 400

    message = data.get("message", "").strip()

    if not message:
        return jsonify({"error": "Message cannot be empty."}), 400

    try:
        answer = ask_ai(message)

        return jsonify({
            "response": answer
        })

    except Exception as e:
        print(f"AI error: {e}")

        return jsonify({
            "error": "The AI encountered an error."
        }), 500


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def home():
    return render_template("index.html")


@app.route("/appearance")
@login_required
def appearance():
    return render_template("appearance.html")


@app.route("/settings")
@login_required
def settings():
    return render_template("settings.html")


@app.route("/resources")
@login_required
def resources():
    query = request.args.get("query", "").strip()
    all_resources = load_resources()

    if query:
        search_term = query.lower()
        filtered_resources = [
            item for item in all_resources
            if search_term in item.get("title", "").lower()
            or search_term in item.get("subject", "").lower()
            or search_term in item.get("description", "").lower()
        ]
    else:
        filtered_resources = all_resources

    return render_template("resources.html", resources=filtered_resources, query=query)


@app.route("/focus")
@login_required
def focus():
    return render_template("focus.html")


@app.route("/schedule")
@login_required
def schedule():
    return redirect(url_for("time_management"))


@app.route("/time-management")
@login_required
def time_management():
    return render_template("time_management.html")


@app.route("/timeManagement.html")
@login_required
def legacy_time_management():
    return redirect("/time-management", code=301)


@app.route("/support")
@login_required
def support():
    return render_template("support.html")


@app.route("/ai")
@login_required
def ai_help():
    return render_template("ai.html")


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=False)