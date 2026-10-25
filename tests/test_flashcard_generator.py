import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import _run_flashcard_generation, app, init_db
from static.flashcard_generator import (
    FLASHCARD_RESPONSE_FORMAT,
    FlashcardGenerationError,
    extract_file_text,
    generate_flashcards,
)


class FlashcardGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.text_path = Path(self.temporary_directory.name) / "notes.txt"
        self.text_path.write_text("Cells contain genetic material.", encoding="utf-8")

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_extracts_text_from_utf8_bom_file(self):
        self.text_path.write_text("\ufeffBiology notes", encoding="utf-8")

        self.assertEqual(extract_file_text(self.text_path), "Biology notes")

    def test_retries_invalid_model_output_and_removes_duplicate_questions(self):
        valid_response = {
            "message": {
                "content": json.dumps({
                    "flashcards": [
                        {"question": "What do cells contain?", "answer": "Genetic material."},
                        {"question": "  what do cells contain? ", "answer": "Repeated."},
                        {"question": "What is in a cell?", "answer": "Genetic material."},
                    ]
                })
            }
        }

        with patch(
            "static.flashcard_generator.ollama.chat",
            side_effect=[
                {"message": {"content": "not json"}},
                valid_response,
            ],
        ) as chat:
            cards = generate_flashcards(self.text_path, count=2)

        self.assertEqual(cards, [
            {
                "question": "What do cells contain?",
                "answer": "Genetic material.",
            },
            {
                "question": "What is in a cell?",
                "answer": "Genetic material.",
            },
        ])
        self.assertEqual(chat.call_count, 2)
        self.assertEqual(
            chat.call_args.kwargs["format"],
            FLASHCARD_RESPONSE_FORMAT,
        )

    def test_raises_generation_error_after_repeated_invalid_output(self):
        with patch(
            "static.flashcard_generator.ollama.chat",
            return_value={"message": {"content": "not json"}},
        ) as chat:
            with self.assertRaises(FlashcardGenerationError):
                generate_flashcards(self.text_path)

        self.assertEqual(chat.call_count, 3)

    def test_rejects_invalid_count_before_calling_model(self):
        with patch("static.flashcard_generator.ollama.chat") as chat:
            with self.assertRaisesRegex(ValueError, "between 1 and 50"):
                generate_flashcards(self.text_path, count=0)

        chat.assert_not_called()


