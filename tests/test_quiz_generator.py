import json
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import app, init_db
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

        self.assertEqual(chat.call_count, 5)

    def test_skips_invalid_model_structure_and_reports_missing_questions(self):
        with patch(
            "static.quiz_generator.ollama.chat",
            return_value={"message": {"content": json.dumps({"questions": None})}},
        ):
            with self.assertRaises(QuizGenerationError):
                generate_quiz("Cells contain DNA.", 1)


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

    def test_incomplete_model_output_is_reported_as_generation_failure(self):
        with patch(
            "static.flashcard_generator.extract_file_text",
            return_value="Study material",
        ), patch(
            "static.quiz_generator.generate_quiz",
            side_effect=QuizGenerationError("Could not create all requested questions."),
        ):
            response = self.client.post(
                "/api/quizzes/generate",
                data={
                    "file": (io.BytesIO(b"Study material"), "notes.txt"),
                    "count": "1",
                },
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("AI service is available", response.get_json()["error"])
