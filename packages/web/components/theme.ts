export const THEME = {
  bg:          '#0f0f0f',
  surface:     '#1a1a1a',
  surfaceHigh: '#242424',
  border:      '#2a2a2a',
  borderMid:   '#333',
  accent:      '#7c5cfc',
  accentSoft:  'rgba(124,92,252,0.14)',
  text:        '#d4d4d4',
  textBright:  '#efefef',
  textMuted:   '#6a6a6a',
  textFaint:   '#444',
  green:       '#4ade80',
  amber:       '#fbbf24',
  link:        '#a78bfa',
  pink:        '#f472b6',
} as const;

export type User = { name: string; initials: string; color: string };

export const USERS: { alex: User; maya: User; sam: User } = {
  alex: { name: 'Alex', initials: 'A', color: '#60a5fa' },
  maya: { name: 'Maya', initials: 'M', color: '#f472b6' },
  sam:  { name: 'Sam',  initials: 'S', color: '#4ade80' },
};

export const YOU: User = { name: 'You', initials: '●', color: THEME.accent };
export const PRESENCE_POOL: User[] = [USERS.alex, USERS.maya];
