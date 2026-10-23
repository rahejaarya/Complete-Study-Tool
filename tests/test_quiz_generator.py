import json
import unittest
from unittest.mock import patch

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