class FlashcardGenerationApiTests(unittest.TestCase):
    def setUp(self):
        self.original_database = app.config["DATABASE"]
        self.original_save_data_dir = app.config["SAVE_DATA_DIR"]
        self.original_testing = app.config.get("TESTING", False)
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        app.config["DATABASE"] = str(root / "studytool.db")
        app.config["SAVE_DATA_DIR"] = str(root / "SaveData")
        app.config["TESTING"] = True
        init_db()
        self.client = app.test_client()
        self.client.post(
            "/login",
            data={"username": "admin", "password": "admin123"},
        )

    def tearDown(self):
        app.config["DATABASE"] = self.original_database
        app.config["SAVE_DATA_DIR"] = self.original_save_data_dir
        app.config["TESTING"] = self.original_testing
        self.temporary_directory.cleanup()

    def test_flashcard_study_page_has_mode_and_next_card_controls(self):
        response = self.client.get("/flashcard-generator")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-mode="learn"', response.data)
        self.assertIn(b'data-mode="random"', response.data)
        self.assertIn(b'id="flashcard-next"', response.data)
        self.assertNotIn(b'id="flashcard-reveal"', response.data)

    def test_upload_queues_generation_and_returns_before_model_work(self):
        with patch("app._schedule_flashcard_generation") as schedule:
            response = self.client.post(
                "/api/flashcards/generate",
                data={
                    "file": (io.BytesIO(b"Study material"), "notes.txt"),
                    "count": "1",
                    "focus": "mixed",
                },
                content_type="multipart/form-data",
            )
            self.assertEqual(response.status_code, 202)
            job_id = response.get_json()["job_id"]
            self.assertRegex(job_id, r"^[a-f0-9]{32}$")
            schedule.assert_called_once()
            status = self.client.get(f"/api/flashcards/generate/{job_id}")
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.get_json()["status"], "queued")

    def _create_job_files(self, job_id="a" * 32):
        jobs = Path(app.config["SAVE_DATA_DIR"]) / "admin" / "Flashcards" / "generation_jobs"
        jobs.mkdir(parents=True, exist_ok=True)
        source_path = jobs / f"{job_id}.txt"
        source_path.write_text("Study material", encoding="utf-8")
        job_path = jobs / f"{job_id}.json"
        job_path.write_text(json.dumps({"id": job_id, "status": "queued", "title": "Notes", "count": 1}), encoding="utf-8")
        return job_id, source_path, job_path

    def test_worker_generates_saves_and_completes_a_deck(self):
        job_id, source_path, job_path = self._create_job_files()
        cards = [{"question": "What?", "answer": "This."}]
        with self.client.session_transaction() as session_data:
            user_id = session_data["user_id"]
        with patch("static.flashcard_generator.generate_flashcards", return_value=cards):
            _run_flashcard_generation(user_id, job_id, source_path, job_path, 1, "mixed")

        job = json.loads(job_path.read_text(encoding="utf-8"))
        saved = self.client.get("/api/flashcards").get_json()
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["deck"]["cards"], [{"term": "What?", "definition": "This."}])
        self.assertEqual(saved[0]["id"], job["deck"]["id"])
        self.assertFalse(source_path.exists())

    def test_worker_reports_generation_errors_and_cleans_up_upload(self):
        job_id, source_path, job_path = self._create_job_files()
        with self.client.session_transaction() as session_data:
            user_id = session_data["user_id"]
        with patch("static.flashcard_generator.generate_flashcards", side_effect=FlashcardGenerationError("Could not create a deck.")):
            _run_flashcard_generation(user_id, job_id, source_path, job_path, 1, "mixed")

        job = json.loads(job_path.read_text(encoding="utf-8"))
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error"], "Could not create a deck.")
        self.assertFalse(source_path.exists())

    def test_worker_gives_clear_message_when_ollama_is_unavailable(self):
        job_id, source_path, job_path = self._create_job_files()
        with self.client.session_transaction() as session_data:
            user_id = session_data["user_id"]
        with patch("static.flashcard_generator.generate_flashcards", side_effect=ConnectionError("Failed to connect to Ollama")):
            _run_flashcard_generation(user_id, job_id, source_path, job_path, 1, "mixed")

        job = json.loads(job_path.read_text(encoding="utf-8"))
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error"], "The AI service is not running. Start Ollama, then upload the file again.")
        self.assertFalse(source_path.exists())

    def test_user_upload_study_save_leave_and_reopen_flow(self):
        with patch("app._schedule_flashcard_generation") as schedule:
            uploaded = self.client.post(
                "/api/flashcards/generate",
                data={
                    "file": (io.BytesIO(b"Cells are the basic unit of life."), "biology.txt"),
                    "count": "2",
                },
                content_type="multipart/form-data",
            )
        self.assertEqual(uploaded.status_code, 202)
        user_id, job_id, source_path, job_path, count, focus = schedule.call_args.args
        self.assertEqual(job_id, uploaded.get_json()["job_id"])
        self.assertEqual(count, 2)
        self.assertEqual(focus, "mixed")

        generated = [
            {"question": "What is a cell?", "answer": "The basic unit of life."},
            {"question": "What does DNA carry?", "answer": "Genetic instructions."},
        ]
        with patch("static.flashcard_generator.generate_flashcards", return_value=generated):
            _run_flashcard_generation(user_id, job_id, source_path, job_path, count, focus)

        status = self.client.get(f"/api/flashcards/generate/{job_id}")
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.get_json()["status"], "completed")
        deck_id = status.get_json()["deck"]["id"]
        library = self.client.get("/flashcard-library")
        reopened = self.client.get(f"/api/flashcards/{deck_id}")
        self.assertEqual(library.status_code, 200)
        self.assertEqual(reopened.status_code, 200)
        progress = {"order": [1, 0], "current_index": 1, "known_cards": [1], "mode": "learn", "flipped": True}
        saved_progress = self.client.put(f"/api/flashcards/{deck_id}/progress", json=progress)
        self.assertEqual(saved_progress.status_code, 200)

        self.client.get("/noise-songs")
        returned = self.client.get(f"/api/flashcards/{deck_id}")
        self.assertEqual(returned.get_json()["progress"]["current_index"], 1)
        self.assertEqual(returned.get_json()["progress"]["known_cards"], [1])

    def test_saved_deck_progress_survives_reopen_and_title_edit(self):
        created = self.client.post("/api/flashcards", json={
            "title": "Biology",
            "cards": [{"term": "Cell", "definition": "Basic unit of life"}, {"term": "DNA", "definition": "Genetic material"}],
        })
        deck_id = created.get_json()["id"]
        progress = {"order": [1, 0], "current_index": 1, "known_cards": [1], "mode": "learn", "flipped": True}

        saved = self.client.put(f"/api/flashcards/{deck_id}/progress", json=progress)
        edited = self.client.put(f"/api/flashcards/{deck_id}", json={"title": "Biology review", "cards": created.get_json()["cards"]})
        reopened = self.client.get(f"/api/flashcards/{deck_id}")

        self.assertEqual(saved.status_code, 200)
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(reopened.get_json()["title"], "Biology review")
        self.assertEqual(reopened.get_json()["progress"]["order"], [1, 0])
        self.assertEqual(reopened.get_json()["progress"]["current_index"], 1)

    def test_progress_rejects_invalid_card_order(self):
        created = self.client.post("/api/flashcards", json={"title": "Deck", "cards": [{"term": "A", "definition": "B"}]})
        deck_id = created.get_json()["id"]
        response = self.client.put(f"/api/flashcards/{deck_id}/progress", json={
            "order": [1], "current_index": 0, "known_cards": [], "mode": "random",
        })
        self.assertEqual(response.status_code, 400)
