const https = require('https');
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'Kai-C-Clarke/vintage-glider-knowledge-base';

// ── Bundled data (4/8/26 concurrency fix, revised 5/8/26) ──────────────────────
// The four search indexes used to be fetched from GitHub's API on every cold
// instance (see githubApiRaw below). Under concurrent traffic, Netlify spins up
// N cold instances that each hit GitHub's API simultaneously for the same
// files -- measured 3/10 timeouts and 15-29s responses at 10 concurrent cold
// requests (4/8/26 test). Fix: netlify/functions/data/*.json is populated by
// scripts/fetch-bundled-data.sh, run as this repo's Netlify BUILD command (see
// netlify.toml [build] command), which pulls the indexes fresh from the
// private glider-workshop / vintage-glider-knowledge-base repos at deploy
// time using the GITHUB_TOKEN env var already set on Netlify. netlify.toml's
// included_files then bundles whatever that script wrote into the function's
// own deployment package, so cold instances read local disk instead of
// hitting GitHub over the network.
// DELIBERATELY NOT git-committed: this repo (the-cast) is public, and this
// data derives from privately-held club material and, for the wk- index,
// content used under a restricted-use permission (Wally Kahn / BGA eBook
// Collection, granted by Pete Stratten -- private store, never rehost). An
// earlier version of this fix committed the data (and the 155 wk- book texts)
// straight into this public repo; caught and reverted before ever pushing
// (5/8/26). netlify/functions/data/ and wk-books/ are now .gitignored so that
// mistake can't happen again. Falls back to a live GitHub fetch if the build
// step hasn't run (e.g. local dev), so nothing hard-fails either way.
// TRADE-OFF: this data reflects whatever the source repos held at the START
// of the most recent Netlify build/deploy, not the live state. A source-repo
// change only takes effect on Alf after the next deploy (any push to
// the-cast, or a manual "Trigger deploy" in Netlify if only the data changed).
const DATA_DIR = path.join(__dirname, 'data');
function readBundled(filename) {
  try {
    return fs.readFileSync(path.join(DATA_DIR, filename), 'utf8');
  } catch (e) {
    return null;
  }
}

