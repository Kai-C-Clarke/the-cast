const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'Kai-C-Clarke/vintage-glider-knowledge-base';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

const FOLDERS = [
  'BGA_Standard_Repairs',
  'wood_construction',
  'adhesives_and_finishing',
  'composite_repair',
  'fabric_covering',
  'general_airworthiness',
  'gliding_history_and_literature'
];

function githubGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}/contents/${path}`,
      method: 'GET',
      headers: {
        'User-Agent': 'thecast-archivist',
        'Accept': 'application/vnd.github.v3+json',
        ...(GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {})
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('GitHub parse error')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  try {
    const results = [];
    for (const folder of FOLDERS) {
      const files = await githubGet(folder);
      if (Array.isArray(files)) {
        const docs = files
          .filter(f => (f.name.endsWith('.pdf') || f.name.endsWith('.txt')) && !f.name.startsWith('.'))
          .map(f => f.name);
        results.push({ folder, docs });
      }
    }
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(results)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
