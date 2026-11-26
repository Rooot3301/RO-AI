import { Component, type ReactNode } from 'react';
import { Banner, Button } from '../ui/primitives';

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <Banner tone="err" title="Erreur d’affichage" actions={<Button size="sm" onClick={() => this.setState({ error: null })}>Réessayer</Button>}>
          Cette vue a rencontré une erreur inattendue : {this.state.error.message}
        </Banner>
      </div>
    );
  }
}
