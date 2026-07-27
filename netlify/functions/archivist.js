const https = require('https');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'Kai-C-Clarke/vintage-glider-knowledge-base';

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
  { keywords: ['slingsby','martin simons','t21','t31','t49','t51','skylark','prefect','capstan','swallow','type history','design history'], path: 'gliding_history_and_literature/slingsby_chapters/part_01.txt', label: 'Slingsby Sailplanes — Martin Simons (Part 1)' },
  { keywords: ['grounding','bonding','static','lightning','electrical bonding','static discharge','earthing','bonding strap','bonding jumper','metallic bonding','faraday','precipitation static','p-static','shielding','emi'], path: 'general_airworthiness/ac43_ch11_section15_grounding_bonding.txt', label: 'AC43.13-1B Chapter 11 — Electrical Systems, Grounding and Bonding' },
  { keywords: ['bonding','grounding','wooden glider','vintage bonding','static wood','wood conductor','p-static radio','radio installation','transponder installation','retrofit radio','wood moisture','static discharge wood'], path: 'general_airworthiness/electrical_bonding_vintage_wooden_gliders_note_2026.txt', label: 'Electrical Bonding in Vintage Wooden Gliders — Why It Is Absent (2026)' },
  { keywords: ['piggott','derek piggott','cumulonimbus','thunderstorm','lightning strike','skylark','lasham','altitude record','electric shock','control column shock','cloud flying','cb','hypoxia','ice controls'], path: 'gliding_history_and_literature/derek_piggott_cumulonimbus_1955_case_study.txt', label: 'Derek Piggott — Cumulonimbus Encounter 1955 (Lightning Case Study)' },
  { keywords: ['ac43','fabric','covering','dope','polyester','ceconite','rib stitch'], path: 'wood_construction/ac43_chapters/02_chapter_2_fabric_covering.txt', label: 'AC43.13-1B — Fabric Covering' },

  // History and literature
  { keywords: ['kronfeld','soaring','thermal','history','wave','ridge','gliding'], path: 'gliding_history_and_literature/kronfeld_chapters/part_01.txt', label: 'Kronfeld — On Gliding and Soaring (Part 1)' },
  { keywords: ['wally','kahn','bold','history','vintage pilot'], path: 'gliding_history_and_literature/wally_kahn_chapters/part_01.txt', label: 'Wally Kahn — A Glider Pilot Bold (Part 1)' },
  { keywords: ['ann','welch','silent','flight','1939','pre-war'], path: 'gliding_history_and_literature/ann_welch_chapters/part_01.txt', label: 'Ann Welch — Silent Flight (1939)' },
  { keywords: ['slingsby','martin','simons','sailplane','type history','t21','t49'], path: 'gliding_history_and_literature/slingsby_chapters/part_01.txt', label: 'Martin Simons — Slingsby Sailplanes' },

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

