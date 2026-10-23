import json
import logging
import mimetypes
import os
import re
import shutil
import sqlite3
import tempfile
import uuid
import requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, urlparse, urlsplit
from flask import render_template

from flask import (
    Flask,
    Response,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

try:
    from static.ai import (  # type: ignore[reportMissingImports]
        ask_ai,
        bound_conversation_history,
        create_graph_data,
        find_resources,
        search_educational_videos,
        search_web,
        should_update_user_memory,
        should_recommend_resources,
        study_search_terms,
        summarize_conversation,
        summarize_study_topic,
        update_user_memory,
    )
except ModuleNotFoundError:  # pragma: no cover
    from app.static.ai import (  # type: ignore
        ask_ai,
        bound_conversation_history,
        create_graph_data,
        find_resources,
        search_educational_videos,
        search_web,
        should_update_user_memory,
        should_recommend_resources,
        study_search_terms,
        summarize_conversation,
        summarize_study_topic,
        update_user_memory,
    )

app = Flask(__name__)


class _HideAIChatAccessLogs(logging.Filter):
    """Keep the local-server startup URL visible without logging chat routes."""

    def filter(self, record):
        message = record.getMessage()
        return not re.search(
            r'"(?:GET|POST|PUT|PATCH|DELETE) /api/ai(?:/| )',
            message,
        )


logging.getLogger("werkzeug").addFilter(_HideAIChatAccessLogs())
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "studytool-dev-secret-key")
app.config["DATABASE"] = os.path.join(app.root_path, "studytool.db")
app.config["SAVE_DATA_DIR"] = os.path.join(app.root_path, "static", "SaveData")
app.config["USER_SONGS_DIR"] = os.path.join(app.instance_path, "user_songs")

USER_SONG_AUDIO_EXTENSIONS = {
    ".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav"
}
USER_SONG_VIDEO_EXTENSIONS = {".mp4", ".mov", ".ogv", ".webm"}
USER_SONG_MEDIA_EXTENSIONS = USER_SONG_AUDIO_EXTENSIONS | USER_SONG_VIDEO_EXTENSIONS
MAX_USER_SONG_SIZE = 25 * 1024 * 1024
MAX_USER_SONGS = 50
MAX_PROFILE_PICTURE_SIZE = 5 * 1024 * 1024
MAX_STUDY_FILE_SIZE = 25 * 1024 * 1024


@app.before_request
def block_private_save_data_static_access():
    """Keep authenticated user data private even though it lives under static/."""
    if request.endpoint != "static" or not request.view_args:
        return None

    relative_path = Path(request.view_args["filename"])
    if relative_path.parts and relative_path.parts[0] == "SaveData":
        return jsonify({"error": "Not found."}), 404

    private_root = Path(app.config["SAVE_DATA_DIR"]).resolve()
    static_root = Path(app.static_folder).resolve()
    requested_path = (static_root / relative_path).resolve()
    if requested_path == private_root or private_root in requested_path.parents:
        return jsonify({"error": "Not found."}), 404
    return None


def youtube_video_id(media_url):
    """Extract a video ID from supported HTTPS YouTube URLs."""
    try:
        parsed_url = urlparse(media_url)
        if (
            parsed_url.scheme != "https"
            or parsed_url.username
            or parsed_url.password
            or parsed_url.port not in {None, 443}
        ):
            return None
    except ValueError:
        return None

    hostname = (parsed_url.hostname or "").lower()
    if hostname in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        if parsed_url.path == "/watch":
            video_id = parse_qs(parsed_url.query).get("v", [""])[0]
        else:
            path_parts = parsed_url.path.strip("/").split("/")
            video_id = (
                path_parts[1]
                if len(path_parts) == 2 and path_parts[0] in {"embed", "live", "shorts"}
                else ""
            )
    elif hostname in {"youtu.be", "www.youtu.be"}:
        video_id = parsed_url.path.strip("/").split("/")[0]
    else:
        return None
    return video_id if re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) else None


def youtube_embed_url(video_id):
    """Build a privacy-enhanced YouTube embed URL from a validated ID."""
    return f"https://www.youtube-nocookie.com/embed/{video_id}?rel=0"


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
    """Open a SQLite connection that returns rows addressable by column name."""
    conn = sqlite3.connect(app.config["DATABASE"])
    conn.row_factory = sqlite3.Row
    return conn


def is_valid_password(password):
    """Require 6–16 ASCII letters, digits, or underscores, including a letter and a digit."""
    return re.fullmatch(r"(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9_]{6,16}", password) is not None


def ai_user_directory():
    """Return the signed-in user's persistent AI data directory."""
    return user_save_directory(session.get("user_id"))


def user_save_directory(user_id):
    """Validate a user's storage path and create its standard data folders."""
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
    if not re.fullmatch(r"[A-Za-z0-9_-]{3,64}", username):
        raise ValueError("The signed-in username is not valid for AI storage.")

    user_dir = Path(app.config["SAVE_DATA_DIR"]) / username
    for directory in ("chats", "Schedule", "Settings"):
        (user_dir / directory).mkdir(parents=True, exist_ok=True)
    memory_path = user_dir / "memory"
    if not memory_path.exists():
        write_json_atomically(memory_path, {"explicit_facts": [], "facts": []})
    migrate_database_preferences(user_id, user_dir)
    return user_dir


def profile_picture_mimetype(image_data):
    """Identify supported raster image formats from their file signatures."""
    if (
        image_data.startswith(b"\x89PNG\r\n\x1a\n")
        and len(image_data) >= 33
        and image_data[12:16] == b"IHDR"
    ):
        return "image/png"
    if image_data.startswith(b"\xff\xd8\xff") and image_data.endswith(b"\xff\xd9"):
        return "image/jpeg"
    if (
        len(image_data) >= 30
        and image_data[:4] == b"RIFF"
        and image_data[8:12] == b"WEBP"
        and image_data[12:16] in {b"VP8 ", b"VP8L", b"VP8X"}
    ):
        return "image/webp"
    return None


def user_profile_picture_path(user_id):
    """Return the private profile-image path for an account."""
    return user_save_directory(user_id) / "Settings" / "profile_picture"


def write_json_atomically(path, data):
    """Write JSON through a temporary file so interrupted saves do not corrupt data."""
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
    """Normalize a conversation title and supply a fallback for blank input."""
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return "New conversation"
    return cleaned[:80]


def chat_filename_slug(title):
    """Convert a conversation title into a compact filename-safe slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:60].rstrip("-") or "conversation"


def find_chat_file(user_dir, chat_id):
    """Find the unique saved chat file associated with a validated chat ID."""
    if not isinstance(chat_id, str) or not re.fullmatch(r"[a-f0-9]{32}", chat_id):
        return None
    matches = list((user_dir / "chats").glob(f"*-{chat_id}.json"))
    return matches[0] if len(matches) == 1 else None


def load_user_memory(user_dir):
    """Load and sanitize the bounded personal facts used as AI context."""
    memory_path = user_dir / "memory"
    if not memory_path.exists():
        return {"explicit_facts": [], "facts": []}
    try:
        with memory_path.open("r", encoding="utf-8") as memory_file:
            memory = json.load(memory_file)
    except json.JSONDecodeError as error:
        app.logger.warning(
            "Resetting malformed AI memory file: %s",
            error,
        )
        # A malformed memory file otherwise causes the same warning on every
        # chat request. Recover it to a valid empty memory atomically so the
        # assistant can keep working and future requests stay clean.
        try:
            write_json_atomically(
                memory_path,
                {"explicit_facts": [], "facts": []},
            )
        except OSError as write_error:
            app.logger.warning("Could not reset malformed AI memory file: %s", write_error)
        return {"explicit_facts": [], "facts": []}
    except (OSError, UnicodeError) as error:
        app.logger.warning("Ignoring unreadable AI memory file: %s", error)
        return {"explicit_facts": [], "facts": []}
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
    """Create account/preference tables and seed the development admin account."""
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
    """Copy legacy database preferences to per-user schedule and settings files."""
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
    """Load a user's saved calendar events, defaulting to an empty schedule."""
    schedule_path = user_save_directory(user_id) / "Schedule" / "schedule.json"
    if not schedule_path.exists():
        return []
    with schedule_path.open("r", encoding="utf-8") as schedule_file:
        schedule = json.load(schedule_file)
    if not isinstance(schedule, list):
        raise ValueError("Saved schedule data must be a list.")
    return schedule


def save_user_theme(user_id, theme):
    """Persist the selected appearance theme while preserving other settings."""
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
    """Persist the validated schedule as the user's schedule JSON file."""
    schedule_path = user_save_directory(user_id) / "Schedule" / "schedule.json"
    write_json_atomically(schedule_path, schedule)


def user_song_directory(user_id):
    """Return a private audio directory associated with this account."""
    username = user_save_directory(user_id).name
    song_directory = Path(app.config["USER_SONGS_DIR"]) / username
    song_directory.mkdir(parents=True, exist_ok=True)
    return song_directory


def load_user_songs(user_id):
    """Load the signed-in user's saved audio metadata."""
    songs_path = user_song_directory(user_id) / "songs.json"
    if not songs_path.exists():
        return []
    with songs_path.open("r", encoding="utf-8") as songs_file:
        songs = json.load(songs_file)
    if not isinstance(songs, list) or any(not isinstance(song, dict) for song in songs):
        raise ValueError("Saved song data must be a list of song objects.")
    return songs


def login_required(view):
    """Redirect anonymous requests to login while preserving their destination."""
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if "user_id" in session:
            return view(*args, **kwargs)
        if request.path.startswith("/api/"):
            return jsonify({"error": "Please sign in to continue."}), 401
        return redirect(url_for("login", next=request.path))

    return wrapped_view


# -----------------------------------------------------------------------------
# User preference APIs: theme and calendar data are loaded and saved here.
# -----------------------------------------------------------------------------

