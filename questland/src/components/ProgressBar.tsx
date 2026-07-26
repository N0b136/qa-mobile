interface ProgressBarProps {
  value: number
  max: number
  color?: string
}

export default function ProgressBar({ value, max, color }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress-fill" style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />
    </div>
  )
}
