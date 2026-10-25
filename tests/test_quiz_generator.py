import json
import io
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from app import _run_quiz_generation, app, init_db
from static.quiz_generator import QUIZ_RESPONSE_FORMAT, QuizGenerationError, generate_quiz


class QuizGeneratorTests(unittest.TestCase):
    def test_requests_schema_and_returns_valid_questions(self):
        model_response = {
            "message": {
                "content": json.dumps({
                    "questions": [{
                        "question": "What do cells contain?",
                        "options": ["Genetic material", "Rock", "Metal", "Water only"],
                        "answer": "Genetic material",
                    }]
                })
            }
        }

        with patch("static.quiz_generator.ollama.chat", return_value=model_response) as chat:
            questions = generate_quiz("Cells contain genetic material.", 1)

        self.assertEqual(questions, [{
            "question": "What do cells contain?",
            "options": ["Genetic material", "Rock", "Metal", "Water only"],
            "answer": "Genetic material",
        }])
        self.assertEqual(chat.call_args.kwargs["format"], QUIZ_RESPONSE_FORMAT)

    def test_retries_malformed_output_before_returning_valid_questions(self):
        valid_response = {
            "message": {
                "content": json.dumps({
                    "questions": [{
                        "question": "What do cells contain?",
                        "options": ["DNA", "Rock", "Metal", "Water"],
                        "answer": "DNA",
                    }]
                })
            }
        }
        with patch(
            "static.quiz_generator.ollama.chat",
            side_effect=[
                {"message": {"content": "not json"}},
                valid_response,
            ],
        ) as chat:
            questions = generate_quiz("Cells contain DNA.", 1)

        self.assertEqual(len(questions), 1)
        self.assertEqual(chat.call_count, 2)

    def test_reports_incomplete_deck_after_bounded_attempts(self):
        with patch(
            "static.quiz_generator.ollama.chat",
            return_value={"message": {"content": "not json"}},
        ) as chat:
            with self.assertRaises(QuizGenerationError):
                generate_quiz("Cells contain DNA.", 1)

        self.assertEqual(chat.call_count, 2)

    def test_skips_invalid_model_structure_and_reports_missing_questions(self):
        with patch(
            "static.quiz_generator.ollama.chat",
            return_value={"message": {"content": json.dumps({"questions": None})}},
        ):
            with self.assertRaises(QuizGenerationError):
                generate_quiz("Cells contain DNA.", 1)

    def test_returns_valid_partial_quiz_when_source_supports_fewer_questions(self):
        question = {
            "question": "What do cells contain?",
            "options": ["DNA", "Metal", "Rock", "Plastic"],
            "answer": "DNA",
        }
        model_response = {"message": {"content": json.dumps({"questions": [question]})}}

        with patch("static.quiz_generator.ollama.chat", return_value=model_response) as chat:
            questions = generate_quiz("Cells contain DNA.", 2)

        self.assertEqual(questions, [question])
        self.assertEqual(chat.call_count, 2)


