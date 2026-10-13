type AuthLocation = Pick<Location, 'hash' | 'search'>;

/** Read only the callback's intent/errors; tokens remain for Supabase to verify. */
export function passwordRecoveryLocation(location: AuthLocation) {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const invalidLink = query.get('recovery') === 'invalid' || ['error', 'error_code', 'error_description'].some(key => hash.has(key) || query.has(key));
  const requiresVerification = hash.get('type') === 'recovery' || query.get('recovery') === 'pending';
  return { requested: requiresVerification || query.get('recovery') === '1' || invalidLink, invalidLink, requiresVerification };
}

/** Keep recovery visible after the SDK consumes the fragment and on refresh. */
export function setPasswordRecoveryMarker(enabled: boolean, invalidLink = false, pendingVerification = false) {
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set('recovery', invalidLink ? 'invalid' : pendingVerification ? 'pending' : '1');
  else {
    url.searchParams.delete('recovery');
    for (const key of ['error', 'error_code', 'error_description']) url.searchParams.delete(key);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (hash.get('type') === 'recovery' || ['access_token', 'refresh_token', 'error', 'error_code', 'error_description'].some(key => hash.has(key))) url.hash = '';
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
