const tints: [RegExp, string][] = [
  [/claude/i, '#d97757'],
  [/(^|\/)(gpt|o\d|codex)/i, '#10a37f'],
  [/gemini/i, '#4796e3'],
  [/grok/i, '#d4d4d8'],
  [/(^|\/)mai/i, '#7fba00'],
  [/kimi/i, '#a78bfa'],
]

export const tint = (m: string) => tints.find(([r]) => r.test(m))?.[1] ?? '#8b949e'

export const label = (m: string) =>
  m
    ? m
        .split('-')
        .map((p) => (p === 'gpt' ? 'GPT' : p.charAt(0).toUpperCase() + p.slice(1)))
        .join(' ')
        .replace(/^GPT /, 'GPT-')
    : 'Others'
