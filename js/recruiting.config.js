/* Recruitment Center service location. The Recruitment Center runs as its own
   service (see E:\PCFL_Web\PCFL-Recruiting). Point apiBase at wherever that
   service is hosted; the site works normally without it (the Recruiting page
   shows an offline notice). Local dev default: http://localhost:8787 */
window.PCFL_RECRUITING = {
  apiBase: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8787/api/recruiting/v1'
    : 'https://REPLACE-WITH-YOUR-HOST/api/recruiting/v1',
  logoBase: 'assets/logos/'
};
