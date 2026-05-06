# Design System

## Color Palette

```typescript
const theme = {
  bg:          '#0f0f0f',   // Page background
  surface:     '#1a1a1a',   // Card / panel background
  surfaceHigh: '#242424',   // Elevated surface (modal, input bg)
  border:      '#2e2e2e',   // Borders, dividers
  accent:      '#7c5cfc',   // Primary action color (purple)
  accentGlow:  '#7c5cfc44', // Accent with 27% opacity (glow effects)
  text:        '#f0f0f0',   // Primary text
  textMuted:   '#888',      // Secondary text
  textDim:     '#555',      // Placeholder, disabled
  green:       '#4ade80',   // Success, active, online
  amber:       '#fbbf24',   // Warning, pending
  pink:        '#f472b6',   // First palette color
  blue:        '#60a5fa',   // Second palette color
};
```

## Collaborator Color Palette

7 colors assigned at registration by `userCount % 7`:

```
#f472b6  (pink)
#60a5fa  (blue)
#4ade80  (green)
#fb923c  (orange)
#a78bfa  (light purple)
#f59e0b  (amber)
#34d399  (emerald)
```

## Typography

```css
/* Headings */
font-family: Georgia, serif;

/* Labels, monospace elements */
font-family: 'Courier New', monospace;

/* Body, UI */
font-family: -apple-system, 'SF Pro Display', BlinkMacSystemFont, sans-serif;
```

## Border Radius

```
Cards:           12–16px
Inputs/Buttons:  10–13px
Pills/Tags:      20px (fully rounded)
Avatars:         50% (circles)
```

## Spacing

Multiples of 4px. Common values: 4, 8, 12, 16, 20, 24, 32, 48.

## Component Specifications

### Avatar (initials badge)
- Size: 28–32px circle
- Background: collaborator color
- Text: 2-char initials, white, 11–12px, bold
- Border: 1.5px solid rgba(255,255,255,0.2)

### Presence Badge (Obsidian file explorer)
- Rendered via `box-shadow: inset 3px 0 0 <color>` on `.tree-item-inner`
- Avatar appended inside `.tree-item-inner`, float right
- Size: 20px circle, 9px text

### Primary Button
- Background: `theme.accent` (#7c5cfc)
- Radius: 12px
- Padding: 14px 20px
- Font: 15px semibold
- Hover: brightness(1.1)
- Active: scale(0.98)

### Input Field
- Background: `theme.surfaceHigh`
- Border: 1px solid `theme.border`
- Focus border: `theme.accent`
- Radius: 12px
- Padding: 14px 16px

### Card / Surface
- Background: `theme.surface`
- Border: 1px solid `theme.border`
- Radius: 16px
- Padding: 20–24px

## Mobile Reference

The complete UI reference is at:
`packages/app/prototype/freesync-prototype.jsx`

Mobile Frontend Engineer must match this exactly. Screen list:
1. Onboarding
2. Sign Up
3. Sign In
4. Vault List
5. Share Vault
6. Obsidian Plugin Preview (informational)
7. Upgrade (pricing)
8. Account Settings
9. Self-Hosted Servers

Navigation: expo-router stack navigator.

## Obsidian Plugin UI

Plugin renders into Obsidian's dark theme. Match Obsidian's existing dark palette where possible, overlay FreeSync accent (#7c5cfc) for presence indicators only. Never fight Obsidian's layout with absolute positioning or border-based tricks.
