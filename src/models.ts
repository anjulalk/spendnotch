const tints: [RegExp, string][] = [
  [/^claude/, '#d97757'],
  [/^(gpt|o\d|codex)/, '#10a37f'],
  [/^gemini/, '#4796e3'],
  [/^grok/, '#d4d4d8'],
  [/^mai/, '#7fba00'],
  [/^kimi/, '#a78bfa'],
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
