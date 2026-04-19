import { PrismaClient } from '@prisma/client'

// Single shared PrismaClient instance across the entire API.
// Each `new PrismaClient()` opens its own connection pool — having 20+
// separate instances exhausts RDS connection limits on small instances.
//
// Connection pool size is set via DATABASE_URL query param or the
// `connection_limit` option below. db.t3.micro supports ~80 connections;
// we cap at 10 to leave headroom for migrations and manual queries.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