@app.route("/api/preferences/theme", methods=["GET", "PUT"])
@login_required
def user_theme_preference():
    """Get or validate and save the signed-in user's appearance theme."""
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
    """Get or validate and save the signed-in user's calendar events."""
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
    """Validate notebook fields, unique IDs, and the selected active notebook."""
    notebooks = data.get("notebooks")
    active_id = data.get("active_id")
    if not isinstance(notebooks, list):
        raise ValueError("Notebooks must be a list.")
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
        legacy_quick_note = notebook.get("quick_note", "")
        whiteboard = notebook.get("whiteboard", {"strokes": []})
        kind = notebook.get("kind", "notes")
        if (
            not isinstance(notebook_id, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,36}", notebook_id)
            or notebook_id in seen_ids
            or not isinstance(name, str)
            or not name.strip()
            or len(name.strip()) > 80
            or not isinstance(content, str)
            or len(content) > 200_000
            or not isinstance(legacy_quick_note, str)
            or len(legacy_quick_note) > 20_000
            or not isinstance(whiteboard, dict)
            or not isinstance(kind, str)
            or kind not in {"notes", "whiteboard"}
            or not isinstance(whiteboard.get("strokes", []), list)
            or len(whiteboard.get("strokes", [])) > 5000
            or len(json.dumps(whiteboard, ensure_ascii=False)) > 1_000_000
        ):
            raise ValueError("A notebook contains invalid fields.")
        seen_ids.add(notebook_id)
        if legacy_quick_note and content.strip() in {"", "<br>", "<p><br></p>", "<div><br></div>"}:
            content = legacy_quick_note
        clean_name = name.strip()
        if clean_name.lower() == "quick notes":
            clean_name = "Notes"
        clean_notebooks.append({
            "id": notebook_id,
            "name": clean_name,
            "content": content,
            "whiteboard": whiteboard,
            "kind": kind,
        })

    if active_id and active_id not in seen_ids:
        raise ValueError("The active notebook could not be found.")
    if not clean_notebooks:
        active_id = ""
    elif not active_id:
        active_id = clean_notebooks[0]["id"]
    return {"notebooks": clean_notebooks, "active_id": active_id}


@app.route("/api/notebooks", methods=["GET", "PUT"])
@login_required
def user_notebooks():
    """Load or validate and persist a user's notebook collection."""
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

            data = {"notebooks": [], "active_id": ""}
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
    """Allow only local redirect targets and otherwise return the home page."""
    if not target:
        return url_for("home")

    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc or not target.startswith("/"):
        return url_for("home")
    return target


def load_resources():
    """Load the bundled study-resource catalog when its JSON file exists."""
    json_path = os.path.join(app.root_path, "data", "resources.json")
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            resources = json.load(f)
    except FileNotFoundError:
        return []
    except (OSError, json.JSONDecodeError):
        app.logger.exception("Could not load the bundled study resource catalog")
        return []

    if not isinstance(resources, list):
        app.logger.error("Study resource catalog must contain a JSON list")
        return []
    return [resource for resource in resources if isinstance(resource, dict)]


# -----------------------------------------------------------------------------
# Authentication flows and public app pages
# -----------------------------------------------------------------------------

@app.route("/login", methods=["GET", "POST"])
def login():
    """Authenticate a user and redirect to their requested local page."""
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
            return redirect(safe_next_url(request.args.get("next")))

        error = "Invalid username or password."

    return render_template("login.html", error=error)


@app.route("/signup", methods=["GET", "POST"])
def signup():
    """Validate a new account, save its password hash, and sign it in."""
    error = None

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        password_confirmation = request.form.get("password_confirmation", "")

        if not 3 <= len(username) <= 64 or not username.replace("_", "").replace("-", "").isalnum():
            error = "Username must be 3-64 letters, numbers, underscores, or hyphens."
        elif not is_valid_password(password):
            error = "Password must be 6–16 characters with at least one letter and one number. Use only letters, numbers, and underscores."
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
    """Append a user message and stream the AI response as newline-delimited JSON."""
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
        graph_data = create_graph_data(message)
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

            if graph_data:
                yield json.dumps({"type": "graph", "graph": graph_data}) + "\n"

            full_response = ""
            for chunk in ask_ai(
                message,
                "",
                conversation_history,
                current_memory,
                conversation_summary=conversation_summary,
                tool_results=tool_results,
            ):
                if chunk.startswith("Error: "):
                    app.logger.error("AI model request failed: %s", chunk[7:])
                    yield json.dumps({
                        "type": "error",
                        "message": "The AI model could not generate a response. Check that Ollama is running and the configured model is installed.",
                    }) + "\n"
                    return
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
                if should_update_user_memory(message):
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
    """Return the signed-in user's saved conversations, newest first."""
    try:
        user_dir = ai_user_directory()
        chats = []
        for chat_path in (user_dir / "chats").glob("*.json"):
            if chat_path.is_symlink() or not chat_path.is_file():
                continue
            try:
                with chat_path.open("r", encoding="utf-8") as chat_file:
                    chat = json.load(chat_file)
            except (OSError, UnicodeError, json.JSONDecodeError) as error:
                app.logger.warning(
                    "Skipping unreadable saved AI conversation %s: %s",
                    chat_path.name,
                    error,
                )
                continue
            if (
                not isinstance(chat, dict)
                or not isinstance(chat.get("id"), str)
                or not isinstance(chat.get("title"), str)
            ):
                app.logger.warning(
                    "Skipping invalid saved AI conversation %s",
                    chat_path.name,
                )
                continue
            updated_at = chat.get("updated_at", "")
            chats.append({
                "id": chat["id"],
                "title": chat["title"],
                "updated_at": updated_at if isinstance(updated_at, str) else "",
            })
        chats.sort(key=lambda chat: chat["updated_at"], reverse=True)
        return jsonify({"chats": chats})
    except (OSError, ValueError, json.JSONDecodeError, KeyError) as error:
        app.logger.exception("Could not list AI chats: %s", error)
        return jsonify({"error": "Could not load saved conversations."}), 500


@app.route("/api/ai/chats/<chat_id>", methods=["GET"])
@login_required
def get_ai_chat(chat_id):
    """Return one saved conversation after restricting lookup to the current user."""
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
    """Validate a new title and atomically move the user's conversation file."""
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
    """Delete one saved conversation belonging to the signed-in user."""
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
    """Render the dashboard and provide page routes for global search indexing."""
    picture_path = user_profile_picture_path(session["user_id"])
    profile_picture_url = None
    if picture_path.is_file():
        profile_picture_url = url_for(
            "profile_picture",
            v=picture_path.stat().st_mtime_ns,
        )
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
        profile_picture_url=profile_picture_url,
        search_routes=search_routes,
    )


@app.route("/profile-picture")
@login_required
def profile_picture():
    """Serve the signed-in user's profile picture without exposing account files."""
    try:
        picture_path = user_profile_picture_path(session["user_id"])
        if not picture_path.is_file():
            return "", 404
        image_data = picture_path.read_bytes()
        image_mimetype = profile_picture_mimetype(image_data)
        if image_mimetype is None:
            return "", 404
        response = send_file(picture_path, mimetype=image_mimetype, conditional=False)
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response
    except (OSError, sqlite3.Error, ValueError):
        app.logger.exception("Could not load profile picture for the signed-in user.")
        return "", 404


