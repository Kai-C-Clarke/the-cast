const tls = require('tls');

const SMTP_HOST = 'smtp.zoho.eu';
const SMTP_PORT = 465;
const FROM_ADDRESS = 'askian@askian.net';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function sendViaSmtp({ to, replyTo, fromName, subject, body }) {
  const password = process.env.ZOHO_PASSWORD;

  return new Promise((resolve, reject) => {
    let step = 0;
    let buf = '';

    const socket = tls.connect({ host: SMTP_HOST, port: SMTP_PORT }, () => {
      // Connected — wait for greeting
    });

    socket.setTimeout(15000);

    function send(cmd) {
      socket.write(cmd + '\r\n');
    }

    function processLine(line) {
      if (!line.match(/^\d{3} /)) return; // Skip continuation lines (250-)
      const code = parseInt(line.substring(0, 3));

      if (code >= 400) {
        reject(new Error('SMTP error: ' + line));
        socket.destroy();
        return;
      }

      switch (step) {
        case 0: if (code === 220) { send('EHLO thecast.chat'); step = 1; } break;
        case 1: if (code === 250) { send('AUTH LOGIN'); step = 2; } break;
        case 2: if (code === 334) { send(Buffer.from(FROM_ADDRESS).toString('base64')); step = 3; } break;
        case 3: if (code === 334) { send(Buffer.from(password).toString('base64')); step = 4; } break;
        case 4:
          if (code === 235) { send(`MAIL FROM:<${FROM_ADDRESS}>`); step = 5; }
          else { reject(new Error('Authentication failed')); socket.destroy(); }
          break;
        case 5: if (code === 250) { send(`RCPT TO:<${to}>`); step = 6; } break;
        case 6: if (code === 250) { send('DATA'); step = 7; } break;
        case 7:
          if (code === 354) {
            const msg = [
              `From: ${fromName} via The Cast <${FROM_ADDRESS}>`,
              `To: <${to}>`,
              `Reply-To: ${fromName} <${replyTo}>`,
              `Subject: ${subject}`,
              `Date: ${new Date().toUTCString()}`,
              `MIME-Version: 1.0`,
              `Content-Type: text/plain; charset=UTF-8`,
              '',
              body,
              '.'
            ].join('\r\n');
            socket.write(msg + '\r\n');
            step = 8;
          }
          break;
        case 8:
          if (code === 250) {
            send('QUIT');
            resolve({ success: true });
          }
          break;
      }
    }

    socket.on('data', (data) => {
      buf += data.toString();
      const lines = buf.split('\r\n');
      buf = lines.pop();
      for (const line of lines) {
        if (line) processLine(line);
      }
    });

    socket.on('timeout', () => { reject(new Error('SMTP connection timed out')); socket.destroy(); });
    socket.on('error', reject);
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const { to, replyTo, fromName, subject, body } = JSON.parse(event.body);

    if (!to || !replyTo || !fromName || !subject || !body) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Only allow sending to known cast addresses
    const allowed = ['henry','tesla','shakespeare','ada','davinci','churchill','cleopatra','brunel','amelia','dave','chantelle','jade','tarquin','pearl','askian','tomita'];
    const localPart = to.split('@')[0].toLowerCase();
    if (!allowed.includes(localPart)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid recipient' }) };
    }

    await sendViaSmtp({ to, replyTo, fromName, subject, body });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
