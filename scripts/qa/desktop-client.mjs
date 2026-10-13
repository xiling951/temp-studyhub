/* Connect to the running user-authorized Desktop without reading model credentials. */
import { readFile } from 'node:fs/promises';
import { launchChromium } from './browser.mjs';

const normalizedWorkspace = value => String(value || '').trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

/** Default follows the latest session. Explicit workspace selection is for read-only RPC checks; it does not select the browser's visible chat. */
export function selectDesktopSession(items, workspace = null) {
  if (workspace === null) return items[0];
  if (typeof workspace !== 'string' || !workspace.trim()) throw Error('Desktop QA workspace must be a nonempty path, or null for the latest session');
  const wanted = normalizedWorkspace(workspace);
  const session = items.find(item => normalizedWorkspace(item.cwd) === wanted);
  if (!session?.sessionId) throw Error(`Desktop has no usable StudyHub session for workspace ${workspace}; open that workspace, or explicitly use workspace: null to inspect the latest session`);
  return session;
}

// workspace only selects the RPC session; it must not be used to claim that the UI shows that workspace.
export async function connectDesktop({ liveModelSession = false, workspace = null } = {}) {
  const log = await readFile('C:/Users/Lenovo/AppData/Roaming/dsh-desktop/logs/harness.log', 'utf8');
  const url = [...log.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/g)].at(-1)?.[1];
  if (!url) throw Error('Running Desktop endpoint unavailable');
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const rpc = (method, payload) => page.evaluate(async ({ method, payload }) => (await (await fetch(`/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }),
    })).json()).result, { method, payload });
    const sessions = liveModelSession
      ? await rpc('session/create', { args: { request: { cwd: 'D:/studyhub', agentPreset: 'study' } } })
      : await rpc('session/list', { args: { _request: {} } });
    if (!sessions.ok) throw Error('Desktop session admission unavailable');
    const sessionId = liveModelSession ? sessions.value.sessionId : selectDesktopSession(sessions.value.items, workspace)?.sessionId;
    if (!sessionId) throw Error('Desktop has no usable StudyHub session');
    const call = async (action, args = {}) => {
      const response = await rpc('study-workspace/call', { sessionId, action, args });
      if (!response.ok) throw Error(`${action}: ${response.error?.message || 'native request failed'}`);
      return response.value;
    };
    return { page, browser, call, rpc, sessionId,
      refresh: () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }), close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw new Error(String(error.message).replace(/token=[^\s"\\&]+/g, 'token=[redacted]'));
  }
}
