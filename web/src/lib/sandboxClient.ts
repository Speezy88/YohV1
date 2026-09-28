/**
 * web/src/lib/sandboxClient.ts
 *
 * Story 9.2: the three `/sandbox` calls, over the typed Hono RPC client —
 * mirrors `checkOff.ts`'s exact `settle<T>` convention verbatim. Every call
 * resolves to an outcome and never throws: a rejected request and an
 * `{ok:false}` envelope both come back as `{ok:false, message}`. Story 9.3
 * adds a fourth sibling export, `requestSandboxFinish`, to this same file.
 */
import { apiClient } from "./apiClient.ts";
import type {
  SandboxSaveRequest,
  SandboxSkipRequest,
  SandboxStartResponse,
  SandboxSaveResponse,
  SandboxSkipResponse,
  SandboxFinishRequest,
  SandboxFinishResponse,
} from "../../../src/types/api.ts";

export type SandboxOutcomeResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

async function settle<T>(request: () => Promise<{ json(): Promise<unknown> }>): Promise<SandboxOutcomeResult<T>> {
  try {
    const res = await request();
    const result = (await res.json()) as { ok: true; value: T } | { ok: false; error: { message: string } };
    return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export function requestSandboxStart(exclude?: readonly string[]): Promise<SandboxOutcomeResult<SandboxStartResponse>> {
  return settle(() => apiClient.api.sandbox.start.$post({ json: exclude ? { exclude: [...exclude] } : {} }));
}

export function requestSandboxSave(taskId: string, body: SandboxSaveRequest): Promise<SandboxOutcomeResult<SandboxSaveResponse>> {
  return settle(() => apiClient.api.sandbox[":taskId"].save.$post({ param: { taskId }, json: { ...body, exclude: [...body.exclude] } }));
}

export function requestSandboxSkip(taskId: string, body: SandboxSkipRequest): Promise<SandboxOutcomeResult<SandboxSkipResponse>> {
  return settle(() => apiClient.api.sandbox[":taskId"].skip.$post({ param: { taskId }, json: { ...body, exclude: [...body.exclude] } }));
}

/** Story 9.3: the Finale's one route call — settles the session's accumulated outcomes. */
export function requestSandboxFinish(outcomes: SandboxFinishRequest["outcomes"]): Promise<SandboxOutcomeResult<SandboxFinishResponse>> {
  return settle(() => apiClient.api.sandbox.finish.$post({ json: { outcomes: [...outcomes] } }));
}
