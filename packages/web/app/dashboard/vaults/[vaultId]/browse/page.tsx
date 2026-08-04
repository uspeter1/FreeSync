'use client';

import { useEffect, useState, use } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { relay, RelayError } from '@/lib/relay';
import type { Vault } from '@/lib/types';
import { THEME } from '@/components/theme';

interface Props {
  params: Promise<{ vaultId: string }>;
}

interface FileEntry {
  path: string;
  kind: 'markdown' | 'canvas' | 'binary' | 'text';
  lastEditedBy: { userId: string; display_name: string; color: string } | null;
  lastEditedAt: number | null;
}

interface FileContent {
  path: string;
  kind: 'markdown' | 'canvas' | 'binary' | 'text';
  content?: string;
  storage_key?: string | null;
  signed_url?: string | null;
  image_kind?: 'image' | 'pdf' | 'audio' | 'video' | null;
  not_yet_synced?: boolean;
}

export default function VaultBrowse({ params }: Props) {
  const { vaultId } = use(params);
  const [vault, setVault] = useState<Vault | null>(null);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  // Load vault + file list
  useEffect(() => {
    void (async () => {
      try {
        const [vaults, fileList] = await Promise.all([
          relay<Vault[]>('/vaults'),
          relay<FileEntry[]>(`/vaults/${vaultId}/files`),
        ]);
        const v = vaults.find((x) => x.id === vaultId);
        if (!v) { setError('Vault not found or you are no longer a member.'); return; }
        setVault(v);
        setFiles(fileList);
        // Auto-select first markdown file if any
        const firstMd = fileList.find((f) => f.kind === 'markdown');
        if (firstMd) setSelected(firstMd.path);
      } catch (e) {
        setError(e instanceof RelayError ? e.message : String(e));
      }
    })();
  }, [vaultId]);

  // Load content when selection changes
  useEffect(() => {
    if (!selected) { setContent(null); return; }
    setLoadingContent(true);
    setContent(null);
    void (async () => {
      try {
        const c = await relay<FileContent>(`/vaults/${vaultId}/files/${encodeURIComponent(selected)}`);
        setContent(c);
      } catch (e) {
        setError(e instanceof RelayError ? e.message : String(e));
      } finally {
        setLoadingContent(false);
      }
    })();
  }, [vaultId, selected]);

  if (error && !vault) {
    return (
      <div>
        <a href="/dashboard" style={styles.back}>← All vaults</a>
        <div style={styles.errorBox}>{error}</div>
      </div>
    );
  }
  if (!vault || !files) {
    return <div style={{ color: THEME.textMuted, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div>
      <a href={`/dashboard/vaults/${vaultId}`} style={styles.back}>← {vault.name} settings</a>
      <div style={styles.titleRow}>
        <h1 style={styles.pageTitle}>{vault.name}</h1>
        <div style={styles.muted}>{files.length} file{files.length === 1 ? '' : 's'}</div>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      <div style={styles.split}>
        {/* Left: folder tree */}
        <aside style={styles.sidebar}>
          {files.length === 0 && (
            <div style={styles.emptyList}>No files in this vault yet.</div>
          )}
          {files.length > 0 && (
            <FolderTree
              root={buildTree(files)}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </aside>

        {/* Right: preview */}
        <main style={styles.preview}>
          {!selected && (
            <div style={styles.previewPlaceholder}>Select a file to preview.</div>
          )}
          {selected && loadingContent && (
            <div style={styles.muted}>Loading…</div>
          )}
          {selected && content && !loadingContent && (
            <FileContentView content={content} />
          )}
        </main>
      </div>
    </div>
  );
}

function FileContentView({ content }: { content: FileContent }) {
  if (content.kind === 'binary') {
    return <BinaryPreview content={content} />;
  }

  const text = content.content ?? '';
  if (content.not_yet_synced) {
    return (
      <div style={styles.muted}>
        This file exists in the vault but hasn&apos;t been opened by any FreeSync-connected
        Obsidian session yet, so no cached content is available in the browser. Open the file
        in Obsidian once with FreeSync running to sync its content.
      </div>
    );
  }
  if (text.trim().length === 0) {
    return <div style={styles.muted}>(empty file)</div>;
  }

  if (content.kind === 'markdown') {
    return (
      <div style={styles.markdown}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    );
  }

  return <pre style={styles.raw}>{text}</pre>;
}

function BinaryPreview({ content }: { content: FileContent }) {
  const url = content.signed_url;
  const kind = content.image_kind ?? null;
  const name = content.path.split('/').pop() ?? content.path;

  if (!url) {
    return (
      <div style={styles.muted}>
        Binary file — no preview available.
        {content.storage_key && (
          <div style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 8, color: THEME.textMuted }}>
            {content.storage_key}
          </div>
        )}
      </div>
    );
  }

  if (kind === 'image') {
    return (
      <div style={styles.mediaWrap}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} style={styles.image} />
        <div style={styles.caption}>{name}</div>
      </div>
    );
  }
  if (kind === 'video') {
    return (
      <div style={styles.mediaWrap}>
        <video src={url} controls style={styles.image} />
        <div style={styles.caption}>{name}</div>
      </div>
    );
  }
  if (kind === 'audio') {
    return (
      <div style={styles.mediaWrap}>
        <audio src={url} controls style={{ width: '100%' }} />
        <div style={styles.caption}>{name}</div>
      </div>
    );
  }
  if (kind === 'pdf') {
    return (
      <div style={styles.mediaWrap}>
        <embed src={url} type="application/pdf" style={{ width: '100%', height: '75vh', border: 'none' }} />
        <div style={styles.caption}>{name}</div>
      </div>
    );
  }
  return (
    <div style={styles.muted}>
      Binary file — <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: THEME.link }}>download</a>.
    </div>
  );
}

