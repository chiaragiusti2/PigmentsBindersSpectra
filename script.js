const pigmentSelect = document.getElementById('pigmentSelect');
const plotsContainer = document.getElementById('plotsContainer');

let config = {};
let siteContent = {};
let manifest = {}; // Manifest of all files for GitHub Pages compatibility
// cache for parsed data: dataCache[pigment][instrument][file] = {x,y}
let dataCache = {};

// ---------------- LOAD JSON / INIT ----------------
async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Errore caricando ${path}`);
  return r.json();
}

async function listDirectory(path, { dirsOnly = false, filesOnly = false } = {}) {
  // fetch directory listing (expects server directory index)
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Errore leggendo ${path}`);
  const text = await r.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');
  const anchors = Array.from(doc.querySelectorAll('a'))
    .map(a => a.getAttribute('href'))
    .filter(h => h && h !== '../')
    // skip hidden/system files like .DS_Store
    .filter(h => !h.startsWith('.'))
    .map(h => {
      const isDir = h.endsWith('/');
      // when requesting dirsOnly, keep only directory anchors
      if (dirsOnly && !isDir) return null;
      // when requesting filesOnly, keep only non-directory anchors
      if (filesOnly && isDir) return null;
      // normalize by removing trailing slash
      return h.replace(/\/+$/, '');
    })
    .filter(Boolean);
  return anchors;
}

async function init() {
  try {
    config = await loadJSON('data/config.json');
  } catch (e) {
    console.warn('config.json not found or broken, continuing with discovery', e);
    config = {};
  }
  try {
    manifest = await loadJSON('data/manifest.json');
  } catch (e) {
    console.warn('manifest.json not found, will use directory listing', e);
    manifest = {};
  }
  try {
    siteContent = await loadJSON('data/site_content.json');
  } catch (e) {
    console.warn('site_content.json not found; using defaults', e);
    siteContent = {};
  }

  // normalize pigments: support both object map and array list
  if (Array.isArray(siteContent.pigments)) {
    const map = {};
    siteContent.pigments.forEach(item => {
      if (!item) return;
      const key = item.name || item.title;
      if (key) map[key] = item;
    });
    siteContent.pigmentsMap = map;
  } else {
    siteContent.pigmentsMap = siteContent.pigments || {};
  }

  // Use pigments from site_content.json instead of directory listing (for GitHub Pages compatibility)
  const pigments = Object.keys(siteContent.pigmentsMap || {});
  
  // Fallback to config keys if site_content.json has no pigments
  if (pigments.length === 0) {
    const configKeys = Object.keys(config || {});
    if (configKeys.length > 0) {
      pigments.push(...configKeys);
    }
  }
  
  if (pigments.length === 0) {
    console.error('No pigments found in site_content.json or config');
    return;
  }

  pigments.forEach(p => pigmentSelect.add(new Option(p, p)));
  pigmentSelect.value = pigments[0];

  updateInfo();
  renderPigment();
}

pigmentSelect.addEventListener('change', () => {
  updateInfo();
  renderPigment();
});

init().catch(console.error);

