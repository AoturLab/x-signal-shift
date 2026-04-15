import { mkdir, readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const root = process.cwd()
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))
const releasesDir = resolve(root, "releases")
const archiveName = `x-signal-shift-v${pkg.version}.zip`
const archivePath = resolve(releasesDir, archiveName)

await mkdir(releasesDir, { recursive: true })
await rm(archivePath, { force: true })

await execFileAsync("zip", ["-r", archivePath, "."], {
  cwd: resolve(root, "dist")
})

console.log(`Release package created: ${archivePath}`)
