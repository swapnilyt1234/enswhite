import {copyFile,readFile,writeFile} from 'node:fs/promises';
const root=new URL('./',import.meta.url);
await Promise.all(['company-public','launch-public','public'].flatMap(folder=>[
 copyFile(new URL('judge-public/app-theme.css',root),new URL(folder+'/app-theme.css',root)),
 copyFile(new URL('styles/app-theme.js',root),new URL(folder+'/app-theme.js',root)),
]));
await copyFile(new URL('styles/app-theme.js',root),new URL('judge-public/app-theme.js',root));

// Offline samples keep their restrictive CSP and receive the same theme as inline CSS.
const sampleFile=new URL('judge-public/sample-kit.html',root),css=await readFile(new URL('judge-public/app-theme.css',root),'utf8');
let sample=await readFile(sampleFile,'utf8');
sample=sample.replace(/<style data-app-theme>[\s\S]*?<\/style>/,'').replace('<main>','<main class="kit-page">').replace('</head>',`<style data-app-theme>${css}</style></head>`);
await writeFile(sampleFile,sample.split(/\r?\n/).map(line=>line.trimEnd()).join('\n'));
