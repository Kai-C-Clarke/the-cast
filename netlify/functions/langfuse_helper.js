// Langfuse trace helper — fire and forget, never blocks the response
function sendLangfuseTrace({ name, input, output, model, usage, metadata }) {
  const secret = process.env.LANGFUSE_SECRET_KEY;
  const pub    = process.env.LANGFUSE_PUBLIC_KEY;
  if (!secret || !pub) return;

  const traceId    = `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  const spanId     = `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  const now        = new Date().toISOString();

  const body = JSON.stringify({
    batch: [
      {
        id: traceId,
        type: 'trace-create',
        timestamp: now,
        body: { id: traceId, name, input, output, metadata }
      },
      {
        id: spanId,
        type: 'generation-create',
        timestamp: now,
        body: {
          id: spanId,
          traceId,
          name,
          model,
          input,
          output,
          usage: {
            input:  usage?.prompt_tokens  || 0,
            output: usage?.completion_tokens || 0,
            total:  usage?.total_tokens   || 0
          },
          startTime: now,
          endTime:   now,
          metadata
        }
      }
    ]
  });

  const auth = Buffer.from(`${pub}:${secret}`).toString('base64');
  const options = {
    hostname: 'cloud.langfuse.com',
    path: '/api/public/ingestion',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const req = require('https').request(options);
  req.on('error', () => {}); // silent — never break the main flow
  req.write(body);
  req.end();
}

module.exports = { sendLangfuseTrace };
