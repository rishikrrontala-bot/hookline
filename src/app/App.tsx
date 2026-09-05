import { useCallback, useEffect, useState } from 'react';
import { Landing } from './components/Landing';
import { Workspace } from './components/Workspace';

type View = 'landing' | 'workspace';

export function App() {
  const [view, setView] = useState<View>(() =>
    window.location.hash === '#workspace' ? 'workspace' : 'landing',
  );

  useEffect(() => {
    const sync = () => setView(window.location.hash === '#workspace' ? 'workspace' : 'landing');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const go = useCallback((next: View) => {
    window.location.hash = next === 'workspace' ? '#workspace' : '';
    setView(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      {view === 'landing'
        ? <Landing onEnter={() => go('workspace')} />
        : <Workspace onExit={() => go('landing')} />}
    </>
  );
}
