#!/usr/bin/env tsx
import './load-script-env';

import { db } from '../app/lib/db';
import {
  checkRuntimeBundle,
  runRuntimeCompatibility,
  testProviderConnection,
  updateRuntimeBundleStatus,
} from '../app/lib/dataLab/runtimeRegistry';
import type { SessionUser } from '../app/lib/session';

const BUNDLE_ID = '5ec5ef60-97ed-42d9-84b7-07f60ab27de2';
const CONNECTION_ID = '843d6abf-d868-4783-8cc8-ebe16009f0e8';

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function snapshot() {
  const bundle = await db.runtimeBundle.findUnique({
    where: { id: BUNDLE_ID },
    include: {
      endpoint: { include: { connection: true } },
      promptCompatibilities: { orderBy: { checkedAt: 'desc' }, take: 1 },
    },
  });
  if (!bundle || bundle.endpoint.connectionId !== CONNECTION_ID) throw new Error('Candidate B RuntimeBundle lineage changed');
  return {
    bundle: { id: bundle.id, name: bundle.name, status: bundle.status, compatibilityStatus: bundle.promptCompatibilities[0]?.status ?? null },
    connection: { id: bundle.endpoint.connection.id, name: bundle.endpoint.connection.name, status: bundle.endpoint.connection.status, lastTestStatus: bundle.endpoint.connection.lastTestStatus, lastErrorCode: bundle.endpoint.connection.lastErrorCode },
  };
}

async function main() {
  const actorUsername = arg('--actor');
  if (!actorUsername) throw new Error('Usage: npx tsx scripts/recover-production-candidate-b-runtime.ts --actor <active-admin> [--apply]');
  const actorRow = await db.user.findFirst({ where: { username: actorUsername, role: 'admin', isActive: true } });
  if (!actorRow) throw new Error('Actor must be an active admin');
  const actor: SessionUser = { id: actorRow.id, username: actorRow.username, displayName: actorRow.displayName, role: 'admin' };
  const before = await snapshot();
  if (before.bundle.status === 'AVAILABLE' && before.bundle.compatibilityStatus === 'PASS' && before.connection.status === 'ACTIVE' && before.connection.lastTestStatus === 'PASS') {
    console.log(JSON.stringify({ alreadyRecovered: true, actor: actorUsername, state: before }, null, 2));
    return;
  }
  if (!hasFlag('--apply')) {
    console.log(JSON.stringify({ dryRun: true, actor: actorUsername, before, steps: ['TEST_PROVIDER_CONNECTION', 'CHECK_RUNTIME_BUNDLE', 'EVALUATE_RUNTIME_COMPATIBILITY', 'MARK_AVAILABLE'] }, null, 2));
    return;
  }

  const connection = await testProviderConnection(CONNECTION_ID, actor);
  if (!connection.ok) throw new Error('Provider connection probe did not pass');
  const deterministic = await checkRuntimeBundle(BUNDLE_ID);
  if (!deterministic.ok) throw new Error(`RuntimeBundle consistency failed: ${deterministic.blockers.join('; ')}`);
  const compatibility = await runRuntimeCompatibility(BUNDLE_ID, actor);
  if (compatibility.status !== 'PASS') throw new Error(`Runtime compatibility failed: ${compatibility.evidence.failure || 'unknown failure'}`);
  await updateRuntimeBundleStatus({ id: BUNDLE_ID, action: 'MARK_AVAILABLE', user: actor });
  const after = await snapshot();
  if (after.bundle.status !== 'AVAILABLE' || after.bundle.compatibilityStatus !== 'PASS' || after.connection.status !== 'ACTIVE' || after.connection.lastTestStatus !== 'PASS') {
    throw new Error('Candidate B RuntimeBundle postflight is not fully available');
  }
  console.log(JSON.stringify({ applied: true, actor: actorUsername, connectionProbe: { modelCount: connection.modelIds.length, probeModel: connection.probeModel }, deterministic, compatibility: compatibility.status, after }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
