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

    def test_valid_login_redirects_home(self):
        response = self.client.post(
            '/login',
            data={'username': 'admin', 'password': 'admin123'},
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers.get('Location'), '/')

    def test_google_login_requires_client_credentials(self):
        client_id = app.config.get('GOOGLE_CLIENT_ID')
        client_secret = app.config.get('GOOGLE_CLIENT_SECRET')
        app.config['GOOGLE_CLIENT_ID'] = None
        app.config['GOOGLE_CLIENT_SECRET'] = None
        try:
            response = self.client.get('/auth/google')
        finally:
            app.config['GOOGLE_CLIENT_ID'] = client_id
            app.config['GOOGLE_CLIENT_SECRET'] = client_secret

        self.assertEqual(response.status_code, 503)
        self.assertIn(b'Google sign-in is not configured', response.data)


if __name__ == '__main__':
    unittest.main()
