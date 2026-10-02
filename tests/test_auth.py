import unittest
import uuid
from unittest.mock import patch

from app import app, init_db


class AuthTests(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()
        init_db()

    def test_login_page_loads(self):
        response = self.client.get('/login')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(b'Google', response.data)

    def test_signup_page_loads(self):
        response = self.client.get('/signup')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Confirm password', response.data)

    def test_google_login_route_is_removed(self):
        response = self.client.get('/auth/google')
        self.assertEqual(response.status_code, 404)

    def test_valid_login_redirects_home(self):
        response = self.client.post(
            '/login',
            data={'username': 'admin', 'password': 'admin123'},
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers.get('Location'), '/')

    def test_signup_creates_account_and_starts_session(self):
        username = f'study_signup_{uuid.uuid4().hex}'
        response = self.client.post(
            '/signup',
            data={
                'username': username,
                'password': 'abcd',
                'password_confirmation': 'abcd',
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers.get('Location'), '/')

        self.client.get('/logout')
        response = self.client.post(
            '/login',
            data={'username': username, 'password': 'abcd'},
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 302)
        with self.client.session_transaction() as user_session:
            self.assertEqual(user_session['username'], username)

    def test_resources_search_uses_web_results(self):
        login_response = self.client.post(
            '/login',
            data={'username': 'admin', 'password': 'admin123'},
            follow_redirects=False,
        )
        self.assertEqual(login_response.status_code, 302)

        with patch('app.search_web', return_value=[{
            'title': 'Algebra Basics',
            'url': 'https://example.com/algebra',
            'description': 'Learn the basics of algebra with simple explanations.'
        }]):
            response = self.client.get('/resources?query=algebra')

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Search Engine Results', response.data)
        self.assertIn(b'Algebra Basics', response.data)

    def test_signup_rejects_duplicate_username(self):
        response = self.client.post(
            '/signup',
            data={
                'username': 'admin',
                'password': 'strong-password-123',
                'password_confirmation': 'strong-password-123',
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'already taken', response.data)

    def test_signup_rejects_mismatched_passwords(self):
        response = self.client.post(
            '/signup',
            data={
                'username': 'new_student',
                'password': 'strong-password-123',
                'password_confirmation': 'different-password-456',
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Passwords do not match', response.data)

    def test_protected_page_requires_username_password_session(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers.get('Location'), '/login?next=/')


if __name__ == '__main__':
    unittest.main()
