// E2E: node tests/e2e.mjs   env: APP_PASSWORD (required), PLAIN (optional path to plaintext payload for leak scan), CHROME
import pp from 'puppeteer-core';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PW=process.env.APP_PASSWORD;if(!PW){console.error('APP_PASSWORD missing');process.exit(2)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let fails=0;
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,s)=>{let f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(f.endsWith(path.sep))f+='index.html';if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end()}s.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s)}).listen(0);
const URL_=`http://localhost:${srv.address().port}/`;
const b=await pp.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox']});
const errs=[];
async function newPage(w=1440,h=900){const ctx=b.defaultBrowserContext();const p=await b.newPage();await p.setViewport({width:w,height:h});p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push('PAGEERR '+e.message));return p}
const unlock=async(p,pw,remember)=>{await p.waitForSelector('#pw');await p.$eval('#pw',e=>e.value='');await p.type('#pw',pw);if(remember)await p.click('#rm');await p.click('#go')};
const p=await newPage();await p.goto(URL_);
await p.waitForSelector('#lock:not([hidden])');
const lockText=await p.evaluate(()=>document.body.innerText);
ok(/財務儀表板/.test(lockText),'lock screen shows generic title');
ok(!/百麒|日聖|百富|百銘|營收|NT\$/.test(lockText),'lock screen has no company/figure text');
ok(await p.evaluate(()=>window.DATA===undefined),'no data before unlock');
ok(await p.evaluate(()=>!document.getElementById('rm').checked),'remember default off');
// wrong password
await unlock(p,PW+'x');await p.waitForFunction(()=>document.getElementById('err').textContent.length>0,{timeout:20000});
ok((await p.$eval('#err',e=>e.textContent)).includes('密碼錯誤'),'wrong password -> clear error');
ok(await p.evaluate(()=>window.DATA===undefined&&!document.getElementById('nav').children.length),'wrong password -> no data / no app');
ok(await p.evaluate(()=>!localStorage.getItem('rp_plain_v1')),'wrong password -> nothing stored');
// correct password
await unlock(p,PW);await p.waitForSelector('#nav a',{timeout:30000});
ok(await p.evaluate(()=>!!window.DATA&&window.DATA.cos.length===5),'correct password decrypts payload');
ok(await p.evaluate(()=>!localStorage.getItem('rp_plain_v1')),'remember off -> plaintext not in localStorage');
const tabs=await p.$$eval('#nav a',a=>a.map(x=>x.dataset.v));ok(tabs.length===7,'7 tabs');
for(const t of tabs){await p.click(`#nav a[data-v="${t}"]`);await sleep(250);const bad=await p.$eval('#page',e=>e.querySelector('.note.err')?.textContent||'');ok(!bad&&(await p.$eval('#page',e=>e.innerHTML.length))>500,'tab renders: '+t)}
// manual entry on top of decrypted data
await p.click('#nav a[data-v="settings"]');await sleep(200);
await p.select('#f_type','rev');await p.$eval('#f_ym',e=>e.value='2026-09');await p.$eval('#f_amt',e=>e.value='12345');await p.click('[data-act="saveentry"]');await sleep(200);
await p.click('#nav a[data-v="overview"]');await sleep(250);
ok((await p.$$eval('.kpi',a=>a.map(x=>x.innerText).join('|'))).includes('12,345'),'manual entry works on decrypted data');
await p.screenshot({path:'/tmp/shot_desktop_enc.png'});
// reload w/o remember -> locked again
await p.reload();await p.waitForSelector('#lock:not([hidden])');ok(true,'reload without remember -> locked');
// remember on
await unlock(p,PW,true);await p.waitForSelector('#nav a',{timeout:30000});
ok(await p.evaluate(()=>!!localStorage.getItem('rp_plain_v1')),'remember on -> stored on device');
await p.reload();await p.waitForSelector('#nav a',{timeout:15000});ok(true,'reload with remember -> opens directly');
await p.click('#lockbtn');await p.waitForSelector('#lock:not([hidden])',{timeout:15000});
ok(await p.evaluate(()=>!localStorage.getItem('rp_plain_v1')&&window.DATA===undefined),'lock button clears stored + memory');
// PWA bits
const mf=await p.evaluate(async()=>{const r=await fetch('manifest.webmanifest');return r.ok?await r.json():null});ok(mf&&mf.icons.length>=3&&mf.display==='standalone','manifest valid');
const sw=await p.evaluate(async()=>{await navigator.serviceWorker.ready;const r=await navigator.serviceWorker.getRegistration();return !!(r&&r.active)});ok(sw,'service worker active');
for(const f of ['icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png'])ok(await p.evaluate(async f=>(await fetch(f)).ok,f),'icon '+f);
// mobile
const m=await newPage(390,844);await m.goto(URL_);await unlock(m,PW);await m.waitForSelector('#nav a',{timeout:30000});await sleep(300);
const ov=await m.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);ok(ov<=2,'mobile: no horizontal overflow ('+ov+'px)');
ok(await m.evaluate(()=>getComputedStyle(document.getElementById('side')).position==='fixed'),'mobile: bottom nav');
await m.screenshot({path:'/tmp/shot_mobile_enc.png'});
for(const t of ['revenue','pl','payroll','invoice','ledger','settings']){await m.click(`#nav a[data-v="${t}"]`);await sleep(250);const o=await m.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);ok(o<=2,'mobile tab fits: '+t+' ('+o+'px)')}
ok(errs.length===0,'no console errors '+(errs.length?JSON.stringify(errs.slice(0,3)):''));
// leak scan
const files=[];(function w(d){for(const f of fs.readdirSync(d)){const q=path.join(d,f);if(f==='tests'||f==='node_modules'||f.startsWith('.git'))continue;fs.statSync(q).isDirectory()?w(q):files.push(q)}})(root);
const pwHit=files.some(f=>!/\.png$/.test(f)&&fs.readFileSync(f,'utf8').includes(PW));ok(!pwHit,'password not present in published files');
if(process.env.PLAIN){const plain=JSON.parse(fs.readFileSync(process.env.PLAIN,'utf8'));
 const needles=new Set(['百麒','日聖','百富','百銘','洗衣集團','XMLY','營業人銷售額']);
 (function walk(v){if(typeof v==='number'){if(Math.abs(v)>=100000){const i=String(Math.round(Math.abs(v)));needles.add(i);needles.add(Number(i).toLocaleString('en-US'))}}else if(typeof v==='string'){if(v.length>=4&&!v.startsWith('<')&&/[\u4e00-\u9fff]/.test(v)&&!/^[\d\-~\/ ]+$/.test(v))needles.add(v.slice(0,12))}else if(v&&typeof v==='object')Object.values(v).forEach(walk)})(plain);
 let hits=[];for(const f of files){if(/\.png$/.test(f))continue;let t=fs.readFileSync(f,'utf8');t=t.replace(/(<script type="application\/json" id="enc">)[\s\S]*?(<\/script>)/,'$1$2');if(f.endsWith('index.html')){/* strip generic UI strings only: none */}
  for(const n of needles)if(t.includes(n))hits.push(path.basename(f)+': <'+(n.length>14?n.slice(0,14)+'…':n)+'>')}
 // allowlist: generic words that legitimately occur in UI code
 const allow=new Set(['營業毛利(未扣費用)','營業收入','營業成本','營業費用','正職','兼職','銀行存款','手續費','利息支出','機器設備','進項稅額','其他應付款-其他','暫收款','土地','股本(登記)','業主(股東)往來','原物料','天然氣','電費','水費','薪資','房租','租貸車','勞、健、退、保險','零用金','(加油)燃料費','貨車修繕費','機器修繕費','機器購置','零件、備品','其他費用','郵電費','交際費','銀行貸款','展延稅額','營業稅','帳務費','總支出','收入','淨利']);
 hits=hits.filter(h=>!allow.has(h.split(': <')[1].slice(0,-1)));
 console.log('leak-scan needles:',needles.size,'hits:',hits.length);if(hits.length)console.log(hits.slice(0,40).join('\n'));ok(hits.length===0,'no plaintext figures/company names in published files');
}
await b.close();srv.close();console.log(fails?`\n${fails} FAILED`:'\nALL PASSED');process.exit(fails?1:0);
