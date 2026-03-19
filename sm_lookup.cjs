const sm = require('./node_modules/source-map/source-map.js');
const fs = require('fs');

const DIST = './dist/assets';
const files = fs.readdirSync(DIST);
const mapFile = files.find(f => f.endsWith('.js.map'));
const map = JSON.parse(fs.readFileSync(DIST + '/' + mapFile, 'utf8'));
const c = new sm.SourceMapConsumer(map);

const TL = 9;
const TC = 79880;
const hits = [];

c.eachMapping(m => {
  if (m.generatedLine === TL && m.source && m.source.includes('src/')) {
    hits.push(m);
  }
});

hits.sort((a, b) => a.generatedColumn - b.generatedColumn);

// Find nearest mapping at or before TC
let idx = hits.findIndex(h => h.generatedColumn > TC);
if (idx === -1) idx = hits.length;

const slice = hits.slice(Math.max(0, idx - 15), idx + 15);
const lines = [];
slice.forEach((m, i) => {
  const isOwner = (m.generatedColumn <= TC) &&
    (i === slice.length - 1 || slice[i + 1].generatedColumn > TC);
  const nextInHits = hits[hits.indexOf(m) + 1];
  const isOwnerFull = (m.generatedColumn <= TC) &&
    (!nextInHits || nextInHits.generatedColumn > TC);
  const mark = isOwnerFull ? '>>>' : '   ';
  lines.push(`${mark} col ${String(m.generatedColumn).padEnd(7)} => ${m.source}:${m.originalLine}:${m.originalColumn} | ${m.name || ''}`);
});

fs.writeFileSync('./dist/sm_result.txt', lines.join('\n'));
console.log('Written to dist/sm_result.txt');
c.destroy();
