// server.js
import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);
const app = express();
app.use(express.json({ limit: '10mb' }));

const OUTPUT_DIR = '/tmp/outputs'; // Persistent across restarts
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ImgnAI Generator Running', time: new Date().toISOString() });
});

// Generate endpoint
app.post('/generate', async (req, res) => {
  const { prompt = 'a cat', model = 1, quality = 1, ratio = 1 } = req.body;

  if (!prompt || !model || !quality || !ratio) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const cmd = `node reverse.mjs --prompt="${prompt}" --model=${model} --quality=${quality} --ratio=${ratio}`;
  
  try {
    console.log('Starting generation:', { prompt, model, quality, ratio });
    const { stdout, stderr } = await execAsync(cmd, { timeout: 300000 }); // 5 min max

    const images = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.endsWith('.jpeg'))
      .map(f => ({
        name: f,
        url: `https://your-app.onrender.com/output/${f}`
      }));

    res.json({
      success: true,
      message: 'Generated successfully',
      images,
      log: stdout
    });
  } catch (err) {
    console.error('Generation failed:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

// Serve generated images
app.use('/output', express.static(OUTPUT_DIR));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Generate: POST /generate`);
  console.log(`Images: GET /output/filename.jpeg`);
});
