import json
import os
import sqlite3
from functools import wraps
from urllib.parse import urlparse
from ddgs import DDGS

from flask import Flask, Response, redirect, render_template, request, session, url_for, jsonify  # type: ignore[reportMissingImports]
from werkzeug.security import check_password_hash, generate_password_hash

try:
    from static.ai import ask_ai, find_resource, search_web  # type: ignore[reportMissingImports]
except ModuleNotFoundError:  # pragma: no cover
    from app.static.ai import ask_ai, find_resource, search_web # type: ignore

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "studytool-dev-secret-key")
app.config["DATABASE"] = os.path.join(app.root_path, "studytool.db")


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
            password_hash TEXT NOT NULL
        )
        """
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
        return redirect(url_for("login", next=request.path))

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

    return render_template("login.html", error=error)


@app.route("/signup", methods=["GET", "POST"])
def signup():
    error = None

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        password_confirmation = request.form.get("password_confirmation", "")

        if not 3 <= len(username) <= 32 or not username.replace("_", "").replace("-", "").isalnum():
            error = "Username must be 3-32 letters, numbers, underscores, or hyphens."
        elif not 4 <= len(password) <= 128:
            error = "Password must be between 4 and 128 characters."
        elif password != password_confirmation:
            error = "Passwords do not match."
        else:
            conn = get_db()
            try:
                cursor = conn.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                conn.commit()
                session.clear()
                session["user_id"] = cursor.lastrowid
                session["username"] = username
                return redirect(safe_next_url(request.args.get("next")))
            except sqlite3.IntegrityError:
                conn.rollback()
                error = "That username is already taken."
            finally:
                conn.close()

    return render_template("signup.html", error=error)

@app.route("/api/ai", methods=["POST"])
@login_required
def ai_chat():
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data received."}), 400

    message = data.get("message", "").strip()
    context = data.get("context", "").strip()


    if not message:
        return jsonify({"error": "Message cannot be empty."}), 400

    try:

        web_results = search_web(message)

        resource = find_resource(message)

        web_context = "\n\n".join(
            f"Title: {item['title']}\n"
            f"URL: {item['url']}\n"
            f"Description: {item['description']}"
            for item in web_results
        )

        def generate():

            import json

            # Send the resource first.
            if resource:
                yield json.dumps({
                    "type": "resource",
                    "resource": resource
                }) + "\n"

            # Then stream the AI response.
            combined_message = f"""
            Previous conversation:
            {context}

            Current user message:
            {message}
            """

            for chunk in ask_ai(combined_message, web_context):
                yield json.dumps({
                    "type": "token",
                    "content": chunk
                }) + "\n"

            yield json.dumps({
                "type": "done"
            }) + "\n"

        return Response(
            generate(),
            mimetype="application/x-ndjson"
        )

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