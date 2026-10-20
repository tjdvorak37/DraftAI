import { input, password } from '@inquirer/prompts';
import { createApp } from './index.js';
import { provisionInitialAdmin } from './accounts.js';

const { db } = createApp();
try {
  if (db.prepare('SELECT id FROM users LIMIT 1').get()) throw new Error('Workspace already has accounts. Use Admin Center to manage users.');
  console.log('Provision the first administrator. Credentials are entered locally and are not logged.');
  const name = await input({ message: 'Administrator full name:' });
  const email = await input({ message: 'Administrator work email:' });
  const secret = await password({ message: 'Password (12-72 characters):', mask: '*' });
  const confirmation = await password({ message: 'Confirm password:', mask: '*' });
  if (secret !== confirmation) throw new Error('Passwords do not match. No account was created.');
  await provisionInitialAdmin(db, { name, email, password: secret });
  console.log('Administrator created. Sign in, complete the user profile, and enable two-factor authentication.');
} catch (error) {
  console.error(error.issues?.map(issue => issue.message).join(' ') || error.message);
  process.exitCode = 1;
} finally { db.close(); }