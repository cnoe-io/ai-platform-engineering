import { MongoClient } from "mongodb";

import { buildCredentialIndexSpecs } from "../ui/src/lib/credentials/indexes";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE;

if (!uri || !databaseName) {
  throw new Error("MONGODB_URI and MONGODB_DATABASE are required");
}

async function main(): Promise<void> {
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(databaseName);
    for (const spec of buildCredentialIndexSpecs()) {
      await db.collection(spec.collection).createIndex(spec.keys, spec.options);
      console.log(`ensured index ${spec.options?.name ?? "<unnamed>"} on ${spec.collection}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
