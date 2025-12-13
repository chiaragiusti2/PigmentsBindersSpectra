const pigmentSelect = document.getElementById('pigmentSelect');
const strumentoSelect = document.getElementById('strumentoSelect');
const spectraList = document.getElementById('spectraList');
const plotDiv = document.getElementById('plot');

let config = {};
let metadata = {};

async function loadJSON(path) {
  const r = await fetch(path);
  return r.json();
}

Promise.all([
  loadJSON('data/config.json'),
  loadJSON('data/metadata.json')
]).then(([cfg, meta]) => {
  config = cfg;
  metadata = meta;

  Object.keys(config).forEach(p => {
    pigmentSelect.add(new Option(p, p));
  });

  populateStrumenti();
});

pigmentSelect.addEventListener('change', populateStrumenti);
strumentoSelect.addEventListener('change', populateSpettri);

function populateStrumenti() {
  strumentoSelect.innerHTML = '';
  spectraList.innerHTML = '';

  Object.keys(config[pigmentSelect.value]).forEach(s => {
    strumentoSelect.add(new Option(s, s));
  });

  updateInfo();
  populateSpettri();
}


function populateSpettri() {
  spectraList.innerHTML = '';
  const files = config[pigmentSelect.value][strumentoSelect.value];

  files.forEach(f => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = f;
    label.appendChild(cb);
    label.append(' ' + f);
    spectraList.appendChild(label);
  });

  updateInfo();
}

function updateInfo() {
  const p = pigmentSelect.value;
  const s = strumentoSelect.value;

  const meta = metadata[p];

  document.getElementById('pigmentName').textContent = p;
  // document.getElementById('formula').textContent = meta.description.chemical_formula;
  document.getElementById('pigmentDesc').textContent = meta.description.notes;
  document.getElementById('instrumentDesc').textContent = meta.instruments[s].description;
}

document.getElementById('plotBtn').addEventListener('click', async () => {
  const checks = spectraList.querySelectorAll('input:checked');
  const traces = [];

  for (const cb of checks) {
    const path = `data/pigments/${pigmentSelect.value}/${strumentoSelect.value}/${cb.value}`;
    const text = await fetch(path).then(r => r.text());

    const lines = text.split('\n').filter(l => l.trim());
    const x = [], y = [];

    lines.forEach(l => {
      const [a, b] = l.replace(/,/g, '.').split('\t');
      x.push(parseFloat(a));
      y.push(parseFloat(b));
    });

    traces.push({
      x, y,
      mode: 'lines',
      name: cb.value
    });
  }

  Plotly.newPlot(plotDiv, traces, {
    title: `${pigmentSelect.value} – ${strumentoSelect.value}`,
    xaxis: { title: 'Wavelength' },
    yaxis: { title: 'Intensity' }
  });
});