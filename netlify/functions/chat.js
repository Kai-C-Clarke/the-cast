const https = require('https');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const MEM0_API_KEY     = process.env.MEM0_API_KEY;
const { sendLangfuseTrace } = require('./langfuse_helper');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// ── Mem0 helpers ──────────────────────────────────────────────────────────────

function mem0Request(method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.mem0.ai',
      path,
      method,
      headers: {
        'Authorization': `Token ${MEM0_API_KEY}`,
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        } : {})
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', (e) => { console.log(`[mem0] ${method} ${path} error: ${e.message}`); resolve(null); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function searchMemories(userId, query) {
  if (!MEM0_API_KEY || !userId) return [];
  try {
    const result = await mem0Request('POST', '/v1/memories/search/', {
      query,
      user_id: userId,
      limit: 8
    });
    return result?.results || [];
  } catch { return []; }
}

async function getAllMemories(userId) {
  if (!MEM0_API_KEY || !userId) return [];
  try {
    const result = await mem0Request('GET', `/v1/memories/?user_id=${encodeURIComponent(userId)}&limit=10`, null);
    console.log(`[mem0] getAllMemories result: ${JSON.stringify(result)?.slice(0, 200)}`);
    if (Array.isArray(result)) return result;
    return result?.results || result?.memories || [];
  } catch (e) {
    console.log(`[mem0] getAllMemories error: ${e.message}`);
    return [];
  }
}

async function addMemory(userId, messages, agentId) {
  if (!MEM0_API_KEY || !userId) return;
  mem0Request('POST', '/v1/memories/', {
    messages,
    user_id: userId,
    agent_id: agentId,
    metadata: { source: 'thecast.chat' }
  }); // fire and forget
}

// ── DeepSeek helper ───────────────────────────────────────────────────────────

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

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const { messages, system_prompt, user_id, character } = JSON.parse(event.body);

    // ── 1. Retrieve relevant memories for this user ──
    let memoriesContext = '';
    if (user_id) {
      // Build a broad query combining recent messages for better semantic matching
      const recentUserMsgs = (messages || [])
        .filter(m => m.role === 'user')
        .slice(-3)
        .map(m => m.content)
        .join(' ');
      const broadQuery = `${recentUserMsgs} previous conversations projects interests repairs`.trim();

      // Search with broad query, fall back to fetching all memories if none found
      let memories = await searchMemories(user_id, broadQuery);
      if (memories.length === 0) {
        memories = await getAllMemories(user_id);
      }

      if (memories.length > 0) {
        memoriesContext = '\n\nWhat you remember about this person from previous conversations:\n' +
          memories.map(m => `- ${m.memory}`).join('\n') + '\n';
      }
    }

    // ── 2. Build enriched system prompt ──
    const enrichedPrompt = memoriesContext
      ? system_prompt + memoriesContext
      : system_prompt;

    // ── 3. Call DeepSeek ──
    const data = await httpsPost({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: enrichedPrompt },
        ...messages
      ],
      max_tokens: 600,
      temperature: 0.85
    });

    if (!data.choices || !data.choices[0]) {
      throw new Error('API error: ' + JSON.stringify(data));
    }

    const reply = data.choices[0].message.content;

    // ── 4. Save exchange to Mem0 (fire and forget) ──
    if (user_id && messages?.length > 0) {
      const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
      addMemory(user_id, [
        { role: 'user',      content: lastUserMsg },
        { role: 'assistant', content: reply }
      ], character || 'thecast');
    }

    // ── 5. Log ──
    console.log(`[chat.js] Model: ${data.model} | Tokens: ${data.usage?.total_tokens || '?'} | User: ${user_id || 'anonymous'} | Memories: ${memoriesContext ? 'yes' : 'none'}`);

    // ── 6. Langfuse trace ──
    sendLangfuseTrace({
      name: character ? `chat-${character}` : 'wire-chat',
      input: { system_prompt: system_prompt?.slice(0, 200), messages },
      output: reply,
      model: data.model,
      usage: data.usage,
      metadata: { source: 'thecast.chat', function: 'chat', user_id, character }
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ reply })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
