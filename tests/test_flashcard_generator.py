import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import app, init_db
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

        self.assertEqual(chat.call_count, 2)

    def test_rejects_invalid_count_before_calling_model(self):
        with patch("static.flashcard_generator.ollama.chat") as chat:
            with self.assertRaisesRegex(ValueError, "between 1 and 50"):
                generate_flashcards(self.text_path, count=0)

        chat.assert_not_called()


class FlashcardGenerationApiTests(unittest.TestCase):
    def setUp(self):
        self.original_database = app.config["DATABASE"]
        self.original_save_data_dir = app.config["SAVE_DATA_DIR"]
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
        self.temporary_directory.cleanup()

    def test_returns_success_for_generated_cards(self):
        with patch(
            "static.flashcard_generator.generate_flashcards",
            return_value=[{"question": "What?", "answer": "This."}],
        ):
            response = self.client.post(
                "/api/flashcards/generate",
                data={
                    "file": (io.BytesIO(b"Study material"), "notes.txt"),
                    "count": "1",
                    "focus": "mixed",
                },
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {"flashcards": [{"question": "What?", "answer": "This."}]},
        )

    def test_reports_unusable_ai_output_as_service_error(self):
        with patch(
            "static.flashcard_generator.generate_flashcards",
            side_effect=FlashcardGenerationError("Could not create a deck."),
        ):
            response = self.client.post(
                "/api/flashcards/generate",
                data={
                    "file": (io.BytesIO(b"Study material"), "notes.txt"),
                    "count": "1",
                    "focus": "mixed",
                },
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.get_json(),
            {"error": "Could not create a deck."},
        )