@app.route("/appearance", methods=["GET", "POST"])
@app.route("/settings", methods=["GET", "POST"])
@login_required
def settings():
    """Render account settings and process preferences, password, or deletion forms."""
    user_id = session["user_id"]
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    error = None
    success = None

    if request.method == "POST":
        action = request.form.get("action")

        if action == "change_password":
            old_password = request.form.get("old_password", "")
            new_password = request.form.get("new_password", "")
            confirm_password = request.form.get("confirm_password", "")

            if not check_password_hash(user["password_hash"], old_password):
                error = "Incorrect current password."
            elif new_password != confirm_password:
                error = "New passwords do not match."
            elif not is_valid_password(new_password):
                error = "Password must be 6–16 characters with at least one letter and one number. Use only letters, numbers, and underscores."
            else:
                new_hash = generate_password_hash(new_password)
                db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user_id))
                db.commit()
                success = "Password changed successfully!"
                user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

        elif action == "upload_profile_picture":
            if request.content_length and request.content_length > MAX_PROFILE_PICTURE_SIZE + 128 * 1024:
                error = "Profile pictures must be 5 MB or smaller."
            else:
                picture = request.files.get("profile_picture")
                if picture is None or not picture.filename:
                    error = "Choose a JPG, PNG, or WebP image to upload."
                else:
                    image_data = picture.stream.read(MAX_PROFILE_PICTURE_SIZE + 1)
                    if len(image_data) > MAX_PROFILE_PICTURE_SIZE:
                        error = "Profile pictures must be 5 MB or smaller."
                    else:
                        image_mimetype = profile_picture_mimetype(image_data)
                        if image_mimetype is None:
                            error = "Use a valid JPG, PNG, or WebP image."
                        else:
                            temporary_path = None
                            try:
                                picture_path = user_profile_picture_path(user_id)
                                temporary_path = picture_path.with_name(
                                    f".profile_picture.{uuid.uuid4().hex}.tmp"
                                )
                                temporary_path.write_bytes(image_data)
                                os.replace(temporary_path, picture_path)
                                success = "Profile picture updated."
                            except OSError as picture_error:
                                if temporary_path and temporary_path.exists():
                                    temporary_path.unlink()
                                app.logger.exception(
                                    "Could not save profile picture for user %s: %s",
                                    user_id,
                                    picture_error,
                                )
                                error = "Your profile picture could not be saved. Please try again."

        elif action == "remove_profile_picture":
            try:
                user_profile_picture_path(user_id).unlink(missing_ok=True)
                success = "Profile picture removed. Your default avatar is restored."
            except OSError as picture_error:
                app.logger.exception(
                    "Could not remove profile picture for user %s: %s",
                    user_id,
                    picture_error,
                )
                error = "Your profile picture could not be removed. Please try again."

        elif action == "change_username":
            new_username = request.form.get("new_username", "").strip()
            current_password = request.form.get("username_current_password", "")

            if not re.fullmatch(r"[A-Za-z0-9_-]{3,64}", new_username):
                error = "Username must be 3–64 characters using letters, numbers, underscores, or hyphens."
            elif not check_password_hash(user["password_hash"], current_password):
                error = "Enter your current password to change your username."
            elif new_username == user["username"]:
                success = "That is already your username."
            else:
                duplicate = db.execute(
                    "SELECT id FROM users WHERE username = ? AND id != ?",
                    (new_username, user_id),
                ).fetchone()
                if duplicate:
                    error = "That username is already taken. Choose another one."
                else:
                    old_username = user["username"]
                    storage_moves = [
                        (Path(app.config["SAVE_DATA_DIR"]) / old_username,
                         Path(app.config["SAVE_DATA_DIR"]) / new_username),
                        (Path(app.config["USER_SONGS_DIR"]) / old_username,
                         Path(app.config["USER_SONGS_DIR"]) / new_username),
                    ]
                    moved_paths = []
                    try:
                        for old_path, new_path in storage_moves:
                            if new_path.exists():
                                raise FileExistsError(f"Account data already exists for {new_username}.")
                            if old_path.exists():
                                os.replace(old_path, new_path)
                                moved_paths.append((old_path, new_path))

                        db.execute(
                            "UPDATE users SET username = ? WHERE id = ?",
                            (new_username, user_id),
                        )
                        db.commit()
                    except (OSError, sqlite3.IntegrityError) as rename_error:
                        db.rollback()
                        for old_path, new_path in reversed(moved_paths):
                            try:
                                os.replace(new_path, old_path)
                            except OSError:
                                app.logger.exception("Could not restore account storage after username change failed.")
                        if isinstance(rename_error, sqlite3.IntegrityError):
                            error = "That username is already taken. Choose another one."
                        else:
                            app.logger.exception("Could not move account storage for username change.")
                            error = "Your username could not be changed right now. Please try again."
                    else:
                        session["username"] = new_username
                        user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                        success = "Username updated successfully."

        # ACTION 3: DELETE ACCOUNT
        elif action == "delete_account":
            delete_password = request.form.get("delete_password", "")

            if not check_password_hash(user["password_hash"], delete_password):
                error = "Incorrect password. Account deletion canceled."
            else:
                try:
                    user_dir = user_save_directory(user_id)
                    songs_dir = user_song_directory(user_id)
                    if user_dir.exists():
                        shutil.rmtree(user_dir)
                    if songs_dir.exists():
                        shutil.rmtree(songs_dir)
                except (OSError, sqlite3.Error, ValueError) as deletion_error:
                    app.logger.exception(
                        "Could not delete account data for user %s: %s",
                        user_id,
                        deletion_error,
                    )
                    error = "Your account data could not be deleted. Please try again."
                else:
                    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
                    db.commit()
                    db.close()
                    session.clear()
                    return redirect(url_for("login"))

    db.close()
    picture_path = user_profile_picture_path(user_id)
    profile_picture_url = None
    if picture_path.is_file():
        profile_picture_url = url_for(
            "profile_picture",
            v=picture_path.stat().st_mtime_ns,
        )
    return render_template(
        "settings.html",
        username=user["username"],
        profile_picture_url=profile_picture_url,
        error=error,
        success=success,
    )

@app.route("/resources")
@login_required
def resources():
    """Render curated study resources filtered by query and optional web results."""
    query = request.args.get("query", "").strip()
    all_resources = load_resources()
    web_results = search_web(query) if query else []

    if query:
        search_term = query.lower()
        filtered_resources = [
            item for item in all_resources
            if any(
                search_term in value.lower()
                for value in (
                    item.get("title"),
                    item.get("subject"),
                    item.get("description"),
                )
                if isinstance(value, str)
            )
        ]
    else:
        filtered_resources = all_resources

    return render_template(
        "studyResources.html",
        resources=filtered_resources,
        query=query,
        web_results=web_results,
        library_mode=False,
    )

@app.route("/study-tools")
def study_tools():
    return render_template("study_tools.html")

@app.route("/resource-browser")
@login_required
def resource_browser():
    """Render the AI-assisted topic browser."""
    return render_template("resource_browser.html")


@app.route("/translator")
@login_required
def translator():
    """Render the full-page translator workspace."""
    return render_template("translator.html")

@app.route("/flashcards")
@app.route("/flashcard-generator")
@login_required
def flashcard_generator():
    """Render the authenticated flashcard generator workspace."""
    return render_template("flashcard_generator.html")


def flashcard_decks_path():
    return user_save_directory(session.get("user_id")) / "Flashcards" / "decks.json"


def read_flashcard_decks():
    path = flashcard_decks_path()
    if not path.is_file():
        return []
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return data.get("decks", []) if isinstance(data, dict) and isinstance(data.get("decks"), list) else []


@app.route("/flashcard-library")
@login_required
def flashcard_library():
    return render_template("flashcard_library.html")


@app.route("/api/flashcards", methods=["GET", "POST"])
@login_required
def saved_flashcards_api():
    path = flashcard_decks_path()
    try:
        decks = read_flashcard_decks()
        if request.method == "GET":
            return jsonify(decks)
        data = request.get_json(silent=True)
        title = data.get("title", "").strip() if isinstance(data, dict) and isinstance(data.get("title", ""), str) else ""
        cards = data.get("cards") if isinstance(data, dict) else None
        if not isinstance(cards, list) or not 1 <= len(cards) <= 500:
            return jsonify({"error": "A deck must contain between 1 and 500 cards."}), 400
        clean_cards = []
        for card in cards:
            if not isinstance(card, dict):
                return jsonify({"error": "Invalid flashcard."}), 400
            term, definition = card.get("term"), card.get("definition")
            if not isinstance(term, str) or not isinstance(definition, str) or not term.strip() or not definition.strip() or len(term) > 240 or len(definition) > 1200:
                return jsonify({"error": "Each card needs a term and definition."}), 400
            clean_cards.append({"term": term.strip(), "definition": definition.strip()})
        now = datetime.now(timezone.utc).isoformat()
        deck = {"id": uuid.uuid4().hex, "title": title[:60] or "Untitled flashcards", "cards": clean_cards, "created_at": now, "updated_at": now}
        decks.insert(0, deck)
        write_json_atomically(path, {"decks": decks[:500]})
        return jsonify(deck), 201
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not access saved flashcards")
        return jsonify({"error": "Could not save or load flashcards."}), 500


@app.route("/api/flashcards/<deck_id>", methods=["GET", "PUT", "DELETE"])
@login_required
def saved_flashcard_api(deck_id):
    try:
        decks = read_flashcard_decks()
        deck = next((item for item in decks if item.get("id") == deck_id), None)
        if deck is None:
            return jsonify({"error": "Flashcard deck not found."}), 404
        if request.method == "GET":
            return jsonify(deck)
        if request.method == "PUT":
            data = request.get_json(silent=True)
            cards = data.get("cards") if isinstance(data, dict) else None
            title = data.get("title", "").strip() if isinstance(data, dict) and isinstance(data.get("title", ""), str) else ""
            if not isinstance(cards, list) or not 1 <= len(cards) <= 500:
                return jsonify({"error": "A deck must contain between 1 and 500 cards."}), 400
            clean_cards = []
            for card in cards:
                if not isinstance(card, dict):
                    return jsonify({"error": "Invalid flashcard."}), 400
                term, definition = card.get("term"), card.get("definition")
                if not isinstance(term, str) or not isinstance(definition, str) or not term.strip() or not definition.strip() or len(term) > 240 or len(definition) > 1200:
                    return jsonify({"error": "Each card needs a term and definition."}), 400
                clean_cards.append({"term": term.strip(), "definition": definition.strip()})
            deck.update({"title": title[:60] or "Untitled flashcards", "cards": clean_cards, "updated_at": datetime.now(timezone.utc).isoformat()})
            write_json_atomically(flashcard_decks_path(), {"decks": decks})
            folders_dir = get_user_folders_dir()
            if folders_dir:
                for folder_path in folders_dir.iterdir():
                    if folder_path.is_symlink() or not folder_path.is_dir():
                        continue
                    folder = read_folder_data(folder_path)
                    for item in folder["items"]:
                        if isinstance(item, dict) and item.get("kind") == "flashcard_deck" and item.get("deck_id") == deck_id:
                            item["title"] = deck["title"]
                            item["card_count"] = len(deck["cards"])
                    write_folder_data(folder_path, folder)
            return jsonify(deck)
        write_json_atomically(flashcard_decks_path(), {"decks": [item for item in decks if item.get("id") != deck_id]})
        folders_dir = get_user_folders_dir()
        if folders_dir:
            for folder_path in folders_dir.iterdir():
                if folder_path.is_symlink() or not folder_path.is_dir():
                    continue
                folder = read_folder_data(folder_path)
                folder["items"] = [item for item in folder["items"] if not (item.get("kind") == "flashcard_deck" and item.get("deck_id") == deck_id)]
                write_folder_data(folder_path, folder)
        return jsonify({"success": True})
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not delete saved flashcard")
        return jsonify({"error": "Could not delete this deck."}), 500


@app.route("/api/flashcards/<deck_id>/folders/<folder_id>", methods=["POST"])
@login_required
def add_flashcard_to_folder(deck_id, folder_id):
    folder_path = find_saved_folder(folder_id)
    if folder_path is None:
        return jsonify({"error": "Choose a valid folder."}), 404
    try:
        deck = next((item for item in read_flashcard_decks() if item.get("id") == deck_id), None)
        if deck is None:
            return jsonify({"error": "Save the deck before adding it to a folder."}), 404
        folder = read_folder_data(folder_path)
        if not any(item.get("kind") == "flashcard_deck" and item.get("deck_id") == deck_id for item in folder["items"]):
            folder["items"].append({"kind": "flashcard_deck", "storage_id": uuid.uuid4().hex, "deck_id": deck_id, "title": deck["title"], "card_count": len(deck["cards"]), "uploaded_at": datetime.now(timezone.utc).isoformat()})
            write_folder_data(folder_path, folder)
        return jsonify({"success": True, "folder": folder["name"]})
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not add flashcard deck to folder")
        return jsonify({"error": "Could not add this deck to the folder."}), 500


