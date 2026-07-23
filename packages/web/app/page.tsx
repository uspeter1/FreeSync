'use client';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ObsidianShell } from '@/components/Shell';
import { HomePage } from '@/components/HomePage';
import { GettingStartedPage, DocsPage, SelfHostingPage, BlogPage } from '@/components/Pages';
import { GraphView } from '@/components/GraphView';
import { QuickSwitcher } from '@/components/QuickSwitcher';
import { supabase } from '@/lib/supabase';

export default function Page() {
  // Signed-in visitors go straight to the dashboard. Marketing home is for
  // logged-out visitors. Client-side redirect (matches useRequireSession's
  // pattern; no @supabase/ssr middleware installed).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.href = '/dashboard';
    });
  }, []);

  const [activeTab,    setActiveTab]    = useState('home');
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [graphOpen,    setGraphOpen]    = useState(false);
  const [qsOpen,       setQsOpen]       = useState(false);
  const [proTipCount,  setProTipCount]  = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleAddProTip = useCallback(() => {
    if (activeTab !== 'home') setActiveTab('home');
    setProTipCount(n => n + 1);
    setTimeout(() => {
      const container = contentRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    }, 80);
  }, [activeTab]);

  const handleNavigate = useCallback((node: { tab?: string; section?: string }) => {
    if (node.tab) setActiveTab(node.tab);
    if (node.section) {
      setTimeout(() => {
        const el = document.getElementById(node.section!);
        const c  = contentRef.current;
        if (el && c) c.scrollTop = el.offsetTop - 28;
      }, 60);
    }
  }, []);

  const extraTocItems = activeTab === 'home'
    ? Array.from({ length: proTipCount }, (_, i) => ({
        id: `sec-protip-${i + 1}`,
        label: `Pro Tip #${i + 1}`,
        depth: 0,
      }))
    : [];

  const renderPage = () => {
    switch (activeTab) {
      case 'getting-started': return <GettingStartedPage />;
      case 'docs':            return <DocsPage />;
      case 'self-hosting':    return <SelfHostingPage />;
      case 'blog':            return <BlogPage />;
      default:                return <HomePage proTipCount={proTipCount} />;
    }
  };

  return (
    <>
      <ObsidianShell
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        commentsOpen={commentsOpen}
        setCommentsOpen={setCommentsOpen}
        contentRef={contentRef}
        onGraphOpen={() => setGraphOpen(true)}
        onAddProTip={handleAddProTip}
        onQuickSwitcherOpen={() => setQsOpen(true)}
        extraTocItems={extraTocItems}
      >
        {renderPage()}
      </ObsidianShell>

      {graphOpen && (
        <GraphView
          onClose={() => setGraphOpen(false)}
          onNavigate={handleNavigate}
        />
      )}
      {qsOpen && (
        <QuickSwitcher
          onClose={() => setQsOpen(false)}
          onNavigate={node => { handleNavigate(node); setQsOpen(false); }}
        />
      )}
    </>
  );
}
