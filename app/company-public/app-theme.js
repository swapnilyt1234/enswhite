(()=>{
 const root=document.documentElement,system=matchMedia('(prefers-color-scheme: dark)');let choice;
 try{choice=localStorage.getItem('enswhiteTheme')}catch{}
 if(!['light','dark'].includes(choice))choice=null;
 const button=document.createElement('button');button.type='button';button.className='app-theme-toggle';button.innerHTML='<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>';
 function apply(theme){root.dataset.theme=theme;button.setAttribute('aria-label',`Switch to ${theme==='dark'?'light':'dark'} theme`);button.setAttribute('aria-pressed',String(theme==='dark'))}
 apply(choice||(system.matches?'dark':'light'));
 button.addEventListener('click',()=>{choice=root.dataset.theme==='dark'?'light':'dark';apply(choice);try{localStorage.setItem('enswhiteTheme',choice)}catch{}});
 system.addEventListener('change',event=>{if(!choice)apply(event.matches?'dark':'light')});
 const host=document.querySelector('.header-actions')||document.querySelector('body > header');
 if(host)host.append(button);else{button.classList.add('floating');document.body.append(button)}
})();
