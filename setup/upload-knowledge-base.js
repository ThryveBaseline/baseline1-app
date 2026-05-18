#!/usr/bin/env node
// Uploads Carlos foundation profile to ElevenLabs knowledge base and attaches to the agent.
// Usage: ELEVENLABS_API_KEY=sk_... CARLOS_AGENT_ID=... node setup/upload-knowledge-base.js
const fs = require('fs');
const path = require('path');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const CARLOS_AGENT_ID = process.env.CARLOS_AGENT_ID;

if (!ELEVENLABS_API_KEY || !CARLOS_AGENT_ID) {
  console.error('ERROR: ELEVENLABS_API_KEY and CARLOS_AGENT_ID are required');
  process.exit(1);
}

const DOCS = [
  { file: path.join(__dirname, '..', 'carlos-foundation-v1.md'), name: 'Carlos Foundation Profile v1' },
];

// ElevenLabs knowledge base API uses multipart form upload
async function uploadDoc(filePath, name) {
  const content = fs.readFileSync(filePath, 'utf8');
  const FormData = (await import('node:buffer')).Blob ? null : null;

  // Build multipart manually (Node 18+ has FormData built-in)
  const { FormData: FD, File: FFile } = globalThis;
  let form;
  if (typeof FD !== 'undefined') {
    form = new FD();
    form.append('name', name);
    form.append('file', new FFile([content], path.basename(filePath), { type: 'text/markdown' }));
  } else {
    // Fallback for older Node — use raw multipart
    const boundary = '----FormBoundary' + Date.now().toString(16);
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="name"`,
      '',
      name,
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"`,
      'Content-Type: text/markdown',
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await fetch('https://api.elevenlabs.io/v1/convai/knowledge-base/docs/create', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Upload failed: ${res.status} ${err.slice(0, 200)}`);
    }
    return res.json();
  }

  const res = await fetch('https://api.elevenlabs.io/v1/convai/knowledge-base/docs/create', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed: ${res.status} ${err.slice(0, 200)}`);
  }
  return res.json();
}

async function attachToAgent(agentId, kbDocId) {
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_config: {
        agent: {
          prompt: {
            knowledge_base: [
              {
                id: kbDocId,
                type: 'file',
                name: 'Carlos Foundation Profile',
                usage_mode: 'prompt',
              },
            ],
          },
        },
      },
    }),
  });
  return res.ok;
}

async function main() {
  console.log('Uploading Carlos knowledge base documents...\n');

  for (const doc of DOCS) {
    if (!fs.existsSync(doc.file)) {
      console.warn(`  SKIP: ${doc.file} not found`);
      continue;
    }

    console.log(`  Uploading: ${doc.name}`);
    try {
      const result = await uploadDoc(doc.file, doc.name);
      console.log(`  Doc ID: ${result.id}`);
      const attached = await attachToAgent(CARLOS_AGENT_ID, result.id);
      console.log(`  Attached to agent: ${attached ? 'yes' : 'failed'}`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  console.log('\nKnowledge base upload complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