@app.route("/api/flashcards/generate", methods=["POST"])
@login_required
def generate_flashcards_api():
    """Create a flashcard deck from a supported study document."""
    if request.content_length and request.content_length > 11 * 1024 * 1024:
        return jsonify({"error": "Files must be 10 MB or smaller."}), 413

    uploaded_file = request.files.get("file")
    if uploaded_file is None or not uploaded_file.filename:
        return jsonify({"error": "Choose a TXT, PDF, or DOCX file."}), 400

    filename = secure_filename(uploaded_file.filename)
    extension = Path(filename).suffix.lower()
    if extension not in {".txt", ".pdf", ".docx"}:
        return jsonify({"error": "Use a TXT, PDF, or DOCX file."}), 400
    try:
        count = int(request.form.get("count", "20"))
    except (TypeError, ValueError):
        return jsonify({"error": "Choose a valid number of flashcards."}), 400
    if not 1 <= count <= 50:
        return jsonify({"error": "Choose between 1 and 50 flashcards."}), 400

    focus = request.form.get("focus", "mixed")
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as temporary_file:
            temporary_path = Path(temporary_file.name)
            uploaded_file.save(temporary_file)

        from static.flashcard_generator import generate_flashcards

        cards = generate_flashcards(temporary_path, count=count, focus=focus)
        return jsonify({"flashcards": cards})
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        app.logger.exception("Flashcard generation failed")
        return jsonify({
            "error": "Flashcards could not be generated. Check that the AI service is available, then try again."
        }), 503
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


@app.route("/api/resource-browser/search", methods=["POST"])
@login_required
def resource_browser_search():
    """Search the web and generate a study overview for a requested topic."""
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Enter a topic to search."}), 400
    query = data.get("query", "")
    if not isinstance(query, str):
        return jsonify({"error": "Enter a topic to search."}), 400
    query = query.strip()
    if len(query) < 2:
        return jsonify({"error": "Enter at least two characters."}), 400
    if len(query) > 180:
        return jsonify({"error": "Keep the topic under 180 characters."}), 400

    def search_topic(search_query):
        # Keep video search, general web search, and a YouTube-only text fallback
        # in parallel so a failed video index does not leave the page empty.
        search_terms = study_search_terms(search_query)
        with ThreadPoolExecutor(max_workers=3) as search_pool:
            futures = (
                search_pool.submit(search_web, f"{search_terms} learning resources"),
                search_pool.submit(search_educational_videos, search_terms),
                search_pool.submit(search_web, f"site:youtube.com/watch {search_terms} lesson"),
            )
            try:
                web_results = futures[0].result()
            except Exception:
                app.logger.exception("Web resource search failed for %r", search_query)
                web_results = []
            try:
                video_results = futures[1].result()
            except Exception:
                app.logger.exception("Video search failed for %r", search_query)
                video_results = []
            try:
                youtube_pages = futures[2].result()
            except Exception:
                app.logger.exception("YouTube fallback search failed for %r", search_query)
                youtube_pages = []

        seen_video_urls = {str(item.get("url") or "") for item in video_results if isinstance(item, dict)}
        for page in youtube_pages:
            if not isinstance(page, dict):
                continue
            url = str(page.get("url") or "").strip()
            video_id = youtube_video_id(url)
            if not video_id:
                continue
            normalized_url = f"https://www.youtube.com/watch?v={video_id}"
            if normalized_url in seen_video_urls:
                continue
            video_results.append({
                "title": page.get("title") or "YouTube lesson",
                "url": normalized_url,
                "video_id": video_id,
                "thumbnail": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
                "description": page.get("description") or "Open this YouTube lesson to learn more about the topic.",
                "publisher": "YouTube",
            })
            seen_video_urls.add(normalized_url)
            if len(video_results) >= 5:
                break
        return web_results, video_results

    web_results, video_results = search_topic(query)

    def safe_results(results, limit):
        safe = []
        seen_urls = set()
        for result in results:
            if not isinstance(result, dict):
                continue
            url = str(result.get("url") or "").strip()
            try:
                parsed = urlsplit(url)
            except ValueError:
                continue
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or url in seen_urls
            ):
                continue
            title = str(result.get("title") or "").strip()
            if not title:
                continue
            safe.append({
                **result,
                "title": title[:240],
                "url": url,
                "description": str(result.get("description") or "").strip()[:700],
            })
            seen_urls.add(url)
            if len(safe) >= limit:
                break
        return safe

    web_results = safe_results(web_results, 6)
    video_results = safe_results(video_results, 5)
    return jsonify({
        "query": query,
        "web_results": web_results,
        "video_results": video_results,
        "video_search_url": f"https://www.youtube.com/results?search_query={quote_plus(study_search_terms(query) + ' lesson explained')}",
        "web_search_url": f"https://www.google.com/search?q={quote_plus(study_search_terms(query) + ' learning resources')}",
        "search_note": "Descriptions are search-result summaries. Open a source to read its full content." if web_results or video_results else "No search listings were returned. Use the related video search below or try another topic.",
    })


@app.route("/api/resource-browser/summary", methods=["POST"])
@login_required
def resource_browser_summary():
    """Generate the slower local-model overview after search results appear."""
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Enter a topic between 2 and 180 characters."}), 400
    query = data.get("query", "")
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= 180:
        return jsonify({"error": "Enter a topic between 2 and 180 characters."}), 400
    try:
        summary = summarize_study_topic(
            query.strip(),
            data.get("web_results", [])[:6],
            data.get("video_results", [])[:5],
        )
        return jsonify({"summary": summary})
    except Exception:
        app.logger.exception("Could not generate study overview for %r", query)
        return jsonify({"error": "Cypher could not generate the overview right now."}), 503


def _translate_with_google_web(text, source, target):
    """Best-effort use of Google's public web translator without a key."""
    try:
        response = requests.get(
            "https://translate.googleapis.com/translate_a/single",
            params={
                "client": "gtx",
                "sl": "auto" if source == "auto" else source,
                "tl": target,
                "dt": "t",
                "q": text,
            },
            timeout=8,
        )
        response.raise_for_status()
        payload = response.json()
        segments = payload[0] if isinstance(payload, list) and payload else None
        if isinstance(segments, list):
            candidate = "".join(
                segment[0]
                for segment in segments
                if isinstance(segment, list) and segment and isinstance(segment[0], str)
            ).strip()
            return candidate or None
    except (requests.RequestException, ValueError, IndexError, TypeError):
        pass
    return None


