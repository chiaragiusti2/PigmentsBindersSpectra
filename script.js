async function loadConfig() {
  const response = await fetch('data/config.json');
  return response.json();
}

let config = {};
const pigmentSelect = document.getElementById('pigmentSelect');
const strumentoSelect = document.getElementById('strumentoSelect');
const spettroSelect = document.getElementById('spettroSelect');
const plotDiv = document.getElementById('plot');

loadConfig().then(cfg => {
  config = cfg;
  Object.keys(config).forEach(p => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = p;
    pigmentSelect.appendChild(opt);
  });
  populateStrumenti();
});

pigmentSelect.addEventListener('change', populateStrumenti);
strumentoSelect.addEventListener('change', populateSpettri);

function populateStrumenti() {
  strumentoSelect.innerHTML = "";
  spettroSelect.innerHTML = "";
  const strumenti = Object.keys(config[pigmentSelect.value]);
  strumenti.forEach(s => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = s;
    strumentoSelect.appendChild(opt);
  });
  populateSpettri();
}

function populateSpettri() {
  spettroSelect.innerHTML = "";
  if (!strumentoSelect.value) return;
  config[pigmentSelect.value][strumentoSelect.value].forEach(file => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = file;
    spettroSelect.appendChild(opt);
  });
}

function interpolate(x, y, resolution = 5) {
  const newX = [];
  const newY = [];

  for (let i = 0; i < x.length - 1; i++) {
    const x0 = x[i];
    const x1 = x[i + 1];
    const y0 = y[i];
    const y1 = y[i + 1];

    // numero di punti intermedi: resolution
    for (let r = 0; r < resolution; r++) {
      const t = r / resolution;
      newX.push(x0 + t * (x1 - x0));
      newY.push(y0 + t * (y1 - y0));
    }
  }

  // aggiunge ultimo punto
  newX.push(x[x.length - 1]);
  newY.push(y[y.length - 1]);

  return { x: newX, y: newY };
}

// Calcolo limiti asse Y escludendo outlier
function getYAxisRange(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.01)];
  const high = sorted[Math.floor(sorted.length * 0.99)];
  return [low, high];
}

document.getElementById('plotBtn').addEventListener('click', async () => {
  const pigment = pigmentSelect.value;
  const strumento = strumentoSelect.value;
  const file = spettroSelect.value;
  const path = `data/${pigment}/${strumento}/${file}`;

  const response = await fetch(path);
  const text = await response.text();

  // Trova la riga "Begin Spectral Data"
  const startIndex = text.indexOf('>>>>>Begin Spectral Data<<<<<');
  const dataSection = text
    .slice(startIndex)
    .split('\n')
    .slice(1)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const x = [], y = [];

  dataSection.forEach(line => {
    const cleaned = line.replace(',', '.').replace(/\s+/g, ' ');
    const [aStr, bStr] = cleaned.split(' ');
    const a = parseFloat(aStr);
    const b = parseFloat(bStr);
    if (!isNaN(a) && !isNaN(b)) {
      x.push(a);
      y.push(b);
    }
  });

  // 🔹 interpolazione (usata nel grafico)
  const { x: xInterp, y: yInterp } = interpolate(x, y, 10);

  // 🔹 calcolo range su dati interpolati
  const [yMin, yMax] = getYAxisRange(yInterp);

  Plotly.newPlot(plotDiv, [{
    x: xInterp,
    y: yInterp,
    mode: 'lines',
    type: 'scattergl',
    line: { shape: 'spline', smoothing: 1.3, width: 1 }
  }], {
    title: `${pigment} - ${strumento}`,
    xaxis: { title: 'Wavelength (nm)' },
    yaxis: { title: 'Intensity / Reflectance', range: [yMin, yMax] }
  });
});
