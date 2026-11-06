document.body.dataset.vendor=location.pathname.split('/').filter(Boolean).at(-1);
await import('./proof.js');
