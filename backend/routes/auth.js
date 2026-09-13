const { Router } = require('express');
const { handle, v } = require('../lib/http');
const { sessionCookie, clearCookie } = require('../middleware/security');

function authRoutes({ auth, production }) {
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
