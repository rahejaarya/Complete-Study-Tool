import json
import os
import sqlite3
from functools import wraps
from urllib.parse import urlparse

import requests
from flask import Flask, Response, Resredirect, render_template, request, session, url_for, jsonify
from werkzeug.security import check_password_hash, generate_password_hash

from static.ai import ask_ai

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "studytool-dev-secret-key")
app.config["DATABASE"] = os.path.join(app.root_path, "studytool.db")
app.config["GOOGLE_CLIENT_ID"] = os.environ.get("GOOGLE_CLIENT_ID")
app.config["GOOGLE_CLIENT_SECRET"] = os.environ.get("GOOGLE_CLIENT_SECRET")
app.config["BETTER_AUTH_URL"] = os.environ.get(
    "BETTER_AUTH_URL", "http://localhost:3001"
).rstrip("/")
app.config["BETTER_AUTH_INTERNAL_URL"] = os.environ.get(
    "BETTER_AUTH_INTERNAL_URL", app.config["BETTER_AUTH_URL"]
).rstrip("/")


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
        if "user_id" in session:
            return view(*args, **kwargs)

        auth_session, set_cookies = get_better_auth_session()
        if not auth_session:
            return redirect(url_for("login", next=request.path))

        response = app.make_response(view(*args, **kwargs))
        for cookie in set_cookies:
            response.headers.add("Set-Cookie", cookie)
        return response

    return wrapped_view


def response_set_cookies(response):
    raw_headers = getattr(response.raw, "headers", None)
    if raw_headers is not None and hasattr(raw_headers, "getlist"):
        return raw_headers.getlist("Set-Cookie")
    cookie = response.headers.get("Set-Cookie")
    return [cookie] if cookie else []


def get_better_auth_session():
    cookie_header = request.headers.get("Cookie")
    if not cookie_header:
        return None, []

    try:
        response = requests.get(
            f"{app.config['BETTER_AUTH_INTERNAL_URL']}/api/auth/get-session",
            headers={
                "Cookie": cookie_header,
                "Origin": request.host_url.rstrip("/"),
            },
            timeout=3,
        )
    except requests.RequestException:
        return None, []

    try:
        payload = response.json() if response.status_code == 200 else None
    except ValueError:
        payload = None

    if not isinstance(payload, dict) or not payload.get("user"):
        return None, []
    return payload, response_set_cookies(response)


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

    try:
        response = requests.post(
            f"{app.config['BETTER_AUTH_INTERNAL_URL']}/api/auth/sign-in/social",
            json={
                "provider": "google",
                "callbackURL": (
                    f"{request.host_url.rstrip('/')}{safe_next_url(request.args.get('next'))}"
                ),
            },
            headers={
                "Accept": "application/json",
                "Origin": request.host_url.rstrip("/"),
            },
            timeout=5,
            allow_redirects=False,
        )
    except requests.RequestException:
        return render_template(
            "login.html",
            error="Google sign-in service is unavailable.",
            google_login_enabled=True,
        ), 503

    redirect_url = response.headers.get("Location")
    if not redirect_url and response.ok:
        try:
            redirect_url = response.json().get("url")
        except (ValueError, AttributeError):
            redirect_url = None

    if not redirect_url:
        return render_template(
            "login.html",
            error="Google sign-in could not be started.",
            google_login_enabled=True,
        ), 502

    result = redirect(redirect_url)
    for cookie in response_set_cookies(response):
        result.headers.add("Set-Cookie", cookie)
    return result

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
    cookies = []
    cookie_header = request.headers.get("Cookie")
    if cookie_header:
        try:
            response = requests.post(
                f"{app.config['BETTER_AUTH_INTERNAL_URL']}/api/auth/sign-out",
                headers={
                    "Cookie": cookie_header,
                    "Origin": request.host_url.rstrip("/"),
                },
                timeout=3,
            )
            cookies = response_set_cookies(response)
        except requests.RequestException:
            pass

    session.clear()
    result = redirect(url_for("login"))
    for cookie in cookies:
        result.headers.add("Set-Cookie", cookie)
    return result


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


@app.route("/noise-songs")
@login_required
def noise_songs():
    return render_template("noise_songs.html")


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