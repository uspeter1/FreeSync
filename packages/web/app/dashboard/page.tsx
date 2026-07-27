'use client';

import { DashboardVaultList } from '@/components/DashboardVaultList';

// Thin wrapper around the shared DashboardVaultList component. This route
// gets its chrome from app/dashboard/layout.tsx (AppShell). The marketing
// shell (components/Shell.tsx) also renders <DashboardVaultList /> inline
// as a tab when the user is signed in.
export default function DashboardHome() {
  return <DashboardVaultList />;
}
