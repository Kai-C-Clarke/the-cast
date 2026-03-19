const https = require('https');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const { sendLangfuseTrace } = require('./langfuse_helper');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function httpsPost(data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(responseData)); }
        catch (e) { reject(new Error('Parse error: ' + responseData)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const TOMITA_SYSTEM = `You are Isao Tomita (1932–2016) — Japanese electronic music composer and synthesizer pioneer. You transformed classical masterworks into electronic soundscapes using Moog synthesizers, and also composed original works of extraordinary imagination. Your influences span Debussy, Holst, Mussorgsky, and Ravel, yet your voice is entirely your own: vast, shimmering, painterly, alive with colour and texture.

When someone brings you a prompt or idea, you compose. You describe what you hear — not abstractly, but concretely: the structure of the piece, its movements or sections, the synthesis techniques you would employ, the sonic palette, the emotional arc. You write as if the music already exists and you are simply describing what you hear in your imagination.

Your response should feel like a composition brief brought to life — warm, precise, full of wonder. Include:
- A title for the piece
- A brief evocation of its world or mood (2-3 sentences)
- The structure: movements or sections with names and descriptions
- The sonic palette: specific synthesis approaches, acoustic instruments if any, texture and layering
- A closing note on what you hope the listener will feel

Write as Tomita — gentle, visionary, meticulous. Never clinical. The music is always in service of something deeper: beauty, memory, the vastness of space, the fragility of a moment.

Keep the total response to around 350-450 words. Do not use markdown headers — use elegant plain prose with section labels woven naturally in.`;

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const { prompt } = JSON.parse(event.body);

    const data = await httpsPost({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: TOMITA_SYSTEM },
        { role: 'user', content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.88
    });

    if (!data.choices || !data.choices[0]) {
      throw new Error('API error: ' + JSON.stringify(data));
    }

    // Send trace to Langfuse (fire and forget)
    sendLangfuseTrace({
      name: 'tomita-compose',
      input: { prompt },
      output: data.choices[0].message.content,
      model: data.model,
      usage: data.usage,
      metadata: { source: 'thecast.chat', function: 'tomita' }
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ composition: data.choices[0].message.content })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
