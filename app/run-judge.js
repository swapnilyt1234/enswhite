import {spawn} from 'node:child_process';
const env={};for(const name of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA'])if(process.env[name])env[name]=process.env[name];
const origin=(process.argv[2]||'').trim();if(new URL(origin).origin!==origin||!origin.startsWith('https://'))throw new Error('Use your public HTTPS origin without a trailing slash');
env.APP_ORIGIN=origin;env.OWNER_PROXY='true';
const child=spawn(process.execPath,['app/judge-server.js'],{env,stdio:'inherit',windowsHide:true});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));child.on('exit',code=>{process.exitCode=code||0});
