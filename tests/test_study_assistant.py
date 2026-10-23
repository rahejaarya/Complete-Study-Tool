import io
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from app import app, init_db


class StudyAssistantTests(unittest.TestCase):
    def setUp(self):
        self.original_database = app.config["DATABASE"]
        self.original_save_data_dir = app.config["SAVE_DATA_DIR"]
        self.temp_directory = tempfile.TemporaryDirectory()
        root = Path(self.temp_directory.name)
        app.config["DATABASE"] = str(root / "studytool.db")
        app.config["SAVE_DATA_DIR"] = str(root / "SaveData")
        app.config["TESTING"] = True
        init_db()
        self.client = app.test_client()
        self.client.post("/login", data={"username": "admin", "password": "admin123"})
        self.folder_id = str(uuid.uuid4())
        self.client.put("/api/saved-folders", json=[{"id": self.folder_id, "name": "Biology", "items": []}])

    def tearDown(self):
        app.config["DATABASE"] = self.original_database
        app.config["SAVE_DATA_DIR"] = self.original_save_data_dir
        self.temp_directory.cleanup()

    def upload_text(self):
        response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/files",
            data={"file": (io.BytesIO(b"Mitosis divides one cell into two identical daughter cells."), "mitosis.txt")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 201)
        return response.get_json()["file"]

    def test_authentication_is_required(self):
        client = app.test_client()
        response = client.post("/api/study-assistant", json={"question": "Explain mitosis"})
        self.assertEqual(response.status_code, 401)

    def test_selected_file_context_is_passed_to_existing_ai(self):
        item = self.upload_text()
        with patch("app.ask_ai", return_value=iter(["Mitosis creates two identical cells."])) as ask_ai:
            response = self.client.post("/api/study-assistant", json={
                "question": "Summarize this",
                "folder_id": self.folder_id,
                "item_ids": [item["file_id"]],
                "topic": "Cell division",
            })
        self.assertEqual(response.status_code, 200)
        lines = [json.loads(line) for line in response.data.decode().splitlines() if line]
        self.assertEqual(lines[-1], {"type": "done"})
        prompt, = ask_ai.call_args.args
        context = ask_ai.call_args.kwargs["web_context"]
        self.assertEqual(prompt, "Summarize this")
        self.assertIn("Mitosis divides one cell into two identical daughter cells.", context)
        self.assertIn("CURRENT STUDY TOPIC", context)

    def test_unselected_file_is_not_read(self):
        item = self.upload_text()
        with patch("app.ask_ai", return_value=iter(["General answer"])) as ask_ai:
            response = self.client.post("/api/study-assistant", json={
                "question": "Help me study",
                "folder_id": self.folder_id,
                "item_ids": [],
            })
        self.assertEqual(response.status_code, 200)
        response.get_data()
        context = ask_ai.call_args.kwargs["web_context"]
        self.assertNotIn("Mitosis divides", context)

    def test_invalid_request_is_rejected(self):
        response = self.client.post("/api/study-assistant", json={"question": " "})
        self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/study-assistant", json={"question": "Help", "item_ids": [1]})
        self.assertEqual(response.status_code, 400)

    def test_another_user_folder_is_not_accessible(self):
        signup = app.test_client()
        signup.post("/signup", data={"username": "other", "password": "test123", "password_confirmation": "test123"})
        response = signup.post("/api/study-assistant", json={
            "question": "Read it",
            "folder_id": self.folder_id,
            "item_ids": [],
        })
        self.assertEqual(response.status_code, 404)

    def test_unsupported_file_reports_limitation(self):
        response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/files",
            data={"file": (io.BytesIO(b"not really a document"), "lesson.bin")},
            content_type="multipart/form-data",
        )
        item = response.get_json()["file"]
        with patch("app.ask_ai", return_value=iter(["I cannot read that file."])) as ask_ai:
            response = self.client.post("/api/study-assistant", json={
                "question": "What does it say?",
                "folder_id": self.folder_id,
                "item_ids": [item["file_id"]],
            })
        self.assertEqual(response.status_code, 200)
        response.get_data()
        context = ask_ai.call_args.kwargs["web_context"]
        self.assertIn("cannot be read by the study assistant", context)

    def test_ai_failure_is_returned_safely(self):
        with patch("app.ask_ai", return_value=iter(["Error: provider details"])):
            response = self.client.post("/api/study-assistant", json={"question": "Help"})
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data.decode().strip())
        self.assertEqual(data["type"], "error")
        self.assertNotIn("provider details", data["message"])


if __name__ == "__main__":
    unittest.main()
