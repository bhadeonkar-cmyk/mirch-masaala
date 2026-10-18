const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];

if (scripts.length === 0) {
  console.error('No inline JavaScript block found in index.html');
  process.exit(1);
}

for (let i = 0; i < scripts.length; i += 1) {
  try {
    new vm.Script(scripts[i][1], { filename: `index.html:inline-script-${i + 1}` });
    console.log(`✓ index.html inline script ${i + 1} parses (${scripts[i][1].length} chars)`);
  } catch (error) {
    console.error(`✗ JavaScript syntax error in inline script ${i + 1}: ${error.message}`);
    process.exitCode = 1;
  }
}
