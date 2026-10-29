'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { deflateRawSync } = require('node:zlib');
const root = path.resolve(__dirname, '..'), manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = fs.readdirSync(root).filter(file => file.endsWith('.js')).concat(['manifest.json', 'popup.html', 'popup.css', 'README.md', 'CHANGELOG.md', 'LICENSE'], fs.readdirSync(path.join(root, 'icons')).filter(file => /\.(png|svg)$/u.test(file)).map(file => 'icons/' + file)).sort();
for (const file of files.filter(file => file.endsWith('.js'))) new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
const required = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page.split('?')[0], ...manifest.content_scripts.flatMap(script => script.js), ...Object.values(manifest.icons)];
for (const file of required) if (!files.includes(file)) throw new Error('Missing extension asset: ' + file);
const table = Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = table[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }
const local = [], central = []; let offset = 0;
for (const file of files) {
  const name = Buffer.from('x-starter/' + file), content = fs.readFileSync(path.join(root, file)), packed = deflateRawSync(content), crc = crc32(content);
  // Stable ZIP date (1980-01-01) makes identical source produce identical bytes.
  const entry = Buffer.alloc(30); entry.writeUInt32LE(0x04034b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(0x800, 6); entry.writeUInt16LE(8, 8); entry.writeUInt16LE(33, 12);
  entry.writeUInt32LE(crc, 14); entry.writeUInt32LE(packed.length, 18); entry.writeUInt32LE(content.length, 22); entry.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14);
  directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(content.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
  local.push(entry, name, packed); central.push(directory, name); offset += entry.length + name.length + packed.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const target = path.join(root, 'dist', `x-starter-v${manifest.version}.zip`);
fs.writeFileSync(target, Buffer.concat([...local, directory, end]));
console.log(`Packaged ${files.length} extension files: dist/${path.basename(target)}`);