@app.route("/api/translate", methods=["POST"])
@login_required
def translate_text():
    """Translate text through the server to avoid browser CORS restrictions."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "A translation request is required."}), 400

    text = data.get("text")
    source = data.get("source")
    target = data.get("target")
    if not isinstance(text, str) or not text.strip():
        return jsonify({"error": "Enter text to translate."}), 400
    if len(text) > 5000:
        return jsonify({"error": "Text must be 5,000 characters or fewer."}), 400

    # Accept standard ISO language codes (and common BCP-47 variants) so adding
    # a UI language never fails solely because a backend allowlist was stale.
    source = source.strip().lower() if isinstance(source, str) else ""
    target = target.strip().lower() if isinstance(target, str) else ""
    language_code = re.compile(r"^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$")
    if source != "auto" and not language_code.fullmatch(source):
        return jsonify({"error": "Choose a source language."}), 400
    if not language_code.fullmatch(target):
        return jsonify({"error": "Choose a target language."}), 400

    # The free web translation endpoint handles a broad set of language pairs.
    # Romanized Hindi needs transliteration first: otherwise "namaste" is often
    # treated as an English loanword and simply copied into the Spanish result.
    source_for_translation = source
    text_for_translation = text
    roman_hindi_words = {
        "namaste", "namaskar", "kaise", "aap", "hain", "hai", "ho", "mera",
        "meri", "naam", "kya", "shukriya", "dhanyavaad", "accha", "achha",
        "theek", "thik", "bahut", "paani", "pani", "kyun", "kyon", "mujhe",
        "tum", "nahi", "nahin", "haan", "ji",
    }
    roman_words = [re.sub(r"[^a-z]", "", word.lower()) for word in text.split()]
    hindi_markers = sum(word in roman_hindi_words for word in roman_words if word)
    likely_roman_hindi = bool(roman_words) and (
        (len(roman_words) == 1 and hindi_markers == 1)
        or (hindi_markers >= 2 and hindi_markers / len(roman_words) >= 0.3)
    )
    if (source == "hi" or (source == "auto" and likely_roman_hindi)) and re.search(r"[a-zA-Z]", text):
        try:
            transliteration_response = requests.get(
                "https://inputtools.google.com/request",
                params={"text": text, "itc": "hi-t-i0-und", "num": 1},
                timeout=5,
            )
            transliteration_response.raise_for_status()
            transliteration_data = transliteration_response.json()
            if isinstance(transliteration_data, list) and transliteration_data[:1] == ["SUCCESS"]:
                for item in transliteration_data[1]:
                    candidates = item[1] if isinstance(item, list) and len(item) > 1 else []
                    if isinstance(candidates, list) and candidates and isinstance(candidates[0], str):
                        text_for_translation = candidates[0]
                        source_for_translation = "hi"
                        break
        except (requests.RequestException, ValueError, IndexError, TypeError):
            # Continue with the original text and the normal provider fallback.
            pass

    # Avoid an unnecessary request (and a provider outage) when no translation
    # is needed. Auto-detect is treated as potentially different.
    if source_for_translation == target:
        return jsonify({"translatedText": text})

    # Use Google's translation engine first for every pair. Hindi transliteration
    # is handled above; MyMemory and LibreTranslate remain availability fallbacks.
    translation = _translate_with_google_web(
        text_for_translation, source_for_translation, target
    )

    try:
        if not isinstance(translation, str):
            response = requests.get(
                "https://api.mymemory.translated.net/get",
                params={
                    "q": text_for_translation,
                    "langpair": f"{'autodetect' if source_for_translation == 'auto' else source_for_translation}|{target}",
                },
                timeout=10,
            )
            response.raise_for_status()
            payload = response.json()
            response_data = payload.get("responseData") if isinstance(payload, dict) else None
            if isinstance(response_data, dict) and str(payload.get("responseStatus")) == "200":
                candidate = response_data.get("translatedText")
                if isinstance(candidate, str) and candidate.strip():
                    translation = candidate
    except (requests.RequestException, ValueError):
        pass

    if not isinstance(translation, str):
        for endpoint in (
            "https://translate.argosopentech.com/translate",
            "https://translate.terraprint.co/translate",
        ):
            try:
                response = requests.post(
                    endpoint,
                    json={
                        "q": text_for_translation,
                        # LibreTranslate uses `auto` for language detection.
                        "source": "auto" if source_for_translation == "auto" else source_for_translation,
                        "target": target,
                        "format": "text",
                    },
                    timeout=10,
                )
                response.raise_for_status()
                payload = response.json()
                candidate = payload.get("translatedText") if isinstance(payload, dict) else None
                if isinstance(candidate, str) and candidate.strip():
                    translation = candidate
                    break
            except (requests.RequestException, ValueError):
                continue

    if not isinstance(translation, str):
        app.logger.error(
            "Translation failed: all providers failed. Source=%s, Target=%s",
            source_for_translation,
            target,
        )
        return jsonify({
            "error": "The translation service is temporarily unavailable."
        }), 502

    return jsonify({
        "translatedText": translation,
        "detectedLanguage": {
            "language": source_for_translation
        } if source_for_translation != "auto" else None
    })




@app.route("/focus")
@login_required
def focus():
    """Render the focus-tools page."""
    return render_template("procrastination_focus.html")


@app.route("/noise-songs")
@login_required
def noise_songs():
    """Render the ambient-noise and music player page."""
    return render_template("noise_songs.html")


@app.route("/api/my-songs", methods=["GET", "POST"])
@login_required
def user_songs():
    """List or save the signed-in user's uploaded songs and direct media links."""
    user_id = session["user_id"]
    request.max_content_length = MAX_USER_SONG_SIZE + 1024 * 1024
    try:
        song_directory = user_song_directory(user_id)
        songs_path = song_directory / "songs.json"
        songs = load_user_songs(user_id)

        if request.method == "GET":
            response_songs = []
            for song in songs:
                song_id = song.get("id")
                title = song.get("title")
                source = song.get("source")
                if not isinstance(song_id, str) or not re.fullmatch(r"[a-f0-9]{32}", song_id):
                    raise ValueError("Saved song identifier is not valid.")
                if not isinstance(title, str) or source not in {"upload", "link"}:
                    raise ValueError("Saved song metadata is not valid.")
                if source == "upload":
                    filename = song.get("filename")
                    if not isinstance(filename, str):
                        raise ValueError("Saved song media filename is not valid.")
                    extension = Path(filename).suffix.lower()
                    if filename != f"{song_id}{extension}":
                        raise ValueError("Saved song media filename is not valid.")
                    audio_url = url_for("user_song_audio", song_id=song_id)
                    media_type = (
                        "video" if extension in USER_SONG_VIDEO_EXTENSIONS else "audio"
                    )
                    embed_url = None
                else:
                    audio_url = song.get("url")
                    if not isinstance(audio_url, str):
                        raise ValueError("Saved song media location is not valid.")
                    video_id = youtube_video_id(audio_url)
                    if video_id:
                        media_type = "youtube"
                        embed_url = youtube_embed_url(video_id)
                    else:
                        extension = Path(urlparse(audio_url).path).suffix.lower()
                        if extension not in USER_SONG_MEDIA_EXTENSIONS:
                            raise ValueError("Saved song media type is not valid.")
                        media_type = (
                            "video" if extension in USER_SONG_VIDEO_EXTENSIONS else "audio"
                        )
                        embed_url = None
                response_song = {
                    "id": song_id,
                    "title": title,
                    "source": source,
                    "audio_url": audio_url,
                    "media_type": media_type,
                }
                if embed_url:
                    response_song["embed_url"] = embed_url
                response_songs.append(response_song)
            return jsonify({"songs": response_songs})

        if len(songs) >= MAX_USER_SONGS:
            return jsonify({"error": f"You can save up to {MAX_USER_SONGS} sounds."}), 400

        title = request.form.get("title", "").strip()
        source = request.form.get("source", "")
        if not title or len(title) > 100:
            return jsonify({"error": "Enter a title between 1 and 100 characters."}), 400

        song = {"id": uuid.uuid4().hex, "title": title, "source": source}
        saved_media_path = None
        if source == "upload":
            audio_file = request.files.get("audio_file")
            if audio_file is None or not audio_file.filename:
                return jsonify({"error": "Choose an audio or video file to upload."}), 400
            extension = Path(audio_file.filename).suffix.lower()
            if extension not in USER_SONG_MEDIA_EXTENSIONS:
                return jsonify({
                    "error": "Use a supported audio file or an MP4, MOV, OGV, or WebM video file."
                }), 400

            saved_media_path = song_directory / f"{song['id']}{extension}"
            temporary_media_path = song_directory / f".{song['id']}.upload"
            audio_file.save(temporary_media_path)
            if temporary_media_path.stat().st_size == 0:
                temporary_media_path.unlink()
                return jsonify({"error": "The selected media file is empty."}), 400
            if temporary_media_path.stat().st_size > MAX_USER_SONG_SIZE:
                temporary_media_path.unlink()
                return jsonify({"error": "Media files must be 25 MB or smaller."}), 400
            os.replace(temporary_media_path, saved_media_path)
            song["filename"] = saved_media_path.name
        elif source == "link":
            audio_url = request.form.get("audio_url", "").strip()
            youtube_id = youtube_video_id(audio_url)
            if not youtube_id:
                try:
                    parsed_url = urlparse(audio_url)
                except ValueError:
                    return jsonify({
                        "error": "Enter a YouTube link or an HTTPS link directly to an audio or video file."
                    }), 400
                if (
                    parsed_url.scheme != "https"
                    or not parsed_url.netloc
                    or Path(parsed_url.path).suffix.lower() not in USER_SONG_MEDIA_EXTENSIONS
                ):
                    return jsonify({
                        "error": "Enter a YouTube link or an HTTPS link directly to an audio or video file."
                    }), 400
            song["url"] = audio_url
        else:
            return jsonify({"error": "Choose an upload or direct media link."}), 400

        songs.append(song)
        try:
            write_json_atomically(songs_path, songs)
        except OSError:
            if saved_media_path and saved_media_path.exists():
                saved_media_path.unlink()
            raise
        song["audio_url"] = (
            url_for("user_song_audio", song_id=song["id"])
            if source == "upload"
            else song["url"]
        )
        if source == "upload":
            media_extension = Path(song["filename"]).suffix.lower()
            song["media_type"] = (
                "video" if media_extension in USER_SONG_VIDEO_EXTENSIONS else "audio"
            )
        elif youtube_id:
            song["media_type"] = "youtube"
            song["embed_url"] = youtube_embed_url(youtube_id)
        else:
            media_extension = Path(urlparse(song["url"]).path).suffix.lower()
            song["media_type"] = (
                "video" if media_extension in USER_SONG_VIDEO_EXTENSIONS else "audio"
            )
        return jsonify({"song": song}), 201
    except RequestEntityTooLarge:
        return jsonify({"error": "Media files must be 25 MB or smaller."}), 413
    except (OSError, sqlite3.Error, json.JSONDecodeError, ValueError) as error:
        app.logger.exception("Could not save or load user songs: %s", error)
        return jsonify({"error": "Could not access your saved sounds."}), 500


@app.route("/api/my-songs/<song_id>/audio")
@login_required
def user_song_audio(song_id):
    """Serve an uploaded audio or video file only to its signed-in owner."""
    if not re.fullmatch(r"[a-f0-9]{32}", song_id):
        return jsonify({"error": "Sound not found."}), 404
    try:
        songs = load_user_songs(session["user_id"])
        song = next(
            (
                item for item in songs
                if item.get("id") == song_id and item.get("source") == "upload"
            ),
            None,
        )
        if song is None:
            return jsonify({"error": "Sound not found."}), 404
        filename = song.get("filename")
        if not isinstance(filename, str):
            raise ValueError("Saved audio filename is not valid.")
        extension = Path(filename).suffix.lower()
        if filename != f"{song_id}{extension}" or extension not in USER_SONG_MEDIA_EXTENSIONS:
            raise ValueError("Saved audio filename is not valid.")
        media_path = user_song_directory(session["user_id"]) / filename
        if not media_path.is_file():
            return jsonify({"error": "Sound file not found."}), 404
        mimetype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        return send_file(media_path, mimetype=mimetype, conditional=True)
    except (OSError, sqlite3.Error, json.JSONDecodeError, ValueError) as error:
        app.logger.exception("Could not serve user audio: %s", error)
        return jsonify({"error": "Could not play this saved sound."}), 500


@app.route("/api/my-songs/<song_id>", methods=["DELETE"])
@login_required
def delete_user_song(song_id):
    """Remove one saved link or uploaded media file owned by the current user."""
    if not re.fullmatch(r"[a-f0-9]{32}", song_id):
        return jsonify({"error": "Sound not found."}), 404
    try:
        songs = load_user_songs(session["user_id"])
        song = next((item for item in songs if item.get("id") == song_id), None)
        if song is None:
            return jsonify({"error": "Sound not found."}), 404

        remaining_songs = [item for item in songs if item.get("id") != song_id]
        song_directory = user_song_directory(session["user_id"])
        write_json_atomically(song_directory / "songs.json", remaining_songs)
        if song.get("source") == "upload":
            filename = song.get("filename")
            if isinstance(filename, str):
                extension = Path(filename).suffix.lower()
            else:
                extension = ""
            if filename == f"{song_id}{extension}" and extension in USER_SONG_MEDIA_EXTENSIONS:
                audio_path = song_directory / filename
                if audio_path.exists():
                    audio_path.unlink()
        return jsonify({"deleted": song_id})
    except (OSError, sqlite3.Error, json.JSONDecodeError, ValueError) as error:
        app.logger.exception("Could not delete user sound: %s", error)
        return jsonify({"error": "Could not delete this saved sound."}), 500


