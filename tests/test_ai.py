import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from app import app, init_db
from static.ai import (
    ask_ai,
    conversational_reply,
    find_resources,
    should_recommend_resources,
    update_user_memory,
)


class StudyAssistantTests(unittest.TestCase):
    def test_greetings_goodbyes_and_personal_questions_get_conversational_replies(self):
        self.assertIn("Hi!", conversational_reply("Hello there!"))
        self.assertIn("Goodbye!", conversational_reply("See you later!"))
        self.assertIn("AI study assistant", conversational_reply("Who are you?"))
        self.assertIn("don't have feelings", conversational_reply("Do you have feelings?"))
        self.assertIn("don't have personal experiences", conversational_reply("What's your favorite color?"))
        self.assertIsNone(conversational_reply("Explain photosynthesis."))

    def test_resource_recommendations_are_limited_to_resource_or_learning_requests(self):
        self.assertTrue(should_recommend_resources("Can you recommend some videos?"))
        self.assertTrue(should_recommend_resources("Do you have websites about algebra?"))
        self.assertTrue(should_recommend_resources("Explain how photosynthesis works."))
        self.assertTrue(should_recommend_resources("Why do seasons change?"))
        self.assertTrue(should_recommend_resources("Search the web for recent climate research."))
        self.assertTrue(should_recommend_resources("Search for information on recent climate research."))
        self.assertTrue(should_recommend_resources("What are the latest space discoveries?"))
        self.assertFalse(should_recommend_resources("Hi, how are you?"))
        self.assertFalse(should_recommend_resources("Who are you?"))
        self.assertFalse(should_recommend_resources("Thanks!"))

    def test_casual_replies_do_not_call_the_language_model(self):
        with patch("static.ai.ollama.chat") as ollama_chat:
            self.assertEqual(
                list(ask_ai("Goodbye!")),
                ["Goodbye! Good luck with your studies, and come back whenever you need help."],
            )

        ollama_chat.assert_not_called()

    def test_question_and_role_aware_history_are_passed_to_the_model(self):
        response_chunk = {"message": {"content": "Photosynthesis converts light into chemical energy."}}
        history = [
            {"role": "user", "content": "What is a plant?"},
            {"role": "assistant", "content": "A plant is a living organism."},
        ]
        with patch("static.ai.ollama.chat", return_value=[response_chunk]) as ollama_chat:
            self.assertEqual(
                list(ask_ai(
                    "Explain photosynthesis.",
                    "Type: Video\nTitle: Photosynthesis basics\nURL: https://example.com",
                    history,
                )),
                ["Photosynthesis converts light into chemical energy."],
            )

        messages = ollama_chat.call_args.kwargs["messages"]
        self.assertEqual(messages[1:3], history)
        self.assertEqual(messages[-1], {
            "role": "user",
            "content": "Explain photosynthesis.",
        })
        self.assertIn("Web research:", messages[0]["content"])
        self.assertIn("Default to a short, direct answer", messages[0]["content"])
        self.assertIn("Never add filler", messages[0]["content"])

    def test_saved_user_memory_is_available_in_the_system_prompt(self):
        response_chunk = {"message": {"content": "Let's practice algebra."}}
        with patch("static.ai.ollama.chat", return_value=[response_chunk]) as ollama_chat:
            list(ask_ai(
                "Can you help me practice?",
                user_memory={
                    "explicit_facts": ["I am studying algebra."],
                    "facts": ["The user often asks about algebra."],
                },
            ))

        system_prompt = ollama_chat.call_args.kwargs["messages"][0]["content"]
        self.assertIn("I am studying algebra.", system_prompt)
        self.assertIn("prioritize these over inferred context", system_prompt)
        self.assertIn("The user often asks about algebra.", system_prompt)

    def test_update_user_memory_keeps_only_bounded_string_facts(self):
        response = {
            "message": {
                "content": json.dumps({
                    "explicit_facts": [
                        "I am studying algebra.",
                        "I prefer diagrams.",
                        "I am studying algebra.",
                        123,
                    ] + ["direct fact"] * 15,
                    "facts": [
                        "Prefers visual explanations.",
                        "Studying algebra.",
                        "Studying algebra.",
                        123,
                    ] + ["fact"] * 15,
                })
            }
        }
        with patch("static.ai.ollama.chat", return_value=response) as ollama_chat:
            memory = update_user_memory(
                {"facts": ["Previous fact"]},
                "I am studying algebra and like diagrams.",
            )

        self.assertLessEqual(len(memory["facts"]), 12)
        self.assertLessEqual(len(memory["explicit_facts"]), 12)
        self.assertEqual(memory["explicit_facts"][:2], [
            "I am studying algebra.",
            "I prefer diagrams.",
        ])
        self.assertEqual(memory["facts"][:2], [
            "Prefers visual explanations.",
            "Studying algebra.",
        ])
        prompt = ollama_chat.call_args.kwargs["messages"][0]["content"]
        self.assertIn("Do not store sensitive traits", prompt)
        self.assertIn("direct statements", prompt)
        supplied_content = ollama_chat.call_args.kwargs["messages"][1]["content"]
        self.assertNotIn("assistant_response", supplied_content)

    def test_find_resources_returns_video_and_relevant_articles(self):
        video = {
            "title": "Photosynthesis explained",
            "description": "A video about photosynthesis.",
            "content": "https://example.com/video",
            "images": {"medium": "https://example.com/image.jpg"},
        }
        web_results = [
            {"title": "Photosynthesis guide", "url": "https://example.com/guide", "description": "A guide."},
            {"title": "Another resource", "url": "https://example.com/other.pdf", "description": "More notes."},
            {"title": "Plant biology", "url": "https://example.com/biology", "description": "Biology notes."},
        ]

        with patch("static.ai.DDGS") as ddgs, patch(
            "static.ai.search_web",
            return_value=web_results,
        ):
            ddgs.return_value.videos.return_value = [video]
            resources = find_resources("Explain photosynthesis.")

        self.assertEqual(len(resources), 3)
        self.assertEqual([resource["type"] for resource in resources], [
            "Video",
            "Article",
            "Document",
        ])
        self.assertEqual(resources[0]["url"], video["content"])
        self.assertEqual(resources[0]["image"], video["images"]["medium"])

    def test_explicit_web_search_uses_the_requested_query_without_video_search(self):
        web_results = [{
            "title": "Recent climate research",
            "url": "https://example.com/climate",
            "description": "A recent research summary.",
        }]

        with patch("static.ai.DDGS") as ddgs, patch(
            "static.ai.search_web",
            return_value=web_results,
        ) as search_web:
            resources = find_resources("Search the web for the recent climate research.")

        ddgs.return_value.videos.assert_not_called()
        search_web.assert_called_once_with("recent climate research")
        self.assertEqual(resources[0]["title"], "Recent climate research")

    def test_explicit_search_retries_without_time_sensitive_terms_when_needed(self):
        web_results = [{
            "title": "NASA Artemis mission",
            "url": "https://example.com/artemis",
            "description": "Mission update.",
        }]

        with patch("static.ai.DDGS") as ddgs, patch(
            "static.ai.search_web",
            side_effect=[[], web_results],
        ) as search_web:
            resources = find_resources(
                "Search the web for the latest NASA Artemis mission update."
            )

        ddgs.return_value.videos.assert_not_called()
        self.assertEqual(
            [call.args[0] for call in search_web.call_args_list],
            [
                "latest NASA Artemis mission update",
                "NASA Artemis mission update",
            ],
        )
        self.assertEqual(resources[0]["title"], "NASA Artemis mission")

    def test_search_for_information_extracts_a_useful_search_query(self):
        web_results = [{
            "title": "Climate research",
            "url": "https://example.com/climate",
            "description": "A research summary.",
        }]

        with patch("static.ai.DDGS") as ddgs, patch(
            "static.ai.search_web",
            return_value=web_results,
        ) as search_web:
            resources = find_resources("Search for information on climate research.")

        ddgs.return_value.videos.assert_not_called()
        search_web.assert_called_once_with("climate research")
        self.assertEqual(resources[0]["title"], "Climate research")

    def test_greetings_do_not_search_for_resources(self):
        with patch("static.ai.DDGS") as ddgs, patch("static.ai.search_web") as search_web:
            self.assertEqual(find_resources("Hi!"), [])

        ddgs.assert_not_called()
        search_web.assert_not_called()


class StudyAssistantApiTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.temp_dir = tempfile.TemporaryDirectory()
        self.previous_save_dir = app.config["SAVE_DATA_DIR"]
        self.previous_database = app.config["DATABASE"]
        app.config["SAVE_DATA_DIR"] = self.temp_dir.name
        app.config["DATABASE"] = str(Path(self.temp_dir.name) / "studytool.db")
        self.addCleanup(self.temp_dir.cleanup)
        self.addCleanup(
            lambda: app.config.__setitem__("SAVE_DATA_DIR", self.previous_save_dir)
        )
        self.addCleanup(
            lambda: app.config.__setitem__("DATABASE", self.previous_database)
        )
        init_db()
        self.client = app.test_client()
        with self.client.session_transaction() as user_session:
            user_session["user_id"] = 1
            user_session["username"] = "admin"
        self.memory_update_patch = patch(
            "app.update_user_memory",
            side_effect=lambda memory, _: memory,
        )
        self.memory_update_patch.start()
        self.addCleanup(self.memory_update_patch.stop)

    def create_saved_chat(self, messages, title="Earlier conversation"):
        chat_id = uuid.uuid4().hex
        chats_dir = Path(self.temp_dir.name) / "admin" / "chats"
        chats_dir.mkdir(parents=True, exist_ok=True)
        chat_path = chats_dir / f"earlier-conversation-{chat_id}.json"
        chat_path.write_text(
            json.dumps({
                "id": chat_id,
                "title": title,
                "created_at": "2026-10-03T00:00:00+00:00",
                "updated_at": "2026-10-03T00:00:00+00:00",
                "messages": messages,
            }),
            encoding="utf-8",
        )
        return chat_id, chat_path

    def test_sammy_chat_dropdown_is_only_on_requested_pages(self):
        for endpoint, path, expected in (
            ("home", "/", True),
            ("resources", "/resources", True),
            ("noise_songs", "/noise-songs", True),
            ("time_management", "/time-management", True),
            ("support", "/support", True),
            ("ai_help", "/ai", True),
            ("focus", "/focus", False),
            ("settings", "/settings", False),
            ("appearance", "/appearance", False),
        ):
            with self.subTest(endpoint=endpoint):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                if expected:
                    self.assertIn("Sammy".encode(), response.data)
                    self.assertIn(b'id="ai-chat-dropdown"', response.data)
                    self.assertIn(b'aria-controls="ai-chat-dropdown"', response.data)
                    if endpoint == "time_management":
                        self.assertIn(b"ai_chats.js", response.data)
                    self.assertIn(
                        b'class="ai-nav-row active"' if endpoint == "ai_help"
                        else b'class="ai-nav-row"',
                        response.data,
                    )
                    if endpoint != "ai_help":
                        self.assertNotIn(b'class="ai-nav-row active"', response.data)
                else:
                    self.assertNotIn("Sammy".encode(), response.data)
                    self.assertNotIn(b'id="ai-chat-dropdown"', response.data)

    def test_noise_and_time_management_hide_main_page_back_link(self):
        for path in ("/noise-songs", "/time-management"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn(b"Go back to main page", response.data)

    def test_theme_preference_is_saved_per_account(self):
        response = self.client.get("/api/preferences/theme")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json["theme"])

        response = self.client.put(
            "/api/preferences/theme",
            json={"theme": "dark-jade"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["theme"], "dark-jade")
        self.assertEqual(
            self.client.get("/api/preferences/theme").json["theme"],
            "dark-jade",
        )
        settings_file = Path(self.temp_dir.name) / "admin" / "Settings" / "settings.json"
        self.assertEqual(
            json.loads(settings_file.read_text(encoding="utf-8")),
            {"appearance": {"theme": "dark-jade"}},
        )

        conn = sqlite3.connect(app.config["DATABASE"])
        conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            ("student2", "not-used"),
        )
        conn.commit()
        second_user_id = conn.execute(
            "SELECT id FROM users WHERE username = ?",
            ("student2",),
        ).fetchone()[0]
        conn.close()

        second_client = app.test_client()
        with second_client.session_transaction() as user_session:
            user_session["user_id"] = second_user_id
            user_session["username"] = "student2"
        self.assertIsNone(second_client.get("/api/preferences/theme").json["theme"])
        invalid = second_client.put(
            "/api/preferences/theme",
            json={"theme": "not-a-theme"},
        )
        self.assertEqual(invalid.status_code, 400)

    def test_schedule_preference_persists_validated_events_per_account(self):
        event = {
            "id": str(uuid.uuid4()),
            "title": "Biology homework",
            "type": "homework",
            "date": "2026-10-05",
            "time": "14:30",
            "end_time": "16:00",
            "done": False,
        }
        response = self.client.put(
            "/api/preferences/schedule",
            json={"events": [event]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["events"], [event])
        schedule_file = Path(self.temp_dir.name) / "admin" / "Schedule" / "schedule.json"
        self.assertEqual(
            json.loads(schedule_file.read_text(encoding="utf-8")),
            [event],
        )
        self.assertEqual(
            self.client.get("/api/preferences/schedule").json["events"],
            [event],
        )
        invalid_end_time = {
            **event,
            "id": str(uuid.uuid4()),
            "time": "14:30",
            "end_time": "14:30",
        }
        invalid_end = self.client.put(
            "/api/preferences/schedule",
            json={"events": [invalid_end_time]},
        )
        self.assertEqual(invalid_end.status_code, 400)
        self.assertIn(b"end time must follow", invalid_end.data)

        legacy_duration = {
            key: value for key, value in event.items() if key != "end_time"
        }
        legacy_duration["duration_minutes"] = 90
        migrated = self.client.put(
            "/api/preferences/schedule",
            json={"events": [legacy_duration]},
        )
        self.assertEqual(migrated.status_code, 200)
        self.assertEqual(migrated.json["events"][0]["end_time"], "16:00")

        conn = sqlite3.connect(app.config["DATABASE"])
        conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            ("student3", "not-used"),
        )
        conn.commit()
        second_user_id = conn.execute(
            "SELECT id FROM users WHERE username = ?",
            ("student3",),
        ).fetchone()[0]
        conn.close()
        second_client = app.test_client()
        with second_client.session_transaction() as user_session:
            user_session["user_id"] = second_user_id
            user_session["username"] = "student3"
        self.assertEqual(
            second_client.get("/api/preferences/schedule").json["events"],
            [],
        )

        invalid_event = {**event, "date": "not-a-date"}
        invalid = self.client.put(
            "/api/preferences/schedule",
            json={"events": [invalid_event]},
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(
            self.client.get("/api/preferences/schedule").json["events"],
            [migrated.json["events"][0]],
        )

    def test_user_save_data_creates_schedule_and_settings_folders(self):
        response = self.client.get("/api/ai/chats")
        user_dir = Path(self.temp_dir.name) / "admin"

        self.assertEqual(response.status_code, 200)
        self.assertTrue((user_dir / "memory").exists())
        self.assertTrue((user_dir / "chats").is_dir())
        self.assertTrue((user_dir / "Schedule").is_dir())
        self.assertTrue((user_dir / "Settings").is_dir())

    def test_time_management_renders_weekly_hour_calendar_and_editor(self):
        response = self.client.get("/time-management")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="weekly-grid"', response.data)
        self.assertIn(b'class="weekly-grid-frame"', response.data)
        self.assertNotIn(b"weekly-grid-scroll", response.data)
        self.assertEqual(response.data.count(b'class="weekly-day-column"'), 7)
        self.assertIn(b'id="calendar-previous"', response.data)
        self.assertIn(b'id="calendar-next"', response.data)
        self.assertIn(b'id="planner-dialog"', response.data)
        self.assertIn(b'id="date-picker-days"', response.data)
        for value in (b'value="to-do"', b'value="homework"', b'value="event"', b'value="exam"', b'value="rest"'):
            self.assertIn(value, response.data)
        self.assertNotIn(b"24:00", response.data)
        self.assertIn(b'if (hour !== 0)', response.data)
        self.assertIn(b'className = "current-time-indicator"', response.data)
        self.assertIn(b'setInterval(renderCurrentTimeIndicator, 30000)', response.data)
        self.assertNotIn(b"Schedule &amp; To-Dos", response.data)
        self.assertNotIn(b"Upcoming Deadlines", response.data)
        self.assertNotIn(b'planner-duration', response.data)
        self.assertIn(b'id="planner-end-time"', response.data)
        self.assertIn(b'id="planner-dialog-delete"', response.data)

    def test_database_preferences_migrate_to_user_save_data_files(self):
        conn = sqlite3.connect(app.config["DATABASE"])
        conn.execute(
            """
            INSERT INTO user_preferences (user_id, theme, schedule_json)
            VALUES (?, ?, ?)
            """,
            (1, "dark-ember", json.dumps([{
                "id": "legacy-event",
                "title": "Legacy homework",
                "type": "homework",
                "date": "2026-10-06",
                "time": "09:00",
                "done": False,
            }])),
        )
        conn.commit()
        conn.close()

        self.assertEqual(
            self.client.get("/api/preferences/theme").json["theme"],
            "dark-ember",
        )
        events = self.client.get("/api/preferences/schedule").json["events"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["title"], "Legacy homework")
        user_dir = Path(self.temp_dir.name) / "admin"
        self.assertTrue((user_dir / "Settings" / "settings.json").is_file())
        self.assertTrue((user_dir / "Schedule" / "schedule.json").is_file())

    def test_theme_settings_are_integrated_into_settings_page(self):
        dashboard = self.client.get("/")
        settings = self.client.get("/settings")
        appearance_alias = self.client.get("/appearance")

        self.assertEqual(dashboard.status_code, 200)
        self.assertNotIn(b"Appearance", dashboard.data)
        self.assertEqual(settings.status_code, 200)
        self.assertIn(b'id="appearance-settings-heading">Appearance', settings.data)
        self.assertIn(b"appearance.js", settings.data)
        self.assertIn(b'id="apply-theme"', settings.data)
        self.assertEqual(settings.data.count(b'class="theme-card"'), 16)
        self.assertNotIn(b"Open appearance settings", settings.data)
        self.assertEqual(appearance_alias.status_code, 200)
        self.assertIn(b'id="apply-theme"', appearance_alias.data)

    def test_chat_endpoint_skips_searches_for_greetings(self):
        with patch("app.should_recommend_resources", return_value=False), patch(
            "app.find_resources"
        ) as find_resources, patch(
            "app.ask_ai",
            return_value=iter(["Hi! What would you like help studying today?"]),
        ):
            response = self.client.post("/api/ai", json={"message": "Hello!"})
            events = [
                json.loads(line)
                for line in response.get_data(as_text=True).splitlines()
            ]

        self.assertEqual(response.status_code, 200)
        self.assertEqual([event["type"] for event in events], ["chat", "token", "done"])
        find_resources.assert_not_called()
        self.assertEqual(len(list((Path(self.temp_dir.name) / "admin" / "chats").glob("*.json"))), 1)

    def test_first_message_creates_a_named_chat_and_saves_the_assistant_reply(self):
        with patch("app.should_recommend_resources", return_value=False), patch(
            "app.ask_ai",
            return_value=iter(["A triangle has three sides."]),
        ):
            response = self.client.post(
                "/api/ai",
                json={"message": "Explain triangles"},
            )
            events = [
                json.loads(line)
                for line in response.get_data(as_text=True).splitlines()
            ]

        self.assertEqual(response.status_code, 200)
        chat_event = next(event for event in events if event["type"] == "chat")
        chat_id = chat_event["chat"]["id"]
        self.assertEqual(chat_event["chat"]["title"], "Explain triangles")

        chat_path = next(
            (Path(self.temp_dir.name) / "admin" / "chats").glob(
                f"explain-triangles-{chat_id}.json"
            )
        )
        saved_chat = json.loads(chat_path.read_text(encoding="utf-8"))
        self.assertEqual(saved_chat["messages"], [
            {"role": "user", "content": "Explain triangles"},
            {"role": "assistant", "content": "A triangle has three sides."},
        ])
        self.assertTrue((Path(self.temp_dir.name) / "admin" / "memory").exists())

    def test_chat_endpoint_streams_multiple_topic_resources(self):
        resources = [
            {
                "type": "Video",
                "title": "Topic video",
                "url": "https://example.com/video",
                "description": "Video resource",
                "image": "",
            },
            {
                "type": "Article",
                "title": "Topic article",
                "url": "https://example.com/article",
                "description": "Article resource",
                "image": "",
            },
        ]
        chat_id, _ = self.create_saved_chat([
            {"role": "user", "content": "What is the topic?"},
            {"role": "assistant", "content": "It is a study topic."},
        ])
        with patch("app.should_recommend_resources", return_value=True), patch(
            "app.find_resources",
            return_value=resources,
        ), patch("app.ask_ai", return_value=iter(["Here is an explanation."])) as ask:
            response = self.client.post(
                "/api/ai",
                json={
                    "message": "Explain this topic.",
                    "chat_id": chat_id,
                },
            )
            events = [
                json.loads(line)
                for line in response.get_data(as_text=True).splitlines()
            ]

        self.assertEqual(response.status_code, 200)
        self.assertEqual([event["type"] for event in events], [
            "chat",
            "resource",
            "resource",
            "token",
            "done",
        ])
        self.assertEqual(ask.call_args.args, (
            "Explain this topic.",
            "\n\n".join(
                f"Type: {resource['type']}\nTitle: {resource['title']}\n"
                f"URL: {resource['url']}\nDescription: {resource['description']}"
                for resource in resources
            ),
            [
                {"role": "user", "content": "What is the topic?"},
                {"role": "assistant", "content": "It is a study topic."},
            ],
            {"explicit_facts": [], "facts": []},
        ))
        saved_chat = json.loads(next(
            (Path(self.temp_dir.name) / "admin" / "chats").glob(f"*-{chat_id}.json")
        ).read_text(encoding="utf-8"))
        self.assertEqual(saved_chat["messages"][-3], {
            "role": "assistant",
            "content": "Here is an explanation.",
        })
        self.assertEqual(
            saved_chat["messages"][-2:],
            [
                {"role": "resource", "resource": resources[0]},
                {"role": "resource", "resource": resources[1]},
            ],
        )
        self.assertEqual(
            [entry["role"] for entry in saved_chat["messages"]],
            ["user", "assistant", "user", "assistant", "resource", "resource"],
        )

    def test_chat_endpoint_rejects_unknown_chat_id(self):
        response = self.client.post(
            "/api/ai",
            json={
                "message": "Continue this conversation.",
                "chat_id": "a" * 32,
            },
        )

        self.assertEqual(response.status_code, 404)
        self.assertIn(b"Conversation not found", response.data)

    def test_chat_endpoint_tells_ai_when_requested_search_has_no_results(self):
        with patch("app.should_recommend_resources", return_value=True), patch(
            "app.find_resources",
            return_value=[],
        ), patch("app.ask_ai", return_value=iter(["No verified sources were found."])) as ask:
            response = self.client.post(
                "/api/ai",
                json={"message": "Search the web for this topic."},
            )
            events = [
                json.loads(line)
                for line in response.get_data(as_text=True).splitlines()
            ]

        self.assertEqual(response.status_code, 200)
        self.assertEqual([event["type"] for event in events], ["chat", "token", "done"])
        self.assertIn("no usable web sources", ask.call_args.args[1])
        self.assertIn("not verified by web search", ask.call_args.args[1])

    def test_chat_listing_loading_and_rename_are_persistent_and_user_scoped(self):
        chat_id, old_path = self.create_saved_chat([
            {"role": "user", "content": "Explain gravity."},
            {"role": "assistant", "content": "Gravity attracts objects with mass."},
        ])

        listed = self.client.get("/api/ai/chats")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json["chats"][0]["title"], "Earlier conversation")

        loaded = self.client.get(f"/api/ai/chats/{chat_id}")
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(
            loaded.json["chat"]["messages"][1]["content"],
            "Gravity attracts objects with mass.",
        )

        renamed = self.client.post(
            f"/api/ai/chats/{chat_id}/rename",
            json={"title": "Physics review"},
        )
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.json["chat"]["title"], "Physics review")
        self.assertFalse(old_path.exists())
        self.assertTrue(
            (old_path.parent / f"physics-review-{chat_id}.json").exists()
        )

        signup = self.client.post(
            "/signup",
            data={
                "username": "another_user",
                "password": "test1234",
                "password_confirmation": "test1234",
            },
        )
        self.assertEqual(signup.status_code, 302)
        self.assertEqual(self.client.get(f"/api/ai/chats/{chat_id}").status_code, 404)

    def test_chat_memory_is_saved_and_passed_into_later_ai_requests(self):
        user_dir = Path(self.temp_dir.name) / "admin"
        user_dir.mkdir(parents=True)
        (user_dir / "memory").write_text(
            json.dumps({"facts": ["The user is studying biology."]}),
            encoding="utf-8",
        )
        chat_id, _ = self.create_saved_chat([
            {"role": "user", "content": "I am studying biology."},
            {"role": "assistant", "content": "I can help with biology."},
        ])

        with patch("app.ask_ai", return_value=iter(["Let's review cells."])) as ask:
            response = self.client.post(
                "/api/ai",
                json={"message": "Can we continue?", "chat_id": chat_id},
            )
            list(response.response)

        self.assertEqual(ask.call_args.args[3], {
            "explicit_facts": [],
            "facts": ["The user is studying biology."]
        })
        saved_memory = json.loads((user_dir / "memory").read_text(encoding="utf-8"))
        self.assertEqual(saved_memory, {
            "explicit_facts": [],
            "facts": ["The user is studying biology."],
        })

    def test_chat_load_preserves_saved_user_resource_and_assistant_order(self):
        messages = [
            {"role": "user", "content": "Explain gravity."},
            {"role": "resource", "resource": {"title": "Gravity guide"}},
            {"role": "assistant", "content": "Gravity attracts objects."},
            {"role": "user", "content": "What is mass?"},
            {"role": "assistant", "content": "Mass measures matter."},
        ]
        chat_id, _ = self.create_saved_chat(messages)

        loaded = self.client.get(f"/api/ai/chats/{chat_id}")

        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json["chat"]["messages"], messages)

    def test_chat_delete_removes_only_the_signed_in_users_chat(self):
        chat_id, chat_path = self.create_saved_chat([
            {"role": "user", "content": "Explain gravity."},
            {"role": "assistant", "content": "Gravity attracts objects."},
        ])

        deleted = self.client.delete(f"/api/ai/chats/{chat_id}")

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json, {"deleted": chat_id})
        self.assertFalse(chat_path.exists())
        self.assertEqual(self.client.get(f"/api/ai/chats/{chat_id}").status_code, 404)
        self.assertEqual(
            self.client.delete(f"/api/ai/chats/{uuid.uuid4().hex}").status_code,
            404,
        )
        signup = self.client.post(
            "/signup",
            data={
                "username": "another_user",
                "password": "test1234",
                "password_confirmation": "test1234",
            },
        )
        self.assertEqual(signup.status_code, 302)
        self.assertEqual(self.client.delete(f"/api/ai/chats/{chat_id}").status_code, 404)


if __name__ == "__main__":
    unittest.main()
