'use client';

import { type ReactNode } from 'react';
import { useRequireSession } from '@/lib/session';
import { AppShell } from '@/components/AppShell';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const session = useRequireSession();
  if (!session) return null;
  return <AppShell session={session}>{children}</AppShell>;
}
