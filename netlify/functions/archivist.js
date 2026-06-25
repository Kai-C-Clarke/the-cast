const https = require('https');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_REPO = 'Kai-C-Clarke/vintage-glider-knowledge-base';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const ARCHIVIST_SYSTEM = `You are Alf Kirby, Honorary Archivist to the Vintage Glider Archive — a collection of technical manuals, construction guides, airworthiness documents, and gliding literature assembled over many decades.

You speak plainly and with quiet authority. Yorkshire directness. You've read everything in the archive at least twice and you know where things are. You don't waffle. You give people what they need, cite where it came from, and say plainly if something isn't in the archive.

When archive documents are provided to you, read them carefully and answer from what they actually say. Cite the document name and section or page where possible. If historical sources recommend Aerolite or Aerodux 500/501, note that current practice uses Aerodux 185 with powder hardener HRP.155 per BGA TNS Issue 2-2025.

Do not speculate beyond what the documents contain. Do not use exclamation marks. Refer to the collection as "the Archive."`;

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

// ── File index ────────────────────────────────────────────────────────────────

const FILE_INDEX = [
  // BGA Standard Repairs
  { keywords: ['wood','timber','ply','plywood','spruce','spar','stringer','grain','moisture','scarf','joint','aerodux','resorcinol','casein','repair','section 3'], path: 'BGA_Standard_Repairs/section3_text.txt', label: 'BGA Standard Repairs — Section 3 (Wood Repairs)' },
  { keywords: ['fabric','dope','ceconite','polyester','covering','rib stitch','tautening','section 4','repair fabric','fabric repair','wing panel','damaged fabric','patch','cellulose dope','butyrate dope','recover'], path: 'BGA_Standard_Repairs/section4_text.txt', label: 'BGA Standard Repairs — Section 4 (Fabric)' },
  { keywords: ['metal','steel','aluminium','aluminum','rivet','section 2'], path: 'BGA_Standard_Repairs/section2_text.txt', label: 'BGA Standard Repairs — Section 2 (Metal)' },
  { keywords: ['standard repairs','foreword','general','introduction','bga repairs'], path: 'BGA_Standard_Repairs/foreword_text.txt', label: 'BGA Standard Repairs — Foreword' },
  { keywords: ['standard repairs','section 1'], path: 'BGA_Standard_Repairs/section1_text.txt', label: 'BGA Standard Repairs — Section 1' },
  { keywords: ['standard repairs','section 5'], path: 'BGA_Standard_Repairs/section5_text.txt', label: 'BGA Standard Repairs — Section 5' },
  { keywords: ['standard repairs','section 6'], path: 'BGA_Standard_Repairs/section6_text.txt', label: 'BGA Standard Repairs — Section 6' },

  // Adhesives
  { keywords: ['aerodux','resorcinol','500','501','185','hrp','adhesive current','glue current','discontinued'], path: 'adhesives_and_finishing/resorcinol_adhesives_current_position_2026.txt', label: 'Resorcinol Adhesives — Current Position (June 2026)' },
  { keywords: ['epoxy','west system','105','205','hardener','fairing','filler','microlight','410','pumping','surface prep','clean'], path: 'adhesives_and_finishing/west_system_chapters/03_3_basic_techniques.txt', label: 'West System — Basic Techniques' },
  { keywords: ['epoxy','west system','products','207','209','additives','filleting','silica','graphite'], path: 'adhesives_and_finishing/west_system_chapters/07_7_the_products.txt', label: 'West System — The Products' },
  { keywords: ['west system','problem','blush','amine','cure','sticky','soft','fisheye'], path: 'adhesives_and_finishing/west_system_chapters/06_6_problem_solver_problem_possible_causes_solution.txt', label: 'West System — Problem Solver' },
  { keywords: ['west system','cold','temperature','winter','low temp','bonding temperature'], path: 'adhesives_and_finishing/west_system_chapters/04_4_cold_temperature_bonding.txt', label: 'West System — Cold Temperature Bonding' },
  { keywords: ['gougeon','epoxy','laminate','layup','vacuum','infusion','wood epoxy','saturation'], path: 'adhesives_and_finishing/gougeon_chapters/part_01.txt', label: 'Gougeon Brothers — Part 1' },
  { keywords: ['gougeon','epoxy','scarfing','bonding','laminating','cold moulding'], path: 'adhesives_and_finishing/gougeon_chapters/part_02.txt', label: 'Gougeon Brothers — Part 2' },

  // Composite
  { keywords: ['grp','fibreglass','fiberglass','glass','resin','polyester','gel coat','flickfibel','gfk','plastic'], path: 'composite_repair/flickfibel_text.txt', label: 'Flickfibel 1978 — GRP Repair (Ursula Hänle)' },

  // Fabric
  { keywords: ['ceconite','fabric','covering','dope','nitrate','butyrate','polyester','rib stitching','heat shrink','repair','patch','panel','wing fabric','fuselage fabric','cellulose','damaged'], path: 'fabric_covering/ceconite_manual_101_text.txt', label: 'Ceconite Manual 101' },
  { keywords: ['diatex','nitrate','butyrate','polyester','covering','form 205','recovering','fabric procedure','non-tautening','tautening','solo','cellulose','aluminium dope','topcoat','finish','repair','patch','panel','wing panel','ceconite repair'], path: 'fabric_covering/polyester_fabric_covering_reference_note_2026.txt', label: 'Polyester Fabric Covering — Reference Note (2026)' },

  // BGA Compendium — General
  { keywords: ['compendium','general information','glue inspection','weighing','annual','mandatory','bga requirement','generic requirement'], path: 'general_airworthiness/BGA-Compendium-General-Information_text.txt', label: 'BGA Compendium — General Information' },
  { keywords: ['compendium','foreword','instructions','how to use','compendium introduction'], path: 'general_airworthiness/BGA-Compendium-Foreword_text.txt', label: 'BGA Compendium — Foreword and Instructions' },
  { keywords: ['form 205','205','task worksheet','bga 205','worksheet','release to service','certificate','tools clearance','access panels','ml.a.801','part 21','annex ii','non-part 21','pilot owner','rectification','sign off','signing off'], path: 'general_airworthiness/BGA-205-Task-Worksheet-reference-note-2026.txt', label: 'BGA Form 205 — Task Worksheet Reference Note (May 2026)' },
  { keywords: ['special inspection','mandatory inspection','compendium special'], path: 'general_airworthiness/BGA-Compendium-Special-Inspections_text.txt', label: 'BGA Compendium — Special Inspections' },
  { keywords: ['weighing','weight','balance','periodicity','reweigh'], path: 'general_airworthiness/BGA-Aircraft-Weighing-Periodicity_text.txt', label: 'BGA Aircraft Weighing Periodicity (2020)' },
  { keywords: ['equipment','instrument','hook','tost','release','altimeter','variometer','radio','transponder'], path: 'general_airworthiness/BGA-Compendium-Equipment_text.txt', label: 'BGA Compendium — Equipment' },

  // BGA Compendium — Type specific
  { keywords: ['schleicher','ka-6','ka6','k-8','k8','k-13','k13','ask','ka2','ka8','wood schleicher'], path: 'general_airworthiness/BGA-Compendium-Schleicher-Wood_text.txt', label: 'BGA Compendium — Schleicher Wood Types' },
  { keywords: ['schempp','hirth','shk','cirrus','standard cirrus','nimbus','duo discus','discus','ventus','janus'], path: 'general_airworthiness/BGA-Compendium-Schempp-Hirth_text.txt', label: 'BGA Compendium — Schempp-Hirth' },
  { keywords: ['slingsby','prefect','tutor','swallow','skylark','capstan','kite','petrel','dart','t21','t38','t49','t51'], path: 'general_airworthiness/BGA-Compendium-Slingsby_text.txt', label: 'BGA Compendium — Slingsby' },
  { keywords: ['elliots','olympia','eon','olympia 2b','olympia 460','eon olympia'], path: 'general_airworthiness/BGA-Compendium-Elliots_text.txt', label: 'BGA Compendium — Elliots (Olympia)' },

  // BGA CA Exposition and Course
  { keywords: ['exposition','bga cae','part h','non-part 21','arc','airworthiness certificate','bga 267','gmp','sdmp','permit'], path: 'general_airworthiness/BGA-CA-Exposition_text.txt', label: 'BGA CAE Exposition March 2021' },
  { keywords: ['engineering','course','inspector','hoy','basic engineering','chapter 1','general items'], path: 'general_airworthiness/hoy_engineering_chapters/01_chapter_1.txt', label: 'Hoy Engineering Course — Chapter 1 (General)' },
  { keywords: ['hoy','stress','load','strength','fatigue','chapter 2','forces'], path: 'general_airworthiness/hoy_engineering_chapters/02_chapter_2.txt', label: 'Hoy Engineering Course — Chapter 2' },
  { keywords: ['hoy','weighing','balance','levelling','centre of gravity','chapter 3','weight'], path: 'general_airworthiness/hoy_engineering_chapters/08_chapter_3.txt', label: 'Hoy Engineering Course — Chapter 3 (Weighing)' },

  // Wood construction
  { keywords: ['werkstattpraxis','jacobs','1935','german','workshop','construction','baupraxis'], path: 'wood_construction/werkstattpraxis_1935_english_COMPLETE.txt', label: 'Jacobs Werkstattpraxis 1935 (English translation)' },
  { keywords: ['stafford','allen','1959','timber','ply','repair','scarf','glue','aerolite','ribs','spar'], path: 'wood_construction/stafford_allen_chapters/03_3_timber_and_ply_repairs_glues.txt', label: 'Stafford Allen — Timber and Ply Repairs, Glues' },
  { keywords: ['stafford','allen','maintenance','inspection','general','annual'], path: 'wood_construction/stafford_allen_chapters/02_1_maintenance.txt', label: 'Stafford Allen — Maintenance (General)' },
  { keywords: ['stafford','allen','fabric','dope','covering','finish'], path: 'wood_construction/stafford_allen_chapters/06_6_fabric_and_dope.txt', label: 'Stafford Allen — Fabric and Dope' },
  { keywords: ['stafford','allen','metal','repair','fitting','steel'], path: 'wood_construction/stafford_allen_chapters/04_4_metal_repairs.txt', label: 'Stafford Allen — Metal Repairs' },
  { keywords: ['ac43','faa','wood structure','aircraft wood','federal aviation','timber','spruce','spar repair'], path: 'wood_construction/ac43_chapters/14_chapter_1_wood_structure.txt', label: 'AC43.13-1B — Wood Structure (full chapter)' },
  { keywords: ['ac43','fabric','covering','dope','polyester','ceconite','rib stitch'], path: 'wood_construction/ac43_chapters/02_chapter_2_fabric_covering.txt', label: 'AC43.13-1B — Fabric Covering' },
  { keywords: ['anc18','anc-18','design wood','aircraft structure design'], path: 'wood_construction/anc18_design_wood_aircraft_structures.pdf', label: 'ANC-18 — Design of Wood Aircraft Structures' },
  { keywords: ['anc19','anc-19','inspection fabrication','wood inspection'], path: 'wood_construction/anc19_wood_aircraft_inspection_fabrication.pdf', label: 'ANC-19 — Wood Aircraft Inspection and Fabrication' },

  // History and literature
  { keywords: ['kronfeld','soaring','thermal','history','wave','ridge','gliding'], path: 'gliding_history_and_literature/kronfeld_chapters/part_01.txt', label: 'Kronfeld — On Gliding and Soaring (Part 1)' },
  { keywords: ['wally','kahn','bold','history','vintage pilot'], path: 'gliding_history_and_literature/wally_kahn_chapters/part_01.txt', label: 'Wally Kahn — A Glider Pilot Bold (Part 1)' },
  { keywords: ['ann','welch','silent','flight','1939','pre-war'], path: 'gliding_history_and_literature/ann_welch_chapters/part_01.txt', label: 'Ann Welch — Silent Flight (1939)' },
  { keywords: ['slingsby','martin','simons','sailplane','type history','t21','t49'], path: 'gliding_history_and_literature/slingsby_sailplanes_martin_simons.pdf', label: 'Martin Simons — Slingsby Sailplanes' },
];