// ---------------- RENDER ----------------
async function renderPigment() {
  const pigment = pigmentSelect.value;
  plotsContainer.innerHTML = '';

  // Get instruments from manifest (GitHub Pages), or try standard names, or from config
  let instruments = [];
  
  if (manifest[pigment]) {
    // Use manifest if available (GitHub Pages)
    instruments = Object.keys(manifest[pigment]);
  } else {
    // Fallback: try standard instrument folder names
    const standardInstruments = ['FORS', 'FT-IR', 'Raman', 'RAMAN'];
    const configInstruments = Object.keys(config[pigment] || {});
    
    // Combine standard instruments with any from config
    const instrumentsSet = new Set([...standardInstruments, ...configInstruments]);
    const instrumentsToTry = Array.from(instrumentsSet).sort();

    // Check which instruments actually have data by trying to list their directories
    for (const instr of instrumentsToTry) {
      try {
        // Try to list directory - will work locally
        const files = await listDirectory(`data/pigments/${pigment}/${instr}/`, { filesOnly: true });
        if (files && files.length > 0) {
          instruments.push(instr);
          continue;
        }
      } catch (e) {
        // Directory listing failed - skip this instrument
      }
      
      // If directory listing failed, check if config has files for this instrument
      const cfgFiles = config[pigment]?.[instr];
      if (Array.isArray(cfgFiles) && cfgFiles.length > 0) {
        instruments.push(instr);
      }
    }
  }

  for (const instrument of instruments) {
    const section = document.createElement('section');
    section.className = 'instrument-section';

    const title = document.createElement('h3');
    title.textContent = instrument;

    const desc = document.createElement('p');
    desc.innerHTML = formatText(siteContent.instruments?.[instrument] || siteContent.pigmentsMap?.[pigment]?.instruments?.[instrument]?.description || '');

    const plotEl = document.createElement('div');
    plotEl.style.height = '360px';

    // file checklist container
    const filesContainer = document.createElement('div');
    filesContainer.className = 'files-container';

    section.append(title, desc, filesContainer, plotEl);
    plotsContainer.appendChild(section);

    // gather files: prefer manifest, then config, otherwise try directory listing
    let files = [];
    if (manifest[pigment]?.[instrument]) {
      // Use manifest (GitHub Pages)
      files = manifest[pigment][instrument];
    } else if (Array.isArray(config[pigment]?.[instrument])) {
      // Use config if available
      files = config[pigment][instrument];
    } else {
      // Try directory listing (local server)
      try {
        files = await listDirectory(`data/pigments/${pigment}/${instrument}/`, { filesOnly: true });
      } catch (e) {
        console.warn('Could not list instrument folder', pigment, instrument, e);
        files = [];
      }
    }

    // If no files found, remove this section and skip to next instrument
    if (!files || files.length === 0) {
      section.remove();
      continue;
    }

    // ensure cache structure
    dataCache[pigment] = dataCache[pigment] || {};
    dataCache[pigment][instrument] = dataCache[pigment][instrument] || {};

    const parsedData = {}; // file -> {x,y,displayName}
    let allY = [];

    // create checkboxes first so UI appears quickly
    files.forEach(f => {
      if (!f) return;
      const name = decodeURIComponent(f);
      const id = `chk-${pigment}-${instrument}-${name}`.replace(/[^a-zA-Z0-9-_\.]/g, '_');
      const label = document.createElement('label');
      label.style.display = 'block';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.file = name;
      cb.id = id;
      const span = document.createElement('span');
      span.textContent = ' ' + name;
      label.appendChild(cb);
      label.appendChild(span);
      filesContainer.appendChild(label);
      cb.addEventListener('change', () => updatePlotForInstrument());
    });

    // load and parse files (cached if possible)
    for (const file of files) {
      if (!file) continue;
      if (file.endsWith('/')) continue;
      const name = decodeURIComponent(file);

      // use cache if present
      if (dataCache[pigment][instrument][name]) {
        parsedData[name] = dataCache[pigment][instrument][name];
        allY.push(...parsedData[name].y);
        continue;
      }

      const path = `data/pigments/${pigment}/${instrument}/${name}`;
      let text;
      try {
        const r = await fetch(path);
        if (!r.ok) { console.warn('Could not fetch', path); continue; }
        text = await r.text();
      } catch (e) {
        console.warn('Fetch error for', path, e);
        continue;
      }

      const { x, y } = parseDataText(text);
      if (x.length < 2) continue;
      const pairs = x.map((xx, i) => [xx, y[i]]).sort((a, b) => a[0] - b[0]);
      const xs = pairs.map(p => p[0]);
      const ys = pairs.map(p => p[1]);
      const { x: xi, y: yi } = interpolate(xs, ys, 10);

      parsedData[name] = { x: xi, y: yi, displayName: name };
      dataCache[pigment][instrument][name] = parsedData[name];
      allY.push(...yi);
    }

    const layout = {
      margin: { t: 20, b: 80 },
      showlegend: true,
      legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.25 },
      xaxis: { title: instrument.toLowerCase().includes('ft') ? 'Wavenumber (cm^-1)' : 'Wavelength (nm)' },
      yaxis: { title: 'Intensity / Reflectance' }
    };
    if (allY.length > 0) {
      const [yMin, yMax] = getYAxisRange(allY);
      layout.yaxis.range = [yMin, yMax];
    }

    function updatePlotForInstrument() {
      const checkboxes = filesContainer.querySelectorAll('input[type=checkbox]');
      const traces = [];
      for (const cb of checkboxes) {
        if (!cb.checked) continue;
        const fname = cb.dataset.file;
        const d = parsedData[fname] || dataCache[pigment][instrument][fname];
        if (!d) continue;
        traces.push({ x: d.x, y: d.y, mode: 'lines', type: 'scattergl', name: fname, line: { width: 1 } });
      }
      if (traces.length === 0) {
        Plotly.purge(plotEl);
        plotEl.innerHTML = '<em>No traces selected</em>';
        return;
      }
      Plotly.react(plotEl, traces, layout);
    }

    // initial plot
    updatePlotForInstrument();
  }

  // global intro (below main title/header)
  let introEl = document.getElementById('globalIntro');
  if (!introEl) {
    introEl = document.createElement('div');
    introEl.id = 'globalIntro';
    const header = document.querySelector('header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(introEl, header.nextSibling);
    } else {
      const main = document.querySelector('main');
      if (main) main.insertBefore(introEl, main.firstChild);
    }
  }
  introEl.innerHTML = formatText(siteContent.intro || '');

  // global footer
  if (siteContent.footer) {
    let f = document.querySelector('footer');
    if (!f) {
      f = document.createElement('footer');
      document.body.appendChild(f);
    }
    f.innerHTML = formatText(siteContent.footer);
  }
}

