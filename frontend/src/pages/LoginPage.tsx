import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, AlertCircle, CornerDownLeft } from 'lucide-react'
import { toast } from 'sonner'
import { login } from '../lib/api'

export default function LoginPage() {
  const navigate = useNavigate()
  const passwordRef = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [failedAttempts, setFailedAttempts] = useState(0)

  // Focus has to wait for the render that re-enables the field: the catch
  // block runs while isSubmitting is still true, and a disabled input cannot
  // take focus. Keying the effect on the attempt count also re-focuses on a
  // second consecutive failure, where the message itself does not change.
  useEffect(() => {
    if (failedAttempts > 0) passwordRef.current?.focus()
  }, [failedAttempts])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!username.trim()) {
      setError('Please enter your username.')
      return
    }
    if (!password) {
      setError('Please enter your password.')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await login(username.trim(), password)
      localStorage.setItem('token', res.access)
      localStorage.setItem('refresh_token', res.refresh)
      navigate('/dashboard')
    } catch (err: any) {
      // A rejected sign-in answers 401 (SimpleJWT) or 400 (malformed payload).
      // Anything else — 5xx, or no response at all when the server is down —
      // is our problem, not the user's, and must not read as a bad password.
      const status = err?.response?.status
      const isRejectedCredential = status === 400 || status === 401
      const message = isRejectedCredential
        ? 'Incorrect username or password. Please try again.'
        : 'Something went wrong. Please try again later.'

      // Deliberately the same message for a wrong username as for a wrong
      // password: naming the field that failed turns the form into an oracle
      // for which accounts exist.
      setError(message)
      toast.error(message)

      // Drop the password so a retry starts clean, but keep the username —
      // it is usually right, and retyping it is pure friction.
      setPassword('')
      setFailedAttempts((n) => n + 1)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen grid login-grid" style={{ gridTemplateColumns: '1.1fr 1fr' }}>
      {/* Left — dark product panel */}
      <div
        className="relative flex flex-col p-6 sm:p-10 md:p-14 overflow-hidden"
        style={{ background: '#0c1e25', color: 'white' }}
      >
        {/* faint grid */}
        <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.06 }} aria-hidden>
          <defs>
            <pattern id="seefgrid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0H0V24" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#seefgrid)" />
        </svg>

        {/* Wordmark */}
        <div className="relative flex items-center">
          <span
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: '-0.04em',
              lineHeight: 1,
              display: 'inline-flex',
              alignItems: 'baseline',
            }}
          >
            <span style={{ color: 'white' }}>seef</span>
            <span style={{ color: 'var(--brand)' }}>med</span>
            <span style={{ color: 'var(--brand)' }}>.</span>
          </span>
        </div>

        {/* Promise */}
        <div className="flex-1 flex flex-col justify-center relative max-w-lg">
          <div
            className="mono uppercase"
            style={{
              fontSize: 10,
              color: '#5e8a92',
              letterSpacing: '0.14em',
              marginBottom: 14,
            }}
          >
            Accounting back-office · v1.0
          </div>
          <div
            style={{
              // Caps at today's 36px from ~655px wide up, so the desktop
              // panel is untouched; shrinks only on phones.
              fontSize: 'clamp(1.5rem, 5.5vw, 36px)',
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              color: 'white',
            }}
          >
            Ledgers, GSTR returns, and TDS in one back office.
          </div>
          <div
            style={{
              fontSize: 14,
              color: '#8fb3b8',
              marginTop: 14,
              lineHeight: 1.55,
              maxWidth: 460,
            }}
          >
            Double-entry posting, GST returns, TDS challans, and bank reconciliation —
            built for the desk that closes the books, not a web form.
          </div>
        </div>

        {/* Trust strip */}
        {/* Below sm the three columns become rows — swapping display leaves the
            inline template inert there and byte-identical from sm up. */}
        <div
          className="relative flex flex-col sm:grid gap-4 sm:gap-8 md:gap-12"
          style={{
            gridTemplateColumns: 'repeat(3, minmax(0,auto))',
            paddingTop: 18,
            borderTop: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <div>
            <div
              className="mono uppercase"
              style={{ fontSize: 9, color: '#5e8a92', letterSpacing: '0.1em' }}
            >
              Hosted
            </div>
            <div style={{ fontSize: 12, color: '#cfe1e3', marginTop: 4 }}>
              Mumbai · 99.97% uptime
            </div>
          </div>
          <div>
            <div
              className="mono uppercase"
              style={{ fontSize: 9, color: '#5e8a92', letterSpacing: '0.1em' }}
            >
              On-call
            </div>
            <div className="mono" style={{ fontSize: 12, color: '#cfe1e3', marginTop: 4 }}>
              +91 80 4718 2200
            </div>
          </div>
          <div>
            <div
              className="mono uppercase"
              style={{ fontSize: 9, color: '#5e8a92', letterSpacing: '0.1em' }}
            >
              Compliance
            </div>
            <div style={{ fontSize: 12, color: '#cfe1e3', marginTop: 4 }}>
              GST · DPDP · ISO 27001
            </div>
          </div>
        </div>
      </div>

      {/* Right — form on warm paper */}
      <div className="flex flex-col justify-center p-6 sm:p-10 md:p-14" style={{ background: '#FAFAF8' }}>
        <form onSubmit={handleSubmit} className="w-full max-w-sm mx-auto">
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--ink)',
              letterSpacing: '-0.01em',
            }}
          >
            Sign in
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4, marginBottom: 24 }}>
            to your accounting back office
          </div>

          {error && (
            // No role="alert" here on purpose: the toast carries the same
            // sentence in its own live region, and two live regions would
            // announce the failure twice. This banner is the visual copy that
            // persists after the toast dismisses.
            <div
              className="mb-5 px-3 py-2.5 rounded-md flex items-start gap-2.5"
              style={{
                background: 'rgba(192,57,43,0.07)',
                border: '1px solid rgba(192,57,43,0.25)',
              }}
            >
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--danger)' }} />
              <p className="text-sm" style={{ color: 'var(--danger)' }}>
                {error}
              </p>
            </div>
          )}

          {/* Username */}
          <label
            className="mono uppercase block"
            style={{
              fontSize: 10,
              color: 'var(--ink-2)',
              letterSpacing: '0.08em',
              fontWeight: 600,
              marginBottom: 6,
            }}
            htmlFor="username"
          >
            Username or work email
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            disabled={isSubmitting}
            placeholder="arjun@firm.in"
            className="w-full h-10 px-3 rounded-md text-sm outline-none transition-colors"
            style={{
              border: '1px solid var(--line)',
              background: 'white',
              color: 'var(--ink)',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--ink)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--line)')}
          />

          {/* Password */}
          <div className="flex justify-between items-baseline mt-4 mb-1.5">
            <label
              htmlFor="password"
              className="mono uppercase"
              style={{
                fontSize: 10,
                color: 'var(--ink-2)',
                letterSpacing: '0.08em',
                fontWeight: 600,
              }}
            >
              Password
            </label>
            <button
              type="button"
              className="mono uppercase"
              style={{
                fontSize: 10,
                color: 'var(--brand)',
                fontWeight: 600,
                letterSpacing: '0.05em',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
              onClick={() => alert('Contact your administrator to reset your password.')}
            >
              Forgot?
            </button>
          </div>
          <div className="relative">
            <input
              id="password"
              ref={passwordRef}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={isSubmitting}
              placeholder="••••••••••"
              className="w-full h-10 pl-3 pr-10 rounded-md text-sm outline-none transition-colors"
              style={{
                border: '1px solid var(--line)',
                background: 'white',
                color: 'var(--ink)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--ink)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--line)')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 sm:p-1.5 rounded hover:bg-gray-100"
              style={{ color: 'var(--ink-2)' }}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Remember me */}
          <label
            className="flex items-center gap-2 mt-4 cursor-pointer select-none"
            style={{ fontSize: 12.5, color: 'var(--ink-2)' }}
          >
            {/* The real checkbox is sr-only so the visible box can be styled,
                which leaves it focusable but invisible: without the peer link
                below, Tabbing here showed nothing on screen and the user had
                no idea what Space was about to toggle. The input is rendered
                first so `peer-focus-visible:` can reach the proxy span. */}
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="sr-only peer"
            />
            <span
              aria-hidden
              className="w-4 h-4 rounded flex items-center justify-center text-white text-[9px] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand)] peer-focus-visible:ring-offset-2"
              style={{
                border: '1.5px solid var(--ink)',
                background: rememberMe ? 'var(--ink)' : 'white',
              }}
            >
              {rememberMe ? '✓' : ''}
            </span>
            Keep me signed in on this desk
          </label>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-5 py-3 px-4 rounded-md text-white font-semibold flex items-center justify-center gap-2 disabled:cursor-not-allowed"
            style={{
              background: isSubmitting ? 'var(--ink-2)' : 'var(--ink)',
              opacity: isSubmitting ? 0.7 : 1,
              fontSize: 13.5,
            }}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Signing in…</span>
              </>
            ) : (
              <>
                <span>Sign in</span>
                <span
                  className="mono flex items-center justify-center rounded"
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    background: 'rgba(255,255,255,0.15)',
                  }}
                >
                  <CornerDownLeft className="w-3 h-3" />
                </span>
              </>
            )}
          </button>

          {/* Footer links */}
          <div className="text-center mt-5" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {/* Plain text, not <a href="#">: these have no destination yet, and
                as links they were two dead tab stops between Sign in and the
                end of the form — a keyboard-only user pressed Tab twice for
                nothing. Make them links again when the routes exist. */}
            No account?{' '}
            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>
              Book a demo
            </span>{' '}
            ·{' '}
            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>
              SSO
            </span>
          </div>

          <p
            className="mono uppercase text-center"
            style={{
              fontSize: 9,
              color: 'var(--ink-3)',
              letterSpacing: '0.1em',
              marginTop: 24,
            }}
          >
            Secure · encrypted · seefmed v1.0
          </p>
        </form>
      </div>
    </div>
  )
}
