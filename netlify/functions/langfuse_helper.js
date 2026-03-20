const https = require('https');

function sendLangfuseTrace({ name, input, output, model, usage, metadata }) {
  const secret = process.env.LANGFUSE_SECRET_KEY;
  const pub    = process.env.LANGFUSE_PUBLIC_KEY;
  if (!secret || !pub) return;

  const traceId  = `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  const now      = new Date().toISOString();
  const auth     = Buffer.from(`${pub}:${secret}`).toString('base64');

  const body = JSON.stringify({
    batch: [
      {
        id:        traceId,
        type:      'trace-create',
        timestamp: now,
        body: {
          id:        traceId,
          name,
          input:     JSON.stringify(input)?.slice(0, 1000),
          output:    typeof output === 'string' ? output.slice(0, 1000) : JSON.stringify(output)?.slice(0, 1000),
          metadata
        }
      },
      {
        id:        `gen-${traceId}`,
        type:      'generation-create',
        timestamp: now,
        body: {
          id:        `gen-${traceId}`,
          traceId,
          name,
          model:     model || 'deepseek-chat',
          startTime: now,
          endTime:   now,
          input:     JSON.stringify(input)?.slice(0, 1000),
          output:    typeof output === 'string' ? output.slice(0, 1000) : JSON.stringify(output)?.slice(0, 1000),
          usage: {
            input:  usage?.prompt_tokens     || 0,
            output: usage?.completion_tokens || 0,
            total:  usage?.total_tokens      || 0
          },
          metadata
        }
      }
    ]
  });

  const options = {
    hostname: 'cloud.langfuse.com',
    path:     '/api/public/ingestion',
    method:   'POST',
    headers: {
      'Content-Type':   'application/json',
      'Authorization':  `Basic ${auth}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode !== 207 && res.statusCode !== 200) {
        console.log(`[langfuse] ingestion status ${res.statusCode}: ${data.slice(0, 200)}`);
      }
    });
  });
  req.on('error', (e) => console.log(`[langfuse] error: ${e.message}`));
  req.write(body);
  req.end();
}

module.exports = { sendLangfuseTrace };