function parseDataText(text) {
  // 1. Standardize line endings and clean empty lines
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  // ---------------------------------------------------------
  // STRATEGY A: Specific Raman Parsing (look for specific columns)
  // ---------------------------------------------------------
  const ramanHeaderIndex = rawLines.findIndex(l => 
    l.includes('Raman Shift') && l.includes('Dark Subtracted')
  );

  if (ramanHeaderIndex !== -1) {
    const x = [], y = [];
    
    // Detect delimiter: try semicolon first (European CSV), then tab, then comma
    const headerLine = rawLines[ramanHeaderIndex];
    let delimiter = ',';
    if (headerLine.includes(';')) {
      delimiter = ';';
    } else if (headerLine.includes('\t')) {
      delimiter = '\t';
    }
    
    // Parse the header to find exact column indices
    const headerParts = headerLine.split(delimiter).map(h => h.trim());
    
    // Find indices for "Raman Shift" and "Dark Subtracted #1" (or similar)
    let xIndex = headerParts.findIndex(h => h.toLowerCase().includes('raman shift'));
    let yIndex = headerParts.findIndex(h => h.toLowerCase().includes('dark subtracted'));

    // If found, parse data rows
    if (xIndex !== -1 && yIndex !== -1) {
      for (let i = ramanHeaderIndex + 1; i < rawLines.length; i++) {
        const line = rawLines[i];
        // Skip lines that start with letters or are separator lines
        if (/^[A-Za-z#]/.test(line) || line.includes('---')) continue;

        // Split by the detected delimiter
        const parts = line.split(delimiter).map(p => p.trim());

        // Ensure line has enough columns
        if (parts.length <= Math.max(xIndex, yIndex)) continue;

        // Get values and convert European decimal format (comma) to standard (dot)
        const valXStr = parts[xIndex].replace(',', '.').trim();
        const valYStr = parts[yIndex].replace(',', '.').trim();

        // Parse numbers
        const valX = parseFloat(valXStr);
        const valY = parseFloat(valYStr);

        // Check for valid numbers (filters out the separator lines)
        if (!isNaN(valX) && !isNaN(valY)) {
          x.push(valX);
          y.push(valY);
        }
      }
      if (x.length > 0) {
        return { x, y };
      }
    }
  }

  // ---------------------------------------------------------
  // STRATEGY B: Generic CSV/TSV parsing (fallback for FORS, FT-IR)
  // ---------------------------------------------------------
  const marker = '>>>>>Begin Spectral Data<<<<<';
  let lines = rawLines;
  if (rawLines.findIndex(l => l.includes(marker)) !== -1) {
    const startIndex = rawLines.findIndex(l => l.includes(marker));
    if (startIndex !== -1) {
      lines = rawLines.slice(startIndex + 1);
    }
  }

  const x = [], y = [];
  for (const l of lines) {
    // Skip header lines that start with letters or #
    if (/^[A-Za-z#]/.test(l)) continue;

    // Convert European decimal format (comma) to standard (dot)
    const cleaned = l.replace(/,/g, '.');
    
    // Split by tab, comma, semicolon or whitespace
    const parts = cleaned.split(/\t|,|;|\s+/).filter(Boolean);
    
    if (parts.length < 2) continue;
    
    const a = parseFloat(parts[0]);
    const b = parseFloat(parts[1]);
    
    if (!isNaN(a) && !isNaN(b)) {
      x.push(a);
      y.push(b);
    }
  }
  return { x, y };
}

// ---------------- METADATA ----------------
function updateInfo() {
  const p = pigmentSelect.value;
  // page title and header
  if (siteContent.pageTitle) document.title = siteContent.pageTitle;
  const hdr = document.querySelector('header h1');
  if (hdr) hdr.innerHTML = formatText(siteContent.header || hdr.textContent);

  document.getElementById('pigmentName').innerHTML = formatText(siteContent.pigmentsMap?.[p]?.title || p);
  document.getElementById('pigmentDesc').innerHTML =
    formatText(siteContent.pigmentsMap?.[p]?.description || '');

  // attempt to load pigment image asynchronously (matches exact pigment name)
  loadPigmentImage(p).catch(() => {});
}

async function loadPigmentImage(pigment) {
  const containerTarget = document.getElementById('pigmentName');
  if (!containerTarget) return;

  // remove previous image if present
  const existing = document.getElementById('pigmentImage');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const exts = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
  for (const ext of exts) {
    const filename = `${encodeURIComponent(pigment)}.${ext}`;
    const path = `data/images/${filename}`;
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.id = 'pigmentImage';
      img.src = url;
      img.alt = pigment;
      img.style.maxWidth = '100%';
      img.style.display = 'block';
      img.style.margin = '0.3em 0';
      // insert after pigmentName
      const nameEl = document.getElementById('pigmentName');
      if (nameEl && nameEl.parentNode) {
        nameEl.parentNode.insertBefore(img, nameEl.nextSibling);
      }
      return;
    } catch (e) {
      // try next extension
    }
  }
}

// ---------------- SCIENCE ----------------
function interpolate(x, y, resolution = 50) {
  if (x.length < 2) return { x, y };
  const newX = [], newY = [];
  for (let i = 0; i < x.length - 1; i++) {
    const dx = x[i + 1] - x[i];
    const dy = y[i + 1] - y[i];
    for (let r = 0; r < resolution; r++) {
      const t = r / resolution;
      newX.push(x[i] + t * dx);
      newY.push(y[i] + t * dy);
    }
  }
  newX.push(x.at(-1));
  newY.push(y.at(-1));
  return { x: newX, y: newY };
}


function getYAxisRange(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return [
    sorted[Math.floor(sorted.length * 0.01)],
    sorted[Math.floor(sorted.length * 0.99)]
  ];
}

// simple formatting parser: converts **bold**, _italic_, and \n to HTML
function formatText(text) {
  if (!text) return '';
  return text
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/_(.+?)_/g, '<em>$1</em>');
}
