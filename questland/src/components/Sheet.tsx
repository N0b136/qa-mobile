import type { ReactNode } from 'react'

interface SheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export default function Sheet({ open, onClose, children }: SheetProps) {
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  )
}