// ── Per-phase timing instrumentation (4/8/26) ──────────────────────────────────
// Answers "where does the 15-29s actually go" before optimizing further.
// Logged as one structured line per request so it's greppable in Netlify's
// function logs; also returned in the (non-production) response when
// DEBUG_TIMING=1 is set, for local/manual testing.
function makeTimer() {
  const marks = {};
  const start = Date.now();
  return {
    async time(label, fn) {
      const t0 = Date.now();
      try {
        return await fn();
      } finally {
        marks[label] = Date.now() - t0;
      }
    },
    mark(label, ms) { marks[label] = ms; },
    summary() {
      marks.total = Date.now() - start;
      return marks;
    }
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const ARCHIVIST_SYSTEM = `You are Alf Kirby, keeper of The Glider Workshop Archive — a collection of technical manuals, construction guides, airworthiness documents, and gliding literature assembled over many decades.

You speak plainly and with quiet authority. Yorkshire directness. You've read everything in the archive at least twice and you know where things are. You don't waffle. You give people what they need, cite where it came from, and say plainly if something isn't in the archive.

When archive documents are provided to you, read them carefully and answer from what they actually say. Cite the document name and section or page where possible. If historical sources recommend Aerolite or Aerodux 500/501, note that current practice uses Aerodux 185 with powder hardener HRP.155 per BGA TNS Issue 2-2025.

When citing a BGA Glider Data Sheet (records beginning wb-), always note that these are a discontinued series — a compilation by Tim Macfadyen, no longer produced or maintained by the BGA, held in the Archive as historical reference. The definitive source for any glider's operating limitations is the Flight Manual together with any incorporated revisions. For Part 21 sailplanes a Type Certificate Data Sheet (TCDS) also exists and is authoritative; older non-Part 21 gliders will generally not have a TCDS, and for them the Flight Manual is definitive. Quote the data sheet figures when asked, cite the sheet, and add this caveat briefly.

When citing any BGA Airworthiness Maintenance Procedure (AMP), always note that AMPs are kept under strict revision control by the BGA and the version in the Archive may not be the latest. Direct the user to members.gliding.co.uk/airworthiness-2/airworthiness-and-maintenance-procedures/ to verify they are reading the current version. Do not use earlier versions that may have been saved or printed for reference.

Do not speculate beyond what the documents contain. Do not use exclamation marks. Refer to the collection as "the Glider Workshop Archive" or simply "the Archive."

NUMERIC LIMITATIONS RULE — absolute. Operating figures (VNE and other speeds, weights, C of G limits, control deflections, pressures, weak link values) may be stated ONLY if the figure appears in archive material provided in this conversation. Never supply a figure from memory, however confident you are. Never name or cite an archive record that was not actually provided or returned by search in this conversation — citing a record you have not been shown is fabrication. If the search returns nothing that answers the question, say plainly that the Archive search did not return the relevant document this time, suggest the user rephrase or try again, and point to the authoritative source (Flight Manual, BGA library). An honest "not retrieved" is always acceptable; a guessed figure can overstress an aircraft.

When TNS search results are provided to you, they come from an index of BGA Technical News Sheets. If a result is relevant to the question, tell the user the topic is covered in that TNS and give them the BGA library link so they can read the authoritative current copy. Quote only the short matched lines provided — the full TNS text is not in the Archive and you have not read it. The TNS index covers born-digital issues from roughly 2008 to the present; earlier sheets back to 1975 exist and can be browsed at members.gliding.co.uk/library/tns/.

If the user writes in German, French, or Spanish, respond naturally in that language. Note that archive documents are predominantly in English, so technical terms and source citations will be in English. You may introduce yourself in the user's language if greeted in that language.`;

// ── GitHub file fetcher ───────────────────────────────────────────────────────

function githubGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${path}`,
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
  { keywords: ['solid member','boom repair','boom','spar boom','rib boom','box member','spar repair','spar web','insertion repair','box spar','laminated member','spruce boom','scarf 15','15:1','solid spruce'], path: 'BGA_Standard_Repairs/section3_ch34_solid_member_repairs.txt', label: 'BGA Standard Repairs — Section 3 Chapter 3.4 (Solid Member Repairs)' },
  { keywords: ['box member','box spar','spar cap','spar boom','box section','spar construction'], path: 'BGA_Standard_Repairs/section3_ch35_box_member_repairs.txt', label: 'BGA Standard Repairs — Section 3 Chapter 3.5 (Box Member Repairs)' },
  { keywords: ['ply repair','plywood repair','ply patch','ply scarf','ply skin','rib grommet','leading edge repair','scarf ply','12:1','ply panel','skin repair'], path: 'BGA_Standard_Repairs/section3_ch33_ply_repairs.txt', label: 'BGA Standard Repairs — Section 3 Chapter 3.3 (Ply Repairs)' },
  { keywords: ['aerodux','aerolite','glue','glueing','gluing','resorcinol','casein','urea formaldehyde','hardener','mixing glue','pot life','setting time'], path: 'BGA_Standard_Repairs/section3_ch32_glues_and_gluing.txt', label: 'BGA Standard Repairs — Section 3 Chapter 3.2 (Glues and Gluing)' },
  { keywords: ['timber','spruce','birch','gaboon','ply','plywood','v37','v35','compression shake','grain','moisture content','specification'], path: 'BGA_Standard_Repairs/section3_ch31_timbers_and_plywoods.txt', label: 'BGA Standard Repairs — Section 3 Chapter 3.1 (Timbers and Plywoods)' },
  { keywords: ['wood','timber','ply','plywood','spruce','spar','stringer','grain','moisture','scarf','joint','aerodux','resorcinol','casein','repair','section 3'], path: 'BGA_Standard_Repairs/section3_text.txt', label: 'BGA Standard Repairs — Section 3 (Wood Repairs)' },
  { keywords: ['wire lock','locking wire','safety wire','turnbuckle safety','double wrap','single wrap','wire locking','wire locking turnbuckle','safetying turnbuckle','wire twist','turnbuckle lock'], path: 'glider-workshop/reference/ingest/records/ac43-13-1b-chapter7-hardware-cables-turnbuckles.json', label: 'AC 43.13-1B Chapter 7 — Hardware, Control Cables, Turnbuckle Safety Methods' },
  { keywords: ['glass fibre','grp','fibreglass','resin','gel coat','glass cloth','chopped strand','mat','epoxy','polyester resin','glass repair','composite repair'], path: 'BGA_Standard_Repairs/section4_ch41_glassfibre_repairs.txt', label: 'BGA Standard Repairs — Section 4 Chapter 4.1 (Glass Fibre Repairs)' },
  { keywords: ['perspex','canopy','acrylic','transparency','scratch','polish','crazing','perspex repair'], path: 'BGA_Standard_Repairs/section4_ch42_perspex_repairs.txt', label: 'BGA Standard Repairs — Section 4 Chapter 4.2 (Perspex and Canopy Repairs)' },
  { keywords: ['metal fitting','rivet','bolt','hinge','pin','clevis','cable','swaged','control cable','thread','skid','armour plate','undercarriage'], path: 'BGA_Standard_Repairs/section4_ch43_metal_fittings_cables.txt', label: 'BGA Standard Repairs — Section 4 Chapter 4.3 (Metal Fittings and Cables)' },
  { keywords: ['fabric','dope','ceconite','polyester','covering','rib stitch','tautening','section 4','repair fabric','fabric repair','wing panel','damaged fabric','patch','cellulose dope','butyrate dope','recover'], path: 'BGA_Standard_Repairs/section4_text.txt', label: 'BGA Standard Repairs — Section 4 (Fabric)' },
  { keywords: ['metal','steel','aluminium','aluminum','rivet','section 2'], path: 'BGA_Standard_Repairs/section2_text.txt', label: 'BGA Standard Repairs — Section 2 (Metal)' },
  { keywords: ['standard repairs','foreword','general','introduction','bga repairs'], path: 'BGA_Standard_Repairs/foreword_text.txt', label: 'BGA Standard Repairs — Foreword' },
  { keywords: ['standard repairs','section 1'], path: 'BGA_Standard_Repairs/section1_text.txt', label: 'BGA Standard Repairs — Section 1' },
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
  { keywords: ['overlap','patch overlap','3 inch','2 inch','unsupported','supported','repair patch','inter-rib','fabric repair','hole repair','ceconite repair','appendix e','new super seam','pinking shears'], path: 'fabric_covering/fabric_repair_patch_overlap_note_2026.txt', label: 'Fabric Repair Patch Overlap — Ceconite + BGA Practice (2026)' },

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
  { keywords: ['swallow t45','t.45','t45 pilots','swallow pilots','swallow stall','swallow performance','swallow limits','swallow weight','swallow aerotow','swallow winch','swallow spin','swallow acrobatic'], path: 'glider-workshop/reference/type-docs/swallow-t45/ingest/records/swallow-t45-pilots-notes-technical-data.json', label: 'Slingsby T.45 Swallow — Pilots Notes & Technical Data' },
  { keywords: ['slingsby','prefect','tutor','swallow','skylark','capstan','kite','petrel','dart','t21','t38','t49','t51'], path: 'general_airworthiness/BGA-Compendium-Slingsby_text.txt', label: 'BGA Compendium — Slingsby' },
  { keywords: ['elliots','olympia','eon','olympia 2b','olympia 460','eon olympia'], path: 'general_airworthiness/BGA-Compendium-Elliots_text.txt', label: 'BGA Compendium — Elliots (Olympia)' },

  // BGA CA Exposition and Course
  { keywords: ['exposition','bga cae','part h','non-part 21','arc','airworthiness certificate','bga 267','gmp','sdmp','permit','calibration','test equipment','torque','torque wrench','manometer','pitot static','weighing scales','ukas','tool calibration','instrument calibration','altimeter calibration','asi calibration','airspeed calibration','measuring equipment'], path: 'general_airworthiness/BGA-CA-Exposition_text.txt', label: 'BGA CAE Exposition March 2021' },
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
  { keywords: ['anc18','anc-18','design wood','aircraft structure design','allowable stress','wood species','strength','modulus'], path: 'wood_construction/anc18_chapters/part_01.txt', label: 'ANC-18 — Design of Wood Aircraft Structures (Part 1)' },
  { keywords: ['anc19','anc-19','wood inspection','fabrication','defects','checks','grain','knots','slope of grain'], path: 'wood_construction/anc19_chapters/part_01.txt', label: 'ANC-19 — Wood Aircraft Inspection and Fabrication (Part 1)' },
  { keywords: ['grounding','bonding','static','lightning','electrical bonding','static discharge','earthing','bonding strap','bonding jumper','metallic bonding','faraday','precipitation static','p-static','shielding','emi'], path: 'general_airworthiness/ac43_ch11_section15_grounding_bonding.txt', label: 'AC43.13-1B Chapter 11 — Electrical Systems, Grounding and Bonding' },
  { keywords: ['bonding','grounding','wooden glider','vintage bonding','static wood','wood conductor','p-static radio','radio installation','transponder installation','retrofit radio','wood moisture','static discharge wood'], path: 'general_airworthiness/electrical_bonding_vintage_wooden_gliders_note_2026.txt', label: 'Electrical Bonding in Vintage Wooden Gliders — Why It Is Absent (2026)' },
  { keywords: ['piggott','derek piggott','cumulonimbus','thunderstorm','lightning strike','skylark','lasham','altitude record','electric shock','control column shock','cloud flying','cb','hypoxia','ice controls'], path: 'gliding_history_and_literature/derek_piggott_cumulonimbus_1955_case_study.txt', label: 'Derek Piggott — Cumulonimbus Encounter 1955 (Lightning Case Study)' },
  { keywords: ['ac43','fabric','covering','dope','polyester','ceconite','rib stitch'], path: 'wood_construction/ac43_chapters/02_chapter_2_fabric_covering.txt', label: 'AC43.13-1B — Fabric Covering' },

  // History and literature
  { keywords: ['kronfeld','soaring','thermal','history','wave','ridge','gliding'], path: 'gliding_history_and_literature/kronfeld_chapters/part_01.txt', label: 'Kronfeld — On Gliding and Soaring (Part 1)' },
  // Wally Kahn (A Glider Pilot Bold), Ann Welch (Silent Flight), and Martin Simons (Slingsby Sailplanes)
  // full-fetch entries removed 1 Aug 2026: all three are under active copyright (Kahn d.2015, Welch d.2002,
  // Simons d.2024) unlike Kronfeld (d.1948, genuinely PD). Source files remain in the private repo for future
  // snippet-only retrieval once a proper bounded-quote tier is built.

  // AMP Manual
  { keywords: ['arc','arc renewal','part 21','certificate of airworthiness renewal','annual'], path: 'general_airworthiness/AMP/amp_1-1_arc_renewal_part_21.txt', label: 'AMP 1-1 — ARC Renewal (Part 21)' },
  { keywords: ['inspector','authorisation','ratings','inspector rating','bga inspector','qualification'], path: 'general_airworthiness/AMP/amp_1-2_inspector_authorisation_and_ratings.txt', label: 'AMP 1-2 — Inspector Authorisation and Ratings' },
  { keywords: ['logbook','aircraft logbook','log book','records','documentation'], path: 'general_airworthiness/AMP/amp_1-3_aircraft_logbooks.txt', label: 'AMP 1-3 — Aircraft Logbooks' },
  { keywords: ['duplicate inspection','independent inspection','critical task','duplicate','second signature'], path: 'general_airworthiness/AMP/amp_1-4_independent_duplicate_inspections.txt', label: 'AMP 1-4 — Independent / Duplicate Inspections' },
  { keywords: ['harness','seat belt','belt','lap strap','shoulder harness'], path: 'general_airworthiness/AMP/amp_1-5_seat_harnesses_and_belts.txt', label: 'AMP 1-5 — Seat Harnesses and Belts' },
  { keywords: ['transponder','squawk','mode c','mode s','ssr','ads-b'], path: 'general_airworthiness/AMP/amp_1-7_transponder_maintenance.txt', label: 'AMP 1-7 — Transponder Maintenance' },
  { keywords: ['trailer','trailer maintenance','road trailer','transport'], path: 'general_airworthiness/AMP/amp_1-8_trailer_maintenance.txt', label: 'AMP 1-8 — Trailer Maintenance' },
  { keywords: ['weighing','weight','balance','centre of gravity','cg','mass balance'], path: 'general_airworthiness/AMP/amp_1-9_glider_weighing.txt', label: 'AMP 1-9 — Glider Weighing' },
  { keywords: ['battery','battery maintenance','lead acid','lithium','12v','electrolyte'], path: 'general_airworthiness/AMP/amp_1-11_battery_maintenance.txt', label: 'AMP 1-11 — Battery Maintenance' },
  { keywords: ['complex maintenance','complex repair','major repair'], path: 'general_airworthiness/AMP/amp_1-12_complex_maintenance.txt', label: 'AMP 1-12 — Complex Maintenance' },
  { keywords: ['part66l','part 66','training approval','bga cao','licence','category b','category a'], path: 'general_airworthiness/AMP/amp_1-2a_part66l_training_approval.txt', label: 'AMP 1-2a — BGA CAO Part66L Training Approval' },
  { keywords: ['disciplinary','inspector discipline','misconduct','complaint','inspector conduct'], path: 'general_airworthiness/AMP/amp_1-6_inspector_disciplinary_procedure.txt', label: 'AMP 1-6 — Inspector Disciplinary Procedure' },
  { keywords: ['import','export','importing','exporting','foreign registration','uk registration','transfer'], path: 'general_airworthiness/AMP/amp_1-10_importing_exporting_aircraft.txt', label: 'AMP 1-10 — Importing and Exporting Aircraft' },
  { keywords: ['registration','sailplane registration','g-','permit','new registration','change of ownership'], path: 'general_airworthiness/AMP/amp_1-13_registration_procedure_sailplanes.txt', label: 'AMP 1-13 — Registration Procedure for Sailplanes' },
  { keywords: ['dope','fabric work','dope and fabric','nitrate','butyrate','fabric repair standard','section 2'], path: 'general_airworthiness/AMP/standard_repairs_2_dope_and_fabric.txt', label: 'BGA Standard Repairs — Section 2 (Dope and Fabric Work)' },
  { keywords: ['miscellaneous','section 4','metal fitting','rigging','control surface','hinge','pin','clevis'], path: 'general_airworthiness/AMP/standard_repairs_4_miscellaneous_repairs.txt', label: 'BGA Standard Repairs — Section 4 (Miscellaneous Repairs)' },
  { keywords: ['sdmp','self declared','maintenance programme','self declared maintenance'], path: 'general_airworthiness/AMP/amp_1-14_self_declared_maintenance_programme.txt', label: 'AMP 1-14 — Self Declared Maintenance Programme' },
  { keywords: ['materials','parts','acceptable materials','approved parts','hardware','components'], path: 'general_airworthiness/AMP/amp_1-15_acceptable_materials_and_parts.txt', label: 'AMP 1-15 — Acceptable Materials and Parts' },
  { keywords: ['a conditions','permit flight','a condition','flight condition','permit to fly'], path: 'general_airworthiness/AMP/amp_2-1_a_conditions_flight.txt', label: 'AMP 2-1 — A Conditions Flight' },
  { keywords: ['c of a','coa','bga certificate','certificate of airworthiness','non part 21','renewal'], path: 'general_airworthiness/AMP/amp_2-2_bga_c_of_a_renewal.txt', label: 'AMP 2-2 — BGA C of A Renewal' },
  { keywords: ['modification','mod','non part 21','modify glider','alteration'], path: 'general_airworthiness/AMP/amp_2-3_modification_of_non-part_21_gliders.txt', label: 'AMP 2-3 — Modification of Non-Part 21 Gliders' },
  { keywords: ['narc','national arc','national airworthiness review','narc renewal'], path: 'general_airworthiness/AMP/amp_2-4_narc_renewal.txt', label: 'AMP 2-4 — NARC Renewal' },
  { keywords: ['certifying','bga glider','certify','non part 21','new glider'], path: 'general_airworthiness/AMP/amp_2-5_certifying_a_bga_glider.txt', label: 'AMP 2-5 — Certifying a BGA Glider' },

  { keywords: ['control cable','flying control','cable tension','turnbuckle','wire lock','locking wire','nicopress','cable inspection','swaged','fraying','cable wear','cable fatigue','cable repair'], path: 'glider-workshop/reference/AMP/ingest/records/1430312110-4-7.json', label: 'AMP 4-7 — Flying Control Cables (BGA)' },
  { keywords: ['arc renewal','airworthiness review','part 21','arc','airworthiness review certificate'], path: 'glider-workshop/reference/AMP/ingest/records/amp-bga-c-of-a-renewal-v2-5-jan-24.json', label: 'AMP 2-2 — BGA C of A Renewal' },
  { keywords: ['narc','national airworthiness review','narc renewal'], path: 'glider-workshop/reference/AMP/ingest/records/amp-narc-renewal-v2-5-jan-24.json', label: 'AMP 2-4 — NARC Renewal' },
  { keywords: ['seat harness','harness','belt','seat belt','restraint','lap strap'], path: 'glider-workshop/reference/AMP/ingest/records/amp-seat-harnesses-and-belts-v2-5-jan-24.json', label: 'AMP 1-5 — Seat Harnesses and Belts' },
  { keywords: ['acceptable material','approved material','release note','material specification','parts','approved parts'], path: 'glider-workshop/reference/AMP/ingest/records/amp-1-15-acceptable-materials-and-parts.json', label: 'AMP 1-15 — Acceptable Materials and Parts' },
  { keywords: ['inspector authorisation','inspector rating','inspector approval','bga inspector','i/c','inspector qualification'], path: 'glider-workshop/reference/AMP/ingest/records/amp-inspector-authorisation-and-rating-dec-23.json', label: 'AMP 1-2 — Inspector Authorisation and Ratings' },
  { keywords: ['modification','non part 21','glider modification','mod','approved modification'], path: 'glider-workshop/reference/AMP/ingest/records/amp-modification-to-non-part-21-gliders-v2-5-jan-24.json', label: 'AMP 2-3 — Modification of Non-Part 21 Gliders' },
  { keywords: ['a conditions','a condition flight','permit','non part 21 flight','experimental'], path: 'glider-workshop/reference/AMP/ingest/records/amp-a-conditions-flight-v2-5-jan-24.json', label: 'AMP 2-1 — A Conditions Flight' },
  { keywords: ['complex maintenance','complex task','critical maintenance','complex repair'], path: 'glider-workshop/reference/AMP/ingest/records/amp-complex-maintenance-5-jan-2024.json', label: 'AMP 1-12 — Complex Maintenance' },
  { keywords: ['registration','sailplane registration','aircraft registration','register glider'], path: 'glider-workshop/reference/AMP/ingest/records/amp-registration-procedure-for-sailplanes-v2-5-jan-24.json', label: 'AMP 1-13 — Registration Procedure for Sailplanes' },
  { keywords: ['cs-stan','standard change','standard repair','cs stan'], path: 'glider-workshop/reference/AMP/ingest/records/inital-airworthiness-adopted-cs-stan-issue-4.json', label: 'CS-STAN Issue 4 — Standard Changes and Repairs' },
  { keywords: ['certifying','certify bga','bga certification','non part 21 certify'], path: 'glider-workshop/reference/AMP/ingest/records/amp-2-5-bga-certification-process-non-part-21-gliders.json', label: 'AMP 2-5 — BGA Certification Process (Non-Part 21)' },
  { keywords: ['motor glider','engine','rotax','power plant','motorglider','engine inspection'], path: 'general_airworthiness/AMP/motor_glider_engine_inspection.txt', label: 'AMP — Motor Glider Engine Inspection and Repair' },
  { keywords: ['instrument','altimeter','variometer','airspeed','calibration','instrument repair','asi','pitot'], path: 'general_airworthiness/AMP/standard_repairs_5_instrument_repairs.txt', label: 'BGA Standard Repairs — Section 5 (Instrument Repairs)' },
  { keywords: ['weighing','weight schedule','mass balance','ballast','weighing record'], path: 'general_airworthiness/AMP/standard_repairs_6_weighing.txt', label: 'BGA Standard Repairs — Section 6 (Weighing)' },
];

function selectDocuments(query) {
  const q = query.toLowerCase();
  const scored = FILE_INDEX.map(entry => {
    const score = entry.keywords.filter(kw => q.includes(kw)).length;
    return { ...entry, score };
  }).filter(e => e.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, 2);
}

// ── TNS finder (index lives in the PRIVATE repo; Alf surfaces links + matched lines only) ──

const TNS_INDEX_PATH = 'alf/tns_fulltext.json';
let tnsIndexCache = null; // survives warm invocations

const REFERENCE_INDEX_PATH = 'alf/reference_fulltext.json';
let referenceIndexCache = null; // survives warm invocations

// Scanned TNS decade indexes (tesseract OCR, pre-2020)
const TNS_DECADE_PATHS = {
  '1970s': 'alf/tns_1970s.json',
  '1980s': 'alf/tns_1980s.json',
  '1990s': 'alf/tns_1990s.json',
  '2000s': 'alf/tns_2000s.json',
  '2010s': 'alf/tns_2010s.json',
};
const tnsDecadeCache = {};

// Short aviation terms that must survive the 4+ char keyword filter (fix 26/7/26:
// "VNE of the Bocian" searched on "bocian" alone, so table lines were never quoted)
const AVIATION_SHORT_TERMS = new Set(['vne','auw','cg','kts','kph','mph','psi','bar','dan','ply','tow','aft','rig','arc','tps']);

// Type designators are written every way: SHK-1 / SHK 1 / SHK1, Ka-6 / Ka6 / Ka 6.
// A hyphenated query word matches text containing any spelling variant.
// (Fix 27/7/26: "VNE of a SHK-1?" — record text says "SHK 1", so "shk-1" matched
// nothing, the 2-hit gate returned zero results, and the model fabricated a citation.)
function wordVariants(w) {
  if (!w.includes('-')) return [w];
  return [w, w.replace(/-/g, ''), w.replace(/-/g, ' ')];
}
function textMatches(text, w) {
  return wordVariants(w).some(v => text.includes(v));
}

const TNS_STOPWORDS = new Set(['what','when','where','which','with','this','that','have','from','they',
  'should','could','would','about','there','their','been','does','glider','gliders','vintage','archive',
  'please','need','know','tell','used','using','into','over','some','also','than','then','them','will',
  'aircraft','sailplane','wooden','wood','repair','repairs','inspection','inspect','check','question']);

// --- Wally Kahn / BGA eBook Collection (wk-) ---
// Permission granted by Pete Stratten (BGA CEO), 1/8/26. Deliberately NOT a
// full-document-fetch source (see FILE_INDEX pattern used elsewhere): snippet-
// only retrieval, mandatory paraphrase, one short attributed quote max, and a
// hard checksum gate on any quote before it reaches the user. See
// gliding_history_and_literature/wally_kahn_collection/README.md and
// PAGE_MAPPING_STATUS.md in vintage-glider-knowledge-base for full provenance
// and the printed-page-number caveat (cite pdf_page ONLY -- printed_page data
// in that repo is flagged unverified, do not use).
const WK_REPO = 'Kai-C-Clarke/vintage-glider-knowledge-base';
const WK_INDEX_PATH = 'gliding_history_and_literature/wally_kahn_collection/search_index/index.json';
const WK_COLLECTION_DIR = 'gliding_history_and_literature/wally_kahn_collection';
const WK_LANDING_PAGE = 'https://www.lakesgc.co.uk/mainwebpages/Wally%20Kahn%20Book%20Collection.htm';

let wkIndexCache = null; // survives warm invocations
const wkBookCache = {};  // survives warm invocations, per-book full text

// --- Rate limiting (Fable, 3/8/26 pre-launch review) ---
// In-memory, per warm Netlify instance -- not perfectly accurate across
// multiple concurrent cold instances under a real traffic spike, but a
// genuine deterrent against casual scraping/abuse, which is what this is
// actually protecting against (there's no login, no cost-per-query billing
// risk beyond Anthropic API spend, and the underlying content is already
// publicly summarised elsewhere -- this isn't a security boundary, it's a
// courtesy limit). A proper distributed limiter is a fair upgrade later if
// traffic ever suggests this isn't enough.
const rateLimitBuckets = new Map(); // ip -> array of request timestamps (ms)
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX = 20; // requests per window per IP

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip) || [];
  const recent = bucket.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimitBuckets.set(ip, recent);
  // Occasional cleanup so the map doesn't grow unbounded across a long-lived warm instance
  if (rateLimitBuckets.size > 500) {
    for (const [key, times] of rateLimitBuckets) {
      if (times.every(t => now - t > RATE_LIMIT_WINDOW_MS)) rateLimitBuckets.delete(key);
    }
  }
  return recent.length <= RATE_LIMIT_MAX;
}

const WK_STOPWORDS = new Set(['the','a','an','and','or','but','if','then','else','when','at','by','for',
  'with','about','against','between','into','through','during','before','after','above','below','to',
  'from','up','down','in','out','on','off','over','under','again','further','once','here','there','all',
  'any','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so',
  'than','too','very','can','will','just','now','this','that','these','those','is','are','was','were',
  'be','been','being','have','has','had','do','does','did']);

function wkTokenize(query) {
  const raw = (query.toLowerCase().match(/[a-z]{3,}/g) || []);
  return [...new Set(raw.filter(w => !WK_STOPWORDS.has(w)))];
}

async function loadWkIndex() {
  if (wkIndexCache) return wkIndexCache;
  const bundled = readBundled('wk_index.json');
  if (bundled) { wkIndexCache = JSON.parse(bundled); return wkIndexCache; }
  const res = await githubApiRaw(WK_REPO, WK_INDEX_PATH);
  if (res.status !== 200 || !res.body) throw new Error('wk- index fetch failed: ' + res.status);
  wkIndexCache = JSON.parse(res.body);
  return wkIndexCache;
}

// Book texts are fetched from the private vintage-glider-knowledge-base repo,
// same as before (26/7/26 design) -- NOT bundled and NOT statically hosted.
// The wk- collection is used under a restricted-use permission from Pete
// Stratten (private store, never rehost, snippet-only to the model) -- an
// early version of this fix moved the 155 book-text files to static hosting
// on this repo's own site, which would have published full extracted text of
// copyrighted books via a public GitHub repo. Reverted 5/8/26 before deploy;
// see commit history. Only 3-4 of 155 books are touched per query and they
// were never the dominant contention source in the concurrency bug (the four
// INDEX loads were), so this stays as a per-request GitHub fetch.
async function loadWkBook(slug) {
  if (wkBookCache[slug]) return wkBookCache[slug];
  const res = await githubApiRaw(WK_REPO, `${WK_COLLECTION_DIR}/extracted_text/${slug}.json`);
  if (res.status !== 200 || !res.body) throw new Error(`wk- book fetch failed for ${slug}: ${res.status}`);
  const data = JSON.parse(res.body);
  wkBookCache[slug] = data;
  return data;
}

// Two-stage retrieval (Fable, 1-3/8/26 design): the index is small enough to load
// whole and cache; a query scores candidate (book, page) pairs by term overlap,
// then only the top few candidates' actual page text gets fetched, with a +/-1
// page window for context. Full books are never loaded wholesale for a query.
async function searchWkCollection(query, maxCandidates = 4) {
  const index = await loadWkIndex();
  const words = wkTokenize(query);
  if (words.length === 0) return [];

  const pageScores = new Map();
  for (const word of words) {
    const postings = index.terms[word];
    if (!postings) continue;
    for (const encoded of postings) {
      const bookID = Math.floor(encoded / 10000);
      const pdfPage = encoded % 10000;
      const key = `${bookID}:${pdfPage}`;
      const existing = pageScores.get(key);
      if (existing) existing.score += 1;
      else pageScores.set(key, { score: 1, bookID, pdfPage });
    }
  }
  if (pageScores.size === 0) return [];

  const minWords = Math.min(2, words.length);
  const candidates = [...pageScores.values()]
    .filter(c => c.score >= minWords)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);

  const results = [];
  for (const c of candidates) {
    const slug = index.book_ids[String(c.bookID)];
    if (!slug) continue;
    try {
      const book = await loadWkBook(slug);
      const windowPages = book.pages.filter(p => Math.abs(p.pdf_page - c.pdfPage) <= 1);
      const windowText = windowPages.map(p => p.text).join('\n\n').slice(0, 3000);
      results.push({ slug, pdf_page: c.pdfPage, source_url: book.source_url, score: c.score, window_text: windowText });
    } catch (e) {
      console.log(`[wk-search] skip ${slug}: ${e.message}`);
    }
  }
  return results;
}

// --- Checksum gate: hard, not telemetry (Fable, 2/8/26) ---
// A quote is only as trustworthy as the mapping used to cite it. printed_page
// mapping is known unreliable right now (see PAGE_MAPPING_STATUS.md), so this
// verifies the quote's TEXT against the actual fetched window -- independent
// of whatever page number gets shown -- catching hallucinated/mangled quotes
// regardless of the page-numbering issue.
function wkNormalize(s) {
  return s.toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/-\s*\n\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tightened per Fable's pre-launch review (3/8/26): verify the quote against the
// SPECIFIC page it's cited to, not against any fetched candidate in the batch.
// Without this, a quote could genuinely appear on scan page 46's window while
// being attributed in the reply to scan page 12 -- same class of problem as
// quote fabrication, one level up (correct text, wrong claim about where it's
// from). A quote with no nearby page citation, or one citing a page we didn't
// actually fetch, fails closed -- it does not get the benefit of the doubt.
function wkVerifyQuoteAgainstPage(quote, citedPage, wkResults) {
  const normQuote = wkNormalize(quote);
  if (normQuote.length < 5) return true;
  if (citedPage == null) return false; // no citation found nearby -- fail closed
  const match = wkResults.find(r => r.pdf_page === citedPage);
  if (!match) return false; // cited a page we never fetched -- fail closed
  return wkNormalize(match.window_text).includes(normQuote);
}

function wkFindNearbyPageCitation(reply, matchIndex, matchLength) {
  // Look in a window around the quote (citations can precede or follow it in
  // natural phrasing) for "scan page N"
  const windowStart = Math.max(0, matchIndex - 120);
  const windowEnd = Math.min(reply.length, matchIndex + matchLength + 120);
  const surrounding = reply.slice(windowStart, windowEnd);
  const pageMatch = surrounding.match(/scan page\s+(\d+)/i);
  return pageMatch ? parseInt(pageMatch[1], 10) : null;
}

// Remove the whole sentence containing a rejected quote, not just the quoted
// words -- a bare word-swap leaves a grammatically broken fragment around the
// removal notice (Fable, 3/8/26: "leaves a broken sentence"). Expanding to
// sentence boundaries means the surrounding text still reads cleanly even
// with the claim removed.
function wkStripSentenceContaining(text, matchStart, matchEnd) {
  let start = matchStart;
  while (start > 0 && !'.!?\n'.includes(text[start - 1])) start--;
  let end = matchEnd;
  while (end < text.length && !'.!?\n'.includes(text[end])) end++;
  if (end < text.length) end++; // include the terminating punctuation
  return { start, end };
}

function wkApplyChecksumGate(reply, wkResults) {
  if (!wkResults || wkResults.length === 0) return { reply, flagged: [] };
  const quoteRe = /["\u201c]([^"\u201d]{15,300})["\u201d]/g;
  const flagged = [];
  let match;
  const spans = [];
  while ((match = quoteRe.exec(reply)) !== null) {
    const citedPage = wkFindNearbyPageCitation(reply, match.index, match[0].length);
    if (!wkVerifyQuoteAgainstPage(match[1], citedPage, wkResults)) {
      const span = wkStripSentenceContaining(reply, match.index, match.index + match[0].length);
      spans.push(span);
      flagged.push({ quote: match[1].slice(0, 100), citedPage });
    }
  }
  if (spans.length === 0) return { reply, flagged: [] };

  // Remove flagged spans back-to-front so earlier indices stay valid
  spans.sort((a, b) => b.start - a.start);
  let result = reply;
  for (const { start, end } of spans) {
    console.log(`[wk-checksum] REJECTED sentence with unverified quote (cited page: ${reply.slice(start,end).match(/scan page\s+\d+/i)?.[0] || 'none'})`);
    result = result.slice(0, start) + result.slice(end);
  }
  result = result.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (result.length < 20) {
    // Stripping the flagged sentence(s) left nothing substantive -- an empty
    // reply is a worse failure than an honest explanation.
    result = "I found something that looked relevant in the Wally Kahn / BGA eBook Collection, but I couldn't verify the specific claim against the source text, so I don't want to state it with confidence. You may want to check the collection directly for this one — see the sources panel.";
  }
  return { reply: result, flagged };
}

async function loadTnsIndex() {
  if (tnsIndexCache) return tnsIndexCache;
  const bundled = readBundled('tns_fulltext.json');
  if (bundled) { tnsIndexCache = JSON.parse(bundled); return tnsIndexCache; }
  // Raw fetch: immune to the >1MB content:'' trap (same fix as loadReferenceIndex 26/7/26)
  const res = await githubApiRaw(LOG_REPO, TNS_INDEX_PATH);
  if (res.status !== 200 || !res.body) throw new Error('TNS index fetch failed: ' + res.status);
  tnsIndexCache = JSON.parse(res.body);
  return tnsIndexCache;
}

async function searchTNS(query) {
  const index = await loadTnsIndex();
  const raw = query.toLowerCase().match(/[a-z0-9][a-z0-9.\-]{1,}/g) || [];
  // keep words of 4+ chars, plus short type designators containing a digit (k8, ka6, t21, ls4)
  const words = [...new Set(raw.filter(w => (w.length >= 4 || (w.length >= 2 && /\d/.test(w)) || AVIATION_SHORT_TERMS.has(w)) && !TNS_STOPWORDS.has(w)))];
  if (words.length === 0) return [];

  const results = [];
  for (const entry of index.entries) {
    const text = entry.text.toLowerCase();
    const hits = words.filter(w => textMatches(text, w));
    if (hits.length === 0) continue;
    // require 2+ distinct keyword hits unless the query only offered one keyword
    if (hits.length < Math.min(2, words.length)) continue;
    // IDF-weighted (4/8/26) — same tie-flood fix as searchReference
    const score = hits.reduce((sum, w) => sum + idfWeight(index, w), 0);
    // snippets: lines containing the most keywords
    const lines = entry.text.split('\n');
    const snips = lines
      .map(l => ({ l, n: hits.filter(w => textMatches(l.toLowerCase(), w)).length }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 2)
      .map(x => x.l.slice(0, 160));
    results.push({ label: entry.label, url: entry.url, score, snips });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ── IDF term-weighting (4/8/26, Fable's flagged quality risk) ─────────────────
// Plain hit-count scoring ties common words (e.g. "glider", "landing",
// "accidents") with rare, distinguishing words at the same score, so a query
// like "glider landing accidents" tie-floods at score 2-3 and top-4 selection
// becomes near-arbitrary among everything that happens to contain those common
// words. Standard fix: weight each matched word by inverse document frequency
// (rare words that appear in few entries count for more than words that appear
// in nearly all of them). Document frequency is computed lazily per word and
// memoized on the index object (index._dfCache) so repeat queries on a warm
// instance don't re-scan every entry.
function idfWeight(index, word) {
  if (!index._dfCache) index._dfCache = new Map();
  let df = index._dfCache.get(word);
  if (df === undefined) {
    df = 0;
    for (const entry of index.entries) {
      const t = (entry._textLower || (entry._textLower = entry.text.toLowerCase()));
      if (textMatches(t, word)) df++;
    }
    index._dfCache.set(word, df);
  }
  const n = index.entries.length;
  // +1 smoothing so a word appearing in every entry still contributes a small
  // positive weight rather than zero; floor at 0.15 so an unusually common word
  // never fully zeroes out a genuine match, just outweighed by rarer ones.
  return Math.max(0.15, Math.log((n + 1) / (df + 1)) + 1);
}

// ── Reference document search (BGA Standard Repairs, Compendium, Inspector Course, Datasheets, AC43, OM100) ──

async function loadReferenceIndex() {
  if (referenceIndexCache) return referenceIndexCache;
  const bundled = readBundled('reference_fulltext.json');
  if (bundled) { referenceIndexCache = JSON.parse(bundled); return referenceIndexCache; }
  const res = await githubApiRaw(LOG_REPO, REFERENCE_INDEX_PATH);
  if (res.status !== 200 || !res.body) throw new Error('Reference index fetch failed: ' + res.status);
  referenceIndexCache = JSON.parse(res.body);
  return referenceIndexCache;
}

async function searchReference(query) {
  const index = await loadReferenceIndex();
  const raw = query.toLowerCase().match(/[a-z0-9][a-z0-9.\-]{1,}/g) || [];
  const words = [...new Set(raw.filter(w => (w.length >= 4 || (w.length >= 2 && /\d/.test(w)) || AVIATION_SHORT_TERMS.has(w)) && !TNS_STOPWORDS.has(w)))];
  if (words.length === 0) return [];

  const results = [];
  for (const entry of index.entries) {
    // TNS records have dedicated search paths (searchTNS + searchScannedTNS) which
    // run on every query. Serving them from reference search too meant any query
    // mentioning "TNS" flooded the top-4 with TNS entries, burying datasheets and
    // manuals (26/7/26: wb-bocian lost to a dozen TNS records). One class, one route.
    if ((entry.label || '').startsWith('BGA Technical News Sheets') || (entry.source || '').includes('BGA-TNS')) continue;
    const text = entry.text.toLowerCase();
    const labelLower = (entry.label || '').toLowerCase();
    const hits = words.filter(w => textMatches(text, w));
    const labelHits = words.filter(w => textMatches(labelLower, w)).length;
    // Gate on distinct words matched anywhere (text OR label): a type designator
    // often lives only in the label while the body says "SHK 1" in a table
    const matchedWords = words.filter(w => textMatches(text, w) || textMatches(labelLower, w));
    if (matchedWords.length === 0) continue;
    if (matchedWords.length < Math.min(2, words.length)) continue;
    // Aircraft-type match is worth more than a generic word hit: a query naming a
    // type must rank that type's records above documents that merely share common
    // words ("covering", "repair"). Fix 26/7/26: "VNE of the Bocian, any TNS
    // covering it?" buried wb-bocian under fabric documents matched on "covering".
    const types = (entry.aircraft_types || []).map(t => String(t).toLowerCase());
    const typeHits = words.filter(w => types.some(t => textMatches(t, w))).length;
    // IDF-weighted text hits: a rare, distinguishing word counts for more than a
    // common one, breaking the tie-floods plain hit-counting produced on
    // generic-word queries. Type/label hits keep their existing 3x bonus
    // structure unchanged — they're already a strong, deliberate signal.
    const weightedHits = hits.reduce((sum, w) => sum + idfWeight(index, w), 0);
    const score = weightedHits + (typeHits + labelHits) * 3;
    const lines = entry.text.split('\n');
    const snips = lines
      .map(l => ({ l, n: hits.filter(w => textMatches(l.toLowerCase(), w)).length, d: /\d/.test(l) ? 1 : 0 }))
      .filter(x => x.n > 0)
      .sort((a, b) => (b.n - a.n) || (b.d - a.d))
      .slice(0, 3)
      .map(x => x.l.trim().slice(0, 200));
    results.push({ 
      label: entry.label, 
      source: entry.source, 
      tier: entry.tier, 
      score, 
      snips,
      annotations: entry.annotations || [],
      subject_tags: entry.subject_tags || [],
      aircraft_types: entry.aircraft_types || []
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 4);
}

async function searchScannedTNS(query) {
  // Search all decade indexes in parallel, merge and rank results
  const raw = query.toLowerCase().match(/[a-z0-9][a-z0-9.\-]{1,}/g) || [];
  const words = [...new Set(raw.filter(w => (w.length >= 4 || (w.length >= 2 && /\d/.test(w)) || AVIATION_SHORT_TERMS.has(w)) && !TNS_STOPWORDS.has(w)))];
  if (words.length === 0) return [];

  const allResults = [];

  await Promise.all(Object.entries(TNS_DECADE_PATHS).map(async ([decade, decadePath]) => {
    try {
      if (!tnsDecadeCache[decade]) {
        const bundled = readBundled(`tns_${decade}.json`);
        if (bundled) {
          tnsDecadeCache[decade] = JSON.parse(bundled);
        } else {
          // Raw fetch: 1980s (3.2MB), 1990s (3.9MB), 2000s (1.9MB) exceed the 1MB
          // content:'' JSON-API limit — the old path silently returned nothing for
          // those three decades (confirmed dead 26/7/26, same trap as reference index)
          const res = await githubApiRaw(LOG_REPO, decadePath);
          if (res.status !== 200 || !res.body) return;
          tnsDecadeCache[decade] = JSON.parse(res.body);
        }
      }
      const index = tnsDecadeCache[decade];
      for (const entry of index.entries) {
        const text = entry.text.toLowerCase();
        const hits = words.filter(w => textMatches(text, w));
        if (hits.length < Math.min(2, words.length)) continue;
        const lines = entry.text.split('\n');
        const snips = lines
          .map(l => ({ l, n: hits.filter(w => textMatches(l.toLowerCase(), w)).length }))
          .filter(x => x.n > 0)
          .sort((a, b) => b.n - a.n)
          .slice(0, 2)
          .map(x => x.l.trim().slice(0, 200));
        allResults.push({ label: entry.label, source: entry.source, decade, score: hits.length, snips });
      }
    } catch (e) {
      console.log(`[archivist] Scanned TNS ${decade} search skipped: ${e.message}`);
    }
  }));

  return allResults.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ── Conversation log (private repo, human review before anything enters the Archive) ──

const LOG_REPO = 'Kai-C-Clarke/glider-workshop';

// ── Authoritative source links (sources panel, 28/7/26) ──────────────────────
// JRS ruling: BGA documents are publicly released — linking is a service, and the
// BGA copy is the CURRENT revision. BGA URLs confirmed via search/production use;
// FAA/Ceconite/West System verified 200 on 28/7/26. NEVER re-host PDFs here; the
// remaining third-party works (Simons, Hoy course, book scans) stay archive-only.
const SOURCE_LINK_RULES = [
  { test: (l, p) => /^AMP[ -]|Airworthiness .*Maintenance Procedure/i.test(l) || p.includes('/AMP/') || l.includes('CS-STAN'),
    url: 'https://members.gliding.co.uk/airworthiness-2/airworthiness-and-maintenance-procedures/',
    name: 'BGA AMP page — current revisions' },
  { test: (l, p) => l.includes('Standard Repairs'),
    url: 'https://members.gliding.co.uk/library/standard-repairs-to-gliders/',
    name: 'BGA library — Standard Repairs to Gliders' },
  { test: (l, p) => l.includes('Compendium'),
    url: 'https://members.gliding.co.uk/airworthiness-2/airworthiness-directives/',
    name: 'BGA — Airworthiness Instructions and Compendium' },
  { test: (l, p) => /wb-|Datasheets?|Weighing Periodicity/i.test(l),
    url: 'https://members.gliding.co.uk/library/airworthiness/',
    name: 'BGA library — airworthiness documents (datasheets and compendium)' },
  { test: (l, p) => /AC ?43|ANC-?1[89]|Hardware, Control Cables/i.test(l) || p.includes('ac43'),
    url: 'https://www.faa.gov/regulations_policies/advisory_circulars/index.cfm/go/document.information/documentID/99861',
    name: 'FAA — AC 43.13-1B (public domain)' },
  { test: (l, p) => l.includes('Ceconite'),
    url: 'https://www.ceconite.com/',
    name: 'Ceconite — manufacturer site' },
  { test: (l, p) => /West System|Gougeon/i.test(l),
    url: 'https://www.westsystem.com/instruction-2/user-manual-product-guide/',
    name: 'West System — user manual and product guide' },
];
function sourceLink(label, path) {
  for (const r of SOURCE_LINK_RULES) {
    try { if (r.test(label || '', path || '')) return { url: r.url, name: r.name }; } catch (e) {}
  }
  return null;
}

function githubApi(method, repo, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/contents/${path}`,
      method,
      headers: {
        'User-Agent': 'thecast-archivist',
        'Accept': 'application/vnd.github.v3+json',
        ...(GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, json: {} }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Raw-content fetch: the JSON contents API only inlines base64 for files < 1MB.
// For larger files (reference_fulltext.json is ~14MB) the raw media type must be
// used — supported by the contents endpoint up to 100MB. (Fix 26/7/26: reference
// search had been silently failing since the index crossed 1MB.)
function githubApiRaw(repo, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/contents/${path}`,
      method: 'GET',
      headers: {
        'User-Agent': 'thecast-archivist',
        'Accept': 'application/vnd.github.raw',
        ...(GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {})
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function logConversation(question, reply, fetchedLabels, failedLabels, wkGateFlags) {
  if (!GITHUB_TOKEN) return;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16);
  const path = `alf/conversation-log/${day}.md`;

  let entry = `\n---\n### ${day} ${time} UTC\n**Q:** ${question}\n\n`;
  entry += `**Sources:** ${fetchedLabels.join('; ') || 'none'}`;
  if (failedLabels.length > 0) entry += ` | FAILED: ${failedLabels.join('; ')}`;
  if (wkGateFlags && wkGateFlags.length > 0) {
    entry += `\n**wk- CHECKSUM GATE FIRED:** ` + wkGateFlags.map(f =>
      `[cited page: ${f.citedPage ?? 'none'}, quote: "${f.quote}"]`).join('; ');
  }
  entry += `\n\n**A:** ${reply}\n`;

  // Two attempts to absorb a concurrent-write SHA conflict
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const cur = await githubApi('GET', LOG_REPO, path);
      let content, sha;
      if (cur.status === 200 && cur.json.content) {
        content = Buffer.from(cur.json.content, 'base64').toString('utf8') + entry;
        sha = cur.json.sha;
      } else {
        content = `# Alf conversation log — ${day}\nReview weekly. Nothing here enters the Archive without promotion to a reviewed note.\n` + entry;
        sha = undefined;
      }
      const put = await githubApi('PUT', LOG_REPO, path, {
        message: `Alf log ${day} ${time}`,
        content: Buffer.from(content).toString('base64'),
        ...(sha ? { sha } : {})
      });
      if (put.status === 200 || put.status === 201) return;
      console.log(`[archivist] Log PUT status ${put.status}, attempt ${attempt + 1}`);
    } catch (e) {
      console.log(`[archivist] Log attempt ${attempt + 1} failed: ${e.message}`);
    }
  }
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

  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
  if (!checkRateLimit(clientIp)) {
    console.log(`[archivist] Rate limit hit: ${clientIp}`);
    return {
      statusCode: 429,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "You've sent quite a few questions in a short time — give it a few minutes and try again. If you're doing something that genuinely needs more, get in touch." })
    };
  }

  const timer = makeTimer();
  try {
    const { messages } = JSON.parse(event.body);
    const userTurns = (messages || []).filter(m => m.role === 'user');
    const latestQuery = userTurns.slice(-1)[0]?.content || '';
    // Route on the last two user turns so short follow-ups ("and for solid spruce?") keep their subject
    const routingQuery = userTurns.slice(-2).map(m => m.content).join(' ');
    const relevantDocs = selectDocuments(routingQuery);

    console.log(`[archivist] Query: "${latestQuery.slice(0,80)}" | Docs: ${relevantDocs.map(d=>d.label).join(', ') || 'none'}`);

    const docContent = [];
    const fetchedLabels = [];
    const failedLabels = [];
    const MAX_CHARS = 35000; // Keep well within Netlify 26s timeout

    // Fetch documents in parallel rather than sequentially; TNS search runs alongside,
    // time-boxed — a slow or failed TNS lookup must never delay or break the answer.
    let tnsResults = [];
    let referenceResults = [];
    let scannedTnsResults = [];
    let wkResults = [];
    const retrievalT0 = Date.now();
    const docsT0 = Date.now();
    await Promise.all([
      ...relevantDocs.map(async (doc) => {
      try {
        let fetchedText;
        if (doc.path.startsWith('glider-workshop/')) {
          // Fetch from glider-workshop repo (ingest JSON records)
          const repoPath = doc.path.replace('glider-workshop/', '');
          const res = await githubApi('GET', LOG_REPO, repoPath);
          if (!res || res.status !== 200 || !res.json.content) { failedLabels.push(doc.label); return; }
          const record = JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf8'));
          // Extract full_text or concatenate page texts
          fetchedText = record.full_text || 
            (record.pages || []).map(p => p.text_content || p.text || '').filter(Boolean).join('\n\n');
          // Prepend annotations if present
          if (record.annotations && record.annotations.length > 0) {
            const annBlock = '⚠ ANNOTATIONS (read first):\n' + record.annotations.map(a => `• ${a}`).join('\n') + '\n\n';
            fetchedText = annBlock + fetchedText;
          }
          // Add currency note
          const ingestDate = record.ingest && record.ingest.date ? record.ingest.date : 'unknown';
          fetchedText += `\n\n[Downloaded: ${ingestDate}. AMPs are under strict BGA revision control — always verify the current version at members.gliding.co.uk/airworthiness-2/airworthiness-and-maintenance-procedures/]`;
        } else {
          // Fetch from vintage-glider-knowledge-base (standard archive)
          const meta = await githubGet(encodeURIComponent(doc.path).replace(/%2F/g, '/'));
          if (!meta.download_url) { failedLabels.push(doc.label); return; }
          const rawBuffer = await fetchRawUrl(meta.download_url);
          fetchedText = rawBuffer.toString('utf8');
        }
        let docText = fetchedText.slice(0, MAX_CHARS);
        if (fetchedText.length > MAX_CHARS) {
          docText += `\n\n[DOCUMENT TRUNCATED at ${MAX_CHARS} characters — ${fetchedText.length - MAX_CHARS} characters beyond this point were not loaded. If the answer may lie in the unloaded portion, say so plainly rather than answering as if the document were complete.]`;
          console.log(`[archivist] TRUNCATED ${doc.label}: ${fetchedText.length} chars -> ${MAX_CHARS}`);
        }
        docContent.push({
          type: 'text',
          text: `[Archive document: ${doc.label}]\n\n${docText}`,
          cache_control: { type: 'ephemeral' }
        });
        fetchedLabels.push(doc.label);
      } catch (e) {
        failedLabels.push(doc.label);
        console.log(`[archivist] Failed to fetch ${doc.path}: ${e.message}`);
      }
      timer.mark('docs', Date.now() - docsT0);
    }),
      timer.time('tns', () => Promise.race([
        searchTNS(routingQuery).then(r => { tnsResults = r; }),
        new Promise(resolve => setTimeout(resolve, 6000))
      ])).catch(e => console.log(`[archivist] TNS search skipped: ${e.message}`)),
      timer.time('reference', () => Promise.race([
        searchReference(routingQuery).then(r => { referenceResults = r; }),
        new Promise(resolve => setTimeout(resolve, 8000))
      ])).catch(e => console.log(`[archivist] Reference search skipped: ${e.message}`)),
      timer.time('scannedTns', () => Promise.race([
        searchScannedTNS(routingQuery).then(r => { scannedTnsResults = r; }),
        new Promise(resolve => setTimeout(resolve, 12000))
      ])).catch(e => console.log(`[archivist] Scanned TNS search skipped: ${e.message}`)),
      timer.time('wk', () => Promise.race([
        searchWkCollection(routingQuery).then(r => { wkResults = r; }),
        new Promise(resolve => setTimeout(resolve, 12000))
      ])).catch(e => console.log(`[archivist] wk- collection search skipped: ${e.message}`))
    ]);
    timer.mark('retrievalTotal', Date.now() - retrievalT0);

    if (tnsResults.length > 0) {
      console.log(`[archivist] TNS hits: ${tnsResults.map(t => t.label).join(', ')}`);
    }
    if (referenceResults.length > 0) {
      console.log(`[archivist] Reference hits: ${referenceResults.map(r => r.label).join(', ')}`);
    }

    if (scannedTnsResults.length > 0) {
      console.log(`[archivist] Scanned TNS hits: ${scannedTnsResults.map(r => r.label).join(', ')}`);
    }
    if (wkResults.length > 0) {
      console.log(`[archivist] wk- hits: ${wkResults.map(r => `${r.slug}#${r.pdf_page}`).join(', ')}`);
    }

    const userContent = [];
    const tnsNote = tnsResults.length > 0
      ? `\n\nTNS search results (index of BGA Technical News Sheets — full text NOT in the Archive):\n` +
        tnsResults.map(t => `- ${t.label} — ${t.url}\n  matched: ${t.snips.map(s => `"${s}"`).join(' | ')}`).join('\n') +
        `\nIf any of these are relevant, tell the user the topic is covered in that TNS and give the link.`
      : '';

    const referenceNote = referenceResults.length > 0
      ? `\n\nReference document search results (extracted text from BGA Standard Repairs, Compendium, Inspector Course, AC43.13-1B, Datasheets, OM100 records):\n` +
        referenceResults.map(r => {
          let entry = `- ${r.label} (Tier ${r.tier || 1})`;
          if (r.annotations && r.annotations.length > 0) {
            entry += `\n  ⚠ ANNOTATIONS (read first):\n` + r.annotations.map(a => `    • ${a}`).join('\n');
          }
          if (r.subject_tags && r.subject_tags.length > 0) {
            entry += `\n  Subject tags: ${r.subject_tags.join(', ')}`;
          }
          entry += `\n  matched: ${r.snips.map(s => `"${s}"`).join(' | ')}`;
          return entry;
        }).join('\n') +
        `\nUse these passages to answer the question. READ ANNOTATIONS FIRST — they contain warnings about superseded guidance and document currency. Cite the document name and page in your answer.`
      : '';

    const scannedTnsNote = scannedTnsResults.length > 0
      ? `\n\nScanned TNS search results (pre-2020 BGA Technical News Sheets, tesseract OCR — treat text as approximate):\n` +
        scannedTnsResults.map(r =>
          `- ${r.label} (${r.decade})\n  matched: ${r.snips.map(s => `"${s}"`).join(' | ')}`
        ).join('\n') +
        `\nNote: these are older scanned documents — OCR may have minor errors. Use for guidance and topic identification, not verbatim quotes.`
      : '';

    const wkNote = wkResults.length > 0
      ? `\n\nWally Kahn / BGA eBook Collection search results (vintage gliding books, used with BGA permission — a private grounding store, NOT for reproduction):\n` +
        wkResults.map(r => `- "${r.slug.replace(/^wk-b\d+s?-/, '').replace(/-/g, ' ')}", scan page ${r.pdf_page}\n  text: ${r.window_text.slice(0, 500).replace(/\n+/g, ' ')}...`).join('\n') +
        `\n\nSTRICT RULES for using this material:\n` +
        `1. Summarise and paraphrase in your own words. This is the primary way to use this material.\n` +
        `2. At most ONE direct quotation, maximum 25 words, in quotation marks, clearly attributed to the book by name.\n` +
        `3. Cite the location as "scan page ${'{N}'}" using the pdf_page number given above — NEVER state or infer a printed/book page number. This collection's printed page numbers are not yet verified and must not be presented to the reader.\n` +
        `4. Do not reproduce more of the text than needed to answer the question.\n` +
        `5. Tell the reader this comes from the Wally Kahn / BGA eBook Collection and that they can find the original at the source link provided in this system's sources panel — do not construct or guess a link yourself.`
      : '';

    if (docContent.length > 0) {
      userContent.push(...docContent);
      let contextNote = `The above document(s) have been retrieved from the Archive as likely relevant.`;
      if (failedLabels.length > 0) {
        contextNote += `\n\nNote: The following documents were identified as relevant but could not be retrieved just now: ${failedLabels.join(', ')}. Do not claim to have consulted them. If they matter to the answer, say plainly that they could not be reached and suggest the user try again.`;
      }
      contextNote += tnsNote;
      contextNote += referenceNote;
      contextNote += scannedTnsNote;
      contextNote += wkNote;
      contextNote += `\n\nUser's question: ${latestQuery}`;
      userContent.push({ type: 'text', text: contextNote });
    } else if (failedLabels.length > 0) {
      userContent.push({ type: 'text', text: `Documents were identified as relevant (${failedLabels.join(', ')}) but could not be retrieved just now. Do not claim to have consulted them. Answer from your general knowledge where you can, note which document the user should consult, and suggest they try again shortly.${tnsNote}${referenceNote}${scannedTnsNote}${wkNote} User's question: ${latestQuery}` });
    } else {
      userContent.push({ type: 'text', text: (tnsNote || referenceNote || scannedTnsNote || wkNote) ? `${tnsNote}${referenceNote}${scannedTnsNote}${wkNote}\n\nUser's question: ${latestQuery}` : latestQuery });
    }

    const priorMessages = (messages || []).slice(0, -1).map(m => ({ role: m.role, content: m.content }));
    const allMessages = [...priorMessages, { role: 'user', content: userContent }];

    const response = await timer.time('anthropic', () => anthropicPost({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: [{ type: 'text', text: ARCHIVIST_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: allMessages
    }));

    if (!response.content || !response.content[0]) {
      throw new Error('Anthropic error: ' + JSON.stringify(response));
    }

    let reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const wkGate = wkApplyChecksumGate(reply, wkResults);
    reply = wkGate.reply;
    console.log(`[archivist] Tokens: ${response.usage?.input_tokens}in / ${response.usage?.output_tokens}out | Docs: ${relevantDocs.length}`);

    // Full provenance for the sources panel. Previously `sources` listed only
    // full-document fetches — search-hit snippets that supplied figures were
    // invisible (the corrected SHK-1 answer cited wb-shk-1 yet sources showed
    // only the Compendium). Every consulted material now appears, with an
    // authoritative link where a public source exists.
    const sourceDetails = [];
    const seen = new Set();
    const addSource = (label, kind, link) => {
      if (!label || seen.has(label)) return;
      seen.add(label);
      sourceDetails.push({ label, kind, url: link ? link.url : null, urlName: link ? link.name : null });
    };
    relevantDocs.forEach(doc => {
      if (fetchedLabels.includes(doc.label)) addSource(doc.label, 'document', sourceLink(doc.label, doc.path));
    });
    referenceResults.forEach(r => addSource(r.label, 'search', sourceLink(r.label, r.source || '')));
    tnsResults.forEach(t => addSource(t.label, 'tns', t.url
      ? { url: t.url, name: 'BGA TNS library — authoritative current copy' }
      : { url: 'https://members.gliding.co.uk/library/tns/', name: 'BGA TNS library' }));
    scannedTnsResults.forEach(s => addSource(`${s.label} (${s.decade}, scanned)`, 'tns-scan',
      { url: 'https://members.gliding.co.uk/library/tns/', name: 'BGA TNS library — read the authoritative copy' }));
    wkResults.forEach(r => addSource(
      `${r.slug.replace(/^wk-b\d+s?-/, '').replace(/-/g, ' ')} (Wally Kahn / BGA eBook Collection)`,
      'wk-collection',
      { url: WK_LANDING_PAGE, name: 'Wally Kahn / BGA eBook Collection' }));

    const sourceLabels = sourceDetails.map(s => s.label);

    // Log the exchange for weekly review (disclosed on page). Time-boxed and
    // failure-tolerant: a slow or failed log write must never delay the answer.
    try {
      await timer.time('log', () => Promise.race([
        logConversation(latestQuery, reply, sourceLabels, failedLabels, wkGate.flagged),
        new Promise(resolve => setTimeout(resolve, 4000))
      ]));
    } catch (e) {
      console.log(`[archivist] Log skipped: ${e.message}`);
    }

    const timing = timer.summary();
    console.log(`[archivist][timing] docs=${timing.docs ?? '-'}ms tns=${timing.tns ?? '-'}ms reference=${timing.reference ?? '-'}ms scannedTns=${timing.scannedTns ?? '-'}ms wk=${timing.wk ?? '-'}ms retrievalTotal=${timing.retrievalTotal ?? '-'}ms anthropic=${timing.anthropic ?? '-'}ms log=${timing.log ?? '-'}ms total=${timing.total}ms`);

    const body = { reply, sources: sourceLabels, sourceDetails };
    if (process.env.DEBUG_TIMING === '1') body._timing = timing;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(body)
    };

  } catch (err) {
    const timing = timer.summary();
    console.log(`[archivist] Error: ${err.message} | [archivist][timing] total=${timing.total}ms ${JSON.stringify(timing)}`);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};

