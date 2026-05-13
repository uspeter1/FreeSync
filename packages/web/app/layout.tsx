import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FreeSync — The Google Docs for Obsidian',
  description: 'Real-time collaborative editing for Obsidian vaults. Live cursors, presence badges, Yjs CRDTs. Free and open source.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
