document.body.dataset.agent=location.pathname.split('/').filter(Boolean).at(-1);
await import('./proof.js');
