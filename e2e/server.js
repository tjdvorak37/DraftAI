import { createApp } from '../server/index.js';
import { provisionInitialAdmin } from '../server/accounts.js';

const { app, db } = createApp({ databasePath: ':memory:' });
await provisionInitialAdmin(db, { name: 'Studio Tester', email: 'studio@example.test', password: 'isolated-test-password' });
app.listen(3002, '127.0.0.1', () => console.log('Isolated browser test server on 3002'));