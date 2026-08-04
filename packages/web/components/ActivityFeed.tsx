'use client';

import { useEffect, useState } from 'react';
import { relay, RelayError } from '@/lib/relay';
import { THEME } from './theme';

interface ActivityEntry {
  vault_id: string;
  vault_name: string;
  file_path: string;
  last_edited_by: { userId: string; display_name: string; color: string };
  last_edited_at: number;
}

export function ActivityFeed() {
  const [items, setItems] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await relay<ActivityEntry[]>('/activity?limit=8');
        setItems(data);
      } catch (e) {
        setError(e instanceof RelayError ? e.message : String(e));
      }
    })();
  }, []);

  if (error) return null; // silent — activity is a "nice to have"; don't blow up the dashboard

  if (items === null) {
    return (
      <section style={styles.section}>
        <h2 style={styles.heading}>Recent activity</h2>
        <div style={styles.muted}>Loading…</div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section style={styles.section}>
        <h2 style={styles.heading}>Recent activity</h2>
        <div style={styles.muted}>Nothing yet — edits by anyone in your vaults will show up here.</div>
      </section>
    );
  }

  return (
    <section style={styles.section}>
      <h2 style={styles.heading}>Recent activity</h2>
      <ul style={styles.list}>
        {items.map((entry) => (
          <li key={`${entry.vault_id}-${entry.file_path}-${entry.last_edited_at}`}>
            <a href={`/dashboard/vaults/${entry.vault_id}`} style={styles.row}>
              <div style={{ ...styles.avatar, background: entry.last_edited_by.color }}>
                {(entry.last_edited_by.display_name[0] ?? '?').toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.line}>
                  <span style={styles.name}>{entry.last_edited_by.display_name}</span>
                  <span style={styles.muted2}> edited </span>
                  <span style={styles.file}>{fileLabel(entry.file_path)}</span>
                  <span style={styles.muted2}> in </span>
                  <span style={styles.vault}>{entry.vault_name}</span>
                </div>
                <div style={styles.time}>{relativeTime(entry.last_edited_at)}</div>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function fileLabel(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '');
}

function relativeTime(ts: number): string {
  const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

const styles: Record<string, React.CSSProperties> = {
  section: { marginBottom: 32 },
  heading: { fontSize: 12, fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  list: { listStyle: 'none', padding: 0, margin: 0 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    background: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    marginBottom: 6,
    textDecoration: 'none',
    color: THEME.text,
    transition: 'border-color 0.12s',
  },
  avatar: {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: '50%',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    fontSize: 13,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  name: { color: THEME.textBright, fontWeight: 500 },
  file: { color: THEME.link, fontWeight: 500 },
  vault: { color: THEME.textBright, fontWeight: 500 },
  time: { fontSize: 11, color: THEME.textMuted, marginTop: 1 },
  muted: { fontSize: 13, color: THEME.textMuted, padding: '8px 0' },
  muted2: { color: THEME.textMuted },
};
