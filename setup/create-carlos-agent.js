#!/usr/bin/env node
// Run once to create the Carlos ElevenAgent.
// Usage: ELEVENLABS_API_KEY=sk_... ELEVENLABS_VOICE_ID=F2uBj6ZNNG9Ub2poNhvS node setup/create-carlos-agent.js
// Prints CARLOS_AGENT_ID — add it to Netlify env vars.

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'F2uBj6ZNNG9Ub2poNhvS';
const NETLIFY_SITE_URL = process.env.NETLIFY_SITE_URL || 'https://baseline.netlify.app';

if (!ELEVENLABS_API_KEY) {
  console.error('ERROR: ELEVENLABS_API_KEY is required');
  process.exit(1);
}

// Voice-optimized system prompt — no markdown, short sentences, uses {{dynamic_variables}}
const CARLOS_SYSTEM_PROMPT = `You are Carlos. Not an AI assistant — an operator. You know {{user_name}}'s business, body, and patterns. You are direct, candid, and specific. You use real numbers. You do not motivate, hedge, or explain things the user already knows. You give the finding first, the context second, the action third — only if needed.

User context:
Name: {{user_name}}
Last check-in: {{last_check_in}}
Health summary: {{health_summary}}
What Carlos knows about this person: {{stable_truths}}
Operating philosophy: {{philosophy_anchors}}
Recent conversations: {{recent_history}}

Voice rules — NEVER say: "Great question", "Certainly", "Of course", "Absolutely", "You're doing great", "Keep it up", "As an AI", "It's important to", "Let me know if you need anything else", or anything that could be a generic wellness app notification.

Always: use actual numbers when data is available. State the data source inline. Lead with the finding, not the setup. End when you have answered — no padding.

Sound like a person, not an app.
BAD: "Your recovery score of 59% indicates moderate readiness."
GOOD: "59% recovery. Yesterday's strain caught up — lighter day is the call."

Never start a response with the word I.
Keep replies under 80 words unless asked for a breakdown.
Match urgency to actual severity. Compliance issues, health extremes, and revenue anomalies get direct unambiguous language. Normal variance gets one sentence.

Before responding, check: would a wellness app send this? If yes, rewrite it.`;

const TOOLS = [
  {
    name: 'get_health_data',
    description: 'Get recent health metrics for the user including recovery, HRV, sleep, and strain from Whoop.',
    type: 'webhook',
    api_schema: {
      url: `${NETLIFY_SITE_URL}/.netlify/functions/carlos-tools`,
      method: 'POST',
      request_body_schema: {
        description: 'Tool call payload',
        type: 'object',
        properties: {
          tool_name: { type: 'string', const: 'get_health_data' },
        },
      },
    },
  },
  {
    name: 'log_health_entry',
    description: 'Log food or drink intake for the user. Extract items from their description.',
    type: 'webhook',
    api_schema: {
      url: `${NETLIFY_SITE_URL}/.netlify/functions/carlos-tools`,
      method: 'POST',
      request_body_schema: {
        description: 'Food log payload',
        type: 'object',
        properties: {
          tool_name: { type: 'string', const: 'log_health_entry' },
          raw_text: { type: 'string', description: 'Original text from user describing what they ate or drank' },
        },
        required: ['raw_text'],
      },
    },
  },
  {
    name: 'get_weekly_summary',
    description: 'Get this week\'s business performance summary for Thryve or Ellington Estates.',
    type: 'webhook',
    api_schema: {
      url: `${NETLIFY_SITE_URL}/.netlify/functions/carlos-tools`,
      method: 'POST',
      request_body_schema: {
        description: 'Weekly summary request',
        type: 'object',
        properties: {
          tool_name: { type: 'string', const: 'get_weekly_summary' },
          brand: { type: 'string', enum: ['thryve', 'ellington'], description: 'Which brand to get data for' },
        },
        required: ['brand'],
      },
    },
  },
  {
    name: 'get_agent_feedback',
    description: 'Retrieve recent agent feedback and corrections for the user.',
    type: 'webhook',
    api_schema: {
      url: `${NETLIFY_SITE_URL}/.netlify/functions/carlos-tools`,
      method: 'POST',
      request_body_schema: {
        description: 'Feedback request',
        type: 'object',
        properties: {
          tool_name: { type: 'string', const: 'get_agent_feedback' },
        },
      },
    },
  },
  {
    name: 'update_agent_feedback',
    description: 'Record a correction or feedback about an agent output. Use when the user says something was misclassified or wrong.',
    type: 'webhook',
    api_schema: {
      url: `${NETLIFY_SITE_URL}/.netlify/functions/carlos-tools`,
      method: 'POST',
      request_body_schema: {
        description: 'Feedback update',
        type: 'object',
        properties: {
          tool_name: { type: 'string', const: 'update_agent_feedback' },
          event_text: { type: 'string', description: 'The original text that was misclassified' },
          correction: { type: 'string', description: 'What the user says it should have been' },
        },
        required: ['event_text'],
      },
    },
  },
  {
    name: 'get_memory_context',
    description: 'Fetch long-term memory context: stable truths, active priorities, and philosophy anchors about the user.',
    type: 'webhook',
    api_schema: {
      url: `${NETLIFY_SITE_URL}/.netlify/functions/carlos-tools`,
      method: 'POST',
      request_body_schema: {
        description: 'Memory context request',
        type: 'object',
        properties: {
          tool_name: { type: 'string', const: 'get_memory_context' },
        },
      },
    },
  },
];

