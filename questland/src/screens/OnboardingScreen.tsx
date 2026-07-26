import { useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { currentUser, updateProfile } from '../services/authService'
import * as notificationService from '../services/notificationService'
import { useToast } from '../components/Toast'
import { Button, Card, Icon, Input, Seal, Tag } from '../ui'
import ProgressBar from '../components/ProgressBar'
import { ORG_QUIZ, ORG_THEMES } from '../content/orgQuiz'
import type { OrgId } from '../content/orgQuiz'
import { ORGS, getOrg } from '../content/orgs'
import type { Organization } from '../content/types'

type Step = 'name' | 'gate' | 'manual' | 'quiz' | 'result'

// Org -> DS Seal brand art. Do not invent new art keys — only these three exist.
const ORG_SEAL_ART: Record<OrgId, 'compass' | 'relief' | 'crown'> = {
  rangers: 'compass',
  alehiim: 'relief',
  elm: 'crown',
}

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

const stepIndicatorStyle: CSSProperties = {
  font: 'var(--label-ui)',
  letterSpacing: 'var(--tracking-label)',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
}

// Sentence-length prompts read as body serif, not tracked display caps.
const promptStyle: CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontWeight: 400,
  fontSize: 'var(--text-xl)',
  letterSpacing: 'normal',
  textTransform: 'none',
  lineHeight: 1.35,
  margin: 'var(--space-lg) 0',
}

function tallyOrgs(answers: OrgId[]): { winners: OrgId[] } {
  const counts: Record<OrgId, number> = { rangers: 0, alehiim: 0, elm: 0 }
  answers.forEach((org) => {
    counts[org] += 1
  })
  const max = Math.max(counts.rangers, counts.alehiim, counts.elm)
  const winners = (Object.keys(counts) as OrgId[]).filter((id) => counts[id] === max)
  return { winners }
}

// Keyboard-operable card wrapper — DS Card is a div, so selection surfaces need
// role="button" + tabIndex + Enter/Space handling to be a11y-sound.
interface PressCardProps {
  onPress: () => void
  ariaPressed?: boolean
  style?: CSSProperties
  children: ReactNode
}

function PressCard({ onPress, ariaPressed, style, children }: PressCardProps) {
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPress()
    }
  }
  return (
    <Card interactive role="button" tabIndex={0} aria-pressed={ariaPressed} onClick={onPress} onKeyDown={handleKeyDown} style={style}>
      {children}
    </Card>
  )
}

// Adds the org's own color hairline + carve-in shadow when selected.
function SelectCard({
  selected,
  accentColor,
  onPress,
  children,
}: {
  selected: boolean
  accentColor?: string
  onPress: () => void
  children: ReactNode
}) {
  return (
    <PressCard
      onPress={onPress}
      ariaPressed={selected}
      style={selected ? { border: `2px solid ${accentColor || 'var(--gold-500)'}`, boxShadow: 'var(--shadow-carve-in)' } : undefined}
    >
      {children}
    </PressCard>
  )
}

function OrgOption({ org, selected, onSelect }: { org: Organization; selected: boolean; onSelect: () => void }) {
  const id = org.id as OrgId
  return (
    <SelectCard selected={selected} accentColor={org.color} onPress={onSelect}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <Seal art={ORG_SEAL_ART[id]} size="sm" assetBase={import.meta.env.BASE_URL} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: 'var(--title-card)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-display-tight)', color: 'var(--text-heading)' }}>
            {org.name}
          </div>
          <p className="muted" style={{ marginTop: 2 }}>
            {org.epithet}
          </p>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {ORG_THEMES[id].map((theme) => (
              <Tag key={theme}>{theme}</Tag>
            ))}
          </div>
          <p style={{ marginTop: 10, fontFamily: 'var(--font-scribe)', fontSize: 'var(--text-md)', color: 'var(--text-muted)' }}>{org.motto}</p>
        </div>
      </div>
    </SelectCard>
  )
}

