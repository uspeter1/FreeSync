'use client';
import React, { useRef, useEffect, useState } from 'react';
import { THEME } from './theme';

const GV_NODES = [
  { id: 'home',       label: 'Welcome',         primary: true,  r: 13, tab: 'home' },
  { id: 'collab',     label: 'Collaboration',   primary: false, r: 9,  tab: 'home', section: 'sec-syncing' },
  { id: 'features',   label: 'Features',        primary: false, r: 9,  tab: 'home', section: 'sec-features' },
  { id: 'pricing',    label: 'Pricing',         primary: false, r: 9,  tab: 'home', section: 'sec-pricing' },
  { id: 'opensource', label: 'Open Source',     primary: false, r: 9,  tab: 'home', section: 'sec-opensource' },
  { id: 'getstart',   label: 'Getting Started', primary: true,  r: 11, tab: 'getting-started' },
  { id: 'docs',       label: 'Docs',            primary: true,  r: 11, tab: 'docs' },
  { id: 'selfhost',   label: 'Self Hosting',    primary: true,  r: 11, tab: 'self-hosting' },
  { id: 'blog',       label: 'Blog',            primary: true,  r: 10, tab: 'blog' },
  { id: 'yjs',        label: 'Yjs / CRDTs',     primary: false, r: 7,  tab: 'docs' },
  { id: 'supabase',   label: 'Supabase',        primary: false, r: 7,  tab: 'docs' },
  { id: 'docker',     label: 'Docker',          primary: false, r: 7,  tab: 'self-hosting' },
  { id: 'cursors',    label: 'Live Cursors',    primary: false, r: 7,  tab: 'home', section: 'sec-syncing' },
  { id: 'crdt',       label: 'CRDT Engine',     primary: false, r: 7,  tab: 'blog' },
] as const;

const GV_EDGES: [string, string][] = [
  ['home','collab'],['home','features'],['home','pricing'],['home','opensource'],
  ['home','getstart'],['home','blog'],
  ['features','docs'],['features','yjs'],['features','cursors'],
  ['collab','cursors'],['collab','yjs'],
  ['getstart','docs'],['getstart','selfhost'],
  ['selfhost','docs'],['selfhost','docker'],['selfhost','supabase'],
  ['docs','yjs'],['docs','supabase'],
  ['blog','yjs'],['blog','crdt'],
  ['opensource','selfhost'],['yjs','crdt'],
];

type NavNode = { tab?: string; section?: string; label?: string };

interface GraphViewProps {
  onClose: () => void;
  onNavigate: (node: NavNode) => void;
}

