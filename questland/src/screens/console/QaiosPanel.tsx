import type { CSSProperties } from 'react'
import { Card, Icon } from '../../ui'

// The QAios tab — version one, and deliberately the smallest thing that works.
//
// ── WHY THIS OPENS A URL INSTEAD OF EMBEDDING THE VAULT ─────────────────────
//
// QAios (the Questland Adventures operating system — the board, the pulse, the
// decision ledger, the Brain and Library maps) is served by its own authenticated
// server, from its own repository, behind its own role gate. Two things follow,
// and both are the reason this file is short:
//
// · This console is a PUBLIC repository deployed to GitHub Pages. Nothing here
//   may carry vault content, and nothing here does: the only vault-shaped thing
//   in this file is a URL, and that URL serves a sign-in screen to anyone who is
//   not on the roster. No board rows, no pulse text, no decisions — not even
//   cached. The workstream's own note says it plainly: the tab carries no vault
//   content.
//
// · Embedding QAios properly means handing this console's session across to it,
//   and today those are two different identities — staff sign in here with email
//   and password, while the vault roster is keyed by a Google uid. One person,
//   two accounts. Unifying them is a migration on a live app (WS-029), and the
//   ruling of 2026-09-04 sequenced it on its own rather than letting it block
//   this. So version one hands the person to QAios and lets QAios ask who they
//   are. Version two is the embedded Brain tab, after WS-029.
//
// The practical upshot for whoever is reading this on their phone: tapping
// through means signing in again, with Google. That is not a bug, and the panel
// says so out loud — an unexplained second sign-in reads as one.

/**
 * The live QAios. Not a secret: the server authenticates every request and shows
 * a stranger a sign-in screen and nothing else. But it is the one piece of the
 * vault platform named in this public repo, so it is named exactly once, here.
 */
const QAIOS_URL = 'https://qa-vault-server-448540125981.us-central1.run.app'

// Primary-Button look, hand-rolled on a real <a href>, for the same reason
// HelpScreen's call line is: Button's `as="a"` variant has no href in its prop
// type. Widening that shared primitive is a change to a component every screen
// uses, so it belongs in its own PR rather than riding along inside a feature.
//
// A real link, not a scripted window.open: a person can long-press it, copy it,
// and open it in the browser they actually want — and from an installed console
// this is a door out to another installable app, which the platform handles
// better than script does.
const launchStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-xs)',
  height: 44,
  padding: '0 var(--space-lg)',
  font: 'var(--button-ui)',
  letterSpacing: 'var(--tracking-label)',
  textTransform: 'uppercase',
  textDecoration: 'none',
  color: 'var(--brand-on-primary)',
  background: 'var(--brand-primary)',
  border: '1px solid var(--gold-700)',
  borderRadius: 'var(--radius-sm)',
  boxShadow: 'inset 0 1px 0 rgba(246,235,212,.45), var(--shadow-xs)',
}

export default function QaiosPanel() {
  return (
    <div className="qaios-panel">
      <Card eyebrow="The vault" title="QAios" meta="Board ✦ Pulse ✦ Decisions ✦ Commands">
        <p>
          The Questland Adventures operating system — who is on what, the latest
          pulse, the decision ledger, and every command the vault knows. It is
          rebuilt from the vault on every merge, so what opens is what landed on{' '}
          <code>main</code> seconds ago.
        </p>

        <p className="qaios-panel__note">
          <Icon name="info" size={16} aria-hidden="true" />
          <span>
            QAios asks you to sign in <strong>with Google</strong>, separately
            from this console. Until the two sign-ins become one account, that
            second prompt is expected.
          </span>
        </p>

        {/* rel is not optional on a _blank target: without noopener the opened
            page gets a live handle on this one through window.opener. */}
        <a
          href={QAIOS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={launchStyle}
        >
          <Icon name="external-link" size={18} />
          Open QAios
        </a>
      </Card>
    </div>
  )
}
