import * as React from 'react';
import { Icon } from './Icon';

export interface TrailStep {
  label: string;
  state?: 'complete' | 'current' | 'locked';
}

/**
 * Station/episode progress drawn as a walked path.
 */
export interface ProgressTrailProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: TrailStep[];
  /** Paints completed nodes and the connecting line in the questline colour. */
  track?: 'valor' | 'lore' | 'wilds' | 'forge' | 'gold';
  /** vertical is the app's station list; horizontal is the web episode strip. */
  orientation?: 'horizontal' | 'vertical';
  onStepClick?: (index: number, step: TrailStep) => void;
  /** Blurs the label text of locked steps so upcoming titles stay a spoiler-free surprise. */
  blurLocked?: boolean;
}

const TRACKS: Record<NonNullable<ProgressTrailProps['track']>, string> = {
  valor: 'var(--track-valor)', lore: 'var(--track-lore)', wilds: 'var(--track-wilds)', forge: 'var(--track-forge)', gold: 'var(--gold-600)',
};

/* Progress as a walked path: completed, current, locked nodes along a line. */
export function ProgressTrail({ steps = [], track = 'gold', orientation = 'horizontal', onStepClick, blurLocked = false, style, ...rest }: ProgressTrailProps) {
  const accent = TRACKS[track] || TRACKS.gold;
  const vertical = orientation === 'vertical';
  const doneCount = steps.filter(s => s.state === 'complete').length;
  return (
    <div style={{
      display: 'flex', flexDirection: vertical ? 'column' : 'row',
      alignItems: vertical ? 'stretch' : 'flex-start', position: 'relative', ...style,
    }} {...rest}>
      {steps.map((s, i) => {
        const done = s.state === 'complete';
        const current = s.state === 'current';
        const locked = s.state === 'locked' || (!done && !current);
        const color = done ? accent : current ? 'var(--gold-400)' : 'var(--status-locked)';
        return (
          <div key={i} style={{
            display: 'flex', flexDirection: vertical ? 'row' : 'column',
            alignItems: vertical ? 'flex-start' : 'center',
            gap: vertical ? 'var(--space-sm)' : 0,
            flex: vertical ? undefined : 1, minWidth: 0,
            paddingBottom: vertical ? (i === steps.length - 1 ? 0 : 'var(--space-lg)') : 0,
            position: 'relative',
          }}>
            {i < steps.length - 1 ? (
              <div style={{
                position: 'absolute',
                ...(vertical
                  ? { left: 13, top: 28, bottom: 0, width: 2 }
                  : { top: 13, left: '50%', width: '100%', height: 2 }),
                background: done ? accent : 'var(--stone-600)',
                borderTop: locked && !done ? '2px dashed var(--stone-600)' : undefined,
              }} />
            ) : null}
            <div
              onClick={locked || !onStepClick ? undefined : () => onStepClick(i, s)}
              style={{
                position: 'relative', zIndex: 1, width: 28, height: 28, borderRadius: '50%',
                display: 'grid', placeItems: 'center', flex: '0 0 auto',
                background: done ? accent : current ? 'var(--surface-card)' : 'var(--surface-inset)',
                border: '2px ' + (locked ? 'dashed' : 'solid') + ' ' + (current ? 'var(--gold-400)' : done ? accent : 'var(--stone-600)'),
                boxShadow: current ? 'var(--shadow-gold-glow)' : 'none',
                color: done ? 'var(--parchment-50)' : color,
                cursor: locked || !onStepClick ? 'default' : 'pointer',
                transition: 'var(--transition-control)',
              }}>
              <Icon name={done ? 'check' : locked ? 'lock' : 'map-pin'} size={14} strokeWidth={done ? 3 : 2} />
            </div>
            <div
              title={blurLocked && locked ? 'Locked episode' : undefined}
              aria-label={blurLocked && locked ? 'Locked episode' : undefined}
              style={{
                marginTop: vertical ? 3 : 'var(--space-xs)', minWidth: 0,
                textAlign: vertical ? 'left' : 'center',
                font: '700 var(--text-2xs)/1.3 var(--font-ui)',
                letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color,
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: vertical ? 'normal' : 'nowrap',
                ...(blurLocked && locked ? { filter: 'blur(4px)', userSelect: 'none' as const, pointerEvents: 'none' as const } : null),
              }}>{s.label}</div>
          </div>
        );
      })}
      <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {doneCount} of {steps.length} stations complete
      </span>
    </div>
  );
}