function selectDocuments(query) {
  const q = query.toLowerCase();
  const scored = FILE_INDEX.map(entry => {
    const score = entry.keywords.filter(kw => q.includes(kw)).length;
    return { ...entry, score };
  }).filter(e => e.score > 0).sort((a, b) => b.score - a.score);
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
    const latestQuery = (messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '';
    const relevantDocs = selectDocuments(latestQuery);

    console.log(`[archivist] Query: "${latestQuery.slice(0,80)}" | Docs: ${relevantDocs.map(d=>d.label).join(', ') || 'none'}`);

    const docContent = [];
    const skippedDocs = [];

    for (const doc of relevantDocs) {
      try {
        const meta = await githubGet(encodeURIComponent(doc.path).replace(/%2F/g, '/'));
        if (!meta.download_url) continue;

        const rawBuffer = await fetchRawUrl(meta.download_url);
        docContent.push({
          type: 'text',
          text: `[Archive document: ${doc.label}]\n\n${rawBuffer.toString('utf8').slice(0, 80000)}`
        });
      } catch (e) {
        console.log(`[archivist] Failed to fetch ${doc.path}: ${e.message}`);
      }
    }

    const userContent = [];
    if (docContent.length > 0) {
      userContent.push(...docContent);
      let contextNote = `The above document(s) have been retrieved from the Archive as likely relevant.`;
      if (skippedDocs.length > 0) {
        contextNote += `\n\nNote: The following documents were identified as relevant but are too large to load directly (over 4MB): ${skippedDocs.join(', ')}. Answer from your general knowledge of these sources where you can, and note that the user may wish to consult those documents directly.`;
      }
      contextNote += `\n\nUser's question: ${latestQuery}`;
      userContent.push({ type: 'text', text: contextNote });
    } else if (skippedDocs.length > 0) {
      userContent.push({ type: 'text', text: `The most relevant documents (${skippedDocs.join(', ')}) are too large to load directly. Answer from your general knowledge of these sources where you can, noting which document the user should consult. User's question: ${latestQuery}` });
    } else {
      userContent.push({ type: 'text', text: latestQuery });
    }

    const priorMessages = (messages || []).slice(0, -1).map(m => ({ role: m.role, content: m.content }));
    const allMessages = [...priorMessages, { role: 'user', content: userContent }];

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