function iconFor(kind: FileEntry['kind']): string {
  switch (kind) {
    case 'markdown': return '📄';
    case 'canvas':   return '🗺';
    case 'binary':   return '📎';
    default:         return '📃';
  }
}

// ── Folder tree ─────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;             // full path from root, for keying
  file?: FileEntry;         // present iff this is a leaf
  children: Map<string, TreeNode>;
}

function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() };
  for (const f of files) {
    const parts = f.path.split('/');
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      let child = cursor.children.get(name);
      if (!child) {
        const childPath = cursor.path ? `${cursor.path}/${name}` : name;
        child = { name, path: childPath, children: new Map() };
        cursor.children.set(name, child);
      }
      if (isLast) child.file = f;
      cursor = child;
    }
  }
  return root;
}

function FolderTree({
  root,
  selected,
  onSelect,
}: {
  root: TreeNode;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <ul style={styles.fileList}>
      {sortedChildren(root).map((child) => (
        <TreeItem key={child.path} node={child} depth={0} selected={selected} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function TreeItem({
  node, depth, selected, onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const isFolder = !node.file;
  const [open, setOpen] = useState(true);   // folders default expanded
  const indent = 10 + depth * 14;

  if (isFolder) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            ...styles.fileRow,
            paddingLeft: indent,
            background: 'transparent',
            color: THEME.textBright,
            fontWeight: 500,
          }}
        >
          <span style={{ ...styles.chevron, transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
          <span style={styles.filePath}>{node.name}</span>
        </button>
        {open && (
          <ul style={{ ...styles.fileList, marginLeft: 0 }}>
            {sortedChildren(node).map((child) => (
              <TreeItem key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const f = node.file!;
  const isSelected = selected === f.path;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(f.path)}
        style={{
          ...styles.fileRow,
          paddingLeft: indent + 12,   // align past the chevron column
          background: isSelected ? THEME.accentSoft : 'transparent',
          color: isSelected ? THEME.link : THEME.text,
        }}
      >
        <span style={styles.fileIcon}>{iconFor(f.kind)}</span>
        <span style={styles.filePath}>{displayLeafName(node.name, f.kind)}</span>
      </button>
    </li>
  );
}

function sortedChildren(node: TreeNode): TreeNode[] {
  const kids = [...node.children.values()];
  kids.sort((a, b) => {
    const aFolder = !a.file, bFolder = !b.file;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;   // folders first
    return a.name.localeCompare(b.name);
  });
  return kids;
}

// Trim .md for cleaner display, keep other extensions.
function displayLeafName(name: string, kind: FileEntry['kind']): string {
  if (kind === 'markdown' && name.toLowerCase().endsWith('.md')) return name.slice(0, -3);
  return name;
}

const styles: Record<string, React.CSSProperties> = {
  back: { display: 'inline-block', marginBottom: 16, fontSize: 13, color: THEME.textMuted, textDecoration: 'none' },
  titleRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 },
  pageTitle: { fontSize: 24, fontWeight: 600, color: THEME.textBright, fontFamily: 'Georgia, serif' },
  muted: { fontSize: 12, color: THEME.textMuted },
  split: {
    display: 'grid',
    gridTemplateColumns: 'minmax(200px, 260px) 1fr',
    gap: 20,
    minHeight: 'calc(100vh - 220px)',
  },
  sidebar: {
    padding: 8,
    background: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    maxHeight: 'calc(100vh - 220px)',
    overflow: 'auto',
  },
  emptyList: { padding: 12, fontSize: 12, color: THEME.textMuted, textAlign: 'center' },
  fileList: { listStyle: 'none', padding: 0, margin: 0 },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: 13,
    color: THEME.text,
  },
  fileIcon: { fontSize: 14, opacity: 0.7, flexShrink: 0 },
  filePath: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
  chevron: {
    display: 'inline-block',
    fontSize: 10,
    color: THEME.textMuted,
    width: 10,
    flexShrink: 0,
    transition: 'transform 0.12s',
  },
  preview: {
    padding: 24,
    background: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    overflow: 'auto',
  },
  previewPlaceholder: {
    fontSize: 13,
    color: THEME.textMuted,
    padding: 24,
    textAlign: 'center',
  },
  markdown: {
    fontSize: 14,
    lineHeight: 1.6,
    color: THEME.text,
  },
  raw: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'ui-monospace, "SF Mono", monospace',
    fontSize: 12,
    color: THEME.text,
    margin: 0,
  },
  mediaWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  image: { maxWidth: '100%', maxHeight: '75vh', display: 'block', borderRadius: 6 },
  caption: { fontSize: 11, color: THEME.textMuted },
  errorBox: {
    padding: '10px 14px',
    background: 'rgba(244,114,182,0.08)',
    border: `1px solid ${THEME.pink}`,
    color: THEME.pink,
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 16,
  },
};