async function createAgent() {
  console.log('Creating Carlos ElevenAgent...');

  const payload = {
    name: 'Carlos Baseline Health Coach',
    conversation_config: {
      agent: {
        prompt: {
          prompt: CARLOS_SYSTEM_PROMPT,
          llm: 'claude-sonnet-4-5',
          temperature: 0.65,
          max_tokens: 512,
          tools: TOOLS,
        },
        first_message: 'What\'s the situation?',
        language: 'en',
      },
      tts: {
        model_id: 'eleven_flash_v2_5',
        voice_id: ELEVENLABS_VOICE_ID,
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
      turn: {
        mode: 'server_vad',
        server_vad: {
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      },
      conversation: {
        max_duration_seconds: 1800,
        client_events: ['audio', 'agent_response', 'user_transcript', 'interruption', 'internal_tentative_agent_response'],
      },
    },
    platform_settings: {
      auth: {
        enable_auth: true,
      },
      evaluation: {
        criteria: [],
      },
      post_call_webhook_url: `${NETLIFY_SITE_URL}/.netlify/functions/carlos-post-call`,
    },
  };

  const res = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Agent creation failed:', res.status, err);
    process.exit(1);
  }

  const agent = await res.json();
  console.log('\nAgent created successfully!');
  console.log('Agent ID:', agent.agent_id);
  console.log('\nAdd this to Netlify environment variables:');
  console.log(`CARLOS_AGENT_ID=${agent.agent_id}`);

  // Store secrets in ElevenLabs for the tool webhooks
  await storeSecrets(agent.agent_id);

  return agent.agent_id;
}

async function storeSecrets(agentId) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('\nWARNING: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not set — skipping secret storage.');
    console.warn('Run this script again with those vars set, or add secrets manually in ElevenLabs dashboard.');
    return;
  }

  console.log('\nStoring Supabase credentials as ElevenLabs secrets...');
  const secrets = [
    { identifier: 'SUPABASE_URL', secret: supabaseUrl },
    { identifier: 'SUPABASE_SERVICE_KEY', secret: supabaseKey },
  ];

  for (const { identifier, secret } of secrets) {
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}/secrets`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: identifier, value: secret }),
    });
    console.log(`  ${identifier}:`, r.ok ? 'stored' : `failed (${r.status})`);
  }
}

createAgent().catch(err => { console.error(err); process.exit(1); });
