document.getElementById('enter')?.addEventListener('click',async event=>{const button=event.currentTarget;if(button.disabled)return;button.disabled=true;const message=document.getElementById('message');message.textContent='Opening your own company…';try{const response=await fetch('/guest/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),body=await response.json();if(!response.ok)throw new Error(body.error);location.href=body.url}catch(error){message.textContent=error.message;button.disabled=false}});


const root=document.documentElement,themeButton=document.getElementById('theme-toggle'),systemTheme=matchMedia('(prefers-color-scheme: dark)');
let savedTheme;try{savedTheme=localStorage.getItem('enswhiteTheme')}catch{}
if(!['light','dark'].includes(savedTheme))savedTheme=null;
function applyTheme(theme){root.dataset.theme=theme;if(themeButton){themeButton.setAttribute('aria-label',`Switch to ${theme==='dark'?'light':'dark'} theme`);themeButton.setAttribute('aria-pressed',String(theme==='dark'))}}
applyTheme(['light','dark'].includes(savedTheme)?savedTheme:systemTheme.matches?'dark':'light');
themeButton?.addEventListener('click',()=>{savedTheme=root.dataset.theme==='dark'?'light':'dark';applyTheme(savedTheme);try{localStorage.setItem('enswhiteTheme',savedTheme)}catch{}});
systemTheme.addEventListener('change',event=>{if(!savedTheme)applyTheme(event.matches?'dark':'light')});
document.querySelectorAll('.mobile-menu a').forEach(link=>link.addEventListener('click',()=>{link.closest('details').open=false}));
