import json
import os
import re
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from urllib.parse import urlparse
from flask import Flask, Response, redirect, render_template, request, session, url_for, jsonify  # type: ignore[reportMissingImports]
from werkzeug.security import check_password_hash, generate_password_hash

try:
    from static.ai import (  # type: ignore[reportMissingImports]
        ask_ai,
        bound_conversation_history,
        find_resources,
        search_web,
        should_recommend_resources,
        summarize_conversation,
        update_user_memory,
    )
except ModuleNotFoundError:  # pragma: no cover
    from app.static.ai import (  # type: ignore
        ask_ai,
        bound_conversation_history,
        find_resources,
        search_web,
        should_recommend_resources,
        summarize_conversation,
        update_user_memory,
    )

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "studytool-dev-secret-key")
app.config["DATABASE"] = os.path.join(app.root_path, "studytool.db")
app.config["SAVE_DATA_DIR"] = os.path.join(app.root_path, "static", "SaveData")

VALID_THEMES = {
    "light-lavender",
    "light-blue",
    "light-coral",
    "light-cobalt",
    "light-emerald",
    "light-orchid",
    "light-citrus",
    "light-slate",
    "dark-purple",
    "dark-blue",
    "dark-green",
    "dark-citrus",
    "dark-neon",
    "dark-ember",
    "dark-jade",
    "dark-mocha",
}

# -----------------------------------------------------------------------------
# App setup and shared database helpers
# -----------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(app.config["DATABASE"])
    conn.row_factory = sqlite3.Row
    return conn


def ai_user_directory():
    return user_save_directory(session.get("user_id"))