async function loadTnsIndex() {
  if (tnsIndexCache) return tnsIndexCache;
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
    const score = hits.length;
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

// ── Reference document search (BGA Standard Repairs, Compendium, Inspector Course, Datasheets, AC43, OM100) ──

async function loadReferenceIndex() {
  if (referenceIndexCache) return referenceIndexCache;
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
    const score = hits.length + (typeHits + labelHits) * 3;
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

  await Promise.all(Object.entries(TNS_DECADE_PATHS).map(async ([decade, path]) => {
    try {
      if (!tnsDecadeCache[decade]) {
        // Raw fetch: 1980s (3.2MB), 1990s (3.9MB), 2000s (1.9MB) exceed the 1MB
        // content:'' JSON-API limit — the old path silently returned nothing for
        // those three decades (confirmed dead 26/7/26, same trap as reference index)
        const res = await githubApiRaw(LOG_REPO, path);
        if (res.status !== 200 || !res.body) return;
        tnsDecadeCache[decade] = JSON.parse(res.body);
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

async function logConversation(question, reply, fetchedLabels, failedLabels) {
  if (!GITHUB_TOKEN) return;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16);
  const path = `alf/conversation-log/${day}.md`;

  let entry = `\n---\n### ${day} ${time} UTC\n**Q:** ${question}\n\n`;
  entry += `**Sources:** ${fetchedLabels.join('; ') || 'none'}`;
  if (failedLabels.length > 0) entry += ` | FAILED: ${failedLabels.join('; ')}`;
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
    }),
      Promise.race([
        searchTNS(routingQuery).then(r => { tnsResults = r; }),
        new Promise(resolve => setTimeout(resolve, 6000))
      ]).catch(e => console.log(`[archivist] TNS search skipped: ${e.message}`)),
      Promise.race([
        searchReference(routingQuery).then(r => { referenceResults = r; }),
        new Promise(resolve => setTimeout(resolve, 8000))
      ]).catch(e => console.log(`[archivist] Reference search skipped: ${e.message}`)),
      Promise.race([
        searchScannedTNS(routingQuery).then(r => { scannedTnsResults = r; }),
        new Promise(resolve => setTimeout(resolve, 12000))
      ]).catch(e => console.log(`[archivist] Scanned TNS search skipped: ${e.message}`))
    ]);

    if (tnsResults.length > 0) {
      console.log(`[archivist] TNS hits: ${tnsResults.map(t => t.label).join(', ')}`);
    }
    if (referenceResults.length > 0) {
      console.log(`[archivist] Reference hits: ${referenceResults.map(r => r.label).join(', ')}`);
    }

    if (scannedTnsResults.length > 0) {
      console.log(`[archivist] Scanned TNS hits: ${scannedTnsResults.map(r => r.label).join(', ')}`);
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

    if (docContent.length > 0) {
      userContent.push(...docContent);
      let contextNote = `The above document(s) have been retrieved from the Archive as likely relevant.`;
      if (failedLabels.length > 0) {
        contextNote += `\n\nNote: The following documents were identified as relevant but could not be retrieved just now: ${failedLabels.join(', ')}. Do not claim to have consulted them. If they matter to the answer, say plainly that they could not be reached and suggest the user try again.`;
      }
      contextNote += tnsNote;
      contextNote += referenceNote;
      contextNote += scannedTnsNote;
      contextNote += `\n\nUser's question: ${latestQuery}`;
      userContent.push({ type: 'text', text: contextNote });
    } else if (failedLabels.length > 0) {
      userContent.push({ type: 'text', text: `Documents were identified as relevant (${failedLabels.join(', ')}) but could not be retrieved just now. Do not claim to have consulted them. Answer from your general knowledge where you can, note which document the user should consult, and suggest they try again shortly.${tnsNote}${referenceNote}${scannedTnsNote} User's question: ${latestQuery}` });
    } else {
      userContent.push({ type: 'text', text: (tnsNote || referenceNote || scannedTnsNote) ? `${tnsNote}${referenceNote}${scannedTnsNote}\n\nUser's question: ${latestQuery}` : latestQuery });
    }

    const priorMessages = (messages || []).slice(0, -1).map(m => ({ role: m.role, content: m.content }));
    const allMessages = [...priorMessages, { role: 'user', content: userContent }];

    const response = await anthropicPost({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: [{ type: 'text', text: ARCHIVIST_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: allMessages
    });

    if (!response.content || !response.content[0]) {
      throw new Error('Anthropic error: ' + JSON.stringify(response));
    }

    const reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    console.log(`[archivist] Tokens: ${response.usage?.input_tokens}in / ${response.usage?.output_tokens}out | Docs: ${relevantDocs.length}`);

    // Log the exchange for weekly review (disclosed on page). Time-boxed and
    // failure-tolerant: a slow or failed log write must never delay the answer.
    try {
      await Promise.race([
        logConversation(latestQuery, reply, fetchedLabels, failedLabels),
        new Promise(resolve => setTimeout(resolve, 4000))
      ]);
    } catch (e) {
      console.log(`[archivist] Log skipped: ${e.message}`);
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ reply, sources: fetchedLabels })
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