@app.route("/schedule")
@login_required
def schedule():
    """Redirect the legacy schedule endpoint to the time-management page."""
    return redirect(url_for("time_management"))


@app.route("/time-management")
@login_required
def time_management():
    """Render the combined scheduler and study timer page."""
    return render_template("time_management.html")


@app.route("/timeManagement.html")
@login_required
def legacy_time_management():
    """Permanently redirect the old time-management URL to its current route."""
    return redirect("/time-management", code=301)


@app.route("/support")
@login_required
def support():
    """Render the student support resource page."""
    return render_template("support.html", support_topics=SUPPORT_TOPICS)


SUPPORT_TOPICS = [
    {
        "slug": "school-stress",
        "title": "School stress & getting unstuck",
        "summary": "Break down school pressure, make a next-step plan, and ask for support.",
        "intro": "When assignments, tests, activities, or concentration problems pile up, it can feel hard to start. You do not need to solve the whole week at once.",
        "sections": [
            {"title": "Try this right now", "items": ["Write down what is due and when. Circle the next deadline.", "Turn that task into one small action, such as opening the assignment or writing the first sentence.", "Work in a short, manageable block, then take a brief break and decide on the next step."]},
            {"title": "Get help with the workload", "items": ["Tell a teacher what you have finished and where you are stuck; ask what to prioritize.", "If you have missed work across classes, ask a counselor or trusted adult to help you make one catch-up plan.", "Make room for meals, movement, rest, and sleep. If stress keeps affecting daily life, tell a trusted adult or health professional."]},
        ],
        "sources": [("CDC: Improve Your Emotional Well-Being", "https://www.cdc.gov/emotional-well-being/improve-your-emotional-well-being/"), ("CDC: Sleep and Health", "https://www.cdc.gov/healthy-schools/sleep/index.html")],
        "contact_title": "Talk to someone at school",
        "contact_text": "A teacher, school counselor, or trusted adult can help you sort out deadlines and find academic support. Use your school's official website or office to find the right contact.",
    },
    {
        "slug": "mental-health",
        "title": "Anxiety, low mood & grief",
        "summary": "Notice when feelings are getting in the way and find a trusted person to talk to.",
        "intro": "Worry, sadness, irritability, grief, or feeling disconnected can affect sleep, concentration, friendships, and school. These experiences can have many causes; a webpage cannot diagnose them, but support is available.",
        "sections": [
            {"title": "What you can do", "items": ["Tell a trusted adult what has changed and when it started. You can write it down or show them this page if speaking feels hard.", "Ask a parent or guardian, school counselor, nurse, or doctor to help you find a qualified mental health professional.", "If the first person does not listen, keep telling safe adults until someone helps you get support."]},
            {"title": "If you may be in danger", "items": ["If you might hurt yourself or someone else, tell an adult immediately and call emergency services if there is immediate danger.", "In the United States, call or text 988 for the Suicide & Crisis Lifeline. It is free and confidential; call 911 for immediate physical danger."]},
        ],
        "sources": [("NIMH: Teen Depression", "https://www.nimh.nih.gov/health/publications/teen-depression"), ("MedlinePlus: Teen Mental Health", "https://medlineplus.gov/teenmentalhealth.html"), ("988 Suicide & Crisis Lifeline", "https://988lifeline.org/")],
        "contact_title": "Talk or text with a crisis counselor",
        "contact_text": "Call or text 988 in the U.S. if you are in emotional distress or worried about someone else. If there is immediate danger, call 911.",
        "contact_url": "https://988lifeline.org/",
        "contact_label": "Visit 988lifeline.org",
    },
    {
        "slug": "bullying",
        "title": "Bullying & cyberbullying",
        "summary": "Get support, save online evidence, and make a plan to feel safer.",
        "intro": "Bullying can happen at school, on the way home, in group chats, or on social media. If you feel targeted or unsafe, you deserve help even if you are unsure what to call it.",
        "sections": [
            {"title": "If it is happening to you", "items": ["Tell a trusted adult at home or school. Be specific about what happened, where, when, and who was there.", "Ask the adult to help create a plan for safety and follow-up. If the first adult does not help, tell another one.", "For online incidents, save screenshots and dates, do not reply or forward the messages, and block or report the account when safe."]},
            {"title": "If you witness it", "items": ["Do not join in, share hurtful posts, or put yourself in danger trying to intervene.", "Offer support privately to the person targeted and report what you saw to a trusted adult.", "If someone faces immediate physical danger, get an adult and contact emergency services."]},
        ],
        "sources": [("StopBullying.gov: What Teens Can Do", "https://www.stopbullying.gov/resources/teens"), ("StopBullying.gov: Report Cyberbullying", "https://www.stopbullying.gov/cyberbullying/how-to-report")],
        "contact_title": "Report it through your school",
        "contact_text": "A teacher, counselor, principal, or school safety staff member can explain the school's reporting process. Use the school's official website or office contact; reporting rules vary by location.",
    },
    {
        "slug": "friendships-boundaries",
        "title": "Friendships, pressure & boundaries",
        "summary": "Practice saying no, leaving uncomfortable situations, and getting backup.",
        "intro": "It can be hard to disagree with friends, leave a situation, or say no when you worry about being left out. Your comfort and safety matter, even when other people are pushing.",
        "sections": [
            {"title": "A simple boundary plan", "items": ["Decide what you are and are not okay with before you are under pressure.", "Use a short line: “No, I’m not doing that,” “I’m leaving now,” or “Please stop asking.” You do not have to debate your decision.", "Suggest another activity, leave with a friend, or contact a trusted adult for a ride or help."]},
            {"title": "When a relationship feels unsafe", "items": ["Talk with a trusted adult if someone threatens, controls, humiliates, or repeatedly ignores your boundaries.", "For online pressure, pause before sharing personal information or images, and ask an adult you trust for help with reporting or blocking.", "Healthy friends respect a no. If you feel afraid, prioritize getting to a safe place and telling an adult."]},
        ],
        "sources": [("American Academy of Pediatrics: 13-Year Checkup Checklist", "https://www.healthychildren.org/English/ages-stages/Your-Childs-Checkups/Pages/your-checkup-checklist-13-years-old.aspx"), ("CDC: Enhance Student Connectedness", "https://www.cdc.gov/mental-health-action-guide/strategies/enhance-connectedness.html")],
        "contact_title": "Find a trusted adult",
        "contact_text": "A caregiver, school counselor, coach, nurse, or another adult you trust can help you plan what to say and how to stay safe. If one person dismisses you, try another safe adult.",
    },
    {
        "slug": "substance-support",
        "title": "Vaping, alcohol & other substances",
        "summary": "Get clear information and confidential help for yourself or a friend.",
        "intro": "Curiosity, pressure, stress, or trying to fit in can lead young people to try substances. Nicotine is addictive, and most e-cigarettes contain it. If you have used something, asking for help is a strong next step.",
        "sections": [
            {"title": "If you have used or want to quit", "items": ["Talk honestly with a trusted adult, school nurse, or health care professional about what you used and how you feel.", "For vaping, free youth resources include Teen.smokefree.gov and the quitline at 1-800-QUIT-NOW; ask a trusted adult to help you connect.", "If you are worried about privacy or consequences, you can start by asking a health professional what they can keep confidential. Rules vary by location and age."]},
            {"title": "If a friend may be in danger", "items": ["If someone is unconscious, hard to wake, having trouble breathing, or seriously unwell, call emergency services now and stay with them if it is safe.", "Do not leave a person who may be overdosing alone. Tell emergency responders what you know.", "You can ask a trusted adult for support even if you are unsure what happened."]},
        ],
        "sources": [("CDC: Protecting Youth From the Harms of Vaping", "https://www.cdc.gov/tobacco/e-cigarettes/protecting-youth.html"), ("CDC: Resources to Help Youth Quit Vaping", "https://www.cdc.gov/tobacco/e-cigarettes/youth-quitting.html"), ("National Cancer Institute: Smokefree Teen", "https://teen.smokefree.gov/")],
        "contact_title": "Free help to quit vaping",
        "contact_text": "Teen.smokefree.gov offers resources for teens. In the U.S., 1-800-QUIT-NOW connects callers to state quitline support.",
        "contact_url": "https://teen.smokefree.gov/",
        "contact_label": "Visit Teen.smokefree.gov",
    },
    {
        "slug": "sleep-burnout",
        "title": "Sleep, energy & burnout",
        "summary": "Understand teen sleep needs and make a realistic plan for rest and school.",
        "intro": "For ages 13–18, the CDC reports a recommended 8–10 hours of sleep per 24 hours. Ongoing tiredness can make mood, attention, behavior, and learning harder.",
        "sections": [
            {"title": "Small changes to try", "items": ["Keep bedtime and wake time fairly regular when possible.", "Create a wind-down routine and put away schoolwork with enough time to settle before bed.", "Plan homework realistically; ask a teacher, caregiver, or counselor for help if workload repeatedly crowds out sleep."]},
            {"title": "When to ask for help", "items": ["Tell a caregiver or health care provider if sleep problems, exhaustion, or low mood keep affecting your day.", "Ask for help reviewing activities and deadlines if you have no time to rest or recover.", "If you feel hopeless or unsafe, tell a trusted adult right away; in the U.S. you can call or text 988 for crisis support."]},
        ],
        "sources": [("CDC: Sleep and Health", "https://www.cdc.gov/healthy-schools/sleep/index.html"), ("CDC: Improve Your Emotional Well-Being", "https://www.cdc.gov/emotional-well-being/improve-your-emotional-well-being/")],
        "contact_title": "Ask for help adjusting the load",
        "contact_text": "A caregiver, teacher, or counselor can help you review your schedule and connect you with a health professional if sleep or fatigue is affecting you.",
    },
]


