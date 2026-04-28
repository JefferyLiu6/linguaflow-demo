import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient
  prismaAdapter?: PrismaPg
}

function getDatabaseUrl() {
  return process.env.DATABASE_URL
}

function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma
  }

  const databaseUrl = getDatabaseUrl()
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL must be set before using Prisma-backed routes. DIRECT_URL is reserved for Prisma CLI migrations.',
    )
  }

  const adapter =
    globalForPrisma.prismaAdapter ??
    new PrismaPg({ connectionString: databaseUrl })

  const prismaClient = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prismaClient
    globalForPrisma.prismaAdapter = adapter
  }

  return prismaClient
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrismaClient(), prop, receiver)
  },
})
