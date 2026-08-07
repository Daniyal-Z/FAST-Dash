import { Link } from 'react-router'

/** Full-height centred message used for loading / empty / error screens. */
export function Screen({ glyph, title, children, action }) {
  return (
    <div
      className="fd-paper grid place-items-center px-6 text-center"
      style={{ minHeight: 'calc(100dvh - var(--nav-h))' }}
    >
      <div className="max-w-md">
        {glyph && (
          <div className="mb-4 text-[42px] leading-none" style={{ color: 'var(--tx-3)' }}>
            {glyph}
          </div>
        )}
        <h2
          className="m-0 text-[20px] font-bold tracking-tight"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--tx)' }}
        >
          {title}
        </h2>
        {children && (
          <p
            className="mx-auto mt-2.5 max-w-sm text-[13.5px] leading-relaxed"
            style={{ color: 'var(--tx-2)' }}
          >
            {children}
          </p>
        )}
        {action && <div className="mt-5 flex justify-center gap-3">{action}</div>}
      </div>
    </div>
  )
}

export function LoadingScreen({ what = 'data' }) {
  return (
    <Screen glyph={<span className="fd-spin inline-block">◱</span>} title={`Loading ${what}…`}>
      One moment.
    </Screen>
  )
}

export function NotConfiguredScreen() {
  return (
    <Screen glyph="⚙" title="Not connected yet">
      This build has no Supabase credentials. Copy{' '}
      <code style={{ color: 'var(--acc-2)' }}>.env.example</code> to{' '}
      <code style={{ color: 'var(--acc-2)' }}>.env.local</code> and fill in your project URL and
      anon key.
    </Screen>
  )
}

export function EmptyDatasetScreen({ what }) {
  return (
    <Screen
      glyph="◱"
      title={`No ${what} published yet`}
      action={
        <Link to="/admin" className="primary no-underline">
          Go to admin
        </Link>
      }
    >
      An administrator needs to upload the {what} spreadsheet before this page has anything to
      show.
    </Screen>
  )
}

export function ErrorScreen({ error, onRetry }) {
  return (
    <Screen
      glyph="⚠"
      title="Could not load that"
      action={
        onRetry && (
          <button type="button" className="primary" onClick={onRetry}>
            Try again
          </button>
        )
      }
    >
      {error?.message || 'Something went wrong talking to the server.'}
    </Screen>
  )
}
