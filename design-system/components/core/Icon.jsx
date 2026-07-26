import React from 'react';

const CDN = 'https://unpkg.com/lucide@0.469.0/dist/umd/lucide.js';
let loading = null;
function ensureLucide(cb){
  if (typeof window === 'undefined') return;
  if (window.lucide && window.lucide.icons) return cb();
  if (!loading) {
    loading = new Promise(res => {
      const s = document.createElement('script');
      s.src = CDN; s.onload = res; s.onerror = res;
      document.head.appendChild(s);
    });
  }
  loading.then(cb);
}
const pascal = n => String(n).split(/[-_]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');

/* Lucide outline glyph, 2px stroke, currentColor. The only icon primitive in the system. */
export function Icon({ name, size = 24, strokeWidth = 2, style, ...rest }) {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => { ensureLucide(force); }, [name]);
  const lib = typeof window !== 'undefined' && window.lucide && window.lucide.icons;
  const node = lib && (lib[pascal(name)] || lib[name]);
  let kids = [];
  if (Array.isArray(node)) {
    /* Lucide UMD gives ["svg", attrs, children]; some builds give a flat child array. */
    kids = (typeof node[0] === 'string' && Array.isArray(node[2])) ? node[2] : node;
  } else if (node) {
    kids = node.children || [];
  }
  return (
    <svg
      aria-hidden="true"
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flex: '0 0 auto', ...style }} {...rest}>
      {kids.map((k, i) => {
        const tag = Array.isArray(k) ? k[0] : k && k.tag;
        const attrs = Array.isArray(k) ? k[1] : k && k.attrs;
        if (typeof tag !== 'string') return null;
        return React.createElement(tag, { key: i, ...attrs });
      })}
    </svg>
  );
}
