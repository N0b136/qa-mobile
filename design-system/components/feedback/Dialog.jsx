import React from 'react';
import { IconButton } from '../core/IconButton.jsx';
import { Ornament } from '../core/Ornament.jsx';

/* Modal. The one place blur + transparency is allowed on the backdrop. */
export function Dialog({ open = true, title, eyebrow, children, footer, onClose, ceremonial = false, width = 520, style, ...rest }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center',
        padding: 'var(--space-lg)', background: 'var(--surface-overlay)',
        backdropFilter: 'var(--blur-veil)', WebkitBackdropFilter: 'var(--blur-veil)',
        animation: 'qa-fade var(--dur-base) var(--ease-standard)',
      }}>
      <div
        role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width, position: 'relative',
          background: ceremonial ? 'var(--gradient-gold)' : 'var(--surface-card)',
          border: ceremonial ? 'var(--border-frame) solid transparent' : '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
          animation: 'qa-rise var(--dur-slow) var(--ease-out-door)',
          ...style,
        }}
        {...rest}>
        <div style={{
          background: 'var(--surface-card)',
          border: ceremonial ? '1px solid var(--stone-950)' : 0,
          padding: 'var(--space-xl)',
        }}>
          {onClose ? (
            <div style={{ position: 'absolute', top: 'var(--space-sm)', right: 'var(--space-sm)' }}>
              <IconButton icon="x" label="Close" size="sm" />
            </div>
          ) : null}
          {eyebrow ? <div className="qa-label" style={{ marginBottom: 'var(--space-xs)' }}>{eyebrow}</div> : null}
          {title ? (
            <h2 style={{
              font: '700 var(--text-2xl)/var(--leading-snug) var(--font-display)',
              letterSpacing: 'var(--tracking-display-tight)', textTransform: 'uppercase', color: 'var(--text-heading)',
            }}>{title}</h2>
          ) : null}
          {ceremonial ? <Ornament style={{ margin: 'var(--space-md) 0' }} /> : null}
          <div style={{ marginTop: ceremonial ? 0 : 'var(--space-md)', font: 'var(--body-lg)', color: 'var(--text-body)' }}>{children}</div>
          {footer ? (
            <div style={{ marginTop: 'var(--space-xl)', display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>{footer}</div>
          ) : null}
        </div>
      </div>
      <style>{'@keyframes qa-fade{from{opacity:0}to{opacity:1}}@keyframes qa-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}'}</style>
    </div>
  );
}
