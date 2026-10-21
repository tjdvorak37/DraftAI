import bcrypt from 'bcryptjs';
import { z } from 'zod';

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(254).transform(value => value.toLowerCase()),
  address: z.string().trim().max(500).default(''),
  phone: z.string().trim().max(40).default(''),
  department: z.string().trim().max(80).default(''),
  jobTitle: z.string().trim().max(80).default(''),
  locationId: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,23}$/).default('MAIN'),
});
export const credentialsSchema = profileSchema.extend({ password: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes.') });

export async function provisionInitialAdmin(db, input) {
  const data = credentialsSchema.parse(input);
  const password = await bcrypt.hash(data.password, 12);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT id FROM users LIMIT 1').get()) throw new Error('Workspace already has accounts. An existing administrator must manage access.');
    const result = db.prepare('INSERT INTO users (name,email,password,role,address,phone,department,job_title) VALUES (?,?,?,?,?,?,?,?)').run(data.name, data.email, password, 'admin', data.address, data.phone, data.department, data.jobTitle);
    const id = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO audit (actor,action,detail) VALUES (?,?,?)').run(id, 'workspace.provision', JSON.stringify({ id, method: 'operator' }));
    db.exec('COMMIT');
    return id;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}