// reverse.mjs
import * as fs from 'fs';
import * as path from 'path';
import { Buffer } from 'buffer';
import { connect } from 'puppeteer-real-browser';

const BASE_URL = 'https://app.imgnai.com/services/webappms';
const LOGIN_URL = 'https://app.imgnai.com/login';
const GENERATE_URL = 'https://app.imgnai.com/generate';
const IMAGE_BASE_URL = 'https://wasmall.imgnai.com/';
const PROFILE_DIR = '/tmp/imgnai-profile';
const OUTPUT_DIR = '/tmp/outputs';

const USERNAME = 'imgnai69';
const PASSWORD = 'imgnai@1trick.net';

const API_MAPPINGS = {
  MODELS: { 1: { name: 'Gen', id: 'Gen' } },
  QUALITY: { 1: { name: 'Fast', value: true, quality_modifier: 30 }, 2: { name: 'High Quality', value: false, quality_modifier: 75 } },
  ASPECT_RATIO: { 1: { name: '5:2', res: 'WIDE_LARGE', w: 1024, h: 409 } }
};

const wait = ms => new Promise(r => setTimeout(r, ms));
function getUniquePrefix() { return Date.now().toString(36); }

async function downloadImage(url, filename) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(filename, buf);
    console.log(`Saved: ${filename}`);
    return true;
  } catch (e) {
    console.error(`Download failed: ${e.message}`);
    return false;
  }
}

async function setupAuthenticatedPage() {
  console.log('Launching headless browser with extended timeout...');
  const chromePath = process.env.CHROME_BIN || '/usr/bin/google-chrome-stable';
  console.log(`Chrome path: ${chromePath}`);

  const { page, browser } = await connect({
    headless: 'new',
    executablePath: chromePath,
    turnstile: true,
    userDataDir: PROFILE_DIR,
    timeout: 180000,  // 3 MINUTES TO CONNECT (FIXES SOCKET HANG UP)
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  console.log('Browser launched, navigating to login...');
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle0', timeout: 180000 });

  const auth = (await page.cookies()).find(c => c.name === 'authentication');
  if (auth) {
    try {
      const obj = JSON.parse(decodeURIComponent(auth.value));
      if (obj.state?.token) {
        console.log(`Already logged in: ${obj.state.username}`);
        await page.goto(GENERATE_URL, { waitUntil: 'networkidle0' });
        return { page, browser, jwt: obj.state.token };
      }
    } catch (e) {
      console.warn('Invalid auth cookie, logging in...');
    }
  }

  console.log('Logging in...');
  await page.waitForSelector('input[name="username"]', { timeout: 30000 });
  await page.type('input[name="username"]', USERNAME);
  await page.type('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
  await page.goto(GENERATE_URL, { waitUntil: 'networkidle0', timeout: 60000 });

  const finalAuth = (await page.cookies()).find(c => c.name === 'authentication');
  if (!finalAuth) throw new Error('Login failed');
  const authObj = JSON.parse(decodeURIComponent(finalAuth.value));
  if (!authObj.state?.token) throw new Error('No JWT');
  console.log(`Logged in: ${authObj.state.username}`);
  return { page, browser, jwt: authObj.state.token };
}

async function autoGenerate(settings) {
  const runId = getUniquePrefix();
  const { page, browser, jwt } = await setupAuthenticatedPage();

  try {
    console.log('Creating session...');
    const sessionUuid = await page.evaluate(async (url, jwt) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${jwt}` }
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`Session failed: ${text}`);
      return text.trim();
    }, `${BASE_URL}/api/generate-session`, jwt);

    if (!sessionUuid) throw new Error('No session UUID');
    console.log(`Session: ${sessionUuid}`);

    const batch = Array(4).fill().map((_, i) => ({
      nsfw: false,
      profile: settings.model.id,
      n_steps: settings.quality.quality_modifier,
      strength: 0.76,
      seed: Math.floor(Math.random() * 4e9) + i,
      prompt: settings.prompt,
      negative_prompt: 'low quality, blurry',
      input: null,
      width: settings.aspectRatio.w,
      height: settings.aspectRatio.h,
      guidance_scale: 3.5,
      image_resolution: settings.aspectRatio.res,
      is_uhd: false,
      is_fast: settings.quality.value,
      use_assistant: false
    }));

    const payload = { session_uuid: sessionUuid, use_credits: false, use_assistant: false, generate_image_list: batch };

    console.log('Submitting batch...');
    const jobIds = await page.evaluate(async (url, payload, jwt) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`
        },
        body: JSON.stringify(payload)
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`Batch failed: ${text}`);
      const data = JSON.parse(text);
      return Array.isArray(data) ? data : data.jobIds || [];
    }, `${BASE_URL}/api/generate-image-batch`, payload, jwt);

    console.log(`Started ${jobIds.length} jobs`);

    const urls = [];
    for (const id of jobIds) {
      console.log(`Polling job: ${id}`);
      let completed = false;
      for (let i = 0; i < 180; i++) {
        await wait(2000);
        try {
          const data = await page.evaluate(async (url, jwt) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 45000);
            try {
              const r = await fetch(url, { headers: { 'Authorization': `Bearer ${jwt}` }, signal: controller.signal });
              clearTimeout(timeoutId);
              if (!r.ok) return null;
              return await r.json();
            } catch {
              clearTimeout(timeoutId);
              return null;
            }
          }, `${BASE_URL}/api/generate-image/uuid/${id}`, jwt);

          if (data?.response?.image_url) {
            const fullUrl = IMAGE_BASE_URL + data.response.image_url;
            urls.push(fullUrl);
            console.log(`Completed ${id}`);
            completed = true;
            break;
          }
        } catch (e) {
          if (e.name === 'AbortError') continue;
          console.error(`Poll error: ${e.message}`);
        }
      }
      if (!completed) console.warn(`Job ${id} timed out`);
    }

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
    let saved = 0;
    for (let i = 0; i < urls.length; i++) {
      const filename = path.join(OUTPUT_DIR, `${runId}_${i + 1}.jpeg`);
      if (await downloadImage(urls[i], filename)) saved++;
    }
    console.log(`\nSUCCESS: ${saved}/${urls.length} images saved in ${OUTPUT_DIR}`);

  } catch (e) {
    console.error('Generation failed:', e.message);
  } finally {
    try { await browser.close(); } catch {}
  }
}

// CLI Args
const args = process.argv.slice(2);
const getArg = (flag) => args.find(a => a.startsWith(flag))?.split('=')[1];

const settings = {
  prompt: getArg('--prompt') || 'a magical cat wizard',
  model: API_MAPPINGS.MODELS[parseInt(getArg('--model') || 1)],
  quality: API_MAPPINGS.QUALITY[parseInt(getArg('--quality') || 1)],
  aspectRatio: API_MAPPINGS.ASPECT_RATIO[parseInt(getArg('--ratio') || 1)]
};

(async () => {
  try {
    if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR);
    await autoGenerate(settings);
  } catch (e) {
    console.error('Startup failed:', e.message);
    process.exit(1);
  }
})();
