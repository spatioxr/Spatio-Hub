import { useEffect } from 'react';

// Protect refresh/close and in-app links while a settings form is being edited.
export default function useUnsavedSettings(dirty, saving) {
  useEffect(() => {
    if (!dirty && !saving) return undefined;
    const beforeUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
    const followLink = (event) => {
      const anchor = event.target.closest?.('a[href]');
      if (!anchor || anchor.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.href === window.location.href || url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (saving || !window.confirm('Discard unsaved changes and leave this page?')) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', followLink, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', followLink, true);
    };
  }, [dirty, saving]);
}
