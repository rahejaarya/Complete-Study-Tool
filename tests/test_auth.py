import unittest

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

    def test_protected_page_requires_username_password_session(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers.get('Location'), '/login?next=/')


if __name__ == '__main__':
    unittest.main()
