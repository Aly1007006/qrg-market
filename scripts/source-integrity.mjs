import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const sourceExtension = /\.(?:c|m)?jsx?$|\.tsx?$|\.s?css$/;
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((file) => sourceExtension.test(file) && existsSync(file));

const failures = [];
const decoder = new TextDecoder('utf-8', { fatal: true });

for (const file of files) {
  const bytes = readFileSync(file);
  let text;
  try {
    text = decoder.decode(bytes);
  } catch (error) {
    failures.push(`${file}: invalid UTF-8 (${String(error)})`);
    continue;
  }
  if (text.charCodeAt(0) === 0xfeff) failures.push(`${file}: UTF-8 BOM`);
  if (text.includes('\r')) failures.push(`${file}: CR/CRLF line endings`);
  const lines = text.split('\n');
  const longest = lines.reduce(
    (maximum, line) => Math.max(maximum, line.length),
    0,
  );
  if (bytes.length > 1000 && (lines.length <= 2 || longest > 2000))
    failures.push(
      `${file}: suspiciously flattened source (${lines.length} lines, longest ${longest})`,
    );
}

if (failures.length) {
  process.stderr.write(
    `Source integrity check failed:\n${failures.join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Source integrity check passed for ${files.length} files.\n`,
  );
}