@app.route("/support/<topic_slug>")
@login_required
def support_topic(topic_slug):
    """Render one student support topic guide."""
    topic = next((item for item in SUPPORT_TOPICS if item["slug"] == topic_slug), None)
    if topic is None:
        return redirect(url_for("support"))
    return render_template("support_topic.html", topic=topic)


@app.route("/peer-pressure-boundaries")
@login_required
def peer_pressure_boundaries():
    """Render guidance about peer pressure and setting personal boundaries."""
    return render_template("peerPreshAndBoundaries.html")


@app.route("/procrastination-focus")
@login_required
def procrastination_focus():
    """Render the procrastination and focus guidance page."""
    return render_template("procrastination_focus.html")


@app.route("/ai")
@login_required
def ai_help():
    """Render the AI study assistant interface."""
    return render_template("ai.html")


@app.route("/notes")
@login_required
def notes():
    """Render the notebook workspace for the current account."""
    return render_template("notes.html", username=session.get("username", "User"))


init_db()

# static/SaveData/<username>/Folders/<folder-id>/folder.json
FOLDER_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")

def get_user_folders_dir():
    username = session.get("username")

    if (
        not isinstance(username, str)
        or not username.strip()
        or username in {".", ".."}
        or "/" in username
        or "\\" in username
        or "\0" in username
    ):
        return None

    folders_dir = Path(app.config["SAVE_DATA_DIR"]) / username / "Folders"
    folders_dir.mkdir(parents=True, exist_ok=True)

    return folders_dir


def valid_folder_id(folder_id):
    return isinstance(folder_id, str) and FOLDER_ID_PATTERN.fullmatch(folder_id) is not None


def migrate_legacy_saved_folders(folders_dir):
    """Move name-based folders and legacy metadata into the stable ID layout."""
    for old_path in list(folders_dir.iterdir()):
        if old_path.is_symlink() or not old_path.is_dir():
            continue

        folder = read_folder_data(old_path)
        folder_id = folder.get("id")
        if not valid_folder_id(folder_id):
            folder_id = uuid.uuid4().hex
            folder["id"] = folder_id

        folder_path = folders_dir / folder_id
        if old_path != folder_path:
            if folder_path.exists():
                raise ValueError("A saved folder ID conflicts with an existing directory.")
            old_path.rename(folder_path)

        folder["name"] = folder.get("name") or old_path.name
        write_folder_data(folder_path, folder)
        (folder_path / ".folder.json").unlink(missing_ok=True)


def find_saved_folder(folder_id):
    """Find a folder by its stored ID within the signed-in user's directory."""
    if not valid_folder_id(folder_id):
        return None

    folders_dir = get_user_folders_dir()
    if folders_dir is None:
        return None

    folder_path = folders_dir / folder_id
    if (
        folder_path.is_symlink()
        or not folder_path.is_dir()
        or folder_path.resolve().parent != folders_dir.resolve()
    ):
        return None
    return folder_path if read_folder_data(folder_path).get("id") == folder_id else None


def read_folder_data(folder_path):
    metadata_file = folder_path / "folder.json"
    if not metadata_file.is_file():
        metadata_file = folder_path / ".folder.json"

    if metadata_file.is_file():
        with metadata_file.open("r", encoding="utf-8") as file:
            data = json.load(file)

        if (
            isinstance(data, dict)
            and isinstance(data.get("id"), str)
            and isinstance(data.get("items"), list)
        ):
            if not isinstance(data.get("name"), str) or not data["name"].strip():
                data["name"] = folder_path.name
            return data

    return {
        "id": str(uuid.uuid4()),
        "name": folder_path.name,
        "items": []
    }


def write_folder_data(folder_path, folder):
    metadata_file = folder_path / "folder.json"
    write_json_atomically(metadata_file, folder)


@app.route("/api/saved-folders", methods=["GET"])
@login_required
def load_saved_folders():
    try:
        folders_dir = get_user_folders_dir()
        if folders_dir is None:
            return jsonify({"error": "Please sign in to continue."}), 401
        migrate_legacy_saved_folders(folders_dir)
        folders = []

        for folder_path in folders_dir.iterdir():
            if folder_path.is_symlink() or not folder_path.is_dir():
                continue

            folder = read_folder_data(folder_path)
            if folder_path.name != folder.get("id"):
                continue
            folders.append(folder)

        folders.sort(key=lambda folder: folder["name"].casefold())

        return jsonify(folders)

    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not load saved folders")
        return jsonify({"error": "Could not load folders."}), 500


@app.route("/api/saved-folders", methods=["PUT"])
@login_required
def save_saved_folders():
    data = request.get_json(silent=True)

    if not isinstance(data, list) or len(data) > 500:
        return jsonify({"error": "Invalid folder list."}), 400

    seen_ids = set()
    seen_names = set()

    # Validate the full list before modifying directories.
    for folder in data:
        if not isinstance(folder, dict):
            return jsonify({"error": "Invalid folder data."}), 400

        folder_id = folder.get("id")
        name = folder.get("name")
        items = folder.get("items")

        if (
            not valid_folder_id(folder_id)
            or not isinstance(name, str)
            or not name.strip()
            or len(name.strip()) > 100
            or name.strip() in {".", ".."}
            or "/" in name
            or "\\" in name
            or "\0" in name
            or any(ord(char) < 32 for char in name)
            or not isinstance(items, list)
        ):
            return jsonify({"error": "Invalid folder name or data."}), 400

        normalized_name = name.strip().casefold()

        if (
            folder_id in seen_ids
            or normalized_name in seen_names
        ):
            return jsonify({
                "error": "Folder IDs and names must be unique."
            }), 400

        seen_ids.add(folder_id)
        seen_names.add(normalized_name)

    try:
        folders_dir = get_user_folders_dir()
        if folders_dir is None:
            return jsonify({"error": "Please sign in to continue."}), 401
        migrate_legacy_saved_folders(folders_dir)
        existing = {}

        for path in folders_dir.iterdir():
            if not path.is_symlink() and path.is_dir():
                folder = read_folder_data(path)
                existing[folder["id"]] = path

        for folder in data:
            folder_id = folder["id"]
            name = folder["name"].strip()
            old_path = existing.get(folder_id)
            new_path = folders_dir / folder_id

            if old_path is None and new_path.exists():
                return jsonify({"error": "A folder with this ID already exists."}), 409
            if old_path is None and folder["items"]:
                return jsonify({"error": "New folders cannot contain unverified files."}), 400
            stored_items = (
                read_folder_data(old_path)["items"]
                if old_path is not None
                else []
            )
            new_path.mkdir(parents=True, exist_ok=True)
            write_folder_data(new_path, {
                "id": folder_id,
                "name": name,
                "items": stored_items,
            })

        # Remove directories for folders deleted in the interface.
        for folder_id, path in existing.items():
            if folder_id not in seen_ids and path.exists():
                shutil.rmtree(path)

        return jsonify({"success": True})

    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not save folders")
        return jsonify({"error": "Could not save folders."}), 500


@app.route(
    "/api/saved-folders/<folder_id>/items/<item_id>",
    methods=["PATCH"],
)
@login_required
def update_saved_folder_item(folder_id, item_id):
    """Update a folder-specific display name without changing its source."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", item_id):
        return jsonify({"error": "Saved item not found."}), 404

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return jsonify({"error": "Choose a valid item update."}), 400

    updates = {}
    if "custom_title" in data:
        custom_title = data["custom_title"]
        if (
            not isinstance(custom_title, str)
            or not custom_title.strip()
            or len(custom_title.strip()) > 240
            or any(ord(char) < 32 for char in custom_title)
        ):
            return jsonify({"error": "Item names must be 1 to 240 characters."}), 400
        updates["custom_title"] = custom_title.strip()

    if not updates or set(data) != set(updates):
        return jsonify({"error": "Choose a valid item update."}), 400

    try:
        folder_path = find_saved_folder(folder_id)
        if folder_path is None:
            return jsonify({"error": "Folder not found."}), 404

        folder = read_folder_data(folder_path)
        item = next(
            (
                candidate for candidate in folder["items"]
                if isinstance(candidate, dict)
                and any(
                    candidate.get(key) == item_id
                    for key in ("storage_id", "file_id", "notebook_id")
                )
            ),
            None,
        )
        if item is None:
            return jsonify({"error": "Saved item not found."}), 404

        item.update(updates)
        write_folder_data(folder_path, folder)
        return jsonify({"item": item})
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not update a saved folder item")
        return jsonify({"error": "Could not update this saved item."}), 500


@app.route(
    "/api/saved-folders/<folder_id>/items/<item_id>",
    methods=["DELETE"],
)
@login_required
def remove_saved_folder_item(folder_id, item_id):
    """Remove an item from a folder without deleting linked notes or whiteboards."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", item_id):
        return jsonify({"error": "Saved item not found."}), 404

    try:
        folder_path = find_saved_folder(folder_id)
        if folder_path is None:
            return jsonify({"error": "Folder not found."}), 404

        folder = read_folder_data(folder_path)
        item_index = next(
            (
                index for index, candidate in enumerate(folder["items"])
                if isinstance(candidate, dict)
                and any(
                    candidate.get(key) == item_id
                    for key in ("storage_id", "file_id", "notebook_id")
                )
            ),
            None,
        )
        if item_index is None:
            return jsonify({"error": "Saved item not found."}), 404

        item = folder["items"].pop(item_index)
        write_folder_data(folder_path, folder)

        if item.get("kind") == "file":
            filename = item.get("filename")
            file_id = item.get("file_id")
            if (
                isinstance(filename, str)
                and isinstance(file_id, str)
                and item.get("storage_id", file_id) == file_id
                and Path(filename).name == filename
                and (
                    filename == file_id
                    or filename.startswith(f"{file_id}.")
                )
            ):
                file_path = folder_path / filename
                if file_path.resolve().parent == folder_path.resolve():
                    file_path.unlink(missing_ok=True)

        return jsonify({"success": True})
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not remove an item from a saved folder")
        return jsonify({"error": "Could not remove this saved item."}), 500


