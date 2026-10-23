import io
from datetime import datetime
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from app import app, init_db


class SavedFolderUploadTests(unittest.TestCase):
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
        self.folder_id = str(uuid.uuid4())
        self.client.put(
            "/api/saved-folders",
            json=[{
                "id": self.folder_id,
                "name": "Biology",
                "items": [],
            }],
        )

    def tearDown(self):
        app.config["DATABASE"] = self.original_database
        app.config["SAVE_DATA_DIR"] = self.original_save_data_dir
        self.temporary_directory.cleanup()

    def test_upload_is_stored_in_folder_and_can_be_viewed(self):
        upload_response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/files",
            data={"file": (io.BytesIO(b"Cell structure notes"), "cells.txt")},
            content_type="multipart/form-data",
        )

        self.assertEqual(upload_response.status_code, 201)
        result = upload_response.get_json()
        file_item = result["file"]
        self.assertIsInstance(
            datetime.fromisoformat(file_item["uploaded_at"]),
            datetime,
        )
        folder_path = (
            Path(app.config["SAVE_DATA_DIR"])
            / "admin"
            / "Folders"
            / self.folder_id
        )
        saved_file = folder_path / file_item["filename"]
        self.assertTrue(saved_file.is_file())
        self.assertTrue((folder_path / "folder.json").is_file())
        self.assertEqual(file_item["storage_id"], file_item["file_id"])
        self.assertEqual(file_item["file_type"], "text/plain")

        folder_response = self.client.get("/api/saved-folders")
        self.assertEqual(folder_response.status_code, 200)
        self.assertEqual(
            folder_response.get_json()[0]["items"][0]["file_id"],
            file_item["file_id"],
        )

        folder_data = folder_response.get_json()[0]
        rename_response = self.client.put(
            "/api/saved-folders",
            json=[{**folder_data, "name": "Cell Biology"}],
        )
        self.assertEqual(rename_response.status_code, 200)
        refreshed_folders = self.client.get("/api/saved-folders").get_json()
        self.assertEqual(refreshed_folders[0]["name"], "Cell Biology")
        self.assertEqual(refreshed_folders[0]["items"][0]["file_id"], file_item["file_id"])

        view_response = self.client.get(result["url"])
        self.assertEqual(view_response.status_code, 200)
        self.assertEqual(view_response.data, b"Cell structure notes")
        self.assertIn("inline", view_response.headers["Content-Disposition"])
        view_response.close()
        download_response = self.client.get(f"{result['url']}?download=1")
        self.assertEqual(download_response.status_code, 200)
        self.assertIn("attachment", download_response.headers["Content-Disposition"])
        download_response.close()

    def test_file_path_uses_safe_generated_name(self):
        response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/files",
            data={"file": (io.BytesIO(b"document"), "../../unsafe.txt")},
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 201)
        file_item = response.get_json()["file"]
        self.assertEqual(file_item["title"], "unsafe.txt")
        self.assertEqual(file_item["filename"], f"{file_item['file_id']}.txt")

    def test_another_account_cannot_view_the_file(self):
        upload_response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/files",
            data={"file": (io.BytesIO(b"private notes"), "notes.txt")},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload_response.status_code, 201)
        file_url = upload_response.get_json()["url"]

        other_client = app.test_client()
        signup_response = other_client.post(
            "/signup",
            data={
                "username": "student2",
                "password": "student123",
                "password_confirmation": "student123",
            },
        )
        self.assertEqual(signup_response.status_code, 302)

        response = other_client.get(file_url)
        self.assertEqual(response.status_code, 404)

    def test_web_search_results_can_be_saved_and_persist_after_refresh(self):
        with (
            patch("app.search_web", return_value=[{
                "title": "Photosynthesis guide",
                "url": "https://example.org/photosynthesis",
                "description": "An introduction to photosynthesis.",
            }]),
            patch("app.search_educational_videos", return_value=[]),
        ):
            search_response = self.client.post(
                "/api/resource-browser/search",
                json={"query": "photosynthesis"},
                headers={"Accept": "application/json"},
            )

        self.assertEqual(search_response.status_code, 200)
        self.assertEqual(search_response.content_type, "application/json")
        result = search_response.get_json()["web_results"][0]
        save_response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/web-resources",
            json={
                "title": result["title"],
                "url": result["url"],
                "file_type": "web link",
            },
        )
        self.assertEqual(save_response.status_code, 201)
        saved_item = save_response.get_json()["item"]
        self.assertEqual(saved_item["url"], "https://example.org/photosynthesis")

        refreshed = self.client.get("/api/saved-folders").get_json()[0]
        self.assertEqual(refreshed["items"][0]["storage_id"], saved_item["storage_id"])
        self.assertEqual(refreshed["items"][0]["file_type"], "web link")

        folder_path = (
            Path(app.config["SAVE_DATA_DIR"])
            / "admin"
            / "Folders"
            / self.folder_id
        )
        self.assertTrue((folder_path / "folder.json").is_file())
        self.assertFalse((folder_path / saved_item["storage_id"]).exists())

    def test_existing_notes_and_whiteboards_link_without_copying(self):
        notebook_id = uuid.uuid4().hex
        whiteboard_id = uuid.uuid4().hex
        notebook = {
            "id": notebook_id,
            "name": "Biology notes",
            "content": "<p>Cell structure</p>",
            "whiteboard": {"strokes": []},
            "kind": "notes",
        }
        whiteboard = {
            "id": whiteboard_id,
            "name": "Cell diagram",
            "content": "",
            "whiteboard": {"strokes": [{"points": [[1, 2]]}]},
            "kind": "whiteboard",
        }
        save_notebook = self.client.put(
            "/api/notebooks",
            json={
                "notebooks": [notebook, whiteboard],
                "active_id": notebook_id,
            },
        )
        self.assertEqual(save_notebook.status_code, 200)

        response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/notebooks",
            json={"notebook_id": notebook_id},
        )
        self.assertEqual(response.status_code, 201)
        item = response.get_json()["item"]
        self.assertEqual(item["kind"], "notebook")
        self.assertEqual(item["notebook_id"], notebook_id)
        self.assertEqual(item["file_type"], "notes")

        whiteboard_response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/notebooks",
            json={"notebook_id": whiteboard_id},
        )
        self.assertEqual(whiteboard_response.status_code, 201)
        self.assertEqual(
            whiteboard_response.get_json()["item"]["file_type"],
            "whiteboard",
        )

        duplicate_response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/notebooks",
            json={"notebook_id": notebook_id},
        )
        self.assertEqual(duplicate_response.status_code, 200)
        folder = self.client.get("/api/saved-folders").get_json()[0]
        self.assertEqual(len(folder["items"]), 2)
        self.assertEqual(self.client.get("/api/notebooks").get_json()["notebooks"], [
            notebook,
            whiteboard,
        ])

        renamed_notebook = {**notebook, "name": "Updated biology notes"}
        renamed_whiteboard = {**whiteboard, "name": "Updated cell diagram"}
        update_notebook = self.client.put(
            "/api/notebooks",
            json={
                "notebooks": [renamed_notebook, renamed_whiteboard],
                "active_id": notebook_id,
            },
        )
        self.assertEqual(update_notebook.status_code, 200)
        self.assertEqual(
            {
                item["notebook_id"]
                for item in self.client.get("/api/saved-folders").get_json()[0]["items"]
            },
            {notebook_id, whiteboard_id},
        )

    def test_library_page_has_study_resources_back_link_and_no_whiteboard_launch_card(self):
        response = self.client.get("/resources?library=1")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'href="/resources">', response.data)
        self.assertIn(b"Study Resources", response.data)
        self.assertNotIn(b"Open whiteboards", response.data)
        self.assertIn(b"Add existing note or whiteboard", response.data)

    def test_legacy_folder_layout_migrates_without_losing_contents(self):
        legacy_id = str(uuid.uuid4())
        legacy_path = (
            Path(app.config["SAVE_DATA_DIR"])
            / "admin"
            / "Folders"
            / "Old folder name"
        )
        legacy_path.mkdir(parents=True)
        (legacy_path / ".folder.json").write_text(
            (
                '{"id": "%s", "name": "Old folder name", '
                '"items": [{"kind": "legacy", "title": "Saved item"}]}'
            ) % legacy_id,
            encoding="utf-8",
        )

        response = self.client.get("/api/saved-folders")

        self.assertEqual(response.status_code, 200)
        migrated_path = legacy_path.parent / legacy_id
        self.assertTrue((migrated_path / "folder.json").is_file())
        self.assertFalse((migrated_path / ".folder.json").exists())
        self.assertEqual(
            next(folder for folder in response.get_json() if folder["id"] == legacy_id)["items"][0]["title"],
            "Saved item",
        )

    def test_static_urls_cannot_access_user_save_data(self):
        response = self.client.get(
            f"/static/SaveData/admin/Folders/{self.folder_id}/folder.json"
        )
        self.assertEqual(response.status_code, 404)

    def test_api_auth_errors_are_json_instead_of_login_html(self):
        self.client.get("/logout")

        response = self.client.post(
            "/api/resource-browser/search",
            json={"query": "photosynthesis"},
            headers={"Accept": "application/json"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.content_type, "application/json")
        self.assertIn("sign in", response.get_json()["error"].lower())

    def test_invalid_web_search_request_returns_json_error(self):
        response = self.client.post(
            "/api/resource-browser/search",
            json=[],
            headers={"Accept": "application/json"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.content_type, "application/json")
        self.assertIn("error", response.get_json())

    def test_web_search_service_unavailable_returns_json_fallback(self):
        with (
            patch("app.search_web", return_value=[]),
            patch("app.search_educational_videos", return_value=[]),
        ):
            response = self.client.post(
                "/api/resource-browser/search",
                json={"query": "cell biology"},
                headers={"Accept": "application/json"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["web_results"], [])
        self.assertIn("No search listings", payload["search_note"])
        self.assertIn("web_search_url", payload)

    def test_web_resource_rejects_non_web_urls(self):
        response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/web-resources",
            json={
                "title": "Local file",
                "url": "file:///etc/passwd",
                "file_type": "web link",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.content_type, "application/json")

    def test_folder_deletion_removes_its_files(self):
        self.client.post(
            f"/api/saved-folders/{self.folder_id}/files",
            data={"file": (io.BytesIO(b"notes"), "notes.txt")},
            content_type="multipart/form-data",
        )
        folder_path = (
            Path(app.config["SAVE_DATA_DIR"])
            / "admin"
            / "Folders"
            / self.folder_id
        )
        self.assertTrue(folder_path.is_dir())

        response = self.client.put("/api/saved-folders", json=[])

        self.assertEqual(response.status_code, 200)
        self.assertFalse(folder_path.exists())

    def test_upload_requires_a_signed_in_user(self):
        self.client.get("/logout")

        response = self.client.post(
            f"/api/saved-folders/{self.folder_id}/files",
            data={"file": (io.BytesIO(b"notes"), "notes.txt")},
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.content_type, "application/json")

    def test_study_resources_keeps_both_upload_choices(self):
        resource_page = self.client.get("/resources")
        self.assertEqual(resource_page.status_code, 200)
        self.assertIn(b"saved_folder_picker.js", resource_page.data)
        self.assertIn(b"resource_browser.js", resource_page.data)

        response = self.client.get("/resources?library=1")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-action="computer-upload"', response.data)
        self.assertIn(b'data-action="web-search"', response.data)
        self.assertIn(b'data-action="existing-notebook"', response.data)
        self.assertIn(b"api_response.js", response.data)


if __name__ == "__main__":
    unittest.main()
