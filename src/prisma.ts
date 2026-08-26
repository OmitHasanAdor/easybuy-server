import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaClient } from "./generated/prisma/client.ts";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({
  connectionString: process.env.DIRECT_URL,
});

const prisma = new PrismaClient({ adapter });

export default prisma;