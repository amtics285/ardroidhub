// Words that are not allowed in reviews. Keep this in sync with BLOCKED_WORDS in bot/policy.py
// (tests/worker_test.mjs checks that every word there is also here).
export const BLOCKED_WORDS = [
  'porn', 'xxx', 'nude', 'nudes', 'sex video', 'escort', 'hentai', 'casino hack',
  'carding', 'ddos', 'keylogger', 'spyware', 'stalkerware', 'ransomware',
  'fuck', 'fucking', 'bitch', 'bastard', 'asshole', 'motherfucker',
  'madarchod', 'behenchod', 'bhenchod', 'chutiya', 'chutiye', 'gandu', 'harami',
  'bhosdi', 'bhosdike', 'gaand', 'kutta', 'kamina',
];

export function hasBlockedWord(text) {
  const t = String(text || '').toLowerCase();
  return BLOCKED_WORDS.some((w) => new RegExp('(?<![a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])').test(t));
}
