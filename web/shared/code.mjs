// 32 znaků: bez I, O, 0 a 1, aby kód šel přečíst z telefonu do telefonu.
// 256 / 32 = 8 → modulo nezkresluje rozdělení.
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHABET[b % 32]).join('');
