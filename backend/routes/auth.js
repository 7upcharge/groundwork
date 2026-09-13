const { Router } = require('express');
const { handle, v, HttpError } = require('../lib/http');
const { sessionCookie, clearCookie } = require('../middleware/security');

function authRoutes({ auth, production, googleConfig }) {
  const router = Router();
  const setSession = (res, userId) => {
    const { token, expires } = auth.createSession(userId);
    res.set('Set-Cookie', sessionCookie(token, expires, production));
    return auth.getUser(userId);
  };

  router.get(
    '/me',
    handle(async (req, res) => {
      res.json({ user: req.user });
    })
  );

  const getRedirectUri = (req) => {
    const rawProto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const protocol = rawProto.toLowerCase().includes('https') ? 'https' : 'http';

    const rawHost = req.headers['x-forwarded-host'] || req.headers.host || '';
    const host = rawHost.split(',')[0].trim();

    return `${protocol}://${host}/api/auth/google/callback`;
  };

  router.get('/google', (req, res) => {
    if (!googleConfig || !googleConfig.clientId) {
      return res.status(500).json({ error: 'Google OAuth is not configured.' });
    }
    const redirectUri = getRedirectUri(req);

    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: googleConfig.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        prompt: 'select_account',
      }).toString();

    res.redirect(authUrl);
  });

  router.get('/google/callback', async (req, res) => {
    try {
      const { code, error } = req.query;
      if (error) throw new Error(`Google login error: ${error}`);
      if (!code) throw new Error('Authorization code missing.');

      const redirectUri = getRedirectUri(req);

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: googleConfig.clientId,
          client_secret: googleConfig.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange code with Google.');
      }

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json();
      if (!userRes.ok || !userData.email) {
        throw new Error('Failed to fetch user profile from Google.');
      }

      const userId = await auth.loginOrRegisterGoogle({ email: userData.email, name: userData.name });
      setSession(res, userId);
      res.redirect('/#/');
    } catch (err) {
      console.error('Google OAuth error:', err.message);
      res.redirect(`/#/login?error=${encodeURIComponent(err.message)}`);
    }
  });



  router.post(
    '/guest',
    handle(async (req, res) => {
      if (req.user) return res.json({ user: req.user });
      const userId = auth.createGuest();
      res.status(201).json({ user: setSession(res, userId) });
    })
  );

  router.post(
    '/register',
    handle(async (req, res) => {
      const email = v.email(req.body.email);
      const name = v.string(req.body.name, 'Name', { max: 80 });
      const password = v.string(req.body.password, 'Password', { max: 200 });

      let userId;
      if (req.user?.isGuest) {
        await auth.claimGuest(req.user.id, { email, password, name });
        userId = req.user.id;
      } else {
        userId = await auth.register({ email, password, name });
      }
      res.status(201).json({ user: setSession(res, userId) });
    })
  );

  router.post(
    '/login',
    handle(async (req, res) => {
      const email = v.email(req.body.email);
      const password = v.string(req.body.password, 'Password', { max: 200 });
      const userId = await auth.login({ email, password });
      res.json({ user: setSession(res, userId) });
    })
  );

  router.post(
    '/logout',
    handle(async (req, res) => {
      auth.destroySession(req.sessionToken);
      res.set('Set-Cookie', clearCookie(production));
      res.status(204).end();
    })
  );

  return router;
}

module.exports = { authRoutes };
