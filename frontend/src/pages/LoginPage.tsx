import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, AlertCircle, CornerDownLeft } from 'lucide-react'
import { login } from '../lib/api'

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)

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
      const detail = err?.response?.data?.detail
      setError(detail || 'Invalid credentials. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen grid login-grid" style={{ gridTemplateColumns: '1.1fr 1fr' }}>
      {/* Left — dark product panel */}
      <div
        className="relative flex flex-col p-10 md:p-14 overflow-hidden"
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
              fontSize: 36,
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
        <div
          className="relative grid gap-8 md:gap-12"
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
      <div className="flex flex-col justify-center p-10 md:p-14" style={{ background: '#FAFAF8' }}>
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
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-gray-100"
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
            <span
              aria-hidden
              className="w-4 h-4 rounded flex items-center justify-center text-white text-[9px]"
              style={{
                border: '1.5px solid var(--ink)',
                background: rememberMe ? 'var(--ink)' : 'white',
              }}
            >
              {rememberMe ? '✓' : ''}
            </span>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="sr-only"
            />
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
            No account?{' '}
            <a href="#" style={{ color: 'var(--ink)', fontWeight: 500 }}>
              Book a demo
            </a>{' '}
            ·{' '}
            <a href="#" style={{ color: 'var(--ink)', fontWeight: 500 }}>
              SSO
            </a>
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
