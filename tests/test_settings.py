import tempfile
import unittest
from pathlib import Path

from app import app, get_db, init_db


class SettingsTests(unittest.TestCase):
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

    def tearDown(self):
        app.config["DATABASE"] = self.original_database
        app.config["SAVE_DATA_DIR"] = self.original_save_data_dir
        self.temporary_directory.cleanup()

    def login(self, password="admin123"):
        return self.client.post(
            "/login",
            data={"username": "admin", "password": password},
        )

    def test_settings_page_shows_security_and_removes_preferences(self):
        self.login()

        response = self.client.get("/settings")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Security", response.data)
        self.assertIn(b"Password", response.data)
        self.assertNotIn(b"Account Preferences", response.data)
        self.assertNotIn(b"Default Dashboard View", response.data)
        self.assertNotIn(b"Personal Information", response.data)

    def test_login_defaults_to_dashboard_and_preferences_are_removed(self):
        login_response = self.login()
        self.assertEqual(login_response.status_code, 302)
        self.assertEqual(login_response.headers["Location"], "/")

        response = self.client.get("/settings")
        self.assertNotIn(b"Account Preferences", response.data)
        self.assertNotIn(b"Default Dashboard View", response.data)
        self.assertNotIn(b"Reminders &amp; feature updates", response.data)

    def test_password_change_and_account_deletion_use_hashed_credentials(self):
        self.login()
        change_response = self.client.post(
            "/settings",
            data={
                "action": "change_password",
                "old_password": "admin123",
                "new_password": "updated-pass",
                "confirm_password": "updated-pass",
            },
        )
        self.assertEqual(change_response.status_code, 200)
        self.client.get("/logout")
        self.assertEqual(self.login("updated-pass").status_code, 302)

        user_data_directory = Path(app.config["SAVE_DATA_DIR"]) / "admin"
        user_data_directory.mkdir(parents=True, exist_ok=True)
        (user_data_directory / "test-data.txt").write_text("user data", encoding="utf-8")
        delete_response = self.client.post(
            "/settings",
            data={"action": "delete_account", "delete_password": "updated-pass"},
        )
        self.assertEqual(delete_response.status_code, 302)
        self.assertFalse(user_data_directory.exists())

        connection = get_db()
        try:
            user = connection.execute(
                "SELECT id FROM users WHERE username = ?",
                ("admin",),
            ).fetchone()
        finally:
            connection.close()
        self.assertIsNone(user)


if __name__ == "__main__":
    unittest.main()
