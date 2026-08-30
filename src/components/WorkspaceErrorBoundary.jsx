import { Component } from 'react';
import { AlertTriangle, Home, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

function safeErrorName(error) {
  const name = String(error?.name || '').trim();
  return /^[A-Za-z][A-Za-z0-9]*$/.test(name) ? name : 'Error';
}

export default class WorkspaceErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // Do not log messages, component props, or stack traces because rendered
    // workspaces can contain financial and customer information.
    console.error('[ui-boundary] FCOS stopped an unexpected rendering error.', {
      scope: this.props.scope || 'workspace',
      type: safeErrorName(error),
    });
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const isApplicationFailure = this.props.scope === 'application';
    return (
      <section
        className="flex min-h-[420px] w-full items-center justify-center p-5 sm:p-8"
        role="alert"
        aria-live="assertive"
        data-workspace-error-boundary={this.props.scope || 'workspace'}
      >
        <div className="w-full max-w-lg rounded-[24px] border border-amber-200 bg-card p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-foreground">
            {isApplicationFailure ? 'FCOS needs to recover' : 'This page could not be displayed'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Previously saved data remains available. Unsaved changes on this page may need to be entered again.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button type="button" onClick={this.retry} className="gap-2">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Try Again
            </Button>
            {this.props.onGoHome && (
              <Button type="button" variant="outline" onClick={this.props.onGoHome} className="gap-2">
                <Home className="h-4 w-4" aria-hidden="true" />
                Go to Dashboard
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => window.location.reload()} className="gap-2">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reload FCOS
            </Button>
          </div>
        </div>
      </section>
    );
  }
}
