const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  try {
    await prisma.$connect()
    const modeBefore = await prisma.$queryRawUnsafe('PRAGMA journal_mode;')
    console.log('Current journal_mode:', JSON.stringify(modeBefore))

    const modeAfter = await prisma.$queryRawUnsafe('PRAGMA journal_mode = DELETE;')
    console.log('Set journal_mode to DELETE:', JSON.stringify(modeAfter))

    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 10000;')
    console.log('Set busy_timeout to 10000ms')

    await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL;')
    console.log('Set synchronous to NORMAL')

    await prisma.$executeRawUnsafe('VACUUM;')
    console.log('Database vacuumed successfully.')
  } catch (err) {
    console.error('Error fixing SQLite:', err)
  } finally {
    await prisma.$disconnect()
  }
}

main()
