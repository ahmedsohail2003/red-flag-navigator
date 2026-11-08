// Injects the shared top navigation. Include with: <script type="module" src="js/nav.js"></script>
const PAGES = [
  { href: 'index.html', label: 'Overview' },
  { href: 'doctor.html', label: 'Doctor dashboard' },
  { href: 'patient.html', label: 'Patient view' },
  { href: 'hometests.html', label: 'Home tests' },
  { href: 'method.html', label: 'Method & validation' },
];
const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
const header = document.createElement('header');
header.className = 'rfn-nav';
header.innerHTML = `<div class="inner">
  <div class="brand">Red-Flag Navigator<span>earlier EMG referral for possible ALS</span></div>
  <nav>${PAGES.map((p) => `<a href="${p.href}" class="${p.href === here ? 'active' : ''}">${p.label}</a>`).join('')}</nav>
</div>`;
document.body.prepend(header);
