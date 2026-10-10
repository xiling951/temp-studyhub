// Runs only in the search child, before its dependencies can replace Node's dispatcher.
// Undici 8 installs its own dispatcher; Node's environment proxy flag alone is insufficient.
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

if (['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].some(key => process.env[key])) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
