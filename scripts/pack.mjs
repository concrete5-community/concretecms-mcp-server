// Builds the .mcpb extension from a clean staging directory, so the package
// contains only what the extension needs at runtime (allowlist), instead of
// whatever happens to sit in the project folder.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Required first argument: where to write the .mcpb (relative to the current
// directory). "npm run pack" passes the default name; see package.json.
const outputArg = process.argv[2]
if (!outputArg) {
  console.error('Usage: node scripts/pack.mjs <output.mcpb>')
  process.exit(1)
}
const OUTPUT = resolve(outputArg)

function copyInto(stage, name, options) {
  cpSync(join(ROOT, name), join(stage, name), options)
}

// What goes into the staging directory, and how. Each entry places one project
// element; anything not listed here is simply not shipped.
const COPY_FILES = [
  // dist/ (without the compiled tests)
  (stage) =>
    copyInto(stage, 'dist', {
      recursive: true,
      filter: (src) => !/\.test\./.test(src),
    }),
  // LICENSE
  (stage) => copyInto(stage, 'LICENSE'),
  // manifest.json
  (stage) => copyInto(stage, 'manifest.json'),
  // openapi.yml
  (stage) => copyInto(stage, 'openapi.yml'),
  // package.json
  (stage) => copyInto(stage, 'package.json'),
  // package-lock.json (build input only; removed before packing)
  (stage) => copyInto(stage, 'package-lock.json'),
]

// Run a command line through the shell (needed on Windows for the .cmd shims).
// Taking a ready-made string keeps our own path quoting instead of the unescaped
// concatenation Node warns about when args are passed alongside shell:true.
function run(commandLine, options = {}) {
  const result = spawnSync(commandLine, { stdio: 'inherit', shell: true, ...options })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

// Pack the staging dir into `output`. mcpb prints every file it adds (hundreds
// of lines), so capture its stdout and echo only the summary; errors still reach
// the console.
function packExtension(cwd, output) {
  const result = spawnSync(`mcpb pack . "${output}"`, {
    cwd,
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? '')
    process.exit(result.status ?? 1)
  }
  // Echo mcpb's summary only, dropping its "Output:" line (it names the temporary
  // file); the caller reports the real destination.
  const text = result.stdout ?? ''
  const start = text.indexOf('Archive Details')
  let summary = start >= 0 ? text.slice(start) : text
  const outputLine = summary.indexOf('\nOutput:')
  if (outputLine >= 0) summary = summary.slice(0, outputLine)
  process.stdout.write(`${summary.trimEnd()}\n`)
}

// Verify the packed file: unpacking fails on a corrupt archive, and we then
// confirm the runtime essentials are present and the compiled tests are not.
function verifyExtension(output) {
  const checkDir = mkdtempSync(join(tmpdir(), 'ccm-mcpb-check-'))
  try {
    run(`mcpb unpack "${output}" "${checkDir}"`)

    const deps = Object.keys(
      JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies ?? {}
    )
    const required = [
      'manifest.json',
      'package.json',
      'openapi.yml',
      join('dist', 'index.js'),
      ...deps.map((dep) => join('node_modules', dep, 'package.json')),
    ]
    const missing = required.filter((rel) => !existsSync(join(checkDir, rel)))
    if (missing.length > 0) {
      console.error(`Packed extension is missing expected files:\n  ${missing.join('\n  ')}`)
      process.exit(1)
    }

    const tests = readdirSync(join(checkDir, 'dist'), { recursive: true }).filter((entry) =>
      String(entry).endsWith('.test.js')
    )
    if (tests.length > 0) {
      console.error(
        `Packed extension unexpectedly contains compiled tests:\n  ${tests.join('\n  ')}`
      )
      process.exit(1)
    }

    console.log('Verified: the archive unpacks and holds the expected runtime files.')
  } finally {
    rmSync(checkDir, { recursive: true, force: true })
  }
}

// Stop early, with a clear message, when the mcpb CLI is not installed.
const mcpbCheck = spawnSync('mcpb --version', { stdio: 'ignore', shell: true })
if (mcpbCheck.error || mcpbCheck.status !== 0) {
  console.error(
    'The "mcpb" CLI was not found. Install it first:\n  npm install -g @anthropic-ai/mcpb'
  )
  process.exit(1)
}

// Compile a fresh dist/ so the package never ships stale output.
run('npm run build', { cwd: ROOT })

const stage = mkdtempSync(join(tmpdir(), 'ccm-mcpb-'))
const tmpOutput = join(tmpdir(), `ccm-mcpb-${process.pid}.mcpb`)
try {
  for (const place of COPY_FILES) {
    place(stage)
  }

  // Install production dependencies only, from the lockfile, into the staging dir.
  run('npm ci --omit=dev', { cwd: stage })
  unlinkSync(join(stage, 'package-lock.json'))

  // Pack to a temporary file and verify it; only once the checks pass do we
  // publish it to the real output, so a failed run never leaves a broken .mcpb.
  packExtension(stage, tmpOutput)
  verifyExtension(tmpOutput)
  cpSync(tmpOutput, OUTPUT)
  console.log(`\nCreated ${OUTPUT}`)
} finally {
  rmSync(stage, { recursive: true, force: true })
  rmSync(tmpOutput, { force: true })
}