class QuizGeneratorApiTests(unittest.TestCase):
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

    def test_generator_page_renders_source_switch_and_question_controls(self):
        response = self.client.get("/quiz-generator")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="quiz-source-switch"', response.data)
        self.assertIn(b'id="quiz-progress-bar"', response.data)
        self.assertIn(b'id="quiz-save-retry"', response.data)
        self.assertIn(b'id="quiz-time-estimate"', response.data)
        self.assertIn(b'id="quiz-results-score"', response.data)
        self.assertNotIn(b"Choose one answer", response.data)

    def test_upload_queues_generation_and_returns_before_model_work(self):
        flashcard_module = types.ModuleType("static.flashcard_generator")
        flashcard_module.extract_file_text = lambda _path: "Study material"
        with patch.dict(sys.modules, {"static.flashcard_generator": flashcard_module}), patch(
            "app._schedule_quiz_generation"
        ) as schedule:
            response = self.client.post(
                "/api/quizzes/generate",
                data={
                    "file": (io.BytesIO(b"Study material"), "notes.txt"),
                    "count": "1",
                },
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 202)
        job_id = response.get_json()["job_id"]
        self.assertRegex(job_id, r"^[a-f0-9]{32}$")
        schedule.assert_called_once()

        with patch("app._schedule_quiz_generation") as recover:
            status = self.client.get(f"/api/quizzes/generate/{job_id}")

        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.get_json()["status"], "queued")
        self.assertNotIn("source_text", status.get_json())
        recover.assert_called_once()

    def test_saved_quiz_opens_through_library_link_and_api(self):
        created = self.client.post("/api/quizzes", json={
            "title": "Cells",
            "questions": [{
                "question": "What do cells contain?",
                "options": ["DNA", "Metal", "Rock", "Plastic"],
                "answer": "DNA",
            }],
        })
        quiz_id = created.get_json()["id"]

        library = self.client.get("/quiz-library")
        loaded = self.client.get(f"/api/quizzes/{quiz_id}")

        self.assertEqual(library.status_code, 200)
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.get_json()["questions"][0]["answer"], "DNA")

    def test_quiz_progress_is_saved_and_returned(self):
        created = self.client.post("/api/quizzes", json={
            "title": "Cells",
            "questions": [{
                "question": "What do cells contain?",
                "options": ["DNA", "Metal", "Rock", "Plastic"],
                "answer": "DNA",
            }],
        })
        quiz_id = created.get_json()["id"]
        payload = {"answers": ["DNA"], "index": 0, "complete": True}

        saved = self.client.put(f"/api/quizzes/{quiz_id}/progress", json=payload)
        loaded = self.client.get(f"/api/quizzes/{quiz_id}")

        self.assertEqual(saved.status_code, 200)
        self.assertEqual(loaded.get_json()["progress"]["answers"], ["DNA"])
        self.assertTrue(loaded.get_json()["progress"]["complete"])

    def test_quiz_progress_can_be_updated_repeatedly(self):
        created = self.client.post("/api/quizzes", json={
            "title": "Cells",
            "questions": [{
                "question": "What do cells contain?",
                "options": ["DNA", "Metal", "Rock", "Plastic"],
                "answer": "DNA",
            }],
        })
        quiz_id = created.get_json()["id"]

        first = self.client.put(f"/api/quizzes/{quiz_id}/progress", json={
            "answers": [None], "index": 0, "complete": False,
        })
        second = self.client.put(f"/api/quizzes/{quiz_id}/progress", json={
            "answers": ["DNA"], "index": 0, "complete": True,
        })
        loaded = self.client.get(f"/api/quizzes/{quiz_id}").get_json()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(loaded["progress"]["answers"], ["DNA"])
        self.assertTrue(loaded["progress"]["complete"])

    def test_quiz_progress_rejects_answers_not_in_question_options(self):
        created = self.client.post("/api/quizzes", json={
            "title": "Cells",
            "questions": [{
                "question": "What do cells contain?",
                "options": ["DNA", "Metal", "Rock", "Plastic"],
                "answer": "DNA",
            }],
        })
        quiz_id = created.get_json()["id"]

        response = self.client.put(f"/api/quizzes/{quiz_id}/progress", json={
            "answers": ["not an option"], "index": 0, "complete": False,
        })

        self.assertEqual(response.status_code, 400)

    def test_background_worker_saves_quiz_without_status_polling(self):
        user_dir = Path(app.config["SAVE_DATA_DIR"]) / "admin" / "Quizzes"
        jobs_dir = user_dir / "generation_jobs"
        jobs_dir.mkdir(parents=True, exist_ok=True)
        job_id = "a" * 32
        job_path = jobs_dir / f"{job_id}.json"
        job_path.write_text(json.dumps({
            "id": job_id,
            "status": "queued",
            "title": "Cells",
            "count": 1,
            "source_text": "Study material",
        }), encoding="utf-8")
        questions = [{
            "question": "What do cells contain?",
            "options": ["DNA", "Metal", "Rock", "Plastic"],
            "answer": "DNA",
        }]

        with self.client.session_transaction() as session_data:
            user_id = session_data["user_id"]
        with patch("static.quiz_generator.generate_quiz", return_value=questions):
            _run_quiz_generation(user_id, job_id, job_path, 1)

        job = json.loads(job_path.read_text(encoding="utf-8"))
        saved = json.loads((user_dir / "quizzes.json").read_text(encoding="utf-8"))
        self.assertEqual(job["status"], "completed")
        self.assertEqual(saved["quizzes"][0]["questions"], questions)

    def test_generation_uses_one_model_call_for_ten_questions(self):
        questions = [{
            "question": f"Question {index}?",
            "options": [f"A{index}", f"B{index}", f"C{index}", f"D{index}"],
            "answer": f"A{index}",
        } for index in range(10)]
        model_response = {"message": {"content": json.dumps({"questions": questions})}}

        with patch("static.quiz_generator.ollama.chat", return_value=model_response) as chat:
            result = generate_quiz("Study material.", 10)

        self.assertEqual(len(result), 10)
        self.assertEqual(chat.call_count, 1)
        self.assertIn("exactly 10", chat.call_args.kwargs["messages"][1]["content"])
