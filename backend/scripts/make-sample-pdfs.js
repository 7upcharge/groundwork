// Generates small, dependency-free text PDFs used for demos and manual QA.
// Run: node scripts/make-sample-pdfs.js
const fs = require('fs');
const path = require('path');

const LINES_PER_PAGE = 46;

function escapePdfText(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text, width = 92) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

function buildPdf(lines) {
  const pages = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }

  const objects = [];
  const fontId = 3;
  const pageIds = pages.map((_, i) => 4 + i * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pages.forEach((pageLines, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const body = pageLines.map((l) => `(${escapePdfText(l)}) Tj T*`).join('\n');
    const stream = `BT\n/F1 11 Tf\n15 TL\n50 750 Td\n${body}\nET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out);
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function toLines(doc) {
  const lines = [];
  for (const block of doc) {
    if (block.heading) {
      lines.push('', block.heading);
    } else {
      lines.push(...wrap(block.p));
    }
  }
  return lines;
}

const LECTURE = [
  { heading: 'BIO 101 - Lecture 7: Cellular Respiration' },
  { p: 'Cellular respiration is the set of metabolic reactions that cells use to convert the chemical energy stored in glucose into adenosine triphosphate, commonly called ATP. ATP is the main energy currency of the cell and powers processes such as muscle contraction, active transport and protein synthesis.' },
  { heading: 'Overview of the Process' },
  { p: 'Aerobic respiration requires oxygen and occurs in three main stages: glycolysis, the Krebs cycle and the electron transport chain. The overall equation shows glucose and oxygen being converted into carbon dioxide, water and energy. A single molecule of glucose can yield up to 38 molecules of ATP under ideal conditions, although the realistic figure is closer to 30 to 32 ATP.' },
  { heading: 'Stage 1: Glycolysis' },
  { p: 'Glycolysis takes place in the cytoplasm and does not require oxygen. During glycolysis one molecule of glucose is split into two molecules of pyruvate. This stage produces a net gain of two ATP molecules and two molecules of NADH, which carry high energy electrons to later stages.' },
  { heading: 'Stage 2: The Krebs Cycle' },
  { p: 'The Krebs cycle, also known as the citric acid cycle, takes place in the mitochondrial matrix. Before the cycle begins, pyruvate is converted into acetyl coenzyme A, releasing carbon dioxide. Each turn of the Krebs cycle produces one ATP, three NADH and one FADH2, and releases two molecules of carbon dioxide as waste.' },
  { heading: 'Stage 3: Electron Transport Chain' },
  { p: 'The electron transport chain is located in the inner mitochondrial membrane. NADH and FADH2 donate electrons to a series of protein complexes, and the energy released pumps hydrogen ions across the membrane. The resulting gradient drives the enzyme ATP synthase, a process called oxidative phosphorylation, which produces the majority of ATP. Oxygen acts as the final electron acceptor and combines with hydrogen ions to form water.' },
  { heading: 'Anaerobic Respiration' },
  { p: 'When oxygen is unavailable, cells rely on fermentation to regenerate NAD+ so that glycolysis can continue. In human muscle cells, pyruvate is converted into lactic acid, which contributes to muscle fatigue during intense exercise. In yeast, alcoholic fermentation converts pyruvate into ethanol and carbon dioxide. Fermentation produces only two ATP per glucose molecule, making it far less efficient than aerobic respiration.' },
  { heading: 'Key Exam Points' },
  { p: 'Students should be able to name the location of each stage, state the inputs and outputs of glycolysis, explain why oxygen is essential as the final electron acceptor, and compare the ATP yield of aerobic respiration with fermentation.' },
];

const outDir = path.join(__dirname, '..', '..', 'samples');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'sample-lecture.pdf'), buildPdf(toLines(LECTURE)));

// Near-empty PDF: valid structure, no meaningful text — simulates a scanned deck.
fs.writeFileSync(path.join(outDir, 'blank-scan.pdf'), buildPdf(['']));

// Large PDF: the lecture repeated to exercise chunking and size handling.
const large = [];
for (let i = 1; i <= 12; i++) {
  large.push({ heading: `Part ${i}: Cellular Respiration Review` }, ...LECTURE.slice(1));
}
fs.writeFileSync(path.join(outDir, 'large-lecture.pdf'), buildPdf(toLines(large)));

console.log(`Sample PDFs written to ${outDir}`);
