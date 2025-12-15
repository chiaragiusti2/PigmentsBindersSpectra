const pigmentSelect = document.getElementById('pigmentSelect');
const plotsContainer = document.getElementById('plotsContainer');

let config = {};
let metadata = {};

// ---------------- LOAD JSON ----------------
async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Errore caricando ${path}`);
  return r.json();
}

Promise.all([
  loadJSON('data/config.json'),
  loadJSON('data/metadata.json')
]).then(([cfg, meta]) => {
  config = cfg;
  metadata = meta;

  const pigments = Object.keys(config);
  pigments.forEach(p => pigmentSelect.add(new Option(p, p)));
  pigmentSelect.value = pigments[0];

  updateInfo();
  renderPigment();
}).catch(console.error);

pigmentSelect.addEventListener('change', () => {
  updateInfo();
  renderPigment();
});

// ---------------- RENDER ----------------
async function renderPigment() {

  const pigment = pigmentSelect.value;
  plotsContainer.innerHTML = '';

  const instruments = Object.keys(config[pigment] || {});

  for (const instrument of instruments) {
    const section = document.createElement('section');
    section.className = 'instrument-section';

    const title = document.createElement('h3');
    title.textContent = instrument;

    const desc = document.createElement('p');
    desc.textContent =
      metadata[pigment]?.instruments?.[instrument]?.description || '';

    const plotEl = document.createElement('div');
    plotEl.style.height = '360px';

    section.append(title, desc, plotEl);
    plotsContainer.appendChild(section);

    const traces = [];
    let allY = [];

    for (const file of config[pigment][instrument]) {
      const path = `data/pigments/${pigment}/${instrument}/${file}`;
      const text = await fetch(path).then(r => r.text());

      const startIndex = text.indexOf('>>>>>Begin Spectral Data<<<<<');
      if (startIndex === -1) {
        console.warn('Data section not found in', file);
        continue; // salta file
      }
      const lines = text
        .slice(startIndex)
        .split('\n')
        .slice(1)
        .map(l => l.trim())
        .filter(line => line.length > 0);


      const x = [], y = [];
      lines.forEach(l => {
        const [a, b] = l.replace(/,/g, '.').split('\t');
        const xx = parseFloat(a);
        const yy = parseFloat(b);
        if (!isNaN(xx) && !isNaN(yy)) {
          x.push(xx);
          y.push(yy);
        }
      });
      if (x.length < 2) continue; // evita interpolate su file vuoto
      const { x: xi, y: yi } = interpolate(x, y, 10);
      allY.push(...yi);

      traces.push({
        x: xi,
        y: yi,
        mode: 'lines',
        type: 'scattergl',
        name: file,
        line: { width: 1 }
      });
    }

    const [yMin, yMax] = getYAxisRange(allY);

    Plotly.newPlot(plotEl, traces, {
      margin: { t: 20 },
      xaxis: { title: 'Wavelength (nm)' },
      yaxis: {
        title: 'Intensity / Reflectance',
        range: [yMin, yMax]
      },
      showlegend: true
    });
  }
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
