import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaInitPromise: Promise<void> | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

// Automatically configure SQLite pragmas to avoid WSL/Windows DrvFs I/O errors (SQLITE_IOERR_SHMSIZE 2570)
// and lock contention.
export async function ensureDbReady(): Promise<void> {
  if (!globalForPrisma.prismaInitPromise) {
    globalForPrisma.prismaInitPromise = (async () => {
      try {
        await db.$connect()
        // Journal mode DELETE/TRUNCATE disables SQLite WAL mode -shm shared-memory mapping which fails on WSL /mnt mounts
        await db.$executeRawUnsafe('PRAGMA journal_mode = DELETE;')
        await db.$executeRawUnsafe('PRAGMA busy_timeout = 10000;')
        await db.$executeRawUnsafe('PRAGMA synchronous = NORMAL;')
      } catch (err) {
        console.warn('[db] SQLite pragma initialization note:', err)
      }
    })()
  }
  return globalForPrisma.prismaInitPromise
}

// Fire initialization in background immediately on import
void ensureDbReady()

/**
 * Retry helper for DB operations that might hit SQLite lock contention or transient I/O delays
 */
export async function withDbRetry<T>(fn: () => Promise<T>, maxRetries = 5, baseDelayMs = 120): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      const msg = String(err?.message || '')
      const isLockOrIo =
        msg.includes('disk I/O error') ||
        msg.includes('2570') ||
        msg.includes('busy') ||
        msg.includes('locked') ||
        msg.includes('SQLITE_BUSY') ||
        msg.includes('SQLITE_IOERR') ||
        err?.code === 'P2034' ||
        err?.code === 'P2028'
      if (isLockOrIo && attempt < maxRetries - 1) {
        try {
          await db.$executeRawUnsafe('PRAGMA journal_mode = DELETE;')
          await db.$executeRawUnsafe('PRAGMA busy_timeout = 10000;')
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(1.5, attempt) + Math.random() * 50))
        continue
      }
      throw err
    }
  }
  throw lastError
}