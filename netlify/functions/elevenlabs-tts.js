// ElevenLabs TTS proxy — keeps API key server-side, returns base64 MP3
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID_DEFAULT = process.env.ELEVENLABS_VOICE_ID;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  if (!ELEVENLABS_API_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ElevenLabs not configured' }) };
  }

  try {
    const { text, voiceId } = JSON.parse(event.body || '{}');
    if (!text?.trim()) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Text required' }) };
    }

    const voice = voiceId || ELEVENLABS_VOICE_ID_DEFAULT;
    if (!voice) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'No voice ID configured' }) };
    }

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.slice(0, 800),
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('ElevenLabs error:', res.status, errText.slice(0, 300));
      return {
        statusCode: res.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `ElevenLabs ${res.status}` }),
      };
    }

    const audioBuffer = await res.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: audioBase64, format: 'mp3' }),
    };
  } catch (err) {
    console.error('elevenlabs-tts error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message || 'TTS error' }),
    };
  }
};
