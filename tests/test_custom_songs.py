import io
import tempfile
import unittest
from pathlib import Path

from app import app, init_db


class CustomSongsTests(unittest.TestCase):
    def setUp(self):
        self.original_database = app.config["DATABASE"]
        self.original_save_data_dir = app.config["SAVE_DATA_DIR"]
        self.original_user_songs_dir = app.config["USER_SONGS_DIR"]
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        app.config["DATABASE"] = str(root / "studytool.db")
        app.config["SAVE_DATA_DIR"] = str(root / "SaveData")
        app.config["USER_SONGS_DIR"] = str(root / "PrivateSongs")
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
        app.config["USER_SONGS_DIR"] = self.original_user_songs_dir
        self.temporary_directory.cleanup()

    def test_noise_page_has_custom_song_controls(self):
        response = self.client.get("/noise-songs")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"My Songs &amp; Sounds", response.data)
        self.assertIn(b"Add a sound", response.data)
        self.assertIn(b"Upload an audio file", response.data)
        self.assertIn(b"Paste a direct audio link", response.data)

    def test_uploaded_audio_can_be_listed_played_and_removed(self):
        response = self.client.post(
            "/api/my-songs",
            data={
                "title": "My focus track",
                "source": "upload",
                "audio_file": (io.BytesIO(b"audio bytes"), "focus.mp3"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 201)
        song = response.get_json()["song"]
        self.assertEqual(song["title"], "My focus track")
        audio_response = self.client.get(song["audio_url"])
        self.assertEqual(audio_response.status_code, 200)
        self.assertEqual(audio_response.data, b"audio bytes")
        audio_response.close()

        private_audio = (
            Path(app.config["USER_SONGS_DIR"]) / "admin" / f"{song['id']}.mp3"
        )
        self.assertTrue(private_audio.is_file())

        list_response = self.client.get("/api/my-songs")
        self.assertEqual(list_response.get_json()["songs"][0]["id"], song["id"])
        delete_response = self.client.delete(f"/api/my-songs/{song['id']}")
        self.assertEqual(delete_response.status_code, 200)
        self.assertFalse(private_audio.exists())
        self.assertEqual(self.client.get("/api/my-songs").get_json()["songs"], [])

    def test_direct_audio_link_is_saved_but_non_audio_page_is_rejected(self):
        invalid_response = self.client.post(
            "/api/my-songs",
            data={
                "title": "Streaming page",
                "source": "link",
                "audio_url": "https://example.com/watch/video",
            },
        )
        self.assertEqual(invalid_response.status_code, 400)

        response = self.client.post(
            "/api/my-songs",
            data={
                "title": "Linked audio",
                "source": "link",
                "audio_url": "https://example.com/audio.mp3?token=abc",
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            self.client.get("/api/my-songs").get_json()["songs"][0]["audio_url"],
            "https://example.com/audio.mp3?token=abc",
        )

    def test_rejects_unsupported_upload_type(self):
        response = self.client.post(
            "/api/my-songs",
            data={
                "title": "Not audio",
                "source": "upload",
                "audio_file": (io.BytesIO(b"not audio"), "document.txt"),
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 400)

    def test_account_deletion_removes_private_audio_files(self):
        upload_response = self.client.post(
            "/api/my-songs",
            data={
                "title": "Private track",
                "source": "upload",
                "audio_file": (io.BytesIO(b"audio bytes"), "private.mp3"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(upload_response.status_code, 201)
        song_directory = Path(app.config["USER_SONGS_DIR"]) / "admin"
        self.assertTrue(song_directory.exists())

        delete_response = self.client.post(
            "/settings",
            data={"action": "delete_account", "delete_password": "admin123"},
        )

        self.assertEqual(delete_response.status_code, 302)
        self.assertFalse(song_directory.exists())


if __name__ == "__main__":
    unittest.main()
