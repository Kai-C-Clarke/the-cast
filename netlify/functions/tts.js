const https = require('https');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Voice IDs per character — add more as voices are approved
const VOICE_MAP = {
  dave: '2ajXGJNYBR0iNHpS4VZb', // Rob — Tough & Callous (EastEnders villain energy)
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function elevenLabsTTS(text, voiceId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability:        0.5,
        similarity_boost: 0.75,
        style:            0.0,
        use_speaker_boost: true
      }
    });

    const options = {
      hostname: 'api.elevenlabs.io',
      path:     `/v1/text-to-speech/${voiceId}`,
      method:   'POST',
      headers: {
        'xi-api-key':     ELEVENLABS_API_KEY,
        'Content-Type':   'application/json',
        'Accept':         'audio/mpeg',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const chunks = [];
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let err = '';
        res.on('data', c => err += c);
        res.on('end', () => reject(new Error(`ElevenLabs error ${res.statusCode}: ${err}`)));
        return;
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: 'Method Not Allowed' };
  }

  try {
    const { text, character } = JSON.parse(event.body);

    if (!text || !character) {
      return { statusCode: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing text or character' }) };
    }

    const voiceId = VOICE_MAP[character];
    if (!voiceId) {
      return { statusCode: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No voice for this character' }) };
    }

    // Trim text to 500 chars max to keep costs down
    const trimmed = text.slice(0, 500);

    const audioBuffer = await elevenLabsTTS(trimmed, voiceId);
    const base64 = audioBuffer.toString('base64');

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64 })
    };

  } catch (err) {
    console.log(`[tts.js] error: ${err.message}`);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
