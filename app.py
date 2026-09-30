import json
import os
import sqlite3
from functools import wraps

from flask import Flask, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
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
        if "user_id" not in session:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped_view


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
            next_url = request.args.get("next") or url_for("home")
            return redirect(next_url)

        error = "Invalid username or password."

    return render_template("login.html", error=error)


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
    return render_template("schedule.html")


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