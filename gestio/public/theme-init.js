// Applies the stored or system theme before first paint. Loaded as a classic, synchronous script in
// <head> so the page does not flash; it lives in a file so the CSP needs no 'unsafe-inline'.
try{var t=localStorage.getItem('gestio-theme');document.documentElement.dataset.theme=t==='dark'||t==='light'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