export function GraphView({ onClose, onNavigate }: GraphViewProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef       = useRef<{ nodes: (typeof GV_NODES[number] & { x: number; y: number; vx: number; vy: number })[]; hovered: string | null } | null>(null);
  const animRef      = useRef<number>(0);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const W = container.clientWidth;
    const H = container.clientHeight;
    canvas.width  = W;
    canvas.height = H;

    const nodes = GV_NODES.map((n, i) => ({
      ...n,
      x: W/2 + Math.cos(i * 2*Math.PI / GV_NODES.length) * 190 + (Math.random()-.5)*30,
      y: H/2 + Math.sin(i * 2*Math.PI / GV_NODES.length) * 140 + (Math.random()-.5)*30,
      vx: 0, vy: 0,
    }));
    simRef.current = { nodes, hovered: null };

    const ctx = canvas.getContext('2d')!;
    let frame = 0;

    const tick = () => {
      if (!simRef.current) return;
      const { nodes, hovered: hov } = simRef.current;
      frame++;

      GV_EDGES.forEach(([s,t]) => {
        const a = nodes.find(n=>n.id===s), b = nodes.find(n=>n.id===t);
        if (!a||!b) return;
        const dx=b.x-a.x, dy=b.y-a.y, dist=Math.sqrt(dx*dx+dy*dy)||1;
        const force = (dist - 115) * 0.0055;
        const fx=dx/dist*force, fy=dy/dist*force;
        a.vx+=fx; a.vy+=fy; b.vx-=fx; b.vy-=fy;
      });

      for (let i=0;i<nodes.length;i++) {
        for (let j=i+1;j<nodes.length;j++) {
          const a=nodes[i],b=nodes[j];
          const dx=b.x-a.x, dy=b.y-a.y, dist=Math.sqrt(dx*dx+dy*dy)||1;
          const rep = -850/(dist*dist);
          const fx=dx/dist*rep, fy=dy/dist*rep;
          a.vx+=fx; a.vy+=fy; b.vx-=fx; b.vy-=fy;
        }
      }

      nodes.forEach(n => {
        n.vx += (W/2-n.x)*0.012; n.vy += (H/2-n.y)*0.012;
        n.vx *= 0.82; n.vy *= 0.82;
        n.x  += n.vx; n.y  += n.vy;
      });

      ctx.clearRect(0,0,W,H);
      ctx.fillStyle = '#08080f'; ctx.fillRect(0,0,W,H);

      ctx.fillStyle = 'rgba(124,92,252,0.1)';
      for (let i=0;i<90;i++) {
        const px=(Math.sin(i*137.508+0.1)*0.5+0.5)*W;
        const py=(Math.cos(i*137.508+1.3)*0.5+0.5)*H;
        ctx.beginPath(); ctx.arc(px,py,1,0,Math.PI*2); ctx.fill();
      }

      ctx.strokeStyle='rgba(124,92,252,0.04)'; ctx.lineWidth=1;
      for (let x=0;x<W;x+=48){ ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke(); }
      for (let y=0;y<H;y+=48){ ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke(); }

      GV_EDGES.forEach(([s,t]) => {
        const a=nodes.find(n=>n.id===s), b=nodes.find(n=>n.id===t);
        if (!a||!b) return;
        const isHi = hov && (hov===s||hov===t);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
        ctx.strokeStyle = isHi ? 'rgba(124,92,252,0.75)' : 'rgba(124,92,252,0.18)';
        ctx.lineWidth = isHi ? 1.5 : 1; ctx.stroke();
      });

      nodes.forEach(n => {
        const isHov = hov === n.id;
        const r = n.r + (isHov ? 2 : 0);
        const pulse = 1 + Math.sin(frame*0.04 + n.id.length)*0.15;
        const grd = ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,r*3.8*pulse);
        grd.addColorStop(0, n.primary ? 'rgba(124,92,252,0.45)' : 'rgba(124,92,252,0.22)');
        grd.addColorStop(1,'rgba(124,92,252,0)');
        ctx.beginPath(); ctx.arc(n.x,n.y,r*3.8*pulse,0,Math.PI*2);
        ctx.fillStyle=grd; ctx.fill();

        ctx.beginPath(); ctx.arc(n.x,n.y,r,0,Math.PI*2);
        ctx.fillStyle = isHov ? '#a990ff' : (n.primary ? '#7c5cfc' : '#3d2e78');
        ctx.fill();
        if (isHov) {
          ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=1.5; ctx.stroke();
        }

        ctx.fillStyle = isHov ? '#fff' : (n.primary ? '#d4d4d4' : '#777');
        ctx.font = `${n.primary?'600':'400'} ${n.primary?12:10}px system-ui,sans-serif`;
        ctx.textAlign='center';
        ctx.fillText(n.label, n.x, n.y + r + 14);
      });

      animRef.current = requestAnimationFrame(tick);
    };
    tick();

    const getNode = (e: MouseEvent) => {
      const nodes = simRef.current?.nodes || [];
      const rect = canvas.getBoundingClientRect();
      const mx=(e.clientX-rect.left)*(W/rect.width);
      const my=(e.clientY-rect.top)*(H/rect.height);
      return nodes.find(n=>{ const dx=n.x-mx,dy=n.y-my; return Math.sqrt(dx*dx+dy*dy)<n.r+10; });
    };

    const onMove = (e: MouseEvent) => {
      const n = getNode(e);
      if (simRef.current) simRef.current.hovered = n?.id||null;
      setHovered(n?.id||null);
      canvas.style.cursor = n ? 'pointer' : 'default';
    };
    const onClick = (e: MouseEvent) => {
      const n = getNode(e);
      if (n) { onNavigate(n); onClose(); }
    };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
    };
  }, [onClose, onNavigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key==='Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hovNode = GV_NODES.find(n=>n.id===hovered);

  return (
    <div style={{ position:'fixed',inset:0,zIndex:200,background:'rgba(0,0,0,0.82)',
      display:'flex',alignItems:'center',justifyContent:'center' }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}
    >
      <div ref={containerRef} style={{
        position:'relative', width:'82vw', height:'76vh',
        borderRadius:12, overflow:'hidden',
        border:`1px solid ${THEME.border}`, background:'#08080f',
        boxShadow:'0 0 60px rgba(124,92,252,0.15)',
      }}>
        <canvas ref={canvasRef} style={{ width:'100%',height:'100%',display:'block' }} />
        <div style={{ position:'absolute',top:0,left:0,right:0,
          padding:'12px 16px', display:'flex',alignItems:'center',
          justifyContent:'space-between',
          background:'linear-gradient(to bottom, rgba(8,8,15,0.9) 0%, transparent 100%)',
        }}>
          <span style={{ fontSize:10,fontWeight:700,letterSpacing:'0.12em',
            color:'rgba(255,255,255,0.4)',fontFamily:"'Courier New',monospace" }}>
            GRAPH VIEW — FREESYNC
          </span>
          <button onClick={onClose} style={{
            background:'rgba(255,255,255,0.07)',border:`1px solid ${THEME.border}`,
            borderRadius:5,padding:'4px 10px',color:THEME.textMuted,
            cursor:'pointer',fontSize:12,fontFamily:"'Courier New',monospace",
          }}>esc</button>
        </div>
        <div style={{
          position:'absolute',bottom:14,left:16,
          fontSize:12,color:'rgba(255,255,255,0.5)',
          fontFamily:"'Courier New',monospace",
          transition:'opacity 0.2s', opacity: hovNode ? 1 : 0.3,
        }}>
          {hovNode ? `→ click to navigate to "${hovNode.label}"` : 'hover nodes to explore'}
        </div>
      </div>
    </div>
  );
}
