const pigmentSelect = document.getElementById('pigmentSelect');
const plotsContainer = document.getElementById('plotsContainer');

let config = {};
let metadata = {};

// ---------------- LOAD JSON / INIT ----------------
async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Errore caricando ${path}`);
  return r.json();
}

async function listDirectory(path) {
  // fetch directory listing (expects server directory index)
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Errore leggendo ${path}`);
  const text = await r.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');
  const anchors = Array.from(doc.querySelectorAll('a'))
    .map(a => a.getAttribute('href'))
    .filter(h => h && h !== '../')
    .map(h => h.replace(/\/+$/, ''));
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

  // discover pigments from data/pigments/ and merge with config keys
  let discovered = [];
  try {
    discovered = await listDirectory('data/pigments/');
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
    discovered = await listDirectory(`data/pigments/${pigment}/`);
  } catch (e) {
    console.warn('Could not list pigment folder', e);
  }

  const configInstruments = Object.keys(config[pigment] || {});
  // determine instruments as union of configured and discovered (filtered)
  const instrumentsSet = new Set([...configInstruments, ...discovered]);
  const instruments = Array.from(instrumentsSet).sort();

  for (const instrument of instruments) {
    const section = document.createElement('section');
    section.className = 'instrument-section';

    const title = document.createElement('h3');
    title.textContent = instrument;

    const desc = document.createElement('p');
    desc.textContent = metadata[pigment]?.instruments?.[instrument]?.description || '';

    const plotEl = document.createElement('div');
    plotEl.style.height = '360px';

    section.append(title, desc, plotEl);
    plotsContainer.appendChild(section);

    // gather files: prefer config list, otherwise read directory
    let files = [];
    if (Array.isArray(config[pigment]?.[instrument])) {
      files = config[pigment][instrument];
    } else {
      try {
        files = await listDirectory(`data/pigments/${pigment}/${instrument}/`);
      } catch (e) {
        console.warn('Could not list instrument folder', pigment, instrument, e);
        files = [];
      }
    }

    const traces = [];
    let allY = [];

    for (const file of files) {
      if (!file) continue;
      // skip directory entries if any
      if (file.endsWith('/')) continue;
      const safeFile = decodeURIComponent(file);
      const path = `data/pigments/${pigment}/${instrument}/${safeFile}`;
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

      // sort by x ascending
      const pairs = x.map((xx, i) => [xx, y[i]]).sort((a, b) => a[0] - b[0]);
      const xs = pairs.map(p => p[0]);
      const ys = pairs.map(p => p[1]);

      const { x: xi, y: yi } = interpolate(xs, ys, 10);
      allY.push(...yi);

      traces.push({
        x: xi,
        y: yi,
        mode: 'lines',
        type: 'scattergl',
        name: safeFile,
        line: { width: 1 }
      });
    }

    const layout = {
      margin: { t: 20 },
      showlegend: true,
      xaxis: { title: instrument.toLowerCase().includes('ft') ? 'Wavenumber (cm^-1)' : 'Wavelength (nm)' },
      yaxis: { title: 'Intensity / Reflectance' }
    };

    if (allY.length > 0) {
      const [yMin, yMax] = getYAxisRange(allY);
      layout.yaxis.range = [yMin, yMax];
    }

    Plotly.newPlot(plotEl, traces, layout);
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
  document.getElementById('pigmentName').textContent = p;
  document.getElementById('pigmentDesc').textContent =
    metadata[p]?.description?.notes || '';
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
