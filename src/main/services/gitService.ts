import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { GitFileStatus } from '../../shared/types'
import { pathExists, resolveWithin, toPosix } from './paths'

export interface GitStatusResult {
  /** posix 相对项目根的路径 → 简化状态 */
  files: Record<string, GitFileStatus>
}

interface GitRunResult {
  code: number
  stdout: string
  stderr: string
}

function runGit(root: string, args: string[]): Promise<GitRunResult> {
  return new Promise((resolveP) => {
    const proc = spawn('git', args, { cwd: root, shell: false })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d) => (stdout += String(d)))
    proc.stderr?.on('data', (d) => (stderr += String(d)))
    proc.on('error', (err) => resolveP({ code: -1, stdout, stderr: stderr || String(err) }))
    proc.on('close', (code) => resolveP({ code: code ?? -1, stdout, stderr }))
  })
}

/** porcelain XY 状态码 → 简化状态 */
function mapStatus(xy: string): GitFileStatus {
  if (xy.includes('?')) return 'untracked'
  if (xy.includes('A')) return 'added'
  if (xy.includes('D')) return 'deleted'
  return 'modified'
}

/** 仓库根相对项目根的子前缀（项目可能是仓库的子目录）；非仓库返回 null */
async function repoPrefix(root: string): Promise<string | null> {
  const res = await runGit(root, ['rev-parse', '--show-prefix'])
  if (res.code !== 0) return null
  return res.stdout.trim()
}

/** 读取文章文件的 git 状态；项目不是 git 仓库（或 git 不可用）时返回 null */
export async function gitStatus(root: string): Promise<GitStatusResult | null> {
  if (!(await pathExists(join(root, '.git')))) return null
  const prefix = await repoPrefix(root)
  if (prefix === null) return null
  // core.quotepath=off：让非 ASCII 文件名以原文输出，便于与文章 id 匹配
  const st = await runGit(root, ['-c', 'core.quotepath=off', 'status', '--porcelain=v1'])
  if (st.code !== 0) return null

  const files: GitStatusResult['files'] = {}
  for (const line of st.stdout.split('\n')) {
    if (line.length < 4) continue
    const xy = line.slice(0, 2)
    let raw = line.slice(3).trim()
    // 重命名格式 "R  old -> new"：按新路径记录
    if (raw.includes(' -> ')) raw = raw.split(' -> ').pop() ?? raw
    if (prefix) {
      if (!raw.startsWith(prefix)) continue
      raw = raw.slice(prefix.length)
    }
    files[toPosix(raw)] = mapStatus(xy)
  }
  return { files }
}

/** 提交指定文章文件（仅 stage 给定路径，不影响其他未提交改动） */
export async function gitCommit(root: string, relPaths: string[], message: string): Promise<void> {
  if (!relPaths.length) throw new Error('未选择要提交的文件')
  const msg = message.trim()
  if (!msg) throw new Error('请填写提交说明')
  // 统一路径校验：越出项目根（含 .. 穿越、根外绝对路径）即拒绝，与公共服务共用 resolveWithin
  relPaths.forEach((p) => resolveWithin(root, p))

  const prefix = await repoPrefix(root)
  if (prefix === null) throw new Error('当前项目不是 git 仓库')
  const gitPaths = relPaths.map((p) => (prefix ? prefix + toPosix(p) : toPosix(p)))

  const add = await runGit(root, ['add', '--', ...gitPaths])
  if (add.code !== 0) throw new Error(`git add 失败：${add.stderr.trim() || '未知错误'}`)

  const commit = await runGit(root, ['commit', '-m', msg])
  if (commit.code !== 0) {
    const detail = commit.stderr.trim() || commit.stdout.trim() || '未知错误'
    throw new Error(`git commit 失败：${detail.split('\n')[0]}`)
  }
}