def user_save_directory(user_id):
    conn = get_db()
    try:
        user = conn.execute(
            "SELECT username FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    finally:
        conn.close()

    if user is None:
        raise ValueError("The signed-in user could not be found.")

    username = user["username"]
    if not re.fullmatch(r"[A-Za-z0-9_-]{3,32}", username):
        raise ValueError("The signed-in username is not valid for AI storage.")

    user_dir = Path(app.config["SAVE_DATA_DIR"]) / username
    for directory in ("chats", "Schedule", "Settings"):
        (user_dir / directory).mkdir(parents=True, exist_ok=True)
    memory_path = user_dir / "memory"
    if not memory_path.exists():
        write_json_atomically(memory_path, {"explicit_facts": [], "facts": []})
    migrate_database_preferences(user_id, user_dir)
    return user_dir


def write_json_atomically(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(data, temporary_file, ensure_ascii=False, indent=2)
            temporary_file.write("\n")
        os.replace(temporary_path, path)
    except OSError:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()
        raise


def safe_chat_title(value):
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return "New conversation"
    return cleaned[:80]


def chat_filename_slug(title):
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:60].rstrip("-") or "conversation"


def find_chat_file(user_dir, chat_id):
    if not isinstance(chat_id, str) or not re.fullmatch(r"[a-f0-9]{32}", chat_id):
        return None
    matches = list((user_dir / "chats").glob(f"*-{chat_id}.json"))
    return matches[0] if len(matches) == 1 else None


def load_user_memory(user_dir):
    memory_path = user_dir / "memory"
    if not memory_path.exists():
        return {"explicit_facts": [], "facts": []}
    with memory_path.open("r", encoding="utf-8") as memory_file:
        memory = json.load(memory_file)
    facts = memory.get("facts") if isinstance(memory, dict) else None
    if not isinstance(facts, list):
        facts = []
    explicit_facts = (
        memory.get("explicit_facts", []) if isinstance(memory, dict) else []
    )
    if not isinstance(explicit_facts, list):
        explicit_facts = []

    def clean_facts(candidates):
        return [
            fact.strip()[:200]
            for fact in candidates
            if isinstance(fact, str) and fact.strip()
        ][:12]

    return {
        "explicit_facts": clean_facts(explicit_facts),
        "facts": clean_facts(facts),
    }


# -----------------------------------------------------------------------------
# User account, theme, and schedule storage setup
# -----------------------------------------------------------------------------

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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            theme TEXT,
            schedule_json TEXT NOT NULL DEFAULT '[]'
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


def migrate_database_preferences(user_id, user_dir):
    schedule_path = user_dir / "Schedule" / "schedule.json"
    settings_path = user_dir / "Settings" / "settings.json"
    if schedule_path.exists() and settings_path.exists():
        return

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT theme, schedule_json FROM user_preferences WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        return
    if not schedule_path.exists():
        schedule = json.loads(row["schedule_json"])
        if not isinstance(schedule, list):
            raise ValueError("Saved schedule data must be a list.")
        write_json_atomically(schedule_path, schedule)
    if not settings_path.exists():
        settings = {}
        theme = row["theme"]
        if theme:
            if theme not in VALID_THEMES:
                raise ValueError("Saved theme is not valid.")
            settings["appearance"] = {"theme": theme}
        write_json_atomically(settings_path, settings)


def get_saved_schedule(user_id):
    schedule_path = user_save_directory(user_id) / "Schedule" / "schedule.json"
    if not schedule_path.exists():
        return []
    with schedule_path.open("r", encoding="utf-8") as schedule_file:
        schedule = json.load(schedule_file)
    if not isinstance(schedule, list):
        raise ValueError("Saved schedule data must be a list.")
    return schedule


def save_user_theme(user_id, theme):
    settings_path = user_save_directory(user_id) / "Settings" / "settings.json"
    settings = {}
    if settings_path.exists():
        with settings_path.open("r", encoding="utf-8") as settings_file:
            settings = json.load(settings_file)
        if not isinstance(settings, dict):
            raise ValueError("Saved user settings must be an object.")
    appearance = settings.get("appearance", {})
    if not isinstance(appearance, dict):
        raise ValueError("Saved appearance settings must be an object.")
    appearance["theme"] = theme
    settings["appearance"] = appearance
    write_json_atomically(settings_path, settings)


def save_user_schedule(user_id, schedule):
    schedule_path = user_save_directory(user_id) / "Schedule" / "schedule.json"
    write_json_atomically(schedule_path, schedule)


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if "user_id" in session:
            return view(*args, **kwargs)
        return redirect(url_for("login", next=request.path))

    return wrapped_view


# -----------------------------------------------------------------------------
# User preference APIs: theme and calendar data are loaded and saved here.
# -----------------------------------------------------------------------------

@app.route("/api/preferences/theme", methods=["GET", "PUT"])
@login_required
def user_theme_preference():
    user_id = session["user_id"]
    if request.method == "GET":
        try:
            settings_path = (
                user_save_directory(user_id) / "Settings" / "settings.json"
            )
            if not settings_path.exists():
                return jsonify({"theme": None})
            with settings_path.open("r", encoding="utf-8") as settings_file:
                settings = json.load(settings_file)
            if not isinstance(settings, dict):
                raise ValueError("Saved user settings must be an object.")
            appearance = settings.get("appearance", {})
            if not isinstance(appearance, dict):
                raise ValueError("Saved appearance settings must be an object.")
            theme = appearance.get("theme")
            if theme is not None and theme not in VALID_THEMES:
                raise ValueError("Saved theme is not valid.")
            return jsonify({"theme": theme})
        except (sqlite3.Error, OSError, json.JSONDecodeError, ValueError) as error:
            app.logger.exception("Could not load user theme: %s", error)
            return jsonify({"error": "Could not load your saved theme."}), 500

    data = request.get_json(silent=True)
    theme = data.get("theme") if isinstance(data, dict) else None
    if not isinstance(theme, str) or theme not in VALID_THEMES:
        return jsonify({"error": "Choose a valid color theme."}), 400
    try:
        save_user_theme(user_id, theme)
        return jsonify({"theme": theme})
    except (sqlite3.Error, OSError, json.JSONDecodeError, ValueError) as error:
        app.logger.exception("Could not save user theme: %s", error)
        return jsonify({"error": "Could not save your theme to your account."}), 500


@app.route("/api/preferences/schedule", methods=["GET", "PUT"])
@login_required
def user_schedule_preference():
    user_id = session["user_id"]
    if request.method == "GET":
        try:
            return jsonify({"events": get_saved_schedule(user_id)})
        except (sqlite3.Error, OSError, json.JSONDecodeError, ValueError) as error:
            app.logger.exception("Could not load user schedule: %s", error)
            return jsonify({"error": "Could not load your saved schedule."}), 500

    data = request.get_json(silent=True)
    events = data.get("events") if isinstance(data, dict) else None
    if not isinstance(events, list) or len(events) > 500:
        return jsonify({"error": "Schedule must contain no more than 500 events."}), 400

    allowed_types = {"to-do", "event", "homework", "exam", "rest"}
    clean_events = []
    seen_ids = set()
    try:
        for event in events:
            if not isinstance(event, dict):
                raise ValueError("Each schedule event must be an object.")
            event_id = event.get("id")
            title = event.get("title")
            event_type = event.get("type")
            date = event.get("date")
            time = event.get("time", "09:00")
            end_time = event.get("end_time")
            legacy_duration = event.get("duration_minutes")
            done = event.get("done")
            if time == "":
                time = "09:00"
            if (
                not isinstance(time, str)
                or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", time)
            ):
                raise ValueError("A schedule event contains an invalid start time.")
            if end_time is None:
                if legacy_duration is not None:
                    if (
                        isinstance(legacy_duration, bool)
                        or not isinstance(legacy_duration, int)
                        or not 15 <= legacy_duration <= 1440
                    ):
                        raise ValueError("A schedule event contains an invalid duration.")
                    start_minutes = int(time[:2]) * 60 + int(time[3:])
                    end_minutes = start_minutes + legacy_duration
                    if end_minutes > 1439:
                        raise ValueError("A schedule event cannot continue past midnight.")
                    end_time = f"{end_minutes // 60:02d}:{end_minutes % 60:02d}"
                else:
                    start_minutes = int(time[:2]) * 60 + int(time[3:])
                    end_minutes = min(start_minutes + 60, 1439)
                    end_time = f"{end_minutes // 60:02d}:{end_minutes % 60:02d}"
            if (
                not isinstance(event_id, str)
                or len(event_id) > 36
                or not event_id
                or event_id in seen_ids
                or not isinstance(title, str)
                or not title.strip()
                or len(title.strip()) > 120
                or not isinstance(event_type, str)
                or event_type not in allowed_types
                or not isinstance(date, str)
                or not isinstance(time, str)
                or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", time)
                or not isinstance(end_time, str)
                or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", end_time)
                or not isinstance(done, bool)
            ):
                raise ValueError("A schedule event contains invalid fields.")
            datetime.strptime(date, "%Y-%m-%d")
            if end_time <= time:
                raise ValueError("A schedule event end time must follow its start time.")
            seen_ids.add(event_id)
            clean_events.append({
                "id": event_id,
                "title": title.strip(),
                "type": event_type,
                "date": date,
                "time": time,
                "end_time": end_time,
                "done": done,
            })
    except (TypeError, ValueError) as error:
        return jsonify({"error": str(error) or "A schedule date is invalid."}), 400

    try:
        save_user_schedule(user_id, clean_events)
        return jsonify({"events": clean_events})
    except (sqlite3.Error, OSError, json.JSONDecodeError, ValueError) as error:
        app.logger.exception("Could not save user schedule: %s", error)
        return jsonify({"error": "Could not save your schedule to your account."}), 500


# -----------------------------------------------------------------------------
# Notebook data validation and persistence
# -----------------------------------------------------------------------------

def clean_notebook_data(data):
    notebooks = data.get("notebooks")
    active_id = data.get("active_id")
    if not isinstance(notebooks, list) or not notebooks:
        raise ValueError("Add at least one notebook.")
    if not isinstance(active_id, str):
        raise ValueError("Choose an active notebook.")

    clean_notebooks = []
    seen_ids = set()
    for notebook in notebooks:
        if not isinstance(notebook, dict):
            raise ValueError("Each notebook must be an object.")
        notebook_id = notebook.get("id")
        name = notebook.get("name")
        content = notebook.get("content")
        quick_note = notebook.get("quick_note", "")
        if (
            not isinstance(notebook_id, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,36}", notebook_id)
            or notebook_id in seen_ids
            or not isinstance(name, str)
            or not name.strip()
            or len(name.strip()) > 80
            or not isinstance(content, str)
            or len(content) > 200_000
            or not isinstance(quick_note, str)
            or len(quick_note) > 20_000
        ):
            raise ValueError("A notebook contains invalid fields.")
        seen_ids.add(notebook_id)
        clean_notebooks.append({
            "id": notebook_id,
            "name": name.strip(),
            "content": content,
            "quick_note": quick_note,
        })

    if active_id not in seen_ids:
        raise ValueError("The active notebook could not be found.")
    return {"notebooks": clean_notebooks, "active_id": active_id}


@app.route("/api/notebooks", methods=["GET", "PUT"])
@login_required
def user_notebooks():
    notebooks_path = (
        user_save_directory(session["user_id"])
        / "Notebooks"
        / "notebooks.json"
    )
    if request.method == "GET":
        try:
            if notebooks_path.exists():
                with notebooks_path.open("r", encoding="utf-8") as notebooks_file:
                    saved_data = json.load(notebooks_file)
                if not isinstance(saved_data, dict):
                    raise ValueError("Saved notebooks must be an object.")
                return jsonify(clean_notebook_data(saved_data))

            first_notebook = {
                "id": uuid.uuid4().hex,
                "name": "My Notebook",
                "content": "",
                "quick_note": "",
            }
            data = {
                "notebooks": [first_notebook],
                "active_id": first_notebook["id"],
            }
            write_json_atomically(notebooks_path, data)
            return jsonify(data)
        except (sqlite3.Error, OSError, json.JSONDecodeError, ValueError) as error:
            app.logger.exception("Could not load user notebooks: %s", error)
            return jsonify({"error": "Could not load your notebooks."}), 500

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Notebook data must be an object."}), 400
    try:
        clean_data = clean_notebook_data(data)
    except (TypeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400
    try:
        write_json_atomically(notebooks_path, clean_data)
        return jsonify(clean_data)
    except (sqlite3.Error, OSError, ValueError) as error:
        app.logger.exception("Could not save user notebooks: %s", error)
        return jsonify({"error": "Could not save your notebooks to your account."}), 500


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


# -----------------------------------------------------------------------------
# Authentication flows and public app pages
# -----------------------------------------------------------------------------

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

# -----------------------------------------------------------------------------
# AI chat endpoints: create, load, rename, delete conversations, and stream replies
# -----------------------------------------------------------------------------

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
        user_dir = ai_user_directory()
        chat_id = data.get("chat_id")
        if chat_id is None:
            chat_id = uuid.uuid4().hex
            title = safe_chat_title(message)
            chat = {
                "id": chat_id,
                "title": title,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "summary": "",
                "summary_through": 0,
                "messages": [],
            }
            chat_path = (
                user_dir / "chats" /
                f"{chat_filename_slug(title)}-{chat_id}.json"
            )
        else:
            chat_path = find_chat_file(user_dir, chat_id)
            if chat_path is None:
                return jsonify({"error": "Conversation not found."}), 404
            with chat_path.open("r", encoding="utf-8") as chat_file:
                chat = json.load(chat_file)
            if not isinstance(chat, dict) or not isinstance(chat.get("messages"), list):
                return jsonify({"error": "Saved conversation data is invalid."}), 500

        conversation_history, context_start, full_history = (
            bound_conversation_history(chat["messages"])
        )
        conversation_summary = chat.get("summary", "")
        if not isinstance(conversation_summary, str):
            conversation_summary = ""
        conversation_summary = conversation_summary[:2500]
        try:
            summary_through = max(0, int(chat.get("summary_through", 0)))
        except (TypeError, ValueError):
            summary_through = 0
        summary_through = min(summary_through, context_start)
        if summary_through < context_start:
            conversation_summary = summarize_conversation(
                conversation_summary,
                full_history[summary_through:context_start],
            )
            chat["summary"] = conversation_summary
            chat["summary_through"] = context_start
            write_json_atomically(chat_path, chat)

        memory = load_user_memory(user_dir)

        chat["messages"].append({"role": "user", "content": message})
        chat["updated_at"] = datetime.now(timezone.utc).isoformat()
        write_json_atomically(chat_path, chat)

        lookup_requested = should_recommend_resources(message)
        resources = (
            find_resources(
                message,
                conversation_history,
                conversation_summary,
            )
            if lookup_requested
            else []
        )
        if resources:
            chat["messages"].extend(
                {"role": "resource", "resource": resource}
                for resource in resources
            )
            tool_results = resources
        elif lookup_requested:
            tool_results = [
                "Web search was requested, but no usable sources were returned."
            ]
            chat["messages"].append({
                "role": "tool",
                "tool_name": "web_search",
                "content": tool_results[0],
            })
        else:
            tool_results = []

        write_json_atomically(chat_path, chat)
        turn_context = [
            *conversation_history,
            {"role": "user", "content": message},
        ]
        turn_context.extend(
            {
                "role": "tool",
                "tool_name": "web_search",
                "content": json.dumps(resource, ensure_ascii=False),
            }
            for resource in resources
        )
        if lookup_requested and not resources:
            turn_context.append({
                "role": "tool",
                "tool_name": "web_search",
                "content": tool_results[0],
            })

        def generate():
            current_memory = memory
            yield json.dumps({
                "type": "chat",
                "chat": {
                    "id": chat["id"],
                    "title": chat["title"],
                },
            }) + "\n"

            for resource in resources:
                yield json.dumps({
                    "type": "resource",
                    "resource": resource
                }) + "\n"

            full_response = ""
            for chunk in ask_ai(
                message,
                "",
                conversation_history,
                current_memory,
                conversation_summary=conversation_summary,
                tool_results=tool_results,
            ):
                full_response += chunk
                yield json.dumps({
                    "type": "token",
                    "content": chunk
                }) + "\n"

            if full_response.strip():
                chat["messages"].append({
                    "role": "assistant",
                    "content": full_response,
                })
                chat["updated_at"] = datetime.now(timezone.utc).isoformat()
                write_json_atomically(chat_path, chat)
                try:
                    current_memory = update_user_memory(
                        current_memory,
                        message,
                        conversation_history=turn_context + [{
                            "role": "assistant",
                            "content": full_response,
                        }],
                        conversation_summary=conversation_summary,
                        current_message_in_history=True,
                    )
                    write_json_atomically(user_dir / "memory", current_memory)
                except Exception as memory_error:
                    app.logger.exception("Could not update AI user memory: %s", memory_error)
                    yield json.dumps({
                        "type": "memory_error",
                        "message": "The conversation was saved, but user memory could not be updated.",
                    }) + "\n"

            yield json.dumps({
                "type": "done"
            }) + "\n"

        return Response(
            generate(),
            mimetype="application/x-ndjson"
        )

    except Exception as e:
        app.logger.exception("AI error: %s", e)

        return jsonify({
            "error": "The AI encountered an error."
        }), 500


@app.route("/api/ai/chats", methods=["GET"])
@login_required
def list_ai_chats():
    try:
        user_dir = ai_user_directory()
        chats = []
        for chat_path in (user_dir / "chats").glob("*.json"):
            with chat_path.open("r", encoding="utf-8") as chat_file:
                chat = json.load(chat_file)
            chats.append({
                "id": chat["id"],
                "title": chat["title"],
                "updated_at": chat.get("updated_at", ""),
            })
        chats.sort(key=lambda chat: chat["updated_at"], reverse=True)
        return jsonify({"chats": chats})
    except (OSError, ValueError, json.JSONDecodeError, KeyError) as error:
        app.logger.exception("Could not list AI chats: %s", error)
        return jsonify({"error": "Could not load saved conversations."}), 500


@app.route("/api/ai/chats/<chat_id>", methods=["GET"])
@login_required
def get_ai_chat(chat_id):
    try:
        user_dir = ai_user_directory()
        chat_path = find_chat_file(user_dir, chat_id)
        if chat_path is None:
            return jsonify({"error": "Conversation not found."}), 404

        with chat_path.open("r", encoding="utf-8") as chat_file:
            chat = json.load(chat_file)
        return jsonify({"chat": chat})
    except (OSError, ValueError, json.JSONDecodeError) as error:
        app.logger.exception("Could not load AI conversation: %s", error)
        return jsonify({"error": "Could not load this conversation."}), 500


@app.route("/api/ai/chats/<chat_id>/rename", methods=["POST"])
@login_required
def rename_ai_chat(chat_id):
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "A conversation title is required."}), 400

    requested_title = data.get("title")
    if not isinstance(requested_title, str):
        return jsonify({"error": "A conversation title is required."}), 400
    title = safe_chat_title(requested_title)
    if title == "New conversation" and not requested_title.strip():
        return jsonify({"error": "A conversation title cannot be empty."}), 400

    try:
        user_dir = ai_user_directory()
        chat_path = find_chat_file(user_dir, chat_id)
        if chat_path is None:
            return jsonify({"error": "Conversation not found."}), 404

        with chat_path.open("r", encoding="utf-8") as chat_file:
            chat = json.load(chat_file)
        chat["title"] = title
        chat["updated_at"] = datetime.now(timezone.utc).isoformat()
        renamed_path = chat_path.with_name(
            f"{chat_filename_slug(title)}-{chat_id}.json"
        )
        write_json_atomically(renamed_path, chat)
        if renamed_path != chat_path:
            chat_path.unlink()
        return jsonify({"chat": {"id": chat_id, "title": title}})
    except (OSError, ValueError, json.JSONDecodeError) as error:
        app.logger.exception("Could not rename AI conversation: %s", error)
        return jsonify({"error": "Could not rename this conversation."}), 500


