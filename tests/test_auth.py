import unittest
from unittest.mock import patch

import requests

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

    def test_google_login_redirects_through_better_auth(self):
        client_id = app.config.get('GOOGLE_CLIENT_ID')
        client_secret = app.config.get('GOOGLE_CLIENT_SECRET')
        app.config['GOOGLE_CLIENT_ID'] = 'test-client-id'
        app.config['GOOGLE_CLIENT_SECRET'] = 'test-client-secret'
        upstream = requests.Response()
        upstream.status_code = 200
        upstream._content = b'{"url":"https://accounts.google.com/authorize"}'
        upstream.headers['Set-Cookie'] = 'oauth_state=test-state; Path=/'
        try:
            with patch('app.requests.post', return_value=upstream) as post:
                response = self.client.get('/auth/google?next=/settings')
        finally:
            app.config['GOOGLE_CLIENT_ID'] = client_id
            app.config['GOOGLE_CLIENT_SECRET'] = client_secret

        self.assertEqual(response.status_code, 302)
        self.assertEqual(
            response.headers.get('Location'),
            'https://accounts.google.com/authorize',
        )
        self.assertIn('oauth_state=test-state', response.headers.get('Set-Cookie'))
        self.assertEqual(
            post.call_args.kwargs['json']['callbackURL'],
            'http://localhost/settings',
        )

    def test_better_auth_session_allows_protected_page(self):
        upstream = requests.Response()
        upstream.status_code = 200
        upstream._content = b'{"user":{"id":"google-user"},"session":{"id":"session"}}'
        with patch('app.requests.get', return_value=upstream) as get_session:
            response = self.client.get(
                '/', headers={'Cookie': 'better-auth.session_token=session-token'}
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn('/api/auth/get-session', get_session.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
