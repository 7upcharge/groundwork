const { hashPassword, verifyPassword } = require('../services/auth');
const { openDatabase } = require('../db');
const { createAuthService } = require('../services/auth');

async function run({ test, assert }) {
  await test('hashPassword/verifyPassword: correct password verifies, wrong password does not', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.ok(await verifyPassword('correct horse battery staple', hash));
    assert.strictEqual(await verifyPassword('wrong password', hash), false);
  });

  await test('hashPassword: two hashes of the same password differ (salted)', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    assert.notStrictEqual(a, b);
  });

  await test('auth service: register + login round-trip', async () => {
    const db = openDatabase(':memory:');
    const auth = createAuthService(db, { sessionDays: 30 });
    const userId = await auth.register({ email: 'a@example.com', password: 'password123', name: 'A' });
    const loggedIn = await auth.login({ email: 'a@example.com', password: 'password123' });
    assert.strictEqual(loggedIn, userId);
  });

  await test('auth service: login fails with wrong password without leaking whether the email exists', async () => {
    const db = openDatabase(':memory:');
    const auth = createAuthService(db, { sessionDays: 30 });
    await auth.register({ email: 'a@example.com', password: 'password123', name: 'A' });
    await assert.rejects(() => auth.login({ email: 'a@example.com', password: 'wrong' }), (e) => e.code === 'bad_credentials');
    await assert.rejects(() => auth.login({ email: 'nobody@example.com', password: 'password123' }), (e) => e.code === 'bad_credentials');
  });

  await test('auth service: registering the same email twice is rejected', async () => {
    const db = openDatabase(':memory:');
    const auth = createAuthService(db, { sessionDays: 30 });
    await auth.register({ email: 'a@example.com', password: 'password123', name: 'A' });
    await assert.rejects(() => auth.register({ email: 'a@example.com', password: 'password456', name: 'B' }), (e) => e.code === 'email_taken');
  });

  await test('auth service: session token round-trips to the right user and survives token hashing', () => {
    const db = openDatabase(':memory:');
    const auth = createAuthService(db, { sessionDays: 30 });
    const userId = auth.createGuest();
    const { token } = auth.createSession(userId);
    const user = auth.userForToken(token);
    assert.strictEqual(user.id, userId);
    assert.strictEqual(user.isGuest, true);
    assert.strictEqual(auth.userForToken('not-a-real-token'), null);
  });

  await test('auth service: destroyed session is no longer valid', () => {
    const db = openDatabase(':memory:');
    const auth = createAuthService(db, { sessionDays: 30 });
    const userId = auth.createGuest();
    const { token } = auth.createSession(userId);
    auth.destroySession(token);
    assert.strictEqual(auth.userForToken(token), null);
  });

  await test('auth service: claiming a guest account keeps the same user id', async () => {
    const db = openDatabase(':memory:');
    const auth = createAuthService(db, { sessionDays: 30 });
    const guestId = auth.createGuest();
    await auth.claimGuest(guestId, { email: 'guest@example.com', password: 'password123', name: 'Real Name' });
    const loggedIn = await auth.login({ email: 'guest@example.com', password: 'password123' });
    assert.strictEqual(loggedIn, guestId);
  });
}

module.exports = { run };
