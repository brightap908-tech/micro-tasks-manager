import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-slate-900 border border-slate-700 rounded-2xl p-8 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-2xl">⚠</span>
              <h1 className="text-xl font-semibold text-slate-100">Something went wrong</h1>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed">
              The application encountered an unexpected error. Try refreshing the page. If the
              problem persists, check the browser console for details.
            </p>
            {this.state.error && (
              <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs text-red-300 overflow-auto max-h-40">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
