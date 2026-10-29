import { pool } from './pool.js';

export const db = {
  connect: () => pool.acquire(),
  close: () => pool.release(),
};
