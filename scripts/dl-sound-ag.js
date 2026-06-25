const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = '/Users/wyattroy/Documents/Projects/wyattroy-portfolio';
const projectId = 'sound-ag';
const pageUrl = 'https://www.wyattroy.com/xr/sound-ag';

const URLS = [
  "https://lh3.googleusercontent.com/sitesv/AA5AbUCTJBXnfAyiAzXPtfIBloVdQ0op7J9zwRymJZ3nex4Wzu5wBJZ_tm-FEjsScfb4Ecw1FIWLYmtikPvLyHzMsvyABtHpLDpZN4sIDZtANoTEXlWCT1tw92nIiiamt08-j27VACPJ6z04iebEkJqOkkwdPGEEDWRePqRQHThLWlo18zxFwKZs5L-13InhS0PctTjKbHqElWPDhAUkCO6HZ74vHCzDWUwcd-To616qMSQ=w1280",
  "https://lh3.googleusercontent.com/sitesv/AA5AbUBSSZVVrJnSILIeYHlhs-davQniH7hnfCJN1UNqTneQ9dGivUId-EBxgjZxJWhg4fIH2PfkQX36cpD-Ao9S6bQDJgvAyAO1flwvC8-Qur5O-YV-bqoWMLxPzYWJZqT5xLELH6jnEh7Kr7y3nNPKSE8W0Nje_S5z0nLQDpQMalzkINgWKYyZmo18U38gMfqh97S5GNGxqqW8JGxGY1QjuGnwAdHvOhpZoJR4ryyV=w1280",
  "https://lh3.googleusercontent.com/sitesv/AA5AbUCMS-7OAS_V_z8xDURO3dlZEZSOxH1ZkOgeYDMYbRiAh6J5SKyjW_KL2-Dpc-1eiFzpuQxx3QKX51zRuLSG-AVragpD8Is8ipk3LW-N3fiJ6ZjeYNKmcJswbMAkmZb0Mjgv1rTUgjqkkS2McWunqwxEShMissL8YUuvyFKwUnnijqlDs3SE9Kr9gSTd-OeEf9H1IRUSMg5VSK04J1jxwAqHhqd2_MG97xngxg=w1280",
  "https://lh3.googleusercontent.com/sitesv/AA5AbUDjV75YOgm3pV373cc9PP-elhDkfBw9NxhGANody93AR73BGIBfeqgI8eek5QILgEy7YzjrxoFoP3n4AlpRuCSBJytkJBALBgPAGT3fizE-jGjxnZwjUui4a3EFxGTHJKhF0Yvc6Kwqc7s2fO5tJmHAXfTvfNtHLsiRc5mZIDAPUYU4SkAyutXI7HgoHDql8b6KLq8WBWb6aFfzYwdaI_13Pw1n1aznm8tdXtin=w1280"
];

function download(url, dest, cookieHeader) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
        'Cookie': cookieHeader,
        'Referer': 'https://www.wyattroy.com/',
      },
      timeout: 20000,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(new URL(res.headers.location, url).href, dest, cookieHeader).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const ct = res.headers['content-type'] || '';
      if (ct.includes('text/html')) { res.resume(); return reject(new Error('got HTML')); }
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(resolve));
      f.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function run() {
  const userDataDir = path.join(ROOT, '.playwright-session');
  const projDir = path.join(ROOT, 'assets/projects', projectId);
  fs.mkdirSync(projDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ['--no-sandbox'],
  });

  // Just need cookies - navigate quickly
  const page = await context.newPage();
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch(e) {
    console.log('Nav partial:', e.message.split('\n')[0]);
  }

  const cookies = await context.cookies();
  const cookieHeader = cookies
    .filter(c => 'lh3.googleusercontent.com'.includes(c.domain.replace(/^\./, '')) || 
                 'googleusercontent.com'.includes(c.domain.replace(/^\./, '')))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
  
  console.log('Got', cookies.length, 'cookies');

  await context.close();

  const names = ['img1.jpg', 'img2.jpg', 'img3.jpg', 'img4.jpg'];
  for (let i = 0; i < URLS.length; i++) {
    const dest = path.join(projDir, names[i]);
    if (fs.existsSync(dest)) {
      const stat = fs.statSync(dest);
      console.log(`skip ${names[i]} (exists, ${Math.round(stat.size/1024)}KB)`);
      continue;
    }
    try {
      await download(URLS[i], dest, cookieHeader);
      const buf = fs.readFileSync(dest, {encoding:null});
      if (buf.slice(0,5).toString().includes('<!')) {
        fs.unlinkSync(dest);
        console.warn(`✗ ${names[i]}: got HTML`);
      } else {
        console.log(`✓ ${names[i]} (${Math.round(buf.length/1024)}KB)`);
      }
    } catch(e) {
      console.warn(`✗ ${names[i]}: ${e.message}`);
    }
  }
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
