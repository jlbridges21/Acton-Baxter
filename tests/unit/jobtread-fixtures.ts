/** Test wrapper around the shared synthetic JobTread fixture. */

import { setJobTreadFetcherForTests } from "@/lib/jobtread/client";
import {
  createFixtureFetcher,
  FAKE_GRANT_KEY,
  type FakePaveLog,
  type FakePaveOptions,
} from "@/lib/jobtread/fixture";

export {
  COST_GROUPS,
  CUSTOM_FIELDS,
  F,
  FAKE_GRANT_KEY,
  JOB_DETAIL_FILES,
  JOB_DETAIL_TASKS,
  JOBS,
} from "@/lib/jobtread/fixture";

/** Install a fake Pave endpoint. Returns a log of request bodies. */
export function installFakePave(options: FakePaveOptions = {}): FakePaveLog {
  process.env.JOBTREAD_GRANT_KEY = FAKE_GRANT_KEY;
  process.env.JOBTREAD_ORGANIZATION_ID = "orgTest0001";
  const log: FakePaveLog = { bodies: [], calls: 0 };
  setJobTreadFetcherForTests(createFixtureFetcher(options, log));
  return log;
}

export function uninstallFakePave() {
  setJobTreadFetcherForTests(null);
  delete process.env.JOBTREAD_GRANT_KEY;
  delete process.env.JOBTREAD_ORGANIZATION_ID;
}