@app.route("/api/saved-folders/<folder_id>/files", methods=["POST"])
@login_required
def upload_saved_folder_file(folder_id):
    """Save one uploaded study file inside an owned folder."""
    try:
        folder_path = find_saved_folder(folder_id)
        if folder_path is None:
            return jsonify({"error": "Folder not found."}), 404

        if (
            request.content_length
            and request.content_length > MAX_STUDY_FILE_SIZE + 1024 * 1024
        ):
            return jsonify({"error": "Files must be 25 MB or smaller."}), 413

        uploaded_file = request.files.get("file")
        if uploaded_file is None or not uploaded_file.filename:
            return jsonify({"error": "Choose a file to upload."}), 400

        display_name = secure_filename(uploaded_file.filename)
        if not display_name:
            return jsonify({"error": "Choose a file with a valid filename."}), 400

        folder = read_folder_data(folder_path)
        file_id = uuid.uuid4().hex
        extension = Path(display_name).suffix.lower()
        stored_name = f"{file_id}{extension}"
        temporary_path = folder_path / f".{file_id}.upload"
        saved_path = folder_path / stored_name

        file_item = {
            "kind": "file",
            "storage_id": file_id,
            "file_id": file_id,
            "title": display_name,
            "original_filename": display_name,
            "filename": stored_name,
            "file_type": mimetypes.guess_type(display_name)[0] or "application/octet-stream",
            "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        try:
            uploaded_file.save(temporary_path)
            file_size = temporary_path.stat().st_size
            if file_size == 0:
                temporary_path.unlink()
                return jsonify({"error": "The selected file is empty."}), 400
            if file_size > MAX_STUDY_FILE_SIZE:
                temporary_path.unlink()
                return jsonify({"error": "Files must be 25 MB or smaller."}), 413
            os.replace(temporary_path, saved_path)
        except OSError:
            temporary_path.unlink(missing_ok=True)
            raise

        folder["items"].append(file_item)
        try:
            write_folder_data(folder_path, folder)
        except OSError:
            saved_path.unlink(missing_ok=True)
            raise

        return jsonify({
            "file": file_item,
            "url": url_for(
                "serve_saved_folder_file",
                folder_id=folder_id,
                file_id=file_id,
            ),
        }), 201
    except RequestEntityTooLarge:
        return jsonify({"error": "Files must be 25 MB or smaller."}), 413
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not save a study file")
        return jsonify({"error": "Could not save the uploaded file."}), 500


@app.route(
    "/api/saved-folders/<folder_id>/whiteboards",
    defaults={"notebook_kind": "whiteboard"},
    methods=["POST"],
)
@app.route(
    "/api/saved-folders/<folder_id>/notes",
    defaults={"notebook_kind": "notes"},
    methods=["POST"],
)
@login_required
def create_saved_folder_notebook(folder_id, notebook_kind):
    """Create a note or whiteboard and add a link to it in the selected folder."""
    try:
        folder_path = find_saved_folder(folder_id)
        if folder_path is None:
            return jsonify({"error": "Folder not found."}), 404

        user_dir = user_save_directory(session["user_id"])
        notebooks_path = user_dir / "Notebooks" / "notebooks.json"
        if notebooks_path.exists():
            with notebooks_path.open("r", encoding="utf-8") as file:
                saved_notebooks = json.load(file)
            if not isinstance(saved_notebooks, dict):
                raise ValueError("Saved notebooks must be an object.")
            notebook_data = clean_notebook_data(saved_notebooks)
        else:
            notebook_data = {"notebooks": [], "active_id": ""}

        notebook_id = uuid.uuid4().hex
        name = "Untitled whiteboard" if notebook_kind == "whiteboard" else "Untitled note"
        notebook = {
            "id": notebook_id,
            "name": name,
            "content": "",
            "whiteboard": {"strokes": []},
            "kind": notebook_kind,
        }
        notebook_data["notebooks"].append(notebook)
        notebook_data["active_id"] = notebook_id
        write_json_atomically(notebooks_path, notebook_data)

        folder = read_folder_data(folder_path)
        item = {
            "kind": notebook_kind,
            "notebook_id": notebook_id,
            "title": name,
            "file_type": notebook_kind,
            "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        folder["items"].append(item)
        write_folder_data(folder_path, folder)
        return jsonify({"item": item, "notebook": notebook}), 201
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not create a note or whiteboard in a folder")
        label = "whiteboard" if notebook_kind == "whiteboard" else "note"
        return jsonify({"error": f"Could not create the {label}."}), 500


@app.route("/api/saved-folders/<folder_id>/notebooks", methods=["POST"])
@login_required
def add_saved_folder_notebook(folder_id):
    """Link an existing note or whiteboard to a folder without copying it."""
    try:
        folder_path = find_saved_folder(folder_id)
        if folder_path is None:
            return jsonify({"error": "Folder not found."}), 404

        data = request.get_json(silent=True)
        notebook_id = data.get("notebook_id") if isinstance(data, dict) else None
        if (
            not isinstance(notebook_id, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,36}", notebook_id)
        ):
            return jsonify({"error": "Choose a valid note or whiteboard."}), 400

        notebooks_path = (
            user_save_directory(session["user_id"])
            / "Notebooks"
            / "notebooks.json"
        )
        if not notebooks_path.is_file():
            return jsonify({"error": "Note or whiteboard not found."}), 404
        with notebooks_path.open("r", encoding="utf-8") as file:
            saved_notebooks = json.load(file)
        if not isinstance(saved_notebooks, dict):
            raise ValueError("Saved notebooks must be an object.")
        notebook_data = clean_notebook_data(saved_notebooks)
        notebook = next(
            (
                item for item in notebook_data["notebooks"]
                if item["id"] == notebook_id
            ),
            None,
        )
        if notebook is None:
            return jsonify({"error": "Note or whiteboard not found."}), 404

        folder = read_folder_data(folder_path)
        existing_item = next(
            (
                item for item in folder["items"]
                if isinstance(item, dict)
                and item.get("notebook_id") == notebook_id
            ),
            None,
        )
        if existing_item is not None:
            return jsonify({"item": existing_item}), 200

        item = {
            "kind": "notebook",
            "notebook_id": notebook["id"],
            "title": notebook["name"],
            "file_type": notebook["kind"],
            "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        folder["items"].append(item)
        write_folder_data(folder_path, folder)
        return jsonify({"item": item}), 201
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not link a notebook to a saved folder")
        return jsonify({"error": "Could not add this note or whiteboard."}), 500


@app.route("/api/saved-folders/<folder_id>/web-resources", methods=["POST"])
@login_required
def save_saved_web_resource(folder_id):
    """Save a public search-result link without fetching its URL server-side."""
    try:
        folder_path = find_saved_folder(folder_id)
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not locate the web resource folder")
        return jsonify({"error": "Could not access this folder."}), 500
    if folder_path is None:
        return jsonify({"error": "Folder not found."}), 404

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Choose a web resource to save."}), 400

    title = data.get("title")
    url = data.get("url")
    resource_type = data.get("file_type", "web link")
    if (
        not isinstance(title, str)
        or not title.strip()
        or len(title.strip()) > 240
        or not isinstance(url, str)
        or not url.strip()
        or len(url.strip()) > 2048
        or not isinstance(resource_type, str)
        or resource_type not in {"web link", "video link"}
    ):
        return jsonify({"error": "The web resource details are invalid."}), 400

    try:
        parsed_url = urlsplit(url.strip())
    except ValueError:
        return jsonify({"error": "The web resource URL is invalid."}), 400
    if (
        parsed_url.scheme not in {"http", "https"}
        or not parsed_url.hostname
        or parsed_url.username
        or parsed_url.password
    ):
        return jsonify({"error": "Only public HTTP or HTTPS links can be saved."}), 400

    try:
        folder = read_folder_data(folder_path)
        resource_id = uuid.uuid4().hex
        item = {
            "kind": "web",
            "storage_id": resource_id,
            "title": title.strip(),
            "filename": title.strip(),
            "url": url.strip(),
            "file_type": resource_type,
            "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        folder["items"].append(item)
        write_folder_data(folder_path, folder)
        return jsonify({"item": item}), 201
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not save a web resource")
        return jsonify({"error": "Could not save this web resource."}), 500


@app.route("/api/saved-folders/<folder_id>/files/<file_id>")
@login_required
def serve_saved_folder_file(folder_id, file_id):
    """View or download an uploaded file from the signed-in user's folder."""
    if not re.fullmatch(r"[a-f0-9]{32}", file_id):
        return jsonify({"error": "File not found."}), 404

    try:
        folder_path = find_saved_folder(folder_id)
        if folder_path is None:
            return jsonify({"error": "File not found."}), 404

        folder = read_folder_data(folder_path)
        file_item = next(
            (
                item for item in folder["items"]
                if isinstance(item, dict)
                and item.get("kind") == "file"
                and item.get("file_id") == file_id
            ),
            None,
        )
        if file_item is None:
            return jsonify({"error": "File not found."}), 404

        filename = file_item.get("filename")
        title = file_item.get("title")
        storage_id = file_item.get("storage_id", file_id)
        if (
            not isinstance(filename, str)
            or not isinstance(title, str)
            or storage_id != file_id
            or Path(filename).name != filename
            or not filename.startswith(f"{file_id}.")
            and filename != file_id
        ):
            raise ValueError("Saved study file metadata is invalid.")

        file_path = folder_path / filename
        if not file_path.is_file() or file_path.resolve().parent != folder_path.resolve():
            return jsonify({"error": "File not found."}), 404

        mimetype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        inline_extensions = {
            ".gif", ".jpeg", ".jpg", ".mp3", ".mp4", ".ogg", ".pdf",
            ".png", ".txt", ".wav", ".webm", ".webp",
        }
        response = send_file(
            file_path,
            mimetype=mimetype,
            as_attachment=(
                request.args.get("download") == "1"
                or Path(filename).suffix.lower() not in inline_extensions
            ),
            download_name=title,
            conditional=True,
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response
    except (OSError, ValueError, json.JSONDecodeError):
        app.logger.exception("Could not serve a saved study file")
        return jsonify({"error": "Could not open the saved file."}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=False)
