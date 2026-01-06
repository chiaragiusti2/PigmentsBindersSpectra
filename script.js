const pigmentSelect = document.getElementById('pigmentSelect');
const plotsContainer = document.getElementById('plotsContainer');

let config = {};
let metadata = {};
let siteContent = {};
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
    metadata = await loadJSON('data/metadata.json');
  } catch (e) {
    console.warn('metadata.json not found or broken', e);
    metadata = {};
  }

  try {
    siteContent = await loadJSON('data/site_content.json');
  } catch (e) {
    console.warn('site_content.json not found; using defaults', e);
    siteContent = {};
  }

  // discover pigments from data/pigments/ and merge with config keys
  let discovered = [];
  try {
    discovered = await listDirectory('data/pigments/', { dirsOnly: true });
  } catch (e) {
    console.warn('Could not list data/pigments/, falling back to config keys', e);
  }

  const pigments = Array.from(new Set([...(Array.isArray(Object.keys(config)) ? Object.keys(config) : []), ...(Array.isArray(discovered) ? discovered : [])]));
  if (pigments.length === 0) {
    console.error('No pigments found in config or data/pigments/');
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

  // discover instrument folders inside data/pigments/<pigment>/
  let discovered = [];
  try {
    discovered = await listDirectory(`data/pigments/${pigment}/`, { dirsOnly: true });
  } catch (e) {
    console.warn('Could not list pigment folder', e);
  }

  const configInstruments = Object.keys(config[pigment] || {});
  // determine instruments as union of configured and discovered (filtered)
  const instrumentsSet = new Set([...configInstruments, ...discovered]);
  let instruments = Array.from(instrumentsSet).sort();

  // filter out instruments that neither have a directory nor any existing configured files
  const filtered = [];
  for (const instr of instruments) {
    if (discovered.includes(instr)) { filtered.push(instr); continue; }
    // otherwise check if config lists files that actually exist
    const cfgFiles = config[pigment]?.[instr];
    let hasExisting = false;
    if (Array.isArray(cfgFiles) && cfgFiles.length > 0) {
      for (const f of cfgFiles) {
        const p = `data/pigments/${pigment}/${instr}/${encodeURIComponent(f)}`;
        try {
          // try to fetch the file HEAD to see if it exists
          // some servers may not support HEAD; use GET but avoid reading body
          // we'll perform a GET but only check response.ok
          // eslint-disable-next-line no-await-in-loop
          const res = await fetch(p, { method: 'GET' });
          if (res.ok) { hasExisting = true; break; }
        } catch (e) {
          /* ignore network errors */
        }
      }
    }
    if (hasExisting) filtered.push(instr);
  }
  instruments = filtered;

  for (const instrument of instruments) {
    const section = document.createElement('section');
    section.className = 'instrument-section';

    const title = document.createElement('h3');
    title.textContent = instrument;

    const desc = document.createElement('p');
    desc.textContent = siteContent.instruments?.[instrument] || metadata[pigment]?.instruments?.[instrument]?.description || '';

    const plotEl = document.createElement('div');
    plotEl.style.height = '360px';

    // file checklist container
    const filesContainer = document.createElement('div');
    filesContainer.className = 'files-container';

    section.append(title, desc, filesContainer, plotEl);
    plotsContainer.appendChild(section);

    // gather files: prefer config list, otherwise read directory
    let files = [];
    if (Array.isArray(config[pigment]?.[instrument])) {
      files = config[pigment][instrument];
      } else {
      try {
        files = await listDirectory(`data/pigments/${pigment}/${instrument}/`, { filesOnly: true });
      } catch (e) {
        console.warn('Could not list instrument folder', pigment, instrument, e);
        files = [];
      }
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
  introEl.textContent = siteContent.intro || '';

  // global footer
  if (siteContent.footer) {
    let f = document.querySelector('footer');
    if (!f) {
      f = document.createElement('footer');
      document.body.appendChild(f);
    }
    f.textContent = siteContent.footer;
  }
}

function parseDataText(text) {
  // tries multiple parsing strategies: custom marker, then CSV/TSV
  const marker = '>>>>>Begin Spectral Data<<<<<';
  let lines = [];
  if (text.indexOf(marker) !== -1) {
    const startIndex = text.indexOf(marker);
    lines = text.slice(startIndex).split('\n').slice(1).map(l => l.trim()).filter(l => l.length > 0);
  } else {
    lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  }

  const x = [], y = [];
  for (const l of lines) {
    // skip common non-data lines
    if (/^[A-Za-z#]/.test(l)) continue;
    // normalize decimal comma -> dot
    const cleaned = l.replace(/,/g, '.');
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
  if (hdr) hdr.textContent = siteContent.header || hdr.textContent;

  document.getElementById('pigmentName').textContent = siteContent.pigments?.[p]?.title || p;
  document.getElementById('pigmentDesc').textContent =
    siteContent.pigments?.[p]?.description || metadata[p]?.description?.notes || '';

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
