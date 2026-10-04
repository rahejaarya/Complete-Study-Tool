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
from ddgs import DDGS

from flask import Flask, Response, redirect, render_template, request, session, url_for, jsonify  # type: ignore[reportMissingImports]
from werkzeug.security import check_password_hash, generate_password_hash

try:
    from static.ai import ask_ai, find_resources, search_web, should_recommend_resources, update_user_memory  # type: ignore[reportMissingImports]
except ModuleNotFoundError:  # pragma: no cover
    from app.static.ai import ask_ai, find_resources, search_web, should_recommend_resources, update_user_memory # type: ignore

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "studytool-dev-secret-key")
app.config["DATABASE"] = os.path.join(app.root_path, "studytool.db")
app.config["AI_SAVE_DATA_DIR"] = os.path.join(app.root_path, "static", "AiSaveData")


def get_db():
    conn = sqlite3.connect(app.config["DATABASE"])
    conn.row_factory = sqlite3.Row
    return conn


def ai_user_directory():
    conn = get_db()
    try:
        user = conn.execute(
            "SELECT username FROM users WHERE id = ?",
            (session.get("user_id"),),
        ).fetchone()
    finally:
        conn.close()

    if user is None:
        raise ValueError("The signed-in user could not be found.")

    username = user["username"]
    if not re.fullmatch(r"[A-Za-z0-9_-]{3,32}", username):
        raise ValueError("The signed-in username is not valid for AI storage.")

    user_dir = Path(app.config["AI_SAVE_DATA_DIR"]) / username
    (user_dir / "chats").mkdir(parents=True, exist_ok=True)
    memory_path = user_dir / "memory"
    if not memory_path.exists():
        write_json_atomically(memory_path, {"facts": []})
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
        return {"facts": []}
    with memory_path.open("r", encoding="utf-8") as memory_file:
        memory = json.load(memory_file)
    facts = memory.get("facts") if isinstance(memory, dict) else None
    if not isinstance(facts, list):
        return {"facts": []}
    return {
        "facts": [
            fact.strip()[:200]
            for fact in facts
            if isinstance(fact, str) and fact.strip()
        ][:12]
    }


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

        conversation_history = [
            {"role": entry["role"], "content": entry["content"]}
            for entry in chat["messages"]
            if isinstance(entry, dict)
            and entry.get("role") in {"user", "assistant"}
            and isinstance(entry.get("content"), str)
        ][-20:]
        if len(conversation_history) % 2:
            conversation_history = conversation_history[1:]
        history_char_count = 0
        bounded_history = []
        for entry in reversed(conversation_history):
            content = entry["content"]
            if len(content) > 4000 or history_char_count + len(content) > 12000:
                break
            bounded_history.insert(0, entry)
            history_char_count += len(content)
        conversation_history = bounded_history
        memory = load_user_memory(user_dir)

        lookup_requested = should_recommend_resources(message)
        resources = find_resources(message) if lookup_requested else []
        web_context = "\n\n".join(
            f"Type: {item['type']}\n"
            f"Title: {item['title']}\n"
            f"URL: {item['url']}\n"
            f"Description: {item['description']}"
            for item in resources
        )
        if lookup_requested and not resources:
            web_context = (
                "Web search was requested, but no usable web sources were "
                "returned. Tell the user that clearly. You may still provide "
                "a general-knowledge answer, but label it as not verified by "
                "web search."
            )

        chat["messages"].append({"role": "user", "content": message})
        chat["updated_at"] = datetime.now(timezone.utc).isoformat()
        write_json_atomically(chat_path, chat)

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
                web_context,
                conversation_history,
                current_memory,
            ):
                full_response += chunk
                yield json.dumps({
                    "type": "token",
                    "content": chunk
                }) + "\n"

            if full_response.strip():
                chat["messages"].extend(
                    {"role": "resource", "resource": resource}
                    for resource in resources
                )
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
                        full_response,
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


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def home():
    return render_template("index.html", username=session.get("username", "User"))


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