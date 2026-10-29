export function verify(token) {
  if (!token) throw new Error('missing token');
  return true;
}
