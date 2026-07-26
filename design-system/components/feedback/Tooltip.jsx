import React from 'react';

/* Small parchment note on hover. Never contains an action. */
export function Tooltip({ label, children, side = 'top', style, ...rest }) {
  const [show, setShow] = React.useState(false);
  const pos = side === 'bottom'
    ? { top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' }
    : { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' };
  return (
    <span
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)} onBlur={() => setShow(false)}
      style={{ position: 'relative', display: 'inline-flex', ...style }} {...rest}>
      {children}
      {show ? (
        <span role="tooltip" style={{
          position: 'absolute', ...pos, zIndex: 50, whiteSpace: 'nowrap',
          padding: '6px var(--space-xs)', background: 'var(--parchment-100)',
          color: 'var(--text-on-parchment)', border: '1px solid var(--border-parchment)',
          borderRadius: 'var(--radius-xs)', boxShadow: 'var(--shadow-md)',
          font: '400 var(--text-xs)/1.2 var(--font-ui)',
          animation: 'qa-tip var(--dur-fast) var(--ease-standard)',
        }}>{label}</span>
      ) : null}
      <style>{'@keyframes qa-tip{from{opacity:0;transform:translateX(-50%) translateY(4px)}}'}</style>
    </span>
  );
}
