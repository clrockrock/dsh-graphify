import { db } from './db.js';
import { verify } from './auth.js';

export function start(token) {
  verify(token);
  return db.connect();
}
