/* Recruitment Center service location. The Recruitment Center runs as its own
   service (see E:\PCFL_Web\PCFL-Recruiting). Point apiBase at wherever that
   service is hosted; the site works normally without it (the Recruiting page
   shows an offline notice). Local dev default: http://localhost:8787 */
window.PCFL_RECRUITING = {
  // local dev: http://localhost:8787 by default; a developer can point at another port with
  // localStorage.setItem('pcfl-rc-api', 'http://localhost:8791/api/recruiting/v1')
  apiBase: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? ((() => { try { return localStorage.getItem('pcfl-rc-api'); } catch { return null; } })() || 'http://localhost:8787/api/recruiting/v1')
    : 'https://gziar743eun6mwqbrwxjinxc.153.75.235.217.sslip.io/api/recruiting/v1',
  logoBase: 'assets/logos/'
};
