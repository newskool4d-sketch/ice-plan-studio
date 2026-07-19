import { readFile, writeFile } from 'node:fs/promises';
import { parseMarkdown } from '../src/domain/markdownParser.js';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error('Usage: node scripts/parse-fixture.mjs input.md output.json');
const model = parseMarkdown(await readFile(inputPath, 'utf8'));
await writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
console.log(`Parsed ${model.blocks.length} blocks into ${outputPath}`);