@app.route("/api/ai/chats/<chat_id>", methods=["DELETE"])
@login_required
def delete_ai_chat(chat_id):
    try:
        user_dir = ai_user_directory()
        chat_path = find_chat_file(user_dir, chat_id)
        if chat_path is None:
            return jsonify({"error": "Conversation not found."}), 404
        chat_path.unlink()
        return jsonify({"deleted": chat_id})
    except OSError as error:
        app.logger.exception("Could not delete AI conversation: %s", error)
        return jsonify({"error": "Could not delete this conversation."}), 500


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# -----------------------------------------------------------------------------
# Main dashboard and feature pages
# -----------------------------------------------------------------------------

@app.route("/")
@login_required
def home():
    search_routes = [
        {"path": rule.rule, "endpoint": rule.endpoint}
        for rule in app.url_map.iter_rules()
        if "GET" in rule.methods
        and "<" not in rule.rule
        and not rule.rule.startswith("/api/")
        and rule.endpoint not in {"static", "login", "signup", "logout", "legacy_time_management", "schedule", "appearance"}
    ]
    return render_template(
        "index.html",
        username=session.get("username", "User"),
        search_routes=search_routes,
    )


@app.route("/appearance")
@login_required
def appearance():
    return render_template("settings.html")


@app.route("/settings")
@login_required
def settings():
    return render_template("settings.html")


@app.route("/resources")
@login_required
def resources():
    query = request.args.get("query", "").strip()
    all_resources = load_resources()
    web_results = search_web(query) if query else []

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

    return render_template(
        "resources.html",
        resources=filtered_resources,
        query=query,
        web_results=web_results,
    )


@app.route("/focus")
@login_required
def focus():
    return redirect(url_for("procrastination_focus"))


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


@app.route("/peer-pressure-boundaries")
@login_required
def peer_pressure_boundaries():
    return render_template("peerPreshAndBoundaries.html")


@app.route("/procrastination-focus")
@login_required
def procrastination_focus():
    return render_template("procrastination_focus.html")


@app.route("/ai")
@login_required
def ai_help():
    return render_template("ai.html")


@app.route("/notes")
@login_required
def notes():
    return render_template("notes.html", username=session.get("username", "User"))


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=False)