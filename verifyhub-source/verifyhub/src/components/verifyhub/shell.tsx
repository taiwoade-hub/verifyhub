'use client'

// VerifyHub — application shell: left activity bar + top bar.
// Dark developer workspace with its own identity (not a VS Code clone):
// compact icon rail, subtle borders, one emerald accent, calm motion.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  Home,
  FolderGit2,
  PlayCircle,
  ScanEye,
  Github,
  Clock3,
  Send,
  Settings,
  ShieldCheck,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NewVerificationDialog } from '@/components/verifyhub/new-verification-dialog'

export interface ShellSlot {
  openNew: () => void
}

export const ShellContext = createContext<ShellSlot>({ openNew: () => undefined })
export const useShell = () => useContext(ShellContext)

const NAV = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/projects', label: 'Projects', icon: FolderGit2 },
  { href: '/runs', label: 'Runs', icon: PlayCircle },
  { href: '/kane', label: 'Kane', icon: ScanEye },
  { href: '/github', label: 'GitHub', icon: Github },
  { href: '/schedules', label: 'Schedules', icon: Clock3 },
  { href: '/telegram', label: 'Telegram', icon: Send },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Shell({ children, title, subtitle, actions }: {
  children: ReactNode
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  const pathname = usePathname()
  const [newOpen, setNewOpen] = useState(false)

  return (
    <ShellContext.Provider value={{ openNew: () => setNewOpen(true) }}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        {/* Activity bar */}
        <nav className="flex w-[56px] shrink-0 flex-col items-center gap-1 border-r border-border bg-[#0d0d10] py-3">
          <Link href="/" className="mb-2 grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <ShieldCheck className="h-5 w-5" strokeWidth={2.2} />
          </Link>
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={[
                  'group relative grid h-10 w-10 place-items-center rounded-lg transition-colors',
                  active
                    ? 'bg-zinc-800/80 text-foreground'
                    : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300',
                ].join(' ')}
              >
                <item.icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
                {active && <span className="absolute left-0 h-5 w-[2px] rounded-r bg-emerald-400" />}
                <span className="pointer-events-none absolute left-12 z-50 hidden whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
                  {item.label}
                </span>
              </Link>
            )
          })}
          <div className="mt-auto text-[9px] font-medium tracking-widest text-zinc-600 [writing-mode:vertical-rl]">
            VERIFYHUB
          </div>
        </nav>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-[#0d0d10] px-4">
            <div className="flex min-w-0 items-baseline gap-2">
              {title && (
                <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">{title}</h1>
              )}
              {subtitle && (
                <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {actions}
              <Button size="sm" onClick={() => setNewOpen(true)} className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500">
                <Plus className="h-3.5 w-3.5" />
                New Verification
              </Button>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>

        <NewVerificationDialog open={newOpen} onOpenChange={setNewOpen} />
      </div>
    </ShellContext.Provider>
  )
}
