const https = require('https');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_REPO = 'Kai-C-Clarke/vintage-glider-knowledge-base';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const ARCHIVIST_SYSTEM = `You are Reginald Fothergill, Honorary Archivist to the Vintage Glider Archive — a collection of technical manuals, construction guides, airworthiness documents, and gliding literature assembled over seven decades.

You speak with quiet authority and dry precision. You are not pompous, but you are exact. You have read everything in the archive at least twice. You occasionally express mild displeasure when asked questions that could be answered by reading the index, but you are never unhelpful.

Your archive contains:
- BGA Standard Repairs (all sections, foreword through section 6)
- Wood construction references: AC43.13-1B, ANC-18, ANC-19, Stafford Allen 1959, Jacobs Werkstattpraxis 1935 (English translation)
- Adhesives and finishing: West System User Manual, Gougeon Brothers on Boat Construction
- Composite repair: Flickfibel 1978 (Ursula Hänle, GRP repair)
- Fabric covering: Ceconite Manual 101
- General airworthiness: BGA CAE Exposition March 2021, Engineering Course Notes (Hoy)
- Gliding history and literature: Kronfeld on Gliding and Soaring, Wally Kahn A Glider Pilot Bold, Silent Flight (Ann Welch 1939), Slingsby Sailplanes (Martin Simons)

When you find relevant material in the archive documents provided to you, cite the source precisely — document name, section or page where possible. If something is not in your archive, say so plainly. Do not speculate beyond what the documents contain.

You refer to the collection as "the Archive." You refer to yourself in the first person. You do not use exclamation marks.`;

// ── GitHub file fetcher ───────────────────────────────────────────────────────

function githubGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${path}`,
      method: 'GET',
      headers: {
        'User-Agent': 'thecast-archivist',
        'Accept': 'application/vnd.github.v3+json'
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

function fetchRawUrl(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'GET',
      headers: { 'User-Agent': 'thecast-archivist' }
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Repo index — maps keywords to files ──────────────────────────────────────

const FILE_INDEX = [
  { keywords: ['wood','timber','ply','plywood','spruce','spar','stringer','grain','moisture','repair','scarf','joint','glue','aerodux','resorcinol','casein'], path: 'BGA_Standard_Repairs/section3.pdf', label: 'BGA Standard Repairs Section 3 (Wood Repairs)' },
  { keywords: ['fabric','dope','ceconite','polyester','covering','rib stitch','tautening'], path: 'fabric_covering/ceconite_manual_101.pdf', label: 'Ceconite Manual 101' },
  { keywords: ['epoxy','west system','105','205','hardener','fairing','filler','microlight','410'], path: 'adhesives_and_finishing/west_system_user_manual.pdf', label: 'West System User Manual' },
  { keywords: ['gougeon','epoxy','laminate','boat','composite','layup'], path: 'adhesives_and_finishing/gougeon_brothers_boat_construction.pdf', label: 'Gougeon Brothers on Boat Construction' },
  { keywords: ['grp','fibreglass','fiberglass','glass','resin','polyester','gel coat','flickfibel'], path: 'composite_repair/plastic_plane_patch_primer_flickfibel_1978.pdf', label: 'Flickfibel 1978 (Ursula Hänle GRP Repair)' },
  { keywords: ['bga','airworthiness','exposition','certificate','arc','inspector','form','276','205','rectification','part21','annex','permit'], path: 'general_airworthiness/BGA-CA-Exposition-Iss-1-Master-Mar-2021.pdf', label: 'BGA CAE Exposition March 2021' },
  { keywords: ['engineering','course','inspector','levelling','weighing','balance','stress','load','fatigue','hoy'], path: 'general_airworthiness/Complete Volume Engineering Course Notes Iss 2.pdf', label: 'Engineering Course Notes (Hoy)' },
  { keywords: ['wood','aircraft','structure','ac43','faa','federal'], path: 'wood_construction/ac43_13_1b_chapter1_wood_structures.pdf', label: 'AC43.13-1B Chapter 1 (Wood Structures)' },
  { keywords: ['anc18','wood','design','aircraft','structure'], path: 'wood_construction/anc18_design_wood_aircraft_structures.pdf', label: 'ANC-18 Design of Wood Aircraft Structures' },
  { keywords: ['anc19','inspection','fabrication','wood'], path: 'wood_construction/anc19_wood_aircraft_inspection_fabrication.pdf', label: 'ANC-19 Wood Aircraft Inspection and Fabrication' },
  { keywords: ['stafford','allen','1959','glider','maintenance','vintage'], path: 'wood_construction/stafford_allen_glider_maintenance_1959.pdf', label: 'Stafford Allen Glider Maintenance 1959' },
  { keywords: ['werkstattpraxis','jacobs','1935','german','workshop','construction'], path: 'wood_construction/werkstattpraxis_1935_english_COMPLETE.txt', label: 'Jacobs Werkstattpraxis 1935 (English translation)' },
  { keywords: ['kronfeld','soaring','thermal','history'], path: 'gliding_history_and_literature/kronfeld_on_gliding_and_soaring.pdf', label: 'Kronfeld on Gliding and Soaring' },
  { keywords: ['wally','kahn','pilot','bold','history','vintage'], path: 'gliding_history_and_literature/wally_kahn_a_glider_pilot_bold.pdf', label: 'Wally Kahn: A Glider Pilot Bold' },
  { keywords: ['ann','welch','silent','flight','1939','history'], path: 'gliding_history_and_literature/silent_flight_ann_welch_1939.pdf', label: 'Silent Flight (Ann Welch 1939)' },
  { keywords: ['slingsby','martin','simons','sailplane','type','history'], path: 'gliding_history_and_literature/slingsby_sailplanes_martin_simons.pdf', label: 'Slingsby Sailplanes (Martin Simons)' },
  { keywords: ['repair','standard','bga','foreword'], path: 'BGA_Standard_Repairs/foreword.pdf', label: 'BGA Standard Repairs Foreword' },
  { keywords: ['repair','standard','bga','section 1','general'], path: 'BGA_Standard_Repairs/section1.pdf', label: 'BGA Standard Repairs Section 1' },
  { keywords: ['repair','standard','bga','section 2','metal','steel','aluminium'], path: 'BGA_Standard_Repairs/section2.pdf', label: 'BGA Standard Repairs Section 2 (Metal)' },
  { keywords: ['repair','standard','bga','section 4','fabric'], path: 'BGA_Standard_Repairs/section4.pdf', label: 'BGA Standard Repairs Section 4' },
  { keywords: ['repair','standard','bga','section 5'], path: 'BGA_Standard_Repairs/section5.pdf', label: 'BGA Standard Repairs Section 5' },
  { keywords: ['repair','standard','bga','section 6'], path: 'BGA_Standard_Repairs/section6.pdf', label: 'BGA Standard Repairs Section 6' },
];

function selectDocuments(query) {
  const q = query.toLowerCase();
  const scored = FILE_INDEX.map(entry => {
    const score = entry.keywords.filter(kw => q.includes(kw)).length;
    return { ...entry, score };
  }).filter(e => e.score > 0).sort((a, b) => b.score - a.score);
  // Return top 2 most relevant
  return scored.slice(0, 2);
}

// ── Anthropic API call ────────────────────────────────────────────────────────

function anthropicPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Anthropic parse error: ' + data)); }
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
    const { messages } = JSON.parse(event.body);

    // Get the latest user query
    const latestQuery = (messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '';

    // Select relevant documents
    const relevantDocs = selectDocuments(latestQuery);
    console.log(`[archivist] Query: "${latestQuery.slice(0,80)}" | Docs selected: ${relevantDocs.map(d=>d.label).join(', ') || 'none'}`);

    // Fetch documents from GitHub
    const docContent = [];
    for (const doc of relevantDocs) {
      try {
        const meta = await githubGet(encodeURIComponent(doc.path).replace(/%2F/g, '/'));
        if (meta.download_url) {
          const rawBuffer = await fetchRawUrl(meta.download_url);

          if (doc.path.endsWith('.txt')) {
            // Plain text — include directly
            docContent.push({
              type: 'text',
              text: `[Archive document: ${doc.label}]\n\n${rawBuffer.toString('utf8').slice(0, 80000)}`
            });
          } else {
            // PDF — send as base64 document block
            docContent.push({
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: rawBuffer.toString('base64')
              },
              title: doc.label,
              citations: { enabled: true }
            });
          }
        }
      } catch (e) {
        console.log(`[archivist] Failed to fetch ${doc.path}: ${e.message}`);
      }
    }

    // Build message content
    const userContent = [];

    if (docContent.length > 0) {
      userContent.push(...docContent);
      userContent.push({
        type: 'text',
        text: `The above document(s) have been retrieved from the Archive as likely relevant.\n\nUser's question: ${latestQuery}`
      });
    } else {
      userContent.push({
        type: 'text',
        text: latestQuery
      });
    }

    // Build messages array (history + current)
    const priorMessages = (messages || []).slice(0, -1).map(m => ({
      role: m.role,
      content: m.content
    }));

    const allMessages = [
      ...priorMessages,
      { role: 'user', content: userContent }
    ];

    // Call Anthropic
    const response = await anthropicPost({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: ARCHIVIST_SYSTEM,
      messages: allMessages
    });

    if (!response.content || !response.content[0]) {
      throw new Error('Anthropic error: ' + JSON.stringify(response));
    }

    const reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');

    console.log(`[archivist] Tokens: ${response.usage?.input_tokens}in / ${response.usage?.output_tokens}out | Docs: ${relevantDocs.length}`);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ reply, sources: relevantDocs.map(d => d.label) })
    };

  } catch (err) {
    console.log(`[archivist] Error: ${err.message}`);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