export default function OnboardingScreen() {
  const navigate = useNavigate()
  const { show } = useToast()
  const user = currentUser()

  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState(user?.name || user?.email.split('@')[0] || '')
  const [manualOrgId, setManualOrgId] = useState<OrgId | null>(null)
  const [quizAnswers, setQuizAnswers] = useState<OrgId[]>([])
  const [resultPick, setResultPick] = useState<OrgId | null>(null)

  if (!user) return null

  function handleNameContinue() {
    setName((n) => n.trim() || 'Adventurer')
    setStep('gate')
  }

  function join(orgId: OrgId) {
    const org = getOrg(orgId)
    const trimmedName = name.trim() || 'Adventurer'
    updateProfile(user!.id, { name: trimmedName, orgId })
    notificationService.add(user!.id, {
      type: 'event',
      title: 'Welcome to Questland',
      body: `${trimmedName}, the ${org?.name ?? 'order'} welcome you. Your first questline awaits.`,
      icon: 'sparkles',
    })
    show({ title: `Welcome to the ${org?.name ?? 'order'}!`, icon: 'party-popper' })
    navigate('/')
  }

  function pickQuizOption(org: OrgId) {
    const next = [...quizAnswers, org]
    setQuizAnswers(next)
    if (next.length >= ORG_QUIZ.length) {
      setResultPick(null)
      setStep('result')
    }
  }

  function quizBack() {
    if (quizAnswers.length === 0) {
      setStep('gate')
    } else {
      setQuizAnswers((prev) => prev.slice(0, -1))
    }
  }

  function renderName() {
    return (
      <>
        <h1 style={{ marginBottom: 6 }}>Name your adventurer</h1>
        <p className="muted" style={{ marginBottom: 'var(--space-lg)' }}>
          You can change this anytime.
        </p>
        <Input label="Adventurer name" id="name" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 'var(--space-2xl)' }} />
        <Button fullWidth size="lg" onClick={handleNameContinue}>
          Continue
        </Button>
      </>
    )
  }

  function renderGate() {
    return (
      <>
        <h1 style={{ ...capsHeadingStyle, marginBottom: 10 }}>Choose your path</h1>
        <p className="muted" style={{ marginBottom: 'var(--space-xl)' }}>
          Every adventurer swears to one order first — the other two questlines wait for you, open in time.
        </p>
        <div className="stack">
          <PressCard onPress={() => setStep('manual')}>
            <div className="row" style={{ gap: 12 }}>
              <Icon name="scroll-text" size={22} />
              <div>
                <div style={{ fontWeight: 700 }}>Pick a Quest</div>
                <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  I know my order
                </p>
              </div>
            </div>
          </PressCard>
          <PressCard onPress={() => setStep('quiz')}>
            <div className="row" style={{ gap: 12 }}>
              <Icon name="compass" size={22} />
              <div>
                <div style={{ fontWeight: 700 }}>Help me decide</div>
                <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  Match me by six questions
                </p>
              </div>
            </div>
          </PressCard>
        </div>
      </>
    )
  }

  function renderManual() {
    const org = manualOrgId ? getOrg(manualOrgId) : null
    return (
      <>
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={() => setStep('gate')} style={{ marginBottom: 'var(--space-md)' }}>
          Back
        </Button>
        <h1 style={{ ...capsHeadingStyle, marginBottom: 10 }}>Choose your order</h1>
        <p className="muted" style={{ marginBottom: 'var(--space-lg)' }}>
          All three questlines open to you in time — this is the one you begin with.
        </p>
        <div className="stack" style={{ marginBottom: 'var(--space-xl)' }}>
          {ORGS.map((o) => (
            <OrgOption key={o.id} org={o} selected={manualOrgId === o.id} onSelect={() => setManualOrgId(o.id as OrgId)} />
          ))}
        </div>
        <Button fullWidth size="lg" disabled={!manualOrgId} onClick={() => manualOrgId && join(manualOrgId)}>
          {org ? `Join the ${org.name}` : 'Choose an order'}
        </Button>
      </>
    )
  }

  function renderQuiz() {
    const index = quizAnswers.length
    const question = ORG_QUIZ[index]
    return (
      <>
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={quizBack} style={{ marginBottom: 'var(--space-md)' }}>
          Back
        </Button>
        <p style={{ ...stepIndicatorStyle, marginBottom: 8 }}>
          Question {index + 1} of {ORG_QUIZ.length}
        </p>
        <ProgressBar value={index} max={ORG_QUIZ.length} />
        <h1 style={promptStyle}>{question.prompt}</h1>
        <div className="stack">
          {question.options.map((opt) => (
            <PressCard key={opt.org} onPress={() => pickQuizOption(opt.org)}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-md)', color: 'var(--text-body)' }}>{opt.text}</p>
            </PressCard>
          ))}
        </div>
      </>
    )
  }

  function renderResult() {
    const { winners } = tallyOrgs(quizAnswers)

    if (winners.length === 1) {
      const org = getOrg(winners[0])!
      return (
        <>
          <p style={{ ...stepIndicatorStyle, textAlign: 'center', marginBottom: 'var(--space-sm)' }}>Your path leads to</p>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-md)' }}>
            <Seal art={ORG_SEAL_ART[winners[0]]} size="lg" assetBase={import.meta.env.BASE_URL} />
          </div>
          <h1 style={{ ...capsHeadingStyle, textAlign: 'center' }}>{org.name}</h1>
          <div className="row" style={{ justifyContent: 'center', gap: 6, flexWrap: 'wrap', margin: 'var(--space-md) 0' }}>
            {ORG_THEMES[winners[0]].map((theme) => (
              <Tag key={theme}>{theme}</Tag>
            ))}
          </div>
          <p style={{ textAlign: 'center', fontFamily: 'var(--font-scribe)', fontSize: 'var(--text-md)', marginBottom: 10 }}>{org.motto}</p>
          <p className="muted" style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
            {org.description}
          </p>
          <Button fullWidth size="lg" onClick={() => join(winners[0])} style={{ marginBottom: 'var(--space-sm)' }}>
            Join the {org.name}
          </Button>
          <Button fullWidth variant="ghost" onClick={() => setStep('manual')}>
            Show all three orders
          </Button>
        </>
      )
    }

    const resultOrg = resultPick ? getOrg(resultPick) : null
    return (
      <>
        <h1 style={{ ...capsHeadingStyle, marginBottom: 10 }}>The paths are balanced</h1>
        <p className="muted" style={{ marginBottom: 'var(--space-lg)' }}>
          More than one order answered your call. Choose the one you take up first.
        </p>
        <div className="stack" style={{ marginBottom: 'var(--space-xl)' }}>
          {winners.map((id) => {
            const org = getOrg(id)!
            return <OrgOption key={id} org={org} selected={resultPick === id} onSelect={() => setResultPick(id)} />
          })}
        </div>
        <Button fullWidth size="lg" disabled={!resultPick} onClick={() => resultPick && join(resultPick)} style={{ marginBottom: 'var(--space-sm)' }}>
          {resultOrg ? `Join the ${resultOrg.name}` : 'Choose an order'}
        </Button>
        <Button fullWidth variant="ghost" onClick={() => setStep('manual')}>
          See all three
        </Button>
      </>
    )
  }

  return (
    <div className="screen--bare">
      {step === 'name' && renderName()}
      {step === 'gate' && renderGate()}
      {step === 'manual' && renderManual()}
      {step === 'quiz' && renderQuiz()}
      {step === 'result' && renderResult()}
    </div>
  )
}
